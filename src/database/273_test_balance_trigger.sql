-- ============================================================================
-- 273. 입출금 승인 트리거 테스트 스크립트
-- ============================================================================
-- 목적: 272번 스크립트 적용 후 트리거가 정상 작동하는지 테스트
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
        WHEN tgtype::int & 1 = 1 THEN 'ROW'
        ELSE 'STATEMENT'
    END as level,
    CASE 
        WHEN tgtype::int & 2 = 2 THEN 'BEFORE'
        WHEN tgtype::int & 64 = 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END as timing,
    CASE 
        WHEN tgtype::int & 4 = 4 THEN 'INSERT'
        WHEN tgtype::int & 8 = 8 THEN 'DELETE'
        WHEN tgtype::int & 16 = 16 THEN 'UPDATE'
        ELSE 'UNKNOWN'
    END as event
FROM pg_trigger
WHERE tgrelid = 'transactions'::regclass
  AND tgname LIKE '%balance%'
ORDER BY tgname;

-- ============================================
-- 2. 트리거 함수 확인
-- ============================================

DO $$
DECLARE
    v_function_exists BOOLEAN;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔍 트리거 함수 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    SELECT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'unified_balance_update_on_transaction'
    ) INTO v_function_exists;
    
    IF v_function_exists THEN
        RAISE NOTICE '✅ unified_balance_update_on_transaction() 함수 존재';
    ELSE
        RAISE NOTICE '❌ unified_balance_update_on_transaction() 함수 없음';
    END IF;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 3. 테스트 시나리오 1: 입금 승인 (UPDATE)
-- ============================================

DO $$
DECLARE
    v_test_user_id UUID;
    v_test_transaction_id UUID;
    v_old_balance NUMERIC;
    v_new_balance NUMERIC;
    v_amount NUMERIC := 50000;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🧪 테스트 1: 입금 승인 (UPDATE)';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- 테스트용 사용자 선택 (실제 사용자 중 첫 번째)
    SELECT id, balance INTO v_test_user_id, v_old_balance
    FROM users
    WHERE status = 'active'
    LIMIT 1;
    
    IF v_test_user_id IS NULL THEN
        RAISE NOTICE '⚠️ 테스트할 사용자가 없습니다';
        RETURN;
    END IF;
    
    RAISE NOTICE '📊 테스트 대상 사용자: user_id = %', v_test_user_id;
    RAISE NOTICE '💰 현재 잔고: %', v_old_balance;
    
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
        v_old_balance,
        v_old_balance,  -- 아직 승인 전
        NOW()
    ) RETURNING id INTO v_test_transaction_id;
    
    RAISE NOTICE '✅ pending 거래 생성: transaction_id = %', v_test_transaction_id;
    
    -- 잠시 대기 (로그 확인용)
    PERFORM pg_sleep(0.1);
    
    -- 승인 처리 (UPDATE) - 여기서 트리거 발동!
    RAISE NOTICE '';
    RAISE NOTICE '🔄 승인 처리 중... (트리거 발동 예상)';
    
    UPDATE transactions
    SET 
        status = 'completed',
        processed_at = NOW(),
        processed_by = 'test_admin'
    WHERE id = v_test_transaction_id;
    
    -- 잠시 대기 (트리거 실행 대기)
    PERFORM pg_sleep(0.2);
    
    -- 결과 확인
    SELECT balance INTO v_new_balance
    FROM users
    WHERE id = v_test_user_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 테스트 결과:';
    RAISE NOTICE '  - 이전 잔고: %', v_old_balance;
    RAISE NOTICE '  - 입금 금액: %', v_amount;
    RAISE NOTICE '  - 예상 잔고: %', v_old_balance + v_amount;
    RAISE NOTICE '  - 실제 잔고: %', v_new_balance;
    
    IF v_new_balance = v_old_balance + v_amount THEN
        RAISE NOTICE '  ✅ 성공: 잔고가 정상 업데이트되었습니다!';
    ELSE
        RAISE NOTICE '  ❌ 실패: 잔고가 업데이트되지 않았습니다!';
    END IF;
    
    -- 테스트 데이터 정리
    DELETE FROM transactions WHERE id = v_test_transaction_id;
    UPDATE users SET balance = v_old_balance WHERE id = v_test_user_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '🧹 테스트 데이터 정리 완료';
    RAISE NOTICE '';
    
END $$;

-- ============================================
-- 4. 테스트 시나리오 2: 출금 승인 (UPDATE)
-- ============================================

DO $$
DECLARE
    v_test_user_id UUID;
    v_test_transaction_id UUID;
    v_old_balance NUMERIC;
    v_new_balance NUMERIC;
    v_amount NUMERIC := 30000;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🧪 테스트 2: 출금 승인 (UPDATE)';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- 테스트용 사용자 선택 (잔고가 충분한 사용자)
    SELECT id, balance INTO v_test_user_id, v_old_balance
    FROM users
    WHERE status = 'active' AND balance >= 30000
    LIMIT 1;
    
    IF v_test_user_id IS NULL THEN
        RAISE NOTICE '⚠️ 테스트할 사용자가 없습니다 (잔고 30,000원 이상 필요)';
        RETURN;
    END IF;
    
    RAISE NOTICE '📊 테스트 대상 사용자: user_id = %', v_test_user_id;
    RAISE NOTICE '💰 현재 잔고: %', v_old_balance;
    
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
        v_old_balance,
        v_old_balance,
        NOW()
    ) RETURNING id INTO v_test_transaction_id;
    
    RAISE NOTICE '✅ pending 거래 생성: transaction_id = %', v_test_transaction_id;
    
    -- 승인 처리 (UPDATE)
    RAISE NOTICE '';
    RAISE NOTICE '🔄 승인 처리 중... (트리거 발동 예상)';
    
    UPDATE transactions
    SET 
        status = 'completed',
        processed_at = NOW(),
        processed_by = 'test_admin'
    WHERE id = v_test_transaction_id;
    
    PERFORM pg_sleep(0.2);
    
    -- 결과 확인
    SELECT balance INTO v_new_balance
    FROM users
    WHERE id = v_test_user_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 테스트 결과:';
    RAISE NOTICE '  - 이전 잔고: %', v_old_balance;
    RAISE NOTICE '  - 출금 금액: %', v_amount;
    RAISE NOTICE '  - 예상 잔고: %', v_old_balance - v_amount;
    RAISE NOTICE '  - 실제 잔고: %', v_new_balance;
    
    IF v_new_balance = v_old_balance - v_amount THEN
        RAISE NOTICE '  ✅ 성공: 잔고가 정상 업데이트되었습니다!';
    ELSE
        RAISE NOTICE '  ❌ 실패: 잔고가 업데이트되지 않았습니다!';
    END IF;
    
    -- 테스트 데이터 정리
    DELETE FROM transactions WHERE id = v_test_transaction_id;
    UPDATE users SET balance = v_old_balance WHERE id = v_test_user_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '🧹 테스트 데이터 정리 완료';
    RAISE NOTICE '';
    
END $$;

-- ============================================
-- 5. 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 트리거 테스트 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '다음 사항을 확인하세요:';
    RAISE NOTICE '1. trigger_unified_balance_update_insert 존재';
    RAISE NOTICE '2. trigger_unified_balance_update_update 존재 (⭐ 중요)';
    RAISE NOTICE '3. 테스트 1 (입금) 성공';
    RAISE NOTICE '4. 테스트 2 (출금) 성공';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ 만약 테스트가 실패했다면:';
    RAISE NOTICE '   272_fix_balance_trigger_for_update.sql을 다시 실행하세요';
    RAISE NOTICE '';
    RAISE NOTICE '✅ 모든 테스트가 성공했다면:';
    RAISE NOTICE '   이제 애플리케이션에서 입출금 승인을 테스트하세요';
    RAISE NOTICE '';
END $$;
