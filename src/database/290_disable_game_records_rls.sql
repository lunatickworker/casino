-- =====================================================
-- 290. game_records RLS 완전 비활성화
-- =====================================================
-- 작성일: 2025-10-19
-- 목적: game_records 테이블 RLS 비활성화 및 모든 policy 제거
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '290. game_records RLS 완전 비활성화';
    RAISE NOTICE '============================================';
END $$;

-- 1. 모든 policy 삭제
DROP POLICY IF EXISTS "game_records_select_all" ON game_records;
DROP POLICY IF EXISTS "game_records_insert_all" ON game_records;
DROP POLICY IF EXISTS "game_records_select_policy" ON game_records;
DROP POLICY IF EXISTS "game_records_insert_policy" ON game_records;
DROP POLICY IF EXISTS "game_records_update_policy" ON game_records;
DROP POLICY IF EXISTS "game_records_delete_policy" ON game_records;

-- 2. RLS 비활성화
ALTER TABLE game_records DISABLE ROW LEVEL SECURITY;

-- 3. 확인
DO $$
DECLARE
    v_rls_enabled BOOLEAN;
BEGIN
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'game_records';
    
    IF v_rls_enabled THEN
        RAISE NOTICE '❌ game_records RLS 여전히 활성화됨';
    ELSE
        RAISE NOTICE '✅ game_records RLS 비활성화 완료';
    END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 290. game_records RLS 완전 비활성화 완료';
    RAISE NOTICE '============================================';
END $$;
