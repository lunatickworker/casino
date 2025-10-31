-- ============================================================================
-- 340. 간단한 세션 상태 진단
-- ============================================================================

-- 1. 현재 active 세션 수
SELECT 
    '현재 active 세션' as 구분,
    COUNT(*) as 개수
FROM game_launch_sessions
WHERE status = 'active';

-- 2. 30초 이상 비활성 세션 수
SELECT 
    '30초 이상 비활성 세션' as 구분,
    COUNT(*) as 개수
FROM game_launch_sessions
WHERE status = 'active'
  AND last_activity_at < NOW() - INTERVAL '30 seconds';

-- 3. active 세션 상세 정보 (최대 5개)
SELECT 
    id,
    user_id,
    status,
    launched_at,
    last_activity_at,
    EXTRACT(EPOCH FROM (NOW() - last_activity_at)) as 비활성_초,
    NOW() as 현재_시간,
    CASE 
        WHEN last_activity_at < NOW() - INTERVAL '30 seconds' THEN '⚠️ 종료대상'
        ELSE '✅ 활성'
    END as 판정
FROM game_launch_sessions
WHERE status = 'active'
ORDER BY last_activity_at DESC
LIMIT 5;

-- 4. 강제 종료 실행 (주석 제거하여 실행)
-- UPDATE game_launch_sessions
-- SET 
--     status = 'auto_ended',
--     ended_at = NOW()
-- WHERE status = 'active'
--   AND last_activity_at < NOW() - INTERVAL '30 seconds'
-- RETURNING id, user_id, 
--     EXTRACT(EPOCH FROM (NOW() - last_activity_at)) as 비활성_초;

-- 5. 트리거 상태 확인
SELECT 
    tgname as 트리거명,
    CASE 
        WHEN tgenabled = 'O' THEN '✅ 활성화'
        ELSE '⚠️ 비활성화'
    END as 상태
FROM pg_trigger
WHERE tgrelid = 'game_launch_sessions'::regclass
  AND tgname NOT LIKE 'RI_%'
ORDER BY tgname;

-- 6. RLS 상태 확인
SELECT 
    'game_launch_sessions' as 테이블,
    CASE 
        WHEN relrowsecurity THEN '⚠️ RLS 활성화'
        ELSE '✅ RLS 비활성화'
    END as RLS상태
FROM pg_class
WHERE relname = 'game_launch_sessions';

-- 7. game_records 트리거 확인
SELECT 
    tgname as 트리거명,
    CASE 
        WHEN tgenabled = 'O' THEN '✅ 활성화'
        ELSE '⚠️ 비활성화'
    END as 상태
FROM pg_trigger
WHERE tgrelid = 'game_records'::regclass
  AND tgname NOT LIKE 'RI_%'
ORDER BY tgname;
