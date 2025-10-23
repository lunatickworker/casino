-- ============================================================================
-- 274. 사용자 입출금 승인 시 관리자 보유금 자동 업데이트
-- ============================================================================
-- 작성일: 2025-10-18
-- 목적: 사용자 입출금 승인 시 소속 관리자 보유금을 내부 시스템 계산으로 자동 업데이트
-- 
-- 비즈니스 로직:
--   1. 사용자 입금 승인 → 사용자 잔고 증가 + 관리자 잔고 감소 (관리자가 사용자에게 돈을 줌)
--   2. 사용자 출금 승인 → 사용자 잔고 감소 + 관리자 잔고 증가 (사용자가 관리자에게 돈을 줌)
--   3. 관리자 강제 입출금 (기존 로직 유지)
--   4. 관리자 본인 입출금 (기존 로직 유지)
-- ============================================================================

-- ============================================
-- 1단계: 기존 트리거 삭제
-- ============================================

DROP TRIGGER IF EXISTS trigger_unified_balance_update_insert ON transactions;
DROP TRIGGER IF EXISTS trigger_unified_balance_update_update ON transactions;

-- ============================================
-- 2단계: 강화된 트리거 함수 (관리자 보유금 업데이트 추가)
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
    user_referrer_id UUID;
    transaction_amount NUMERIC;
    should_process BOOLEAN := FALSE;
BEGIN
    -- =====================================================
    -- A. 처리 여부 결정
    -- =====================================================
    
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.status IN ('approved', 'completed')) THEN
            should_process := TRUE;
            RAISE NOTICE '💰 [트리거-INSERT] 거래 생성: id=%, type=%, amount=%, status=%', 
                NEW.id, NEW.transaction_type, NEW.amount, NEW.status;
        END IF;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.status = 'pending' AND NEW.status IN ('approved', 'completed')) THEN
            should_process := TRUE;
            RAISE NOTICE '💰 [트리거-UPDATE] 승인 처리: id=%, type=%, amount=%, status: % → %', 
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
        -- 사용자 정보 및 소속 관리자 조회
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
                RAISE NOTICE '📥 [입금] 사용자: % + % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                user_new_balance := user_current_balance - transaction_amount;
                RAISE NOTICE '📤 [출금] 사용자: % - % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSIF NEW.transaction_type = 'admin_adjustment' THEN
                user_new_balance := user_current_balance + transaction_amount;
                RAISE NOTICE '⚖️ [조정] 사용자: % + % = %', user_current_balance, transaction_amount, user_new_balance;
                
            ELSE
                user_new_balance := user_current_balance;
                RAISE NOTICE '➡️ [기타] 사용자: 잔고 변경 없음';
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
    
    -- 관리자 ID 결정 우선순위:
    -- 1. NEW.partner_id (관리자가 직접 처리한 경우)
    -- 2. user_referrer_id (사용자의 소속 관리자)
    
    DECLARE
        target_partner_id UUID := NEW.partner_id;
    BEGIN
        -- partner_id가 없으면 사용자의 referrer_id 사용
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
                -- ===== 케이스 1: 사용자 일반 입출금 승인 (가장 일반적) =====
                IF (NEW.user_id IS NOT NULL AND 
                    NEW.transaction_type IN ('deposit', 'withdrawal')) THEN
                    
                    CASE NEW.transaction_type
                        WHEN 'deposit' THEN
                            -- 사용자 입금 승인: 관리자 보유금 감소 (관리자가 사용자에게 돈을 줌)
                            partner_new_balance := partner_current_balance - transaction_amount;
                            RAISE NOTICE '🔽 [사용자 입금 승인] 관리자 보유금 감소: % - % = %', 
                                partner_current_balance, transaction_amount, partner_new_balance;
                        
                        WHEN 'withdrawal' THEN
                            -- 사용자 출금 승인: 관리자 보유금 증가 (사용자가 관리자에게 돈을 줌)
                            partner_new_balance := partner_current_balance + transaction_amount;
                            RAISE NOTICE '🔼 [사용자 출금 승인] 관리자 보유금 증가: % + % = %', 
                                partner_current_balance, transaction_amount, partner_new_balance;
                        
                        ELSE
                            partner_new_balance := partner_current_balance;
                    END CASE;
                
                -- ===== 케이스 2: 관리자 강제 입출금 =====
                ELSIF (NEW.user_id IS NOT NULL AND 
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
                
                -- ===== 케이스 3: 파트너 본인 입출금 =====
                ELSIF (NEW.user_id IS NULL) THEN
                    
                    IF NEW.transaction_type IN ('deposit', 'admin_deposit') THEN
                        partner_new_balance := partner_current_balance + transaction_amount;
                        RAISE NOTICE '📥 [파트너 본인 입금] % + % = %', 
                            partner_current_balance, transaction_amount, partner_new_balance;
                            
                    ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                        partner_new_balance := partner_current_balance - transaction_amount;
                        RAISE NOTICE '📤 [파트너 본인 출금] % - % = %', 
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
                    
                    RAISE NOTICE '✅ [트리거] 관리자 보유금 업데이트 완료: partner_id=%, change=%, new_balance=%', 
                        target_partner_id, partner_new_balance - partner_current_balance, partner_new_balance;
                ELSE
                    RAISE NOTICE 'ℹ️ [트리거] 관리자 보유금 변경 없음';
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
-- 3단계: 트리거 생성 (INSERT + UPDATE)
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
    RAISE NOTICE '✅ 관리자 보유금 자동 업데이트 구현 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '적용된 기능:';
    RAISE NOTICE '  ✓ 사용자 입금 승인 → 관리자 보유금 감소 ⭐ 새로 추가';
    RAISE NOTICE '  ✓ 사용자 출금 승인 → 관리자 보유금 증가 ⭐ 새로 추가';
    RAISE NOTICE '  ✓ 관리자 강제 입출금 → 관리자 보유금 변동 (기존)';
    RAISE NOTICE '  ✓ 관리자 본인 입출금 → 관리자 보유금 변동 (기존)';
    RAISE NOTICE '';
    RAISE NOTICE '동작 방식:';
    RAISE NOTICE '  1. users.referrer_id를 통해 소속 관리자 자동 찾기';
    RAISE NOTICE '  2. 트리거가 users + partners 보유금 동시 업데이트';
    RAISE NOTICE '  3. partner_balance_logs에 변경 내역 자동 기록';
    RAISE NOTICE '  4. Realtime 이벤트 발생 → UI 즉시 갱신';
    RAISE NOTICE '';
    RAISE NOTICE '비즈니스 로직:';
    RAISE NOTICE '  • 입금 승인: 사용자↑ 관리자↓ (관리자가 사용자에게 돈을 줌)';
    RAISE NOTICE '  • 출금 승인: 사용자↓ 관리자↑ (사용자가 관리자에게 돈을 줌)';
    RAISE NOTICE '';
    RAISE NOTICE '로그 확인:';
    RAISE NOTICE '  Supabase → Logs → Postgres Logs';
    RAISE NOTICE '  검색어: "트리거" 또는 "보유금"';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;
