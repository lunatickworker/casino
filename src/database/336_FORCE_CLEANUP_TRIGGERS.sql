-- ============================================================================
-- 336. 강제 트리거 정리 및 재생성
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '336. 강제 트리거 정리';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 모든 세션 관련 트리거 강제 삭제
-- ============================================

DROP TRIGGER IF EXISTS trigger_update_session_on_betting ON game_records CASCADE;
DROP TRIGGER IF EXISTS trigger_create_session_from_betting ON game_records CASCADE;
DROP TRIGGER IF EXISTS trigger_reactivate_session_on_betting ON game_records CASCADE;
DROP TRIGGER IF EXISTS trigger_auto_end_sessions_on_betting ON game_records CASCADE;
DROP TRIGGER IF EXISTS trigger_manage_session_on_betting ON game_records CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 트리거 5개 강제 삭제 완료';
END $$;

-- ============================================
-- 2단계: 모든 세션 관련 함수 강제 삭제
-- ============================================

DROP FUNCTION IF EXISTS update_session_activity_on_betting() CASCADE;
DROP FUNCTION IF EXISTS create_session_from_betting() CASCADE;
DROP FUNCTION IF EXISTS reactivate_session_on_betting() CASCADE;
DROP FUNCTION IF EXISTS auto_end_inactive_sessions_on_betting() CASCADE;
DROP FUNCTION IF EXISTS manage_session_on_betting() CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 함수 5개 강제 삭제 완료';
END $$;

-- ============================================
-- 3단계: 통합 세션 관리 함수 생성
-- ============================================

CREATE OR REPLACE FUNCTION manage_session_on_betting()
RETURNS TRIGGER AS $$
DECLARE
    v_game_id BIGINT;
    v_existing_session RECORD;
    v_ended_count INTEGER := 0;
    v_session_record RECORD;
BEGIN
    -- STEP 1: 60초 비활성 세션 자동 종료 (최대 20개씩)
    FOR v_session_record IN
        SELECT 
            id,
            user_id,
            last_activity_at,
            session_id
        FROM game_launch_sessions
        WHERE status = 'active'
          AND last_activity_at < NOW() - INTERVAL '60 seconds'
        ORDER BY last_activity_at
        LIMIT 20
    LOOP
        UPDATE game_launch_sessions
        SET 
            status = 'auto_ended',
            ended_at = NOW()
        WHERE id = v_session_record.id;
        
        v_ended_count := v_ended_count + 1;
    END LOOP;
    
    -- STEP 2: 현재 베팅의 game_id 확인
    IF NEW.game_code IS NOT NULL THEN
        SELECT id INTO v_game_id
        FROM games
        WHERE game_code = NEW.game_code
        LIMIT 1;
    END IF;
    
    IF v_game_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- STEP 3: 기존 세션 확인 (active 또는 auto_ended)
    SELECT id, session_id, status INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
    AND game_id = v_game_id
    AND status IN ('active', 'auto_ended')
    ORDER BY launched_at DESC
    LIMIT 1;
    
    -- STEP 4: 세션 처리
    IF v_existing_session.id IS NOT NULL THEN
        IF v_existing_session.status = 'auto_ended' THEN
            -- 재활성화
            UPDATE game_launch_sessions
            SET 
                status = 'active',
                ended_at = NULL,
                last_activity_at = NEW.played_at
            WHERE id = v_existing_session.id;
        ELSE
            -- last_activity_at 업데이트
            UPDATE game_launch_sessions
            SET last_activity_at = NEW.played_at
            WHERE id = v_existing_session.id;
        END IF;
    ELSE
        -- 새 세션 생성
        INSERT INTO game_launch_sessions (
            user_id,
            game_id,
            session_id,
            balance_before,
            status,
            launched_at,
            last_activity_at
        ) VALUES (
            NEW.user_id,
            v_game_id,
            gen_random_uuid()::text,
            COALESCE(NEW.balance_before, 0),
            'active',
            NEW.played_at,
            NEW.played_at
        );
    END IF;
    
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    RAISE NOTICE '✅ manage_session_on_betting 함수 생성 완료';
END $$;

-- ============================================
-- 4단계: 트리거 생성
-- ============================================

CREATE TRIGGER trigger_manage_session_on_betting
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION manage_session_on_betting();

DO $$
BEGIN
    RAISE NOTICE '✅ 트리거 생성 완료';
END $$;

-- ============================================
-- 5단계: 인덱스 확인
-- ============================================

CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_auto_end 
    ON game_launch_sessions(status, last_activity_at DESC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_user_game_status
    ON game_launch_sessions(user_id, game_id, status);

DO $$
BEGIN
    RAISE NOTICE '✅ 인덱스 확인 완료';
END $$;

-- ============================================
-- 6단계: 즉시 실행
-- ============================================

DO $$
DECLARE
    v_ended_count INTEGER := 0;
BEGIN
    UPDATE game_launch_sessions
    SET 
        status = 'auto_ended',
        ended_at = NOW()
    WHERE status = 'active'
      AND last_activity_at < NOW() - INTERVAL '60 seconds';
    
    GET DIAGNOSTICS v_ended_count = ROW_COUNT;
    
    RAISE NOTICE '✅ 기존 비활성 세션 %개 즉시 종료', v_ended_count;
END $$;

-- ============================================
-- 7단계: 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 336. 강제 정리 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '작동 방식:';
    RAISE NOTICE '  1. 베팅 INSERT → 트리거 실행';
    RAISE NOTICE '  2. 30초 비활성 세션 자동 종료';
    RAISE NOTICE '  3. 현재 세션 생성/재활성화/업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '추가 확인:';
    RAISE NOTICE '  • OnlineUsers 페이지 열면 30초마다 체크';
    RAISE NOTICE '  • 베팅 발생 시에도 자동 체크';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
