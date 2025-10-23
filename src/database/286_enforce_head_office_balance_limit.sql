-- ============================================================================
-- 286. 관리자 보유금 지급/입금 시 자신의 보유금 초과 방지
-- ============================================================================
-- 작성일: 2025-01-19
-- 목적: 각 관리자가 강제 입금/입금 승인/하위 파트너 지급 시 자신의 보유금을 초과할 수 없도록 검증
-- 배경: 현재는 단순히 관리자 보유금만 차감하고 보유금 부족 확인 로직이 없음
-- 해결: 보유금 차감 전 해당 관리자의 보유금 확인, 부족 시 거래 거부
-- ============================================================================

-- ============================================
-- 1단계: 관리자 보유금 확인 함수 생성
-- ============================================

CREATE OR REPLACE FUNCTION check_partner_balance_sufficient(
    p_partner_id UUID,
    p_amount DECIMAL(15,2),
    p_transaction_description TEXT DEFAULT '거래'
) RETURNS BOOLEAN AS $
DECLARE
    v_partner_balance DECIMAL(15,2);
    v_partner_name TEXT;
    v_partner_type TEXT;
BEGIN
    RAISE NOTICE '💰 [보유금 검증] 시작: partner_id=%, amount=%', p_partner_id, p_amount;
    
    -- 금액이 0 이하면 검증 불필요
    IF p_amount <= 0 THEN
        RAISE NOTICE '✅ [보유금 검증] 스킵 (금액이 0 이하)';
        RETURN TRUE;
    END IF;
    
    -- 파트너 정보 조회
    SELECT balance, nickname, partner_type
    INTO v_partner_balance, v_partner_name, v_partner_type
    FROM partners
    WHERE id = p_partner_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION '파트너를 찾을 수 없습니다: %', p_partner_id;
    END IF;
    
    -- 시스템관리자는 검증 불필요 (무제한)
    IF v_partner_type = 'system_admin' THEN
        RAISE NOTICE '✅ [보유금 검증] 스킵 (시스템관리자는 무제한)';
        RETURN TRUE;
    END IF;
    
    -- 관리자 보유금 확인
    IF v_partner_balance >= p_amount THEN
        RAISE NOTICE '✅ [보유금 검증] 통과: 관리자=%, 보유금=%, 필요금액=%', 
            v_partner_name, v_partner_balance, p_amount;
        RETURN TRUE;
    ELSE
        RAISE EXCEPTION '관리자 보유금이 부족합니다. (관리자: %, 현재: %, 필요: %, %)', 
            v_partner_name, v_partner_balance, p_amount, p_transaction_description;
    END IF;
    
    RETURN FALSE;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2단계: 트리거 함수 수정 (보유금 검증 추가)
-- ============================================

-- 기존 트리거 삭제
DROP TRIGGER IF EXISTS trigger_unified_balance_update_insert ON transactions;
DROP TRIGGER IF EXISTS trigger_unified_balance_update_update ON transactions;

CREATE OR REPLACE FUNCTION unified_balance_update_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
    user_current_balance NUMERIC;
    user_new_balance NUMERIC;
    user_referrer_id UUID;
    partner_current_balance NUMERIC;
    partner_new_balance NUMERIC;
    transaction_amount NUMERIC;
    should_process BOOLEAN := FALSE;
    target_partner_id UUID;
    deduction_amount NUMERIC := 0; -- 관리자 보유금 차감 금액
BEGIN
    -- =====================================================
    -- A. 처리 여부 결정
    -- =====================================================
    
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.status IN ('approved', 'completed')) THEN
            should_process := TRUE;
            RAISE NOTICE '💰 [트리거-INSERT] 거래 생성 감지: id=%, type=%, amount=%, status=%', 
                NEW.id, NEW.transaction_type, NEW.amount, NEW.status;
        END IF;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.status = 'pending' AND NEW.status IN ('approved', 'completed')) THEN
            should_process := TRUE;
            RAISE NOTICE '💰 [트리거-UPDATE] 승인 처리 감지: id=%, type=%, amount=%, status: % → %', 
                NEW.id, NEW.transaction_type, NEW.amount, OLD.status, NEW.status;
        ELSE
            RAISE NOTICE '⏭️ [트리거-UPDATE] 스킵 (상태 변경 없음): old_status=%, new_status=%', 
                OLD.status, NEW.status;
        END IF;
    END IF;
    
    IF NOT should_process THEN
        RETURN NEW;
    END IF;
    
    transaction_amount := NEW.amount;
    
    -- =====================================================
    -- B. 사용자(users) 보유금 업데이트
    -- =====================================================
    
    IF (NEW.user_id IS NOT NULL) THEN
        -- 사용자 정보 및 referrer_id 조회
        SELECT balance, referrer_id 
        INTO user_current_balance, user_referrer_id
        FROM users
        WHERE id = NEW.user_id;
        
        IF user_current_balance IS NULL THEN
            RAISE WARNING '❌ [트리거] 사용자를 찾을 수 없음: %', NEW.user_id;
        ELSE
            -- 거래 유형에 따라 보유금 계산
            IF NEW.transaction_type IN ('deposit', 'admin_deposit') THEN
                user_new_balance := user_current_balance + transaction_amount;
                RAISE NOTICE '📥 [입금] % + % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                user_new_balance := user_current_balance - transaction_amount;
                RAISE NOTICE '📤 [출금] % - % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSIF NEW.transaction_type = 'admin_adjustment' THEN
                user_new_balance := user_current_balance + transaction_amount;
                RAISE NOTICE '⚖️ [조정] % + % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSE
                user_new_balance := user_current_balance;
                RAISE NOTICE '➡️ [기타] 잔고 변경 없음';
            END IF;
            
            -- users 테이블 업데이트
            UPDATE users
            SET 
                balance = user_new_balance,
                updated_at = NOW()
            WHERE id = NEW.user_id;
            
            RAISE NOTICE '✅ [트리거] 사용자 보유금 업데이트 완료: user_id=%, % → %', 
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
        user_referrer_id := NULL;
    END IF;
    
    -- =====================================================
    -- C. 관리자(partners) 보유금 업데이트 (⭐ 검증 추가)
    -- =====================================================
    
    -- partner_id가 없으면 referrer_id 사용
    target_partner_id := COALESCE(NEW.partner_id, user_referrer_id);
    
    IF (target_partner_id IS NULL) THEN
        target_partner_id := user_referrer_id;
        IF target_partner_id IS NOT NULL THEN
            RAISE NOTICE '🔗 [트리거] partner_id 없음 → referrer_id 사용: %', target_partner_id;
        END IF;
    END IF;
    
    IF (target_partner_id IS NOT NULL) THEN
        -- 현재 관리자 보유금 조회
        SELECT balance INTO partner_current_balance
        FROM partners
        WHERE id = target_partner_id;
        
        IF partner_current_balance IS NULL THEN
            RAISE WARNING '❌ [트리거] 관리자를 찾을 수 없음: %', target_partner_id;
        ELSE
            -- ===== 케이스 1: 관리자 강제 입출금 =====
            IF (NEW.user_id IS NOT NULL AND 
                NEW.transaction_type IN ('admin_deposit', 'admin_withdrawal')) THEN
                
                CASE NEW.transaction_type
                    WHEN 'admin_deposit' THEN
                        deduction_amount := transaction_amount; -- 차감 필요
                        
                        -- ⭐ 관리자 보유금 검증
                        IF NOT check_partner_balance_sufficient(
                            target_partner_id, 
                            deduction_amount,
                            '사용자 강제 입금 (금액: ' || transaction_amount || ')'
                        ) THEN
                            RAISE EXCEPTION '관리자 보유금 부족으로 거래를 처리할 수 없습니다.';
                        END IF;
                        
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
            
            -- ===== 케이스 2: 파트너 본인 입출금 =====
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
            
            -- ===== 케이스 3: 사용자 일반 입출금 승인 =====
            ELSIF (NEW.user_id IS NOT NULL AND 
                   NEW.transaction_type IN ('deposit', 'withdrawal')) THEN
                
                CASE NEW.transaction_type
                    WHEN 'deposit' THEN
                        deduction_amount := transaction_amount; -- 차감 필요
                        
                        -- ⭐ 관리자 보유금 검증
                        IF NOT check_partner_balance_sufficient(
                            target_partner_id, 
                            deduction_amount,
                            '사용자 입금 승인 (금액: ' || transaction_amount || ')'
                        ) THEN
                            RAISE EXCEPTION '관리자 보유금 부족으로 입금 승인을 처리할 수 없습니다.';
                        END IF;
                        
                        -- 사용자 입금 승인: 관리자 보유금 감소
                        partner_new_balance := partner_current_balance - transaction_amount;
                        RAISE NOTICE '🔽 [사용자 입금 승인] 관리자 보유금 감소: % - % = %', 
                            partner_current_balance, transaction_amount, partner_new_balance;
                    
                    WHEN 'withdrawal' THEN
                        -- 사용자 출금 승인: 관리자 보유금 증가
                        partner_new_balance := partner_current_balance + transaction_amount;
                        RAISE NOTICE '🔼 [사용자 출금 승인] 관리자 보유금 증가: % + % = %', 
                            partner_current_balance, transaction_amount, partner_new_balance;
                    
                    ELSE
                        partner_new_balance := partner_current_balance;
                END CASE;
                
            ELSE
                partner_new_balance := partner_current_balance;
            END IF;
            
            -- partners 테이블 업데이트
            IF (partner_new_balance IS NOT NULL AND partner_new_balance != partner_current_balance) THEN
                UPDATE partners
                SET 
                    balance = partner_new_balance,
                    updated_at = NOW()
                WHERE id = target_partner_id;
                
                -- 관리자 보유금 변경 로그
                INSERT INTO partner_balance_logs (
                    partner_id,
                    old_balance,
                    new_balance,
                    change_amount,
                    change_type,
                    description
                ) VALUES (
                    target_partner_id,
                    partner_current_balance,
                    partner_new_balance,
                    partner_new_balance - partner_current_balance,
                    NEW.transaction_type,
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
END;
$$;

-- ============================================
-- 3단계: 트리거 재생성
-- ============================================

-- INSERT 트리거
CREATE TRIGGER trigger_unified_balance_update_insert
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN (NEW.status IN ('approved', 'completed'))
    EXECUTE FUNCTION unified_balance_update_on_transaction();

-- UPDATE 트리거
CREATE TRIGGER trigger_unified_balance_update_update
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'completed'))
    EXECUTE FUNCTION unified_balance_update_on_transaction();

-- ============================================
-- 4단계: 파트너 간 이체 함수도 보유금 검증 추가
-- ============================================

CREATE OR REPLACE FUNCTION transfer_partner_balance(
    p_from_partner_id UUID,
    p_to_partner_id UUID,
    p_amount DECIMAL(15,2),
    p_memo TEXT DEFAULT NULL
)
RETURNS JSON AS $
DECLARE
    v_from_balance DECIMAL(15,2);
    v_to_balance DECIMAL(15,2);
    v_from_balance_after DECIMAL(15,2);
    v_to_balance_after DECIMAL(15,2);
    v_result JSON;
BEGIN
    -- 입력 검증
    IF p_amount <= 0 THEN
        RAISE EXCEPTION '이체 금액은 0보다 커야 합니다.';
    END IF;

    -- 송금 파트너의 현재 잔고 조회 (FOR UPDATE로 잠금)
    SELECT balance INTO v_from_balance
    FROM partners
    WHERE id = p_from_partner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '송금 파트너를 찾을 수 없습니다.';
    END IF;

    -- ⭐ 관리자 보유금 검증 (송금 파트너 기준)
    IF NOT check_partner_balance_sufficient(
        p_from_partner_id, 
        p_amount,
        '파트너 간 이체 (송금자 보유금: ' || v_from_balance || ')'
    ) THEN
        RAISE EXCEPTION '관리자 보유금 부족으로 이체를 처리할 수 없습니다.';
    END IF;

    -- 수신 파트너의 현재 잔고 조회
    SELECT balance INTO v_to_balance
    FROM partners
    WHERE id = p_to_partner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '수신 파트너를 찾을 수 없습니다.';
    END IF;

    -- 송금 파트너 잔고 차감
    UPDATE partners
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE id = p_from_partner_id
    RETURNING balance INTO v_from_balance_after;

    -- 수신 파트너 잔고 증가
    UPDATE partners
    SET balance = balance + p_amount,
        updated_at = NOW()
    WHERE id = p_to_partner_id
    RETURNING balance INTO v_to_balance_after;

    -- 송금 로그 기록
    INSERT INTO partner_balance_logs (
        partner_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        from_partner_id,
        to_partner_id,
        processed_by,
        memo
    ) VALUES (
        p_from_partner_id,
        'withdrawal',
        -p_amount,
        v_from_balance,
        v_from_balance_after,
        p_from_partner_id,
        p_to_partner_id,
        auth.uid(),
        COALESCE(p_memo, '파트너 간 이체')
    );

    -- 수신 로그 기록
    INSERT INTO partner_balance_logs (
        partner_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        from_partner_id,
        to_partner_id,
        processed_by,
        memo
    ) VALUES (
        p_to_partner_id,
        'deposit',
        p_amount,
        v_to_balance,
        v_to_balance_after,
        p_from_partner_id,
        p_to_partner_id,
        auth.uid(),
        COALESCE(p_memo, '파트너 간 이체')
    );

    -- 결과 반환
    v_result := json_build_object(
        'success', true,
        'from_partner_id', p_from_partner_id,
        'to_partner_id', p_to_partner_id,
        'amount', p_amount,
        'from_balance_after', v_from_balance_after,
        'to_balance_after', v_to_balance_after,
        'message', '이체가 완료되었습니다.'
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION '이체 처리 중 오류 발생: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5단계: 완료 메시지
-- ============================================

DO $
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 관리자 보유금 초과 방지 시스템 구축 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '구현된 기능:';
    RAISE NOTICE '  1️⃣ check_partner_balance_sufficient(): 관리자 자신의 보유금 검증';
    RAISE NOTICE '  2️⃣ 트리거 함수 수정: 입출금 승인 시 관리자 보유금 확인';
    RAISE NOTICE '  3️⃣ transfer_partner_balance(): 파트너 간 이체 시 보유금 확인';
    RAISE NOTICE '';
    RAISE NOTICE '적용 범위:';
    RAISE NOTICE '  ✓ 사용자 입금 승인 → 관리자(referrer) 보유금 검증';
    RAISE NOTICE '  ✓ 관리자 강제 입금 → 관리자 자신의 보유금 검증';
    RAISE NOTICE '  ✓ 파트너 간 이체 → 송금자 보유금 검증';
    RAISE NOTICE '';
    RAISE NOTICE '예외 사항:';
    RAISE NOTICE '  • 시스템관리자: 무제한 (검증 스킵)';
    RAISE NOTICE '  • 출금/환수: 보유금이 증가하므로 검증 불필요';
    RAISE NOTICE '';
    RAISE NOTICE '보유금 부족 시:';
    RAISE NOTICE '  ❌ EXCEPTION 발생 → 거래 전체 롤백';
    RAISE NOTICE '  📋 명확한 오류 메시지 반환 (관리자: XXX, 현재: YYY, 필요: ZZZ)';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $;
