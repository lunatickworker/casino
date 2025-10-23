-- ============================================================================
-- 116. 게임 세션 조회 오류 수정
-- ============================================================================
-- 목적: 게임 실행 후 실시간 사용자 현황에 리스트업되지 않는 문제 해결
-- 문제: 
--   1. save_game_launch_session 함수가 세션을 생성하지만 RLS 정책으로 조회 불가
--   2. game_launch_sessions 테이블의 SELECT 정책이 너무 제한적
-- ============================================================================

-- 1. game_launch_sessions 테이블 RLS 정책 확인 및 수정
DROP POLICY IF EXISTS "game_launch_sessions_select_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_insert_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_update_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_delete_policy" ON game_launch_sessions;

-- 모든 인증된 사용자가 모든 게임 세션 조회 가능 (관리자 모니터링용)
CREATE POLICY "game_launch_sessions_select_all" ON game_launch_sessions
    FOR SELECT TO authenticated
    USING (true);

-- 인증된 사용자는 세션 생성 가능
CREATE POLICY "game_launch_sessions_insert" ON game_launch_sessions
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- 인증된 사용자는 세션 업데이트 가능
CREATE POLICY "game_launch_sessions_update" ON game_launch_sessions
    FOR UPDATE TO authenticated
    USING (true);

-- 2. save_game_launch_session 함수에 로깅 추가
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
BEGIN
    -- 로깅
    RAISE NOTICE '🎮 게임 세션 생성 시작: user_id=%, game_id=%, opcode=%', p_user_id, p_game_id, p_opcode;
    
    -- 기존 활성 세션 종료
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND game_id != p_game_id;
    
    RAISE NOTICE '🎮 기존 활성 세션 종료 완료';
    
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
    
    RAISE NOTICE '✅ 게임 세션 생성 완료: session_id=%', session_id;
    
    -- 세션 ID 반환
    RETURN session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        -- 오류 발생 시 로그 출력 및 NULL 반환
        RAISE WARNING '❌ save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 함수 권한 재설정
GRANT EXECUTE ON FUNCTION save_game_launch_session TO anon, authenticated;

-- 4. 활성 게임 세션 조회 뷰 생성 (성능 최적화)
CREATE OR REPLACE VIEW active_game_sessions AS
SELECT 
    gls.id,
    gls.user_id,
    gls.game_id,
    gls.opcode,
    gls.status,
    gls.launched_at,
    gls.balance_before,
    u.username,
    u.nickname,
    u.balance as current_balance,
    g.name as game_name,
    gp.name as provider_name,
    EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER as session_duration_seconds
FROM game_launch_sessions gls
INNER JOIN users u ON gls.user_id = u.id
LEFT JOIN games g ON gls.game_id = g.id
LEFT JOIN game_providers gp ON g.provider_id = gp.id
WHERE gls.status = 'active'
AND gls.ended_at IS NULL
AND gls.launched_at >= NOW() - INTERVAL '24 hours'
ORDER BY gls.launched_at DESC;

-- 뷰 권한 설정
GRANT SELECT ON active_game_sessions TO authenticated;

-- 5. 게임 세션 통계 함수 생성
CREATE OR REPLACE FUNCTION get_active_game_session_count()
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM game_launch_sessions
        WHERE status = 'active'
        AND ended_at IS NULL
        AND launched_at >= NOW() - INTERVAL '24 hours'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_active_game_session_count TO authenticated;

-- 6. 테스트 쿼리 실행
DO $$
DECLARE
    active_count INTEGER;
BEGIN
    -- 활성 세션 수 확인
    SELECT get_active_game_session_count() INTO active_count;
    RAISE NOTICE '📊 현재 활성 게임 세션 수: %', active_count;
    
    -- 최근 세션 확인
    IF EXISTS (SELECT 1 FROM game_launch_sessions LIMIT 1) THEN
        RAISE NOTICE '✅ game_launch_sessions 테이블에 데이터가 있습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_launch_sessions 테이블이 비어 있습니다.';
    END IF;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 116. 게임 세션 조회 오류 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. game_launch_sessions RLS 정책 수정 (모든 인증 사용자 조회 가능)';
    RAISE NOTICE '2. save_game_launch_session 함수에 로깅 추가';
    RAISE NOTICE '3. active_game_sessions 뷰 생성';
    RAISE NOTICE '4. get_active_game_session_count 함수 생성';
    RAISE NOTICE '============================================';
END $$;
