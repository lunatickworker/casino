-- user_login 함수 오버로딩 문제 해결

-- 1. 기존 user_login 함수들 모두 제거
DROP FUNCTION IF EXISTS user_login(username_param character varying, password_param character varying);
DROP FUNCTION IF EXISTS user_login(username_param text, password_param text);
DROP FUNCTION IF EXISTS user_login(character varying, character varying);
DROP FUNCTION IF EXISTS user_login(text, text);

-- 2. 명확한 user_login 함수 재생성 (TEXT 타입으로 통일)
CREATE OR REPLACE FUNCTION user_login(
    username_param TEXT,
    password_param TEXT
)
RETURNS JSON AS $$
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

-- 3. validate_user_session 함수도 오버로딩 문제 방지를 위해 재생성
DROP FUNCTION IF EXISTS validate_user_session(session_token_param character varying);
DROP FUNCTION IF EXISTS validate_user_session(session_token_param text);

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

-- 4. user_logout 함수도 동일하게 처리
DROP FUNCTION IF EXISTS user_logout(session_token_param character varying);
DROP FUNCTION IF EXISTS user_logout(session_token_param text);

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

-- 5. users 테이블 필수 컬럼 확인 및 추가
DO $$
BEGIN
    -- session_token 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'session_token') THEN
        ALTER TABLE users ADD COLUMN session_token TEXT;
        CREATE INDEX IF NOT EXISTS idx_users_session_token ON users(session_token);
    END IF;
    
    -- last_login_at 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_login_at') THEN
        ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    -- password_hash 컬럼 추가 (기존 password와 함께 사용)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
        ALTER TABLE users ADD COLUMN password_hash TEXT;
    END IF;
    
    -- 기존 password 데이터를 password_hash로 변환 (bcrypt 사용)
    UPDATE users 
    SET password_hash = crypt(password, gen_salt('bf')) 
    WHERE password IS NOT NULL AND password_hash IS NULL;
    
END $$;

-- 6. smcdev11 사용자 생성 또는 업데이트
DO $$
DECLARE
    user_exists BOOLEAN;
    system_admin_id UUID;
BEGIN
    -- 시스템관리자 ID 조회
    SELECT id INTO system_admin_id 
    FROM partners 
    WHERE username = 'sadmin' AND level = 1
    LIMIT 1;
    
    -- smcdev11 사용자 존재 확인
    SELECT EXISTS(SELECT 1 FROM users WHERE username = 'smcdev11') INTO user_exists;
    
    IF NOT user_exists THEN
        -- smcdev11 사용자 생성
        INSERT INTO users (
            id,
            username,
            nickname,
            password,
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
            'smcdev11',
            '테스트사용자',
            'admin123!',
            crypt('admin123!', gen_salt('bf')),
            'active',
            0,
            0,
            1,
            system_admin_id,
            '국민은행',
            '123-456-789012',
            '테스트사용자',
            NOW(),
            NOW()
        );
        
        RAISE NOTICE 'smcdev11 사용자가 성공적으로 생성되었습니다.';
    ELSE
        -- 기존 사용자 업데이트 (password_hash 없는 경우)
        UPDATE users 
        SET 
            password_hash = crypt('admin123!', gen_salt('bf')),
            updated_at = NOW()
        WHERE username = 'smcdev11' AND password_hash IS NULL;
        
        RAISE NOTICE 'smcdev11 사용자 정보가 업데이트되었습니다.';
    END IF;
END $$;

-- 완료 메시지
SELECT 'user_login 함수 오버로딩 문제가 해결되었습니다.' as message;