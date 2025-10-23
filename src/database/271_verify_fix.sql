-- ============================================================================
-- 271. RLS 수정 검증 스크립트
-- ============================================================================
-- 목적: 270번 스크립트 실행 후 정상 동작 확인
-- ============================================================================

-- ============================================
-- 1. RLS 상태 확인
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔍 RLS 상태 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;

SELECT 
    tablename,
    CASE 
        WHEN rowsecurity THEN '🔒 ENABLED (문제 있음!)'
        ELSE '🔓 DISABLED (정상)'
    END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 
    'transactions', 
    'partners',
    'activity_logs',
    'user_sessions',
    'game_records',
    'messages',
    'message_queue',
    'partner_balance_logs'
  )
ORDER BY tablename;

-- ============================================
-- 2. 정책 존재 여부 확인
-- ============================================

DO $$
DECLARE
    v_policy_count INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '📋 RLS 정책 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- users 테이블 정책 확인
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users';
    
    IF v_policy_count > 0 THEN
        RAISE NOTICE '⚠️  users 테이블에 % 개의 정책이 존재합니다 (삭제 필요)', v_policy_count;
    ELSE
        RAISE NOTICE '✅ users 테이블: 정책 없음 (정상)';
    END IF;
    
    -- transactions 테이블 정책 확인
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions';
    
    IF v_policy_count > 0 THEN
        RAISE NOTICE '⚠️  transactions 테이블에 % 개의 정책이 존재합니다 (삭제 필요)', v_policy_count;
    ELSE
        RAISE NOTICE '✅ transactions 테이블: 정책 없음 (정상)';
    END IF;
    
    -- partners 테이블 정책 확인
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'partners';
    
    IF v_policy_count > 0 THEN
        RAISE NOTICE '⚠️  partners 테이블에 % 개의 정책이 존재합니다 (삭제 필요)', v_policy_count;
    ELSE
        RAISE NOTICE '✅ partners 테이블: 정책 없음 (정상)';
    END IF;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 3. 테스트 데이터 삽입 시뮬레이션
-- ============================================

DO $$
DECLARE
    v_test_user_id UUID;
    v_test_transaction_id UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🧪 데이터 삽입 테스트';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- 테스트용 UUID 생성
    v_test_user_id := gen_random_uuid();
    v_test_transaction_id := gen_random_uuid();
    
    -- users 테이블 INSERT 테스트
    BEGIN
        INSERT INTO users (
            id,
            username,
            nickname,
            password_hash,
            status,
            balance
        ) VALUES (
            v_test_user_id,
            'test_user_' || EXTRACT(EPOCH FROM NOW())::TEXT,
            '테스트유저',
            crypt('test123', gen_salt('bf')),
            'active',
            0
        );
        
        RAISE NOTICE '✅ users 테이블 INSERT 성공';
        
        -- 테스트 데이터 삭제
        DELETE FROM users WHERE id = v_test_user_id;
        
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ users 테이블 INSERT 실패: %', SQLERRM;
    END;
    
    -- transactions 테이블 INSERT 테스트
    BEGIN
        -- 실제 사용자 ID 가져오기
        SELECT id INTO v_test_user_id
        FROM users
        WHERE status = 'active'
        LIMIT 1;
        
        IF v_test_user_id IS NOT NULL THEN
            INSERT INTO transactions (
                id,
                user_id,
                transaction_type,
                amount,
                status,
                balance_before,
                balance_after
            ) VALUES (
                v_test_transaction_id,
                v_test_user_id,
                'deposit',
                10000,
                'pending',
                0,
                0
            );
            
            RAISE NOTICE '✅ transactions 테이블 INSERT 성공';
            
            -- 테스트 데이터 삭제
            DELETE FROM transactions WHERE id = v_test_transaction_id;
        ELSE
            RAISE NOTICE '⚠️  테스트할 사용자가 없습니다';
        END IF;
        
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ transactions 테이블 INSERT 실패: %', SQLERRM;
    END;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 4. 로그인 함수 테스트
-- ============================================

DO $$
DECLARE
    v_user_count INTEGER;
    v_partner_count INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔐 로그인 함수 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- user_login 함수 존재 확인
    SELECT COUNT(*) INTO v_user_count
    FROM pg_proc
    WHERE proname = 'user_login';
    
    IF v_user_count > 0 THEN
        RAISE NOTICE '✅ user_login() 함수 존재';
    ELSE
        RAISE NOTICE '❌ user_login() 함수 없음';
    END IF;
    
    -- partner_login 함수 존재 확인
    SELECT COUNT(*) INTO v_partner_count
    FROM pg_proc
    WHERE proname = 'partner_login';
    
    IF v_partner_count > 0 THEN
        RAISE NOTICE '✅ partner_login() 함수 존재';
    ELSE
        RAISE NOTICE '❌ partner_login() 함수 없음';
    END IF;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 5. 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 검증 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '다음 사항을 확인하세요:';
    RAISE NOTICE '1. 모든 테이블의 RLS가 DISABLED 상태인지';
    RAISE NOTICE '2. RLS 정책이 모두 삭제되었는지';
    RAISE NOTICE '3. INSERT 테스트가 모두 성공했는지';
    RAISE NOTICE '4. 로그인 함수가 존재하는지';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  만약 위의 테스트에서 실패가 있다면:';
    RAISE NOTICE '   270_fix_rls_for_custom_auth.sql을 다시 실행하세요';
    RAISE NOTICE '';
    RAISE NOTICE '✅ 모든 테스트가 성공했다면:';
    RAISE NOTICE '   애플리케이션을 다시 시작하고 로그인을 시도하세요';
    RAISE NOTICE '';
END $$;
