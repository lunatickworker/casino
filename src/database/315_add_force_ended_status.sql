-- =====================================================
-- game_launch_sessions 테이블 status에 force_ended 추가
-- =====================================================
-- 작성일: 2025-10-28
-- 설명: 강제 종료 기능을 위한 'force_ended' 상태 추가

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '315. game_launch_sessions status 제약조건 업데이트';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 제약조건 삭제
-- ============================================

DO $$
BEGIN
    -- 기존 CHECK 제약조건 확인 및 삭제
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'game_launch_sessions_status_check'
    ) THEN
        ALTER TABLE game_launch_sessions 
        DROP CONSTRAINT game_launch_sessions_status_check;
        
        RAISE NOTICE '✅ 기존 status CHECK 제약조건 삭제 완료';
    ELSE
        RAISE NOTICE '⏭️ 기존 status CHECK 제약조건 없음';
    END IF;
END $$;

-- ============================================
-- 2단계: force_ended를 포함한 새 제약조건 추가
-- ============================================

DO $$
BEGIN
    -- 새로운 CHECK 제약조건 추가
    ALTER TABLE game_launch_sessions 
    ADD CONSTRAINT game_launch_sessions_status_check 
    CHECK (status IN ('active', 'ended', 'error', 'force_ended', 'online'));
    
    RAISE NOTICE '✅ force_ended를 포함한 새 CHECK 제약조건 추가 완료';
    RAISE NOTICE '   허용 상태: active, ended, error, force_ended, online';
END $$;

-- ============================================
-- 3단계: 기존 데이터 검증
-- ============================================

DO $$
DECLARE
    v_invalid_count INTEGER;
BEGIN
    -- 제약조건을 위반하는 데이터 확인
    SELECT COUNT(*) INTO v_invalid_count
    FROM game_launch_sessions
    WHERE status NOT IN ('active', 'ended', 'error', 'force_ended', 'online');
    
    IF v_invalid_count > 0 THEN
        RAISE WARNING '⚠️ 제약조건을 위반하는 데이터 %건 발견', v_invalid_count;
        RAISE NOTICE '   해당 데이터를 수동으로 확인하세요:';
        RAISE NOTICE '   SELECT id, user_id, status FROM game_launch_sessions WHERE status NOT IN (''active'', ''ended'', ''error'', ''force_ended'', ''online'');';
    ELSE
        RAISE NOTICE '✅ 모든 데이터가 제약조건을 만족합니다';
    END IF;
END $$;

-- ============================================
-- 4단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 315. 설치 완료!';
    RAISE NOTICE '   - force_ended 상태 추가 완료';
    RAISE NOTICE '   - 강제 종료 기능 사용 가능';
    RAISE NOTICE '============================================';
END $$;
