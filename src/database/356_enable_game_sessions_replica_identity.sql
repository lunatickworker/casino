-- ============================================================================
-- 356. game_launch_sessions 테이블 REPLICA IDENTITY FULL 설정
-- ============================================================================
-- 목적: Supabase Realtime에서 UPDATE 이벤트의 old 값을 전달받기 위함
-- 용도: 게임 강제 종료 시 상태 변경 감지 (active → force_ended)

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '356. REPLICA IDENTITY FULL 설정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- game_launch_sessions 테이블 REPLICA IDENTITY FULL 설정
-- ============================================

ALTER TABLE game_launch_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
    RAISE NOTICE '✅ game_launch_sessions 테이블 REPLICA IDENTITY FULL 설정 완료';
    RAISE NOTICE '';
    RAISE NOTICE '효과:';
    RAISE NOTICE '  • Realtime UPDATE 이벤트에서 old 값 전달';
    RAISE NOTICE '  • status 변경 감지 가능 (active → force_ended)';
    RAISE NOTICE '  • 게임창 강제 종료 조건 작동 가능';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 설정 확인
-- ============================================

DO $$
DECLARE
    v_replica_identity CHAR;
BEGIN
    SELECT relreplident INTO v_replica_identity
    FROM pg_class
    WHERE relname = 'game_launch_sessions';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '현재 설정 확인';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'game_launch_sessions REPLICA IDENTITY: %', 
        CASE v_replica_identity
            WHEN 'd' THEN 'DEFAULT (primary key만) ❌'
            WHEN 'f' THEN 'FULL (모든 컬럼) ✅'
            WHEN 'n' THEN 'NOTHING'
            WHEN 'i' THEN 'INDEX'
            ELSE 'UNKNOWN'
        END;
    RAISE NOTICE '';
END $$;
