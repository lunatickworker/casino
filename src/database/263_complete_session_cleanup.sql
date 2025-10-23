-- ============================================================================
-- 263. 세션 자동 종료 로직 완전 제거 (188번 트리거 포함)
-- ============================================================================
-- 작성일: 2025-10-17
-- 목적: 
--   188번, 260번, 261번에서 만든 모든 세션 자동 종료 로직 완전 삭제
--   세션은 생성 시 항상 active 상태로 유지
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '263. 세션 자동 종료 로직 완전 제거';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 모든 트리거 제거
-- ============================================

DROP TRIGGER IF EXISTS trigger_update_session_on_betting ON game_records CASCADE;
DROP TRIGGER IF EXISTS trg_update_session_on_betting ON game_records CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 모든 베팅 관련 트리거 제거 완료';
END $$;

-- ============================================
-- 2단계: 모든 세션 관리 함수 제거
-- ============================================

DROP FUNCTION IF EXISTS update_session_activity_on_betting() CASCADE;
DROP FUNCTION IF EXISTS update_game_session_on_betting() CASCADE;
DROP FUNCTION IF EXISTS expire_inactive_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS manage_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS expire_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS end_game_session(BIGINT) CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 모든 세션 자동 관리 함수 제거 완료';
END $$;

-- ============================================
-- 3단계: save_game_launch_session 함수 재작성 (초간단 버전)
-- ============================================

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
    v_partner_id UUID;
    v_random_session_id TEXT;
BEGIN
    -- 사용자의 partner_id 조회
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    -- 랜덤 session_id 생성
    v_random_session_id := substring(md5(random()::text || clock_timestamp()::text) from 1 for 16);
    
    -- 새 게임 세션 생성 (무조건 active, ended_at은 NULL)
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
        NULL,  -- ended_at은 항상 NULL
        'active',  -- 무조건 active
        NOW(),
        v_partner_id,
        v_random_session_id
    ) RETURNING id INTO v_session_id;
    
    RAISE NOTICE '✅ 게임 세션 생성 완료: session_id=%, user=%, game=%, status=active', 
        v_session_id, p_user_id, p_game_id;
    
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
    RAISE NOTICE '✅ save_game_launch_session 함수 재작성 완료 (무조건 active)';
END $$;

-- ============================================
-- 4단계: 모든 ended 세션을 active로 변경
-- ============================================

UPDATE game_launch_sessions
SET 
    status = 'active',
    ended_at = NULL,
    last_activity_at = COALESCE(last_activity_at, launched_at)
WHERE status != 'active';

DO $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RAISE NOTICE '✅ % 건의 세션을 active로 변경', v_updated_count;
END $$;

-- ============================================
-- 5단계: 현재 세션 상태 확인
-- ============================================

DO $$
DECLARE
    v_total_sessions INTEGER;
    v_active_sessions INTEGER;
    v_ended_sessions INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_sessions FROM game_launch_sessions;
    SELECT COUNT(*) INTO v_active_sessions FROM game_launch_sessions WHERE status = 'active';
    SELECT COUNT(*) INTO v_ended_sessions FROM game_launch_sessions WHERE status = 'ended';
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 현재 세션 상태:';
    RAISE NOTICE '  - 전체 세션: % 건', v_total_sessions;
    RAISE NOTICE '  - 활성(active): % 건', v_active_sessions;
    RAISE NOTICE '  - 종료(ended): % 건', v_ended_sessions;
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 263. 세션 자동 종료 로직 완전 제거 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. ✅ 모든 베팅 트리거 제거 (188번, 261번)';
    RAISE NOTICE '2. ✅ 모든 세션 자동 관리 함수 제거';
    RAISE NOTICE '3. ✅ save_game_launch_session 초간단 버전으로 재작성';
    RAISE NOTICE '4. ✅ 모든 세션을 active로 복원';
    RAISE NOTICE '';
    RAISE NOTICE '📌 최종 상태:';
    RAISE NOTICE '  - 세션은 생성 시 항상 active 상태';
    RAISE NOTICE '  - 자동 종료 로직 완전히 없음';
    RAISE NOTICE '  - ended_at은 항상 NULL';
    RAISE NOTICE '  - 트리거 없음, 함수 없음';
    RAISE NOTICE '============================================';
END $$;
