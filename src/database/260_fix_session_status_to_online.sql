-- ============================================================================
-- 260. game_launch_sessions 세션을 active로 유지 (완전 재작성)
-- ============================================================================
-- 작성일: 2025-01-17
-- 목적: 게임 세션이 생성될 때 무조건 'active' 상태로 유지
--       ended 상태로 변경되지 않도록 모든 자동 종료 로직 제거
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '260. 게임 세션 active 상태 유지 (완전 재작성)';
    RAISE NOTICE '============================================';
END $$;

-- ============================================================================
-- 1단계: pg_cron 스케줄 중지 및 삭제
-- ============================================================================

-- pg_cron 확장 확인 및 스케줄 삭제
DO $
BEGIN
    -- pg_cron이 있으면 스케줄 삭제
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- manage_game_sessions 스케줄 삭제
        PERFORM cron.unschedule('manage-game-sessions-5min');
        PERFORM cron.unschedule('daily-session-stats-log');
        RAISE NOTICE '✅ pg_cron 스케줄 모두 삭제 완료';
    ELSE
        RAISE NOTICE '⚠️ pg_cron 확장이 없습니다 (스킵)';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ pg_cron 스케줄 삭제 실패 (계속 진행): %', SQLERRM;
END $;

-- ============================================================================
-- 2단계: 기존 자동 종료 함수 모두 제거
-- ============================================================================

-- 자동 종료 함수들 삭제
DROP FUNCTION IF EXISTS expire_inactive_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS manage_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS expire_old_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS end_game_session(BIGINT) CASCADE;

DO $
BEGIN
    RAISE NOTICE '✅ 자동 종료 함수 모두 제거 완료';
END $;

-- ============================================================================
-- 3단계: 게임 베팅 트리거 제거 (세션 자동 종료 방지)
-- ============================================================================

-- 베팅 저장 시 세션 상태 업데이트하는 트리거 제거
DROP TRIGGER IF EXISTS trg_update_session_on_betting ON game_records CASCADE;
DROP FUNCTION IF EXISTS update_game_session_on_betting() CASCADE;

DO $
BEGIN
    RAISE NOTICE '✅ 베팅 트리거 제거 완료 (세션 자동 종료 방지)';
END $;

-- ============================================================================
-- 4단계: save_game_launch_session 함수 재작성 (초간단 버전)
-- ============================================================================

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
    
    -- 새 게임 세션 생성 (무조건 active)
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

-- ============================================================================
-- 5단계: get_active_game_sessions 함수 재작성
-- ============================================================================

DROP FUNCTION IF EXISTS get_active_game_sessions(UUID, UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_active_game_sessions(
    p_user_id UUID DEFAULT NULL,
    p_admin_partner_id UUID DEFAULT NULL
)
RETURNS TABLE (
    session_id BIGINT,
    user_id UUID,
    username VARCHAR(50),
    nickname VARCHAR(50),
    game_name VARCHAR(200),
    provider_name VARCHAR(100),
    balance DECIMAL(15,2),
    vip_level INTEGER,
    device_type VARCHAR(20),
    ip_address VARCHAR(50),
    location VARCHAR(100),
    launched_at TIMESTAMPTZ,
    last_activity TIMESTAMPTZ,
    partner_nickname VARCHAR(100)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_type TEXT;
    v_allowed_partner_ids UUID[];
BEGIN
    -- 관리자 권한 확인
    IF p_admin_partner_id IS NOT NULL THEN
        SELECT partner_type INTO v_admin_type
        FROM partners
        WHERE id = p_admin_partner_id;
        
        IF v_admin_type = '시스템관리자' THEN
            v_allowed_partner_ids := NULL;
        ELSE
            -- 본인 + 하위 파트너 모두 조회
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
        END IF;
    END IF;
    
    RETURN QUERY
    SELECT DISTINCT ON (gls.user_id, gls.game_id)
        gls.id,
        gls.user_id,
        u.username,
        COALESCE(u.nickname, u.username),
        COALESCE(g.name, 'Unknown Game'),
        COALESCE(gp.name, 'Unknown Provider'),
        u.balance,
        COALESCE(u.vip_level, 0),
        'desktop'::VARCHAR(20),
        COALESCE(u.ip_address::VARCHAR(50), 'Unknown'),
        'Unknown'::VARCHAR(100),
        gls.launched_at,
        COALESCE(gls.last_activity_at, gls.launched_at),
        COALESCE(p.nickname, 'Unknown')
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
    LEFT JOIN partners p ON u.referrer_id = p.id
    WHERE gls.status = 'active'
      AND gls.ended_at IS NULL
      AND (p_user_id IS NULL OR gls.user_id = p_user_id)
      AND (
          v_allowed_partner_ids IS NULL
          OR u.referrer_id = ANY(v_allowed_partner_ids)
      )
    ORDER BY gls.user_id, gls.game_id, gls.launched_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_active_game_sessions(UUID, UUID) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ get_active_game_sessions 함수 재작성 완료';
END $$;

-- ============================================================================
-- 6단계: 기존 ended 세션을 모두 active로 변경 (테스트용)
-- ============================================================================

UPDATE game_launch_sessions
SET 
    status = 'active',
    ended_at = NULL
WHERE status = 'ended'
  AND launched_at > NOW() - INTERVAL '1 hour';  -- 최근 1시간 세션만

DO $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RAISE NOTICE '✅ 최근 1시간 세션 % 건을 active로 변경', v_updated_count;
END $$;

-- ============================================================================
-- 완료
-- ============================================================================

DO $
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 260. 게임 세션 active 상태 유지 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. ✅ pg_cron 스케줄 모두 중지 및 삭제';
    RAISE NOTICE '2. ✅ 모든 자동 종료 함수 제거';
    RAISE NOTICE '3. ✅ 베팅 트리거 제거 (세션 자동 종료 방지)';
    RAISE NOTICE '4. ✅ save_game_launch_session: 무조건 active';
    RAISE NOTICE '5. ✅ get_active_game_sessions: active만 조회';
    RAISE NOTICE '6. ✅ 최근 1시간 세션 active로 변경';
    RAISE NOTICE '';
    RAISE NOTICE '📌 중요: 세션은 생성 시 항상 active';
    RAISE NOTICE '📌 pg_cron 자동 실행 완전히 중지됨';
    RAISE NOTICE '📌 모든 자동 종료 로직 제거됨';
    RAISE NOTICE '============================================';
END $;
