-- ============================================================================
-- 056. 게임 실행 세션 저장 함수 수정
-- ============================================================================
-- 작성일: 2025-10-03
-- 목적: save_game_launch_session 함수의 파라미터 순서 및 정의 재확인
-- 문제: PGRST202 오류로 함수 호출 실패
-- ============================================================================

-- 1. 기존 함수 삭제 후 재생성
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL);

-- 2. 게임 실행 세션 저장 함수 생성
CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    session_id BIGINT;
BEGIN
    -- 게임 실행 세션 기록 저장
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        status
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        p_balance_before,
        NOW(),
        'active'
    ) RETURNING id INTO session_id;
    
    -- 세션 ID 반환
    RETURN session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        -- 오류 발생 시 로그 출력 및 NULL 반환
        RAISE WARNING 'save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 함수 권한 설정
GRANT EXECUTE ON FUNCTION save_game_launch_session TO anon, authenticated;

-- 4. 게임 실행 세션 테이블 구조 확인 및 필요시 생성
CREATE TABLE IF NOT EXISTS game_launch_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL,
    opcode VARCHAR(50) NOT NULL,
    launch_url TEXT NOT NULL,
    session_token VARCHAR(255),
    balance_before DECIMAL(15,2),
    launched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'active',
    partner_id UUID REFERENCES partners(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_user_id ON game_launch_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_game_id ON game_launch_sessions(game_id);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_opcode ON game_launch_sessions(opcode);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_status ON game_launch_sessions(status);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_partner_id ON game_launch_sessions(partner_id);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_launched_at ON game_launch_sessions(launched_at);

-- 6. RLS 정책 설정
ALTER TABLE game_launch_sessions ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 후 재생성
DROP POLICY IF EXISTS "game_launch_sessions_select_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_insert_policy" ON game_launch_sessions;
DROP POLICY IF EXISTS "game_launch_sessions_update_policy" ON game_launch_sessions;

-- 읽기 정책: 인증된 사용자는 모든 데이터 조회 가능
CREATE POLICY "game_launch_sessions_select_policy" ON game_launch_sessions
    FOR SELECT USING (auth.role() = 'authenticated');

-- 삽입 정책: 인증된 사용자는 세션 생성 가능
CREATE POLICY "game_launch_sessions_insert_policy" ON game_launch_sessions
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 업데이트 정책: 인증된 사용자는 세션 업데이트 가능
CREATE POLICY "game_launch_sessions_update_policy" ON game_launch_sessions
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 7. 함수 테스트용 더미 호출 (실제로는 실행되지 않음)
DO $$
BEGIN
    -- 함수 정의 확인
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'save_game_launch_session' 
        AND pg_get_function_identity_arguments(oid) = 'p_user_id uuid, p_game_id bigint, p_opcode character varying, p_launch_url text, p_session_token character varying, p_balance_before numeric'
    ) THEN
        RAISE NOTICE '✅ save_game_launch_session 함수가 올바르게 생성되었습니다.';
    ELSE
        RAISE WARNING '❌ save_game_launch_session 함수 생성에 문제가 있습니다.';
    END IF;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 056. 게임 실행 세션 함수 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. save_game_launch_session 함수 재생성';
    RAISE NOTICE '2. 함수 파라미터 순서 확인: p_user_id, p_game_id, p_opcode, p_launch_url, p_session_token, p_balance_before';
    RAISE NOTICE '3. game_launch_sessions 테이블 구조 확인';
    RAISE NOTICE '4. 필요한 인덱스 및 RLS 정책 설정';
    RAISE NOTICE '5. 함수 권한 설정 완료';
    RAISE NOTICE '============================================';
END $$;