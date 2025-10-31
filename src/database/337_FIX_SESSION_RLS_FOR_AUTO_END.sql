-- ============================================================================
-- 337. game_launch_sessions RLS 수정 (auto_ended 작동 위해)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '337. RLS 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 RLS 정책 삭제
-- ============================================

DROP POLICY IF EXISTS game_launch_sessions_policy ON game_launch_sessions CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 RLS 정책 삭제';
END $$;

-- ============================================
-- 2단계: RLS 비활성화
-- ============================================

ALTER TABLE game_launch_sessions DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    RAISE NOTICE '✅ game_launch_sessions RLS 비활성화';
    RAISE NOTICE '';
    RAISE NOTICE '이유:';
    RAISE NOTICE '  • OnlineUsers에서 30초 비활성 세션 UPDATE 시';
    RAISE NOTICE '  • 트리거에서 auto_ended 처리 시';
    RAISE NOTICE '  • RLS가 UPDATE를 막고 있었음';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 3단계: 즉시 실행
-- ============================================

DO $$
DECLARE
    v_ended_count INTEGER := 0;
BEGIN
    UPDATE game_launch_sessions
    SET 
        status = 'auto_ended',
        ended_at = NOW()
    WHERE status = 'active'
      AND last_activity_at < NOW() - INTERVAL '60 seconds';
    
    GET DIAGNOSTICS v_ended_count = ROW_COUNT;
    
    RAISE NOTICE '✅ 기존 비활성 세션 %개 즉시 종료', v_ended_count;
END $$;

-- ============================================
-- 4단계: 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 337 완료';
    RAISE NOTICE '============================================';
END $$;
