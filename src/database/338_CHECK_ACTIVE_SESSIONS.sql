-- ============================================================================
-- 338. 현재 active 세션 직접 확인
-- ============================================================================

-- 현재 active 세션 조회
SELECT 
    id,
    user_id,
    session_id,
    status,
    launched_at,
    last_activity_at,
    ended_at,
    EXTRACT(EPOCH FROM (NOW() - last_activity_at)) as "비활성_초",
    CASE 
        WHEN last_activity_at < NOW() - INTERVAL '30 seconds' THEN '종료대상'
        ELSE '활성'
    END as "상태판정"
FROM game_launch_sessions
WHERE status = 'active'
ORDER BY last_activity_at DESC;

-- 강제 종료 실행
UPDATE game_launch_sessions
SET 
    status = 'auto_ended',
    ended_at = NOW()
WHERE status = 'active'
  AND last_activity_at < NOW() - INTERVAL '30 seconds'
RETURNING id, user_id, session_id, 
    EXTRACT(EPOCH FROM (NOW() - last_activity_at)) as "비활성_초";
