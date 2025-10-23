-- ============================================================================
-- 264. 사용자별 마지막 베팅 시간 추적 테이블
-- ============================================================================
-- 작성일: 2025-10-17
-- 목적: 
--   username별 마지막 베팅 시간을 추적하여 4분 무활동 시 세션 종료
--   세션은 30분간 잔류하며, 같은 user_id+game_id 세션 생성 시 재활성화
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '264. 사용자별 마지막 베팅 시간 추적 시스템';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 사용자별 마지막 베팅 시간 추적 테이블 생성
-- ============================================

CREATE TABLE IF NOT EXISTS user_betting_tracker (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(50) NOT NULL,
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    last_betting_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, partner_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_betting_tracker_user_id ON user_betting_tracker(user_id);
CREATE INDEX IF NOT EXISTS idx_user_betting_tracker_username ON user_betting_tracker(username);
CREATE INDEX IF NOT EXISTS idx_user_betting_tracker_partner_id ON user_betting_tracker(partner_id);
CREATE INDEX IF NOT EXISTS idx_user_betting_tracker_last_betting ON user_betting_tracker(last_betting_at);

DO $$
BEGIN
    RAISE NOTICE '✅ user_betting_tracker 테이블 생성 완료';
END $$;

-- ============================================
-- 2단계: 베팅 시간 업데이트 함수
-- ============================================

CREATE OR REPLACE FUNCTION update_user_betting_time(
    p_user_id UUID,
    p_username VARCHAR(50),
    p_partner_id UUID
) RETURNS VOID AS $$
BEGIN
    -- UPSERT: 존재하면 업데이트, 없으면 생성
    INSERT INTO user_betting_tracker (user_id, username, partner_id, last_betting_at, updated_at)
    VALUES (p_user_id, p_username, p_partner_id, NOW(), NOW())
    ON CONFLICT (user_id, partner_id) 
    DO UPDATE SET 
        last_betting_at = NOW(),
        updated_at = NOW();
        
    RAISE NOTICE '✅ 사용자 % 베팅 시간 업데이트: %', p_username, NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_user_betting_time(UUID, VARCHAR, UUID) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ update_user_betting_time 함수 생성 완료';
END $$;

-- ============================================
-- 3단계: 비활성 세션 자동 종료 함수
-- ============================================

CREATE OR REPLACE FUNCTION end_inactive_sessions() RETURNS INTEGER AS $$
DECLARE
    v_ended_count INTEGER := 0;
    v_four_minutes_ago TIMESTAMPTZ;
    v_session RECORD;
BEGIN
    v_four_minutes_ago := NOW() - INTERVAL '4 minutes';
    
    -- 활성 세션 중 마지막 베팅이 4분 이상 지난 세션 찾기
    FOR v_session IN
        SELECT 
            gls.id,
            gls.session_id,
            gls.user_id,
            gls.game_id,
            u.username,
            COALESCE(ubt.last_betting_at, gls.launched_at) as last_activity
        FROM game_launch_sessions gls
        INNER JOIN users u ON gls.user_id = u.id
        LEFT JOIN user_betting_tracker ubt ON gls.user_id = ubt.user_id
        WHERE gls.status = 'active'
        AND gls.launched_at < NOW() - INTERVAL '5 minutes' -- 최소 5분 이상 경과한 세션만
    LOOP
        -- 마지막 베팅이 4분 이상 지났으면 종료
        IF v_session.last_activity < v_four_minutes_ago THEN
            UPDATE game_launch_sessions
            SET 
                status = 'ended',
                ended_at = NOW()
            WHERE id = v_session.id;
            
            v_ended_count := v_ended_count + 1;
            RAISE NOTICE '⏹️ 세션 종료: % (사용자: %, 마지막 활동: %)', 
                v_session.session_id, v_session.username, v_session.last_activity;
        END IF;
    END LOOP;
    
    RETURN v_ended_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION end_inactive_sessions() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ end_inactive_sessions 함수 생성 완료';
END $$;

-- ============================================
-- 4단계: 세션 재활성화 함수 (같은 user_id + game_id)
-- ============================================

CREATE OR REPLACE FUNCTION reactivate_or_create_session(
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
BEGIN
    -- 사용자의 partner_id 조회
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    -- 30분 이내 같은 user_id + game_id의 ended 세션 찾기
    SELECT id, session_id INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'ended'
    AND launched_at > NOW() - INTERVAL '30 minutes'
    ORDER BY ended_at DESC
    LIMIT 1;
    
    -- 기존 세션이 있으면 재활성화
    IF v_existing_session.id IS NOT NULL THEN
        UPDATE game_launch_sessions
        SET 
            status = 'active',
            ended_at = NULL,
            last_activity_at = NOW(),
            launch_url = p_launch_url,
            session_token = p_session_token
        WHERE id = v_existing_session.id;
        
        RAISE NOTICE '🔄 세션 재활성화: session_id=%, user=%, game=%', 
            v_existing_session.session_id, p_user_id, p_game_id;
        
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
    
    RAISE NOTICE '✅ 새 세션 생성: session_id=%, user=%, game=%', 
        v_session_id, p_user_id, p_game_id;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ reactivate_or_create_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reactivate_or_create_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ reactivate_or_create_session 함수 생성 완료';
END $$;

-- ============================================
-- 5단계: RLS 정책
-- ============================================

ALTER TABLE user_betting_tracker ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_betting_tracker_select_policy" ON user_betting_tracker;
CREATE POLICY "user_betting_tracker_select_policy" 
ON user_betting_tracker FOR SELECT 
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS "user_betting_tracker_insert_policy" ON user_betting_tracker;
CREATE POLICY "user_betting_tracker_insert_policy" 
ON user_betting_tracker FOR INSERT 
TO authenticated, anon
WITH CHECK (true);

DROP POLICY IF EXISTS "user_betting_tracker_update_policy" ON user_betting_tracker;
CREATE POLICY "user_betting_tracker_update_policy" 
ON user_betting_tracker FOR UPDATE 
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
    RAISE NOTICE '✅ 264. 사용자별 베팅 추적 시스템 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '생성된 항목:';
    RAISE NOTICE '1. ✅ user_betting_tracker 테이블';
    RAISE NOTICE '2. ✅ update_user_betting_time() 함수';
    RAISE NOTICE '3. ✅ end_inactive_sessions() 함수';
    RAISE NOTICE '4. ✅ reactivate_or_create_session() 함수';
    RAISE NOTICE '';
    RAISE NOTICE '📌 사용 방법:';
    RAISE NOTICE '  - 30초마다 historyindex 호출 시 update_user_betting_time() 호출';
    RAISE NOTICE '  - 2분마다 end_inactive_sessions() 호출하여 비활성 세션 종료';
    RAISE NOTICE '  - 게임 실행 시 reactivate_or_create_session() 사용';
    RAISE NOTICE '============================================';
END $$;
