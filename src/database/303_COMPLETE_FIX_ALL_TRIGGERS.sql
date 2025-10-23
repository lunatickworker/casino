-- =====================================================
-- 완벽한 트리거 수정: 모든 change_type/description 제거
-- =====================================================

-- =====================================================
-- 1. 기존 트리거 및 함수 완전 제거
-- =====================================================

-- 모든 transactions 테이블 관련 트리거 제거
DROP TRIGGER IF EXISTS enforce_head_office_balance_trigger ON transactions;
DROP TRIGGER IF EXISTS unified_balance_update_on_transaction ON transactions;
DROP TRIGGER IF EXISTS balance_update_on_transaction_insert ON transactions;
DROP TRIGGER IF EXISTS update_partner_balance_on_user_transaction ON transactions;
DROP TRIGGER IF EXISTS trigger_update_partner_balance_on_approval ON transactions;
DROP TRIGGER IF EXISTS sync_balance_after_transaction ON transactions;

-- 모든 함수 제거
DROP FUNCTION IF EXISTS enforce_head_office_balance_limit() CASCADE;
DROP FUNCTION IF EXISTS unified_balance_update_handler() CASCADE;
DROP FUNCTION IF EXISTS handle_balance_update() CASCADE;
DROP FUNCTION IF EXISTS update_partner_balance_from_user_transaction() CASCADE;
DROP FUNCTION IF EXISTS fn_update_partner_balance_on_approval() CASCADE;

-- =====================================================
-- 2. 새로운 트리거 함수 생성 (올바른 컬럼명 사용)
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
    -- INSERT 작업만 처리
    IF TG_OP != 'INSERT' THEN
        RETURN NEW;
    END IF;

    -- 승인된 거래만 처리 (approved, completed)
    IF NEW.status NOT IN ('approved', 'completed') THEN
        RETURN NEW;
    END IF;

    -- 🎯 핵심 로직: partner_id 결정
    IF NEW.partner_id IS NOT NULL THEN
        target_partner_id := NEW.partner_id;
    ELSIF NEW.user_id IS NOT NULL THEN
        -- user_id가 있으면 해당 사용자의 referrer_id 사용
        SELECT referrer_id INTO target_partner_id
        FROM users
        WHERE id = NEW.user_id;
    END IF;

    -- target_partner_id가 있을 때만 처리
    IF target_partner_id IS NOT NULL THEN
        -- 파트너 정보 조회
        SELECT id, partner_type, balance
        INTO partner_info
        FROM partners
        WHERE id = target_partner_id;

        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        -- 거래 유형에 따른 보유금 변경 계산
        transaction_amount := COALESCE(NEW.amount, 0);
        
        -- 입금/출금 판단
        is_deposit := NEW.transaction_type IN ('deposit', 'admin_deposit');

        partner_current_balance := COALESCE(partner_info.balance, 0);

        -- 보유금 변경 계산
        IF is_deposit THEN
            -- 입금: 관리자 보유금 감소 (사용자에게 지급)
            partner_new_balance := partner_current_balance - transaction_amount;
        ELSE
            -- 출금: 관리자 보유금 증가 (사용자로부터 회수)
            partner_new_balance := partner_current_balance + transaction_amount;
        END IF;

        -- 🔴 대본사 보유금 검증
        IF partner_info.partner_type = 'head_office' THEN
            IF is_deposit AND partner_new_balance < 0 THEN
                RAISE EXCEPTION '❌ 대본사 보유금 부족: 현재=%, 필요=%, 부족=-%', 
                    partner_current_balance, transaction_amount, ABS(partner_new_balance);
            END IF;
        END IF;

        -- 📊 관리자 보유금 업데이트
        IF partner_new_balance IS NOT NULL AND partner_new_balance != partner_current_balance THEN
            UPDATE partners
            SET 
                balance = partner_new_balance,
                updated_at = NOW()
            WHERE id = target_partner_id;
            
            -- ✅ 올바른 컬럼명 사용: transaction_type, memo, balance_before, balance_after, amount
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
        END IF;
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
-- 3. 트리거 생성
-- =====================================================

CREATE TRIGGER enforce_head_office_balance_trigger
    AFTER INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION enforce_head_office_balance_limit();

-- =====================================================
-- 4. 검증 쿼리
-- =====================================================

-- 현재 활성화된 트리거 확인
DO $$
DECLARE
    trigger_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO trigger_count
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'transactions'
    AND NOT t.tgisinternal;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 트리거 수정 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'transactions 테이블 활성 트리거 수: %', trigger_count;
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '  ❌ 삭제된 컬럼: change_type, description, old_balance, new_balance, change_amount';
    RAISE NOTICE '  ✅ 새로운 컬럼: transaction_type, memo, balance_before, balance_after, amount';
    RAISE NOTICE '';
    RAISE NOTICE '활성화된 트리거:';
    RAISE NOTICE '  - enforce_head_office_balance_trigger';
    RAISE NOTICE '';
    RAISE NOTICE '제거된 트리거:';
    RAISE NOTICE '  - unified_balance_update_on_transaction';
    RAISE NOTICE '  - balance_update_on_transaction_insert';
    RAISE NOTICE '  - update_partner_balance_on_user_transaction';
    RAISE NOTICE '  - trigger_update_partner_balance_on_approval';
    RAISE NOTICE '========================================';
END $$;

-- 트리거 함수 정의 확인
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname = 'enforce_head_office_balance_limit';

-- partner_balance_logs 테이블 구조 확인
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'partner_balance_logs'
    AND column_name IN ('change_type', 'description', 'transaction_type', 'memo', 'balance_before', 'balance_after', 'amount')
ORDER BY 
    CASE column_name
        WHEN 'transaction_type' THEN 1
        WHEN 'memo' THEN 2
        WHEN 'balance_before' THEN 3
        WHEN 'balance_after' THEN 4
        WHEN 'amount' THEN 5
        WHEN 'change_type' THEN 6
        WHEN 'description' THEN 7
    END;
