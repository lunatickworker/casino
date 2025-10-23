-- =====================================================
-- 289. 세션 활성화 및 잔고 업데이트 수정
-- =====================================================
-- 작성일: 2025-10-19
-- 목적: 
--   1. save_game_launch_session에서 타이머가 제대로 작동하도록 수정
--   2. session_timers 테이블이 없으면 생성
--   3. execute_scheduled_session_ends 함수 확인 및 수정
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '289. 세션 활성화 및 잔고 업데이트 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: session_timers 테이블 존재 확인 및 생성
-- ============================================

CREATE TABLE IF NOT EXISTS session_timers (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL UNIQUE REFERENCES game_launch_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id BIGINT,
    last_betting_at TIMESTAMPTZ DEFAULT NOW(),
    scheduled_end_at TIMESTAMPTZ NOT NULL,
    is_cancelled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_timers_scheduled_end 
    ON session_timers(scheduled_end_at) 
    WHERE is_cancelled = FALSE;

CREATE INDEX IF NOT EXISTS idx_session_timers_user_game 
    ON session_timers(user_id, game_id);

DO $$
BEGIN
    RAISE NOTICE '✅ session_timers 테이블 확인/생성 완료';
END $$;

-- ============================================
-- 2단계: execute_scheduled_session_ends 함수 생성/수정
-- ============================================

CREATE OR REPLACE FUNCTION execute_scheduled_session_ends() 
RETURNS INTEGER AS $$
DECLARE
    v_ended_count INTEGER := 0;
    v_timer RECORD;
BEGIN
    -- 종료 예정 시간이 지난 세션 타이머 조회
    FOR v_timer IN 
        SELECT 
            st.id as timer_id,
            st.session_id,
            st.user_id,
            st.game_id,
            st.last_betting_at,
            st.scheduled_end_at,
            gls.status as current_status
        FROM session_timers st
        INNER JOIN game_launch_sessions gls ON gls.id = st.session_id
        WHERE st.is_cancelled = FALSE
        AND st.scheduled_end_at <= NOW()
        AND gls.status = 'active'
        ORDER BY st.scheduled_end_at ASC
        LIMIT 100
    LOOP
        -- 세션을 ended로 변경
        UPDATE game_launch_sessions
        SET 
            status = 'ended',
            ended_at = NOW()
        WHERE id = v_timer.session_id
        AND status = 'active';
        
        -- 타이머를 취소 상태로 변경
        UPDATE session_timers
        SET 
            is_cancelled = TRUE,
            updated_at = NOW()
        WHERE id = v_timer.timer_id;
        
        v_ended_count := v_ended_count + 1;
        
        RAISE NOTICE '⏰ 세션 자동 종료: session_id=%, user=%, game=%, scheduled=%, 경과=% 분', 
            v_timer.session_id, 
            v_timer.user_id, 
            v_timer.game_id,
            v_timer.scheduled_end_at,
            EXTRACT(EPOCH FROM (NOW() - v_timer.last_betting_at)) / 60;
    END LOOP;
    
    IF v_ended_count > 0 THEN
        RAISE NOTICE '✅ execute_scheduled_session_ends: %건의 세션 종료', v_ended_count;
    END IF;
    
    RETURN v_ended_count;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ execute_scheduled_session_ends 오류: %', SQLERRM;
        RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_scheduled_session_ends() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ execute_scheduled_session_ends 함수 생성/수정 완료';
END $$;

-- ============================================
-- 3단계: save_game_launch_session 함수 디버깅 로그 추가
-- ============================================

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
    v_partner_id UUID;
    v_random_session_id TEXT;
    v_existing_session RECORD;
    v_recent_session_time TIMESTAMPTZ;
BEGIN
    RAISE NOTICE '🎮 save_game_launch_session 호출: user=%, game=%', p_user_id, p_game_id;
    
    -- 사용자의 partner_id 조회
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    RAISE NOTICE '📊 사용자 정보: partner_id=%', v_partner_id;
    
    -- 🚫 30초 내 중복 세션 생성 방지
    SELECT launched_at INTO v_recent_session_time
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND status = 'active'
    AND launched_at > NOW() - INTERVAL '30 seconds'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    IF v_recent_session_time IS NOT NULL THEN
        RAISE NOTICE '⚠️ 30초 내 중복 세션 감지: %', v_recent_session_time;
        RAISE EXCEPTION '잠시 후에 다시 시도하세요. (30초 이내 중복 요청)';
    END IF;
    
    -- ✅ 4시간 이내 같은 user_id + game_id의 ended 세션 찾기
    SELECT id, session_id INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'ended'
    AND (ended_at > NOW() - INTERVAL '4 hours' OR launched_at > NOW() - INTERVAL '4 hours')
    ORDER BY COALESCE(ended_at, launched_at) DESC
    LIMIT 1;
    
    -- 기존 세션이 있으면 재활성화
    IF v_existing_session.id IS NOT NULL THEN
        RAISE NOTICE '🔄 기존 세션 재활성화: db_id=%, session=%', v_existing_session.id, v_existing_session.session_id;
        
        UPDATE game_launch_sessions
        SET 
            status = 'active',
            ended_at = NULL,
            last_activity_at = NOW(),
            launch_url = p_launch_url,
            session_token = p_session_token,
            launched_at = NOW() -- 재활성화 시 launched_at도 갱신
        WHERE id = v_existing_session.id;
        
        -- 타이머 생성 (4분 후 종료 예정)
        INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
        VALUES (v_existing_session.id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes')
        ON CONFLICT (session_id) DO UPDATE SET
            last_betting_at = NOW(),
            scheduled_end_at = NOW() + INTERVAL '4 minutes',
            is_cancelled = FALSE,
            updated_at = NOW();
        
        RAISE NOTICE '⏰ 타이머 설정 완료: scheduled_end_at=%', NOW() + INTERVAL '4 minutes';
        RAISE NOTICE '✅ 세션 재활성화 완료: db_id=%, session=%', v_existing_session.id, v_existing_session.session_id;
        
        RETURN v_existing_session.id;
    END IF;
    
    -- 기존 세션이 없으면 새로 생성
    v_random_session_id := substring(md5(random()::text || clock_timestamp()::text) from 1 for 16);
    
    RAISE NOTICE '🆕 새 세션 생성 시작: session=%', v_random_session_id;
    
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
        NULL,
        'active',
        NOW(),
        v_partner_id,
        v_random_session_id
    ) RETURNING id INTO v_session_id;
    
    RAISE NOTICE '💾 세션 DB 저장 완료: db_id=%', v_session_id;
    
    -- 타이머 생성 (4분 후 종료 예정)
    INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
    VALUES (v_session_id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes');
    
    RAISE NOTICE '⏰ 타이머 생성 완료: scheduled_end_at=%', NOW() + INTERVAL '4 minutes';
    RAISE NOTICE '✅ 새 세션 생성 완료: db_id=%, session=%', v_session_id, v_random_session_id;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ save_game_launch_session 함수 수정 완료 (디버깅 로그 추가)';
END $$;

-- ============================================
-- 4단계: 기존 ended 세션 모두 삭제 (초기화)
-- ============================================

DO $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM game_launch_sessions
    WHERE status = 'ended';
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
    RAISE NOTICE '🗑️ 기존 ended 세션 삭제: %건', v_deleted_count;
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 289. 세션 활성화 및 잔고 업데이트 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '수정된 항목:';
    RAISE NOTICE '1. ✅ session_timers 테이블 확인/생성';
    RAISE NOTICE '2. ✅ execute_scheduled_session_ends() 함수 생성/수정';
    RAISE NOTICE '3. ✅ save_game_launch_session() 디버깅 로그 추가';
    RAISE NOTICE '4. ✅ 기존 ended 세션 초기화';
    RAISE NOTICE '';
    RAISE NOTICE '📌 다음 단계:';
    RAISE NOTICE '  1. 게임 실행 후 Supabase 로그 확인';
    RAISE NOTICE '  2. execute_scheduled_session_ends() 1분마다 실행 확인';
    RAISE NOTICE '  3. session_timers 테이블에 타이머가 생성되는지 확인';
    RAISE NOTICE '============================================';
END $$;
