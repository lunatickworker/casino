-- =====================================================
-- 베팅 내역 관련 함수들 (game_records 테이블 사용)
-- =====================================================

-- 1. 사용자 베팅 내역 조회 함수
CREATE OR REPLACE FUNCTION get_user_betting_history(
  user_id_param UUID,
  limit_param INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  game_id INTEGER,
  game_name TEXT,
  provider_id INTEGER,
  provider_name TEXT,
  bet_amount DECIMAL(15,2),
  win_amount DECIMAL(15,2),
  profit_loss DECIMAL(15,2),
  balance_before DECIMAL(15,2),
  balance_after DECIMAL(15,2),
  round_id TEXT,
  game_type TEXT,
  external_tx_id BIGINT,
  external_response JSONB,
  created_at TIMESTAMPTZ,
  played_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gr.id,
    gr.user_id,
    u.username,
    gr.game_id,
    COALESCE(g.name, 'Unknown') as game_name,
    gr.provider_id,
    COALESCE(gp.name, 'Unknown') as provider_name,
    gr.bet_amount,
    gr.win_amount,
    COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount) as profit_loss,
    gr.balance_before,
    gr.balance_after,
    COALESCE(gr.game_round_id, '') as round_id,
    COALESCE(g.type, gr.game_type, 'slot') as game_type,
    gr.external_txid as external_tx_id,
    gr.external_data as external_response,
    gr.created_at,
    gr.played_at
  FROM game_records gr
  LEFT JOIN users u ON gr.user_id = u.id
  LEFT JOIN games g ON gr.game_id = g.id
  LEFT JOIN game_providers gp ON gr.provider_id = gp.id
  WHERE gr.user_id = user_id_param
  ORDER BY gr.played_at DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 베팅 내역 통계 조회 함수
CREATE OR REPLACE FUNCTION get_user_betting_statistics(
  user_id_param UUID,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  total_bets BIGINT,
  total_bet_amount DECIMAL(15,2),
  total_win_amount DECIMAL(15,2),
  total_profit_loss DECIMAL(15,2),
  win_count BIGINT,
  loss_count BIGINT,
  win_rate DECIMAL(5,2),
  biggest_win DECIMAL(15,2),
  biggest_loss DECIMAL(15,2),
  average_bet DECIMAL(15,2),
  favorite_game TEXT,
  favorite_provider TEXT
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
BEGIN
  -- 날짜 범위 설정 (기본값: 최근 30일)
  v_start_date := COALESCE(start_date, NOW() - INTERVAL '30 days');
  v_end_date := COALESCE(end_date, NOW());

  RETURN QUERY
  WITH betting_stats AS (
    SELECT
      COUNT(*) as total_bets,
      COALESCE(SUM(gr.bet_amount), 0) as total_bet_amount,
      COALESCE(SUM(gr.win_amount), 0) as total_win_amount,
      COALESCE(SUM(COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount)), 0) as total_profit_loss,
      COUNT(*) FILTER (WHERE COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount) > 0) as win_count,
      COUNT(*) FILTER (WHERE COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount) < 0) as loss_count,
      COALESCE(MAX(COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount)), 0) as biggest_win,
      COALESCE(MIN(COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount)), 0) as biggest_loss,
      COALESCE(AVG(gr.bet_amount), 0) as average_bet
    FROM game_records gr
    WHERE gr.user_id = user_id_param
      AND gr.played_at BETWEEN v_start_date AND v_end_date
  ),
  favorite_game AS (
    SELECT COALESCE(g.name, 'Unknown') as game_name
    FROM game_records gr
    LEFT JOIN games g ON gr.game_id = g.id
    WHERE gr.user_id = user_id_param
      AND gr.played_at BETWEEN v_start_date AND v_end_date
    GROUP BY g.name
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  favorite_provider AS (
    SELECT COALESCE(gp.name, 'Unknown') as provider_name
    FROM game_records gr
    LEFT JOIN game_providers gp ON gr.provider_id = gp.id
    WHERE gr.user_id = user_id_param
      AND gr.played_at BETWEEN v_start_date AND v_end_date
    GROUP BY gp.name
    ORDER BY COUNT(*) DESC
    LIMIT 1
  )
  SELECT
    bs.total_bets::BIGINT,
    bs.total_bet_amount::DECIMAL(15,2),
    bs.total_win_amount::DECIMAL(15,2),
    bs.total_profit_loss::DECIMAL(15,2),
    bs.win_count::BIGINT,
    bs.loss_count::BIGINT,
    CASE 
      WHEN bs.total_bets > 0 THEN (bs.win_count::DECIMAL / bs.total_bets::DECIMAL * 100)::DECIMAL(5,2)
      ELSE 0::DECIMAL(5,2)
    END as win_rate,
    bs.biggest_win::DECIMAL(15,2),
    bs.biggest_loss::DECIMAL(15,2),
    bs.average_bet::DECIMAL(15,2),
    COALESCE(fg.game_name, 'N/A') as favorite_game,
    COALESCE(fp.provider_name, 'N/A') as favorite_provider
  FROM betting_stats bs
  LEFT JOIN LATERAL (SELECT game_name FROM favorite_game LIMIT 1) fg ON true
  LEFT JOIN LATERAL (SELECT provider_name FROM favorite_provider LIMIT 1) fp ON true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 게임별 베팅 통계 조회 함수
CREATE OR REPLACE FUNCTION get_game_betting_statistics(
  game_id_param INTEGER,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  game_id INTEGER,
  game_name TEXT,
  provider_name TEXT,
  total_bets BIGINT,
  total_players BIGINT,
  total_bet_amount DECIMAL(15,2),
  total_win_amount DECIMAL(15,2),
  total_profit_loss DECIMAL(15,2),
  house_edge DECIMAL(5,2),
  average_bet DECIMAL(15,2),
  max_bet DECIMAL(15,2),
  min_bet DECIMAL(15,2)
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
BEGIN
  -- 날짜 범위 설정 (기본값: 최근 30일)
  v_start_date := COALESCE(start_date, NOW() - INTERVAL '30 days');
  v_end_date := COALESCE(end_date, NOW());

  RETURN QUERY
  SELECT
    gr.game_id,
    MAX(COALESCE(g.name, 'Unknown')) as game_name,
    MAX(COALESCE(gp.name, 'Unknown')) as provider_name,
    COUNT(*)::BIGINT as total_bets,
    COUNT(DISTINCT gr.user_id)::BIGINT as total_players,
    COALESCE(SUM(gr.bet_amount), 0)::DECIMAL(15,2) as total_bet_amount,
    COALESCE(SUM(gr.win_amount), 0)::DECIMAL(15,2) as total_win_amount,
    COALESCE(SUM(COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount)), 0)::DECIMAL(15,2) as total_profit_loss,
    CASE 
      WHEN SUM(gr.bet_amount) > 0 
      THEN ((SUM(gr.bet_amount) - SUM(gr.win_amount)) / SUM(gr.bet_amount) * 100)::DECIMAL(5,2)
      ELSE 0::DECIMAL(5,2)
    END as house_edge,
    COALESCE(AVG(gr.bet_amount), 0)::DECIMAL(15,2) as average_bet,
    COALESCE(MAX(gr.bet_amount), 0)::DECIMAL(15,2) as max_bet,
    COALESCE(MIN(gr.bet_amount), 0)::DECIMAL(15,2) as min_bet
  FROM game_records gr
  LEFT JOIN games g ON gr.game_id = g.id
  LEFT JOIN game_providers gp ON gr.provider_id = gp.id
  WHERE gr.game_id = game_id_param
    AND gr.played_at BETWEEN v_start_date AND v_end_date
  GROUP BY gr.game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 실시간 베팅 현황 조회 함수
CREATE OR REPLACE FUNCTION get_live_betting_status()
RETURNS TABLE (
  active_players BIGINT,
  active_games BIGINT,
  total_bets_last_hour BIGINT,
  total_bet_amount_last_hour DECIMAL(15,2),
  total_win_amount_last_hour DECIMAL(15,2),
  current_house_profit DECIMAL(15,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT user_id)::BIGINT as active_players,
    COUNT(DISTINCT game_id)::BIGINT as active_games,
    COUNT(*)::BIGINT as total_bets_last_hour,
    COALESCE(SUM(bet_amount), 0)::DECIMAL(15,2) as total_bet_amount_last_hour,
    COALESCE(SUM(win_amount), 0)::DECIMAL(15,2) as total_win_amount_last_hour,
    COALESCE(SUM(bet_amount) - SUM(win_amount), 0)::DECIMAL(15,2) as current_house_profit
  FROM game_records
  WHERE played_at > NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 파트너별 베팅 통계 조회 함수
CREATE OR REPLACE FUNCTION get_partner_betting_statistics(
  partner_id_param UUID,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  partner_id UUID,
  partner_nickname TEXT,
  total_users BIGINT,
  total_bets BIGINT,
  total_bet_amount DECIMAL(15,2),
  total_win_amount DECIMAL(15,2),
  total_profit_loss DECIMAL(15,2),
  commission_amount DECIMAL(15,2)
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
BEGIN
  -- 날짜 범위 설정 (기본값: 최근 30일)
  v_start_date := COALESCE(start_date, NOW() - INTERVAL '30 days');
  v_end_date := COALESCE(end_date, NOW());

  RETURN QUERY
  WITH partner_users AS (
    SELECT id 
    FROM users 
    WHERE referrer_id = partner_id_param
  )
  SELECT
    partner_id_param as partner_id,
    p.nickname as partner_nickname,
    COUNT(DISTINCT gr.user_id)::BIGINT as total_users,
    COUNT(*)::BIGINT as total_bets,
    COALESCE(SUM(gr.bet_amount), 0)::DECIMAL(15,2) as total_bet_amount,
    COALESCE(SUM(gr.win_amount), 0)::DECIMAL(15,2) as total_win_amount,
    COALESCE(SUM(COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount)), 0)::DECIMAL(15,2) as total_profit_loss,
    COALESCE(SUM(gr.bet_amount) - SUM(gr.win_amount), 0)::DECIMAL(15,2) * 0.1 as commission_amount
  FROM game_records gr
  INNER JOIN partner_users pu ON gr.user_id = pu.id
  CROSS JOIN partners p
  WHERE p.id = partner_id_param
    AND gr.played_at BETWEEN v_start_date AND v_end_date
  GROUP BY p.nickname;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 베팅 내역 상세 조회 함수
CREATE OR REPLACE FUNCTION get_betting_detail(
  betting_id_param UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  user_nickname TEXT,
  game_id INTEGER,
  game_name TEXT,
  provider_id INTEGER,
  provider_name TEXT,
  bet_amount DECIMAL(15,2),
  win_amount DECIMAL(15,2),
  profit_loss DECIMAL(15,2),
  balance_before DECIMAL(15,2),
  balance_after DECIMAL(15,2),
  round_id TEXT,
  game_type TEXT,
  external_tx_id BIGINT,
  external_response JSONB,
  created_at TIMESTAMPTZ,
  played_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gr.id,
    gr.user_id,
    u.username,
    u.nickname as user_nickname,
    gr.game_id,
    COALESCE(g.name, 'Unknown') as game_name,
    gr.provider_id,
    COALESCE(gp.name, 'Unknown') as provider_name,
    gr.bet_amount,
    gr.win_amount,
    COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount) as profit_loss,
    gr.balance_before,
    gr.balance_after,
    COALESCE(gr.game_round_id, '') as round_id,
    COALESCE(g.type, gr.game_type, 'slot') as game_type,
    gr.external_txid as external_tx_id,
    gr.external_data as external_response,
    gr.created_at,
    gr.played_at
  FROM game_records gr
  LEFT JOIN users u ON gr.user_id = u.id
  LEFT JOIN games g ON gr.game_id = g.id
  LEFT JOIN game_providers gp ON gr.provider_id = gp.id
  WHERE gr.id = betting_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_user_betting_history(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_betting_statistics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_game_betting_statistics(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_live_betting_status() TO authenticated;
GRANT EXECUTE ON FUNCTION get_partner_betting_statistics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_betting_detail(UUID) TO authenticated;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_game_records_user_played 
  ON game_records(user_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_records_game_played 
  ON game_records(game_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_records_played_at 
  ON game_records(played_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_records_round_id 
  ON game_records(game_round_id);

CREATE INDEX IF NOT EXISTS idx_game_records_external_txid 
  ON game_records(external_txid);

COMMENT ON FUNCTION get_user_betting_history IS '사용자의 베팅 내역을 조회합니다 (game_records 기반)';
COMMENT ON FUNCTION get_user_betting_statistics IS '사용자의 베팅 통계를 조회합니다 (game_records 기반)';
COMMENT ON FUNCTION get_game_betting_statistics IS '게임별 베팅 통계를 조회합니다 (game_records 기반)';
COMMENT ON FUNCTION get_live_betting_status IS '실시간 베팅 현황을 조회합니다 (game_records 기반)';
COMMENT ON FUNCTION get_partner_betting_statistics IS '파트너별 베팅 통계를 조회합니다 (game_records 기반)';
COMMENT ON FUNCTION get_betting_detail IS '베팅 내역 상세 정보를 조회합니다 (game_records 기반)';
