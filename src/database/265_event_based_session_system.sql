-- ============================================================================
-- 265. 이벤트 기반 세션 관리 시스템
-- ============================================================================
-- 작성일: 2025-10-17
-- 목적: 
--   베팅 이벤트 기반으로 세션을 관리하는 깨끗한 시스템
--   베팅 발생 시 타이머 재설정, 4분 무활동 시 자동 종료
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '265. 이벤트 기반 세션 관리 시스템';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 복잡한 시스템 완전 제거
-- ============================================

-- 모든 트리거 제거
DROP TRIGGER IF EXISTS trigger_update_session_on_betting ON game_records CASCADE;
DROP TRIGGER IF EXISTS trg_update_session_on_betting ON game_records CASCADE;

-- 모든 자동화 함수 제거
DROP FUNCTION IF EXISTS update_session_activity_on_betting() CASCADE;
DROP FUNCTION IF EXISTS update_game_session_on_betting() CASCADE;
DROP FUNCTION IF EXISTS expire_inactive_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS manage_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS expire_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS end_game_session(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS update_user_betting_time(UUID, VARCHAR, UUID) CASCADE;
DROP FUNCTION IF EXISTS end_inactive_sessions() CASCADE;
DROP FUNCTION IF EXISTS reactivate_or_create_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;

-- 베팅 추적 테이블 제거
DROP TABLE IF EXISTS user_betting_tracker CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 시스템 완전 제거 완료';
END $$;

-- ============================================
-- 2단계: 세션 타이머 관리 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS session_timers (
    session_id BIGINT PRIMARY KEY REFERENCES game_launch_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    last_betting_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_end_at TIMESTAMPTZ NOT NULL, -- 4분 후 시간
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_timers_scheduled_end ON session_timers(scheduled_end_at) WHERE is_cancelled = FALSE;
CREATE INDEX IF NOT EXISTS idx_session_timers_user_game ON session_timers(user_id, game_id);

DO $$
BEGIN
    RAISE NOTICE '✅ session_timers 테이블 생성 완료';
END $$;

-- ============================================
-- 3단계: 세션 생성/재활성화 함수 (간단 버전)
-- ============================================

CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $
DECLARE
    v_session_id BIGINT;
    v_partner_id UUID;
    v_random_session_id TEXT;
    v_existing_session RECORD;
BEGIN
    -- 사용자의 partner_id 조회
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    -- 30분 이내 같은 user_id + game_id의 ended 세션 찾기 (더 넓은 범위)
    SELECT id, session_id INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'ended'
    AND (ended_at > NOW() - INTERVAL '30 minutes' OR launched_at > NOW() - INTERVAL '30 minutes')
    ORDER BY COALESCE(ended_at, launched_at) DESC
    LIMIT 1;
    
    -- 기존 세션이 있으면 재활성화
    IF v_existing_session.id IS NOT NULL THEN
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
        
        RAISE NOTICE '🔄 세션 재활성화 성공: db_id=%, session_id=%, user=%, game=%', 
            v_existing_session.id, v_existing_session.session_id, p_user_id, p_game_id;
        
        RETURN v_existing_session.id;
    END IF;
    
    -- 기존 세션이 없으면 새로 생성
    v_random_session_id := substring(md5(random()::text || clock_timestamp()::text) from 1 for 16);
    
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
    
    -- 타이머 생성 (4분 후 종료 예정)
    INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
    VALUES (v_session_id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes');
    
    RAISE NOTICE '✅ 새 세션 생성: db_id=%, session_id=%, user=%, game=%', 
        v_session_id, v_random_session_id, p_user_id, p_game_id;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ save_game_launch_session 함수 생성 완료';
END $$;

-- ============================================
-- 4-1단계: 베팅 감지로 세션 재활성화 (타이머와 분리)
-- ============================================

CREATE OR REPLACE FUNCTION reactivate_session_on_betting(
    p_user_id UUID,
    p_game_id BIGINT
) RETURNS BOOLEAN AS $$
DECLARE
    v_session_id BIGINT;
    v_session_token TEXT;
    v_active_session RECORD;
BEGIN
    -- 1. 먼저 active 세션 확인
    SELECT id, session_id INTO v_active_session
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    -- Active 세션이 있으면 재활성화 불필요
    IF v_active_session.id IS NOT NULL THEN
        RAISE NOTICE '✅ 이미 active 세션 존재: db_id=%, session=%', 
            v_active_session.id, v_active_session.session_id;
        RETURN FALSE;
    END IF;
    
    -- 2. Active 세션이 없으면 30분 내 ended 세션 찾기
    SELECT id, session_id INTO v_session_id, v_session_token
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'ended'
    AND (ended_at > NOW() - INTERVAL '30 minutes' OR launched_at > NOW() - INTERVAL '30 minutes')
    ORDER BY COALESCE(ended_at, launched_at) DESC
    LIMIT 1;
    
    IF v_session_id IS NULL THEN
        RAISE NOTICE '❌ 재활성화할 세션 없음: user=%, game=%', p_user_id, p_game_id;
        RETURN FALSE;
    END IF;
    
    -- 3. 세션 재활성화
    UPDATE game_launch_sessions
    SET 
        status = 'active',
        ended_at = NULL,
        last_activity_at = NOW(),
        launched_at = NOW()
    WHERE id = v_session_id;
    
    -- 4. 타이머 생성 (4분 후 종료 예정)
    INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
    VALUES (v_session_id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes')
    ON CONFLICT (session_id) DO UPDATE SET
        last_betting_at = NOW(),
        scheduled_end_at = NOW() + INTERVAL '4 minutes',
        is_cancelled = FALSE,
        updated_at = NOW();
    
    RAISE NOTICE '🔄 베팅 감지로 세션 재활성화 성공: db_id=%, session=%, user=%, game=%', 
        v_session_id, v_session_token, p_user_id, p_game_id;
    
    RETURN TRUE;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ reactivate_session_on_betting 오류: %', SQLERRM;
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reactivate_session_on_betting(UUID, BIGINT) TO anon, authenticated;

-- ============================================
-- 4-2단계: 타이머 재설정 함수 (단순 버전)
-- ============================================

CREATE OR REPLACE FUNCTION reset_session_timer(
    p_user_id UUID,
    p_game_id BIGINT
) RETURNS VOID AS $$
DECLARE
    v_session_id BIGINT;
BEGIN
    -- 해당 사용자+게임의 active 세션 찾기
    SELECT id INTO v_session_id
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    IF v_session_id IS NULL THEN
        RAISE NOTICE '⚠️ active 세션 없음 (타이머 재설정 불가): user=%, game=%', p_user_id, p_game_id;
        RETURN;
    END IF;
    
    -- 세션 last_activity_at 업데이트
    UPDATE game_launch_sessions
    SET last_activity_at = NOW()
    WHERE id = v_session_id;
    
    -- 타이머 재설정 (4분 후로 연장)
    INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
    VALUES (v_session_id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes')
    ON CONFLICT (session_id) DO UPDATE SET
        last_betting_at = NOW(),
        scheduled_end_at = NOW() + INTERVAL '4 minutes',
        is_cancelled = FALSE,
        updated_at = NOW();
    
    RAISE NOTICE '⏰ 타이머 재설정: session=%, 종료예정=%', v_session_id, NOW() + INTERVAL '4 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reset_session_timer(UUID, BIGINT) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ reactivate_session_on_betting 함수 생성 완료';
    RAISE NOTICE '✅ reset_session_timer 함수 생성 완료 (단순 버전)';
END $$;

-- ============================================
-- 5단계: 예정된 세션 종료 실행 함수
-- ============================================

CREATE OR REPLACE FUNCTION execute_scheduled_session_ends() RETURNS INTEGER AS $$
DECLARE
    v_ended_count INTEGER := 0;
    v_timer RECORD;
BEGIN
    -- 종료 예정 시간이 지난 타이머 찾기
    FOR v_timer IN
        SELECT 
            st.session_id,
            st.user_id,
            st.game_id,
            st.last_betting_at,
            st.scheduled_end_at,
            gls.session_id as session_token,
            u.username
        FROM session_timers st
        INNER JOIN game_launch_sessions gls ON st.session_id = gls.id
        INNER JOIN users u ON st.user_id = u.id
        WHERE st.scheduled_end_at <= NOW()
        AND st.is_cancelled = FALSE
        AND gls.status = 'active'
    LOOP
        -- 최종 확인: 정말로 4분 동안 베팅이 없었는지 재확인
        IF v_timer.last_betting_at < NOW() - INTERVAL '4 minutes' THEN
            -- 세션 종료
            UPDATE game_launch_sessions
            SET 
                status = 'ended',
                ended_at = NOW()
            WHERE id = v_timer.session_id;
            
            -- 타이머 취소 처리
            UPDATE session_timers
            SET is_cancelled = TRUE
            WHERE session_id = v_timer.session_id;
            
            v_ended_count := v_ended_count + 1;
            
            RAISE NOTICE '⏹️ 세션 자동 종료: session=%, user=%, 마지막 베팅=%', 
                v_timer.session_token, v_timer.username, v_timer.last_betting_at;
        ELSE
            -- 타이머가 잘못 설정됨 (동시성 이슈), 재설정
            UPDATE session_timers
            SET 
                scheduled_end_at = v_timer.last_betting_at + INTERVAL '4 minutes',
                updated_at = NOW()
            WHERE session_id = v_timer.session_id;
            
            RAISE NOTICE '🔄 타이머 재조정: session=%, 새 종료 시간=%', 
                v_timer.session_token, v_timer.last_betting_at + INTERVAL '4 minutes';
        END IF;
    END LOOP;
    
    RETURN v_ended_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_scheduled_session_ends() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ execute_scheduled_session_ends 함수 생성 완료';
END $$;

-- ============================================
-- 6단계: RLS 정책
-- ============================================

ALTER TABLE session_timers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_timers_select_policy" ON session_timers;
CREATE POLICY "session_timers_select_policy" 
ON session_timers FOR SELECT 
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS "session_timers_insert_policy" ON session_timers;
CREATE POLICY "session_timers_insert_policy" 
ON session_timers FOR INSERT 
TO authenticated, anon
WITH CHECK (true);

DROP POLICY IF EXISTS "session_timers_update_policy" ON session_timers;
CREATE POLICY "session_timers_update_policy" 
ON session_timers FOR UPDATE 
TO authenticated, anon
USING (true);

DO $$
BEGIN
    RAISE NOTICE '✅ RLS 정책 생성 완료';
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 265. 이벤트 기반 세션 관리 시스템 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '생성된 항목:';
    RAISE NOTICE '1. ✅ session_timers 테이블';
    RAISE NOTICE '2. ✅ save_game_launch_session() 함수 (게임 실행 시 재활성화)';
    RAISE NOTICE '3. ✅ reactivate_session_on_betting() 함수 (베팅 감지 시 재활성화)';
    RAISE NOTICE '4. ✅ reset_session_timer() 함수 (타이머만 재설정)';
    RAISE NOTICE '5. ✅ execute_scheduled_session_ends() 함수 (예정된 종료 실행)';
    RAISE NOTICE '';
    RAISE NOTICE '📌 사용 방법:';
    RAISE NOTICE '  - 게임 실행 시: save_game_launch_session() → 30분 내 세션 재활성화 또는 신규 생성';
    RAISE NOTICE '  - 베팅 감지 시:';
    RAISE NOTICE '    1. reactivate_session_on_betting() → ended 세션 재활성화 시도';
    RAISE NOTICE '    2. reset_session_timer() → active 세션 타이머 4분 연장';
    RAISE NOTICE '  - 1분마다: execute_scheduled_session_ends() → 예정된 종료 실행';
    RAISE NOTICE '============================================';
END $$;