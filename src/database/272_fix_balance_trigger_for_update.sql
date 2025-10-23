-- ============================================================================
-- 272. 입출금 승인 시 users balance 자동 업데이트 트리거 수정
-- ============================================================================
-- 작성일: 2025-10-18
-- 문제: transactions INSERT만 처리하고 UPDATE는 처리 안함
-- 원인: 입출금 승인은 UPDATE로 처리되는데 트리거는 INSERT만 감지
-- 해결: INSERT와 UPDATE 모두 처리하도록 트리거 수정
-- ============================================================================

-- ============================================
-- 1단계: 기존 트리거 삭제
-- ============================================

DROP TRIGGER IF EXISTS trigger_unified_balance_update ON transactions;

-- ============================================
-- 2단계: 트리거 함수 수정 (INSERT + UPDATE 처리)
-- ============================================

CREATE OR REPLACE FUNCTION unified_balance_update_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_current_balance NUMERIC;
    user_new_balance NUMERIC;
    partner_current_balance NUMERIC;
    partner_new_balance NUMERIC;
    transaction_amount NUMERIC;
    should_process BOOLEAN := FALSE;
BEGIN
    -- =====================================================
    -- A. 처리 여부 결정
    -- =====================================================
    
    IF (TG_OP = 'INSERT') THEN
        -- INSERT: approved 또는 completed 상태인 경우만 처리
        IF (NEW.status IN ('approved', 'completed')) THEN
            should_process := TRUE;
            RAISE NOTICE '💰 [트리거-INSERT] 거래 생성 감지: id=%, type=%, amount=%, status=%', 
                NEW.id, NEW.transaction_type, NEW.amount, NEW.status;
        END IF;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        -- UPDATE: pending → approved/completed로 변경된 경우만 처리
        IF (OLD.status = 'pending' AND NEW.status IN ('approved', 'completed')) THEN
            should_process := TRUE;
            RAISE NOTICE '💰 [트리거-UPDATE] 승인 처리 감지: id=%, type=%, amount=%, status: % → %', 
                NEW.id, NEW.transaction_type, NEW.amount, OLD.status, NEW.status;
        ELSE
            RAISE NOTICE '⏭️ [트리거-UPDATE] 스킵 (상태 변경 없음): old_status=%, new_status=%', 
                OLD.status, NEW.status;
        END IF;
    END IF;
    
    -- 처리 조건에 맞지 않으면 즉시 리턴
    IF NOT should_process THEN
        RETURN NEW;
    END IF;
    
    transaction_amount := NEW.amount;
    
    -- =====================================================
    -- B. 사용자(users) 보유금 업데이트
    -- =====================================================
    
    IF (NEW.user_id IS NOT NULL) THEN
        -- 현재 사용자 보유금 조회
        SELECT balance INTO user_current_balance
        FROM users
        WHERE id = NEW.user_id;
        
        IF user_current_balance IS NULL THEN
            RAISE WARNING '❌ [트리거] 사용자를 찾을 수 없음: %', NEW.user_id;
        ELSE
            -- 거래 유형에 따라 보유금 계산
            IF NEW.transaction_type IN ('deposit', 'admin_deposit') THEN
                -- 입금: 보유금 증가
                user_new_balance := user_current_balance + transaction_amount;
                RAISE NOTICE '📥 [입금] % + % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                -- 출금: 보유금 감소
                user_new_balance := user_current_balance - transaction_amount;
                RAISE NOTICE '📤 [출금] % - % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSIF NEW.transaction_type = 'admin_adjustment' THEN
                -- 조정: amount의 부호에 따라
                user_new_balance := user_current_balance + transaction_amount;
                RAISE NOTICE '⚖️ [조정] % + % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSE
                -- 기타: 변경 없음
                user_new_balance := user_current_balance;
                RAISE NOTICE '➡️ [기타] 잔고 변경 없음';
            END IF;
            
            -- users 테이블 업데이트
            UPDATE users
            SET 
                balance = user_new_balance,
                updated_at = NOW()
            WHERE id = NEW.user_id;
            
            RAISE NOTICE '✅ [트리거] 사용자 보유금 업데이트 완료: user_id=%, username=(조회필요), % → %', 
                NEW.user_id, user_current_balance, user_new_balance;
            
            -- 거래 기록에 balance_before, balance_after 기록
            IF (NEW.balance_before IS NULL OR TG_OP = 'UPDATE') THEN
                NEW.balance_before := user_current_balance;
            END IF;
            IF (NEW.balance_after IS NULL OR TG_OP = 'UPDATE') THEN
                NEW.balance_after := user_new_balance;
            END IF;
        END IF;
    ELSE
        RAISE NOTICE 'ℹ️ [트리거] user_id 없음, 사용자 보유금 업데이트 스킵';
    END IF;
    
    -- =====================================================
    -- C. 관리자(partners) 보유금 업데이트
    -- =====================================================
    
    IF (NEW.partner_id IS NOT NULL) THEN
        -- 현재 관리자 보유금 조회
        SELECT balance INTO partner_current_balance
        FROM partners
        WHERE id = NEW.partner_id;
        
        IF partner_current_balance IS NULL THEN
            RAISE WARNING '❌ [트리거] 관리자를 찾을 수 없음: %', NEW.partner_id;
        ELSE
            -- 케이스 1: 관리자 강제 입출금 (user_id 있음)
            IF (NEW.user_id IS NOT NULL AND 
                NEW.transaction_type IN ('admin_deposit', 'admin_withdrawal')) THEN
                
                CASE NEW.transaction_type
                    WHEN 'admin_deposit' THEN
                        partner_new_balance := partner_current_balance - transaction_amount;
                        RAISE NOTICE '🔽 [관리자 강제입금] 관리자 보유금 감소: % - % = %', 
                            partner_current_balance, transaction_amount, partner_new_balance;
                    
                    WHEN 'admin_withdrawal' THEN
                        partner_new_balance := partner_current_balance + transaction_amount;
                        RAISE NOTICE '🔼 [관리자 강제출금] 관리자 보유금 증가: % + % = %', 
                            partner_current_balance, transaction_amount, partner_new_balance;
                    
                    ELSE
                        partner_new_balance := partner_current_balance;
                END CASE;
                
            -- 케이스 2: 파트너 본인 입출금 (user_id 없음)
            ELSIF (NEW.user_id IS NULL) THEN
                
                IF NEW.transaction_type IN ('deposit', 'admin_deposit') THEN
                    partner_new_balance := partner_current_balance + transaction_amount;
                    RAISE NOTICE '📥 [파트너 입금] % + % = %', 
                        partner_current_balance, transaction_amount, partner_new_balance;
                        
                ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                    partner_new_balance := partner_current_balance - transaction_amount;
                    RAISE NOTICE '📤 [파트너 출금] % - % = %', 
                        partner_current_balance, transaction_amount, partner_new_balance;
                        
                ELSIF NEW.transaction_type = 'admin_adjustment' THEN
                    partner_new_balance := partner_current_balance + transaction_amount;
                    RAISE NOTICE '⚖️ [파트너 조정] % + % = %', 
                        partner_current_balance, transaction_amount, partner_new_balance;
                        
                ELSE
                    partner_new_balance := partner_current_balance;
                END IF;
            ELSE
                partner_new_balance := partner_current_balance;
            END IF;
            
            -- partners 테이블 업데이트
            IF (partner_new_balance IS NOT NULL AND partner_new_balance != partner_current_balance) THEN
                UPDATE partners
                SET 
                    balance = partner_new_balance,
                    updated_at = NOW()
                WHERE id = NEW.partner_id;
                
                -- 관리자 보유금 변경 로그
                INSERT INTO partner_balance_logs (
                    partner_id,
                    old_balance,
                    new_balance,
                    change_amount,
                    change_type,
                    description
                ) VALUES (
                    NEW.partner_id,
                    partner_current_balance,
                    partner_new_balance,
                    partner_new_balance - partner_current_balance,
                    NEW.transaction_type,
                    format('[거래 #%s] %s', NEW.id::text, 
                        CASE 
                            WHEN NEW.user_id IS NOT NULL THEN
                                CASE NEW.transaction_type
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
                    NEW.partner_id, partner_new_balance - partner_current_balance;
            END IF;
        END IF;
    ELSE
        RAISE NOTICE 'ℹ️ [트리거] partner_id 없음, 관리자 보유금 업데이트 스킵';
    END IF;
    
    RETURN NEW;
END;
$$;

-- ============================================
-- 3단계: 새로운 트리거 생성 (INSERT + UPDATE)
-- ============================================

-- INSERT 트리거
CREATE TRIGGER trigger_unified_balance_update_insert
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN (NEW.status IN ('approved', 'completed'))
    EXECUTE FUNCTION unified_balance_update_on_transaction();

-- UPDATE 트리거 (⭐ 새로 추가!)
CREATE TRIGGER trigger_unified_balance_update_update
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'completed'))
    EXECUTE FUNCTION unified_balance_update_on_transaction();

-- ============================================
-- 4단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 입출금 승인 트리거 수정 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '적용된 변경사항:';
    RAISE NOTICE '  ✓ INSERT 시 balance 자동 업데이트';
    RAISE NOTICE '  ✓ UPDATE 시 balance 자동 업데이트 (⭐ 새로 추가)';
    RAISE NOTICE '  ✓ pending → approved/completed 변경 감지';
    RAISE NOTICE '  ✓ 상세 로그 출력 (디버깅 가능)';
    RAISE NOTICE '';
    RAISE NOTICE '이제 다음 작업 시 users balance가 자동 업데이트됩니다:';
    RAISE NOTICE '  • 입출금 승인 (UPDATE status = completed)';
    RAISE NOTICE '  • 강제 입출금 (INSERT with approved)';
    RAISE NOTICE '  • 관리자 조정 (INSERT with completed)';
    RAISE NOTICE '';
    RAISE NOTICE '로그 확인 방법:';
    RAISE NOTICE '  Supabase Dashboard → Logs → Postgres Logs';
    RAISE NOTICE '  검색어: "트리거"';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;
