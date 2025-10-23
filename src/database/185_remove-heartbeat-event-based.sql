-- ============================================================================
-- 185. Heartbeat 완전 제거 및 이벤트 기반 세션 관리로 전환
-- ============================================================================
-- 작성일: 2025-10-11
-- 목적: 
--   1. last_heartbeat 컬럼 제거
--   2. Heartbeat 관련 모든 함수 제거
--   3. 이벤트 기반 세션 상태 관리로 변경
--   4. 게임 실행 시 → INSERT (status='active')
--   5. 게임 종료 시 → UPDATE (status='ended', ended_at=NOW())
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '185. Heartbeat 제거 및 이벤트 기반 전환';
    RAISE NOTICE '============================================';
END $$;

-- 1. Heartbeat 관련 트리거 및 함수 모두 제거
DROP TRIGGER IF EXISTS trigger_update_heartbeat_on_betting ON game_records CASCADE;
DROP FUNCTION IF EXISTS update_session_heartbeat_on_betting() CASCADE;
DROP FUNCTION IF EXISTS save_betting_records_with_heartbeat(JSONB) CASCADE;
DROP FUNCTION IF EXISTS sync_user_balance_with_heartbeat(TEXT, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS periodic_session_cleanup() CASCADE;
DROP FUNCTION IF EXISTS update_game_session_heartbeat(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS update_game_session_heartbeat(UUID) CASCADE;

-- 2. Heartbeat 관련 인덱스 제거
DROP INDEX IF EXISTS idx_game_sessions_active_heartbeat CASCADE;

-- 3. last_heartbeat 컬럼 제거
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_launch_sessions'
        AND column_name = 'last_heartbeat'
    ) THEN
        ALTER TABLE game_launch_sessions DROP COLUMN last_heartbeat;
        RAISE NOTICE '✅ last_heartbeat 컬럼 제거 완료';
    ELSE
        RAISE NOTICE '⏭️ last_heartbeat 컬럼 없음';
    END IF;
END $$;

-- 4. 이벤트 기반 자동 만료 함수 (Heartbeat 제거)
-- 기존 함수 제거 (반환 타입 변경을 위해 필요)
DROP FUNCTION IF EXISTS expire_old_game_sessions() CASCADE;

CREATE OR REPLACE FUNCTION expire_old_game_sessions()
RETURNS INTEGER AS $
DECLARE
    v_expired_count INTEGER;
BEGIN
    -- 이벤트 기반 관리이므로 자동 만료는 하지 않음
    -- 게임 종료 이벤트가 발생하지 않은 비정상 세션만 정리
    -- 24시간 이상 된 active 세션은 자동 종료 (비정상 세션)
    UPDATE game_launch_sessions
    SET 
        status = 'expired',
        ended_at = NOW()
    WHERE status = 'active'
    AND ended_at IS NULL
    AND launched_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    
    IF v_expired_count > 0 THEN
        RAISE NOTICE '⚠️ % 개의 비정상 세션 자동 만료 (24시간 경과)', v_expired_count;
    END IF;
    
    RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 게임 세션 저장 함수 (Heartbeat 제거)
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
BEGIN
    -- 이전 활성 세션 종료 (동일 사용자의 다른 게임)
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND ended_at IS NULL;
    
    -- 새 게임 세션 생성
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
        COALESCE(p_balance_before, 0),
        NOW(),
        NULL,
        'active'  -- 항상 active로 시작
    ) RETURNING id INTO v_session_id;
    
    RAISE NOTICE '✅ 게임 세션 생성: Session ID %, User %, Game %', v_session_id, p_user_id, p_game_id;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 게임 세션 종료 함수 (이벤트 기반)
CREATE OR REPLACE FUNCTION end_game_session(
    p_session_id BIGINT
) RETURNS void AS $$
BEGIN
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE id = p_session_id
    AND status = 'active'
    AND ended_at IS NULL;
    
    IF FOUND THEN
        RAISE NOTICE '✅ 게임 세션 종료: Session ID %', p_session_id;
    ELSE
        RAISE NOTICE '⚠️ 종료할 세션 없음: Session ID %', p_session_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. 활성 게임 세션 조회 (Heartbeat 조건 제거)
DROP FUNCTION IF EXISTS get_active_game_sessions() CASCADE;
DROP FUNCTION IF EXISTS get_active_game_sessions(UUID) CASCADE;
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
    balance_before DECIMAL(15,2),
    current_balance DECIMAL(15,2),
    session_duration_minutes INTEGER,
    launched_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_type TEXT;
    v_allowed_partner_ids UUID[];
BEGIN
    -- 비정상 세션 자동 만료
    PERFORM expire_old_game_sessions();
    
    -- 관리자 권한 확인
    IF p_admin_partner_id IS NOT NULL THEN
        SELECT partner_type INTO v_admin_type
        FROM partners
        WHERE id = p_admin_partner_id;
        
        IF v_admin_type = '시스템관리자' THEN
            v_allowed_partner_ids := NULL;
        ELSIF v_admin_type = '대본사' THEN
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
        ELSE
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
        END IF;
    END IF;
    
    RETURN QUERY
    SELECT DISTINCT ON (gls.user_id, gls.game_id)
        gls.id as session_id,
        gls.user_id,
        u.username,
        COALESCE(u.nickname, u.username) as nickname,
        COALESCE(g.name, 'Unknown Game') as game_name,
        COALESCE(gp.name, 'Unknown Provider') as provider_name,
        gls.balance_before,
        u.balance as current_balance,
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60 as session_duration_minutes,
        gls.launched_at
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
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

-- 8. 게임 세션 통계 함수 (Heartbeat 조건 제거)
DROP FUNCTION IF EXISTS get_game_session_stats() CASCADE;
DROP FUNCTION IF EXISTS get_game_session_stats(UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_game_session_stats(
    p_admin_partner_id UUID DEFAULT NULL
)
RETURNS TABLE (
    total_active_sessions INTEGER,
    total_active_players INTEGER,
    avg_session_duration_minutes INTEGER,
    total_balance_change DECIMAL(15,2),
    top_provider TEXT,
    peak_concurrent_time TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_type TEXT;
    v_allowed_partner_ids UUID[];
    provider_with_most_sessions TEXT;
    peak_time TIMESTAMPTZ;
BEGIN
    -- 비정상 세션 자동 만료
    PERFORM expire_old_game_sessions();
    
    -- 관리자 권한 확인
    IF p_admin_partner_id IS NOT NULL THEN
        SELECT partner_type INTO v_admin_type
        FROM partners
        WHERE id = p_admin_partner_id;
        
        IF v_admin_type = '시스템관리자' THEN
            v_allowed_partner_ids := NULL;
        ELSIF v_admin_type = '대본사' THEN
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
        ELSE
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
        END IF;
    END IF;

    -- 가장 많은 세션을 가진 프로바이더 찾기
    SELECT gp.name INTO provider_with_most_sessions
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    JOIN games g ON gls.game_id = g.id
    JOIN game_providers gp ON g.provider_id = gp.id
    WHERE gls.status = 'active'
        AND gls.ended_at IS NULL
        AND (
            v_allowed_partner_ids IS NULL
            OR u.referrer_id = ANY(v_allowed_partner_ids)
        )
    GROUP BY gp.name
    ORDER BY COUNT(*) DESC
    LIMIT 1;

    -- 최고 동시 접속 시간 계산 (최근 24시간)
    SELECT time_bucket INTO peak_time
    FROM (
        SELECT 
            date_trunc('hour', gls.launched_at) as time_bucket,
            COUNT(*) as concurrent_sessions
        FROM game_launch_sessions gls
        JOIN users u ON gls.user_id = u.id
        WHERE gls.launched_at > NOW() - INTERVAL '24 hours'
            AND (
                v_allowed_partner_ids IS NULL
                OR u.referrer_id = ANY(v_allowed_partner_ids)
            )
        GROUP BY date_trunc('hour', gls.launched_at)
        ORDER BY concurrent_sessions DESC
        LIMIT 1
    ) peak_analysis;

    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_active_sessions,
        COUNT(DISTINCT gls.user_id)::INTEGER as total_active_players,
        COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - gls.launched_at)) / 60)::INTEGER, 0) as avg_session_duration_minutes,
        COALESCE(SUM(u.balance - gls.balance_before), 0) as total_balance_change,
        COALESCE(provider_with_most_sessions, 'N/A') as top_provider,
        COALESCE(peak_time, NOW()) as peak_concurrent_time
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    WHERE gls.status = 'active'
        AND gls.ended_at IS NULL
        AND (
            v_allowed_partner_ids IS NULL
            OR u.referrer_id = ANY(v_allowed_partner_ids)
        );
END;
$$;

-- 9. 권한 설정
GRANT EXECUTE ON FUNCTION expire_old_game_sessions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION end_game_session(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_active_game_sessions(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_game_session_stats(UUID) TO anon, authenticated;

-- 10. 기존 세션 정리 (ended_at이 launched_at보다 과거인 비정상 세션)
UPDATE game_launch_sessions
SET 
    status = 'ended',
    ended_at = launched_at + INTERVAL '1 hour'  -- 1시간 후로 설정
WHERE ended_at < launched_at;

-- 11. 완료 메시지
DO $$
DECLARE
    v_active_count INTEGER;
    v_ended_count INTEGER;
    v_total_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_count FROM game_launch_sessions;
    SELECT COUNT(*) INTO v_active_count FROM game_launch_sessions WHERE status = 'active';
    SELECT COUNT(*) INTO v_ended_count FROM game_launch_sessions WHERE status = 'ended';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 185. Heartbeat 제거 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. last_heartbeat 컬럼 제거';
    RAISE NOTICE '2. Heartbeat 관련 모든 함수/트리거 제거';
    RAISE NOTICE '3. 이벤트 기반 세션 관리로 전환';
    RAISE NOTICE '4. 게임 실행 시 → active 상태';
    RAISE NOTICE '5. 게임 종료 시 → ended 상태';
    RAISE NOTICE '6. 비정상 세션만 24시간 후 자동 만료';
    RAISE NOTICE '';
    RAISE NOTICE '📊 현재 세션 통계:';
    RAISE NOTICE '   전체: % 건', v_total_count;
    RAISE NOTICE '   활성: % 건', v_active_count;
    RAISE NOTICE '   종료: % 건', v_ended_count;
    RAISE NOTICE '============================================';
END $$;
