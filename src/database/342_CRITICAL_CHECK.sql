-- ============================================================================
-- 342. 핵심 정보만 확인 (한 번에)
-- ============================================================================

-- active 세션의 비활성 시간 확인
SELECT 
    id,
    ROUND(EXTRACT(EPOCH FROM (NOW() - last_activity_at))) as "비활성_초",
    CASE 
        WHEN last_activity_at < NOW() - INTERVAL '30 seconds' THEN '⚠️ 종료필요'
        ELSE '✅ 활성중'
    END as "판정",
    TO_CHAR(last_activity_at, 'HH24:MI:SS') as "마지막활동시간",
    TO_CHAR(NOW(), 'HH24:MI:SS') as "현재시간"
FROM game_launch_sessions
WHERE status = 'active';
