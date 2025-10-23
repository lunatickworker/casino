-- ============================================================================
-- 120. 쓰레기 게임 세션 정리 및 자동 만료 시스템
-- ============================================================================
-- 목적: 게임을 하지 않는데 active로 남아있는 쓰레기 세션 완전 제거
-- 문제: 오래된 세션들이 ended_at=NULL, status='active'로 계속 남아있음
-- 정책: 베팅내역 동기화 시스템과 연동, 1분 동안 베팅이 없으면 자동 만료
-- ============================================================================

-- 1. 현재 쓰레기 세션 확인
DO $$
DECLARE
    v_total INTEGER;
    v_old_sessions INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM game_launch_sessions
    WHERE status = 'active' AND ended_at IS NULL;
    
    -- 1분 이상 된 세션 (쓰레기)
    SELECT COUNT(*) INTO v_old_sessions
    FROM game_launch_sessions
    WHERE status = 'active' 
    AND ended_at IS NULL
    AND launched_at < NOW() - INTERVAL '1 minute';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 현재 세션 상태';
    RAISE NOTICE '전체 활성 세션: %개', v_total;
    RAISE NOTICE '1분 이상 된 세션 (쓰레기): %개', v_old_sessions;
    RAISE NOTICE '============================================';
END $$;

-- 2. last_heartbeat 컬럼 추가 (이미 있으면 건너뜀)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_launch_sessions'
        AND column_name = 'last_heartbeat'
    ) THEN
        ALTER TABLE game_launch_sessions
        ADD COLUMN last_heartbeat TIMESTAMPTZ DEFAULT NOW();
        
        RAISE NOTICE '✅ last_heartbeat 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️ last_heartbeat 컬럼 이미 존재';
    END IF;
END $$;

-- 3. 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_game_sessions_active_heartbeat
ON game_launch_sessions(status, last_heartbeat)
WHERE status = 'active' AND ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_sessions_user_active
ON game_launch_sessions(user_id, status)
WHERE status = 'active' AND ended_at IS NULL;

-- 4. 모든 오래된 쓰레기 세션 즉시 정리
DO $$
DECLARE
    v_cleaned INTEGER;
BEGIN
    -- 1분 이상 된 모든 활성 세션 종료
    UPDATE game_launch_sessions
    SET 
        status = 'expired',
        ended_at = NOW()
    WHERE status = 'active'
    AND ended_at IS NULL
    AND launched_at < NOW() - INTERVAL '1 minute';
    
    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '🧹 쓰레기 세션 정리 완료: %개', v_cleaned;
    RAISE NOTICE '============================================';
END $$;

-- 5. 기존 함수 완전 제거 (CASCADE로 의존성까지 제거)
DROP FUNCTION IF EXISTS expire_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS update_game_session_heartbeat(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS end_game_session(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS get_active_game_sessions() CASCADE;

-- 6. 자동 만료 함수 생성 (1분 기준)
CREATE FUNCTION expire_old_game_sessions()
RETURNS void AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    -- 1분 이상 heartbeat가 없는 세션 자동 종료
    -- 베팅내역 동기화 시스템에서 주기적으로 호출되므로 1분 기준 사용
    UPDATE game_launch_sessions
    SET 
        status = 'expired',
        ended_at = NOW()
    WHERE status = 'active'
    AND ended_at IS NULL
    AND COALESCE(last_heartbeat, launched_at) < NOW() - INTERVAL '1 minute';
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    
    IF v_expired_count > 0 THEN
        RAISE NOTICE '[expire_old_game_sessions] %개 세션 자동 만료 (1분 무활동)', v_expired_count;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. heartbeat 업데이트 함수
CREATE FUNCTION update_game_session_heartbeat(
    p_session_id BIGINT
) RETURNS void AS $$
BEGIN
    UPDATE game_launch_sessions
    SET last_heartbeat = NOW()
    WHERE id = p_session_id
    AND status = 'active'
    AND ended_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. save_game_launch_session 함수 재작성 (자동 만료 포함)
CREATE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_session_id BIGINT;
BEGIN
    -- 먼저 오래된 세션 자동 만료
    PERFORM expire_old_game_sessions();
    
    -- 해당 사용자의 모든 기존 활성 세션 종료
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND ended_at IS NULL;
    
    -- 새 세션 생성
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        last_heartbeat,
        ended_at,
        status
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        COALESCE(p_balance_before, 0),
        NOW(),
        NOW(),  -- 초기 heartbeat
        NULL,
        'active'
    ) RETURNING id INTO v_session_id;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[save_game_launch_session] 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. 게임 세션 종료 함수
CREATE FUNCTION end_game_session(
    p_session_id BIGINT
) RETURNS void AS $$
BEGIN
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE id = p_session_id
    AND status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. 활성 게임 세션 조회 (1분 이내 heartbeat만)
CREATE FUNCTION get_active_game_sessions()
RETURNS TABLE (
    session_id BIGINT,
    user_id UUID,
    username TEXT,
    nickname TEXT,
    game_id BIGINT,
    launched_at TIMESTAMPTZ,
    last_heartbeat TIMESTAMPTZ
) AS $$
BEGIN
    -- 먼저 오래된 세션 자동 만료
    PERFORM expire_old_game_sessions();
    
    RETURN QUERY
    SELECT 
        gls.id as session_id,
        gls.user_id,
        u.username,
        u.nickname,
        gls.game_id,
        gls.launched_at,
        gls.last_heartbeat
    FROM game_launch_sessions gls
    JOIN users u ON u.id = gls.user_id
    WHERE gls.status = 'active'
    AND gls.ended_at IS NULL
    AND COALESCE(gls.last_heartbeat, gls.launched_at) >= NOW() - INTERVAL '1 minute'
    ORDER BY gls.last_heartbeat DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. 함수 권한 설정
GRANT EXECUTE ON FUNCTION expire_old_game_sessions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_game_session_heartbeat(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION end_game_session(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_active_game_sessions() TO anon, authenticated;

-- 12. 검증
DO $$
DECLARE
    v_active_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_active_count
    FROM game_launch_sessions
    WHERE status = 'active' AND ended_at IS NULL;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 120. 쓰레기 세션 정리 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '정리 후 활성 세션: %개', v_active_count;
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. 1분 이상 된 모든 오래된 세션 정리';
    RAISE NOTICE '2. last_heartbeat 컬럼 추가';
    RAISE NOTICE '3. 자동 만료 시스템 구축 (1분 기준)';
    RAISE NOTICE '4. heartbeat 업데이트 함수';
    RAISE NOTICE '5. 실시간 조회시 자동 만료 처리';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ 중요: 베팅내역 동기화 시스템과 연동';
    RAISE NOTICE '⚠️ 1분 동안 베팅이 없으면 자동 만료됨';
    RAISE NOTICE '============================================';
END $$;
