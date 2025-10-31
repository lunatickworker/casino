-- ============================================================================
-- 349. game_launch_sessions의 game_id 외래 키 제거
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '349. game_launch_sessions.game_id FK 제거';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 외래 키 제약조건 삭제
-- ============================================

DO $$
BEGIN
    -- 모든 game_id 관련 외래 키 삭제
    ALTER TABLE game_launch_sessions DROP CONSTRAINT IF EXISTS game_launch_sessions_game_id_fkey CASCADE;
    ALTER TABLE game_launch_sessions DROP CONSTRAINT IF EXISTS fk_game_launch_sessions_game_id CASCADE;
    
    RAISE NOTICE '✅ game_launch_sessions.game_id 외래 키 제약조건 삭제';
END $$;

-- ============================================
-- 2단계: game_id nullable로 유지
-- ============================================

DO $$
BEGIN
    -- game_id nullable로 변경 (혹시 NOT NULL이면)
    ALTER TABLE game_launch_sessions ALTER COLUMN game_id DROP NOT NULL;
    
    RAISE NOTICE '✅ game_id는 이제 단순 INTEGER 컬럼 (외래 키 없음)';
    RAISE NOTICE '   - 외부 API의 원본 game_id 저장';
    RAISE NOTICE '   - 410000: 에볼루션 로비';
    RAISE NOTICE '   - 410005/410006/410008: 에볼루션 로비 내 개별 게임';
END $$;

-- ============================================
-- 3단계: 인덱스 확인
-- ============================================

CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_game_id ON game_launch_sessions(game_id);

DO $$
BEGIN
    RAISE NOTICE '✅ game_id 인덱스 확인 완료';
END $$;

-- ============================================
-- 4단계: 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 349 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '  • game_launch_sessions.game_id 외래 키 완전 제거';
    RAISE NOTICE '  • game_id는 외부 API 원본 값 저장용';
    RAISE NOTICE '  • games 테이블은 로비 정보만 관리';
    RAISE NOTICE '';
    RAISE NOTICE '예시:';
    RAISE NOTICE '  • games: 410000 (에볼루션 로비)';
    RAISE NOTICE '  • sessions: 410000, 410005, 410008... (실제 게임)';
    RAISE NOTICE '  • game_records: 410000, 410005, 410008... (베팅 기록)';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;