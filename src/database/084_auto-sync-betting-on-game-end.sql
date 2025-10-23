-- =====================================================
-- 게임 세션 종료 시 자동 베팅 내역 동기화
-- =====================================================

-- 게임 세션 종료 시 베팅 내역 자동 수집 함수
CREATE OR REPLACE FUNCTION sync_betting_history_for_session(
    p_session_id UUID,
    p_user_id UUID,
    p_opcode TEXT,
    p_secret_key TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    records_synced INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_username TEXT;
    v_last_played_at TIMESTAMPTZ;
    v_records_synced INTEGER := 0;
BEGIN
    -- 사용자 정보 조회
    SELECT username INTO v_username
    FROM users
    WHERE id = p_user_id;
    
    IF v_username IS NULL THEN
        RETURN QUERY SELECT FALSE, 0, 'User not found'::TEXT;
        RETURN;
    END IF;
    
    -- 마지막 베팅 시간 조회 (최근 1시간 내)
    SELECT MAX(played_at) INTO v_last_played_at
    FROM game_records
    WHERE user_id = p_user_id
    AND played_at >= NOW() - INTERVAL '1 hour';
    
    -- 알림: 실제 API 호출은 클라이언트에서 수행하고 결과를 save_betting_records_batch로 저장
    -- 이 함수는 게임 세션 종료 시 필요한 정보를 반환
    
    RETURN QUERY SELECT 
        TRUE, 
        v_records_synced, 
        format('Ready to sync for user %s, last played at %s', v_username, v_last_played_at)::TEXT;
    
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게임 세션 테이블에 베팅 기록 동기화 상태 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_launch_sessions' 
        AND column_name = 'betting_synced'
    ) THEN
        ALTER TABLE game_launch_sessions 
        ADD COLUMN betting_synced BOOLEAN DEFAULT FALSE,
        ADD COLUMN betting_sync_attempted_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN betting_records_found INTEGER DEFAULT 0;
        
        RAISE NOTICE 'game_launch_sessions에 베팅 동기화 컬럼 추가 완료';
    END IF;
END $$;

-- 베팅 내역 자동 수집 트리거 함수
CREATE OR REPLACE FUNCTION trigger_betting_sync_on_session_end()
RETURNS TRIGGER AS $$
BEGIN
    -- 세션이 종료되었을 때 (ended_at이 설정됨)
    IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN
        -- WebSocket 알림 발송 (베팅 내역 수집 필요)
        PERFORM pg_notify(
            'betting_sync_required',
            json_build_object(
                'session_id', NEW.id,
                'user_id', NEW.user_id,
                'game_id', NEW.game_id,
                'ended_at', NEW.ended_at
            )::text
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_session_end_betting_sync ON game_launch_sessions;
CREATE TRIGGER trigger_session_end_betting_sync
    AFTER UPDATE ON game_launch_sessions
    FOR EACH ROW
    WHEN (NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL)
    EXECUTE FUNCTION trigger_betting_sync_on_session_end();

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION sync_betting_history_for_session(UUID, UUID, TEXT, TEXT) TO authenticated;

-- 주석
COMMENT ON FUNCTION sync_betting_history_for_session IS '게임 세션 종료 시 해당 세션의 베팅 내역을 동기화합니다';
COMMENT ON TRIGGER trigger_session_end_betting_sync ON game_launch_sessions IS '게임 세션 종료 시 베팅 내역 동기화 알림을 발송합니다';
