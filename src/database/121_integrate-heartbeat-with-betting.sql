-- ============================================================================
-- 121. 베팅내역 동기화와 게임 세션 heartbeat 연동
-- ============================================================================
-- 목적: 베팅이 발생할 때마다 자동으로 heartbeat 업데이트
-- 정책: 1분 동안 베팅이 없으면 게임 세션 자동 만료
-- ============================================================================

-- 1. 기존 함수 및 트리거 완전 제거
DROP TRIGGER IF EXISTS trigger_update_heartbeat_on_betting ON game_records CASCADE;
DROP FUNCTION IF EXISTS update_session_heartbeat_on_betting() CASCADE;
DROP FUNCTION IF EXISTS save_betting_records_with_heartbeat(JSONB) CASCADE;
DROP FUNCTION IF EXISTS sync_user_balance_with_heartbeat(TEXT, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS periodic_session_cleanup() CASCADE;

-- 2. 베팅 저장시 heartbeat 자동 업데이트 함수
CREATE FUNCTION update_session_heartbeat_on_betting()
RETURNS TRIGGER AS $$
BEGIN
    -- 해당 사용자의 활성 게임 세션 heartbeat 업데이트
    UPDATE game_launch_sessions
    SET last_heartbeat = NOW()
    WHERE user_id = NEW.user_id
    AND game_id = NEW.game_id
    AND status = 'active'
    AND ended_at IS NULL;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. game_records 테이블에 트리거 설정
CREATE TRIGGER trigger_update_heartbeat_on_betting
AFTER INSERT ON game_records
FOR EACH ROW
EXECUTE FUNCTION update_session_heartbeat_on_betting();

-- 4. 베팅 배치 저장시 heartbeat 업데이트 함수
CREATE FUNCTION save_betting_records_with_heartbeat(
    p_records JSONB
)
RETURNS TABLE (
    success_count INTEGER,
    error_count INTEGER,
    errors JSONB
) AS $$
DECLARE
    v_record JSONB;
    v_success_count INTEGER := 0;
    v_error_count INTEGER := 0;
    v_errors JSONB := '[]'::JSONB;
    v_user_uuid UUID;
    v_username TEXT;
    v_game_id BIGINT;
BEGIN
    -- 먼저 오래된 세션 만료
    PERFORM expire_old_game_sessions();
    
    -- 각 베팅 레코드 처리
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            v_username := v_record->>'username';
            v_game_id := (v_record->>'game')::BIGINT;
            
            -- 사용자 ID 조회
            SELECT id INTO v_user_uuid
            FROM users
            WHERE username = v_username;
            
            IF v_user_uuid IS NULL THEN
                v_error_count := v_error_count + 1;
                v_errors := v_errors || jsonb_build_object(
                    'username', v_username,
                    'error', '사용자를 찾을 수 없음'
                );
                CONTINUE;
            END IF;
            
            -- heartbeat 업데이트
            UPDATE game_launch_sessions
            SET last_heartbeat = NOW()
            WHERE user_id = v_user_uuid
            AND game_id = v_game_id
            AND status = 'active'
            AND ended_at IS NULL;
            
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            v_errors := v_errors || jsonb_build_object(
                'username', v_username,
                'error', SQLERRM
            );
        END;
    END LOOP;
    
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 보유금 동기화시 heartbeat 업데이트 함수
CREATE FUNCTION sync_user_balance_with_heartbeat(
    p_username TEXT,
    p_new_balance DECIMAL(15,2)
) RETURNS void AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- 사용자 ID 조회 및 잔고 업데이트
    UPDATE users
    SET 
        balance = p_new_balance,
        last_balance_sync = NOW()
    WHERE username = p_username
    RETURNING id INTO v_user_id;
    
    IF v_user_id IS NOT NULL THEN
        -- 해당 사용자의 모든 활성 게임 세션 heartbeat 업데이트
        UPDATE game_launch_sessions
        SET last_heartbeat = NOW()
        WHERE user_id = v_user_id
        AND status = 'active'
        AND ended_at IS NULL;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 주기적 세션 만료 체크 함수 (cron job용)
CREATE FUNCTION periodic_session_cleanup()
RETURNS void AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    -- 오래된 세션 만료
    PERFORM expire_old_game_sessions();
    
    -- 만료된 세션 수 조회
    SELECT COUNT(*) INTO v_expired_count
    FROM game_launch_sessions
    WHERE status = 'expired'
    AND ended_at >= NOW() - INTERVAL '1 minute';
    
    IF v_expired_count > 0 THEN
        RAISE NOTICE '[periodic_session_cleanup] %개 세션 만료됨', v_expired_count;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. 함수 권한 설정
GRANT EXECUTE ON FUNCTION update_session_heartbeat_on_betting() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_betting_records_with_heartbeat(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_user_balance_with_heartbeat(TEXT, DECIMAL) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION periodic_session_cleanup() TO anon, authenticated;

-- 8. 검증
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 121. 베팅-heartbeat 연동 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. 베팅 저장시 자동 heartbeat 업데이트';
    RAISE NOTICE '2. 보유금 동기화시 heartbeat 업데이트';
    RAISE NOTICE '3. 주기적 세션 정리 함수 추가';
    RAISE NOTICE '4. 1분 동안 베팅 없으면 자동 만료';
    RAISE NOTICE '';
    RAISE NOTICE '동작 방식:';
    RAISE NOTICE '- 베팅 발생 → heartbeat 업데이트';
    RAISE NOTICE '- 보유금 동기화 → heartbeat 업데이트';
    RAISE NOTICE '- 1분 무활동 → 세션 자동 만료';
    RAISE NOTICE '- 실시간 현황에서 자동 제외';
    RAISE NOTICE '============================================';
END $$;
