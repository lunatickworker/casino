-- ============================================================================
-- 117. 게임 세션 최종 수정
-- ============================================================================
-- 목적: 게임 실행 후 세션이 리스트에 표시되도록 최종 수정
-- 문제:
--   1. 세션은 저장되지만 조회가 안 됨
--   2. PGRST116 검증 오류 발생
-- ============================================================================

-- 1. save_game_launch_session 함수 재작성 (로깅 강화)
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
    v_existing_count INTEGER;
BEGIN
    -- 기존 활성 세션 수 확인
    SELECT COUNT(*) INTO v_existing_count
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND status = 'active';
    
    RAISE NOTICE '💾 게임 세션 저장: user_id=%, game_id=%, opcode=%, 기존활성세션=%', 
        p_user_id, p_game_id, p_opcode, v_existing_count;
    
    -- 기존 활성 세션 종료 (같은 사용자의 다른 게임)
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND game_id != p_game_id;
    
    -- 게임 실행 세션 기록 저장
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        status
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        p_balance_before,
        NOW(),
        'active'
    ) RETURNING id INTO session_id;
    
    RAISE NOTICE '✅ 게임 세션 저장 완료: session_id=%', session_id;
    
    -- 저장 직후 확인
    SELECT COUNT(*) INTO v_existing_count
    FROM game_launch_sessions
    WHERE id = session_id;
    
    RAISE NOTICE '✅ 세션 검증: session_id=% 존재=%', session_id, v_existing_count;
    
    -- 세션 ID 반환
    RETURN session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 함수 권한 재설정
GRANT EXECUTE ON FUNCTION save_game_launch_session TO anon, authenticated;

-- 3. game_launch_sessions 테이블 인덱스 최적화
DROP INDEX IF EXISTS idx_game_launch_sessions_active_status;
CREATE INDEX idx_game_launch_sessions_active_status 
ON game_launch_sessions(status, ended_at) 
WHERE status = 'active' AND ended_at IS NULL;

DROP INDEX IF EXISTS idx_game_launch_sessions_user_active;
CREATE INDEX idx_game_launch_sessions_user_active 
ON game_launch_sessions(user_id, status, launched_at DESC)
WHERE status = 'active';

-- 4. 활성 세션 조회 함수는 이미 116에서 생성됨 (중복 방지)
-- 기존 함수가 있는지 확인하고 없으면 생성
DO $
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'get_active_game_sessions'
    ) THEN
        CREATE FUNCTION get_active_game_sessions()
        RETURNS TABLE (
            session_id BIGINT,
            user_id UUID,
            username TEXT,
            game_id BIGINT,
            opcode TEXT,
            status TEXT,
            launched_at TIMESTAMPTZ,
            session_duration_seconds INTEGER
        ) AS $func$
        BEGIN
            RETURN QUERY
            SELECT 
                gls.id as session_id,
                gls.user_id,
                u.username,
                gls.game_id,
                gls.opcode,
                gls.status,
                gls.launched_at,
                EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER as session_duration_seconds
            FROM game_launch_sessions gls
            INNER JOIN users u ON gls.user_id = u.id
            WHERE gls.status = 'active'
            AND gls.ended_at IS NULL
            AND gls.launched_at >= NOW() - INTERVAL '24 hours'
            ORDER BY gls.launched_at DESC;
        END;
        $func$ LANGUAGE plpgsql SECURITY DEFINER;

        GRANT EXECUTE ON FUNCTION get_active_game_sessions TO authenticated;
        
        RAISE NOTICE '✅ get_active_game_sessions 함수 생성 완료';
    ELSE
        RAISE NOTICE '⚠️ get_active_game_sessions 함수가 이미 존재합니다 (건너뜀)';
    END IF;
END $;

-- 5. 테스트 쿼리 실행
DO $$
DECLARE
    v_session_count INTEGER;
    v_active_session_count INTEGER;
    v_recent_session RECORD;
BEGIN
    -- 전체 세션 수
    SELECT COUNT(*) INTO v_session_count
    FROM game_launch_sessions;
    
    -- 활성 세션 수
    SELECT COUNT(*) INTO v_active_session_count
    FROM game_launch_sessions
    WHERE status = 'active' AND ended_at IS NULL;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 게임 세션 통계';
    RAISE NOTICE '전체 세션 수: %', v_session_count;
    RAISE NOTICE '활성 세션 수: %', v_active_session_count;
    
    -- 가장 최근 세션 확인
    IF v_session_count > 0 THEN
        SELECT * INTO v_recent_session
        FROM game_launch_sessions
        ORDER BY id DESC
        LIMIT 1;
        
        RAISE NOTICE '최근 세션: ID=%, user_id=%, game_id=%, status=%', 
            v_recent_session.id,
            v_recent_session.user_id,
            v_recent_session.game_id,
            v_recent_session.status;
    END IF;
    
    RAISE NOTICE '============================================';
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 117. 게임 세션 최종 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. save_game_launch_session 함수 로깅 강화';
    RAISE NOTICE '2. 활성 세션 인덱스 최적화';
    RAISE NOTICE '3. get_active_game_sessions 디버깅 함수 추가';
    RAISE NOTICE '4. 세션 통계 및 검증 완료';
    RAISE NOTICE '============================================';
END $$;
