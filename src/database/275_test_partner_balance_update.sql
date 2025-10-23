-- ============================================================================
-- 275. 관리자 보유금 자동 업데이트 테스트
-- ============================================================================
-- 목적: 사용자 입출금 승인 시 관리자 보유금이 정상적으로 업데이트되는지 테스트
-- ============================================================================

-- ============================================
-- 1. 트리거 존재 확인
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔍 트리거 존재 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;

SELECT 
    tgname as trigger_name,
    tgenabled as enabled,
    CASE 
        WHEN tgtype::int & 4 = 4 THEN 'INSERT'
        WHEN tgtype::int & 16 = 16 THEN 'UPDATE'
        ELSE 'OTHER'
    END as event
FROM pg_trigger
WHERE tgrelid = 'transactions'::regclass
  AND tgname LIKE '%balance%'
ORDER BY tgname;

-- ============================================
-- 2. 테스트용 데이터 준비 확인
-- ============================================

DO $$
DECLARE
    v_user_count INT;
    v_partner_count INT;
    v_user_with_partner_count INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔍 테스트 데이터 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- 사용자 수 확인
    SELECT COUNT(*) INTO v_user_count
    FROM users
    WHERE status = 'active';
    
    -- 파트너 수 확인
    SELECT COUNT(*) INTO v_partner_count
    FROM partners
    WHERE status = 'active';
    
    -- referrer_id가 있는 사용자 수
    SELECT COUNT(*) INTO v_user_with_partner_count
    FROM users
    WHERE status = 'active' AND referrer_id IS NOT NULL;
    
    RAISE NOTICE '활성 사용자: %명', v_user_count;
    RAISE NOTICE '활성 파트너: %명', v_partner_count;
    RAISE NOTICE '소속 파트너가 있는 사용자: %명', v_user_with_partner_count;
    RAISE NOTICE '';
    
    IF v_user_with_partner_count = 0 THEN
        RAISE WARNING '⚠️ referrer_id가 있는 사용자가 없습니다. 테스트를 위해 사용자에게 referrer_id를 설정하세요.';
    END IF;
    
END $$;

-- ============================================
-- 3. 테스트 1: 사용자 입금 승인 (관리자 보유금 감소)
-- ============================================

DO $$
DECLARE
    v_test_user_id UUID;
    v_test_partner_id UUID;
    v_test_transaction_id UUID;
    v_user_old_balance NUMERIC;
    v_user_new_balance NUMERIC;
    v_partner_old_balance NUMERIC;
    v_partner_new_balance NUMERIC;
    v_amount NUMERIC := 100000;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🧪 테스트 1: 사용자 입금 승인 (관리자 보유금 감소)';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- referrer_id가 있는 사용자 선택
    SELECT u.id, u.balance, u.referrer_id, p.balance
    INTO v_test_user_id, v_user_old_balance, v_test_partner_id, v_partner_old_balance
    FROM users u
    JOIN partners p ON u.referrer_id = p.id
    WHERE u.status = 'active' AND u.referrer_id IS NOT NULL
    LIMIT 1;
    
    IF v_test_user_id IS NULL THEN
        RAISE NOTICE '⚠️ referrer_id가 있는 사용자가 없어 테스트를 건너뜁니다.';
        RETURN;
    END IF;
    
    RAISE NOTICE '📊 테스트 대상:';
    RAISE NOTICE '  - 사용자 ID: %', v_test_user_id;
    RAISE NOTICE '  - 사용자 현재 잔고: %', v_user_old_balance;
    RAISE NOTICE '  - 관리자 ID: %', v_test_partner_id;
    RAISE NOTICE '  - 관리자 현재 잔고: %', v_partner_old_balance;
    RAISE NOTICE '';
    
    -- pending 상태로 입금 거래 생성
    INSERT INTO transactions (
        user_id,
        transaction_type,
        amount,
        status,
        balance_before,
        balance_after,
        request_time
    ) VALUES (
        v_test_user_id,
        'deposit',
        v_amount,
        'pending',
        v_user_old_balance,
        v_user_old_balance,
        NOW()
    ) RETURNING id INTO v_test_transaction_id;
    
    RAISE NOTICE '✅ pending 거래 생성: transaction_id = %', v_test_transaction_id;
    RAISE NOTICE '';
    
    -- 승인 처리 (트리거 발동!)
    RAISE NOTICE '🔄 승인 처리 중... (트리거 발동 예상)';
    
    UPDATE transactions
    SET 
        status = 'completed',
        processed_at = NOW(),
        processed_by = 'test_admin'
    WHERE id = v_test_transaction_id;
    
    PERFORM pg_sleep(0.2);
    
    -- 결과 확인
    SELECT balance INTO v_user_new_balance FROM users WHERE id = v_test_user_id;
    SELECT balance INTO v_partner_new_balance FROM partners WHERE id = v_test_partner_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 테스트 결과:';
    RAISE NOTICE '  사용자 잔고:';
    RAISE NOTICE '    - 이전: %', v_user_old_balance;
    RAISE NOTICE '    - 예상: %', v_user_old_balance + v_amount;
    RAISE NOTICE '    - 실제: %', v_user_new_balance;
    RAISE NOTICE '  관리자 잔고:';
    RAISE NOTICE '    - 이전: %', v_partner_old_balance;
    RAISE NOTICE '    - 예상: %', v_partner_old_balance - v_amount;
    RAISE NOTICE '    - 실제: %', v_partner_new_balance;
    RAISE NOTICE '';
    
    IF v_user_new_balance = v_user_old_balance + v_amount AND
       v_partner_new_balance = v_partner_old_balance - v_amount THEN
        RAISE NOTICE '  ✅ 성공: 사용자 잔고 증가, 관리자 잔고 감소!';
    ELSE
        RAISE NOTICE '  ❌ 실패: 잔고가 예상대로 업데이트되지 않았습니다!';
    END IF;
    
    -- 테스트 데이터 정리
    DELETE FROM transactions WHERE id = v_test_transaction_id;
    UPDATE users SET balance = v_user_old_balance WHERE id = v_test_user_id;
    UPDATE partners SET balance = v_partner_old_balance WHERE id = v_test_partner_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '🧹 테스트 데이터 정리 완료';
    RAISE NOTICE '';
    
END $$;

-- ============================================
-- 4. 테스트 2: 사용자 출금 승인 (관리자 보유금 증가)
-- ============================================

DO $$
DECLARE
    v_test_user_id UUID;
    v_test_partner_id UUID;
    v_test_transaction_id UUID;
    v_user_old_balance NUMERIC;
    v_user_new_balance NUMERIC;
    v_partner_old_balance NUMERIC;
    v_partner_new_balance NUMERIC;
    v_amount NUMERIC := 50000;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🧪 테스트 2: 사용자 출금 승인 (관리자 보유금 증가)';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- 잔고가 충분한 사용자 선택
    SELECT u.id, u.balance, u.referrer_id, p.balance
    INTO v_test_user_id, v_user_old_balance, v_test_partner_id, v_partner_old_balance
    FROM users u
    JOIN partners p ON u.referrer_id = p.id
    WHERE u.status = 'active' AND u.referrer_id IS NOT NULL AND u.balance >= 50000
    LIMIT 1;
    
    IF v_test_user_id IS NULL THEN
        RAISE NOTICE '⚠️ 조건에 맞는 사용자가 없어 테스트를 건너뜁니다.';
        RETURN;
    END IF;
    
    RAISE NOTICE '📊 테스트 대상:';
    RAISE NOTICE '  - 사용자 ID: %', v_test_user_id;
    RAISE NOTICE '  - 사용자 현재 잔고: %', v_user_old_balance;
    RAISE NOTICE '  - 관리자 ID: %', v_test_partner_id;
    RAISE NOTICE '  - 관리자 현재 잔고: %', v_partner_old_balance;
    RAISE NOTICE '';
    
    -- pending 상태로 출금 거래 생성
    INSERT INTO transactions (
        user_id,
        transaction_type,
        amount,
        status,
        balance_before,
        balance_after,
        request_time
    ) VALUES (
        v_test_user_id,
        'withdrawal',
        v_amount,
        'pending',
        v_user_old_balance,
        v_user_old_balance,
        NOW()
    ) RETURNING id INTO v_test_transaction_id;
    
    RAISE NOTICE '✅ pending 거래 생성: transaction_id = %', v_test_transaction_id;
    RAISE NOTICE '';
    
    -- 승인 처리
    RAISE NOTICE '🔄 승인 처리 중... (트리거 발동 예상)';
    
    UPDATE transactions
    SET 
        status = 'completed',
        processed_at = NOW(),
        processed_by = 'test_admin'
    WHERE id = v_test_transaction_id;
    
    PERFORM pg_sleep(0.2);
    
    -- 결과 확인
    SELECT balance INTO v_user_new_balance FROM users WHERE id = v_test_user_id;
    SELECT balance INTO v_partner_new_balance FROM partners WHERE id = v_test_partner_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 테스트 결과:';
    RAISE NOTICE '  사용자 잔고:';
    RAISE NOTICE '    - 이전: %', v_user_old_balance;
    RAISE NOTICE '    - 예상: %', v_user_old_balance - v_amount;
    RAISE NOTICE '    - 실제: %', v_user_new_balance;
    RAISE NOTICE '  관리자 잔고:';
    RAISE NOTICE '    - 이전: %', v_partner_old_balance;
    RAISE NOTICE '    - 예상: %', v_partner_old_balance + v_amount;
    RAISE NOTICE '    - 실제: %', v_partner_new_balance;
    RAISE NOTICE '';
    
    IF v_user_new_balance = v_user_old_balance - v_amount AND
       v_partner_new_balance = v_partner_old_balance + v_amount THEN
        RAISE NOTICE '  ✅ 성공: 사용자 잔고 감소, 관리자 잔고 증가!';
    ELSE
        RAISE NOTICE '  ❌ 실패: 잔고가 예상대로 업데이트되지 않았습니다!';
    END IF;
    
    -- 테스트 데이터 정리
    DELETE FROM transactions WHERE id = v_test_transaction_id;
    UPDATE users SET balance = v_user_old_balance WHERE id = v_test_user_id;
    UPDATE partners SET balance = v_partner_old_balance WHERE id = v_test_partner_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '🧹 테스트 데이터 정리 완료';
    RAISE NOTICE '';
    
END $$;

-- ============================================
-- 5. partner_balance_logs 확인
-- ============================================

DO $$
DECLARE
    v_log_count INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔍 관리자 보유금 변경 로그 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    SELECT COUNT(*) INTO v_log_count
    FROM partner_balance_logs
    WHERE created_at > NOW() - INTERVAL '1 hour';
    
    RAISE NOTICE '최근 1시간 내 로그: %건', v_log_count;
    RAISE NOTICE '';
    
    -- 최근 로그 5개 출력
    RAISE NOTICE '최근 로그 (최대 5개):';
    RAISE NOTICE '';
    
    FOR rec IN 
        SELECT 
            partner_id,
            old_balance,
            new_balance,
            change_amount,
            change_type,
            description,
            created_at
        FROM partner_balance_logs
        ORDER BY created_at DESC
        LIMIT 5
    LOOP
        RAISE NOTICE '  • %', rec.description;
        RAISE NOTICE '    변경: % → % (차이: %)', rec.old_balance, rec.new_balance, rec.change_amount;
        RAISE NOTICE '    타입: %, 시간: %', rec.change_type, rec.created_at;
        RAISE NOTICE '';
    END LOOP;
    
END $$;

-- ============================================
-- 6. 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 관리자 보유금 업데이트 테스트 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '확인 사항:';
    RAISE NOTICE '1. 트리거 2개 존재 (INSERT, UPDATE)';
    RAISE NOTICE '2. 테스트 1 성공 (입금 승인: 사용자↑ 관리자↓)';
    RAISE NOTICE '3. 테스트 2 성공 (출금 승인: 사용자↓ 관리자↑)';
    RAISE NOTICE '4. partner_balance_logs에 기록됨';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ 만약 테스트가 실패했다면:';
    RAISE NOTICE '   1. 274_partner_balance_on_user_approval.sql 다시 실행';
    RAISE NOTICE '   2. users 테이블의 referrer_id 확인';
    RAISE NOTICE '   3. Postgres Logs에서 "트리거" 검색';
    RAISE NOTICE '';
    RAISE NOTICE '✅ 모든 테스트가 성공했다면:';
    RAISE NOTICE '   이제 실제 애플리케이션에서 입출금 승인 테스트';
    RAISE NOTICE '';
END $$;
