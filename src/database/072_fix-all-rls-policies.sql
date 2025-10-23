-- =====================================================
-- 모든 주요 테이블의 RLS 정책 수정
-- 현재 시스템은 별도 인증 시스템 사용하므로 RLS 비활성화
-- =====================================================

-- 존재하는 테이블들의 RLS만 비활성화 (뷰 제외)
DO $
DECLARE
    table_names text[] := ARRAY[
        'transactions', 'users', 'partners', 'user_balance_logs',
        'activity_logs', 'game_records', 'messages', 'announcements',
        'games', 'game_providers', 'api_configs', 'banners', 
        'blacklist', 'transaction_stats', 'settlements', 'commission_logs'
    ];
    tbl_name text;
    is_table boolean;
BEGIN
    FOREACH tbl_name IN ARRAY table_names
    LOOP
        -- 일반 테이블인지 확인 (뷰가 아닌지 확인)
        SELECT EXISTS (
            SELECT 1 
            FROM pg_class c
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public' 
            AND c.relname = tbl_name
            AND c.relkind = 'r'  -- 'r' = 일반 테이블만, 'v' = 뷰 제외
        ) INTO is_table;
        
        IF is_table THEN
            EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl_name);
            RAISE NOTICE '✓ 테이블 % RLS 비활성화 완료', tbl_name;
        ELSE
            -- 뷰인지 확인
            SELECT EXISTS (
                SELECT 1 
                FROM pg_class c
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE n.nspname = 'public' 
                AND c.relname = tbl_name
                AND c.relkind = 'v'  -- 뷰
            ) INTO is_table;
            
            IF is_table THEN
                RAISE NOTICE '⊘ % 는 뷰(View)이므로 RLS 비활성화 건너뜀', tbl_name;
            ELSE
                RAISE NOTICE '⊘ % 가 존재하지 않음 - 건너뜀', tbl_name;
            END IF;
        END IF;
    END LOOP;
END $;

-- 기존 모든 RLS 정책 삭제
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 
                      rec.policyname, rec.schemaname, rec.tablename);
    END LOOP;
END $$;

-- 현재 RLS 상태 확인
-- 실제 존재하는 테이블의 RLS 상태 확인
SELECT 
    n.nspname as schema_name,
    c.relname as table_name,
    c.relrowsecurity as has_rls_enabled,
    c.relforcerowsecurity as force_rls
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
    AND c.relkind = 'r'  -- 일반 테이블만
    AND c.relname IN (
        'transactions', 'users', 'partners', 'user_balance_logs',
        'activity_logs', 'game_records', 'messages', 'announcements',
        'games', 'game_providers', 'api_configs',
        'banners', 'blacklist', 'transaction_stats', 'settlements',
        'commission_logs'
    )
ORDER BY c.relname;

COMMENT ON SCHEMA public IS 'RLS 전체 비활성화 - 애플리케이션 레벨에서 권한 제어';