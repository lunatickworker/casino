-- ============================================================================
-- 341. 세션 데이터 직접 확인 (간단 버전)
-- ============================================================================

-- 1️⃣ 현재 active 세션 수
SELECT COUNT(*) as "active_세션수"
FROM game_launch_sessions
WHERE status = 'active';

-- 2️⃣ 30초 이상 비활성 세션 수
SELECT COUNT(*) as "종료대상_세션수"
FROM game_launch_sessions
WHERE status = 'active'
  AND last_activity_at < NOW() - INTERVAL '30 seconds';

-- 3️⃣ 모든 active 세션 상세 정보
SELECT 
    id,
    user_id,
    session_id,
    status,
    TO_CHAR(launched_at, 'YYYY-MM-DD HH24:MI:SS') as "시작시간",
    TO_CHAR(last_activity_at, 'YYYY-MM-DD HH24:MI:SS') as "마지막활동",
    TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS') as "현재시간",
    ROUND(EXTRACT(EPOCH FROM (NOW() - last_activity_at))) as "비활성_초",
    CASE 
        WHEN last_activity_at < NOW() - INTERVAL '30 seconds' THEN '⚠️ 종료필요'
        ELSE '✅ 활성중'
    END as "상태"
FROM game_launch_sessions
WHERE status = 'active'
ORDER BY last_activity_at DESC;

-- 4️⃣ 모든 상태별 세션 수
SELECT 
    status,
    COUNT(*) as 개수
FROM game_launch_sessions
GROUP BY status
ORDER BY COUNT(*) DESC;
