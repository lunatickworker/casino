-- 실시간 현황 대시보드를 위한 데이터베이스 함수들

-- 1. 사용자 통계 함수
CREATE OR REPLACE FUNCTION get_user_statistics()
RETURNS TABLE (
  total_users bigint,
  new_users_today bigint,
  active_users bigint
)
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT 
    (SELECT COUNT(*) FROM users)::bigint as total_users,
    (SELECT COUNT(*) FROM users WHERE created_at::date = CURRENT_DATE)::bigint as new_users_today,
    (SELECT COUNT(*) FROM users WHERE last_login_at > NOW() - INTERVAL '7 days')::bigint as active_users;
$;

-- 2. 매출 통계 함수
CREATE OR REPLACE FUNCTION get_revenue_statistics()
RETURNS TABLE (
  today_revenue numeric,
  yesterday_revenue numeric,
  week_revenue numeric,
  month_revenue numeric,
  year_revenue numeric
)
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT 
    COALESCE((SELECT SUM(bet_amount) FROM game_records 
              WHERE played_at::date = CURRENT_DATE), 0) as today_revenue,
    
    COALESCE((SELECT SUM(bet_amount) FROM game_records 
              WHERE played_at::date = CURRENT_DATE - INTERVAL '1 day'), 0) as yesterday_revenue,
    
    COALESCE((SELECT SUM(bet_amount) FROM game_records 
              WHERE played_at >= date_trunc('week', CURRENT_DATE)), 0) as week_revenue,
    
    COALESCE((SELECT SUM(bet_amount) FROM game_records 
              WHERE played_at >= date_trunc('month', CURRENT_DATE)), 0) as month_revenue,
    
    COALESCE((SELECT SUM(bet_amount) FROM game_records 
              WHERE played_at >= date_trunc('year', CURRENT_DATE)), 0) as year_revenue;
$;

-- 3. 게임 통계 함수
CREATE OR REPLACE FUNCTION get_game_statistics()
RETURNS TABLE (
  total_games bigint,
  active_games bigint,
  total_bets bigint,
  total_wins bigint,
  active_sessions bigint
)
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT 
    (SELECT COUNT(*) FROM games WHERE status = 'visible')::bigint as total_games,
    (SELECT COUNT(DISTINCT game_id) FROM game_records WHERE played_at::date = CURRENT_DATE)::bigint as active_games,
    (SELECT COUNT(*) FROM game_records WHERE played_at::date = CURRENT_DATE)::bigint as total_bets,
    (SELECT COUNT(*) FROM game_records WHERE played_at::date = CURRENT_DATE AND win_amount > 0)::bigint as total_wins,
    (SELECT COUNT(DISTINCT user_id) FROM game_records WHERE played_at > NOW() - INTERVAL '1 hour')::bigint as active_sessions;
$;

-- 4. 커미션 통계 함수
CREATE OR REPLACE FUNCTION get_commission_statistics()
RETURNS TABLE (
  pending_commission numeric,
  total_commission numeric,
  monthly_commission numeric,
  partner_count bigint
)
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT 
    COALESCE((SELECT SUM(commission_amount) FROM settlements 
              WHERE status = 'pending'), 0) as pending_commission,
    
    COALESCE((SELECT SUM(commission_amount) FROM settlements 
              WHERE status = 'completed'), 0) as total_commission,
    
    COALESCE((SELECT SUM(commission_amount) FROM settlements 
              WHERE status = 'completed' 
              AND created_at >= date_trunc('month', CURRENT_DATE)), 0) as monthly_commission,
    
    (SELECT COUNT(*) FROM partners WHERE partner_type IN ('head_office', 'main_office', 'sub_office', 'distributor', 'store'))::bigint as partner_count;
$;

-- 5. 거래 통계 함수
CREATE OR REPLACE FUNCTION get_transaction_statistics()
RETURNS TABLE (
  pending_deposits bigint,
  pending_withdrawals bigint,
  completed_deposits bigint,
  completed_withdrawals bigint,
  total_deposit_amount numeric,
  total_withdrawal_amount numeric
)
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT 
    (SELECT COUNT(*) FROM transactions WHERE transaction_type = 'deposit' AND status = 'pending')::bigint as pending_deposits,
    (SELECT COUNT(*) FROM transactions WHERE transaction_type = 'withdrawal' AND status = 'pending')::bigint as pending_withdrawals,
    (SELECT COUNT(*) FROM transactions WHERE transaction_type = 'deposit' AND status = 'completed' AND created_at::date = CURRENT_DATE)::bigint as completed_deposits,
    (SELECT COUNT(*) FROM transactions WHERE transaction_type = 'withdrawal' AND status = 'completed' AND created_at::date = CURRENT_DATE)::bigint as completed_withdrawals,
    COALESCE((SELECT SUM(amount) FROM transactions WHERE transaction_type = 'deposit' AND status = 'completed' AND created_at::date = CURRENT_DATE), 0) as total_deposit_amount,
    COALESCE((SELECT SUM(amount) FROM transactions WHERE transaction_type = 'withdrawal' AND status = 'completed' AND created_at::date = CURRENT_DATE), 0) as total_withdrawal_amount;
$;

-- 6. 게임 중인 사용자 수 조회 함수
CREATE OR REPLACE FUNCTION get_active_gaming_users_count()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT COUNT(DISTINCT user_id)::bigint 
  FROM game_records 
  WHERE played_at > NOW() - INTERVAL '5 minutes';
$;

-- 7. 최근 활동 조회 함수
CREATE OR REPLACE FUNCTION get_recent_activities(limit_count integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  type text,
  user_username text,
  amount numeric,
  status text,
  created_at timestamptz,
  description text
)
LANGUAGE sql SECURITY DEFINER
AS $
  (SELECT 
    t.id,
    t.transaction_type as type,
    u.username as user_username,
    t.amount,
    t.status,
    t.created_at,
    CASE 
      WHEN t.transaction_type = 'deposit' THEN '입금 요청'
      WHEN t.transaction_type = 'withdrawal' THEN '출금 요청'
      WHEN t.transaction_type = 'point_conversion' THEN '포인트 전환'
      WHEN t.transaction_type = 'admin_adjustment' THEN '관리자 조정'
      ELSE '기타 거래'
    END as description
  FROM transactions t
  LEFT JOIN users u ON t.user_id = u.id
  WHERE t.created_at >= CURRENT_DATE - INTERVAL '1 day'
  ORDER BY t.created_at DESC
  LIMIT limit_count/2)
  
  UNION ALL
  
  (SELECT 
    gr.id,
    'bet' as type,
    u.username as user_username,
    gr.bet_amount as amount,
    'completed' as status,
    gr.created_at,
    CASE 
      WHEN gr.win_amount > 0 THEN '게임 당첨'
      ELSE '게임 베팅'
    END as description
  FROM game_records gr
  LEFT JOIN users u ON gr.user_id = u.id
  WHERE gr.created_at >= CURRENT_DATE - INTERVAL '1 day'
  ORDER BY gr.created_at DESC
  LIMIT limit_count/2)
  
  ORDER BY created_at DESC
  LIMIT limit_count;
$;

-- 8. 실시간 게임 활동 조회 함수 (기존에 있다면 수정, 없다면 생성)
DROP FUNCTION IF EXISTS get_realtime_gaming_activity();

CREATE OR REPLACE FUNCTION get_realtime_gaming_activity()
RETURNS TABLE (
  user_id uuid,
  username text,
  nickname text,
  game_name text,
  provider_name text,
  session_start timestamptz,
  last_activity timestamptz,
  total_bet numeric,
  total_win numeric,
  current_balance numeric
)
LANGUAGE sql SECURITY DEFINER
AS $
  SELECT 
    gr.user_id,
    u.username,
    u.nickname,
    g.name as game_name,
    gp.name as provider_name,
    MIN(gr.played_at) as session_start,
    MAX(gr.played_at) as last_activity,
    COALESCE(SUM(gr.bet_amount), 0) as total_bet,
    COALESCE(SUM(gr.win_amount), 0) as total_win,
    u.balance as current_balance
  FROM game_records gr
  LEFT JOIN users u ON gr.user_id = u.id
  LEFT JOIN games g ON gr.game_id = g.id
  LEFT JOIN game_providers gp ON g.provider_id = gp.id
  WHERE gr.played_at > NOW() - INTERVAL '30 minutes'
  GROUP BY gr.user_id, u.username, u.nickname, g.name, gp.name, u.balance
  ORDER BY MAX(gr.played_at) DESC;
$;

-- 9. 시스템 상태 확인 함수
CREATE OR REPLACE FUNCTION get_system_health()
RETURNS TABLE (
  database_health numeric,
  active_connections integer,
  avg_response_time numeric,
  error_rate numeric,
  last_check timestamptz
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT 
    98.5 as database_health, -- 실제 환경에서는 더 정교한 계산 필요
    (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active')::integer as active_connections,
    0.15 as avg_response_time, -- 실제 환경에서는 측정된 값 사용
    0.02 as error_rate, -- 실제 환경에서는 로그 분석 결과 사용
    NOW() as last_check;
$$;

-- RLS 정책 설정 (필요한 경우)
-- 이미 설정된 RLS가 있다면 수정하지 않음

-- 함수 실행 권한 부여
GRANT EXECUTE ON FUNCTION get_user_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_game_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_commission_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_transaction_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_gaming_users_count() TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_activities(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_realtime_gaming_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION get_system_health() TO authenticated;