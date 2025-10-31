-- ============================================================================
-- 339. 세션 자동 종료 문제 진단 및 수정
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '339. 세션 자동 종료 문제 진단';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 현재 상태 확인
-- ============================================

DO $$
DECLARE
    v_active_count INTEGER;
    v_should_end_count INTEGER;
    v_sample_session RECORD;
BEGIN
    -- 전체 active 세션 수
    SELECT COUNT(*) INTO v_active_count
    FROM game_launch_sessions
    WHERE status = 'active';
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 현재 active 세션: %개', v_active_count;
    
    -- 30초 이상 비활성 세션 수
    SELECT COUNT(*) INTO v_should_end_count
    FROM game_launch_sessions
    WHERE status = 'active'
      AND last_activity_at < NOW() - INTERVAL '30 seconds';
    
    RAISE NOTICE '⏰ 30초 이상 비활성 세션: %개 (종료 대상)', v_should_end_count;
    
    -- 샘플 세션 정보 출력
    FOR v_sample_session IN
        SELECT 
            id,
            user_id,
            status,
            last_activity_at,
            EXTRACT(EPOCH FROM (NOW() - last_activity_at)) as inactive_seconds,
            NOW() as current_time
        FROM game_launch_sessions
        WHERE status = 'active'
        ORDER BY last_activity_at DESC
        LIMIT 3
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE '  세션 ID: %', v_sample_session.id;
        RAISE NOTICE '  사용자 ID: %', v_sample_session.user_id;
        RAISE NOTICE '  상태: %', v_sample_session.status;
        RAISE NOTICE '  마지막 활동: %', v_sample_session.last_activity_at;
        RAISE NOTICE '  현재 시간: %', v_sample_session.current_time;
        RAISE NOTICE '  비활성 시간: %초', v_sample_session.inactive_seconds;
        RAISE NOTICE '  종료 필요: %', CASE WHEN v_sample_session.inactive_seconds > 30 THEN 'YES' ELSE 'NO' END;
    END LOOP;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 2단계: last_activity_at을 업데이트하는 곳 확인
-- ============================================

-- 트리거 확인
DO $$
DECLARE
    v_trigger_info RECORD;
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔍 트리거 확인';
    RAISE NOTICE '============================================';
    
    FOR v_trigger_info IN
        SELECT 
            tgname as trigger_name,
            tgtype,
            tgenabled,
            pg_get_triggerdef(oid) as definition
        FROM pg_trigger
        WHERE tgrelid = 'game_launch_sessions'::regclass
          AND tgname NOT LIKE 'RI_%'
        ORDER BY tgname
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE '트리거: %', v_trigger_info.trigger_name;
        RAISE NOTICE '상태: %', CASE WHEN v_trigger_info.tgenabled = 'O' THEN '활성화' ELSE '비활성화' END;
        RAISE NOTICE '정의: %', v_trigger_info.definition;
    END LOOP;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 3단계: 문제 원인 분석
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔍 문제 원인 분석';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '가능한 원인:';
    RAISE NOTICE '  1. last_activity_at이 계속 업데이트되고 있음';
    RAISE NOTICE '  2. 타임존 문제 (서버 vs DB)';
    RAISE NOTICE '  3. RLS가 아직 활성화되어 있음';
    RAISE NOTICE '  4. 트리거가 비활성화되어 있음';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 4단계: RLS 상태 확인
-- ============================================

DO $$
DECLARE
    v_rls_enabled BOOLEAN;
BEGIN
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'game_launch_sessions';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔒 RLS 상태';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'game_launch_sessions RLS: %', CASE WHEN v_rls_enabled THEN '활성화 ⚠️' ELSE '비활성화 ✅' END;
    RAISE NOTICE '';
END $$;

-- ============================================
-- 5단계: 강제 종료 테스트
-- ============================================

DO $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🧪 강제 종료 테스트';
    RAISE NOTICE '============================================';
    
    -- 실제 UPDATE 실행
    UPDATE game_launch_sessions
    SET 
        status = 'auto_ended',
        ended_at = NOW()
    WHERE status = 'active'
      AND last_activity_at < NOW() - INTERVAL '30 seconds';
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    RAISE NOTICE '업데이트된 세션 수: %개', v_updated_count;
    
    IF v_updated_count = 0 THEN
        RAISE NOTICE '⚠️ UPDATE가 실행되었지만 변경된 row가 없습니다';
        RAISE NOTICE '원인 체크:';
        RAISE NOTICE '  1. 모든 세션의 last_activity_at이 30초 이내';
        RAISE NOTICE '  2. status가 active가 아님';
        RAISE NOTICE '  3. 데이터가 없음';
    ELSE
        RAISE NOTICE '✅ %개 세션 종료 성공', v_updated_count;
    END IF;
    
    RAISE NOTICE '';
END $$;

-- ============================================
-- 6단계: 최종 상태 확인
-- ============================================

DO $$
DECLARE
    v_active_count INTEGER;
    v_auto_ended_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_active_count
    FROM game_launch_sessions
    WHERE status = 'active';
    
    SELECT COUNT(*) INTO v_auto_ended_count
    FROM game_launch_sessions
    WHERE status = 'auto_ended';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 최종 상태';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'active 세션: %개', v_active_count;
    RAISE NOTICE 'auto_ended 세션: %개', v_auto_ended_count;
    RAISE NOTICE '';
    RAISE NOTICE '✅ 339 진단 완료';
    RAISE NOTICE '============================================';
END $$;
