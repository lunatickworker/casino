-- =====================================================
-- 베팅 내역 자동 동기화 시스템 구축
-- 리소스 재사용: 기존 함수 활용
-- =====================================================

-- 1. 베팅 동기화 상태 테이블 (기존 테이블 DROP 후 재생성)
DROP TABLE IF EXISTS betting_sync_status CASCADE;

CREATE TABLE betting_sync_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opcode TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ,
    last_txid BIGINT DEFAULT 0,
    total_records_synced INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'idle', -- idle, running, success, error
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(opcode)
);

-- 2. 월별 베팅 동기화 정보 조회 함수 (기존 함수 DROP 후 재생성)
DROP FUNCTION IF EXISTS get_monthly_betting_sync_info(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_monthly_betting_sync_info(
    p_opcode TEXT,
    p_year INTEGER,
    p_month INTEGER
)
RETURNS TABLE (
    latest_txid BIGINT,
    suggested_index BIGINT,
    has_data BOOLEAN,
    record_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(MAX(gr.external_txid), 0) as latest_txid,
        COALESCE(MAX(gr.external_txid), 0) as suggested_index,
        COUNT(gr.id) > 0 as has_data,
        COUNT(gr.id) as record_count
    FROM game_records gr
    INNER JOIN users u ON gr.user_id = u.id
    INNER JOIN partners p ON u.referrer_id = p.id
    WHERE p.opcode = p_opcode
    AND EXTRACT(YEAR FROM gr.played_at) = p_year
    AND EXTRACT(MONTH FROM gr.played_at) = p_month;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 베팅 동기화 상태 업데이트 함수 (기존 함수 DROP 후 재생성)
DROP FUNCTION IF EXISTS update_betting_sync_status(TEXT, BIGINT, INTEGER);

CREATE OR REPLACE FUNCTION update_betting_sync_status(
    p_opcode TEXT,
    p_last_txid BIGINT,
    p_records_count INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO betting_sync_status (
        opcode,
        last_sync_at,
        last_txid,
        total_records_synced,
        sync_status,
        updated_at
    ) VALUES (
        p_opcode,
        NOW(),
        p_last_txid,
        p_records_count,
        'success',
        NOW()
    )
    ON CONFLICT (opcode) 
    DO UPDATE SET
        last_sync_at = NOW(),
        last_txid = GREATEST(betting_sync_status.last_txid, p_last_txid),
        total_records_synced = betting_sync_status.total_records_synced + p_records_count,
        sync_status = 'success',
        error_message = NULL,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 베팅 통계 함수 (계층 필터링 적용) - 이미 있으면 재생성
DROP FUNCTION IF EXISTS get_betting_statistics(UUID, TEXT, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_betting_statistics(
    p_partner_id UUID,
    date_filter TEXT DEFAULT 'today',
    provider_filter INTEGER DEFAULT NULL,
    game_type_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    total_bets BIGINT,
    total_bet_amount DECIMAL(15,2),
    total_win_amount DECIMAL(15,2),
    total_profit_loss DECIMAL(15,2),
    unique_players BIGINT,
    avg_bet_amount DECIMAL(15,2),
    win_rate DECIMAL(5,2)
) AS $$
DECLARE
    date_start TIMESTAMPTZ;
    date_end TIMESTAMPTZ;
BEGIN
    -- 날짜 범위 계산
    date_end := NOW();
    CASE date_filter
        WHEN 'today' THEN
            date_start := DATE_TRUNC('day', NOW());
        WHEN 'week' THEN
            date_start := NOW() - INTERVAL '7 days';
        WHEN 'month' THEN
            date_start := NOW() - INTERVAL '30 days';
        ELSE
            date_start := DATE_TRUNC('day', NOW());
    END CASE;

    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_bets,
        COALESCE(SUM(gr.bet_amount), 0)::DECIMAL(15,2) as total_bet_amount,
        COALESCE(SUM(gr.win_amount), 0)::DECIMAL(15,2) as total_win_amount,
        COALESCE(SUM(gr.win_amount - gr.bet_amount), 0)::DECIMAL(15,2) as total_profit_loss,
        COUNT(DISTINCT gr.user_id)::BIGINT as unique_players,
        COALESCE(AVG(gr.bet_amount), 0)::DECIMAL(15,2) as avg_bet_amount,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                (COUNT(*) FILTER (WHERE gr.win_amount > 0)::DECIMAL / COUNT(*)::DECIMAL * 100)::DECIMAL(5,2)
            ELSE 
                0::DECIMAL(5,2)
        END as win_rate
    FROM game_records gr
    INNER JOIN users u ON gr.user_id = u.id
    WHERE gr.played_at >= date_start 
    AND gr.played_at <= date_end
    AND gr.user_id IN (SELECT spu.user_id FROM get_partner_subordinate_users(p_partner_id) spu)
    AND (provider_filter IS NULL OR gr.provider_id = provider_filter)
    AND (game_type_filter IS NULL OR 
         COALESCE(gr.external_data->>'category', 
                  CASE WHEN gr.provider_id >= 400 THEN 'casino' ELSE 'slot' END) = game_type_filter);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 권한 부여
GRANT EXECUTE ON FUNCTION get_monthly_betting_sync_info(TEXT, INTEGER, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION update_betting_sync_status(TEXT, BIGINT, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_betting_statistics(UUID, TEXT, INTEGER, TEXT) TO authenticated;

-- 6. 인덱스 최적화 (리소스 재사용)
CREATE INDEX IF NOT EXISTS idx_game_records_played_at ON game_records(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_records_user_played ON game_records(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_records_external_txid_user ON game_records(external_txid, user_id);
CREATE INDEX IF NOT EXISTS idx_betting_sync_status_opcode ON betting_sync_status(opcode);

-- 7. RLS 정책 (betting_sync_status 테이블)
ALTER TABLE betting_sync_status ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "Allow select betting_sync_status for authenticated" ON betting_sync_status;
DROP POLICY IF EXISTS "Allow insert betting_sync_status for authenticated" ON betting_sync_status;
DROP POLICY IF EXISTS "Allow update betting_sync_status for authenticated" ON betting_sync_status;

-- 모든 인증된 사용자가 조회 가능
CREATE POLICY "Allow select betting_sync_status for authenticated"
ON betting_sync_status FOR SELECT
TO authenticated
USING (true);

-- 인증된 사용자가 삽입/업데이트 가능 (함수에서만 사용)
CREATE POLICY "Allow insert betting_sync_status for authenticated"
ON betting_sync_status FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow update betting_sync_status for authenticated"
ON betting_sync_status FOR UPDATE
TO authenticated
USING (true);

COMMENT ON TABLE betting_sync_status IS '베팅 내역 동기화 상태 추적 테이블';
COMMENT ON FUNCTION get_monthly_betting_sync_info IS '월별 베팅 동기화 정보 조회 (최신 txid 기반)';
COMMENT ON FUNCTION update_betting_sync_status IS '베팅 동기화 상태 업데이트';
COMMENT ON FUNCTION get_betting_statistics IS '베팅 통계 조회 (조직 계층 필터링 적용)';

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE '✅ 베팅 내역 자동 동기화 시스템 구축 완료';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '📊 주요 기능:';
    RAISE NOTICE '  • 베팅 동기화 상태 추적 테이블';
    RAISE NOTICE '  • 월별 베팅 동기화 정보 조회';
    RAISE NOTICE '  • 베팅 동기화 상태 업데이트';
    RAISE NOTICE '  • 베팅 통계 조회 (계층 필터링)';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 프론트엔드 자동 동기화:';
    RAISE NOTICE '  • 관리자 페이지 → 베팅내역관리';
    RAISE NOTICE '  • 30초마다 자동 실행 (페이지 열면 자동 시작)';
    RAISE NOTICE '  • 리소스 재사용으로 메모리 최적화';
    RAISE NOTICE '';
    RAISE NOTICE '📝 다음 단계: 134_verify-betting-sync.sql 실행';
    RAISE NOTICE '==================================================';
END $$;