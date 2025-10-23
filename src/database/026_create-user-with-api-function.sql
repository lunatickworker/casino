-- 관리자페이지에서 사용자 생성을 위한 함수 (Invest API 연동)

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
        external_token,
        created_at,
        updated_at
    ) VALUES (
        new_user_id,
        username_param,
        nickname_param,
        password_param,
        crypt(password_param, gen_salt('bf')), -- bcrypt 해시
        'active',
        0, -- 초기 잔고 0
        0, -- 초기 포인트 0
        1, -- 기본 VIP 레벨 1
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
    
    -- 사용자 생성 로그 기록
    INSERT INTO user_logs (
        user_id,
        action,
        description,
        ip_address,
        created_at
    ) VALUES (
        new_user_id,
        'user_created',
        '관리자에 의해 사용자 계정이 생성됨',
        '127.0.0.1', -- 실제로는 관리자 IP 기록
        NOW()
    );
    
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

-- users 테이블에 필요한 컬럼들이 없으면 추가
DO $$
BEGIN
    -- external_token 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'external_token') THEN
        ALTER TABLE users ADD COLUMN external_token TEXT;
        CREATE INDEX IF NOT EXISTS idx_users_external_token ON users(external_token);
    END IF;
    
    -- password 컬럼 추가 (기존 password_hash와 함께 사용)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password') THEN
        ALTER TABLE users ADD COLUMN password TEXT;
    END IF;
    
    -- user_logs 테이블이 없으면 생성
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_logs') THEN
        CREATE TABLE user_logs (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            action VARCHAR(100) NOT NULL,
            description TEXT,
            ip_address INET,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX idx_user_logs_user_id ON user_logs(user_id);
        CREATE INDEX idx_user_logs_action ON user_logs(action);
        CREATE INDEX idx_user_logs_created_at ON user_logs(created_at);
    END IF;
END $$;

-- 완료 메시지
SELECT 'create_user_with_api 함수가 생성되었습니다.' as message;