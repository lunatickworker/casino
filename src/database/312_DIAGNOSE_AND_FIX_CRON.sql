-- =====================================================
-- 파일명: 312_DIAGNOSE_AND_FIX_CRON.sql
-- 작성일: 2025-10-28
-- 목적: Cron 작업 진단 및 수정
-- 설명: pg_cron이 활성화되어 있어도 Cron 작업이 실제로 생성되지 않은 경우 해결
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔍 세션 자동 종료 Cron 진단 시작';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 1단계: pg_cron 확장 확인
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 1단계: pg_cron 확장 상태 확인';
    
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '  ✅ pg_cron 확장 활성화됨';
    ELSE
        RAISE NOTICE '  ❌ pg_cron 확장 비활성화됨';
        RAISE NOTICE '  💡 다음 명령어로 활성화: CREATE EXTENSION pg_cron;';
    END IF;
END $$;

-- ============================================
-- 2단계: 기존 Cron 작업 확인
-- ============================================

DO $$
DECLARE
    v_job_count INTEGER;
BEGIN
    RAISE NOTICE '📌 2단계: 기존 Cron 작업 확인';
    
    BEGIN
        SELECT COUNT(*) INTO v_job_count
        FROM cron.job
        WHERE jobname = 'auto-end-inactive-sessions';
        
        IF v_job_count > 0 THEN
            RAISE NOTICE '  ✅ Cron 작업이 존재함 (개수: %)', v_job_count;
            
            -- 작업 상세 정보 출력
            DECLARE
                v_job RECORD;
            BEGIN
                FOR v_job IN 
                    SELECT 
                        jobid,
                        schedule,
                        command,
                        active
                    FROM cron.job
                    WHERE jobname = 'auto-end-inactive-sessions'
                LOOP
                    RAISE NOTICE '    - Job ID: %', v_job.jobid;
                    RAISE NOTICE '    - Schedule: %', v_job.schedule;
                    RAISE NOTICE '    - Command: %', v_job.command;
                    RAISE NOTICE '    - Active: %', v_job.active;
                END LOOP;
            END;
        ELSE
            RAISE NOTICE '  ❌ Cron 작업이 존재하지 않음';
            RAISE NOTICE '  💡 3단계에서 자동 생성됩니다';
        END IF;
        
    EXCEPTION
        WHEN undefined_table THEN
            RAISE NOTICE '  ❌ cron.job 테이블이 존재하지 않음 (pg_cron 미설치)';
        WHEN OTHERS THEN
            RAISE NOTICE '  ⚠️ Cron 작업 확인 중 오류: %', SQLERRM;
    END;
END $$;

-- ============================================
-- 3단계: Cron 작업 생성 (없는 경우)
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 3단계: Cron 작업 생성 시도';
    
    BEGIN
        -- 기존 Cron 작업 삭제 (있는 경우)
        PERFORM cron.unschedule('auto-end-inactive-sessions');
        RAISE NOTICE '  ℹ️ 기존 Cron 작업 삭제됨';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '  ℹ️ 기존 Cron 작업 없음 (정상)';
    END;
    
    BEGIN
        -- 새로운 Cron 작업 생성 (1분마다 실행)
        PERFORM cron.schedule(
            'auto-end-inactive-sessions',     -- Cron 작업 이름
            '*/1 * * * *',                     -- 1분마다 실행
            $BODY$SELECT execute_scheduled_session_ends()$BODY$
        );
        
        RAISE NOTICE '  ✅ Cron 작업 생성 완료';
        RAISE NOTICE '    - 작업 이름: auto-end-inactive-sessions';
        RAISE NOTICE '    - 실행 주기: 1분마다 (*/1 * * * *)';
        RAISE NOTICE '    - 실행 함수: execute_scheduled_session_ends()';
        
    EXCEPTION
        WHEN undefined_function THEN
            RAISE NOTICE '  ❌ pg_cron 미설치 - Cron 작업 생성 불가';
            RAISE NOTICE '  💡 Supabase Dashboard > Database > Extensions에서 pg_cron 활성화 필요';
        WHEN OTHERS THEN
            RAISE NOTICE '  ❌ Cron 작업 생성 실패: %', SQLERRM;
    END;
END $$;

-- ============================================
-- 4단계: 생성된 Cron 작업 확인
-- ============================================

DO $$
DECLARE
    v_job RECORD;
BEGIN
    RAISE NOTICE '📌 4단계: 생성된 Cron 작업 최종 확인';
    
    BEGIN
        FOR v_job IN 
            SELECT 
                jobid,
                jobname,
                schedule,
                command,
                active,
                nodename,
                nodeport,
                database,
                username
            FROM cron.job
            WHERE jobname = 'auto-end-inactive-sessions'
        LOOP
            RAISE NOTICE '  ✅ Cron 작업 정보:';
            RAISE NOTICE '    - Job ID: %', v_job.jobid;
            RAISE NOTICE '    - Job Name: %', v_job.jobname;
            RAISE NOTICE '    - Schedule: %', v_job.schedule;
            RAISE NOTICE '    - Command: %', v_job.command;
            RAISE NOTICE '    - Active: %', v_job.active;
            RAISE NOTICE '    - Database: %', v_job.database;
            RAISE NOTICE '    - Username: %', v_job.username;
        END LOOP;
        
        IF NOT FOUND THEN
            RAISE NOTICE '  ⚠️ Cron 작업이 여전히 없음';
        END IF;
        
    EXCEPTION
        WHEN undefined_table THEN
            RAISE NOTICE '  ❌ cron.job 테이블이 존재하지 않음';
        WHEN OTHERS THEN
            RAISE NOTICE '  ⚠️ 확인 중 오류: %', SQLERRM;
    END;
END $$;

-- ============================================
-- 5단계: Cron 실행 로그 확인 (최근 10개)
-- ============================================

DO $$
DECLARE
    v_log RECORD;
    v_log_count INTEGER := 0;
BEGIN
    RAISE NOTICE '📌 5단계: Cron 실행 로그 확인 (최근 10개)';
    
    BEGIN
        FOR v_log IN 
            SELECT 
                jobid,
                runid,
                status,
                return_message,
                start_time,
                end_time
            FROM cron.job_run_details
            WHERE jobid IN (
                SELECT jobid FROM cron.job WHERE jobname = 'auto-end-inactive-sessions'
            )
            ORDER BY start_time DESC
            LIMIT 10
        LOOP
            v_log_count := v_log_count + 1;
            RAISE NOTICE '  📋 실행 로그 #%:', v_log_count;
            RAISE NOTICE '    - Run ID: %', v_log.runid;
            RAISE NOTICE '    - Status: %', v_log.status;
            RAISE NOTICE '    - Start Time: %', v_log.start_time;
            RAISE NOTICE '    - End Time: %', v_log.end_time;
            IF v_log.return_message IS NOT NULL THEN
                RAISE NOTICE '    - Message: %', v_log.return_message;
            END IF;
        END LOOP;
        
        IF v_log_count = 0 THEN
            RAISE NOTICE '  ℹ️ 아직 실행 로그가 없음 (Cron 작업이 아직 실행되지 않음)';
            RAISE NOTICE '  💡 최대 1분 후 첫 실행이 시작됩니다';
        END IF;
        
    EXCEPTION
        WHEN undefined_table THEN
            RAISE NOTICE '  ❌ cron.job_run_details 테이블이 존재하지 않음';
        WHEN OTHERS THEN
            RAISE NOTICE '  ⚠️ 로그 확인 중 오류: %', SQLERRM;
    END;
END $$;

-- ============================================
-- 6단계: 현재 종료 대상 세션 확인
-- ============================================

DO $$
DECLARE
    v_session RECORD;
    v_count INTEGER := 0;
BEGIN
    RAISE NOTICE '📌 6단계: 4분 경과로 종료 대상인 세션 확인';
    
    FOR v_session IN
        SELECT 
            id,
            user_id,
            game_id,
            status,
            last_activity_at,
            NOW() - last_activity_at AS inactive_duration
        FROM game_launch_sessions
        WHERE status = 'active'
          AND last_activity_at < NOW() - INTERVAL '4 minutes'
        ORDER BY last_activity_at
        LIMIT 10
    LOOP
        v_count := v_count + 1;
        RAISE NOTICE '  ⏰ 종료 대상 세션 #%:', v_count;
        RAISE NOTICE '    - Session ID: %', v_session.id;
        RAISE NOTICE '    - User ID: %', v_session.user_id;
        RAISE NOTICE '    - Game ID: %', v_session.game_id;
        RAISE NOTICE '    - Last Activity: %', v_session.last_activity_at;
        RAISE NOTICE '    - Inactive Duration: %', v_session.inactive_duration;
    END LOOP;
    
    IF v_count = 0 THEN
        RAISE NOTICE '  ✅ 종료 대상 세션 없음 (모든 세션이 4분 이내 활동 중)';
    ELSE
        RAISE NOTICE '  📊 총 % 개 세션이 종료 대상임', v_count;
    END IF;
END $$;

-- ============================================
-- 7단계: 수동으로 세션 종료 함수 즉시 실행
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 7단계: 세션 종료 함수 수동 실행 (테스트)';
    RAISE NOTICE '  ⏳ execute_scheduled_session_ends() 실행 중...';
    
    PERFORM execute_scheduled_session_ends();
    
    RAISE NOTICE '  ✅ 세션 종료 함수 실행 완료';
    RAISE NOTICE '  💡 위 로그에서 종료된 세션 수를 확인하세요';
END $$;

-- ============================================
-- 8단계: 종료 후 결과 확인
-- ============================================

DO $$
DECLARE
    v_active_count INTEGER;
    v_ended_count INTEGER;
    v_to_be_ended INTEGER;
BEGIN
    RAISE NOTICE '📌 8단계: 세션 종료 후 통계';
    
    SELECT 
        COUNT(*) FILTER (WHERE status = 'active'),
        COUNT(*) FILTER (WHERE status = 'ended'),
        COUNT(*) FILTER (WHERE status = 'active' AND last_activity_at < NOW() - INTERVAL '4 minutes')
    INTO v_active_count, v_ended_count, v_to_be_ended
    FROM game_launch_sessions;
    
    RAISE NOTICE '  📊 현재 세션 통계:';
    RAISE NOTICE '    - Active 세션: % 개', v_active_count;
    RAISE NOTICE '    - Ended 세션: % 개', v_ended_count;
    RAISE NOTICE '    - 아직 종료 대상: % 개', v_to_be_ended;
    
    IF v_to_be_ended > 0 THEN
        RAISE NOTICE '  ⚠️ 여전히 종료되지 않은 세션이 있습니다';
        RAISE NOTICE '  💡 함수에 문제가 있을 수 있습니다';
    ELSE
        RAISE NOTICE '  ✅ 모든 4분 경과 세션이 정상 종료됨';
    END IF;
END $$;

-- ============================================
-- 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ Cron 진단 및 수정 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📋 수행 내용:';
    RAISE NOTICE '  1. ✅ pg_cron 확장 상태 확인';
    RAISE NOTICE '  2. ✅ 기존 Cron 작업 확인';
    RAISE NOTICE '  3. ✅ Cron 작업 생성 (없는 경우)';
    RAISE NOTICE '  4. ✅ 생성된 Cron 작업 확인';
    RAISE NOTICE '  5. ✅ Cron 실행 로그 확인';
    RAISE NOTICE '  6. ✅ 종료 대상 세션 확인';
    RAISE NOTICE '  7. ✅ 세션 종료 함수 수동 실행';
    RAISE NOTICE '  8. ✅ 종료 후 결과 확인';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 다음 단계:';
    RAISE NOTICE '  • Cron 작업이 생성되었다면 1분마다 자동 실행됨';
    RAISE NOTICE '  • 베팅이 없는 세션은 4분 후 자동 종료됨';
    RAISE NOTICE '  • Cron 로그를 모니터링하여 정상 작동 확인';
    RAISE NOTICE '';
    RAISE NOTICE '📌 수동 실행 명령어:';
    RAISE NOTICE '  SELECT execute_scheduled_session_ends();';
    RAISE NOTICE '';
    RAISE NOTICE '📌 Cron 작업 확인:';
    RAISE NOTICE '  SELECT * FROM cron.job WHERE jobname = ''auto-end-inactive-sessions'';';
    RAISE NOTICE '';
    RAISE NOTICE '📌 Cron 로그 확인:';
    RAISE NOTICE '  SELECT * FROM cron.job_run_details';
    RAISE NOTICE '  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = ''auto-end-inactive-sessions'')';
    RAISE NOTICE '  ORDER BY start_time DESC LIMIT 10;';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
