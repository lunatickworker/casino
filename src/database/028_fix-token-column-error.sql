-- partners 테이블 token 컬럼 오류 해결

-- 1. get_user_partner_opcode 함수에서 token을 api_token으로 수정
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
    
    -- 상위 파트너의 OPCODE 정보 조회 (token -> api_token으로 수정)
    SELECT opcode, secret_key, api_token INTO partner_record
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
    
    -- OPCODE 정보 반환 (api_token을 token으로 반환)
    RETURN json_build_object(
        'success', true,
        'data', json_build_object(
            'opcode', partner_record.opcode,
            'secret_key', partner_record.secret_key,
            'token', partner_record.api_token
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

-- 2. create_user_with_api 함수에서 external_token_param을 정확히 처리
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
    
    -- 사용자 생성 (external_token 컬럼 확인 후 처리)
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

-- 3. 시스템관리자 파트너에 기본 API 정보 설정 (없는 경우만)
DO $$
DECLARE
    admin_exists BOOLEAN;
BEGIN
    -- 시스템관리자 존재 확인
    SELECT EXISTS(
        SELECT 1 FROM partners 
        WHERE username = 'sadmin' AND level = 1
    ) INTO admin_exists;
    
    IF admin_exists THEN
        -- 기존 시스템관리자의 API 정보가 없으면 업데이트
        UPDATE partners 
        SET 
            opcode = COALESCE(opcode, 'eeo2211'),
            secret_key = COALESCE(secret_key, 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj'),
            api_token = COALESCE(api_token, '153b28230ef1c40c11ff526e9da93e2b'),
            updated_at = NOW()
        WHERE username = 'sadmin' AND level = 1
        AND (opcode IS NULL OR secret_key IS NULL OR api_token IS NULL);
        
        RAISE NOTICE '시스템관리자 API 정보가 업데이트되었습니다.';
    ELSE
        RAISE NOTICE '시스템관리자가 존재하지 않습니다.';
    END IF;
END $$;

-- 4. partners 테이블 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_partners_opcode ON partners(opcode);
CREATE INDEX IF NOT EXISTS idx_partners_parent_id ON partners(parent_id);
CREATE INDEX IF NOT EXISTS idx_partners_level ON partners(level);

-- 완료 메시지
SELECT 'token 컬럼 오류가 해결되었습니다. partners.api_token을 사용합니다.' as message;