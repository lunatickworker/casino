-- ============================================================================
-- 188. 베팅 기반 세션 활성화 시스템
-- ============================================================================
-- 작성일: 2025-10-11
-- 목적: 
--   1. 베팅 데이터를 기반으로 게임 세션 활성화 상태 자동 관리
--   2. Heartbeat 사용하지 않고 이벤트 기반 업데이트
--   3. 메모리 최적화를 위한 자동 정리 시스템
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '188. 베팅 기반 세션 활성화 시스템 구현';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: game_launch_sessions 테이블에 last_activity_at 컬럼 추가
-- ============================================

DO $$
BEGIN
    -- last_activity_at 컬럼 추가 (없을 경우만)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_launch_sessions'
        AND column_name = 'last_activity_at'
    ) THEN
        ALTER TABLE game_launch_sessions 
        ADD COLUMN last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        
        RAISE NOTICE '✅ last_activity_at 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️ last_activity_at 컬럼 이미 존재';
    END IF;
    
    -- 기존 데이터 초기화 (launched_at 값으로)
    UPDATE game_launch_sessions
    SET last_activity_at = launched_at
    WHERE last_activity_at IS NULL;
    
    RAISE NOTICE '✅ 기존 세션 last_activity_at 초기화 완료';
END $$;

-- 인덱스 생성 (쿼리 성능 최적화)
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_last_activity 
ON game_launch_sessions(last_activity_at) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_status_activity 
ON game_launch_sessions(status, last_activity_at);

DO $
BEGIN
    RAISE NOTICE '✅ last_activity_at 인덱스 생성 완료';
END $;

-- ============================================
-- 2단계: 베팅 레코드 저장 시 세션 last_activity_at 자동 업데이트
-- ============================================

-- 2.1 트리거 함수: 베팅 레코드 저장 시 세션 활성화
CREATE OR REPLACE FUNCTION update_session_activity_on_betting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated_count INTEGER;
    v_reactivated_count INTEGER;
BEGIN
    -- 해당 사용자의 활성 게임 세션의 last_activity_at 업데이트
    UPDATE game_launch_sessions
    SET last_activity_at = NOW()
    WHERE user_id = NEW.user_id
    AND status = 'active'
    AND ended_at IS NULL;
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    -- 같은 게임의 종료된 세션을 재활성화 (5분 이내 종료된 경우만)
    -- 자동종료 후 베팅 데이터가 업데이트되면 다시 세션 active로 변경
    UPDATE game_launch_sessions
    SET 
        status = 'active',
        ended_at = NULL,
        last_activity_at = NOW()
    WHERE user_id = NEW.user_id
    AND game_id = NEW.game_id
    AND status = 'ended'
    AND ended_at IS NOT NULL
    AND ended_at >= NOW() - INTERVAL '5 minutes';  -- 5분 이내 종료된 세션만 재활성화
    
    GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;
    
    IF v_updated_count > 0 THEN
        RAISE NOTICE '✅ 베팅 발생: 세션 % 건 활성화 업데이트 (user: %)', v_updated_count, NEW.user_id;
    END IF;
    
    IF v_reactivated_count > 0 THEN
        RAISE NOTICE '🔄 베팅 발생: 세션 % 건 재활성화 (user: %, game: %)', v_reactivated_count, NEW.user_id, NEW.game_id;
    END IF;
    
    RETURN NEW;
END;
$$;

-- 2.2 트리거 생성 (베팅 레코드 INSERT 시 세션 업데이트)
DROP TRIGGER IF EXISTS trigger_update_session_on_betting ON game_records;
CREATE TRIGGER trigger_update_session_on_betting
    AFTER INSERT ON game_records
    FOR EACH ROW
    WHEN (NEW.user_id IS NOT NULL AND NEW.game_id IS NOT NULL)
    EXECUTE FUNCTION update_session_activity_on_betting();

DO $
BEGIN
    RAISE NOTICE '✅ 베팅 레코드 → 세션 활성화 트리거 생성 완료';
END $;

-- ============================================
-- 3단계: 5분간 베팅이 없으면 자동 종료
-- ============================================

CREATE OR REPLACE FUNCTION expire_inactive_game_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    -- 5분간 베팅이 없는(last_activity_at 업데이트 없음) 세션 자동 종료
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE status = 'active'
    AND ended_at IS NULL
    AND last_activity_at < NOW() - INTERVAL '5 minutes';
    
    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    
    IF v_expired_count > 0 THEN
        RAISE NOTICE '⏰ 5분 비활성 세션 % 건 자동 종료', v_expired_count;
    END IF;
    
    RETURN v_expired_count;
END;
$$;

COMMENT ON FUNCTION expire_inactive_game_sessions IS '5분간 베팅이 없는 세션 자동 종료';

-- 권한 부여
GRANT EXECUTE ON FUNCTION expire_inactive_game_sessions() TO authenticated, anon;

DO $
BEGIN
    RAISE NOTICE '✅ 5분 비활성 세션 자동 종료 함수 생성 완료';
END $;

-- ============================================
-- 4단계: 30분간 베팅이 없으면 테이블에서 세션 정리 (물리적 삭제)
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_game_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    -- 30분 이상 비활성 상태인 ended 세션 물리적 삭제
    DELETE FROM game_launch_sessions
    WHERE status = 'ended'
    AND ended_at IS NOT NULL
    AND ended_at < NOW() - INTERVAL '30 minutes';
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
    IF v_deleted_count > 0 THEN
        RAISE NOTICE '🗑️ 30분 경과 세션 % 건 물리적 삭제', v_deleted_count;
    END IF;
    
    RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_old_game_sessions IS '30분 이상 비활성 세션 물리적 삭제';

-- 권한 부여
GRANT EXECUTE ON FUNCTION cleanup_old_game_sessions() TO authenticated, anon;

DO $
BEGIN
    RAISE NOTICE '✅ 30분 경과 세션 물리적 삭제 함수 생성 완료';
END $;

-- ============================================
-- 5단계: save_game_launch_session 함수 수정 (last_activity_at 초기화)
-- ============================================

DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;

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
    v_existing_count INTEGER;
BEGIN
    RAISE NOTICE '🎮 게임 세션 생성 시작: user_id=%, game_id=%', p_user_id, p_game_id;
    
    -- 동일 사용자의 기존 활성 세션 종료 (다른 게임만)
    UPDATE game_launch_sessions
    SET 
        status = 'ended',
        ended_at = NOW()
    WHERE user_id = p_user_id
    AND status = 'active'
    AND ended_at IS NULL
    AND game_id != p_game_id;  -- 다른 게임만 종료
    
    GET DIAGNOSTICS v_existing_count = ROW_COUNT;
    
    IF v_existing_count > 0 THEN
        RAISE NOTICE '✅ 기존 활성 세션 % 건 종료 (다른 게임)', v_existing_count;
    END IF;
    
    -- 새 게임 세션 생성 (항상 active, last_activity_at 초기화)
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        ended_at,
        status,
        last_activity_at  -- 초기화
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        COALESCE(p_balance_before, 0),
        NOW(),
        NULL,  -- ended_at은 NULL
        'active',  -- 반드시 active로 시작
        NOW()  -- last_activity_at 초기화
    ) RETURNING id INTO v_session_id;
    
    -- 저장 직후 상태 확인
    PERFORM 1 FROM game_launch_sessions 
    WHERE id = v_session_id 
    AND status = 'active';
    
    IF FOUND THEN
        RAISE NOTICE '✅ 게임 세션 active 상태 저장 성공: session_id=%, user=%, game=%', 
            v_session_id, p_user_id, p_game_id;
    ELSE
        RAISE WARNING '❌ 게임 세션 active 저장 실패: session_id=%', v_session_id;
    END IF;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %, SQLSTATE: %', SQLERRM, SQLSTATE;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION save_game_launch_session IS '게임 세션 생성 (항상 active 상태, last_activity_at 초기화)';

-- 권한 재설정
GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $
BEGIN
    RAISE NOTICE '✅ save_game_launch_session 함수 last_activity_at 초기화 추가 완료';
END $;

-- ============================================
-- 6단계: 통합 세션 관리 함수 (5분 종료 + 30분 삭제)
-- ============================================

CREATE OR REPLACE FUNCTION manage_game_sessions()
RETURNS TABLE (
    expired_count INTEGER,
    deleted_count INTEGER,
    total_active INTEGER,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_expired INTEGER;
    v_deleted INTEGER;
    v_active INTEGER;
BEGIN
    -- 1. 5분 비활성 세션 자동 종료
    SELECT expire_inactive_game_sessions() INTO v_expired;
    
    -- 2. 30분 경과 세션 물리적 삭제
    SELECT cleanup_old_game_sessions() INTO v_deleted;
    
    -- 3. 현재 활성 세션 수 조회
    SELECT COUNT(*) INTO v_active
    FROM game_launch_sessions
    WHERE status = 'active'
    AND ended_at IS NULL;
    
    RETURN QUERY SELECT 
        v_expired,
        v_deleted,
        v_active,
        format('종료: %s건, 삭제: %s건, 활성: %s건', v_expired, v_deleted, v_active);
END;
$$;

COMMENT ON FUNCTION manage_game_sessions IS '통합 세션 관리: 5분 종료 + 30분 삭제 + 현황 조회';

-- 권한 부여
GRANT EXECUTE ON FUNCTION manage_game_sessions() TO authenticated, anon;

DO $
BEGIN
    RAISE NOTICE '✅ 통합 세션 관리 함수 생성 완료';
END $;

-- ============================================
-- 7단계: 기존 expire_old_game_sessions 함수 업데이트 (호환성 유지)
-- ============================================

-- 기존 함수와 호환성 유지하면서 새 로직 적용
DROP FUNCTION IF EXISTS expire_old_game_sessions() CASCADE;

CREATE OR REPLACE FUNCTION expire_old_game_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    -- 5분 비활성 세션 자동 종료
    SELECT expire_inactive_game_sessions() INTO v_expired_count;
    
    -- 24시간 이상 된 비정상 세션도 정리 (안전장치)
    UPDATE game_launch_sessions
    SET 
        status = 'expired',
        ended_at = NOW()
    WHERE status = 'active'
    AND ended_at IS NULL
    AND launched_at < NOW() - INTERVAL '24 hours';
    
    RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION expire_old_game_sessions IS '이전 버전 호환 함수 (5분 비활성 + 24시간 비정상 세션 종료)';

-- 권한 설정
GRANT EXECUTE ON FUNCTION expire_old_game_sessions() TO anon, authenticated;

DO $
BEGIN
    RAISE NOTICE '✅ expire_old_game_sessions 함수 업데이트 완료 (호환성 유지)';
END $;

-- ============================================
-- 8단계: 현재 세션 상태 검증 및 통계
-- ============================================

DO $$
DECLARE
    v_total_sessions INTEGER;
    v_active_sessions INTEGER;
    v_ended_sessions INTEGER;
    v_sessions_with_activity INTEGER;
    v_avg_session_duration INTERVAL;
BEGIN
    SELECT COUNT(*) INTO v_total_sessions FROM game_launch_sessions;
    SELECT COUNT(*) INTO v_active_sessions FROM game_launch_sessions WHERE status = 'active';
    SELECT COUNT(*) INTO v_ended_sessions FROM game_launch_sessions WHERE status = 'ended';
    SELECT COUNT(*) INTO v_sessions_with_activity FROM game_launch_sessions WHERE last_activity_at IS NOT NULL;
    
    SELECT AVG(last_activity_at - launched_at) INTO v_avg_session_duration
    FROM game_launch_sessions
    WHERE last_activity_at IS NOT NULL
    AND status = 'active';
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 게임 세션 상태 검증';
    RAISE NOTICE '============================================';
    RAISE NOTICE '전체 세션: % 건', v_total_sessions;
    RAISE NOTICE '  - 활성(active): % 건', v_active_sessions;
    RAISE NOTICE '  - 종료(ended): % 건', v_ended_sessions;
    RAISE NOTICE '  - last_activity_at 설정됨: % 건', v_sessions_with_activity;
    RAISE NOTICE '평균 세션 활동 시간: %', COALESCE(v_avg_session_duration::TEXT, 'N/A');
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 9단계: 샘플 테스트 및 검증
-- ============================================

DO $$
DECLARE
    v_test_result RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🧪 테스트 실행: 통합 세션 관리';
    RAISE NOTICE '--------------------------------------------';
    
    -- 통합 관리 함수 테스트
    FOR v_test_result IN 
        SELECT * FROM manage_game_sessions()
    LOOP
        RAISE NOTICE '결과: %', v_test_result.message;
        RAISE NOTICE '  - 종료된 세션: % 건', v_test_result.expired_count;
        RAISE NOTICE '  - 삭제된 세션: % 건', v_test_result.deleted_count;
        RAISE NOTICE '  - 현재 활성 세션: % 건', v_test_result.total_active;
    END LOOP;
    
    RAISE NOTICE '--------------------------------------------';
END $$;

-- ============================================
-- 10단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 188. 베팅 기반 세션 활성화 시스템 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '구현 내용:';
    RAISE NOTICE '1. ✅ last_activity_at 컬럼 추가 및 인덱스 생성';
    RAISE NOTICE '2. ✅ 베팅 레코드 저장 시 세션 활성화 자동 업데이트';
    RAISE NOTICE '3. ✅ 5분 비활성 세션 자동 종료 (expire_inactive_game_sessions)';
    RAISE NOTICE '4. ✅ 자동종료 후 베팅 발생 시 재활성화';
    RAISE NOTICE '5. ✅ 30분 경과 세션 물리적 삭제 (cleanup_old_game_sessions)';
    RAISE NOTICE '6. ✅ 통합 세션 관리 함수 (manage_game_sessions)';
    RAISE NOTICE '7. ✅ save_game_launch_session 함수 last_activity_at 초기화';
    RAISE NOTICE '8. ✅ 기존 함수 호환성 유지';
    RAISE NOTICE '';
    RAISE NOTICE '🔄 자동화:';
    RAISE NOTICE '  - 베팅 발생 시 → 세션 활성화 자동 업데이트';
    RAISE NOTICE '  - 5분 비활성 → 자동 종료 (status=ended)';
    RAISE NOTICE '  - 종료 후 베팅 발생 → 자동 재활성화 (5분 이내)';
    RAISE NOTICE '  - 30분 경과 → 물리적 삭제';
    RAISE NOTICE '';
    RAISE NOTICE '📌 권장 사항:';
    RAISE NOTICE '  - manage_game_sessions() 함수를 5분 주기로 실행';
    RAISE NOTICE '  - Edge Function 또는 pg_cron으로 스케줄링';
    RAISE NOTICE '  - 베팅 데이터는 기존대로 30초 주기 자동 동기화';
    RAISE NOTICE '============================================';
END $$;
