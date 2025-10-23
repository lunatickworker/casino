-- user_id 타입 불일치 오류 수정
-- game_launch_sessions.user_id는 UUID 타입이므로 함수 반환 타입을 수정

-- 기존 함수들 삭제
DROP FUNCTION IF EXISTS get_realtime_gaming_activity();
DROP FUNCTION IF EXISTS get_game_session_stats();
DROP FUNCTION IF EXISTS get_user_game_session_history(BIGINT, INTEGER);
DROP FUNCTION IF EXISTS get_user_game_session_history(UUID, INTEGER);

-- 1. 실시간 게임 활동 조회 함수 (UUID 타입으로 수정)
CREATE OR REPLACE FUNCTION get_realtime_gaming_activity()
RETURNS TABLE (
  session_id TEXT,
  user_id UUID,  -- BIGINT → UUID로 수정
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
    COALESCE(gls.session_id::TEXT, gls.id::TEXT) as session_id,  -- session_id가 없으면 id 사용
    gls.user_id,  -- UUID 타입 그대로 반환
    u.username,
    COALESCE(u.nickname, u.username) as nickname,
    COALESCE(g.name, 'Unknown Game') as game_name,
    COALESCE(gp.name, 'Unknown Provider') as provider_name,
    COALESCE(gls.balance_before, 0) as balance_before,
    COALESCE(u.balance, 0) as current_balance,
    COALESCE(EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60, 0) as session_duration_minutes,
    gls.launched_at
  FROM game_launch_sessions gls
  JOIN users u ON gls.user_id = u.id
  LEFT JOIN games g ON gls.game_id = g.id
  LEFT JOIN game_providers gp ON g.provider_id = gp.id
  WHERE COALESCE(gls.status, 'active') = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours'
  ORDER BY gls.launched_at DESC;
END;
$$;

-- 2. 게임 세션 통계 조회 함수 (UUID 타입으로 수정)
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
  SELECT COALESCE(gp.name, 'Unknown') INTO provider_with_most_sessions
  FROM game_launch_sessions gls
  LEFT JOIN games g ON gls.game_id = g.id
  LEFT JOIN game_providers gp ON g.provider_id = gp.id
  WHERE COALESCE(gls.status, 'active') = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours'
  GROUP BY gp.name
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
    COALESCE(SUM(COALESCE(u.balance, 0) - COALESCE(gls.balance_before, 0)), 0) as total_balance_change,
    COALESCE(provider_with_most_sessions, 'N/A') as top_provider,
    COALESCE(peak_time, NOW()) as peak_concurrent_time
  FROM game_launch_sessions gls
  JOIN users u ON gls.user_id = u.id
  WHERE COALESCE(gls.status, 'active') = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours';
END;
$$;

-- 3. 특정 사용자의 게임 세션 히스토리 조회 (UUID 타입으로 수정)
CREATE OR REPLACE FUNCTION get_user_game_session_history(
  target_user_id UUID,  -- BIGINT → UUID로 수정
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
    COALESCE(gls.session_id::TEXT, gls.id::TEXT) as session_id,
    COALESCE(g.name, 'Unknown Game') as game_name,
    COALESCE(gp.name, 'Unknown Provider') as provider_name,
    COALESCE(gls.balance_before, 0) as balance_before,
    COALESCE(gls.balance_after, 0) as balance_after,
    COALESCE(gls.balance_after - gls.balance_before, 0) as balance_change,
    CASE 
      WHEN gls.ended_at IS NOT NULL THEN 
        EXTRACT(EPOCH FROM (gls.ended_at - gls.launched_at))::INTEGER / 60
      ELSE 
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60
    END as session_duration_minutes,
    gls.launched_at,
    gls.ended_at,
    COALESCE(gls.status, 'active') as status
  FROM game_launch_sessions gls
  LEFT JOIN games g ON gls.game_id = g.id
  LEFT JOIN game_providers gp ON g.provider_id = gp.id
  WHERE gls.user_id = target_user_id
  ORDER BY gls.launched_at DESC
  LIMIT limit_count;
END;
$$;

-- 4. 게임 세션 강제 종료 함수 (UUID 타입으로 수정)
CREATE OR REPLACE FUNCTION admin_force_end_game_session(
  target_session_id TEXT,
  admin_user_id UUID,  -- BIGINT → UUID로 수정
  reason TEXT DEFAULT 'Admin terminated'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_user_id UUID;  -- BIGINT → UUID로 수정
  current_balance DECIMAL(15,2);
BEGIN
  -- 세션 정보 조회
  SELECT user_id INTO session_user_id
  FROM game_launch_sessions
  WHERE (session_id = target_session_id OR id::TEXT = target_session_id)
    AND COALESCE(status, 'active') = 'active';

  IF session_user_id IS NULL THEN
    RAISE NOTICE 'Session not found or already ended: %', target_session_id;
    RETURN FALSE;
  END IF;

  -- 현재 사용자 잔고 조회
  SELECT balance INTO current_balance
  FROM users
  WHERE id = session_user_id;

  -- 세션 종료 처리
  UPDATE game_launch_sessions
  SET 
    status = 'ended',
    ended_at = NOW(),
    balance_after = current_balance,
    notes = COALESCE(notes || ' | ', '') || 'Admin forced termination: ' || reason
  WHERE (session_id = target_session_id OR id::TEXT = target_session_id);

  -- 로그 메시지 출력
  RAISE NOTICE 'Admin % forced end session % for user % - reason: % - final balance: %', 
    admin_user_id, target_session_id, session_user_id, reason, current_balance;

  RETURN TRUE;
END;
$$;

-- 5. 권한 설정
GRANT EXECUTE ON FUNCTION get_realtime_gaming_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION get_game_session_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_game_session_history(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_force_end_game_session(TEXT, UUID, TEXT) TO authenticated;

-- 6. 완료 확인
SELECT 'user_id 타입 불일치 오류 수정 완료 - UUID 타입으로 통일' as status, NOW() as completed_at;