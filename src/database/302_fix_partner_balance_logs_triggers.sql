-- =====================================================
-- partner_balance_logs 트리거 수정 (change_type → transaction_type)
-- =====================================================
-- 301번 스키마 변경 후 트리거들의 컬럼명 업데이트

-- =====================================================
-- 1. 트리거 함수 재생성 (286_enforce_head_office_balance_limit.sql 수정)
-- =====================================================

CREATE OR REPLACE FUNCTION enforce_head_office_balance_limit()
RETURNS TRIGGER AS $$
DECLARE
    target_partner_id UUID;
    partner_current_balance NUMERIC(20,2);
    partner_new_balance NUMERIC(20,2);
    transaction_amount NUMERIC(20,2);
    is_deposit BOOLEAN;
    partner_info RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '[트리거 시작] enforce_head_office_balance_limit';
    RAISE NOTICE '  TG_OP: %', TG_OP;
    RAISE NOTICE '  transaction_id: %', NEW.id;
    RAISE NOTICE '  transaction_type: %', NEW.transaction_type;
    RAISE NOTICE '  amount: %', NEW.amount;
    RAISE NOTICE '  user_id: %', NEW.user_id;
    RAISE NOTICE '  partner_id: %', NEW.partner_id;
    RAISE NOTICE '========================================';

    -- INSERT 작업만 처리
    IF TG_OP != 'INSERT' THEN
        RAISE NOTICE 'ℹ️ [트리거] INSERT가 아니므로 스킵 (TG_OP=%)', TG_OP;
        RETURN NEW;
    END IF;

    -- 승인된 거래만 처리 (approved, completed)
    IF NEW.status NOT IN ('approved', 'completed') THEN
        RAISE NOTICE 'ℹ️ [트리거] 승인 전이므로 스킵 (status=%)', NEW.status;
        RETURN NEW;
    END IF;

    -- 🎯 핵심 로직: partner_id 결정
    IF NEW.partner_id IS NOT NULL THEN
        target_partner_id := NEW.partner_id;
        RAISE NOTICE '✅ [트리거] partner_id 사용: %', target_partner_id;
    ELSIF NEW.user_id IS NOT NULL THEN
        -- user_id가 있으면 해당 사용자의 referrer_id 사용
        SELECT referrer_id INTO target_partner_id
        FROM users
        WHERE id = NEW.user_id;
        
        IF target_partner_id IS NOT NULL THEN
            RAISE NOTICE '✅ [트리거] user의 referrer_id 사용: %', target_partner_id;
        ELSE
            RAISE NOTICE 'ℹ️ [트리거] user의 referrer_id가 NULL';
        END IF;
    ELSE
        RAISE NOTICE 'ℹ️ [트리거] partner_id와 user_id 모두 없음';
    END IF;

    -- target_partner_id가 있을 때만 처리
    IF target_partner_id IS NOT NULL THEN
        -- 파트너 정보 조회
        SELECT id, partner_type, balance
        INTO partner_info
        FROM partners
        WHERE id = target_partner_id;

        IF NOT FOUND THEN
            RAISE WARNING '⚠️ [트리거] 파트너를 찾을 수 없음: %', target_partner_id;
            RETURN NEW;
        END IF;

        -- 거래 유형에 따른 보유금 변경 계산
        transaction_amount := COALESCE(NEW.amount, 0);
        
        -- 입금/출금 판단
        is_deposit := NEW.transaction_type IN ('deposit', 'admin_deposit');
        
        RAISE NOTICE '💰 [트리거] 거래 분석:';
        RAISE NOTICE '  거래유형: %', NEW.transaction_type;
        RAISE NOTICE '  입금여부: %', is_deposit;
        RAISE NOTICE '  거래금액: %', transaction_amount;

        partner_current_balance := COALESCE(partner_info.balance, 0);

        -- 보유금 변경 계산
        IF is_deposit THEN
            -- 입금: 관리자 보유금 감소 (사용자에게 지급)
            partner_new_balance := partner_current_balance - transaction_amount;
            RAISE NOTICE '💸 [입금] 관리자 보유금: % → % (-%)', 
                partner_current_balance, partner_new_balance, transaction_amount;
        ELSE
            -- 출금: 관리자 보유금 증가 (사용자로부터 회수)
            partner_new_balance := partner_current_balance + transaction_amount;
            RAISE NOTICE '💰 [출금] 관리자 보유금: % → % (+%)', 
                partner_current_balance, partner_new_balance, transaction_amount;
        END IF;

        -- 🔴 대본사 보유금 검증 (보유금 검증 로직)
        IF partner_info.partner_type = 'head_office' THEN
            IF is_deposit AND partner_new_balance < 0 THEN
                RAISE EXCEPTION '❌ 대본사 보유금 부족: 현재=%, 필요=%, 부족=-%', 
                    partner_current_balance, transaction_amount, ABS(partner_new_balance);
            END IF;
            
            RAISE NOTICE '✅ [트리거] 대본사 보유금 검증 통과';
        END IF;

        -- 📊 관리자 보유금 업데이트
        IF partner_new_balance IS NOT NULL THEN
            IF (partner_new_balance IS NOT NULL AND partner_new_balance != partner_current_balance) THEN
                UPDATE partners
                SET 
                    balance = partner_new_balance,
                    updated_at = NOW()
                WHERE id = target_partner_id;
                
                -- ✅ 관리자 보유금 변경 로그 (수정된 컬럼명 사용)
                INSERT INTO partner_balance_logs (
                    partner_id,
                    balance_before,
                    balance_after,
                    amount,
                    transaction_type,
                    processed_by,
                    memo
                ) VALUES (
                    target_partner_id,
                    partner_current_balance,
                    partner_new_balance,
                    partner_new_balance - partner_current_balance,
                    NEW.transaction_type,
                    NEW.processed_by,
                    format('[거래 #%s] %s', NEW.id::text, 
                        CASE 
                            WHEN NEW.user_id IS NOT NULL THEN
                                CASE NEW.transaction_type
                                    WHEN 'deposit' THEN '사용자 입금 승인'
                                    WHEN 'withdrawal' THEN '사용자 출금 승인'
                                    WHEN 'admin_deposit' THEN '사용자 강제 입금'
                                    WHEN 'admin_withdrawal' THEN '사용자 강제 출금'
                                    ELSE '관리자 처리'
                                END
                            ELSE
                                CASE 
                                    WHEN NEW.transaction_type IN ('deposit', 'admin_deposit') THEN '본인 입금'
                                    WHEN NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN '본인 출금'
                                    WHEN NEW.transaction_type = 'admin_adjustment' THEN '관리자 조정'
                                    ELSE '기타'
                                END
                        END)
                );
                
                RAISE NOTICE '✅ [트리거] 관리자 보유금 업데이트 완료: partner_id=%, change=%', 
                    target_partner_id, partner_new_balance - partner_current_balance;
            END IF;
        END IF;
    ELSE
        RAISE NOTICE 'ℹ️ [트리거] partner_id와 referrer_id 모두 없음, 관리자 보유금 업데이트 스킵';
    END IF;
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ [트리거 오류] %: %', SQLERRM, SQLSTATE;
        -- 오류 발생 시에도 거래는 계속 진행 (보유금 업데이트만 실패)
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 2. 기타 partner_balance_logs를 사용하는 트리거 정리
-- =====================================================

-- 258_unified_balance_realtime_system.sql 트리거 제거 (이미 286번으로 대체됨)
DROP TRIGGER IF EXISTS unified_balance_update_on_transaction ON transactions;
DROP FUNCTION IF EXISTS unified_balance_update_handler();

-- 272_fix_balance_trigger_for_update.sql 트리거 제거 (이미 286번으로 대체됨)
DROP TRIGGER IF EXISTS balance_update_on_transaction_insert ON transactions;
DROP FUNCTION IF EXISTS handle_balance_update();

-- 274_partner_balance_on_user_approval.sql 트리거 제거 (이미 286번으로 대체됨)
DROP TRIGGER IF EXISTS update_partner_balance_on_user_transaction ON transactions;
DROP FUNCTION IF EXISTS update_partner_balance_from_user_transaction();

-- 276_add_user_approval_partner_balance.sql 트리거 제거 (이미 286번으로 대체됨)
DROP TRIGGER IF EXISTS trigger_update_partner_balance_on_approval ON transactions;
DROP FUNCTION IF EXISTS fn_update_partner_balance_on_approval();

-- =====================================================
-- 3. 완료 메시지
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '✅ partner_balance_logs 트리거 수정 완료';
    RAISE NOTICE '   - enforce_head_office_balance_limit() 함수 업데이트';
    RAISE NOTICE '   - 컬럼명: change_type/description → transaction_type/memo';
    RAISE NOTICE '   - 중복 트리거 제거 완료';
END $$;
