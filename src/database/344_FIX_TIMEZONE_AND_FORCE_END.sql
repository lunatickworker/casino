-- ============================================================================
-- 344. 타임존 문제 해결 + 비활성 세션 강제 종료
-- ============================================================================

-- 문제: last_activity_at이 한국 시간(KST)으로 저장되어 UTC 비교가 불가능
-- 해결: UTC로 통일

-- 1. 현재 상태 확인
SELECT 
    id,
    session_id,
    user_id,
    status,
    last_activity_at,
    last_activity_at AT TIME ZONE 'UTC' as last_activity_utc,
    NOW() as current_time_utc,
    EXTRACT(EPOCH FROM (NOW() - last_activity_at)) as seconds_diff
FROM game_launch_sessions
WHERE status = 'active'
ORDER BY last_activity_at DESC;

-- 2. 미래 시간으로 저장된 데이터 수정 (KST를 UTC로 변환)
-- 예: 2025-10-30 14:54:05+00:00 (잘못된 UTC) → 2025-10-30 05:54:05+00:00 (올바른 UTC)
UPDATE game_launch_sessions
SET last_activity_at = last_activity_at - INTERVAL '9 hours'
WHERE status = 'active'
  AND last_activity_at > NOW()  -- 미래 시간인 것들만
RETURNING 
    id, 
    session_id,
    last_activity_at as corrected_time;

-- 3. 30초 이상 비활성 세션 강제 종료
UPDATE game_launch_sessions
SET 
    status = 'auto_ended',
    ended_at = NOW()
WHERE status = 'active'
  AND last_activity_at < NOW() - INTERVAL '30 seconds'
RETURNING 
    id, 
    user_id,
    session_id,
    ROUND(EXTRACT(EPOCH FROM (NOW() - last_activity_at))) as "비활성_초",
    TO_CHAR(last_activity_at, 'YYYY-MM-DD HH24:MI:SS TZ') as "마지막활동",
    TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS TZ') as "종료시간";

-- 4. 결과 확인
SELECT 
    COUNT(*) FILTER (WHERE status = 'active') as active_sessions,
    COUNT(*) FILTER (WHERE status = 'auto_ended') as auto_ended_sessions,
    COUNT(*) FILTER (WHERE status = 'ended') as ended_sessions,
    COUNT(*) FILTER (WHERE status = 'force_ended') as force_ended_sessions
FROM game_launch_sessions;

-- 5. 타임존 설정 확인
SHOW timezone;

-- 6. 앞으로 방지하기 위한 체크: last_activity_at이 미래 시간이면 경고
DO $$
DECLARE
    v_future_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_future_count
    FROM game_launch_sessions
    WHERE last_activity_at > NOW() AND status = 'active';
    
    IF v_future_count > 0 THEN
        RAISE WARNING '⚠️ 미래 시간으로 저장된 active 세션 %건 발견!', v_future_count;
    ELSE
        RAISE NOTICE '✅ 모든 세션의 시간이 올바르게 설정됨';
    END IF;
END $$;
