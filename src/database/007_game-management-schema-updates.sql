-- 게임관리 기능을 위한 추가 스키마

-- 1. 게임 관리 통계를 위한 함수
DROP FUNCTION IF EXISTS get_game_management_stats();
CREATE OR REPLACE FUNCTION get_game_management_stats()
RETURNS TABLE (
    total_games INTEGER,
    visible_games INTEGER,
    hidden_games INTEGER,
    maintenance_games INTEGER,
    total_providers INTEGER,
    today_bets INTEGER,
    today_bet_amount DECIMAL(15,2),
    today_win_amount DECIMAL(15,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*)::INTEGER FROM games) as total_games,
        (SELECT COUNT(*)::INTEGER FROM games WHERE status = 'visible') as visible_games,
        (SELECT COUNT(*)::INTEGER FROM games WHERE status = 'hidden') as hidden_games,
        (SELECT COUNT(*)::INTEGER FROM games WHERE status = 'maintenance') as maintenance_games,
        (SELECT COUNT(*)::INTEGER FROM game_providers WHERE status = 'active') as total_providers,
        (SELECT COUNT(*)::INTEGER FROM game_records WHERE DATE(played_at) = CURRENT_DATE) as today_bets,
        (SELECT COALESCE(SUM(bet_amount), 0) FROM game_records WHERE DATE(played_at) = CURRENT_DATE) as today_bet_amount,
        (SELECT COALESCE(SUM(win_amount), 0) FROM game_records WHERE DATE(played_at) = CURRENT_DATE) as today_win_amount;
END;
$$;

-- 2. 베팅 내역 상세 조회를 위한 함수
DROP FUNCTION IF EXISTS get_betting_records_with_details(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION get_betting_records_with_details(
    date_filter TEXT DEFAULT 'today',
    limit_count INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    external_txid BIGINT,
    user_id UUID,
    username VARCHAR(50),
    game_name VARCHAR(200),
    provider_name VARCHAR(100),
    bet_amount DECIMAL(15,2),
    win_amount DECIMAL(15,2),
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    played_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
DECLARE
    date_start TIMESTAMP WITH TIME ZONE;
    date_end TIMESTAMP WITH TIME ZONE;
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
        gr.id,
        gr.external_txid,
        gr.user_id,
        u.username,
        g.name as game_name,
        gp.name as provider_name,
        gr.bet_amount,
        gr.win_amount,
        gr.balance_before,
        gr.balance_after,
        gr.played_at
    FROM game_records gr
    LEFT JOIN users u ON gr.user_id = u.id
    LEFT JOIN games g ON gr.game_id = g.id
    LEFT JOIN game_providers gp ON gr.provider_id = gp.id
    WHERE gr.played_at >= date_start 
    AND gr.played_at <= date_end
    ORDER BY gr.played_at DESC
    LIMIT limit_count;
END;
$$;

-- 3. 게임 상태 변경 알림을 위한 트리거 함수
DROP FUNCTION IF EXISTS notify_game_status_update();
CREATE OR REPLACE FUNCTION notify_game_status_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- 게임 상태가 변경되었을 때 알림
    IF OLD.status != NEW.status THEN
        PERFORM pg_notify(
            'game_status_update',
            json_build_object(
                'game_id', NEW.id,
                'game_name', NEW.name,
                'old_status', OLD.status,
                'new_status', NEW.status,
                'provider_id', NEW.provider_id,
                'updated_at', NEW.updated_at
            )::text
        );
    END IF;
    
    RETURN NEW;
END;
$$;

-- 트리거 생성
DROP TRIGGER IF EXISTS game_status_update_notify ON games;
CREATE TRIGGER game_status_update_notify
    AFTER UPDATE ON games
    FOR EACH ROW
    EXECUTE FUNCTION notify_game_status_update();

-- 4. 베팅 내역 실시간 알림을 위한 트리거 함수
DROP FUNCTION IF EXISTS notify_new_betting_record();
CREATE OR REPLACE FUNCTION notify_new_betting_record()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- 새로운 베팅 기록이 추가되었을 때 알림
    PERFORM pg_notify(
        'new_betting_record',
        json_build_object(
            'record_id', NEW.id,
            'user_id', NEW.user_id,
            'game_id', NEW.game_id,
            'provider_id', NEW.provider_id,
            'bet_amount', NEW.bet_amount,
            'win_amount', NEW.win_amount,
            'played_at', NEW.played_at
        )::text
    );
    
    RETURN NEW;
END;
$$;

-- 트리거 생성
DROP TRIGGER IF EXISTS new_betting_record_notify ON game_records;
CREATE TRIGGER new_betting_record_notify
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_betting_record();

-- 5. 기본 게임 제공사 데이터 삽입 (Guidelines.md 기준)
INSERT INTO game_providers (id, name, type, status, logo_url) VALUES
-- 슬롯 제공사
(1, '마이크로게이밍', 'slot', 'active', NULL),
(17, '플레이앤고', 'slot', 'active', NULL),
(20, 'CQ9 게이밍', 'slot', 'active', NULL),
(21, '제네시스 게이밍', 'slot', 'active', NULL),
(22, '하바네로', 'slot', 'active', NULL),
(23, '게임아트', 'slot', 'active', NULL),
(27, '플레이텍', 'slot', 'active', NULL),
(38, '블루프린트', 'slot', 'active', NULL),
(39, '부운고', 'slot', 'active', NULL),
(40, '드라군소프트', 'slot', 'active', NULL),
(41, '엘크 스튜디오', 'slot', 'active', NULL),
(47, '드림테크', 'slot', 'active', NULL),
(51, '칼람바 게임즈', 'slot', 'active', NULL),
(52, '모빌롯', 'slot', 'active', NULL),
(53, '노리밋 시티', 'slot', 'active', NULL),
(55, 'OMI 게이밍', 'slot', 'active', NULL),
(56, '원터치', 'slot', 'active', NULL),
(59, '플레이슨', 'slot', 'active', NULL),
(60, '푸쉬 게이밍', 'slot', 'active', NULL),
(61, '퀵스핀', 'slot', 'active', NULL),
(62, 'RTG 슬롯', 'slot', 'active', NULL),
(63, '리볼버 게이밍', 'slot', 'active', NULL),
(65, '슬롯밀', 'slot', 'active', NULL),
(66, '스피어헤드', 'slot', 'active', NULL),
(70, '썬더킥', 'slot', 'active', NULL),
(72, '우후 게임즈', 'slot', 'active', NULL),
(74, '릴렉스 게이밍', 'slot', 'active', NULL),
(75, '넷엔트', 'slot', 'active', NULL),
(76, '레드타이거', 'slot', 'active', NULL),
(87, 'PG소프트', 'slot', 'active', NULL),
(88, '플레이스타', 'slot', 'active', NULL),
(90, '빅타임게이밍', 'slot', 'active', NULL),
(300, '프라그마틱 플레이', 'slot', 'active', NULL),

-- 카지노 제공사
(410, '에볼루션 게이밍', 'casino', 'active', NULL),
(77, '마이크로 게이밍', 'casino', 'active', NULL),
(2, 'Vivo 게이밍', 'casino', 'active', NULL),
(30, '아시아 게이밍', 'casino', 'active', NULL),
(78, '프라그마틱플레이', 'casino', 'active', NULL),
(86, '섹시게이밍', 'casino', 'active', NULL),
(11, '비비아이엔', 'casino', 'active', NULL),
(28, '드림게임', 'casino', 'active', NULL),
(89, '오리엔탈게임', 'casino', 'active', NULL),
(91, '보타', 'casino', 'active', NULL),
(44, '이주기', 'casino', 'active', NULL),
(85, '플레이텍 라이브', 'casino', 'active', NULL),
(0, '제네럴 카지노', 'casino', 'active', NULL)

ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    status = EXCLUDED.status;

-- 6. 게임관리 관련 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_games_provider_type_status ON games(provider_id, type, status);
CREATE INDEX IF NOT EXISTS idx_games_status_updated ON games(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_game_records_played_at ON game_records(played_at);
CREATE INDEX IF NOT EXISTS idx_game_records_user_game ON game_records(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_game_records_provider_played ON game_records(provider_id, played_at);

-- 7. 베팅 통계를 위한 함수
DROP FUNCTION IF EXISTS get_betting_statistics(TEXT, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION get_betting_statistics(
    date_filter TEXT DEFAULT 'today',
    provider_filter INTEGER DEFAULT NULL,
    game_type_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    total_bets INTEGER,
    total_bet_amount DECIMAL(15,2),
    total_win_amount DECIMAL(15,2),
    total_profit_loss DECIMAL(15,2),
    unique_players INTEGER,
    avg_bet_amount DECIMAL(15,2),
    win_rate DECIMAL(5,2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    date_start TIMESTAMP WITH TIME ZONE;
    date_end TIMESTAMP WITH TIME ZONE;
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
        COUNT(*)::INTEGER as total_bets,
        COALESCE(SUM(gr.bet_amount), 0) as total_bet_amount,
        COALESCE(SUM(gr.win_amount), 0) as total_win_amount,
        COALESCE(SUM(gr.bet_amount - gr.win_amount), 0) as total_profit_loss,
        COUNT(DISTINCT gr.user_id)::INTEGER as unique_players,
        CASE WHEN COUNT(*) > 0 THEN COALESCE(AVG(gr.bet_amount), 0) ELSE 0 END as avg_bet_amount,
        CASE WHEN COUNT(*) > 0 THEN (COUNT(CASE WHEN gr.win_amount > 0 THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL * 100) ELSE 0 END as win_rate
    FROM game_records gr
    LEFT JOIN games g ON gr.game_id = g.id
    WHERE gr.played_at >= date_start 
    AND gr.played_at <= date_end
    AND (provider_filter IS NULL OR gr.provider_id = provider_filter)
    AND (game_type_filter IS NULL OR g.type = game_type_filter);
END;
$$;

-- 8. 게임 설정을 위한 시스템 설정 추가
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
('game_sync_interval', '30', 'number', '게임 데이터 동기화 주기(초)', 1),
('auto_game_sync_enabled', 'true', 'boolean', '자동 게임 동기화 활성화', 2),
('betting_history_retention_days', '90', 'number', '베팅 내역 보관 일수', 1),
('game_status_change_notification', 'true', 'boolean', '게임 상태 변경 알림', 2),
('max_games_per_sync', '1000', 'number', '동기화당 최대 게임 수', 1)
ON CONFLICT (setting_key) DO NOTHING;