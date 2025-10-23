-- 게임 관리 시스템을 위한 추가 스키마 업데이트 (ALTER TABLE 방식)

-- 1. games 테이블에 게임 관리 관련 컬럼 추가
ALTER TABLE games ADD COLUMN IF NOT EXISTS rtp DECIMAL(5,2); -- RTP (Return to Player) 비율
ALTER TABLE games ADD COLUMN IF NOT EXISTS min_bet DECIMAL(15,2) DEFAULT 0; -- 최소 베팅액
ALTER TABLE games ADD COLUMN IF NOT EXISTS max_bet DECIMAL(15,2) DEFAULT 0; -- 최대 베팅액
ALTER TABLE games ADD COLUMN IF NOT EXISTS jackpot_available BOOLEAN DEFAULT FALSE; -- 잭팟 게임 여부
ALTER TABLE games ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE; -- 추천 게임 여부
ALTER TABLE games ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0; -- 정렬 순서

-- 2. game_providers 테이블에 제공사 관리 컬럼 추가
ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS api_endpoint TEXT; -- API 엔드포인트
ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE; -- 마지막 동기화 시간
ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT 'active' CHECK (sync_status IN ('active', 'syncing', 'error')); -- 동기화 상태
ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS total_games INTEGER DEFAULT 0; -- 총 게임 수
ALTER TABLE game_providers ADD COLUMN IF NOT EXISTS settings JSONB; -- 제공사별 설정

-- 3. game_records 테이블에 베팅 분석 관련 컬럼 추가
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS session_id VARCHAR(100); -- 게임 세션 ID
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS bonus_amount DECIMAL(15,2) DEFAULT 0; -- 보너스 금액
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'KRW'; -- 통화
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS device_type VARCHAR(20); -- 디바이스 타입 (mobile, desktop)
ALTER TABLE game_records ADD COLUMN IF NOT EXISTS ip_address INET; -- IP 주소

-- 4. 게임 상태 변경 히스토리 테이블 생성
CREATE TABLE IF NOT EXISTS game_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id INTEGER REFERENCES games(id),
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    changed_by UUID REFERENCES partners(id),
    reason TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. 게임 즐겨찾기 테이블 생성
CREATE TABLE IF NOT EXISTS user_favorite_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    game_id INTEGER REFERENCES games(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, game_id)
);

-- 6. 베팅 통계 캐시 테이블 생성 (성능 최적화용)
CREATE TABLE IF NOT EXISTS betting_stats_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key VARCHAR(100) UNIQUE NOT NULL,
    cache_data JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. 게임 설정 테이블 생성 (운영자별 게임 설정)
CREATE TABLE IF NOT EXISTS game_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id),
    game_id INTEGER REFERENCES games(id),
    custom_status VARCHAR(20) CHECK (custom_status IN ('visible', 'hidden', 'maintenance')),
    custom_rtp DECIMAL(5,2),
    custom_min_bet DECIMAL(15,2),
    custom_max_bet DECIMAL(15,2),
    commission_rate DECIMAL(5,2) DEFAULT 0,
    settings JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(partner_id, game_id)
);

-- 8. 게임 관리 관련 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_games_featured_status ON games(featured, status);
CREATE INDEX IF NOT EXISTS idx_games_type_provider_status ON games(type, provider_id, status);
CREATE INDEX IF NOT EXISTS idx_game_records_session ON game_records(session_id);
CREATE INDEX IF NOT EXISTS idx_game_records_device_type ON game_records(device_type);
CREATE INDEX IF NOT EXISTS idx_game_status_history_game_date ON game_status_history(game_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_user_favorite_games_user ON user_favorite_games(user_id);
CREATE INDEX IF NOT EXISTS idx_betting_stats_cache_expires ON betting_stats_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_game_settings_partner_game ON game_settings(partner_id, game_id);

-- 9. 게임 상태 변경 히스토리 트리거 함수 업데이트
CREATE OR REPLACE FUNCTION log_game_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- 상태가 변경되었을 때만 히스토리에 기록
    IF OLD.status != NEW.status THEN
        INSERT INTO game_status_history (game_id, old_status, new_status, reason)
        VALUES (NEW.id, OLD.status, NEW.status, 'Status updated by admin');
    END IF;
    
    RETURN NEW;
END;
$$;

-- 트리거 생성
DROP TRIGGER IF EXISTS game_status_change_log ON games;
CREATE TRIGGER game_status_change_log
    AFTER UPDATE ON games
    FOR EACH ROW
    EXECUTE FUNCTION log_game_status_change();

-- 10. 베팅 통계 캐시 정리 함수
CREATE OR REPLACE FUNCTION cleanup_betting_stats_cache()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM betting_stats_cache 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- 11. 게임 RTP 및 베팅 한도 업데이트 함수
CREATE OR REPLACE FUNCTION update_game_settings(
    game_id_param INTEGER,
    rtp_param DECIMAL(5,2) DEFAULT NULL,
    min_bet_param DECIMAL(15,2) DEFAULT NULL,
    max_bet_param DECIMAL(15,2) DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE games 
    SET 
        rtp = COALESCE(rtp_param, rtp),
        min_bet = COALESCE(min_bet_param, min_bet),
        max_bet = COALESCE(max_bet_param, max_bet),
        updated_at = NOW()
    WHERE id = game_id_param;
    
    RETURN FOUND;
END;
$$;

-- 12. system_settings에 게임 관리 설정 추가
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
('default_game_rtp', '96.5', 'number', '기본 게임 RTP (%)', 1),
('max_concurrent_games', '5', 'number', '사용자당 동시 접속 가능 게임 수', 2),
('game_history_retention_days', '365', 'number', '게임 히스토리 보관 일수', 1),
('auto_game_status_check', 'true', 'boolean', '자동 게임 상태 체크 활성화', 2),
('game_maintenance_notification', 'true', 'boolean', '게임 점검 알림 활성화', 3),
('featured_games_limit', '20', 'number', '추천 게임 최대 개수', 3)
ON CONFLICT (setting_key) DO NOTHING;