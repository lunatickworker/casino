-- 게임관리 및 베팅관리를 위한 필수 함수들
-- 이 SQL 스크립트를 Supabase SQL Editor에서 실행하세요

-- 1. 게임 관리 통계 함수
CREATE OR REPLACE FUNCTION get_game_management_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'total_games', COALESCE((SELECT COUNT(*) FROM games), 0),
        'visible_games', COALESCE((SELECT COUNT(*) FROM games WHERE status = 'visible'), 0),
        'hidden_games', COALESCE((SELECT COUNT(*) FROM games WHERE status = 'hidden'), 0),
        'maintenance_games', COALESCE((SELECT COUNT(*) FROM games WHERE status = 'maintenance'), 0),
        'total_providers', COALESCE((SELECT COUNT(*) FROM game_providers WHERE status = 'active'), 0),
        'today_bets', COALESCE((SELECT COUNT(*) FROM game_records WHERE DATE(played_at) = CURRENT_DATE), 0),
        'today_bet_amount', COALESCE((SELECT SUM(bet_amount) FROM game_records WHERE DATE(played_at) = CURRENT_DATE), 0),
        'today_win_amount', COALESCE((SELECT SUM(win_amount) FROM game_records WHERE DATE(played_at) = CURRENT_DATE), 0)
    ) INTO result;
    
    RETURN result;
END;
$$;

-- 2. 베팅 통계 함수
CREATE OR REPLACE FUNCTION get_betting_statistics(
    date_filter text DEFAULT 'today',
    provider_filter integer DEFAULT NULL,
    game_type_filter text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    date_start timestamp with time zone;
    date_end timestamp with time zone;
    result json;
    total_bets_count integer;
    total_bet_sum decimal(15,2);
    total_win_sum decimal(15,2);
    unique_users_count integer;
    avg_bet decimal(15,2);
    win_rate_calc decimal(5,2);
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

    -- 통계 계산
    SELECT 
        COUNT(*),
        COALESCE(SUM(gr.bet_amount), 0),
        COALESCE(SUM(gr.win_amount), 0),
        COUNT(DISTINCT gr.user_id),
        CASE WHEN COUNT(*) > 0 THEN COALESCE(AVG(gr.bet_amount), 0) ELSE 0 END,
        CASE WHEN COUNT(*) > 0 THEN (COUNT(CASE WHEN gr.win_amount > 0 THEN 1 END)::decimal / COUNT(*)::decimal * 100) ELSE 0 END
    INTO 
        total_bets_count,
        total_bet_sum,
        total_win_sum,
        unique_users_count,
        avg_bet,
        win_rate_calc
    FROM game_records gr
    LEFT JOIN games g ON gr.game_id = g.id
    WHERE gr.played_at >= date_start 
    AND gr.played_at <= date_end
    AND (provider_filter IS NULL OR gr.provider_id = provider_filter)
    AND (game_type_filter IS NULL OR g.type = game_type_filter);

    -- JSON 객체 생성
    SELECT json_build_object(
        'total_bets', total_bets_count,
        'total_bet_amount', total_bet_sum,
        'total_win_amount', total_win_sum,
        'total_profit_loss', total_bet_sum - total_win_sum,
        'unique_players', unique_users_count,
        'avg_bet_amount', avg_bet,
        'win_rate', win_rate_calc
    ) INTO result;
    
    RETURN result;
END;
$$;

-- 3. 베팅 기록 상세 조회 함수
CREATE OR REPLACE FUNCTION get_betting_records_with_details(
    date_filter text DEFAULT 'today',
    limit_count integer DEFAULT 100
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    date_start timestamp with time zone;
    date_end timestamp with time zone;
    result json;
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

    SELECT COALESCE(json_agg(
        json_build_object(
            'id', gr.id,
            'external_txid', gr.external_txid,
            'user_id', gr.user_id,
            'username', COALESCE(u.username, 'Unknown'),
            'game_name', COALESCE(g.name, 'Unknown Game'),
            'provider_name', COALESCE(gp.name, 'Unknown Provider'),
            'bet_amount', gr.bet_amount,
            'win_amount', gr.win_amount,
            'balance_before', gr.balance_before,
            'balance_after', gr.balance_after,
            'played_at', gr.played_at
        ) ORDER BY gr.played_at DESC
    ), '[]'::json) INTO result
    FROM (
        SELECT * FROM game_records 
        WHERE played_at >= date_start 
        AND played_at <= date_end
        ORDER BY played_at DESC
        LIMIT limit_count
    ) gr
    LEFT JOIN users u ON gr.user_id = u.id
    LEFT JOIN games g ON gr.game_id = g.id
    LEFT JOIN game_providers gp ON gr.provider_id = gp.id;
    
    RETURN result;
END;
$$;

-- 4. 기존에 있던 실시간 정산 통계 함수 (이미 있다면 건너뛰어짐)
CREATE OR REPLACE FUNCTION get_realtime_settlement_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'today_users', COALESCE((SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE DATE(login_at) = CURRENT_DATE), 0),
        'online_users', COALESCE((SELECT COUNT(*) FROM users WHERE is_online = true), 0),
        'total_balance', COALESCE((SELECT SUM(balance) FROM users), 0),
        'today_transactions', COALESCE((SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURRENT_DATE), 0)
    ) INTO result;
    
    RETURN result;
END;
$$;

-- 권한 설정 (필요한 경우)
GRANT EXECUTE ON FUNCTION get_game_management_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_betting_statistics(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_betting_records_with_details(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_realtime_settlement_stats() TO authenticated;