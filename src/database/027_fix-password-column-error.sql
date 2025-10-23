-- password 컬럼 오류 해결 및 사용자 시스템 완전 설정

-- 1. 기존 함수들 정리 (오버로딩 문제 해결)
DROP FUNCTION IF EXISTS user_login(username_param character varying, password_param character varying);
DROP FUNCTION IF EXISTS user_login(username_param text, password_param text);
DROP FUNCTION IF EXISTS user_login(character varying, character varying);
DROP FUNCTION IF EXISTS user_login(text, text);
DROP FUNCTION IF EXISTS validate_user_session(session_token_param character varying);
DROP FUNCTION IF EXISTS validate_user_session(session_token_param text);
DROP FUNCTION IF EXISTS user_logout(session_token_param character varying);
DROP FUNCTION IF EXISTS user_logout(session_token_param text);

-- 2. users 테이블 필수 컬럼 확인 및 추가
DO $$
BEGIN
    -- password_hash 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
        ALTER TABLE users ADD COLUMN password_hash TEXT;
    END IF;
    
    -- session_token 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'session_token') THEN
        ALTER TABLE users ADD COLUMN session_token TEXT;
        CREATE INDEX IF NOT EXISTS idx_users_session_token ON users(session_token);
    END IF;
    
    -- last_login_at 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_login_at') THEN
        ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    -- external_token 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'external_token') THEN
        ALTER TABLE users ADD COLUMN external_token TEXT;
        CREATE INDEX IF NOT EXISTS idx_users_external_token ON users(external_token);
    END IF;
    
    -- username 인덱스 추가
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'users' AND indexname = 'idx_users_username') THEN
        CREATE UNIQUE INDEX idx_users_username ON users(username);
    END IF;
    
END $$;

-- 3. user_login 함수 생성 (TEXT 타입으로 통일)
CREATE OR REPLACE FUNCTION user_login(
    username_param TEXT,
    password_param TEXT
)
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
    session_token_value TEXT;
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

-- 4. validate_user_session 함수 생성
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

-- 5. user_logout 함수 생성
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

-- 6. 사용자 잔고 동기화 함수
CREATE OR REPLACE FUNCTION sync_user_balance(
    username_param TEXT,
    real_balance NUMERIC
)
RETURNS JSON AS $$
DECLARE
    updated_rows INTEGER;
    old_balance NUMERIC := 0;
    user_id_val UUID;
BEGIN
    -- 기존 잔고 조회
    SELECT id, balance INTO user_id_val, old_balance
    FROM users 
    WHERE username = username_param;
    
    IF user_id_val IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.'
        );
    END IF;
    
    -- 사용자 잔고 업데이트
    UPDATE users 
    SET 
        balance = real_balance,
        updated_at = NOW()
    WHERE username = username_param;
    
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    
    RETURN json_build_object(
        'success', true,
        'message', '잔고가 성공적으로 동기화되었습니다.',
        'data', json_build_object(
            'username', username_param,
            'old_balance', old_balance,
            'new_balance', real_balance
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '잔고 동기화 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. 사용자의 상위 파트너 OPCODE 정보 조회 함수
CREATE OR REPLACE FUNCTION get_user_partner_opcode(username_param TEXT)
RETURNS JSON AS $$
DECLARE
    result_data JSON;
    user_record RECORD;
    partner_record RECORD;
BEGIN
    -- 사용자 정보 조회
    SELECT * INTO user_record
    FROM users 
    WHERE username = username_param;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.'
        );
    END IF;
    
    -- 상위 파트너의 OPCODE 정보 조회
    SELECT opcode, secret_key, token INTO partner_record
    FROM partners 
    WHERE id = user_record.referrer_id
    AND opcode IS NOT NULL 
    AND secret_key IS NOT NULL;
    
    IF NOT FOUND THEN
        -- 상위 파트너가 없거나 OPCODE가 없는 경우 시스템 기본값 반환
        RETURN json_build_object(
            'success', true,
            'data', json_build_object(
                'opcode', 'eeo2211',
                'secret_key', 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
                'token', '153b28230ef1c40c11ff526e9da93e2b'
            )
        );
    END IF;
    
    -- OPCODE 정보 반환
    RETURN json_build_object(
        'success', true,
        'data', json_build_object(
            'opcode', partner_record.opcode,
            'secret_key', partner_record.secret_key,
            'token', partner_record.token
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '파트너 OPCODE 조회 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. 관리자페이지에서 사용자 생성을 위한 함수
CREATE OR REPLACE FUNCTION create_user_with_api(
    username_param TEXT,
    nickname_param TEXT,
    password_param TEXT,
    bank_name_param TEXT DEFAULT NULL,
    bank_account_param TEXT DEFAULT NULL,
    bank_holder_param TEXT DEFAULT NULL,
    referrer_id_param UUID DEFAULT NULL,
    external_token_param TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    new_user_id UUID;
    result_data JSON;
BEGIN
    -- 사용자명 중복 확인
    IF EXISTS (SELECT 1 FROM users WHERE username = username_param) THEN
        RETURN json_build_object(
            'success', false,
            'error', '이미 존재하는 사용자명입니다.'
        );
    END IF;
    
    -- 새 사용자 ID 생성
    new_user_id := gen_random_uuid();
    
    -- 사용자 생성
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
        external_token,
        created_at,
        updated_at
    ) VALUES (
        new_user_id,
        username_param,
        nickname_param,
        crypt(password_param, gen_salt('bf')),
        'active',
        0,
        0,
        1,
        referrer_id_param,
        bank_name_param,
        bank_account_param,
        bank_holder_param,
        external_token_param,
        NOW(),
        NOW()
    );
    
    -- 생성된 사용자 정보 조회
    SELECT json_build_object(
        'id', id,
        'username', username,
        'nickname', nickname,
        'status', status,
        'balance', balance,
        'points', points,
        'vip_level', vip_level,
        'bank_name', bank_name,
        'bank_account', bank_account,
        'bank_holder', bank_holder,
        'created_at', created_at
    ) INTO result_data
    FROM users 
    WHERE id = new_user_id;
    
    RETURN json_build_object(
        'success', true,
        'data', result_data,
        'message', '사용자가 성공적으로 생성되었습니다.'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자 생성 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. smcdev11 사용자 생성 또는 업데이트
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
        -- 기존 사용자의 password_hash가 없으면 업데이트
        UPDATE users 
        SET 
            password_hash = crypt('admin123!', gen_salt('bf')),
            updated_at = NOW()
        WHERE username = 'smcdev11' 
        AND (password_hash IS NULL OR password_hash = '');
        
        RAISE NOTICE 'smcdev11 사용자 정보가 업데이트되었습니다.';
    END IF;
END $$;

-- 완료 메시지
SELECT 'password 컬럼 오류가 해결되고 사용자 시스템이 완전히 설정되었습니다.' as message;