-- ============================================================================
-- 276. 사용자 입출금 승인 시 관리자 보유금 업데이트 (기존 로직 유지)
-- ============================================================================
-- 작성일: 2025-10-18
-- 목적: 기존에 잘 작동하는 관리자 강제 입출금 로직은 그대로 두고,
--       사용자 일반 입출금 승인 시에만 관리자 보유금 업데이트 추가
-- ============================================================================

-- ============================================
-- 1단계: 기존 트리거 삭제
-- ============================================

DROP TRIGGER IF EXISTS trigger_unified_balance_update_insert ON transactions;
DROP TRIGGER IF EXISTS trigger_unified_balance_update_update ON transactions;

-- ============================================
-- 2단계: 트리거 함수 수정 (케이스 3만 추가)
-- ============================================

CREATE OR REPLACE FUNCTION unified_balance_update_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_current_balance NUMERIC;
    user_new_balance NUMERIC;
    user_referrer_id UUID;
    partner_current_balance NUMERIC;
    partner_new_balance NUMERIC;
    transaction_amount NUMERIC;
    should_process BOOLEAN := FALSE;
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
    -- C. 관리자(partners) 보유금 업데이트
    -- =====================================================
    
    -- partner_id가 없으면 referrer_id 사용 (⭐ 추가)
    DECLARE
        target_partner_id UUID := NEW.partner_id;
    BEGIN
        IF (target_partner_id IS NULL AND user_referrer_id IS NOT NULL) THEN
            target_partner_id := user_referrer_id;
            RAISE NOTICE '🔗 [트리거] partner_id 없음 → referrer_id 사용: %', target_partner_id;
        END IF;
        
        IF (target_partner_id IS NOT NULL) THEN
            -- 현재 관리자 보유금 조회
            SELECT balance INTO partner_current_balance
            FROM partners
            WHERE id = target_partner_id;
            
            IF partner_current_balance IS NULL THEN
                RAISE WARNING '❌ [트리거] 관리자를 찾을 수 없음: %', target_partner_id;
            ELSE
                -- ===== 케이스 1: 관리자 강제 입출금 (기존 로직 유지!) =====
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
                
                -- ===== 케이스 2: 파트너 본인 입출금 (기존 로직 유지!) =====
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
                
                -- ===== 케이스 3: 사용자 일반 입출금 승인 (⭐ 새로 추가!) =====
                ELSIF (NEW.user_id IS NOT NULL AND 
                       NEW.transaction_type IN ('deposit', 'withdrawal')) THEN
                    
                    CASE NEW.transaction_type
                        WHEN 'deposit' THEN
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
    END;
    
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
-- 4단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 사용자 입출금 승인 시 관리자 보유금 업데이트 추가 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '기존 로직 유지:';
    RAISE NOTICE '  ✓ 케이스 1: 관리자 강제 입출금 (admin_deposit, admin_withdrawal)';
    RAISE NOTICE '  ✓ 케이스 2: 파트너 본인 입출금 (user_id 없음)';
    RAISE NOTICE '';
    RAISE NOTICE '새로 추가:';
    RAISE NOTICE '  ⭐ 케이스 3: 사용자 일반 입출금 승인 (deposit, withdrawal)';
    RAISE NOTICE '    - 사용자 입금 승인 → 관리자 보유금 감소';
    RAISE NOTICE '    - 사용자 출금 승인 → 관리자 보유금 증가';
    RAISE NOTICE '';
    RAISE NOTICE '자동 관리자 찾기:';
    RAISE NOTICE '  • partner_id 우선 사용';
    RAISE NOTICE '  • 없으면 users.referrer_id 사용';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;
