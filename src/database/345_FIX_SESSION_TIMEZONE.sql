-- ============================================================================
-- 345. 세션 생성 시 타임존 문제 수정
-- ============================================================================
-- 작성일: 2025-10-31
-- 목적: 
--   1. game_records의 played_at이 한국 시간으로 저장되지만
--   2. game_launch_sessions의 launched_at과 last_activity_at도 같은 시간대로 동기화
--   3. timezone 불일치로 세션이 생성되지 않는 문제 해결
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '345. 세션 타임존 문제 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 create_session_from_betting 함수 재생성
-- ============================================

CREATE OR REPLACE FUNCTION create_session_from_betting()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id BIGINT;
    v_existing_session RECORD;
    v_random_session_id TEXT;
    v_game_id BIGINT;
BEGIN
    -- 1. game_records의 partner_id 직접 사용
    IF NEW.partner_id IS NULL THEN
        RAISE WARNING '❌ game_records의 partner_id 없음: user_id=%', NEW.user_id;
        RETURN NEW;
    END IF;
    
    -- 2. game_id 추출 (NEW.game_id 사용)
    v_game_id := NEW.game_id;
    
    IF v_game_id IS NULL THEN
        RAISE WARNING '❌ game_id 없음';
        RETURN NEW;
    END IF;
    
    -- 3. 기존 활성 세션 확인 (user_id + game_id로 검색)
    SELECT id, session_id INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
    AND game_id = v_game_id
    AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    -- 4. 기존 세션이 있으면 last_activity_at만 업데이트
    -- ✅ played_at을 그대로 사용 (이미 한국 시간으로 저장됨)
    IF v_existing_session.id IS NOT NULL THEN
        UPDATE game_launch_sessions
        SET last_activity_at = NEW.played_at
        WHERE id = v_existing_session.id;
        
        RAISE NOTICE '🔄 세션 활동 갱신: session_id=%, user=%, game=%, played_at=%', 
            v_existing_session.session_id, NEW.user_id, v_game_id, NEW.played_at;
        
        RETURN NEW;
    END IF;
    
    -- 5. 기존 세션이 없으면 새로 생성
    -- ✅ played_at을 그대로 사용 (이미 한국 시간으로 저장됨)
    v_random_session_id := 'sess_' || substr(md5(random()::text), 1, 16);
    
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        balance_before,
        launch_url,
        launched_at,
        ended_at,
        status,
        last_activity_at,
        partner_id,
        session_id
    ) VALUES (
        NEW.user_id,
        v_game_id,
        NEW.balance_before,
        NULL, -- launch_url은 베팅 기록에서 생성하므로 NULL
        NEW.played_at, -- ✅ played_at 그대로 사용 (한국 시간)
        NULL,
        'active',
        NEW.played_at, -- ✅ played_at 그대로 사용 (한국 시간)
        NEW.partner_id,
        v_random_session_id
    ) RETURNING id INTO v_session_id;
    
    RAISE NOTICE '✅ 베팅 기반 세션 생성: db_id=%, session_id=%, user=%, game=%, played_at=%, tz=%', 
        v_session_id, v_random_session_id, NEW.user_id, v_game_id, NEW.played_at,
        EXTRACT(TIMEZONE FROM NEW.played_at);
    
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ create_session_from_betting 오류: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    RAISE NOTICE '✅ create_session_from_betting 함수 재생성 완료';
END $$;

-- ============================================
-- 2단계: 트리거 재생성 (이미 존재하면 자동 교체됨)
-- ============================================

DROP TRIGGER IF EXISTS trigger_create_session_from_betting ON game_records;

CREATE TRIGGER trigger_create_session_from_betting
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION create_session_from_betting();

DO $$
BEGIN
    RAISE NOTICE '✅ game_records INSERT 트리거 재생성 완료';
END $$;

-- ============================================
-- 3단계: 기존 세션의 timezone 확인 및 정리
-- ============================================

DO $$
DECLARE
    v_sample_session RECORD;
    v_sample_record RECORD;
BEGIN
    -- game_launch_sessions 샘플 확인
    SELECT launched_at, last_activity_at, status
    INTO v_sample_session
    FROM game_launch_sessions
    WHERE status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    IF FOUND THEN
        RAISE NOTICE '📊 현재 세션 샘플:';
        RAISE NOTICE '  - launched_at: %', v_sample_session.launched_at;
        RAISE NOTICE '  - last_activity_at: %', v_sample_session.last_activity_at;
        RAISE NOTICE '  - status: %', v_sample_session.status;
    ELSE
        RAISE NOTICE 'ℹ️ 현재 active 세션 없음';
    END IF;
    
    -- game_records 샘플 확인
    SELECT played_at, created_at
    INTO v_sample_record
    FROM game_records
    ORDER BY played_at DESC
    LIMIT 1;
    
    IF FOUND THEN
        RAISE NOTICE '📊 최근 베팅 기록 샘플:';
        RAISE NOTICE '  - played_at: %', v_sample_record.played_at;
        RAISE NOTICE '  - created_at: %', v_sample_record.created_at;
    ELSE
        RAISE NOTICE 'ℹ️ 베팅 기록 없음';
    END IF;
END $$;

-- ============================================
-- 4단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 345. 세션 타임존 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. ✅ create_session_from_betting 함수 재생성';
    RAISE NOTICE '2. ✅ played_at을 그대로 사용 (한국 시간 유지)';
    RAISE NOTICE '3. ✅ 트리거 재생성 완료';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 결과:';
    RAISE NOTICE '  - played_at과 launched_at/last_activity_at이 같은 시간대로 저장됨';
    RAISE NOTICE '  - 베팅 기록이 올라오면 세션이 정상 생성됨';
    RAISE NOTICE '';
    RAISE NOTICE '📌 테스트:';
    RAISE NOTICE '  - 게임 실행 후 베팅하면 세션이 자동 생성됨';
    RAISE NOTICE '  - game_launch_sessions 테이블에서 launched_at과 last_activity_at 확인';
    RAISE NOTICE '  - game_records의 played_at과 시간이 일치하는지 확인';
    RAISE NOTICE '============================================';
END $$;
