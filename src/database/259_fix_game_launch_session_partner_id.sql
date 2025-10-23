-- ============================================================================
-- 259. game_launch_sessions에 partner_id 저장 추가
-- ============================================================================
-- 작성일: 2025-01-17
-- 목적: save_game_launch_session 함수에서 partner_id와 session_id를 저장하도록 수정
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '259. game_launch_sessions partner_id 저장 수정';
    RAISE NOTICE '============================================';
END $$;

-- save_game_launch_session 함수 수정 (partner_id 추가)
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;

CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_session_id BIGINT;
    v_existing_count INTEGER;
    v_partner_id UUID;
    v_random_session_id TEXT;
BEGIN
    RAISE NOTICE '🎮 게임 세션 생성 시작: user_id=%, game_id=%', p_user_id, p_game_id;
    
    -- 사용자의 partner_id 조회 (users 테이블의 referrer_id)
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    IF v_partner_id IS NULL THEN
        RAISE WARNING '⚠️ 사용자 %의 referrer_id(partner_id)를 찾을 수 없습니다. NULL로 저장합니다.', p_user_id;
    ELSE
        RAISE NOTICE '✅ 사용자 partner_id 조회: %', v_partner_id;
    END IF;
    
    -- 랜덤 session_id 생성 (16자리 영숫자)
    v_random_session_id := substring(md5(random()::text || clock_timestamp()::text) from 1 for 16);
    
    -- 동일 사용자의 기존 활성 세션 종료 (다른 게임만)
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND ended_at IS NULL
    AND game_id != p_game_id;  -- 다른 게임만 종료
    
    GET DIAGNOSTICS v_existing_count = ROW_COUNT;
    
    IF v_existing_count > 0 THEN
        RAISE NOTICE '✅ 기존 활성 세션 % 건 종료 (다른 게임)', v_existing_count;
    END IF;
    
    -- 새 게임 세션 생성 (partner_id와 session_id 포함)
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        ended_at,
        status,
        last_activity_at,
        partner_id,
        session_id
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        COALESCE(p_balance_before, 0),
        NOW(),
        NULL,  -- ended_at은 NULL
        'active',  -- 반드시 active로 시작
        NOW(),  -- last_activity_at 초기화
        v_partner_id,  -- partner_id 추가
        v_random_session_id  -- session_id 추가
    ) RETURNING id INTO v_session_id;
    
    -- 저장 직후 상태 확인
    PERFORM 1 FROM game_launch_sessions 
    WHERE id = v_session_id 
    AND status = 'active';
    
    IF FOUND THEN
        RAISE NOTICE '✅ 게임 세션 active 상태 저장 성공: session_id=%, user=%, game=%, partner=%', 
            v_session_id, p_user_id, p_game_id, v_partner_id;
    ELSE
        RAISE WARNING '❌ 게임 세션 active 저장 실패: session_id=%', v_session_id;
    END IF;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %, SQLSTATE: %', SQLERRM, SQLSTATE;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION save_game_launch_session IS '게임 세션 생성 (partner_id와 session_id 포함, 항상 active 상태)';

-- 권한 재설정
GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ save_game_launch_session 함수 수정 완료';
    RAISE NOTICE '   - partner_id: users.referrer_id에서 조회하여 저장';
    RAISE NOTICE '   - session_id: 랜덤 16자리 영숫자 생성';
    RAISE NOTICE '============================================';
END $$;
