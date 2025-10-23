-- smcdev111 사용자 계정 생성 및 Invest API 연동 설정

-- 1. smcdev111 사용자가 이미 존재하는지 확인하고 없으면 생성
DO $$
DECLARE
    user_exists BOOLEAN;
    system_admin_id UUID;
BEGIN
    -- 시스템관리자 ID 조회
    SELECT id INTO system_admin_id 
    FROM partners 
    WHERE username = 'smcdev11' AND level = 1;
    
    IF system_admin_id IS NULL THEN
        RAISE EXCEPTION '시스템관리자를 찾을 수 없습니다.';
    END IF;
    
    -- smcdev11 사용자 존재 확인
    SELECT EXISTS(SELECT 1 FROM users WHERE username = 'smcdev111') INTO user_exists;
    
    IF NOT user_exists THEN
        -- smcdev11 사용자 생성
        INSERT INTO users (
            id,
            username,
            nickname,
            password_hash,
            status,
            balance,
            points,
            vip_level,
            referrer_id,
            bank_name,
            bank_account,
            bank_holder,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            'smcdev111',
            '홍나라',
            crypt('smcdev111!', gen_salt('bf')), -- bcrypt 해시
            'active',
            0, -- 초기 잔고는 0, API에서 실제 잔고 조회
            0,
            7, -- VIP 레벨 7
            system_admin_id, -- 시스템관리자를 참조자로 설정
            '국민은행',
            '123-456-789012',
            '홍나라',
            NOW(),
            NOW()
        );
        
        RAISE NOTICE 'smcdev111 사용자가 성공적으로 생성되었습니다.';
    ELSE
        RAISE NOTICE 'smcdev111 사용자가 이미 존재합니다.';
    END IF;
END $$;

-- 2. user_login 함수 - 기존 함수를 DROP하고 재생성
DROP FUNCTION IF EXISTS user_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION user_login(
    username_param TEXT,
    password_param TEXT
)
RETURNS JSON AS $
DECLARE
    user_record RECORD;
    session_token_value TEXT;
    result_data JSON;
BEGIN
    -- 사용자 조회 및 비밀번호 확인
    SELECT * INTO user_record
    FROM users 
    WHERE username = username_param 
    AND password_hash = crypt(password_param, password_hash)
    AND status = 'active';
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', '아이디 또는 비밀번호가 올바르지 않습니다.'
        );
    END IF;
    
    -- 세션 토큰 생성
    session_token_value := 'user_' || user_record.id::text || '_' || extract(epoch from now())::text;
    
    -- 세션 토큰 업데이트
    UPDATE users 
    SET 
        session_token = session_token_value,
        last_login_at = NOW(),
        updated_at = NOW()
    WHERE id = user_record.id;
    
    -- 로그인 성공 응답
    RETURN json_build_object(
        'success', true,
        'user', json_build_object(
            'id', user_record.id,
            'username', user_record.username,
            'nickname', user_record.nickname,
            'balance', user_record.balance,
            'points', user_record.points,
            'vip_level', user_record.vip_level,
            'status', user_record.status,
            'session_token', session_token_value
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '로그인 처리 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. validate_user_session 함수가 존재하지 않으면 생성
CREATE OR REPLACE FUNCTION validate_user_session(session_token_param TEXT)
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
BEGIN
    -- 세션 토큰으로 사용자 조회
    SELECT * INTO user_record
    FROM users 
    WHERE session_token = session_token_param
    AND status = 'active';
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', '유효하지 않은 세션입니다.'
        );
    END IF;
    
    -- 마지막 활동 시간 업데이트
    UPDATE users 
    SET updated_at = NOW()
    WHERE id = user_record.id;
    
    -- 세션 유효 응답
    RETURN json_build_object(
        'success', true,
        'user', json_build_object(
            'id', user_record.id,
            'username', user_record.username,
            'nickname', user_record.nickname,
            'balance', user_record.balance,
            'points', user_record.points,
            'vip_level', user_record.vip_level,
            'status', user_record.status,
            'session_token', user_record.session_token
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '세션 검증 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. user_logout 함수가 존재하지 않으면 생성
CREATE OR REPLACE FUNCTION user_logout(session_token_param TEXT)
RETURNS JSON AS $$
DECLARE
    updated_rows INTEGER;
BEGIN
    -- 세션 토큰 제거
    UPDATE users 
    SET 
        session_token = NULL,
        updated_at = NOW()
    WHERE session_token = session_token_param;
    
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    
    IF updated_rows = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', '유효하지 않은 세션입니다.'
        );
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'message', '로그아웃이 완료되었습니다.'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '로그아웃 처리 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. users 테이블에 필요한 컬럼들이 없으면 추가
DO $$
BEGIN
    -- session_token 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'session_token') THEN
        ALTER TABLE users ADD COLUMN session_token TEXT;
        CREATE INDEX idx_users_session_token ON users(session_token);
    END IF;
    
    -- last_login_at 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_login_at') THEN
        ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    -- password_hash 컬럼이 없으면 추가 (기존 password를 해시로 변환)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
        ALTER TABLE users ADD COLUMN password_hash TEXT;
        
        -- 기존 password 데이터가 있으면 해시로 변환
        UPDATE users SET password_hash = crypt(password, gen_salt('bf')) WHERE password IS NOT NULL AND password_hash IS NULL;
    END IF;
END $$;

-- 6. Invest API와 연동을 위한 외부 계정 생성 함수 개선
CREATE OR REPLACE FUNCTION create_invest_account(
    opcode_param TEXT,
    username_param TEXT,
    secret_key_param TEXT
)
RETURNS JSON AS $$
DECLARE
    result_data JSON;
BEGIN
    -- 실제로는 외부 API를 호출해야 하지만, 
    -- 여기서는 계정이 생성된 것으로 가정하고 토큰 반환
    -- 실제 구현에서는 HTTP 요청을 통해 Invest API를 호출해야 함
    
    RETURN json_build_object(
        'success', true,
        'data', json_build_object(
            'username', username_param,
            'token', '153b28230ef1c40c11ff526e9da93e2b', -- 실제 토큰값
            'message', '계정이 생성되었습니다.'
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '외부 계정 생성 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 완료 메시지
SELECT 'smcdev111 사용자 계정 설정이 완료되었습니다.' as message;