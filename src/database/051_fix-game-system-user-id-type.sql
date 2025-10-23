-- game_launch_sessions 테이블의 user_id 타입 오류 수정
-- 기존 users 테이블의 id가 UUID 타입이므로 user_id도 UUID로 변경

-- 1. 기존 game_launch_sessions 테이블이 있다면 삭제
DROP TABLE IF EXISTS game_launch_sessions CASCADE;

-- 2. 올바른 타입으로 game_launch_sessions 테이블 재생성
CREATE TABLE game_launch_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id), -- UUID 타입으로 수정
    game_id BIGINT NOT NULL REFERENCES games(id),
    opcode VARCHAR(50) NOT NULL,
    launch_url TEXT,
    session_token VARCHAR(255),
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    launched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'active' -- active, ended, error
);

-- 3. 기존 game_status_logs가 있다면 partner_id 타입 확인 
-- partner_id는 이미 UUID 타입으로 올바르게 생성되어 있음
-- 별도 수정 불필요 (050에서 partner_id UUID로 생성됨)

-- 4. 인덱스 재생성
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_user_game ON game_launch_sessions(user_id, game_id);

-- 5. RLS 정책 재설정
ALTER TABLE game_launch_sessions ENABLE ROW LEVEL SECURITY;

-- 게임 실행 세션 정책 (UUID 기반)
DROP POLICY IF EXISTS game_launch_sessions_policy ON game_launch_sessions;
CREATE POLICY game_launch_sessions_policy ON game_launch_sessions
FOR ALL TO authenticated
USING (
    user_id = auth.uid() -- UUID 타입으로 직접 비교
    OR EXISTS (
        SELECT 1 FROM partners p 
        WHERE p.id IN (
            SELECT referrer_id FROM users WHERE id = auth.uid()
        )
        AND p.partner_type IN ('system_admin', 'head_office', 'main_office')
    )
);

-- 6. 게임 실행 세션 저장 함수 수정
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
    
    RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- 7. 게임 실행 세션 종료 함수
CREATE OR REPLACE FUNCTION end_game_launch_session(
    p_session_id BIGINT,
    p_balance_after DECIMAL(15,2) DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE game_launch_sessions 
    SET 
        ended_at = NOW(),
        balance_after = p_balance_after,
        status = 'ended'
    WHERE id = p_session_id
    AND status = 'active';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ 게임 실행 세션 테이블 타입 오류 수정 완료';
    RAISE NOTICE '- user_id: BIGINT -> UUID 변경';
    RAISE NOTICE '- 게임 실행 세션 관련 함수 추가';
    RAISE NOTICE '- RLS 정책 UUID 기반으로 수정';
END $$;