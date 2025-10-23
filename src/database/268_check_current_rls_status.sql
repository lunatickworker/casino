-- ============================================================================
-- 268. 현재 RLS 상태 확인 스크립트
-- ============================================================================
-- 목적: 현재 users/transactions 테이블의 RLS 상태와 정책을 확인

-- 1. 테이블 RLS 활성화 상태 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔍 RLS 활성화 상태 확인';
    RAISE NOTICE '========================================';
END $$;

SELECT 
    schemaname,
    tablename,
    CASE 
        WHEN rowsecurity THEN '✅ ENABLED'
        ELSE '❌ DISABLED'
    END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'transactions', 'partners')
ORDER BY tablename;

-- 2. 현재 정책 목록 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '📋 현재 정책 목록';
    RAISE NOTICE '========================================';
END $$;

SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    CASE 
        WHEN roles = '{public}' THEN 'public'
        ELSE array_to_string(roles, ', ')
    END as roles,
    CASE 
        WHEN permissive THEN 'PERMISSIVE'
        ELSE 'RESTRICTIVE'
    END as type
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'transactions', 'partners')
ORDER BY tablename, policyname;

-- 3. users 테이블 정책 상세 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '👤 users 테이블 정책 상세';
    RAISE NOTICE '========================================';
END $$;

SELECT 
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
ORDER BY 
    CASE cmd
        WHEN 'SELECT' THEN 1
        WHEN 'INSERT' THEN 2
        WHEN 'UPDATE' THEN 3
        WHEN 'DELETE' THEN 4
        ELSE 5
    END;

-- 4. transactions 테이블 정책 상세 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '💳 transactions 테이블 정책 상세';
    RAISE NOTICE '========================================';
END $$;

SELECT 
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'transactions'
ORDER BY 
    CASE cmd
        WHEN 'SELECT' THEN 1
        WHEN 'INSERT' THEN 2
        WHEN 'UPDATE' THEN 3
        WHEN 'DELETE' THEN 4
        ELSE 5
    END;

-- 5. 테스트: 현재 사용자가 업데이트 가능한지 확인
DO $$
DECLARE
    v_user_count INTEGER;
    v_current_user UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🧪 테스트: 업데이트 권한 확인';
    RAISE NOTICE '========================================';
    
    -- 현재 인증된 사용자 확인
    SELECT auth.uid() INTO v_current_user;
    
    IF v_current_user IS NULL THEN
        RAISE NOTICE '⚠️  현재 인증된 사용자 없음 (anon 또는 비로그인 상태)';
    ELSE
        RAISE NOTICE '✓ 현재 사용자: %', v_current_user;
        
        -- 파트너인지 확인
        SELECT COUNT(*) INTO v_user_count
        FROM partners
        WHERE id = v_current_user;
        
        IF v_user_count > 0 THEN
            RAISE NOTICE '✓ 파트너 계정입니다';
            
            SELECT 
                '  - username: ' || username || 
                ', level: ' || level ||
                ', opcode: ' || COALESCE(opcode, 'NULL')
            FROM partners
            WHERE id = v_current_user;
        ELSE
            RAISE NOTICE '⚠️  일반 사용자 계정입니다';
        END IF;
    END IF;
    
    RAISE NOTICE '';
END $$;

-- 6. 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ RLS 상태 확인 완료';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '다음 사항을 확인하세요:';
    RAISE NOTICE '1. users/transactions 테이블 RLS가 ENABLED인지';
    RAISE NOTICE '2. users_update_by_admin 정책이 존재하는지';
    RAISE NOTICE '3. transactions_update_by_admin 정책이 존재하는지';
    RAISE NOTICE '4. 현재 로그인한 계정이 파트너인지';
    RAISE NOTICE '';
END $$;
