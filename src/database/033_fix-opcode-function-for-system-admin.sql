-- get_user_opcode_info 함수를 수정하여 시스템 관리자의 OPCODE도 인식하도록 개선

CREATE OR REPLACE FUNCTION get_user_opcode_info(user_id UUID)
RETURNS JSON AS $$
DECLARE
    current_partner_id UUID;
    partner_record partners%ROWTYPE;
    user_record users%ROWTYPE;
    debug_path TEXT[] := ARRAY[]::TEXT[];
    search_depth INTEGER := 0;
    max_depth INTEGER := 10; -- 무한루프 방지
BEGIN
    -- 사용자 정보 조회
    SELECT * INTO user_record
    FROM users
    WHERE id = user_id;
    
    IF user_record.id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.',
            'user_id', user_id
        );
    END IF;
    
    -- 디버그 정보에 사용자 추가
    debug_path := array_append(debug_path, 
        format('사용자: %s (ID: %s)', user_record.username, user_record.id)
    );
    
    -- 사용자의 추천인(파트너) ID 가져오기
    current_partner_id := user_record.referrer_id;
    
    IF current_partner_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자의 추천인 정보가 없습니다.',
            'user_info', json_build_object(
                'username', user_record.username,
                'id', user_record.id,
                'referrer_id', current_partner_id
            ),
            'debug_path', debug_path
        );
    END IF;
    
    -- 파트너 계층을 따라 올라가며 OPCODE를 가진 파트너 찾기
    WHILE current_partner_id IS NOT NULL AND search_depth < max_depth LOOP
        search_depth := search_depth + 1;
        
        SELECT * INTO partner_record
        FROM partners
        WHERE id = current_partner_id;
        
        -- 파트너가 존재하지 않으면 종료
        IF partner_record.id IS NULL THEN
            debug_path := array_append(debug_path, 
                format('❌ 파트너 ID %s를 찾을 수 없음', current_partner_id)
            );
            EXIT;
        END IF;
        
        -- 디버그 정보에 파트너 추가
        debug_path := array_append(debug_path, 
            format('파트너: %s (Level %s, Type: %s, Status: %s)', 
                partner_record.nickname, 
                partner_record.level, 
                partner_record.partner_type,
                partner_record.status
            )
        );
        
        -- 파트너가 비활성화 상태면 계속 탐색
        IF partner_record.status != 'active' THEN
            debug_path := array_append(debug_path, 
                format('⚠️ 파트너 %s가 비활성화 상태', partner_record.nickname)
            );
            current_partner_id := partner_record.parent_id;
            CONTINUE;
        END IF;
        
        -- OPCODE가 있는 파트너인지 확인 (시스템관리자 level=1 또는 대본사 level=2)
        IF (partner_record.level = 1 AND partner_record.partner_type = 'system_admin') 
           OR (partner_record.level = 2 AND partner_record.partner_type = 'head_office') THEN
            
            debug_path := array_append(debug_path, 
                format('🎯 OPCODE 보유 파트너 발견: %s (Level %s)', 
                    partner_record.nickname, partner_record.level)
            );
            
            -- OPCODE 정보가 완전한지 확인
            IF partner_record.opcode IS NOT NULL 
               AND partner_record.secret_key IS NOT NULL 
               AND partner_record.api_token IS NOT NULL THEN
               
                debug_path := array_append(debug_path, 
                    '✅ OPCODE 정보 완전함'
                );
                
                RETURN json_build_object(
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
        
        -- 상위 파트너로 이동
        current_partner_id := partner_record.parent_id;
    END LOOP;
    
    -- 최대 깊이 도달 체크
    IF search_depth >= max_depth THEN
        debug_path := array_append(debug_path, 
            format('❌ 최대 검색 깊이(%s) 도달', max_depth)
        );
    END IF;
    
    -- OPCODE를 찾지 못한 경우
    RETURN json_build_object(
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
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', format('OPCODE 조회 중 오류 발생: %s', SQLERRM),
            'debug_path', debug_path,
            'search_depth', search_depth
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 즉시 테스트 실행
DO $$
DECLARE
    test_result JSON;
    smcdev11_user_id UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '🧪 수정된 OPCODE 조회 테스트 (시스템관리자 포함)';
    RAISE NOTICE '==================================================';
    
    -- smcdev11 사용자 ID 조회
    SELECT id INTO smcdev11_user_id
    FROM users
    WHERE username = 'smcdev11';
    
    IF smcdev11_user_id IS NOT NULL THEN
        -- OPCODE 조회 함수 테스트
        SELECT get_user_opcode_info(smcdev11_user_id) INTO test_result;
        
        RAISE NOTICE '';
        RAISE NOTICE '👤 사용자: smcdev11';
        RAISE NOTICE '📋 결과: %', test_result::text;
        RAISE NOTICE '';
        
        -- 성공 여부 확인
        IF (test_result->>'success')::boolean = true THEN
            RAISE NOTICE '✅ 성공! OPCODE: %', test_result->>'opcode';
            RAISE NOTICE '    파트너: %', test_result->>'partner_name';
            RAISE NOTICE '    레벨: %', test_result->>'partner_level';
        ELSE
            RAISE NOTICE '❌ 실패: %', test_result->>'error';
        END IF;
    ELSE
        RAISE NOTICE '❌ smcdev11 사용자를 찾을 수 없습니다.';
    END IF;
    
    RAISE NOTICE '==================================================';
END $$;