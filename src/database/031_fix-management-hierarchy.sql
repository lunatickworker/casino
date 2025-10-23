-- ========================================
-- 31. 관리체계 정립 및 수정
-- ========================================
-- 설명: sadmin 계정에 API 정보 추가 및 OPCODE 조회 로직 수정

-- 1. sadmin 계정에 실제 API 정보 추가
-- 사용자가 제공한 실제 opcode/secret_key/token 값으로 업데이트해야 함
UPDATE partners 
SET 
    opcode = 'SADMIN_OPCODE_001',  -- 실제 값으로 변경 필요
    secret_key = 'SADMIN_SECRET_KEY_001',  -- 실제 값으로 변경 필요
    api_token = 'SADMIN_API_TOKEN_001',  -- 실제 값으로 변경 필요
    updated_at = NOW()
WHERE username = 'sadmin' AND level = 1;

-- 2. get_user_opcode_info 함수 수정
-- 시스템관리자(level=1)와 대본사(level=2) 모두에서 OPCODE 조회 가능하도록 수정
CREATE OR REPLACE FUNCTION get_user_opcode_info(user_id UUID)
RETURNS JSON AS $$
DECLARE
    current_partner_id UUID;
    partner_record partners%ROWTYPE;
    result JSON;
BEGIN
    -- 사용자의 추천인(파트너) ID 가져오기
    SELECT referrer_id INTO current_partner_id
    FROM users
    WHERE id = user_id;
    
    IF current_partner_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자의 추천인 정보가 없습니다.'
        );
    END IF;
    
    -- 파트너 계층을 따라 올라가며 OPCODE를 가진 파트너 찾기
    -- 시스템관리자(level=1) 또는 대본사(level=2)에서 OPCODE 조회
    WHILE current_partner_id IS NOT NULL LOOP
        SELECT * INTO partner_record
        FROM partners
        WHERE id = current_partner_id
        AND status = 'active';
        
        -- 파트너가 존재하지 않으면 종료
        IF partner_record.id IS NULL THEN
            EXIT;
        END IF;
        
        -- OPCODE가 있으면 (시스템관리자 level=1 또는 대본사 level=2) 반환
        IF partner_record.opcode IS NOT NULL 
           AND partner_record.secret_key IS NOT NULL 
           AND (partner_record.level = 1 OR partner_record.level = 2) THEN
            
            RETURN json_build_object(
                'success', true,
                'opcode', partner_record.opcode,
                'secret_key', partner_record.secret_key,
                'api_token', partner_record.api_token,
                'partner_id', partner_record.id,
                'partner_name', partner_record.nickname,
                'partner_level', partner_record.level,
                'partner_type', partner_record.partner_type
            );
        END IF;
        
        -- 상위 파트너로 이동
        current_partner_id := partner_record.parent_id;
    END LOOP;
    
    -- OPCODE를 찾지 못한 경우
    RETURN json_build_object(
        'success', false,
        'error', '연결된 상위 조직의 OPCODE 정보를 찾을 수 없습니다.'
    );
END;
$$ LANGUAGE plpgsql;

-- 3. smcdev11 사용자의 API 정보 확인 함수
CREATE OR REPLACE FUNCTION check_smcdev11_api_info()
RETURNS JSON AS $$
DECLARE
    user_id_val UUID;
    api_info JSON;
BEGIN
    -- smcdev11 사용자 ID 조회
    SELECT id INTO user_id_val
    FROM users
    WHERE username = 'smcdev11';
    
    IF user_id_val IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'smcdev11 사용자를 찾을 수 없습니다.'
        );
    END IF;
    
    -- API 정보 조회
    SELECT get_user_opcode_info(user_id_val) INTO api_info;
    
    RETURN json_build_object(
        'success', true,
        'user_id', user_id_val,
        'api_info', api_info
    );
END;
$$ LANGUAGE plpgsql;

-- 4. 관리체계 검증 함수
CREATE OR REPLACE FUNCTION validate_management_hierarchy()
RETURNS JSON AS $$
DECLARE
    sadmin_info RECORD;
    smcdev11_info RECORD;
    result JSON;
BEGIN
    -- sadmin 정보 조회
    SELECT 
        id, username, nickname, level, partner_type,
        opcode, secret_key, api_token,
        CASE 
            WHEN opcode IS NOT NULL AND secret_key IS NOT NULL AND api_token IS NOT NULL 
            THEN true 
            ELSE false 
        END as has_api_info
    INTO sadmin_info
    FROM partners
    WHERE username = 'sadmin' AND level = 1;
    
    -- smcdev11 정보 조회
    SELECT 
        u.id, u.username, u.nickname, u.referrer_id,
        p.username as referrer_username,
        p.nickname as referrer_nickname,
        p.level as referrer_level
    INTO smcdev11_info
    FROM users u
    LEFT JOIN partners p ON u.referrer_id = p.id
    WHERE u.username = 'smcdev11';
    
    RETURN json_build_object(
        'sadmin', json_build_object(
            'exists', CASE WHEN sadmin_info.id IS NOT NULL THEN true ELSE false END,
            'username', sadmin_info.username,
            'nickname', sadmin_info.nickname,
            'level', sadmin_info.level,
            'partner_type', sadmin_info.partner_type,
            'has_api_info', COALESCE(sadmin_info.has_api_info, false),
            'opcode_exists', CASE WHEN sadmin_info.opcode IS NOT NULL THEN true ELSE false END
        ),
        'smcdev11', json_build_object(
            'exists', CASE WHEN smcdev11_info.id IS NOT NULL THEN true ELSE false END,
            'username', smcdev11_info.username,
            'nickname', smcdev11_info.nickname,
            'referrer_username', smcdev11_info.referrer_username,
            'referrer_nickname', smcdev11_info.referrer_nickname,
            'referrer_level', smcdev11_info.referrer_level,
            'correct_referrer', CASE WHEN smcdev11_info.referrer_username = 'sadmin' THEN true ELSE false END
        )
    );
END;
$$ LANGUAGE plpgsql;

-- 5. 파트너 생성 체계 검증 (대본사 생성 시에만 API 정보 필요)
CREATE OR REPLACE FUNCTION create_partner_with_hierarchy_check(
    p_username VARCHAR(50),
    p_nickname VARCHAR(50),
    p_password_hash VARCHAR(255),
    p_partner_type VARCHAR(20),
    p_level INTEGER,
    p_parent_username VARCHAR(50) DEFAULT NULL,
    p_opcode VARCHAR(100) DEFAULT NULL,
    p_secret_key VARCHAR(255) DEFAULT NULL,
    p_api_token VARCHAR(255) DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    parent_id_val UUID;
    new_partner_id UUID;
BEGIN
    -- 대본사 생성인지 확인
    IF p_level = 2 AND p_partner_type = 'head_office' THEN
        -- 대본사는 opcode, secret_key, api_token이 필수
        IF p_opcode IS NULL OR p_secret_key IS NULL OR p_api_token IS NULL THEN
            RETURN json_build_object(
                'success', false,
                'error', '대본사 생성 시 opcode, secret_key, api_token이 필수입니다.'
            );
        END IF;
    ELSE
        -- 하위 조직은 API 정보 불필요
        IF p_opcode IS NOT NULL OR p_secret_key IS NOT NULL OR p_api_token IS NOT NULL THEN
            RETURN json_build_object(
                'success', false,
                'error', '하위 조직 생성 시에는 API 정보를 입력하지 않습니다.'
            );
        END IF;
    END IF;
    
    -- 상위 파트너 ID 조회 (시스템관리자가 아닌 경우)
    IF p_level > 1 AND p_parent_username IS NOT NULL THEN
        SELECT id INTO parent_id_val
        FROM partners
        WHERE username = p_parent_username
        AND level = p_level - 1
        AND status = 'active';
        
        IF parent_id_val IS NULL THEN
            RETURN json_build_object(
                'success', false,
                'error', '올바른 상위 파트너를 찾을 수 없습니다.'
            );
        END IF;
    END IF;
    
    -- 파트너 생성
    INSERT INTO partners (
        username, nickname, password_hash, partner_type, level, 
        parent_id, opcode, secret_key, api_token, status
    ) VALUES (
        p_username, p_nickname, p_password_hash, p_partner_type, p_level,
        parent_id_val, p_opcode, p_secret_key, p_api_token, 'active'
    ) RETURNING id INTO new_partner_id;
    
    RETURN json_build_object(
        'success', true,
        'partner_id', new_partner_id,
        'message', '파트너가 성공적으로 생성되었습니다.'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '파트너 생성 중 오류: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- 6. 완료 메시지 및 검증
DO $$
DECLARE
    validation_result JSON;
    smcdev11_api_check JSON;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '🔧 관리체계 정립 완료!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '✅ sadmin 계정에 API 정보 추가됨';
    RAISE NOTICE '✅ get_user_opcode_info 함수 수정됨 (level 1,2 지원)';
    RAISE NOTICE '✅ 관리체계 검증 함수 추가됨';
    RAISE NOTICE '✅ 파트너 생성 체계 검증 함수 추가됨';
    RAISE NOTICE '';
    RAISE NOTICE '📋 검증 결과:';
    
    -- 관리체계 검증
    SELECT validate_management_hierarchy() INTO validation_result;
    RAISE NOTICE '   관리체계: %', validation_result;
    
    -- smcdev11 API 정보 확인
    SELECT check_smcdev11_api_info() INTO smcdev11_api_check;
    RAISE NOTICE '   smcdev11 API: %', smcdev11_api_check;
    
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  주의사항:';
    RAISE NOTICE '   1. sadmin의 실제 API 정보를 업데이트해야 합니다.';
    RAISE NOTICE '   2. SADMIN_OPCODE_001, SADMIN_SECRET_KEY_001, SADMIN_API_TOKEN_001을';
    RAISE NOTICE '      실제 값으로 변경하세요.';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
END $$;