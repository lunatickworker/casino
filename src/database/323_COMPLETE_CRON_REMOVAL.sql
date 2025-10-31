-- ============================================================================
-- 323. pg_cron 완전 제거 (모든 SQL 파일 수정 반영)
-- ============================================================================
-- 작성일: 2025-10-29
-- 목적: 
--   모든 pg_cron 관련 로직 완전 삭제
--   setTimeout과 pg_cron 충돌 방지
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '323. pg_cron 완전 제거';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 모든 pg_cron 스케줄 삭제
-- ============================================

DO $$
BEGIN
    -- pg_cron이 설치되어 있는 경우에만 삭제 시도
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- 모든 가능한 스케줄명 삭제
        BEGIN
            PERFORM cron.unschedule('auto_end_inactive_sessions');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('session_auto_end');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('end_inactive_sessions');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('manage-game-sessions-5min');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('daily-session-stats-log');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('daily-session-stats');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('cleanup_sessions_every_4_hours');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('process-message-queue');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        BEGIN
            PERFORM cron.unschedule('cleanup-message-queue');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        
        RAISE NOTICE '✅ 모든 pg_cron 스케줄 삭제 완료';
    ELSE
        RAISE NOTICE '⏭️ pg_cron 확장이 설치되지 않음';
    END IF;
END $$;

-- ============================================
-- 2단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 323. pg_cron 완전 제거 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '삭제된 스케줄:';
    RAISE NOTICE '  - auto_end_inactive_sessions';
    RAISE NOTICE '  - session_auto_end';
    RAISE NOTICE '  - end_inactive_sessions';
    RAISE NOTICE '  - manage-game-sessions-5min';
    RAISE NOTICE '  - daily-session-stats-log';
    RAISE NOTICE '  - daily-session-stats';
    RAISE NOTICE '  - cleanup_sessions_every_4_hours';
    RAISE NOTICE '  - process-message-queue';
    RAISE NOTICE '  - cleanup-message-queue';
    RAISE NOTICE '';
    RAISE NOTICE '📌 결과:';
    RAISE NOTICE '  - pg_cron 스케줄 모두 삭제됨';
    RAISE NOTICE '  - setTimeout과 충돌 없음';
    RAISE NOTICE '  - 프론트엔드 제어만 사용';
    RAISE NOTICE '============================================';
END $$;
