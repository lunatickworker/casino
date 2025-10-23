-- =====================================================
-- transactions 테이블 RLS 정책 수정
-- 현재 시스템은 Supabase auth가 아닌 별도 인증 시스템 사용
-- =====================================================

-- 기존 RLS 정책 모두 삭제
DROP POLICY IF EXISTS "transactions_select_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_update_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_delete_policy" ON transactions;

-- RLS 비활성화 (애플리케이션 레벨에서 권한 제어)
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- 또는 모든 접근을 허용하는 정책으로 설정 (선택사항)
-- ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "transactions_allow_all" ON transactions
-- FOR ALL
-- USING (true)
-- WITH CHECK (true);

-- RLS 상태 확인 (더 정확한 방법)
SELECT 
    n.nspname as schema_name,
    c.relname as table_name,
    c.relrowsecurity as has_rls_enabled,
    c.relforcerowsecurity as force_rls
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relname = 'transactions' 
    AND n.nspname = 'public';

-- 정책 확인
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'transactions';

COMMENT ON TABLE transactions IS 'RLS 비활성화됨 - 애플리케이션 레벨에서 권한 제어';