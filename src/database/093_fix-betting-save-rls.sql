-- =====================================================
-- 베팅 내역 저장 문제 해결
-- =====================================================

-- 1. game_records 테이블 RLS 비활성화 (관리자 함수에서 저장 가능하도록)
DO $
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_records' AND table_type = 'BASE TABLE') THEN
        ALTER TABLE game_records DISABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'game_records RLS 비활성화 완료';
    END IF;
END $;

-- 2. betting_sync_status 뷰가 있으면 삭제 (테이블로 재생성)
DROP VIEW IF EXISTS betting_sync_status CASCADE;

-- 3. 베팅 통계 캐시 테이블 확인 및 생성
DO $
BEGIN
    -- betting_stats_cache 테이블 확인
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_stats_cache' AND table_type = 'BASE TABLE') THEN
        CREATE TABLE betting_stats_cache (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            partner_id UUID REFERENCES partners(id),
            stat_date DATE NOT NULL,
            game_count INTEGER DEFAULT 0,
            total_bet DECIMAL(15,2) DEFAULT 0,
            total_win DECIMAL(15,2) DEFAULT 0,
            net_profit DECIMAL(15,2) DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, stat_date)
        );
        
        CREATE INDEX idx_betting_stats_cache_user_id ON betting_stats_cache(user_id);
        CREATE INDEX idx_betting_stats_cache_partner_id ON betting_stats_cache(partner_id);
        CREATE INDEX idx_betting_stats_cache_stat_date ON betting_stats_cache(stat_date);
        
        RAISE NOTICE 'betting_stats_cache 테이블 생성 완료';
    END IF;
    
    -- betting_sync_logs 테이블 확인
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_sync_logs' AND table_type = 'BASE TABLE') THEN
        CREATE TABLE betting_sync_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sync_type VARCHAR(50) NOT NULL,
            target_year INTEGER,
            target_month INTEGER,
            records_processed INTEGER DEFAULT 0,
            records_failed INTEGER DEFAULT 0,
            error_details JSONB,
            started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            completed_at TIMESTAMP WITH TIME ZONE,
            status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed'))
        );
        
        CREATE INDEX idx_betting_sync_logs_status ON betting_sync_logs(status);
        CREATE INDEX idx_betting_sync_logs_started_at ON betting_sync_logs(started_at);
        
        RAISE NOTICE 'betting_sync_logs 테이블 생성 완료';
    END IF;
    
    -- betting_sync_status 테이블 확인 (뷰 삭제 후)
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_sync_status' AND table_type = 'BASE TABLE') THEN
        CREATE TABLE betting_sync_status (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            last_sync_year INTEGER,
            last_sync_month INTEGER,
            last_sync_index BIGINT DEFAULT 0,
            last_sync_at TIMESTAMP WITH TIME ZONE,
            next_sync_at TIMESTAMP WITH TIME ZONE,
            is_syncing BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        RAISE NOTICE 'betting_sync_status 테이블 생성 완료';
    END IF;
END $;

-- 4. RLS 비활성화 (테이블만)
DO $
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_stats_cache' AND table_type = 'BASE TABLE') THEN
        ALTER TABLE betting_stats_cache DISABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'betting_stats_cache RLS 비활성화 완료';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_sync_logs' AND table_type = 'BASE TABLE') THEN
        ALTER TABLE betting_sync_logs DISABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'betting_sync_logs RLS 비활성화 완료';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_sync_status' AND table_type = 'BASE TABLE') THEN
        ALTER TABLE betting_sync_status DISABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'betting_sync_status RLS 비활성화 완료';
    END IF;
END $;

-- 5. 베팅 통계 자동 계산 함수
CREATE OR REPLACE FUNCTION refresh_betting_stats_cache(p_user_id UUID, p_stat_date DATE)
RETURNS VOID AS $$
BEGIN
    INSERT INTO betting_stats_cache (
        user_id,
        partner_id,
        stat_date,
        game_count,
        total_bet,
        total_win,
        net_profit,
        updated_at
    )
    SELECT
        user_id,
        partner_id,
        DATE(played_at) as stat_date,
        COUNT(*) as game_count,
        COALESCE(SUM(bet_amount), 0) as total_bet,
        COALESCE(SUM(win_amount), 0) as total_win,
        COALESCE(SUM(win_amount - bet_amount), 0) as net_profit,
        NOW()
    FROM game_records
    WHERE user_id = p_user_id
      AND DATE(played_at) = p_stat_date
    GROUP BY user_id, partner_id, DATE(played_at)
    ON CONFLICT (user_id, stat_date)
    DO UPDATE SET
        game_count = EXCLUDED.game_count,
        total_bet = EXCLUDED.total_bet,
        total_win = EXCLUDED.total_win,
        net_profit = EXCLUDED.net_profit,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. game_records INSERT 시 자동으로 통계 업데이트하는 트리거
DROP TRIGGER IF EXISTS trigger_update_betting_stats ON game_records;

CREATE OR REPLACE FUNCTION update_betting_stats_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- 통계 캐시 업데이트
    PERFORM refresh_betting_stats_cache(NEW.user_id, DATE(NEW.played_at));
    
    -- 동기화 로그 업데이트 (선택사항)
    -- 필요시 활성화
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_betting_stats
AFTER INSERT OR UPDATE ON game_records
FOR EACH ROW
EXECUTE FUNCTION update_betting_stats_on_insert();

-- 7. 권한 부여
GRANT EXECUTE ON FUNCTION refresh_betting_stats_cache(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated;

-- 8. 완료 메시지
SELECT '베팅 내역 저장 및 통계 시스템이 설정되었습니다.' as message;
