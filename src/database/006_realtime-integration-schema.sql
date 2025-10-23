-- =====================================================
-- 실시간 연동을 위한 추가 스키마 업데이트
-- =====================================================

-- 사용자 세션에 게임 정보 컬럼 추가
ALTER TABLE user_sessions 
ADD COLUMN IF NOT EXISTS current_game_id INTEGER REFERENCES games(id),
ADD COLUMN IF NOT EXISTS current_provider_id INTEGER REFERENCES game_providers(id),
ADD COLUMN IF NOT EXISTS last_bet_amount DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS session_balance DECIMAL(15,2) DEFAULT 0;

-- 실시간 알림 테이블
CREATE TABLE IF NOT EXISTS real_time_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('user', 'partner')),
    user_id UUID NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 실시간 알림 인덱스
CREATE INDEX IF NOT EXISTS idx_notifications_user ON real_time_notifications(user_type, user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON real_time_notifications(is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON real_time_notifications(notification_type);

-- 시스템 상태 모니터링 테이블
CREATE TABLE IF NOT EXISTS system_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('online', 'offline', 'warning', 'error')),
    message TEXT,
    metrics JSONB,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 시스템 상태 인덱스
CREATE INDEX IF NOT EXISTS idx_system_status_component ON system_status(component, checked_at);
CREATE INDEX IF NOT EXISTS idx_system_status_status ON system_status(status, checked_at);

-- WebSocket 연결 상태 테이블
CREATE TABLE IF NOT EXISTS websocket_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('user', 'partner', 'admin')),
    user_id UUID,
    connection_id VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_ping_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- WebSocket 연결 인덱스
CREATE INDEX IF NOT EXISTS idx_websocket_user ON websocket_connections(user_type, user_id);
CREATE INDEX IF NOT EXISTS idx_websocket_active ON websocket_connections(is_active, last_ping_at);

-- 게임 제공사 상태 업데이트
ALTER TABLE game_providers 
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'success', 'error')),
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 게임 상태 추가 정보
ALTER TABLE games 
ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rtp_percentage DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS min_bet DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS max_bet DECIMAL(15,2);

-- 파트너 실시간 통계 테이블
CREATE TABLE IF NOT EXISTS partner_daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id),
    stat_date DATE NOT NULL,
    total_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    total_deposits DECIMAL(15,2) DEFAULT 0,
    total_withdrawals DECIMAL(15,2) DEFAULT 0,
    total_bets DECIMAL(15,2) DEFAULT 0,
    total_wins DECIMAL(15,2) DEFAULT 0,
    commission_earned DECIMAL(15,2) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(partner_id, stat_date)
);

-- 파트너 통계 인덱스
CREATE INDEX IF NOT EXISTS idx_partner_stats_date ON partner_daily_stats(partner_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_partner_stats_updated ON partner_daily_stats(updated_at);

-- 사용자 일일 통계 테이블
CREATE TABLE IF NOT EXISTS user_daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    stat_date DATE NOT NULL,
    games_played INTEGER DEFAULT 0,
    total_bet DECIMAL(15,2) DEFAULT 0,
    total_win DECIMAL(15,2) DEFAULT 0,
    profit_loss DECIMAL(15,2) DEFAULT 0,
    session_time_minutes INTEGER DEFAULT 0,
    favorite_provider_id INTEGER REFERENCES game_providers(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, stat_date)
);

-- 사용자 통계 인덱스
CREATE INDEX IF NOT EXISTS idx_user_stats_date ON user_daily_stats(user_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_user_stats_updated ON user_daily_stats(updated_at);

-- 실시간 이벤트 로그 테이블
CREATE TABLE IF NOT EXISTS real_time_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    event_source VARCHAR(50) NOT NULL,
    user_type VARCHAR(20),
    user_id UUID,
    event_data JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processing_attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 실시간 이벤트 인덱스
CREATE INDEX IF NOT EXISTS idx_events_type ON real_time_events(event_type, processed);
CREATE INDEX IF NOT EXISTS idx_events_source ON real_time_events(event_source, created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON real_time_events(user_type, user_id);

-- OPCODE별 API 상태 모니터링 테이블
CREATE TABLE IF NOT EXISTS opcode_api_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opcode VARCHAR(100) NOT NULL,
    partner_id UUID REFERENCES partners(id),
    endpoint VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('online', 'offline', 'error', 'timeout')),
    response_time_ms INTEGER,
    last_check_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    error_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OPCODE API 상태 인덱스
CREATE INDEX IF NOT EXISTS idx_opcode_status_opcode ON opcode_api_status(opcode, last_check_at);
CREATE INDEX IF NOT EXISTS idx_opcode_status_partner ON opcode_api_status(partner_id, endpoint);

-- =====================================================
-- 실시간 업데이트 함수들
-- =====================================================

-- 파트너 일일 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_partner_daily_stats()
RETURNS TRIGGER AS $$
DECLARE
    partner_rec RECORD;
    stat_date DATE := CURRENT_DATE;
BEGIN
    -- 거래가 승인된 경우에만 통계 업데이트
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        -- 사용자의 파트너 정보 조회
        SELECT p.* INTO partner_rec
        FROM partners p
        JOIN users u ON u.referrer_id = p.id
        WHERE u.id = NEW.user_id;
        
        IF FOUND THEN
            -- 파트너 통계 업데이트
            INSERT INTO partner_daily_stats (partner_id, stat_date, total_deposits, total_withdrawals)
            VALUES (
                partner_rec.id, 
                stat_date,
                CASE WHEN NEW.transaction_type = 'deposit' THEN NEW.amount ELSE 0 END,
                CASE WHEN NEW.transaction_type = 'withdrawal' THEN NEW.amount ELSE 0 END
            )
            ON CONFLICT (partner_id, stat_date) 
            DO UPDATE SET
                total_deposits = partner_daily_stats.total_deposits + 
                    CASE WHEN NEW.transaction_type = 'deposit' THEN NEW.amount ELSE 0 END,
                total_withdrawals = partner_daily_stats.total_withdrawals + 
                    CASE WHEN NEW.transaction_type = 'withdrawal' THEN NEW.amount ELSE 0 END,
                updated_at = NOW();
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 거래 테이블에 트리거 연결
DROP TRIGGER IF EXISTS trigger_update_partner_stats ON transactions;
CREATE TRIGGER trigger_update_partner_stats
    AFTER INSERT OR UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_partner_daily_stats();

-- 게임 기록 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_game_stats()
RETURNS TRIGGER AS $$
DECLARE
    partner_rec RECORD;
    stat_date DATE := CURRENT_DATE;
BEGIN
    -- 사용자의 파트너 정보 조회
    SELECT p.* INTO partner_rec
    FROM partners p
    JOIN users u ON u.referrer_id = p.id
    WHERE u.id = NEW.user_id;
    
    IF FOUND THEN
        -- 파트너 통계 업데이트
        INSERT INTO partner_daily_stats (partner_id, stat_date, total_bets, total_wins)
        VALUES (partner_rec.id, stat_date, NEW.bet_amount, NEW.win_amount)
        ON CONFLICT (partner_id, stat_date) 
        DO UPDATE SET
            total_bets = partner_daily_stats.total_bets + NEW.bet_amount,
            total_wins = partner_daily_stats.total_wins + NEW.win_amount,
            updated_at = NOW();
    END IF;
    
    -- 사용자 통계 업데이트
    INSERT INTO user_daily_stats (user_id, stat_date, games_played, total_bet, total_win, profit_loss)
    VALUES (
        NEW.user_id, 
        stat_date, 
        1, 
        NEW.bet_amount, 
        NEW.win_amount, 
        NEW.win_amount - NEW.bet_amount
    )
    ON CONFLICT (user_id, stat_date) 
    DO UPDATE SET
        games_played = user_daily_stats.games_played + 1,
        total_bet = user_daily_stats.total_bet + NEW.bet_amount,
        total_win = user_daily_stats.total_win + NEW.win_amount,
        profit_loss = user_daily_stats.profit_loss + (NEW.win_amount - NEW.bet_amount),
        updated_at = NOW();
    
    -- 게임 플레이 카운트 업데이트
    UPDATE games 
    SET 
        play_count = play_count + 1,
        last_played_at = NOW()
    WHERE id = NEW.game_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 게임 기록 테이블에 트리거 연결
DROP TRIGGER IF EXISTS trigger_update_game_stats ON game_records;
CREATE TRIGGER trigger_update_game_stats
    AFTER INSERT ON game_records
    FOR EACH ROW EXECUTE FUNCTION update_game_stats();

-- 실시간 이벤트 생성 함수
CREATE OR REPLACE FUNCTION create_real_time_event(
    p_event_type VARCHAR(50),
    p_event_source VARCHAR(50),
    p_user_type VARCHAR(20) DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_event_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO real_time_events (event_type, event_source, user_type, user_id, event_data)
    VALUES (p_event_type, p_event_source, p_user_type, p_user_id, p_event_data)
    RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- 실시간 알림 생성 함수
CREATE OR REPLACE FUNCTION create_notification(
    p_user_type VARCHAR(20),
    p_user_id UUID,
    p_notification_type VARCHAR(50),
    p_title VARCHAR(200),
    p_message TEXT,
    p_data JSONB DEFAULT NULL,
    p_priority VARCHAR(20) DEFAULT 'normal',
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO real_time_notifications (
        user_type, user_id, notification_type, title, message, 
        data, priority, expires_at
    )
    VALUES (
        p_user_type, p_user_id, p_notification_type, p_title, p_message, 
        p_data, p_priority, p_expires_at
    )
    RETURNING id INTO notification_id;
    
    RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 초기 데이터 및 설정
-- =====================================================

-- 시스템 상태 초기 데이터
INSERT INTO system_status (component, status, message) VALUES
('database', 'online', 'PostgreSQL 연결 정상'),
('websocket', 'online', 'WebSocket 서버 정상'),
('api_proxy', 'online', '프록시 서버 정상'),
('invest_api', 'online', 'Invest API 연결 정상')
ON CONFLICT DO NOTHING;

-- API 동기화 관련 시스템 설정 추가
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
('api_sync_enabled', 'true', 'boolean', 'API 자동 동기화 활성화', 1),
('api_sync_interval', '30', 'number', 'API 동기화 간격(초)', 1),
('websocket_heartbeat_interval', '30', 'number', 'WebSocket 하트비트 간격(초)', 1),
('max_websocket_connections', '1000', 'number', '최대 WebSocket 연결 수', 1),
('real_time_notifications_enabled', 'true', 'boolean', '실시간 알림 활성화', 1)
ON CONFLICT (setting_key) DO NOTHING;

-- =====================================================
-- 정리 작업 함수들
-- =====================================================

-- 만료된 알림 정리 함수
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM real_time_notifications 
    WHERE expires_at IS NOT NULL AND expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 오래된 이벤트 로그 정리 함수
CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM real_time_events 
    WHERE created_at < NOW() - INTERVAL '30 days' AND processed = true;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 정리 작업을 위한 스케줄링은 별도 cron job으로 처리
-- 예: SELECT cleanup_expired_notifications(); SELECT cleanup_old_events();