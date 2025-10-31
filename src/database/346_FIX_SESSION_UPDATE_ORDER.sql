-- ============================================================================
-- 346. 세션 업데이트 순서 수정 (현재 베팅 세션 먼저 업데이트)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '346. 세션 업데이트 순서 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 트리거 및 함수 삭제
-- ============================================

DROP TRIGGER IF EXISTS trigger_manage_session_on_betting ON game_records CASCADE;
DROP FUNCTION IF EXISTS manage_session_on_betting() CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 트리거 및 함수 삭제 완료';
END $$;

-- ============================================
-- 2단계: 수정된 세션 관리 함수 생성
-- ============================================

CREATE OR REPLACE FUNCTION manage_session_on_betting()
RETURNS TRIGGER AS $$
DECLARE
    v_game_id BIGINT;
    v_existing_session RECORD;
    v_ended_count INTEGER := 0;
    v_session_record RECORD;
BEGIN
    -- STEP 1: 현재 베팅의 game_id 확인
    IF NEW.game_code IS NOT NULL THEN
        SELECT id INTO v_game_id
        FROM games
        WHERE game_code = NEW.game_code
        LIMIT 1;
    END IF;
    
    IF v_game_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- STEP 2: 현재 베팅의 세션 먼저 처리 (우선순위)
    SELECT id, session_id, status INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
    AND game_id = v_game_id
    AND status IN ('active', 'auto_ended')
    ORDER BY launched_at DESC
    LIMIT 1;
    
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
            -- last_activity_at 업데이트 (타이머 리셋)
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
        
        -- 새로 생성된 세션 ID 저장
        SELECT id INTO v_existing_session
        FROM game_launch_sessions
        WHERE user_id = NEW.user_id
        AND game_id = v_game_id
        AND status = 'active'
        ORDER BY launched_at DESC
        LIMIT 1;
    END IF;
    
    -- STEP 3: 60초 비활성 세션 자동 종료 (현재 세션 제외, 최대 20개)
    FOR v_session_record IN
        SELECT 
            id,
            user_id,
            last_activity_at,
            session_id
        FROM game_launch_sessions
        WHERE status = 'active'
          AND last_activity_at < NOW() - INTERVAL '60 seconds'
          AND id != COALESCE(v_existing_session.id, 0)  -- 현재 세션 제외
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
-- 3단계: 트리거 생성
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
-- 4단계: 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 346 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '수정 내용:';
    RAISE NOTICE '  1. 현재 베팅의 세션을 먼저 업데이트/생성';
    RAISE NOTICE '  2. last_activity_at을 NEW.played_at으로 업데이트하여 타이머 리셋';
    RAISE NOTICE '  3. 그 후 다른 비활성 세션 종료 (현재 세션 제외)';
    RAISE NOTICE '';
    RAISE NOTICE '결과:';
    RAISE NOTICE '  • 베팅이 발생하면 해당 세션의 타이머가 리셋됨';
    RAISE NOTICE '  • 60초 동안 베팅이 없는 세션만 auto_ended';
    RAISE NOTICE '  • 현재 베팅 세션은 절대 종료되지 않음';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
