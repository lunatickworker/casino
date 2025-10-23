-- 실시간 게임 모니터링을 위한 함수들
-- 관리자가 현재 활성화된 게임 세션을 모니터링할 수 있는 기능

-- 기존 함수들 삭제 (타입 충돌 방지)
DROP FUNCTION IF EXISTS get_realtime_gaming_activity();
DROP FUNCTION IF EXISTS get_game_session_stats();
DROP FUNCTION IF EXISTS get_user_game_session_history(BIGINT, INTEGER);
DROP FUNCTION IF EXISTS admin_force_end_game_session(TEXT, BIGINT, TEXT);

-- 1. 실시간 게임 활동 조회 함수
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
    COALESCE(g.game_name, 'Unknown Game') as game_name,
    COALESCE(gp.provider_name, 'Unknown Provider') as provider_name,
    gls.balance_before,
    u.balance as current_balance,
    EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60 as session_duration_minutes,
    gls.launched_at
  FROM game_launch_sessions gls
  JOIN users u ON gls.user_id = u.id
  LEFT JOIN games g ON gls.game_id = g.game_id
  LEFT JOIN game_providers gp ON g.provider_id = gp.provider_id
  WHERE gls.status = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours'
  ORDER BY gls.launched_at DESC;
END;
$$;

-- 2. 게임 세션 통계 조회 함수
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
  SELECT gp.provider_name INTO provider_with_most_sessions
  FROM game_launch_sessions gls
  JOIN games g ON gls.game_id = g.game_id
  JOIN game_providers gp ON g.provider_id = gp.provider_id
  WHERE gls.status = 'active'
    AND gls.launched_at > NOW() - INTERVAL '24 hours'
  GROUP BY gp.provider_name
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

-- 3. 특정 사용자의 게임 세션 히스토리 조회
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
    COALESCE(g.game_name, 'Unknown Game') as game_name,
    COALESCE(gp.provider_name, 'Unknown Provider') as provider_name,
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
  LEFT JOIN games g ON gls.game_id = g.game_id
  LEFT JOIN game_providers gp ON g.provider_id = gp.provider_id
  WHERE gls.user_id = target_user_id
  ORDER BY gls.launched_at DESC
  LIMIT limit_count;
END;
$$;

-- 4. 게임 세션 강제 종료 함수 (관리자 전용)
CREATE OR REPLACE FUNCTION admin_force_end_game_session(
  target_session_id TEXT,
  admin_user_id BIGINT,
  reason TEXT DEFAULT 'Admin terminated'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_user_id BIGINT;
  current_balance DECIMAL(15,2);
BEGIN
  -- 세션 정보 조회
  SELECT user_id INTO session_user_id
  FROM game_launch_sessions
  WHERE session_id = target_session_id
    AND status = 'active';

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
  WHERE session_id = target_session_id;

  -- 로그 기록 (system_logs 테이블이 없어 주석 처리)
  -- INSERT INTO system_logs (
  --   action_type,
  --   user_id,
  --   details,
  --   created_at
  -- ) VALUES (
  --   'admin_force_end_session',
  --   admin_user_id,
  --   jsonb_build_object(
  --     'session_id', target_session_id,
  --     'target_user_id', session_user_id,
  --     'reason', reason,
  --     'final_balance', current_balance
  --   ),
  --   NOW()
  -- );

  -- 로그 메시지 출력으로 대체
  RAISE NOTICE 'Admin % forced end session % for user % - reason: % - final balance: %', 
    admin_user_id, target_session_id, session_user_id, reason, current_balance;

  RETURN TRUE;
END;
$$;

-- 5. 실시간 알림을 위한 트리거 함수
CREATE OR REPLACE FUNCTION notify_game_session_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  notification_payload TEXT;
BEGIN
  -- 새로운 세션 시작 알림
  IF TG_OP = 'INSERT' THEN
    notification_payload := json_build_object(
      'type', 'game_session_start',
      'session_id', NEW.session_id,
      'user_id', NEW.user_id,
      'game_id', NEW.game_id,
      'balance_before', NEW.balance_before,
      'launched_at', NEW.launched_at
    )::TEXT;
    
    PERFORM pg_notify('game_session_updates', notification_payload);
    RETURN NEW;
  END IF;

  -- 세션 종료 알림
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'ended' THEN
    notification_payload := json_build_object(
      'type', 'game_session_end',
      'session_id', NEW.session_id,
      'user_id', NEW.user_id,
      'game_id', NEW.game_id,
      'balance_before', NEW.balance_before,
      'balance_after', NEW.balance_after,
      'session_duration', EXTRACT(EPOCH FROM (NEW.ended_at - NEW.launched_at)),
      'ended_at', NEW.ended_at
    )::TEXT;
    
    PERFORM pg_notify('game_session_updates', notification_payload);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- 6. 게임 세션 테이블에 트리거 추가
DROP TRIGGER IF EXISTS game_session_notify_trigger ON game_launch_sessions;
CREATE TRIGGER game_session_notify_trigger
  AFTER INSERT OR UPDATE ON game_launch_sessions
  FOR EACH ROW
  EXECUTE FUNCTION notify_game_session_change();

-- 7. 권한 설정
-- 모든 관리자는 실시간 게임 모니터링 함수를 사용할 수 있음
GRANT EXECUTE ON FUNCTION get_realtime_gaming_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION get_game_session_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_game_session_history(BIGINT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_force_end_game_session(TEXT, BIGINT, TEXT) TO authenticated;

-- 8. 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_status_launched_at 
ON game_launch_sessions(status, launched_at DESC) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_user_id_launched_at 
ON game_launch_sessions(user_id, launched_at DESC);

-- 9. 완료 로그 (system_logs 테이블이 없어 주석 처리)
-- INSERT INTO system_logs (action_type, details, created_at)
-- VALUES (
--   'schema_update', 
--   '실시간 게임 모니터링 함수 및 트리거 생성 완료',
--   NOW()
-- );

-- 완료 확인용 SELECT문으로 대체
SELECT '실시간 게임 모니터링 함수 및 트리거 생성 완료' as status, NOW() as completed_at;