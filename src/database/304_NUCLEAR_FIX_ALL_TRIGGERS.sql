-- =====================================================
-- 완전한 트리거 제거 및 재생성
-- =====================================================
-- change_type 사용하는 모든 것을 찾아서 제거

-- =====================================================
-- 1단계: 모든 transactions 관련 트리거 제거
-- =====================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- transactions 테이블의 모든 트리거 제거
    FOR r IN 
        SELECT t.tgname
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = 'transactions'
        AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON transactions CASCADE', r.tgname);
        RAISE NOTICE '제거: 트리거 %', r.tgname;
    END LOOP;
END $$;

-- =====================================================
-- 2단계: 모든 관련 함수 제거
-- =====================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- balance, transaction 관련 모든 함수 제거
    FOR r IN 
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND (
            p.proname LIKE '%balance%'
            OR p.proname LIKE '%transaction%'
            OR p.proname LIKE '%partner%'
        )
        AND p.proname NOT IN (
            'transfer_partner_balance',
            'log_partner_balance_change'
        )
    LOOP
        BEGIN
            EXECUTE format('DROP FUNCTION IF EXISTS %I(%s) CASCADE', r.proname, r.args);
            RAISE NOTICE '제거: 함수 %(%)', r.proname, r.args;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '제거 실패 (무시): %', r.proname;
        END;
    END LOOP;
END $$;

-- =====================================================
-- 3단계: 핵심 함수 재생성
-- =====================================================

-- log_partner_balance_change 함수도 안전하게 재생성
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
-- 4단계: 새로운 트리거 함수 생성
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
    -- INSERT만 처리
    IF TG_OP != 'INSERT' THEN
        RETURN NEW;
    END IF;

    -- 승인된 거래만 처리
    IF NEW.status NOT IN ('approved', 'completed') THEN
        RETURN NEW;
    END IF;

    -- partner_id 결정
    IF NEW.partner_id IS NOT NULL THEN
        target_partner_id := NEW.partner_id;
    ELSIF NEW.user_id IS NOT NULL THEN
        SELECT referrer_id INTO target_partner_id
        FROM users WHERE id = NEW.user_id;
    END IF;

    IF target_partner_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- 파트너 정보 조회
    SELECT id, partner_type, balance
    INTO partner_info
    FROM partners
    WHERE id = target_partner_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- 금액 계산
    transaction_amount := COALESCE(NEW.amount, 0);
    is_deposit := NEW.transaction_type IN ('deposit', 'admin_deposit');
    partner_current_balance := COALESCE(partner_info.balance, 0);

    IF is_deposit THEN
        partner_new_balance := partner_current_balance - transaction_amount;
    ELSE
        partner_new_balance := partner_current_balance + transaction_amount;
    END IF;

    -- 대본사 보유금 검증
    IF partner_info.partner_type = 'head_office' THEN
        IF is_deposit AND partner_new_balance < 0 THEN
            RAISE EXCEPTION '대본사 보유금 부족: 현재=%, 필요=%', 
                partner_current_balance, transaction_amount;
        END IF;
    END IF;

    -- 파트너 보유금 업데이트
    IF partner_new_balance != partner_current_balance THEN
        UPDATE partners
        SET balance = partner_new_balance, updated_at = NOW()
        WHERE id = target_partner_id;
        
        -- ✅ 올바른 컬럼명으로 로그 기록
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
        RAISE WARNING '[트리거 오류] %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5단계: 트리거 생성
-- =====================================================

-- partners 테이블 트리거
DROP TRIGGER IF EXISTS trigger_log_partner_balance ON partners;
CREATE TRIGGER trigger_log_partner_balance
    AFTER UPDATE OF balance ON partners
    FOR EACH ROW
    WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
    EXECUTE FUNCTION log_partner_balance_change();

-- transactions 테이블 트리거
DROP TRIGGER IF EXISTS enforce_head_office_balance_trigger ON transactions;
CREATE TRIGGER enforce_head_office_balance_trigger
    AFTER INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION enforce_head_office_balance_limit();

-- =====================================================
-- 6단계: 검증
-- =====================================================

DO $$
DECLARE
    trigger_count INTEGER;
    function_count INTEGER;
    column_exists BOOLEAN;
BEGIN
    -- 트리거 개수 확인
    SELECT COUNT(*) INTO trigger_count
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'transactions'
    AND NOT t.tgisinternal;
    
    -- 함수 개수 확인
    SELECT COUNT(*) INTO function_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname IN ('enforce_head_office_balance_limit', 'log_partner_balance_change');
    
    -- change_type 컬럼 존재 여부 확인
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns
        WHERE table_name = 'partner_balance_logs'
        AND column_name = 'change_type'
    ) INTO column_exists;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 완전한 트리거 수정 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'transactions 테이블 트리거 수: %', trigger_count;
    RAISE NOTICE '활성 함수 수: %', function_count;
    RAISE NOTICE 'change_type 컬럼 존재: %', column_exists;
    RAISE NOTICE '';
    
    IF column_exists THEN
        RAISE WARNING '⚠️ change_type 컬럼이 아직 존재합니다. 301번 파일을 먼저 실행하세요.';
    ELSE
        RAISE NOTICE '✅ change_type 컬럼 없음 (정상)';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '활성 트리거:';
    RAISE NOTICE '  - trigger_log_partner_balance (partners 테이블)';
    RAISE NOTICE '  - enforce_head_office_balance_trigger (transactions 테이블)';
    RAISE NOTICE '========================================';
END $$;

-- 모든 트리거 목록 출력
SELECT 
    c.relname as table_name,
    t.tgname as trigger_name,
    p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname IN ('transactions', 'partners')
AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
