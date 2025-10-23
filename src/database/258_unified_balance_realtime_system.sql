-- =====================================================
-- 258. 통합 보유금 실시간 업데이트 시스템
-- =====================================================
-- 목적: transaction 변경 → users/partners balance 자동 업데이트
-- 방식: 이벤트 발생 업데이트 (Realtime subscription 활용)
-- Guidelines: RPC 사용 금지, API 응답 직접 파싱, Heartbeat 최소화
-- =====================================================

-- =====================================================
-- 1. 기존 트리거/함수 정리
-- =====================================================

DROP TRIGGER IF EXISTS trigger_unified_balance_update ON transactions;
DROP TRIGGER IF EXISTS trigger_update_user_balance_on_transaction ON transactions;
DROP TRIGGER IF EXISTS trigger_update_partner_balance_on_transaction ON transactions;
DROP TRIGGER IF EXISTS trigger_update_balance_on_transaction ON transactions;
DROP TRIGGER IF EXISTS trg_update_partner_balance ON transactions;

DROP FUNCTION IF EXISTS unified_balance_update_on_transaction() CASCADE;
DROP FUNCTION IF EXISTS update_user_balance_on_transaction() CASCADE;
DROP FUNCTION IF EXISTS update_partner_balance_on_transaction() CASCADE;
DROP FUNCTION IF EXISTS update_balance_on_transaction() CASCADE;
DROP FUNCTION IF EXISTS update_partner_balance_from_transaction() CASCADE;

-- =====================================================
-- 2. 통합 트리거 함수: transactions → users/partners balance 자동 업데이트
-- =====================================================

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
BEGIN
    -- INSERT 이벤트만 처리 (UPDATE는 무한루프 방지)
    IF (TG_OP != 'INSERT') THEN
        RETURN NEW;
    END IF;
    
    -- approved 또는 completed 상태만 처리
    IF (NEW.status NOT IN ('approved', 'completed')) THEN
        RETURN NEW;
    END IF;
    
    transaction_amount := NEW.amount;
    
    -- =====================================================
    -- A. 사용자(users) 보유금 업데이트
    -- =====================================================
    
    IF (NEW.user_id IS NOT NULL) THEN
        -- 현재 사용자 보유금 조회
        SELECT balance INTO user_current_balance
        FROM users
        WHERE id = NEW.user_id;
        
        IF user_current_balance IS NULL THEN
            RAISE WARNING '[트리거] 사용자를 찾을 수 없음: %', NEW.user_id;
        ELSE
            -- 거래 유형에 따라 보유금 계산
            IF NEW.transaction_type IN ('deposit', 'admin_deposit') THEN
                -- 입금: 보유금 증가
                user_new_balance := user_current_balance + transaction_amount;
            ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                -- 출금: 보유금 감소
                user_new_balance := user_current_balance - transaction_amount;
            ELSIF NEW.transaction_type = 'admin_adjustment' THEN
                -- 조정: amount의 부호에 따라
                user_new_balance := user_current_balance + transaction_amount;
            ELSE
                -- 기타: 변경 없음
                user_new_balance := user_current_balance;
            END IF;
            
            -- users 테이블 업데이트 (Realtime 이벤트 발생!)
            UPDATE users
            SET 
                balance = user_new_balance,
                updated_at = NOW()
            WHERE id = NEW.user_id;
            
            -- 거래 기록에 balance_before, balance_after 기록 (값이 없을 때만)
            IF (NEW.balance_before IS NULL) THEN
                NEW.balance_before := user_current_balance;
            END IF;
            IF (NEW.balance_after IS NULL) THEN
                NEW.balance_after := user_new_balance;
            END IF;
            
            RAISE NOTICE '✅ [트리거] 사용자 보유금 업데이트: % → % (user_id: %, type: %, amount: %)', 
                user_current_balance, user_new_balance, NEW.user_id, NEW.transaction_type, transaction_amount;
        END IF;
    END IF;
    
    -- =====================================================
    -- B. 관리자(partners) 보유금 업데이트
    -- =====================================================
    -- 케이스 1: admin_deposit, admin_withdrawal (사용자가 있고, 관리자가 처리)
    --           → 관리자 보유금은 반대로 변경
    -- 케이스 2: 파트너 본인 입출금 (user_id 없음, partner_id만 있음)
    --           → 파트너 보유금 직접 변경
    
    IF (NEW.partner_id IS NOT NULL) THEN
        -- 현재 관리자 보유금 조회
        SELECT balance INTO partner_current_balance
        FROM partners
        WHERE id = NEW.partner_id;
        
        IF partner_current_balance IS NULL THEN
            RAISE WARNING '[트리거] 관리자를 찾을 수 없음: %', NEW.partner_id;
        ELSE
            -- ===== 케이스 1: 관리자 강제 입출금 (user_id 있음) =====
            IF (NEW.user_id IS NOT NULL AND 
                NEW.transaction_type IN ('admin_deposit', 'admin_withdrawal')) THEN
                
                CASE NEW.transaction_type
                    -- 관리자가 사용자에게 입금: 관리자 보유금 감소
                    WHEN 'admin_deposit' THEN
                        partner_new_balance := partner_current_balance - transaction_amount;
                    
                    -- 관리자가 사용자로부터 출금: 관리자 보유금 증가
                    WHEN 'admin_withdrawal' THEN
                        partner_new_balance := partner_current_balance + transaction_amount;
                    
                    ELSE
                        partner_new_balance := partner_current_balance;
                END CASE;
                
                RAISE NOTICE '✅ [트리거] 관리자 강제 입출금 처리: % → % (type: %)', 
                    partner_current_balance, partner_new_balance, NEW.transaction_type;
                
            -- ===== 케이스 2: 파트너 본인 입출금 (user_id 없음) =====
            ELSIF (NEW.user_id IS NULL) THEN
                
                IF NEW.transaction_type IN ('deposit', 'admin_deposit') THEN
                    -- 입금: 보유금 증가
                    partner_new_balance := partner_current_balance + transaction_amount;
                ELSIF NEW.transaction_type IN ('withdrawal', 'admin_withdrawal') THEN
                    -- 출금: 보유금 감소
                    partner_new_balance := partner_current_balance - transaction_amount;
                ELSIF NEW.transaction_type = 'admin_adjustment' THEN
                    -- 조정: amount의 부호에 따라
                    partner_new_balance := partner_current_balance + transaction_amount;
                ELSE
                    partner_new_balance := partner_current_balance;
                END IF;
                
                RAISE NOTICE '✅ [트리거] 파트너 본인 입출금 처리: % → % (type: %)', 
                    partner_current_balance, partner_new_balance, NEW.transaction_type;
            ELSE
                -- 관리자 보유금 변경 없음
                partner_new_balance := partner_current_balance;
            END IF;
            
            -- partners 테이블 업데이트 (Realtime 이벤트 발생!)
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
                
                RAISE NOTICE '✅ [트리거] 관리자 보유금 업데이트 완료: partner_id: %, change: %', 
                    NEW.partner_id, partner_new_balance - partner_current_balance;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- =====================================================
-- 3. 트리거 생성: transactions 테이블 INSERT 시 실행
-- =====================================================

CREATE TRIGGER trigger_unified_balance_update
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN (NEW.status IN ('approved', 'completed'))
    EXECUTE FUNCTION unified_balance_update_on_transaction();

-- =====================================================
-- 4. 인덱스 최적화 (성능 향상)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user_id_status ON transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_partner_id_status ON transactions(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON transactions(transaction_type, status);

-- =====================================================
-- 258. 통합 보유금 실시간 업데이트 시스템 설치 완료
-- =====================================================
-- 시스템 동작:
--   1. transactions INSERT -> 트리거 자동 실행
--   2. users/partners balance 자동 업데이트
--   3. Realtime subscription 감지 -> UI 즉시 반영
-- =====================================================
