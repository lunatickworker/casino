-- ============================================================================
-- 190. pg_cron을 활용한 자동 세션 관리 (Edge Function 불필요)
-- ============================================================================
-- 작성일: 2025-10-11
-- 목적: 
--   PostgreSQL pg_cron 확장을 사용하여 자동 세션 관리
--   Edge Function 없이 순수 DB 레벨에서 스케줄링
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '190. 자동 세션 관리 스케줄러 설정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: pg_cron 확장 활성화 확인
-- ============================================

-- pg_cron 확장 생성 (이미 있으면 무시)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        RAISE NOTICE '✅ pg_cron 확장 활성화됨';
    ELSE
        RAISE WARNING '⚠️ pg_cron 확장을 수동으로 활성화해야 합니다.';
        RAISE WARNING 'Supabase Dashboard → Database → Extensions → pg_cron 활성화';
    END IF;
END $$;

-- ============================================
-- 2단계: 기존 스케줄 삭제 (중복 방지)
-- ============================================================================

-- 기존 세션 관리 스케줄 삭제
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname IN (
    'manage-game-sessions-5min',
    'manage-game-sessions-30min',
    'expire-inactive-sessions',
    'cleanup-old-sessions'
);

DO $
BEGIN
    RAISE NOTICE '✅ 기존 스케줄 정리 완료';
END $;

-- ============================================
-- 3단계: 5분마다 비활성 세션 종료 + 오래된 세션 삭제
-- ============================================

-- 통합 관리 함수를 5분마다 실행
SELECT cron.schedule(
    'manage-game-sessions-5min',  -- 작업 이름
    '*/5 * * * *',                 -- 5분마다 실행 (cron 표현식)
    $
    SELECT manage_game_sessions();
    $
);

DO $
BEGIN
    RAISE NOTICE '✅ 5분 주기 세션 관리 스케줄 등록';
    RAISE NOTICE '   - 5분 비활성 세션 자동 종료';
    RAISE NOTICE '   - 30분 경과 세션 자동 삭제';
END $;

-- ============================================
-- 4단계: 일일 세션 통계 로그 (선택사항)
-- ============================================

-- 세션 통계를 매일 자정에 로그 테이블에 저장 (선택사항)
DO $$
BEGIN
    -- session_stats_logs 테이블 생성 (없을 경우만)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'session_stats_logs'
    ) THEN
        CREATE TABLE session_stats_logs (
            id BIGSERIAL PRIMARY KEY,
            log_date DATE NOT NULL DEFAULT CURRENT_DATE,
            total_sessions INTEGER DEFAULT 0,
            active_sessions INTEGER DEFAULT 0,
            ended_sessions INTEGER DEFAULT 0,
            expired_sessions INTEGER DEFAULT 0,
            avg_session_duration_minutes INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX idx_session_stats_logs_date ON session_stats_logs(log_date);
        
        RAISE NOTICE '✅ session_stats_logs 테이블 생성';
    ELSE
        RAISE NOTICE '⏭️ session_stats_logs 테이블 이미 존재';
    END IF;
END $$;

-- 매일 자정에 통계 저장 (선택사항)
SELECT cron.schedule(
    'daily-session-stats',
    '0 0 * * *',  -- 매일 00:00
    $$
    INSERT INTO session_stats_logs (
        log_date,
        total_sessions,
        active_sessions,
        ended_sessions,
        expired_sessions,
        avg_session_duration_minutes
    )
    SELECT 
        CURRENT_DATE - INTERVAL '1 day' as log_date,
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE status = 'active') as active_sessions,
        COUNT(*) FILTER (WHERE status = 'ended') as ended_sessions,
        COUNT(*) FILTER (WHERE status = 'expired') as expired_sessions,
        COALESCE(
            AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - launched_at)) / 60)::INTEGER,
            0
        ) as avg_session_duration_minutes
    FROM game_launch_sessions
    WHERE launched_at >= CURRENT_DATE - INTERVAL '1 day'
    AND launched_at < CURRENT_DATE;
    $
);

DO $
BEGIN
    RAISE NOTICE '✅ 일일 통계 로그 스케줄 등록 (선택사항)';
END $;

-- ============================================
-- 5단계: 스케줄 등록 확인
-- ============================================

DO $$
DECLARE
    v_schedule_count INTEGER;
    schedule_record RECORD;
BEGIN
    SELECT COUNT(*) INTO v_schedule_count
    FROM cron.job
    WHERE jobname LIKE 'manage-game-sessions%' OR jobname = 'daily-session-stats';
    
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '📋 등록된 스케줄 목록';
    RAISE NOTICE '============================================';
    
    FOR schedule_record IN 
        SELECT 
            jobid,
            jobname,
            schedule,
            command,
            active
        FROM cron.job
        WHERE jobname LIKE 'manage-game-sessions%' OR jobname = 'daily-session-stats'
        ORDER BY jobname
    LOOP
        RAISE NOTICE '작업 ID: %', schedule_record.jobid;
        RAISE NOTICE '작업명: %', schedule_record.jobname;
        RAISE NOTICE '주기: %', schedule_record.schedule;
        RAISE NOTICE '활성: %', schedule_record.active;
        RAISE NOTICE '--------------------------------------------';
    END LOOP;
    
    IF v_schedule_count = 0 THEN
        RAISE WARNING '⚠️ 등록된 스케줄이 없습니다. pg_cron 확장을 확인하세요.';
    ELSE
        RAISE NOTICE '✅ 총 % 개의 스케줄이 등록되었습니다.', v_schedule_count;
    END IF;
    
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 6단계: 즉시 테스트 실행
-- ============================================

DO $$
DECLARE
    v_test_result RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🧪 테스트 실행: manage_game_sessions()';
    RAISE NOTICE '--------------------------------------------';
    
    FOR v_test_result IN 
        SELECT * FROM manage_game_sessions()
    LOOP
        RAISE NOTICE '결과: %', v_test_result.message;
        RAISE NOTICE '  - 종료된 세션: % 건', v_test_result.expired_count;
        RAISE NOTICE '  - 삭제된 세션: % 건', v_test_result.deleted_count;
        RAISE NOTICE '  - 현재 활성 세션: % 건', v_test_result.total_active;
    END LOOP;
    
    RAISE NOTICE '--------------------------------------------';
    RAISE NOTICE '✅ 테스트 완료';
END $$;

-- ============================================
-- 7단계: 스케줄 실행 이력 확인 함수
-- ============================================

CREATE OR REPLACE FUNCTION get_cron_job_history(
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    jobid BIGINT,
    runid BIGINT,
    job_pid INTEGER,
    database TEXT,
    username TEXT,
    command TEXT,
    status TEXT,
    return_message TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
    SELECT 
        jobid,
        runid,
        job_pid,
        database,
        username,
        command,
        status,
        return_message,
        start_time,
        end_time
    FROM cron.job_run_details
    WHERE command LIKE '%manage_game_sessions%'
    ORDER BY start_time DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION get_cron_job_history IS 'pg_cron 작업 실행 이력 조회';

GRANT EXECUTE ON FUNCTION get_cron_job_history(INTEGER) TO authenticated, anon;

DO $
BEGIN
    RAISE NOTICE '✅ get_cron_job_history 함수 생성';
END $;

-- ============================================
-- 8단계: 수동 스케줄 관리 함수
-- ============================================

-- 스케줄 일시 중지
CREATE OR REPLACE FUNCTION pause_session_management()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE cron.job
    SET active = false
    WHERE jobname LIKE 'manage-game-sessions%';
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    
    RETURN format('✅ %s개의 세션 관리 스케줄이 일시 중지되었습니다.', v_updated);
END;
$$;

-- 스케줄 재개
CREATE OR REPLACE FUNCTION resume_session_management()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE cron.job
    SET active = true
    WHERE jobname LIKE 'manage-game-sessions%';
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    
    RETURN format('✅ %s개의 세션 관리 스케줄이 재개되었습니다.', v_updated);
END;
$$;

COMMENT ON FUNCTION pause_session_management IS '세션 관리 스케줄 일시 중지';
COMMENT ON FUNCTION resume_session_management IS '세션 관리 스케줄 재개';

GRANT EXECUTE ON FUNCTION pause_session_management() TO authenticated;
GRANT EXECUTE ON FUNCTION resume_session_management() TO authenticated;

DO $
BEGIN
    RAISE NOTICE '✅ 수동 스케줄 관리 함수 생성';
END $;

-- ============================================
-- 9단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 190. 자동 세션 관리 스케줄러 설정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '구현 내용:';
    RAISE NOTICE '1. ✅ pg_cron 확장 활성화 확인';
    RAISE NOTICE '2. ✅ 5분마다 세션 자동 관리';
    RAISE NOTICE '   - expire_inactive_game_sessions() 실행';
    RAISE NOTICE '   - cleanup_old_game_sessions() 실행';
    RAISE NOTICE '3. ✅ 매일 자정 통계 로그 저장 (선택)';
    RAISE NOTICE '4. ✅ 스케줄 관리 함수 제공';
    RAISE NOTICE '   - pause_session_management()';
    RAISE NOTICE '   - resume_session_management()';
    RAISE NOTICE '   - get_cron_job_history()';
    RAISE NOTICE '';
    RAISE NOTICE '📌 사용 방법:';
    RAISE NOTICE '  - 자동 실행: 5분마다 자동으로 세션 관리';
    RAISE NOTICE '  - 수동 실행: SELECT * FROM manage_game_sessions();';
    RAISE NOTICE '  - 일시 중지: SELECT pause_session_management();';
    RAISE NOTICE '  - 재개: SELECT resume_session_management();';
    RAISE NOTICE '  - 실행 이력: SELECT * FROM get_cron_job_history(20);';
    RAISE NOTICE '';
    RAISE NOTICE '✨ Edge Function 불필요 - 순수 PostgreSQL로 자동화!';
    RAISE NOTICE '============================================';
END $$;
