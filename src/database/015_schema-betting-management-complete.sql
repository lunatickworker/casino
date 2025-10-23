-- 베팅 관리 시스템 완성을 위한 데이터베이스 스키마 추가 (ALTER TABLE 방식)

-- 1. game_records 테이블에 베팅 관리 컬럼 추가 (안전한 방식)
DO $$
BEGIN
    -- profit_loss 컬럼 추가 (계산 컬럼)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'profit_loss') THEN
        ALTER TABLE game_records ADD COLUMN profit_loss DECIMAL(15,2) GENERATED ALWAYS AS (bet_amount - win_amount) STORED;
    END IF;
    
    -- currency 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'currency') THEN
        ALTER TABLE game_records ADD COLUMN currency VARCHAR(3) DEFAULT 'KRW';
    END IF;
    
    -- time_category 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'time_category') THEN
        ALTER TABLE game_records ADD COLUMN time_category VARCHAR(20) DEFAULT 'recent';
    END IF;
    
    -- game_type 컬럼 추가 (참조용)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'game_type') THEN
        ALTER TABLE game_records ADD COLUMN game_type VARCHAR(20);
    END IF;
END
$$;

-- 2. 베팅 분석을 위한 추가 인덱스
CREATE INDEX IF NOT EXISTS idx_game_records_profit_loss ON game_records(profit_loss);
CREATE INDEX IF NOT EXISTS idx_game_records_currency ON game_records(currency);
CREATE INDEX IF NOT EXISTS idx_game_records_time_category ON game_records(time_category);
CREATE INDEX IF NOT EXISTS idx_game_records_game_type ON game_records(game_type);

-- 3. 실시간 베팅 모니터링 뷰 생성 (기존 뷰 삭제 후 재생성)
DROP VIEW IF EXISTS real_time_betting_monitor CASCADE;
CREATE VIEW real_time_betting_monitor AS
SELECT 
    gr.id,
    gr.external_txid,
    gr.user_id,
    gr.game_id,
    gr.provider_id,
    gr.bet_amount,
    gr.win_amount,
    COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount) as profit_loss,
    gr.balance_before,
    gr.balance_after,
    gr.played_at,
    COALESCE(gr.currency, 'KRW') as currency,
    COALESCE(gr.time_category, 'recent') as time_category,
    u.username,
    u.nickname,
    g.name as game_name,
    COALESCE(g.type, 'slot') as game_type,
    gp.name as provider_name,
    COALESCE(p.nickname, 'Unknown') as partner_name,
    COALESCE(p.opcode, '') as opcode,
    CASE 
        WHEN gr.played_at >= NOW() - INTERVAL '10 minutes' THEN '실시간'
        WHEN gr.played_at >= NOW() - INTERVAL '1 hour' THEN '최근'
        ELSE '이전'
    END as real_status
FROM game_records gr
LEFT JOIN users u ON gr.user_id = u.id
LEFT JOIN games g ON gr.game_id = g.id
LEFT JOIN game_providers gp ON gr.provider_id = gp.id
LEFT JOIN partners p ON u.referrer_id = p.id;

-- 4. 베팅 통계 함수 생성 (기존 함수 삭제 후 재생성)
DROP FUNCTION IF EXISTS get_betting_statistics(text,integer,text);
DROP FUNCTION IF EXISTS get_betting_statistics(text,integer,text,text);
DROP FUNCTION IF EXISTS get_betting_statistics;

CREATE OR REPLACE FUNCTION get_betting_statistics(
    date_filter TEXT DEFAULT 'today',
    provider_filter INTEGER DEFAULT NULL,
    game_type_filter TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    result JSON;
    date_start TIMESTAMP WITH TIME ZONE;
    total_bets INTEGER;
    total_bet_amount DECIMAL(15,2);
    total_win_amount DECIMAL(15,2);
    total_profit_loss DECIMAL(15,2);
    unique_players INTEGER;
    avg_bet_amount DECIMAL(15,2);
    win_rate DECIMAL(5,2);
BEGIN
    -- 날짜 범위 설정
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

    -- 기본 쿼리 작성
    WITH filtered_records AS (
        SELECT 
            gr.bet_amount,
            gr.win_amount,
            gr.user_id,
            gr.played_at
        FROM game_records gr
        LEFT JOIN games g ON gr.game_id = g.id
        WHERE gr.played_at >= date_start
        AND gr.bet_amount IS NOT NULL
        AND gr.win_amount IS NOT NULL
        AND (provider_filter IS NULL OR gr.provider_id = provider_filter)
        AND (game_type_filter IS NULL OR COALESCE(g.type, gr.game_type) = game_type_filter)
    )
    SELECT 
        COUNT(*)::INTEGER,
        COALESCE(SUM(bet_amount), 0),
        COALESCE(SUM(win_amount), 0),
        COALESCE(SUM(bet_amount - win_amount), 0),
        COUNT(DISTINCT user_id)::INTEGER,
        COALESCE(AVG(bet_amount), 0),
        CASE 
            WHEN COUNT(*) > 0 THEN (COUNT(CASE WHEN win_amount > 0 THEN 1 END) * 100.0 / COUNT(*))::DECIMAL(5,2)
            ELSE 0
        END
    INTO 
        total_bets, 
        total_bet_amount, 
        total_win_amount, 
        total_profit_loss, 
        unique_players, 
        avg_bet_amount, 
        win_rate
    FROM filtered_records;

    -- JSON 결과 구성
    result := json_build_object(
        'total_bets', COALESCE(total_bets, 0),
        'total_bet_amount', COALESCE(total_bet_amount, 0),
        'total_win_amount', COALESCE(total_win_amount, 0),
        'total_profit_loss', COALESCE(total_profit_loss, 0),
        'unique_players', COALESCE(unique_players, 0),
        'avg_bet_amount', COALESCE(avg_bet_amount, 0),
        'win_rate', COALESCE(win_rate, 0)
    );

    RETURN result;
END;
$$;

-- 5. 게임 내역 상세 조회 함수 생성 (기존 함수 삭제 후 재생성)
DROP FUNCTION IF EXISTS get_game_history_detail;
DROP FUNCTION IF EXISTS get_game_history_detail(uuid,integer,text,text,integer);

CREATE OR REPLACE FUNCTION get_game_history_detail(
    user_id_param UUID DEFAULT NULL,
    game_id_param INTEGER DEFAULT NULL,
    date_from TEXT DEFAULT NULL,
    date_to TEXT DEFAULT NULL,
    limit_param INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    external_txid BIGINT,
    user_id UUID,
    username TEXT,
    game_id INTEGER,
    game_name TEXT,
    provider_name TEXT,
    bet_amount DECIMAL(15,2),
    win_amount DECIMAL(15,2),
    profit_loss DECIMAL(15,2),
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    played_at TIMESTAMP WITH TIME ZONE,
    game_round_id TEXT,
    session_duration_minutes INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        gr.id,
        gr.external_txid,
        gr.user_id,
        COALESCE(u.username, 'Unknown')::TEXT,
        gr.game_id,
        COALESCE(g.name, 'Unknown Game')::TEXT as game_name,
        COALESCE(gp.name, 'Unknown Provider')::TEXT as provider_name,
        gr.bet_amount,
        gr.win_amount,
        COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount),
        gr.balance_before,
        gr.balance_after,
        gr.played_at,
        COALESCE(gr.game_round_id, '')::TEXT,
        COALESCE(EXTRACT(EPOCH FROM (gr.played_at - LAG(gr.played_at) OVER (PARTITION BY gr.user_id ORDER BY gr.played_at)) / 60)::INTEGER, 0) as session_duration_minutes
    FROM game_records gr
    LEFT JOIN users u ON gr.user_id = u.id
    LEFT JOIN games g ON gr.game_id = g.id
    LEFT JOIN game_providers gp ON gr.provider_id = gp.id
    WHERE 
        gr.bet_amount IS NOT NULL
        AND gr.win_amount IS NOT NULL
        AND (user_id_param IS NULL OR gr.user_id = user_id_param)
        AND (game_id_param IS NULL OR gr.game_id = game_id_param)
        AND (date_from IS NULL OR gr.played_at >= date_from::TIMESTAMP WITH TIME ZONE)
        AND (date_to IS NULL OR gr.played_at <= date_to::TIMESTAMP WITH TIME ZONE)
    ORDER BY gr.played_at DESC
    LIMIT limit_param;
END;
$$;

-- 6. 베팅 패턴 분석 함수 (기존 함수 삭제 후 재생성)
DROP FUNCTION IF EXISTS analyze_betting_patterns;
DROP FUNCTION IF EXISTS analyze_betting_patterns(uuid,integer);

CREATE OR REPLACE FUNCTION analyze_betting_patterns(
    user_id_param UUID,
    days_back INTEGER DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    result JSON;
    total_sessions INTEGER;
    avg_session_duration DECIMAL(10,2);
    favorite_game_type TEXT;
    avg_bet_size DECIMAL(15,2);
    win_loss_ratio DECIMAL(5,2);
    most_active_hour INTEGER;
    betting_frequency DECIMAL(5,2);
BEGIN
    WITH user_betting_data AS (
        SELECT 
            gr.*,
            COALESCE(g.type, gr.game_type, 'slot') as game_type,
            EXTRACT(HOUR FROM gr.played_at) as play_hour,
            DATE_TRUNC('day', gr.played_at) as play_date
        FROM game_records gr
        LEFT JOIN games g ON gr.game_id = g.id
        WHERE gr.user_id = user_id_param
        AND gr.played_at >= NOW() - INTERVAL '1 day' * days_back
        AND gr.bet_amount IS NOT NULL
        AND gr.win_amount IS NOT NULL
    ),
    session_analysis AS (
        SELECT 
            COUNT(DISTINCT play_date) as session_days,
            AVG(bet_amount) as avg_bet,
            COUNT(CASE WHEN win_amount > bet_amount THEN 1 END)::DECIMAL / 
            NULLIF(COUNT(CASE WHEN bet_amount > 0 THEN 1 END), 0) as win_ratio,
            MODE() WITHIN GROUP (ORDER BY game_type) as popular_game_type,
            MODE() WITHIN GROUP (ORDER BY play_hour) as popular_hour,
            COUNT(*)::DECIMAL / NULLIF(COUNT(DISTINCT play_date), 0) as daily_frequency
        FROM user_betting_data
    )
    SELECT 
        json_build_object(
            'total_sessions', COALESCE(session_days, 0),
            'avg_bet_amount', COALESCE(avg_bet, 0),
            'win_loss_ratio', COALESCE(win_ratio * 100, 0),
            'favorite_game_type', COALESCE(popular_game_type, 'N/A'),
            'most_active_hour', COALESCE(popular_hour, 0),
            'betting_frequency', COALESCE(daily_frequency, 0)
        )
    INTO result
    FROM session_analysis;

    RETURN COALESCE(result, '{}'::JSON);
END;
$$;

-- 7. 실시간 베팅 알림을 위한 트리거 함수 (기존 함수 삭제 후 재생성)
-- 먼저 종속된 트리거 삭제
DROP TRIGGER IF EXISTS new_betting_record_notify ON game_records;
DROP FUNCTION IF EXISTS notify_new_betting_record();

CREATE OR REPLACE FUNCTION notify_new_betting_record()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- WebSocket을 통한 실시간 알림
    PERFORM pg_notify(
        'new_betting_record',
        json_build_object(
            'user_id', NEW.user_id,
            'bet_amount', NEW.bet_amount,
            'win_amount', NEW.win_amount,
            'game_id', NEW.game_id,
            'played_at', NEW.played_at
        )::TEXT
    );
    
    RETURN NEW;
END;
$$;

-- 8. 베팅 기록 삽입 시 실시간 알림 트리거
-- 기존 트리거와 새 트리거 모두 삭제 후 하나만 재생성
DROP TRIGGER IF EXISTS betting_record_notification ON game_records;
DROP TRIGGER IF EXISTS new_betting_record_notify ON game_records;

-- 통합된 트리거 생성
CREATE TRIGGER new_betting_record_notify
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_betting_record();

-- 9. 베팅 데이터 정리 함수 (성능 최적화) (기존 함수 삭제 후 재생성)
DROP FUNCTION IF EXISTS cleanup_old_betting_records;
DROP FUNCTION IF EXISTS cleanup_old_betting_records(integer);

CREATE OR REPLACE FUNCTION cleanup_old_betting_records(
    retention_days INTEGER DEFAULT 365
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM game_records 
    WHERE played_at < NOW() - INTERVAL '1 day' * retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- 통계 정보 업데이트
    ANALYZE game_records;
    
    RETURN deleted_count;
END;
$$;

-- 10. 베팅 관리용 시스템 설정 추가 (테이블 존재 확인 후 삽입)
DO $$
BEGIN
    -- system_settings 테이블이 존재하는지 확인
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_settings') THEN
        INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
        ('betting_sync_interval', '30', 'number', '베팅 데이터 동기화 주기(초)', 1),
        ('betting_retention_days', '365', 'number', '베팅 기록 보관 일수', 1),
        ('real_time_betting_alert', 'true', 'boolean', '실시간 베팅 알림 활성화', 2),
        ('high_bet_alert_threshold', '100000', 'number', '고액 베팅 알림 임계값', 2),
        ('betting_statistics_cache_minutes', '5', 'number', '베팅 통계 캐시 시간(분)', 2)
        ON CONFLICT (setting_key) DO NOTHING;
    END IF;
END
$$;

-- 11. 콜주기 관리 테이블 생성 (개발중 표시용)
CREATE TABLE IF NOT EXISTS call_cycle_management (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id),
    cycle_name VARCHAR(100) NOT NULL,
    interval_seconds INTEGER NOT NULL,
    api_endpoint VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT false,
    last_call_at TIMESTAMP WITH TIME ZONE,
    next_call_at TIMESTAMP WITH TIME ZONE,
    call_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0, 
    development_status VARCHAR(20) DEFAULT 'in_development' CHECK (development_status IN ('in_development', 'testing', 'active', 'disabled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. 콜주기 관리 인덱스
CREATE INDEX IF NOT EXISTS idx_call_cycle_partner_id ON call_cycle_management(partner_id);
CREATE INDEX IF NOT EXISTS idx_call_cycle_active ON call_cycle_management(is_active);
CREATE INDEX IF NOT EXISTS idx_call_cycle_next_call ON call_cycle_management(next_call_at);

-- 13. 트리거 업데이트 함수 추가 (함수 존재 확인)
DO $$
BEGIN
    -- update_updated_at_column 함수가 존재하는지 확인
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        -- 기존 트리거가 있다면 삭제
        DROP TRIGGER IF EXISTS update_call_cycle_updated_at ON call_cycle_management;
        
        -- 새 트리거 생성
        CREATE TRIGGER update_call_cycle_updated_at 
            BEFORE UPDATE ON call_cycle_management 
            FOR EACH ROW 
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$;