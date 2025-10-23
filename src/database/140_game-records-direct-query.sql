-- =====================================================
-- game_records 직접 쿼리 허용 (RPC 사용 안함)
-- =====================================================

-- 1. 모든 베팅 관련 RPC 함수 삭제
DROP FUNCTION IF EXISTS get_betting_records_simple(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS get_betting_records_with_details(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS get_monthly_betting_sync_info(TEXT, TEXT);
DROP FUNCTION IF EXISTS save_betting_records_batch(JSONB);
DROP FUNCTION IF EXISTS update_betting_sync_status(TEXT, INTEGER, INTEGER, INTEGER, TIMESTAMP WITH TIME ZONE);

-- 2. game_records RLS 정책 완전 재설정
DROP POLICY IF EXISTS "game_records_select_policy" ON game_records;
DROP POLICY IF EXISTS "game_records_insert_policy" ON game_records;

ALTER TABLE game_records ENABLE ROW LEVEL SECURITY;

-- 3. 모든 authenticated 사용자 SELECT 허용
CREATE POLICY "game_records_select_all" ON game_records
    FOR SELECT
    TO authenticated
    USING (true);

-- 4. 시스템에서만 INSERT 가능
CREATE POLICY "game_records_insert_system" ON game_records
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- 5. 주석
COMMENT ON POLICY "game_records_select_all" ON game_records IS '모든 인증된 사용자 조회 허용 (계층 필터링은 클라이언트에서 처리)';
COMMENT ON POLICY "game_records_insert_system" ON game_records IS '베팅 데이터 저장 허용';
