-- PGRST116 오류 해결: get_user_opcode_info 함수 개선 및 데이터 수정

-- 1. 먼저 현재 시스템 관리자 정보 확인 및 수정
DO $$
DECLARE
    system_admin_id UUID;
    admin_exists BOOLEAN := FALSE;
BEGIN
    RAISE NOTICE '🔧 시스템 관리자 정보 확인 및 생성';
    RAISE NOTICE '=====================================';
    
    -- 기존 시스템 관리자 확인
    SELECT id INTO system_admin_id
    FROM partners
    WHERE username = 'smcdev11' AND partner_type = 'system_admin';
    
    IF system_admin_id IS NOT NULL THEN
        admin_exists := TRUE;
        RAISE NOTICE '✅ 기존 시스템 관리자 발견: %', system_admin_id;
        
        -- API 정보 업데이트 (올바른 시스템 관리자 정보로)
        UPDATE partners 
        SET 
            opcode = 'eeo2211',
            secret_key = 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
            api_token = '153b28230ef1c40c11ff526e9da93e2b',
            status = 'active',
            updated_at = now()
        WHERE id = system_admin_id;
        
        RAISE NOTICE '🔄 시스템 관리자 API 정보 업데이트 완료';
    ELSE
        -- 시스템 관리자 생성
        INSERT INTO partners (
            username,
            password_hash,
            nickname,
            partner_type,
            level,
            parent_id,
            status,
            balance,
            opcode,
            secret_key,
            api_token,
            commission_rolling,
            commission_losing,
            withdrawal_fee,
            created_at,
            updated_at
        ) VALUES (
            'sadmin',
            crypt('sadmin123!', gen_salt('bf')),
            '시스템관리자',
            'system_admin',
            1,
            NULL,
            'active',
            0,
            'eeo2211',
            'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
            '153b28230ef1c40c11ff526e9da93e2b',
            0,
            0,
            0,
            now(),
            now()
        ) RETURNING id INTO system_admin_id;
        
        RAISE NOTICE '✅ 시스템 관리자 생성 완료: %', system_admin_id;
    END IF;
    
    -- smcdev11 사용자 생성 또는 업데이트
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
    )
    ON CONFLICT (username) 
    DO UPDATE SET 
        referrer_id = system_admin_id,
        status = 'active',
        updated_at = now();
    
    RAISE NOTICE '✅ smcdev11 사용자 업데이트 완료 (추천인: 시스템관리자)';
    RAISE NOTICE '=====================================';
END $$;

-- 2. get_user_opcode_info 함수 개선 (PGRST116 오류 방지)
CREATE OR REPLACE FUNCTION get_user_opcode_info(user_id UUID)
RETURNS JSON AS $$
DECLARE
    current_partner_id UUID;
    partner_record partners%ROWTYPE;
    user_record users%ROWTYPE;
    debug_path TEXT[] := ARRAY[]::TEXT[];
    search_depth INTEGER := 0;
    max_depth INTEGER := 10;
    result JSON;
BEGIN
    -- 사용자 정보 조회
    SELECT * INTO user_record
    FROM users
    WHERE id = user_id;
    
    IF user_record.id IS NULL THEN
        result := json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.',
            'user_id', user_id
        );
        RETURN result;
    END IF;
    
    debug_path := array_append(debug_path, 
        format('사용자: %s (ID: %s)', user_record.username, user_record.id)
    );
    
    current_partner_id := user_record.referrer_id;
    
    IF current_partner_id IS NULL THEN
        result := json_build_object(
            'success', false,
            'error', '사용자의 추천인 정보가 없습니다.',
            'user_info', json_build_object(
                'username', user_record.username,
                'id', user_record.id,
                'referrer_id', current_partner_id
            ),
            'debug_path', debug_path
        );
        RETURN result;
    END IF;
    
    -- 파트너 계층을 따라 올라가며 OPCODE를 가진 파트너 찾기
    WHILE current_partner_id IS NOT NULL AND search_depth < max_depth LOOP
        search_depth := search_depth + 1;
        
        SELECT * INTO partner_record
        FROM partners
        WHERE id = current_partner_id;
        
        IF partner_record.id IS NULL THEN
            debug_path := array_append(debug_path, 
                format('❌ 파트너 ID %s를 찾을 수 없음', current_partner_id)
            );
            EXIT;
        END IF;
        
        debug_path := array_append(debug_path, 
            format('파트너: %s (Level %s, Type: %s, Status: %s)', 
                partner_record.nickname, 
                partner_record.level, 
                partner_record.partner_type,
                partner_record.status
            )
        );
        
        IF partner_record.status != 'active' THEN
            debug_path := array_append(debug_path, 
                format('⚠️ 파트너 %s가 비활성화 상태', partner_record.nickname)
            );
            current_partner_id := partner_record.parent_id;
            CONTINUE;
        END IF;
        
        -- OPCODE가 있는 파트너인지 확인 (시스템관리자 또는 대본사)
        IF (partner_record.level = 1 AND partner_record.partner_type = 'system_admin') 
           OR (partner_record.level = 2 AND partner_record.partner_type = 'head_office') THEN
            
            debug_path := array_append(debug_path, 
                format('🎯 OPCODE 보유 파트너 발견: %s (Level %s)', 
                    partner_record.nickname, partner_record.level)
            );
            
            IF partner_record.opcode IS NOT NULL 
               AND partner_record.secret_key IS NOT NULL 
               AND partner_record.api_token IS NOT NULL THEN
               
                debug_path := array_append(debug_path, '✅ OPCODE 정보 완전함');
                
                result := json_build_object(
                    'success', true,
                    'opcode', partner_record.opcode,
                    'secret_key', partner_record.secret_key,
                    'api_token', partner_record.api_token,
                    'partner_id', partner_record.id,
                    'partner_name', partner_record.nickname,
                    'partner_level', partner_record.level,
                    'partner_type', partner_record.partner_type,
                    'debug_path', debug_path
                );
                RETURN result;
            ELSE
                debug_path := array_append(debug_path, 
                    format('❌ OPCODE 정보 불완전 - OPCODE: %s, SECRET_KEY: %s, API_TOKEN: %s', 
                        CASE WHEN partner_record.opcode IS NULL THEN 'NULL' ELSE '있음' END,
                        CASE WHEN partner_record.secret_key IS NULL THEN 'NULL' ELSE '있음' END,
                        CASE WHEN partner_record.api_token IS NULL THEN 'NULL' ELSE '있음' END
                    )
                );
            END IF;
        END IF;
        
        current_partner_id := partner_record.parent_id;
    END LOOP;
    
    IF search_depth >= max_depth THEN
        debug_path := array_append(debug_path, 
            format('❌ 최대 검색 깊이(%s) 도달', max_depth)
        );
    END IF;
    
    result := json_build_object(
        'success', false,
        'error', '연결된 시스템관리자 또는 대본사의 OPCODE 정보를 찾을 수 없습니다.',
        'user_info', json_build_object(
            'username', user_record.username,
            'id', user_record.id,
            'referrer_id', user_record.referrer_id
        ),
        'debug_path', debug_path,
        'search_depth', search_depth
    );
    RETURN result;
    
EXCEPTION
    WHEN OTHERS THEN
        result := json_build_object(
            'success', false,
            'error', format('OPCODE 조회 중 오류 발생: %s', SQLERRM),
            'debug_path', debug_path,
            'search_depth', search_depth
        );
        RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 즉시 테스트 실행
DO $$
DECLARE
    test_result JSON;
    smcdev11_user_id UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '🧪 PGRST116 오류 해결 테스트';
    RAISE NOTICE '==================================================';
    
    -- smcdev11 사용자 ID 조회
    SELECT id INTO smcdev11_user_id
    FROM users
    WHERE username = 'smcdev11';
    
    IF smcdev11_user_id IS NOT NULL THEN
        -- OPCODE 조회 함수 테스트
        SELECT get_user_opcode_info(smcdev11_user_id) INTO test_result;
        
        RAISE NOTICE '';
        RAISE NOTICE '👤 사용자: smcdev11 (ID: %)', smcdev11_user_id;
        RAISE NOTICE '📋 결과: %', test_result::text;
        RAISE NOTICE '';
        
        -- 성공 여부 확인
        IF (test_result->>'success')::boolean = true THEN
            RAISE NOTICE '✅ 성공! API 정보:';
            RAISE NOTICE '   - OPCODE: %', test_result->>'opcode';
            RAISE NOTICE '   - SECRET_KEY: %', test_result->>'secret_key';
            RAISE NOTICE '   - API_TOKEN: %', test_result->>'api_token';
            RAISE NOTICE '   - 파트너: %', test_result->>'partner_name';
            RAISE NOTICE '   - 레벨: %', test_result->>'partner_level';
        ELSE
            RAISE NOTICE '❌ 실패: %', test_result->>'error';
            
            -- 디버그 정보 출력
            IF test_result ? 'debug_path' THEN
                RAISE NOTICE '🔍 디버그 경로:';
                FOR i IN 0..json_array_length(test_result->'debug_path')-1 LOOP
                    RAISE NOTICE '   %', test_result->'debug_path'->>i;
                END LOOP;
            END IF;
        END IF;
    ELSE
        RAISE NOTICE '❌ smcdev11 사용자를 찾을 수 없습니다.';
    END IF;
    
    RAISE NOTICE '==================================================';
END $$;