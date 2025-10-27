-- =====================================================
-- 310. 베팅 발생 시 active 세션 타이머 업데이트 추가
-- =====================================================
-- 문제: 베팅이 계속 들어와도 active 세션의 타이머가 업데이트되지 않아 4분 후 세션 종료됨
-- 해결: ended 세션 재활성화 + active 세션 타이머 업데이트 모두 처리
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '310. active 세션 타이머 업데이트 추가';
    RAISE NOTICE '============================================';
END $$;

-- =====================================================
-- 1단계: 기존 트리거 및 함수 제거
-- =====================================================

DROP TRIGGER IF EXISTS trigger_reactivate_session_on_betting ON game_records;
DROP FUNCTION IF EXISTS reactivate_session_on_betting() CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 트리거 및 함수 제거 완료';
END $$;

-- =====================================================
-- 2단계: 개선된 세션 관리 트리거 함수
-- =====================================================

CREATE OR REPLACE FUNCTION reactivate_session_on_betting()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id BIGINT;
    v_game_id BIGINT;
    v_active_session_id BIGINT;
    v_ended_session_id BIGINT;
BEGIN
    -- user_id가 없으면 username으로 조회
    IF NEW.user_id IS NULL THEN
        SELECT id INTO NEW.user_id
        FROM users
        WHERE username = NEW.username
        LIMIT 1;
    END IF;

    -- user_id가 여전히 NULL이면 종료
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- game_id 추출 (provider_id * 1000)
    v_game_id := (NEW.provider_id::BIGINT * 1000);

    -- ================================================================
    -- 🔥 핵심 추가: active 세션의 타이머 업데이트
    -- ================================================================
    SELECT id INTO v_active_session_id
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
      AND game_id = v_game_id
      AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;

    IF v_active_session_id IS NOT NULL THEN
        -- active 세션의 타이머 갱신 (4분 연장)
        INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
        VALUES (v_active_session_id, NEW.user_id, v_game_id, NOW(), NOW() + INTERVAL '4 minutes')
        ON CONFLICT (session_id) DO UPDATE SET
            last_betting_at = NOW(),
            scheduled_end_at = NOW() + INTERVAL '4 minutes',
            is_cancelled = FALSE,
            updated_at = NOW();

        RAISE NOTICE '⏱️ active 세션 타이머 갱신: session_id=%, user_id=%, game_id=%, txid=%', 
            v_active_session_id, NEW.user_id, v_game_id, NEW.external_txid;
        
        RETURN NEW;
    END IF;

    -- ================================================================
    -- ended 세션 재활성화 (기존 로직)
    -- ================================================================
    SELECT id INTO v_ended_session_id
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
      AND game_id = v_game_id
      AND status = 'ended'
      AND ended_at > NOW() - INTERVAL '30 minutes'
      AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1;
    
    IF v_ended_session_id IS NOT NULL THEN
        -- ended → active 재활성화
        UPDATE game_launch_sessions
        SET 
            status = 'active',
            ended_at = NULL,
            last_activity_at = NOW(),
            launched_at = NOW()
        WHERE id = v_ended_session_id
          AND status = 'ended';
        
        IF FOUND THEN
            -- 타이머 생성 (4분 후 종료 예정)
            INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
            VALUES (v_ended_session_id, NEW.user_id, v_game_id, NOW(), NOW() + INTERVAL '4 minutes')
            ON CONFLICT (session_id) DO UPDATE SET
                last_betting_at = NOW(),
                scheduled_end_at = NOW() + INTERVAL '4 minutes',
                is_cancelled = FALSE,
                updated_at = NOW();

            RAISE NOTICE '🔄 ended 세션 재활성화: session_id=%, user_id=%, game_id=%, txid=%', 
                v_ended_session_id, NEW.user_id, v_game_id, NEW.external_txid;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3단계: 트리거 재생성
-- =====================================================

CREATE TRIGGER trigger_reactivate_session_on_betting
    BEFORE INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION reactivate_session_on_betting();

-- =====================================================
-- 4단계: 권한 설정
-- =====================================================

GRANT EXECUTE ON FUNCTION reactivate_session_on_betting() TO anon, authenticated;

-- =====================================================
-- 5단계: 주석 추가
-- =====================================================

COMMENT ON FUNCTION reactivate_session_on_betting() IS 
'베팅 기록 추가 시:
1. active 세션이 있으면 → session_timers 업데이트 (4분 연장)
2. ended 세션이 있으면 → 재활성화 + 타이머 생성
3. 베팅이 계속 들어오면 세션이 끊어지지 않도록 보장';

COMMENT ON TRIGGER trigger_reactivate_session_on_betting ON game_records IS 
'베팅 추가 시 active/ended 세션 모두 관리 (타이머 갱신 + 재활성화)';

-- =====================================================
-- 완료 메시지
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ active 세션 타이머 업데이트 추가 완료';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. ✅ active 세션 감지 시 session_timers 업데이트 (신규)';
    RAISE NOTICE '2. ✅ ended 세션 재활성화 (기존 유지)';
    RAISE NOTICE '3. ✅ game_id를 provider_id * 1000으로 계산 (개선)';
    RAISE NOTICE '';
    RAISE NOTICE '동작 방식:';
    RAISE NOTICE '📌 베팅 발생 시:';
    RAISE NOTICE '  1. active 세션이 있는가?';
    RAISE NOTICE '     → YES: session_timers.last_betting_at = NOW()';
    RAISE NOTICE '     → YES: session_timers.scheduled_end_at = NOW() + 4분';
    RAISE NOTICE '     → 세션 유지 ✅';
    RAISE NOTICE '  2. active 세션 없고 ended 세션이 있는가? (30분 이내)';
    RAISE NOTICE '     → YES: status = active, 타이머 재생성';
    RAISE NOTICE '     → 세션 재활성화 ✅';
    RAISE NOTICE '  3. 둘 다 없는가?';
    RAISE NOTICE '     → 아무것도 안 함 (정상)';
    RAISE NOTICE '';
    RAISE NOTICE '효과:';
    RAISE NOTICE '✅ 베팅이 계속 들어오면 세션이 끊어지지 않음';
    RAISE NOTICE '✅ 4분 무활동 시에만 세션 종료됨';
    RAISE NOTICE '✅ 베팅 중인 사용자의 세션 안정성 보장';
    RAISE NOTICE '============================================';
END $$;
