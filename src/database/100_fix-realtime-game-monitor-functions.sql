-- 실시간 게임 모니터링 함수 오류 수정
-- games 테이블과 game_providers 테이블의 올바른 컬럼명으로 수정

-- 기존 함수들 삭제
DROP FUNCTION IF EXISTS get_realtime_gaming_activity();
DROP FUNCTION IF EXISTS get_game_session_stats();

-- 1. 실시간 게임 활동 조회 함수 (수정됨)
CREATE OR REPLACE FUNCTION get_realtime_gaming_activity()
RETURNS TABLE (
  session_id TEXT,
  user_id BIGINT,
  username TEXT,
  nickname TEXT,
  game_name TEXT,
  provider_name TEXT,
  balance_before DECIMAL(15,2),
  current_balance DECIMAL(15,2),
  session_duration_minutes INTEGER,
  launched_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gls.session_id::TEXT,
    gls.user_id,
    u.username,
    COALESCE(u.nickname, u.username) as nickname,
    COALESCE(g.name, 'Unknown Game') as game_name,  -- g.game_id → g.name으로 수정
    COALESCE(gp.name, 'Unknown Provider') as provider_name,  -- gp.provider_name → gp.name으로 수정
    gls.balance_before,
    u.balance as current_balance,
    EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60 as session_duration_minutes,
    gls.launched_at
  FROM game_launch_sessions gls
  JOIN users u ON gls.user_id = u.id
  LEFT JOIN games g ON gls.game_id = g.id  -- g.game_id → g.id로 수정
  LEFT JOIN game_providers gp ON g.provider_id = gp.id  -- gp.provider_id → gp.id로 수정
  WHERE gls.status = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours'
  ORDER BY gls.launched_at DESC;
END;
$$;

-- 2. 게임 세션 통계 조회 함수 (수정됨)
CREATE OR REPLACE FUNCTION get_game_session_stats()
RETURNS TABLE (
  total_active_sessions INTEGER,
  total_active_players INTEGER,
  avg_session_duration_minutes INTEGER,
  total_balance_change DECIMAL(15,2),
  top_provider TEXT,
  peak_concurrent_time TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  provider_with_most_sessions TEXT;
  peak_time TIMESTAMPTZ;
BEGIN
  -- 가장 많은 세션을 가진 프로바이더 찾기
  SELECT gp.name INTO provider_with_most_sessions  -- gp.provider_name → gp.name으로 수정
  FROM game_launch_sessions gls
  JOIN games g ON gls.game_id = g.id  -- g.game_id → g.id로 수정
  JOIN game_providers gp ON g.provider_id = gp.id  -- gp.provider_id → gp.id로 수정
  WHERE gls.status = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours'
  GROUP BY gp.name  -- gp.provider_name → gp.name으로 수정
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- 최고 동시 접속 시간 계산 (최근 24시간)
  SELECT time_bucket INTO peak_time
  FROM (
    SELECT 
      date_trunc('hour', launched_at) as time_bucket,
      COUNT(*) as concurrent_sessions
    FROM game_launch_sessions
    WHERE launched_at > NOW() - INTERVAL '24 hours'
    GROUP BY date_trunc('hour', launched_at)
    ORDER BY concurrent_sessions DESC
    LIMIT 1
  ) peak_analysis;

  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_active_sessions,
    COUNT(DISTINCT gls.user_id)::INTEGER as total_active_players,
    COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - gls.launched_at)) / 60)::INTEGER, 0) as avg_session_duration_minutes,
    COALESCE(SUM(u.balance - gls.balance_before), 0) as total_balance_change,
    COALESCE(provider_with_most_sessions, 'N/A') as top_provider,
    COALESCE(peak_time, NOW()) as peak_concurrent_time
  FROM game_launch_sessions gls
  JOIN users u ON gls.user_id = u.id
  WHERE gls.status = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours';
END;
$$;

-- 3. 특정 사용자의 게임 세션 히스토리 조회 (수정됨)
CREATE OR REPLACE FUNCTION get_user_game_session_history(
  target_user_id BIGINT,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
  session_id TEXT,
  game_name TEXT,
  provider_name TEXT,
  balance_before DECIMAL(15,2),
  balance_after DECIMAL(15,2),
  balance_change DECIMAL(15,2),
  session_duration_minutes INTEGER,
  launched_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gls.session_id::TEXT,
    COALESCE(g.name, 'Unknown Game') as game_name,  -- g.game_name → g.name으로 수정
    COALESCE(gp.name, 'Unknown Provider') as provider_name,  -- gp.provider_name → gp.name으로 수정
    gls.balance_before,
    gls.balance_after,
    COALESCE(gls.balance_after - gls.balance_before, 0) as balance_change,
    CASE 
      WHEN gls.ended_at IS NOT NULL THEN 
        EXTRACT(EPOCH FROM (gls.ended_at - gls.launched_at))::INTEGER / 60
      ELSE 
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60
    END as session_duration_minutes,
    gls.launched_at,
    gls.ended_at,
    gls.status
  FROM game_launch_sessions gls
  LEFT JOIN games g ON gls.game_id = g.id  -- g.game_id → g.id로 수정
  LEFT JOIN game_providers gp ON g.provider_id = gp.id  -- gp.provider_id → gp.id로 수정
  WHERE gls.user_id = target_user_id
  ORDER BY gls.launched_at DESC
  LIMIT limit_count;
END;
$$;

-- 4. session_id 컬럼이 없을 경우를 대비한 추가 확인 및 수정
-- game_launch_sessions 테이블에 session_id 컬럼이 없다면 id를 사용
DO $$
BEGIN
  -- session_id 컬럼이 없다면 id를 문자열로 변환하여 사용하는 함수로 재생성
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_launch_sessions' AND column_name = 'session_id'
  ) THEN
    
    -- 기존 함수 삭제
    DROP FUNCTION IF EXISTS get_realtime_gaming_activity();
    
    -- session_id 대신 id를 사용하는 버전으로 재생성
    CREATE OR REPLACE FUNCTION get_realtime_gaming_activity()
    RETURNS TABLE (
      session_id TEXT,
      user_id BIGINT,
      username TEXT,
      nickname TEXT,
      game_name TEXT,
      provider_name TEXT,
      balance_before DECIMAL(15,2),
      current_balance DECIMAL(15,2),
      session_duration_minutes INTEGER,
      launched_at TIMESTAMPTZ
    ) 
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func$
    BEGIN
      RETURN QUERY
      SELECT 
        gls.id::TEXT as session_id,  -- session_id 대신 id 사용
        gls.user_id,
        u.username,
        COALESCE(u.nickname, u.username) as nickname,
        COALESCE(g.name, 'Unknown Game') as game_name,
        COALESCE(gp.name, 'Unknown Provider') as provider_name,
        gls.balance_before,
        u.balance as current_balance,
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60 as session_duration_minutes,
        gls.launched_at
      FROM game_launch_sessions gls
      JOIN users u ON gls.user_id = u.id
      LEFT JOIN games g ON gls.game_id = g.id
      LEFT JOIN game_providers gp ON g.provider_id = gp.id
      WHERE gls.status = 'active'
        AND gls.launched_at > NOW() - INTERVAL '24 hours'
      ORDER BY gls.launched_at DESC;
    END;
    $func$;
    
  END IF;
END $$;

-- 5. 권한 설정
GRANT EXECUTE ON FUNCTION get_realtime_gaming_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION get_game_session_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_game_session_history(BIGINT, INTEGER) TO authenticated;

-- 6. 완료 확인
SELECT '실시간 게임 모니터링 함수 오류 수정 완료' as status, NOW() as completed_at;