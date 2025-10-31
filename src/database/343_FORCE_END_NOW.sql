-- ============================================================================
-- 343. 즉시 비활성 세션 강제 종료
-- ============================================================================

-- 강제 종료 실행
UPDATE game_launch_sessions
SET 
    status = 'auto_ended',
    ended_at = NOW()
WHERE status = 'active'
  AND last_activity_at < NOW() - INTERVAL '30 seconds'
RETURNING 
    id, 
    user_id,
    ROUND(EXTRACT(EPOCH FROM (NOW() - last_activity_at))) as "비활성_초",
    TO_CHAR(last_activity_at, 'HH24:MI:SS') as "마지막활동",
    TO_CHAR(NOW(), 'HH24:MI:SS') as "종료시간";
