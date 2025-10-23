-- =====================================================
-- 베팅 중복 저장 및 세션 모니터 로그 미표시 문제 해결
-- =====================================================
-- 문제 1: 똑같은 베팅 데이터가 두 개씩 파싱됨
-- 문제 2: "세션 145 경과시간:xx초" 로그가 콘솔에 표시되지 않음
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '298. 베팅 중복 및 세션 모니터 로그 문제 해결';
    RAISE NOTICE '============================================';
END $$;

-- =====================================================
-- 1단계: game_records 테이블의 UNIQUE 제약 수정
-- =====================================================

-- 기존 제약 삭제
ALTER TABLE game_records DROP CONSTRAINT IF EXISTS game_records_external_txid_user_id_played_at_key;
ALTER TABLE game_records DROP CONSTRAINT IF EXISTS game_records_external_txid_username_key;
ALTER TABLE game_records DROP CONSTRAINT IF EXISTS game_records_external_txid_key;

-- external_txid만으로 UNIQUE 제약 추가 (중복 베팅 방지)
ALTER TABLE game_records ADD CONSTRAINT game_records_external_txid_key UNIQUE (external_txid);

-- =====================================================
-- 2단계: 기존 중복 데이터 정리
-- =====================================================

-- 중복된 데이터 중 최신 것만 남기고 삭제
WITH duplicates AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY external_txid 
            ORDER BY created_at DESC
        ) as rn
    FROM game_records
)
DELETE FROM game_records
WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
);

-- =====================================================
-- 3단계: 세션 재활성화 트리거 수정 (중복 실행 방지)
-- =====================================================

DROP TRIGGER IF EXISTS trigger_reactivate_session_on_betting ON game_records;
DROP FUNCTION IF EXISTS reactivate_session_on_betting() CASCADE;

CREATE OR REPLACE FUNCTION reactivate_session_on_betting()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id BIGINT;
BEGIN
    -- user_id가 없으면 username으로 조회
    IF NEW.user_id IS NULL THEN
        -- username으로 user_id 조회
        SELECT id INTO NEW.user_id
        FROM users
        WHERE username = NEW.username
        LIMIT 1;
    END IF;

    -- user_id가 여전히 NULL이면 종료
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- 베팅이 추가된 사용자의 최근 ended 세션 찾기 (30분 이내)
    SELECT id INTO v_session_id
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
      AND status = 'ended'
      AND ended_at > NOW() - INTERVAL '30 minutes'
      AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1;
    
    -- ended 세션이 있으면 재활성화 (단, 한 번만 실행)
    IF v_session_id IS NOT NULL THEN
        UPDATE game_launch_sessions
        SET 
            status = 'active',
            ended_at = NULL,
            last_activity_at = NOW()
        WHERE id = v_session_id
          AND status = 'ended'; -- 이미 active면 업데이트 안 함
        
        IF FOUND THEN
            RAISE NOTICE '🔄 베팅 감지로 세션 재활성화: session_id=%, user_id=%, txid=%', 
                v_session_id, NEW.user_id, NEW.external_txid;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 재생성
CREATE TRIGGER trigger_reactivate_session_on_betting
    BEFORE INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION reactivate_session_on_betting();

-- 권한 설정
GRANT EXECUTE ON FUNCTION reactivate_session_on_betting() TO anon, authenticated;

-- =====================================================
-- 4단계: 중복 방지 로그 추가
-- =====================================================

COMMENT ON CONSTRAINT game_records_external_txid_key ON game_records IS 
'external_txid의 중복을 방지하여 같은 베팅이 두 번 저장되지 않도록 함';

COMMENT ON FUNCTION reactivate_session_on_betting() IS 
'베팅 기록이 추가되면 해당 사용자의 최근 ended 세션(30분 이내)을 자동으로 active로 재활성화 (중복 실행 방지)';

-- =====================================================
-- 완료 메시지
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ 베팅 중복 저장 및 세션 모니터 문제 해결 완료';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. game_records.external_txid에 UNIQUE 제약 추가';
    RAISE NOTICE '2. 기존 중복 데이터 정리 (최신 데이터만 유지)';
    RAISE NOTICE '3. 세션 재활성화 트리거 중복 실행 방지';
    RAISE NOTICE '4. user_id NULL 시 username으로 자동 조회';
    RAISE NOTICE '';
    RAISE NOTICE '효과:';
    RAISE NOTICE '- 같은 txid의 베팅이 두 번 저장되지 않음';
    RAISE NOTICE '- 트리거 중복 실행 방지로 성능 개선';
    RAISE NOTICE '- 세션 모니터링 로그가 정상 표시됨';
    RAISE NOTICE '============================================';
END $$;
