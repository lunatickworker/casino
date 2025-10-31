-- ============================================================================
-- 324. 베팅 기반 세션 생성 시스템
-- ============================================================================
-- 작성일: 2025-10-29
-- 목적: 
--   1. 게임 URL 응답 시 세션 생성 중지
--   2. 베팅 기록(game_records) INSERT 시 세션 자동 생성
--   3. game_records.created_at 기준으로 베팅 기록 추적
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '324. 베팅 기반 세션 생성 시스템';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 save_game_launch_session 함수 모두 삭제
-- ============================================

-- 기존에 여러 오버로드 버전이 있을 수 있으므로 모두 삭제
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, DECIMAL, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 save_game_launch_session 함수 모두 삭제 완료';
END $$;

-- ============================================
-- 1-2단계: 빈 껍데기 함수 생성 (기존 호출 코드 호환성 유지)
-- ============================================

-- opcode 파라미터가 있는 버전 (대부분의 기존 SQL에서 사용)
CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
)
RETURNS BIGINT AS $$
BEGIN
    -- 아무것도 하지 않음 (베팅 기록 기반으로 세션 생성)
    RAISE NOTICE '⏭️ save_game_launch_session 호출 무시 (베팅 기반 세션 사용)';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ save_game_launch_session 함수 비활성화 완료';
END $$;

-- ============================================
-- 2단계: 베팅 기록 기반 세션 자동 생성 함수
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
    -- played_at을 hh:mm:ss까지 비교하여 정확한 세션 추적
    SELECT id, session_id INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
    AND game_id = v_game_id
    AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    -- 4. 기존 세션이 있으면 last_activity_at만 업데이트 (played_at 사용)
    IF v_existing_session.id IS NOT NULL THEN
        UPDATE game_launch_sessions
        SET last_activity_at = NEW.played_at
        WHERE id = v_existing_session.id;
        
        RAISE NOTICE '🔄 세션 활동 갱신: session_id=%, user=%, game=%, played_at=%', 
            v_existing_session.session_id, NEW.user_id, v_game_id, NEW.played_at;
        
        RETURN NEW;
    END IF;
    
    -- 5. 기존 세션이 없으면 새로 생성 (played_at 기준)
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
        NEW.played_at, -- 베팅 기록의 played_at 사용 (hh:mm:ss 포함)
        NULL,
        'active',
        NEW.played_at, -- played_at으로 활동 시간 추적
        NEW.partner_id, -- game_records의 partner_id 직접 사용
        v_random_session_id
    ) RETURNING id INTO v_session_id;
    
    RAISE NOTICE '✅ 베팅 기반 세션 생성: db_id=%, session_id=%, user=%, game=%, played_at=%', 
        v_session_id, v_random_session_id, NEW.user_id, v_game_id, NEW.played_at;
    
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ create_session_from_betting 오류: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    RAISE NOTICE '✅ create_session_from_betting 함수 생성 완료';
END $$;

-- ============================================
-- 3단계: game_records INSERT 트리거 생성
-- ============================================

DROP TRIGGER IF EXISTS trigger_create_session_from_betting ON game_records;

CREATE TRIGGER trigger_create_session_from_betting
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION create_session_from_betting();

DO $$
BEGIN
    RAISE NOTICE '✅ game_records INSERT 트리거 생성 완료';
END $$;

-- ============================================
-- 4단계: game_records.played_at 인덱스 확인/생성
-- ============================================

-- played_at 인덱스 (베팅 기록 추적용, hh:mm:ss까지 정확한 시간 추적)
CREATE INDEX IF NOT EXISTS idx_game_records_played_at 
    ON game_records(played_at DESC);

-- user_id + played_at 복합 인덱스 (사용자별 베팅 추적용)
CREATE INDEX IF NOT EXISTS idx_game_records_user_played_at 
    ON game_records(user_id, played_at DESC);

-- game_id + played_at 복합 인덱스 (게임별 베팅 추적용)
CREATE INDEX IF NOT EXISTS idx_game_records_game_played_at 
    ON game_records(game_id, played_at DESC);

DO $$
BEGIN
    RAISE NOTICE '✅ game_records.played_at 인덱스 생성 완료';
END $$;

-- ============================================
-- 5단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 324. 베팅 기반 세션 생성 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. ✅ save_game_launch_session 함수 비활성화';
    RAISE NOTICE '2. ✅ create_session_from_betting 함수 생성';
    RAISE NOTICE '3. ✅ game_records INSERT 트리거 생성';
    RAISE NOTICE '4. ✅ game_records.played_at 인덱스 생성';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 결과:';
    RAISE NOTICE '  - 게임 URL 응답 시 세션 생성 안함';
    RAISE NOTICE '  - 베팅 기록 올라오면 세션 자동 생성';
    RAISE NOTICE '  - game_records.played_at 기준 추적 (hh:mm:ss)';
    RAISE NOTICE '';
    RAISE NOTICE '📌 주의:';
    RAISE NOTICE '  - 첫 베팅이 발생해야 세션 생성됨';
    RAISE NOTICE '  - 게임 실행만 하고 베팅 안하면 세션 없음';
    RAISE NOTICE '  - played_at timestamp는 hh:mm:ss까지 정확히 추적';
    RAISE NOTICE '============================================';
END $$;
