-- =====================================================
-- 베팅 기록 추가 시 세션 자동 재활성화
-- =====================================================
-- 목적: game_records INSERT 시 해당 사용자의 ended 세션을 자동으로 active로 변경
-- 시나리오: 4분간 베팅 없어서 ended 처리됐지만, 사용자가 게임을 계속 플레이 중인 경우
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '293. 베팅 기록 추가 시 세션 자동 재활성화';
    RAISE NOTICE '============================================';
END $$;

-- =====================================================
-- 1단계: 기존 트리거 제거
-- =====================================================

DROP TRIGGER IF EXISTS trigger_reactivate_session_on_betting ON game_records;
DROP FUNCTION IF EXISTS reactivate_session_on_betting() CASCADE;

-- =====================================================
-- 2단계: 세션 재활성화 함수 생성
-- =====================================================

CREATE OR REPLACE FUNCTION reactivate_session_on_betting()
RETURNS TRIGGER AS $$
DECLARE
    v_session_count INTEGER;
    v_session_id BIGINT;
BEGIN
    -- 베팅이 추가된 사용자의 최근 ended 세션 찾기 (30분 이내)
    SELECT id INTO v_session_id
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
      AND status = 'ended'
      AND ended_at > NOW() - INTERVAL '30 minutes'
      AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1;
    
    -- ended 세션이 있으면 재활성화
    IF v_session_id IS NOT NULL THEN
        UPDATE game_launch_sessions
        SET 
            status = 'active',
            ended_at = NULL,
            last_activity_at = NOW()
        WHERE id = v_session_id;
        
        RAISE NOTICE '🔄 베팅 감지로 세션 재활성화: session_id=%, user_id=%', 
            v_session_id, NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3단계: game_records 테이블에 트리거 연결
-- =====================================================

CREATE TRIGGER trigger_reactivate_session_on_betting
    AFTER INSERT ON game_records
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
'베팅 기록이 추가되면 해당 사용자의 최근 ended 세션(30분 이내)을 자동으로 active로 재활성화';

COMMENT ON TRIGGER trigger_reactivate_session_on_betting ON game_records IS 
'베팅 추가 시 세션 자동 재활성화 트리거';

-- =====================================================
-- 완료 메시지
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ 베팅 기록 추가 시 세션 자동 재활성화 완료';
    RAISE NOTICE '';
    RAISE NOTICE '동작 방식:';
    RAISE NOTICE '1. game_records INSERT 감지';
    RAISE NOTICE '2. 해당 사용자의 최근 ended 세션 검색 (30분 이내)';
    RAISE NOTICE '3. ended → active 자동 변경';
    RAISE NOTICE '4. ended_at = NULL, last_activity_at = NOW()';
    RAISE NOTICE '';
    RAISE NOTICE '효과:';
    RAISE NOTICE '- 4분간 베팅 없어도 다시 베팅하면 세션 자동 복구';
    RAISE NOTICE '- UserLayout.tsx 모니터링도 자동으로 재시작';
    RAISE NOTICE '- 세션 상태 일관성 보장';
    RAISE NOTICE '============================================';
END $$;
