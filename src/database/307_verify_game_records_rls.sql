-- =====================================================
-- 307. game_records RLS 상태 확인
-- =====================================================
-- 작성일: 2025-10-24
-- 목적: game_records 테이블의 RLS 상태 확인
-- =====================================================

DO $$ 
DECLARE
    v_rls_enabled BOOLEAN;
    v_policy_count INTEGER;
BEGIN
    -- RLS 활성화 여부 확인
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'game_records';
    
    -- Policy 개수 확인
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename = 'game_records';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📋 game_records RLS 상태 확인';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'RLS 활성화: %', v_rls_enabled;
    RAISE NOTICE 'Policy 개수: %', v_policy_count;
    
    IF v_rls_enabled THEN
        RAISE NOTICE '⚠️ RLS가 활성화되어 있습니다!';
        RAISE NOTICE '해결: ALTER TABLE game_records DISABLE ROW LEVEL SECURITY;';
    ELSE
        RAISE NOTICE '✅ RLS가 비활성화되어 있습니다.';
    END IF;
    
    IF v_policy_count > 0 THEN
        RAISE NOTICE '⚠️ % 개의 Policy가 존재합니다!', v_policy_count;
        
        -- Policy 목록 출력
        FOR r IN (
            SELECT policyname, cmd
            FROM pg_policies
            WHERE tablename = 'game_records'
        ) LOOP
            RAISE NOTICE '  - Policy: % (명령: %)', r.policyname, r.cmd;
        END LOOP;
    ELSE
        RAISE NOTICE '✅ Policy가 없습니다.';
    END IF;
    
    RAISE NOTICE '============================================';
END $$;

-- 테이블 권한 확인
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📋 game_records 테이블 권한 확인';
    RAISE NOTICE '============================================';
END $$;

SELECT 
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'game_records'
ORDER BY grantee, privilege_type;
