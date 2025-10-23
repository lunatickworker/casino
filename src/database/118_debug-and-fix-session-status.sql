-- ============================================================================
-- 118. 게임 세션 status 디버깅 및 수정
-- ============================================================================
-- 목적: 세션은 저장되지만 status='active'인 세션이 0개인 문제 해결
-- 문제: 전체 세션 15개, 활성 세션 0개 - status가 제대로 저장되지 않음
-- ============================================================================

-- 1. 현재 게임 세션 상태 확인
DO $$
DECLARE
    v_total_sessions INTEGER;
    v_active_sessions INTEGER;
    v_recent_session RECORD;
BEGIN
    -- 전체 세션 수
    SELECT COUNT(*) INTO v_total_sessions FROM game_launch_sessions;
    
    -- 활성 세션 수
    SELECT COUNT(*) INTO v_active_sessions 
    FROM game_launch_sessions 
    WHERE status = 'active' AND ended_at IS NULL;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 현재 세션 상태';
    RAISE NOTICE '전체 세션: %', v_total_sessions;
    RAISE NOTICE '활성 세션: %', v_active_sessions;
    RAISE NOTICE '============================================';
    
    -- 최근 세션 10개 상태 확인
    FOR v_recent_session IN 
        SELECT id, user_id, game_id, status, ended_at, launched_at
        FROM game_launch_sessions
        ORDER BY id DESC
        LIMIT 10
    LOOP
        RAISE NOTICE 'Session ID=%, status=%, ended_at=%, launched_at=%',
            v_recent_session.id,
            v_recent_session.status,
            v_recent_session.ended_at,
            v_recent_session.launched_at;
    END LOOP;
END $$;

-- 2. save_game_launch_session 함수 완전 재작성 (간소화 및 강화)
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL);

CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    session_id BIGINT;
    v_verify_status TEXT;
BEGIN
    RAISE NOTICE '💾 [save_game_launch_session] 시작: user_id=%, game_id=%', p_user_id, p_game_id;
    
    -- 기존 활성 세션 종료 (같은 사용자의 모든 활성 세션)
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND ended_at IS NULL;
    
    RAISE NOTICE '✅ [save_game_launch_session] 기존 활성 세션 종료 완료';
    
    -- 새 게임 세션 생성 - 명시적으로 status='active' 설정
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        ended_at,
        status
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        p_balance_before,
        NOW(),
        NULL,  -- ended_at는 명시적으로 NULL
        'active'  -- status는 명시적으로 'active'
    ) RETURNING id INTO session_id;
    
    RAISE NOTICE '✅ [save_game_launch_session] 새 세션 생성: session_id=%', session_id;
    
    -- 저장 직후 검증
    SELECT status INTO v_verify_status
    FROM game_launch_sessions
    WHERE id = session_id;
    
    RAISE NOTICE '🔍 [save_game_launch_session] 검증: session_id=%, 저장된 status=%', session_id, v_verify_status;
    
    IF v_verify_status != 'active' THEN
        RAISE WARNING '⚠️ [save_game_launch_session] 세션 저장됐지만 status가 active가 아님: %', v_verify_status;
    END IF;
    
    RETURN session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ [save_game_launch_session] 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 함수 권한 설정
GRANT EXECUTE ON FUNCTION save_game_launch_session TO anon, authenticated;

-- 4. game_launch_sessions 테이블 제약 조건 확인
DO $$
BEGIN
    -- status 컬럼 기본값 확인 및 설정
    ALTER TABLE game_launch_sessions 
    ALTER COLUMN status SET DEFAULT 'active';
    
    -- ended_at 컬럼 기본값은 NULL
    ALTER TABLE game_launch_sessions 
    ALTER COLUMN ended_at SET DEFAULT NULL;
    
    RAISE NOTICE '✅ 테이블 제약 조건 업데이트 완료';
END $$;

-- 5. 모든 기존 세션의 status 확인 및 수정 (잘못된 데이터 정리)
DO $$
DECLARE
    v_fixed_count INTEGER;
BEGIN
    -- ended_at이 NULL인데 status가 'ended'인 세션 수정
    UPDATE game_launch_sessions
    SET status = 'active'
    WHERE ended_at IS NULL
    AND status = 'ended';
    
    GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
    
    IF v_fixed_count > 0 THEN
        RAISE NOTICE '🔧 [데이터 정리] ended_at=NULL인데 status=ended인 세션 %개를 active로 수정', v_fixed_count;
    END IF;
    
    -- ended_at이 있는데 status가 'active'인 세션 수정
    UPDATE game_launch_sessions
    SET status = 'ended'
    WHERE ended_at IS NOT NULL
    AND status = 'active';
    
    GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
    
    IF v_fixed_count > 0 THEN
        RAISE NOTICE '🔧 [데이터 정리] ended_at이 있는데 status=active인 세션 %개를 ended로 수정', v_fixed_count;
    END IF;
END $$;

-- 6. 검증: 수정 후 세션 상태 재확인
DO $$
DECLARE
    v_total_sessions INTEGER;
    v_active_sessions INTEGER;
    v_ended_sessions INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_sessions FROM game_launch_sessions;
    
    SELECT COUNT(*) INTO v_active_sessions 
    FROM game_launch_sessions 
    WHERE status = 'active' AND ended_at IS NULL;
    
    SELECT COUNT(*) INTO v_ended_sessions 
    FROM game_launch_sessions 
    WHERE status = 'ended' OR ended_at IS NOT NULL;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 수정 후 세션 상태';
    RAISE NOTICE '전체 세션: %', v_total_sessions;
    RAISE NOTICE '활성 세션: %', v_active_sessions;
    RAISE NOTICE '종료 세션: %', v_ended_sessions;
    RAISE NOTICE '============================================';
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 118. 게임 세션 status 디버깅 및 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. save_game_launch_session 함수 완전 재작성';
    RAISE NOTICE '2. status 명시적 설정 (active)';
    RAISE NOTICE '3. ended_at 명시적 NULL 설정';
    RAISE NOTICE '4. 저장 직후 검증 로직 추가';
    RAISE NOTICE '5. 기존 잘못된 데이터 정리';
    RAISE NOTICE '6. 테이블 기본값 설정';
    RAISE NOTICE '============================================';
END $$;
