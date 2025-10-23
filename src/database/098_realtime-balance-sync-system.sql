-- =====================================================
-- 실시간 보유금 업데이트 시스템
-- =====================================================

-- 게임 런치 세션 생성 함수
CREATE OR REPLACE FUNCTION create_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode TEXT,
    p_launch_url TEXT,
    p_session_token TEXT,
    p_balance_before DECIMAL(15,2)
)
RETURNS TABLE (
    session_id UUID,
    success BOOLEAN,
    message TEXT
) AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- 세션 ID 생성
    v_session_id := gen_random_uuid();
    
    -- 기존 활성 세션이 있으면 종료
    UPDATE game_launch_sessions 
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id 
    AND status = 'active';
    
    -- 새 세션 생성
    INSERT INTO game_launch_sessions (
        id,
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        status
    ) VALUES (
        v_session_id,
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        p_balance_before,
        NOW(),
        'active'
    );
    
    -- 활동 로그 기록
    INSERT INTO activity_logs (
        actor_type,
        actor_id,
        action,
        details
    ) VALUES (
        'user',
        p_user_id,
        'game_session_start',
        json_build_object(
            'session_id', v_session_id,
            'game_id', p_game_id,
            'opcode', p_opcode,
            'balance_before', p_balance_before
        )
    );
    
    RETURN QUERY SELECT 
        v_session_id,
        TRUE,
        'Game session created successfully'::TEXT;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        NULL::UUID,
        FALSE,
        SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게임 런치 세션 종료 함수
CREATE OR REPLACE FUNCTION end_game_launch_session(
    p_session_id UUID,
    p_balance_after DECIMAL(15,2) DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT
) AS $$
DECLARE
    v_session game_launch_sessions%ROWTYPE;
BEGIN
    -- 세션 정보 조회
    SELECT * INTO v_session
    FROM game_launch_sessions
    WHERE id = p_session_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Session not found'::TEXT;
        RETURN;
    END IF;
    
    -- 세션 종료 처리
    UPDATE game_launch_sessions 
    SET 
        status = 'ended',
        ended_at = NOW(),
        balance_after = p_balance_after
    WHERE id = p_session_id;
    
    -- 활동 로그 기록
    INSERT INTO activity_logs (
        actor_type,
        actor_id,
        action,
        details
    ) VALUES (
        'user',
        v_session.user_id,
        'game_session_end',
        json_build_object(
            'session_id', p_session_id,
            'game_id', v_session.game_id,
            'balance_before', v_session.balance_before,
            'balance_after', p_balance_after,
            'session_duration', EXTRACT(EPOCH FROM (NOW() - v_session.launched_at))
        )
    );
    
    -- WebSocket 알림 발송
    PERFORM pg_notify(
        'game_session_ended',
        json_build_object(
            'session_id', p_session_id,
            'user_id', v_session.user_id,
            'game_id', v_session.game_id,
            'balance_before', v_session.balance_before,
            'balance_after', p_balance_after
        )::text
    );
    
    RETURN QUERY SELECT TRUE, 'Session ended successfully'::TEXT;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 사용자 잔고 실시간 업데이트 함수
CREATE OR REPLACE FUNCTION update_user_balance_realtime(
    p_user_id UUID,
    p_new_balance DECIMAL(15,2),
    p_sync_source TEXT DEFAULT 'api',
    p_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    old_balance DECIMAL(15,2),
    new_balance DECIMAL(15,2),
    message TEXT
) AS $$
DECLARE
    v_old_balance DECIMAL(15,2);
    v_username TEXT;
BEGIN
    -- 기존 잔고 조회
    SELECT balance, username INTO v_old_balance, v_username
    FROM users
    WHERE id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0::DECIMAL(15,2), 0::DECIMAL(15,2), 'User not found'::TEXT;
        RETURN;
    END IF;
    
    -- 잔고 업데이트
    UPDATE users 
    SET 
        balance = p_new_balance,
        updated_at = NOW()
    WHERE id = p_user_id;
    
    -- 잔고 변경 로그 기록
    INSERT INTO activity_logs (
        actor_type,
        actor_id,
        action,
        details
    ) VALUES (
        'system',
        p_user_id,
        'balance_update',
        json_build_object(
            'old_balance', v_old_balance,
            'new_balance', p_new_balance,
            'sync_source', p_sync_source,
            'session_id', p_session_id,
            'username', v_username
        )
    );
    
    -- WebSocket 실시간 알림
    PERFORM pg_notify(
        'balance_updated',
        json_build_object(
            'user_id', p_user_id,
            'username', v_username,
            'old_balance', v_old_balance,
            'new_balance', p_new_balance,
            'sync_source', p_sync_source,
            'timestamp', NOW()
        )::text
    );
    
    RETURN QUERY SELECT 
        TRUE, 
        v_old_balance, 
        p_new_balance, 
        'Balance updated successfully'::TEXT;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        FALSE, 
        0::DECIMAL(15,2), 
        0::DECIMAL(15,2), 
        SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 활성 게임 세션 조회 함수
CREATE OR REPLACE FUNCTION get_active_game_sessions(
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    session_id UUID,
    user_id UUID,
    username TEXT,
    game_id BIGINT,
    game_name TEXT,
    opcode TEXT,
    balance_before DECIMAL(15,2),
    launched_at TIMESTAMP WITH TIME ZONE,
    session_duration_seconds INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        gls.id as session_id,
        gls.user_id,
        u.username,
        gls.game_id,
        g.name as game_name,
        gls.opcode,
        gls.balance_before,
        gls.launched_at,
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER as session_duration_seconds
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    WHERE gls.status = 'active'
    AND (p_user_id IS NULL OR gls.user_id = p_user_id)
    ORDER BY gls.launched_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게임 세션 통계 조회 함수
CREATE OR REPLACE FUNCTION get_game_session_stats(
    p_user_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    total_sessions INTEGER,
    total_play_time_minutes INTEGER,
    avg_session_duration_minutes DECIMAL(10,2),
    total_balance_change DECIMAL(15,2),
    win_sessions INTEGER,
    loss_sessions INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_sessions,
        ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - launched_at)) / 60))::INTEGER as total_play_time_minutes,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - launched_at)) / 60), 2) as avg_session_duration_minutes,
        COALESCE(SUM(balance_after - balance_before), 0) as total_balance_change,
        COUNT(CASE WHEN balance_after > balance_before THEN 1 END)::INTEGER as win_sessions,
        COUNT(CASE WHEN balance_after < balance_before THEN 1 END)::INTEGER as loss_sessions
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND launched_at >= NOW() - (p_days || ' days')::INTERVAL
    AND balance_after IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 관리자용 실시간 게임 모니터링 함수
CREATE OR REPLACE FUNCTION get_realtime_gaming_activity()
RETURNS TABLE (
    session_id UUID,
    user_id UUID,
    username TEXT,
    nickname TEXT,
    game_name TEXT,
    provider_name TEXT,
    balance_before DECIMAL(15,2),
    current_balance DECIMAL(15,2),
    session_duration_minutes INTEGER,
    launched_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        gls.id as session_id,
        gls.user_id,
        u.username,
        u.nickname,
        g.name as game_name,
        gp.name as provider_name,
        gls.balance_before,
        u.balance as current_balance,
        ROUND(EXTRACT(EPOCH FROM (NOW() - gls.launched_at)) / 60)::INTEGER as session_duration_minutes,
        gls.launched_at
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
    WHERE gls.status = 'active'
    AND gls.launched_at >= NOW() - INTERVAL '12 hours'
    ORDER BY gls.launched_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거: 게임 세션 상태 변경 시 WebSocket 알림
CREATE OR REPLACE FUNCTION notify_game_session_change()
RETURNS TRIGGER AS $$
BEGIN
    -- 세션 시작 알림
    IF TG_OP = 'INSERT' THEN
        PERFORM pg_notify(
            'game_session_start',
            json_build_object(
                'session_id', NEW.id,
                'user_id', NEW.user_id,
                'game_id', NEW.game_id,
                'balance_before', NEW.balance_before,
                'launched_at', NEW.launched_at
            )::text
        );
        RETURN NEW;
    END IF;
    
    -- 세션 종료 알림
    IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'ended' THEN
        PERFORM pg_notify(
            'game_session_end',
            json_build_object(
                'session_id', NEW.id,
                'user_id', NEW.user_id,
                'game_id', NEW.game_id,
                'balance_before', NEW.balance_before,
                'balance_after', NEW.balance_after,
                'ended_at', NEW.ended_at
            )::text
        );
        RETURN NEW;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_game_session_notifications ON game_launch_sessions;
CREATE TRIGGER trigger_game_session_notifications
    AFTER INSERT OR UPDATE ON game_launch_sessions
    FOR EACH ROW
    EXECUTE FUNCTION notify_game_session_change();

-- 권한 설정
GRANT EXECUTE ON FUNCTION create_game_launch_session(UUID, BIGINT, TEXT, TEXT, TEXT, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION end_game_launch_session(UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_balance_realtime(UUID, DECIMAL, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_game_sessions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_game_session_stats(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_realtime_gaming_activity() TO authenticated;

-- 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_user_status ON game_launch_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_launched_at ON game_launch_sessions(launched_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_action ON activity_logs(actor_id, action);

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ 실시간 보유금 업데이트 시스템 구축 완료';
    RAISE NOTICE '- 게임 세션 추적 및 관리';
    RAISE NOTICE '- 실시간 잔고 동기화';
    RAISE NOTICE '- WebSocket 알림 시스템';
    RAISE NOTICE '- 관리자 실시간 모니터링';
    RAISE NOTICE '- 게임 통계 및 분석';
END $$;