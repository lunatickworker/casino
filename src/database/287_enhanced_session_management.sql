-- ============================================================================
-- 287. 세션 관리 시스템 개선 (요청사항 반영)
-- ============================================================================
-- 작성일: 2025-10-19
-- 목적: 
--   1. 30초 내 중복 세션 생성 방지
--   2. 4시간 이내 재활성화 (30분 → 4시간 변경)
--   3. ended 세션 4시간 후 자동 삭제
--   4. played_at 감시는 기존 game_records 기반 유지
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '287. 세션 관리 시스템 개선';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: save_game_launch_session 함수 수정
-- 30초 내 중복 생성 방지, 4시간 재활성화
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
    -- 사용자의 partner_id 조회
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    -- 🚫 30초 내 중복 세션 생성 방지
    SELECT launched_at INTO v_recent_session_time
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND status = 'active'
    AND launched_at > NOW() - INTERVAL '30 seconds'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    IF v_recent_session_time IS NOT NULL THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ save_game_launch_session 함수 수정 완료 (30초 중복 방지, 4시간 재활성화)';
END $$;

-- ============================================
-- 2단계: reactivate_session_on_betting 함수 수정
-- 4시간 이내 재활성화
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
    
    -- 2. Active 세션이 없으면 4시간 내 ended 세션 찾기
    SELECT id, session_id INTO v_session_id, v_session_token
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'ended'
    AND (ended_at > NOW() - INTERVAL '4 hours' OR launched_at > NOW() - INTERVAL '4 hours')
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

DO $$
BEGIN
    RAISE NOTICE '✅ reactivate_session_on_betting 함수 수정 완료 (4시간 재활성화)';
END $$;

-- ============================================
-- 3단계: ended 세션 4시간 후 자동 삭제 함수
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_ended_sessions() RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER := 0;
BEGIN
    -- ended 세션 중 ended_at 기준 4시간 경과한 세션 삭제
    WITH deleted AS (
        DELETE FROM game_launch_sessions
        WHERE status = 'ended'
        AND ended_at IS NOT NULL
        AND ended_at < NOW() - INTERVAL '4 hours'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
    
    IF v_deleted_count > 0 THEN
        RAISE NOTICE '🗑️ ended 세션 자동 삭제: %건 (4시간 경과)', v_deleted_count;
    END IF;
    
    RETURN v_deleted_count;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ cleanup_old_ended_sessions 오류: %', SQLERRM;
        RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_old_ended_sessions() TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ cleanup_old_ended_sessions 함수 생성 완료';
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 287. 세션 관리 시스템 개선 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '수정된 항목:';
    RAISE NOTICE '1. ✅ save_game_launch_session() - 30초 중복 방지, 4시간 재활성화';
    RAISE NOTICE '2. ✅ reactivate_session_on_betting() - 4시간 재활성화';
    RAISE NOTICE '3. ✅ cleanup_old_ended_sessions() - ended 세션 4시간 후 삭제';
    RAISE NOTICE '';
    RAISE NOTICE '📌 적용된 요청사항:';
    RAISE NOTICE '  1. ✅ 세션 생성 시 launched_at 기준 4분 타이머 (기존 구현)';
    RAISE NOTICE '  2. ✅ played_at 감시하여 4분 무활동 시 ended (기존 구현)';
    RAISE NOTICE '  3. ✅ ended 후 4시간 내 played_at 업데이트 시 재활성화 (30분→4시간)';
    RAISE NOTICE '  4. ✅ ended 세션 4시간 후 삭제 (신규)';
    RAISE NOTICE '  5. ✅ 30초 내 중복 세션 생성 방지 (신규)';
    RAISE NOTICE '';
    RAISE NOTICE '⏰ 주기적 실행 필요:';
    RAISE NOTICE '  - execute_scheduled_session_ends() : 1분마다 (4분 무활동 세션 종료)';
    RAISE NOTICE '  - cleanup_old_ended_sessions() : 1시간마다 (오래된 ended 세션 삭제)';
    RAISE NOTICE '============================================';
END $$;
