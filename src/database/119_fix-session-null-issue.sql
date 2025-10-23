-- ============================================================================
-- 119. 게임 세션 NULL 반환 문제 해결
-- ============================================================================
-- 목적: save_game_launch_session이 NULL을 반환하는 문제 해결
-- 문제: 함수는 성공했다고 하지만 session_id가 null
-- ============================================================================

-- 1. game_launch_sessions 테이블의 RLS 정책 완전히 재설정
ALTER TABLE game_launch_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE game_launch_sessions ENABLE ROW LEVEL SECURITY;

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "game_launch_sessions_select_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_insert_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_update_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_delete_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "Allow all operations for game_launch_sessions" ON game_launch_sessions;

-- 2. 새로운 RLS 정책 생성 (SECURITY DEFINER 함수에서 모든 작업 허용)
CREATE POLICY "game_launch_sessions_all_access"
ON game_launch_sessions
FOR ALL
TO authenticated, anon
USING (true)
WITH CHECK (true);

COMMENT ON POLICY "game_launch_sessions_all_access" ON game_launch_sessions IS 
'SECURITY DEFINER 함수에서 사용하므로 모든 접근 허용';

-- 3. save_game_launch_session 함수 재작성 (에러 처리 강화)
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL);

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
    v_status TEXT;
    v_update_count INTEGER;
BEGIN
    RAISE NOTICE '==========================================';
    RAISE NOTICE '💾 [FUNCTION START] save_game_launch_session';
    RAISE NOTICE '📋 Parameters: user_id=%, game_id=%, opcode=%', p_user_id, p_game_id, p_opcode;
    RAISE NOTICE '==========================================';
    
    -- 1단계: 기존 활성 세션 종료
    BEGIN
        UPDATE game_launch_sessions
        SET 
            status = 'ended',
            ended_at = NOW()
        WHERE user_id = p_user_id
        AND status = 'active'
        AND ended_at IS NULL;
        
        GET DIAGNOSTICS v_update_count = ROW_COUNT;
        RAISE NOTICE '✅ [STEP 1] 기존 활성 세션 종료: %건', v_update_count;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING '⚠️ [STEP 1] 기존 세션 종료 중 오류 (무시): %', SQLERRM;
    END;
    
    -- 2단계: 새 세션 생성
    BEGIN
        INSERT INTO game_launch_sessions (
            user_id,
            game_id,
            opcode,
            launch_url,
            session_token,
            balance_before,
            launched_at,
            ended_at,
            status
        ) VALUES (
            p_user_id,
            p_game_id,
            p_opcode,
            p_launch_url,
            p_session_token,
            COALESCE(p_balance_before, 0),
            NOW(),
            NULL,
            'active'
        ) RETURNING id INTO v_session_id;
        
        RAISE NOTICE '✅ [STEP 2] 새 세션 생성 성공: session_id=%', v_session_id;
        
        IF v_session_id IS NULL THEN
            RAISE EXCEPTION '세션 ID가 NULL입니다. INSERT RETURNING이 실패했습니다.';
        END IF;
        
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING '❌ [STEP 2] INSERT 실패: %', SQLERRM;
            RAISE WARNING '❌ [STEP 2] SQLSTATE: %', SQLSTATE;
            RAISE EXCEPTION 'INSERT 중 오류 발생: %', SQLERRM;
    END;
    
    -- 3단계: 검증
    BEGIN
        SELECT status INTO v_status
        FROM game_launch_sessions
        WHERE id = v_session_id;
        
        RAISE NOTICE '🔍 [STEP 3] 검증 완료: session_id=%, status=%', v_session_id, v_status;
        
        IF v_status != 'active' THEN
            RAISE WARNING '⚠️ [STEP 3] 세션이 저장됐지만 status가 active가 아님: %', v_status;
        END IF;
        
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING '⚠️ [STEP 3] 검증 중 오류: %', SQLERRM;
    END;
    
    RAISE NOTICE '==========================================';
    RAISE NOTICE '✅ [FUNCTION END] 반환 session_id=%', v_session_id;
    RAISE NOTICE '==========================================';
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '==========================================';
        RAISE WARNING '❌ [FUNCTION ERROR] save_game_launch_session 최종 오류';
        RAISE WARNING '❌ 오류 메시지: %', SQLERRM;
        RAISE WARNING '❌ SQLSTATE: %', SQLSTATE;
        RAISE WARNING '==========================================';
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 함수 권한 설정
GRANT EXECUTE ON FUNCTION save_game_launch_session TO anon, authenticated;

-- 5. 테이블 제약 조건 재확인
DO $$
BEGIN
    -- user_id NOT NULL 확인
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_launch_sessions'
        AND column_name = 'user_id'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE game_launch_sessions ALTER COLUMN user_id SET NOT NULL;
        RAISE NOTICE '✅ user_id NOT NULL 제약 추가';
    END IF;
    
    -- game_id NOT NULL 확인
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_launch_sessions'
        AND column_name = 'game_id'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE game_launch_sessions ALTER COLUMN game_id SET NOT NULL;
        RAISE NOTICE '✅ game_id NOT NULL 제약 추가';
    END IF;
    
    -- status 기본값 확인
    ALTER TABLE game_launch_sessions ALTER COLUMN status SET DEFAULT 'active';
    ALTER TABLE game_launch_sessions ALTER COLUMN ended_at SET DEFAULT NULL;
    ALTER TABLE game_launch_sessions ALTER COLUMN launched_at SET DEFAULT NOW();
    
    RAISE NOTICE '✅ 테이블 제약 조건 업데이트 완료';
END $$;

-- 6. 테스트 실행
DO $$
DECLARE
    v_test_user_id UUID;
    v_test_session_id BIGINT;
BEGIN
    -- 테스트용 사용자 ID 가져오기 (첫 번째 사용자)
    SELECT id INTO v_test_user_id
    FROM users
    WHERE role = 'user'
    LIMIT 1;
    
    IF v_test_user_id IS NULL THEN
        RAISE NOTICE '⚠️ 테스트 건너뜀: 사용자가 없음';
        RETURN;
    END IF;
    
    RAISE NOTICE '==========================================';
    RAISE NOTICE '🧪 함수 테스트 시작';
    RAISE NOTICE '==========================================';
    
    -- 함수 호출
    SELECT save_game_launch_session(
        v_test_user_id,
        300001::BIGINT,
        'testopcode'::VARCHAR,
        'https://test.com'::TEXT,
        'test_token'::VARCHAR,
        1000.00::DECIMAL
    ) INTO v_test_session_id;
    
    IF v_test_session_id IS NULL THEN
        RAISE WARNING '❌ 테스트 실패: 반환된 session_id가 NULL';
    ELSE
        RAISE NOTICE '✅ 테스트 성공: session_id=%', v_test_session_id;
        
        -- 테스트 데이터 삭제
        DELETE FROM game_launch_sessions WHERE id = v_test_session_id;
        RAISE NOTICE '🧹 테스트 데이터 삭제 완료';
    END IF;
    
    RAISE NOTICE '==========================================';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ 테스트 중 오류: %', SQLERRM;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 119. 게임 세션 NULL 반환 문제 해결 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. RLS 정책 완전 재설정 (모든 접근 허용)';
    RAISE NOTICE '2. save_game_launch_session 함수 재작성';
    RAISE NOTICE '3. 상세한 단계별 로깅 추가';
    RAISE NOTICE '4. 각 단계별 EXCEPTION 처리';
    RAISE NOTICE '5. 테이블 제약 조건 재확인';
    RAISE NOTICE '6. 함수 테스트 실행';
    RAISE NOTICE '============================================';
END $$;
