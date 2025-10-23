-- 현재 DB 상태 디버그 및 문제 해결

-- 1. smcdev11 사용자 정보 확인
DO $$
DECLARE
    user_record users%ROWTYPE;
    partner_record partners%ROWTYPE;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '===============================================';
    RAISE NOTICE '🔍 사용자 및 파트너 정보 디버그';
    RAISE NOTICE '===============================================';
    
    -- smcdev11 사용자 정보 조회
    SELECT * INTO user_record
    FROM users
    WHERE username = 'smcdev11';
    
    IF user_record.id IS NOT NULL THEN
        RAISE NOTICE '👤 smcdev11 사용자 정보:';
        RAISE NOTICE '   - ID: %', user_record.id;
        RAISE NOTICE '   - Username: %', user_record.username;
        RAISE NOTICE '   - Referrer ID: %', user_record.referrer_id;
        RAISE NOTICE '   - Status: %', user_record.status;
        RAISE NOTICE '   - External Token: %', user_record.external_token;
        
        -- 추천인(파트너) 정보 조회
        IF user_record.referrer_id IS NOT NULL THEN
            SELECT * INTO partner_record
            FROM partners
            WHERE id = user_record.referrer_id;
            
            IF partner_record.id IS NOT NULL THEN
                RAISE NOTICE '';
                RAISE NOTICE '🏢 추천인(파트너) 정보:';
                RAISE NOTICE '   - ID: %', partner_record.id;
                RAISE NOTICE '   - Username: %', partner_record.username;
                RAISE NOTICE '   - Nickname: %', partner_record.nickname;
                RAISE NOTICE '   - Level: %', partner_record.level;
                RAISE NOTICE '   - Partner Type: %', partner_record.partner_type;
                RAISE NOTICE '   - Status: %', partner_record.status;
                RAISE NOTICE '   - OPCODE: %', partner_record.opcode;
                RAISE NOTICE '   - SECRET_KEY: %', CASE WHEN partner_record.secret_key IS NULL THEN 'NULL' ELSE '설정됨' END;
                RAISE NOTICE '   - API_TOKEN: %', CASE WHEN partner_record.api_token IS NULL THEN 'NULL' ELSE '설정됨' END;
                RAISE NOTICE '   - Parent ID: %', partner_record.parent_id;
            ELSE
                RAISE NOTICE '❌ 추천인 파트너를 찾을 수 없습니다.';
            END IF;
        ELSE
            RAISE NOTICE '❌ 사용자의 추천인 정보가 없습니다.';
        END IF;
    ELSE
        RAISE NOTICE '❌ smcdev11 사용자를 찾을 수 없습니다.';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '📋 전체 사용자 목록:';
    FOR user_record IN SELECT * FROM users LOOP
        RAISE NOTICE '   - % (ID: %, Referrer: %)', user_record.username, user_record.id, user_record.referrer_id;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '🏢 전체 파트너 목록:';
    FOR partner_record IN SELECT * FROM partners LOOP
        RAISE NOTICE '   - % [%] (Level: %, Type: %, Status: %, OPCODE: %)', 
            partner_record.nickname, 
            partner_record.username,
            partner_record.level, 
            partner_record.partner_type, 
            partner_record.status,
            partner_record.opcode;
    END LOOP;
    
    RAISE NOTICE '===============================================';
END $$;

-- 2. get_user_opcode_info 함수 직접 테스트
DO $$
DECLARE
    test_result JSON;
    smcdev11_user_id UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🧪 get_user_opcode_info 함수 테스트';
    RAISE NOTICE '===============================================';
    
    -- smcdev11 사용자 ID 조회
    SELECT id INTO smcdev11_user_id
    FROM users
    WHERE username = 'smcdev11';
    
    IF smcdev11_user_id IS NOT NULL THEN
        RAISE NOTICE '📞 함수 호출: get_user_opcode_info(%)...', smcdev11_user_id;
        
        BEGIN
            SELECT get_user_opcode_info(smcdev11_user_id) INTO test_result;
            
            RAISE NOTICE '✅ 함수 호출 성공!';
            RAISE NOTICE '📋 결과: %', test_result::text;
            
            -- 결과 분석
            IF (test_result->>'success')::boolean = true THEN
                RAISE NOTICE '';
                RAISE NOTICE '🎉 성공! API 정보:';
                RAISE NOTICE '   - OPCODE: %', test_result->>'opcode';
                RAISE NOTICE '   - SECRET_KEY: %', test_result->>'secret_key';
                RAISE NOTICE '   - API_TOKEN: %', test_result->>'api_token';
                RAISE NOTICE '   - 파트너: %', test_result->>'partner_name';
                RAISE NOTICE '   - 레벨: %', test_result->>'partner_level';
            ELSE
                RAISE NOTICE '';
                RAISE NOTICE '❌ 실패: %', test_result->>'error';
                RAISE NOTICE '🔍 디버그 정보: %', test_result->>'debug_path';
            END IF;
            
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE '❌ 함수 호출 중 오류 발생: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE '❌ smcdev11 사용자 ID를 찾을 수 없습니다.';
    END IF;
    
    RAISE NOTICE '===============================================';
END $$;

-- 3. 문제 해결을 위한 데이터 생성 (필요시)
DO $$
DECLARE
    system_admin_id UUID;
    smcdev11_user_id UUID;
    user_exists BOOLEAN := FALSE;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🔧 데이터 복구 작업';
    RAISE NOTICE '===============================================';
    
    -- 시스템 관리자 ID 조회
    SELECT id INTO system_admin_id
    FROM partners
    WHERE username = 'sadmin' AND partner_type = 'system_admin';
    
    IF system_admin_id IS NULL THEN
        RAISE NOTICE '❌ 시스템 관리자를 찾을 수 없습니다.';
        RETURN;
    END IF;
    
    RAISE NOTICE '👑 시스템 관리자 ID: %', system_admin_id;
    
    -- smcdev11 사용자 존재 확인
    SELECT id INTO smcdev11_user_id
    FROM users
    WHERE username = 'smcdev11';
    
    IF smcdev11_user_id IS NOT NULL THEN
        user_exists := TRUE;
        RAISE NOTICE '👤 smcdev11 사용자 존재 확인: %', smcdev11_user_id;
    END IF;
    
    -- smcdev11 사용자가 없으면 생성
    IF NOT user_exists THEN
        RAISE NOTICE '🔄 smcdev11 사용자 생성 중...';
        
        INSERT INTO users (
            username,
            password_hash,
            nickname,
            referrer_id,
            status,
            balance,
            vip_level,
            created_at,
            updated_at
        ) VALUES (
            'smcdev11',
            crypt('admin123!', gen_salt('bf')),
            'smcdev11',
            system_admin_id,
            'active',
            0,
            1,
            now(),
            now()
        ) RETURNING id INTO smcdev11_user_id;
        
        RAISE NOTICE '✅ smcdev11 사용자 생성 완료: %', smcdev11_user_id;
    ELSE
        -- 기존 사용자의 추천인 정보 업데이트
        UPDATE users 
        SET referrer_id = system_admin_id,
            updated_at = now()
        WHERE id = smcdev11_user_id;
        
        RAISE NOTICE '🔄 smcdev11 사용자의 추천인 정보 업데이트 완료';
    END IF;
    
    RAISE NOTICE '===============================================';
END $$;