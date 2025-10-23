-- ============================================================================
-- 306. 오래된 세션 자동 정리 시스템 (4시간 경과 세션 삭제)
-- ============================================================================
-- 작성일: 2025-01-22
-- 목적: 
--   1. ended 상태의 오래된 세션을 자동으로 삭제
--   2. user_sessions, game_launch_sessions 모두 정리
--   3. 트리거 기반으로 새 세션 생성 시 자동 실행
--   4. 수동 호출도 가능하도록 함수 제공
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '306. 오래된 세션 자동 정리 시스템';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: pg_cron extension 활성화 시도
-- ============================================

DO $$
BEGIN
    -- pg_cron extension이 설치 가능한지 확인
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE NOTICE '✅ pg_cron extension 활성화 완료';
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '⚠️ pg_cron extension 활성화 실패: %', SQLERRM;
        RAISE NOTICE '💡 트리거 기반 자동 정리로 대체합니다';
END $$;

-- ============================================
-- 2단계: user_sessions 정리 함수 개선
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_user_sessions() RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER := 0;
BEGIN
    -- is_active = false이고 4시간 이상 경과한 세션 삭제
    WITH deleted AS (
        DELETE FROM user_sessions
        WHERE is_active = false
        AND logout_at IS NOT NULL
        AND logout_at < NOW() - INTERVAL '4 hours'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
    
    IF v_deleted_count > 0 THEN
        RAISE NOTICE '🗑️ user_sessions 자동 삭제: %건 (4시간 경과)', v_deleted_count;
    END IF;
    
    RETURN v_deleted_count;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ cleanup_old_user_sessions 오류: %', SQLERRM;
        RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_old_user_sessions() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ cleanup_old_user_sessions 함수 생성 완료';
END $$;

-- ============================================
-- 3단계: game_launch_sessions 정리 함수 개선
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_game_sessions() RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER := 0;
BEGIN
    -- ended 상태이고 4시간 이상 경과한 세션 삭제
    WITH deleted AS (
        DELETE FROM game_launch_sessions
        WHERE status = 'ended'
        AND ended_at IS NOT NULL
        AND ended_at < NOW() - INTERVAL '4 hours'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
    
    IF v_deleted_count > 0 THEN
        RAISE NOTICE '🗑️ game_launch_sessions 자동 삭제: %건 (4시간 경과)', v_deleted_count;
    END IF;
    
    RETURN v_deleted_count;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ cleanup_old_game_sessions 오류: %', SQLERRM;
        RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_old_game_sessions() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ cleanup_old_game_sessions 함수 생성 완료';
END $$;

-- ============================================
-- 4단계: 통합 세션 정리 함수
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_all_old_sessions() RETURNS TABLE(
    user_sessions_deleted INTEGER,
    game_sessions_deleted INTEGER,
    total_deleted INTEGER
) AS $$
DECLARE
    v_user_deleted INTEGER := 0;
    v_game_deleted INTEGER := 0;
BEGIN
    -- user_sessions 정리
    v_user_deleted := cleanup_old_user_sessions();
    
    -- game_launch_sessions 정리
    v_game_deleted := cleanup_old_game_sessions();
    
    RAISE NOTICE '🗑️ 전체 세션 정리 완료: user_sessions=%건, game_sessions=%건, 총 %건', 
        v_user_deleted, v_game_deleted, (v_user_deleted + v_game_deleted);
    
    RETURN QUERY SELECT v_user_deleted, v_game_deleted, (v_user_deleted + v_game_deleted);
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ cleanup_all_old_sessions 오류: %', SQLERRM;
        RETURN QUERY SELECT 0, 0, 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_all_old_sessions() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ cleanup_all_old_sessions 함수 생성 완료';
END $$;

-- ============================================
-- 5단계: user_sessions INSERT 시 자동 정리 트리거
-- ============================================

CREATE OR REPLACE FUNCTION trigger_cleanup_user_sessions() RETURNS TRIGGER AS $$
BEGIN
    -- 10% 확률로 정리 작업 실행 (매번 실행하면 성능 저하)
    IF random() < 0.1 THEN
        PERFORM cleanup_old_user_sessions();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_cleanup_user_sessions_trigger ON user_sessions;

CREATE TRIGGER auto_cleanup_user_sessions_trigger
    AFTER INSERT ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_cleanup_user_sessions();

DO $$
BEGIN
    RAISE NOTICE '✅ user_sessions 자동 정리 트리거 생성 완료';
END $$;

-- ============================================
-- 6단계: game_launch_sessions INSERT 시 자동 정리 트리거
-- ============================================

CREATE OR REPLACE FUNCTION trigger_cleanup_game_sessions() RETURNS TRIGGER AS $$
BEGIN
    -- 10% 확률로 정리 작업 실행 (매번 실행하면 성능 저하)
    IF random() < 0.1 THEN
        PERFORM cleanup_old_game_sessions();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_cleanup_game_sessions_trigger ON game_launch_sessions;

CREATE TRIGGER auto_cleanup_game_sessions_trigger
    AFTER INSERT ON game_launch_sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_cleanup_game_sessions();

DO $$
BEGIN
    RAISE NOTICE '✅ game_launch_sessions 자동 정리 트리거 생성 완료';
END $$;

-- ============================================
-- 7단계: pg_cron 스케줄 설정 (가능한 경우)
-- ============================================

DO $$
BEGIN
    -- pg_cron이 활성화되어 있으면 4시간마다 실행
    BEGIN
        -- 기존 스케줄 삭제
        PERFORM cron.unschedule('cleanup_sessions_every_4_hours');
    EXCEPTION
        WHEN OTHERS THEN
            NULL; -- 스케줄이 없으면 무시
    END;
    
    -- 4시간마다 실행 (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
    PERFORM cron.schedule(
        'cleanup_sessions_every_4_hours',
        '0 */4 * * *',
        $$SELECT cleanup_all_old_sessions();$$
    );
    
    RAISE NOTICE '✅ pg_cron 스케줄 설정 완료 (4시간마다 실행)';
    
EXCEPTION
    WHEN undefined_function THEN
        RAISE NOTICE '⚠️ pg_cron 미설치: 트리거 기반으로만 작동합니다';
    WHEN OTHERS THEN
        RAISE WARNING '⚠️ pg_cron 스케줄 설정 실패: %', SQLERRM;
        RAISE NOTICE '💡 트리거 기반으로만 작동합니다';
END $$;

-- ============================================
-- 8단계: 즉시 한 번 실행하여 기존 오래된 세션 정리
-- ============================================

DO $$
DECLARE
    v_result RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🗑️ 기존 오래된 세션 즉시 정리 시작...';
    
    SELECT * INTO v_result FROM cleanup_all_old_sessions();
    
    RAISE NOTICE '✅ 정리 완료:';
    RAISE NOTICE '  - user_sessions: %건', v_result.user_sessions_deleted;
    RAISE NOTICE '  - game_launch_sessions: %건', v_result.game_sessions_deleted;
    RAISE NOTICE '  - 총 삭제: %건', v_result.total_deleted;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '⚠️ 즉시 정리 실패: %', SQLERRM;
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 306. 오래된 세션 자동 정리 시스템 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '설정된 항목:';
    RAISE NOTICE '1. ✅ cleanup_old_user_sessions() - user_sessions 정리';
    RAISE NOTICE '2. ✅ cleanup_old_game_sessions() - game_launch_sessions 정리';
    RAISE NOTICE '3. ✅ cleanup_all_old_sessions() - 통합 정리';
    RAISE NOTICE '4. ✅ 트리거 기반 자동 정리 (INSERT 시 10% 확률)';
    RAISE NOTICE '5. ✅ pg_cron 스케줄 (4시간마다 실행, 가능한 경우)';
    RAISE NOTICE '';
    RAISE NOTICE '📌 정리 기준:';
    RAISE NOTICE '  - user_sessions: logout_at 기준 4시간 경과';
    RAISE NOTICE '  - game_launch_sessions: ended_at 기준 4시간 경과';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 수동 실행 방법:';
    RAISE NOTICE '  SELECT * FROM cleanup_all_old_sessions();';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ 참고사항:';
    RAISE NOTICE '  - 트리거는 새 세션 생성 시 10% 확률로 실행됩니다';
    RAISE NOTICE '  - pg_cron이 활성화된 경우 4시간마다 자동 실행됩니다';
    RAISE NOTICE '  - 즉시 기존 오래된 세션을 정리했습니다';
    RAISE NOTICE '============================================';
END $$;
