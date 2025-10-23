-- =====================================================
-- 최종 완벽 수정: 모든 구 컬럼 삭제 + 트리거 정리
-- =====================================================

-- =====================================================
-- 1단계: 구 컬럼 완전 삭제
-- =====================================================

-- 구 컬럼들 삭제 (301번에서 누락된 것들)
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS change_type CASCADE;
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS description CASCADE;
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS old_balance CASCADE;
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS new_balance CASCADE;
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS change_amount CASCADE;

-- =====================================================
-- 2단계: 모든 트리거 제거
-- =====================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT t.tgname
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = 'transactions'
        AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON transactions CASCADE', r.tgname);
        RAISE NOTICE '트리거 제거: %', r.tgname;
    END LOOP;
END $$;

-- =====================================================
-- 3단계: 모든 관련 함수 제거
-- =====================================================

DROP FUNCTION IF EXISTS enforce_head_office_balance_limit() CASCADE;
DROP FUNCTION IF EXISTS unified_balance_update_handler() CASCADE;
DROP FUNCTION IF EXISTS handle_balance_update() CASCADE;
DROP FUNCTION IF EXISTS update_partner_balance_from_user_transaction() CASCADE;
DROP FUNCTION IF EXISTS fn_update_partner_balance_on_approval() CASCADE;

-- =====================================================
-- 4단계: log_partner_balance_change 함수 재생성
-- =====================================================

DROP FUNCTION IF EXISTS log_partner_balance_change() CASCADE;
CREATE OR REPLACE FUNCTION log_partner_balance_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.balance IS DISTINCT FROM NEW.balance THEN
        INSERT INTO partner_balance_logs (
            partner_id,
            transaction_type,
            amount,
            balance_before,
            balance_after,
            processed_by,
            memo
        ) VALUES (
            NEW.id,
            'admin_adjustment',
            NEW.balance - OLD.balance,
            OLD.balance,
            NEW.balance,
            auth.uid(),
            CASE 
                WHEN NEW.balance > OLD.balance THEN '보유금 증가'
                ELSE '보유금 감소'
            END
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5단계: enforce_head_office_balance_limit 함수 생성
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
    IF TG_OP != 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF NEW.status NOT IN ('approved', 'completed') THEN
        RETURN NEW;
    END IF;

    IF NEW.partner_id IS NOT NULL THEN
        target_partner_id := NEW.partner_id;
    ELSIF NEW.user_id IS NOT NULL THEN
        SELECT referrer_id INTO target_partner_id
        FROM users WHERE id = NEW.user_id;
    END IF;

    IF target_partner_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT id, partner_type, balance
    INTO partner_info
    FROM partners
    WHERE id = target_partner_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    transaction_amount := COALESCE(NEW.amount, 0);
    is_deposit := NEW.transaction_type IN ('deposit', 'admin_deposit');
    partner_current_balance := COALESCE(partner_info.balance, 0);

    IF is_deposit THEN
        partner_new_balance := partner_current_balance - transaction_amount;
    ELSE
        partner_new_balance := partner_current_balance + transaction_amount;
    END IF;

    IF partner_info.partner_type = 'head_office' THEN
        IF is_deposit AND partner_new_balance < 0 THEN
            RAISE EXCEPTION '대본사 보유금 부족: 현재=%, 필요=%', 
                partner_current_balance, transaction_amount;
        END IF;
    END IF;

    IF partner_new_balance != partner_current_balance THEN
        UPDATE partners
        SET balance = partner_new_balance, updated_at = NOW()
        WHERE id = target_partner_id;
        
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
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[트리거] %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 6단계: 트리거 생성
-- =====================================================

DROP TRIGGER IF EXISTS trigger_log_partner_balance ON partners;
CREATE TRIGGER trigger_log_partner_balance
    AFTER UPDATE OF balance ON partners
    FOR EACH ROW
    WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
    EXECUTE FUNCTION log_partner_balance_change();

DROP TRIGGER IF EXISTS enforce_head_office_balance_trigger ON transactions;
CREATE TRIGGER enforce_head_office_balance_trigger
    AFTER INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION enforce_head_office_balance_limit();

-- =====================================================
-- 7단계: 검증
-- =====================================================

DO $$
DECLARE
    has_change_type BOOLEAN;
    has_description BOOLEAN;
    has_old_balance BOOLEAN;
    has_new_balance BOOLEAN;
    has_change_amount BOOLEAN;
    trigger_count INTEGER;
BEGIN
    -- 구 컬럼 존재 여부 확인
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'partner_balance_logs' AND column_name = 'change_type'
    ) INTO has_change_type;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'partner_balance_logs' AND column_name = 'description'
    ) INTO has_description;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'partner_balance_logs' AND column_name = 'old_balance'
    ) INTO has_old_balance;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'partner_balance_logs' AND column_name = 'new_balance'
    ) INTO has_new_balance;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'partner_balance_logs' AND column_name = 'change_amount'
    ) INTO has_change_amount;
    
    SELECT COUNT(*) INTO trigger_count
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'transactions'
    AND NOT t.tgisinternal;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 최종 완벽 수정 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '구 컬럼 삭제 확인:';
    RAISE NOTICE '  change_type: % (FALSE여야 함)', has_change_type;
    RAISE NOTICE '  description: % (FALSE여야 함)', has_description;
    RAISE NOTICE '  old_balance: % (FALSE여야 함)', has_old_balance;
    RAISE NOTICE '  new_balance: % (FALSE여야 함)', has_new_balance;
    RAISE NOTICE '  change_amount: % (FALSE여야 함)', has_change_amount;
    RAISE NOTICE '';
    RAISE NOTICE 'transactions 트리거 수: % (1이어야 함)', trigger_count;
    RAISE NOTICE '';
    
    IF has_change_type OR has_description OR has_old_balance OR has_new_balance OR has_change_amount THEN
        RAISE WARNING '⚠️ 구 컬럼이 아직 남아있습니다!';
    ELSE
        RAISE NOTICE '✅ 모든 구 컬럼 삭제 완료';
    END IF;
    
    RAISE NOTICE '========================================';
END $$;

-- 컬럼 목록 출력
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'partner_balance_logs'
ORDER BY ordinal_position;
