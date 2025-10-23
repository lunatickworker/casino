-- ============================================================================
-- 059. API 설정 동기화 (관리자 테스터 ↔ 데이터베이스)
-- ============================================================================
-- 작성일: 2025-10-03
-- 목적: 관리자 API 테스터 하드코딩 값과 데이터베이스 값 동기화
-- 문제: 관리자 테스터는 정상, 사용자 페이지는 signature 오류 → 설정값 불일치
-- ============================================================================

-- 1. 현재 불일치 상태 확인
DO $$
DECLARE
    db_config RECORD;
    hardcoded_opcode TEXT := 'eeo2211';
    hardcoded_secret TEXT := 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj';
    hardcoded_token TEXT := '153b28230ef1c40c11ff526e9da93e2b';
BEGIN
    SELECT opcode, secret_key, api_token 
    INTO db_config
    FROM partners 
    WHERE username = 'sadmin' AND level = 1;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔍 API 설정 불일치 확인';
    RAISE NOTICE '============================================';
    RAISE NOTICE '📋 하드코딩된 값 (관리자 테스터):';
    RAISE NOTICE '   OPCODE: %', hardcoded_opcode;
    RAISE NOTICE '   Secret Key: %***', left(hardcoded_secret, 8);
    RAISE NOTICE '   API Token: %***', left(hardcoded_token, 8);
    RAISE NOTICE '';
    RAISE NOTICE '📋 데이터베이스 값 (사용자 페이지):';
    RAISE NOTICE '   OPCODE: %', db_config.opcode;
    RAISE NOTICE '   Secret Key: %***', left(db_config.secret_key, 8);
    RAISE NOTICE '   API Token: %***', left(db_config.api_token, 8);
    RAISE NOTICE '';
    RAISE NOTICE '🔄 일치 여부:';
    RAISE NOTICE '   OPCODE: %', CASE WHEN db_config.opcode = hardcoded_opcode THEN '✅ 일치' ELSE '❌ 불일치' END;
    RAISE NOTICE '   Secret Key: %', CASE WHEN db_config.secret_key = hardcoded_secret THEN '✅ 일치' ELSE '❌ 불일치' END;
    RAISE NOTICE '   API Token: %', CASE WHEN db_config.api_token = hardcoded_token THEN '✅ 일치' ELSE '❌ 불일치' END;
    RAISE NOTICE '============================================';
END $$;

-- 2. 데이터베이스를 관리자 API 테스터와 동일한 값으로 동기화
UPDATE partners 
SET 
    opcode = 'eeo2211',
    secret_key = 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
    api_token = '153b28230ef1c40c11ff526e9da93e2b',
    updated_at = NOW()
WHERE username = 'sadmin' AND level = 1;

-- 중요: 059번 스키마 실행 후에는 관리자 API 테스터와 사용자 페이지가 동일한 설정값 사용

-- 3. 동기화 후 검증
DO $$
DECLARE
    updated_config RECORD;
    hardcoded_opcode TEXT := 'eeo2211';
    hardcoded_secret TEXT := 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj';
    hardcoded_token TEXT := '153b28230ef1c40c11ff526e9da93e2b';
    all_match BOOLEAN;
BEGIN
    SELECT opcode, secret_key, api_token 
    INTO updated_config
    FROM partners 
    WHERE username = 'sadmin' AND level = 1;
    
    all_match := (
        updated_config.opcode = hardcoded_opcode AND
        updated_config.secret_key = hardcoded_secret AND
        updated_config.api_token = hardcoded_token
    );
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ API 설정 동기화 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '📋 동기화 후 데이터베이스 값:';
    RAISE NOTICE '   OPCODE: %', updated_config.opcode;
    RAISE NOTICE '   Secret Key: %***', left(updated_config.secret_key, 8);
    RAISE NOTICE '   API Token: %***', left(updated_config.api_token, 8);
    RAISE NOTICE '';
    RAISE NOTICE '🎯 전체 일치 여부: %', CASE WHEN all_match THEN '✅ 완전 일치' ELSE '❌ 여전히 불일치' END;
    RAISE NOTICE '============================================';
END $$;

-- 4. get_user_opcode_info 함수 테스트
DO $$
DECLARE
    test_user_id UUID;
    opcode_result JSON;
BEGIN
    -- smcdev11 사용자 ID 가져오기
    SELECT id INTO test_user_id 
    FROM users 
    WHERE username = 'smcdev11';
    
    IF test_user_id IS NOT NULL THEN
        SELECT get_user_opcode_info(test_user_id) INTO opcode_result;
        
        RAISE NOTICE '============================================';
        RAISE NOTICE '🧪 get_user_opcode_info 함수 테스트';
        RAISE NOTICE '============================================';
        RAISE NOTICE '사용자: smcdev11 (ID: %)', test_user_id;
        RAISE NOTICE '결과: %', opcode_result;
        RAISE NOTICE '성공 여부: %', CASE WHEN opcode_result->>'success' = 'true' THEN '✅ 성공' ELSE '❌ 실패' END;
        
        IF opcode_result->>'success' = 'true' THEN
            RAISE NOTICE '반환된 OPCODE: %', opcode_result->>'opcode';
            RAISE NOTICE '반환된 Secret Key: %***', left(opcode_result->>'secret_key', 8);
            RAISE NOTICE '반환된 API Token: %***', left(opcode_result->>'api_token', 8);
        ELSE
            RAISE NOTICE '오류: %', opcode_result->>'error';
        END IF;
        RAISE NOTICE '============================================';
    ELSE
        RAISE WARNING '❌ smcdev11 사용자를 찾을 수 없습니다.';
    END IF;
END $$;

-- 5. 테스트용 signature 생성 확인
CREATE OR REPLACE FUNCTION test_signature_generation()
RETURNS JSON AS $$
DECLARE
    test_opcode TEXT := 'eeo2211';
    test_username TEXT := 'smcdev11';
    test_token TEXT := '153b28230ef1c40c11ff526e9da93e2b';
    test_game TEXT := '410000';
    test_secret TEXT := 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj';
    signature_input TEXT;
BEGIN
    -- Guidelines.md에 따른 signature 입력: opcode + username + token + game + secret_key
    signature_input := test_opcode || test_username || test_token || test_game || test_secret;
    
    RETURN json_build_object(
        'signature_components', json_build_object(
            'opcode', test_opcode,
            'username', test_username,
            'token', left(test_token, 8) || '***',
            'game', test_game,
            'secret_key', left(test_secret, 8) || '***'
        ),
        'signature_input_preview', left(signature_input, 50) || '...',
        'signature_input_length', length(signature_input),
        'expected_md5_input', signature_input,
        'guidelines_format', 'md5(opcode + username + token + game + secret_key)',
        'test_scenario', 'smcdev11 사용자가 에볼루션 카지노(410000) 실행'
    );
END;
$$ LANGUAGE plpgsql;

-- 권한 설정
GRANT EXECUTE ON FUNCTION test_signature_generation TO anon, authenticated;

-- 6. 최종 테스트 실행
DO $$
DECLARE
    signature_test JSON;
BEGIN
    SELECT test_signature_generation() INTO signature_test;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '🎯 Signature 생성 테스트';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Guidelines.md 형식: md5(opcode + username + token + game + secret_key)';
    RAISE NOTICE '테스트 결과: %', signature_test;
    RAISE NOTICE '============================================';
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 059. API 설정 동기화 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. 데이터베이스 API 설정을 하드코딩 값으로 동기화';
    RAISE NOTICE '2. get_user_opcode_info 함수 동작 확인';
    RAISE NOTICE '3. Signature 생성 테스트 함수 추가';
    RAISE NOTICE '============================================';
    RAISE NOTICE '📋 다음 단계:';
    RAISE NOTICE '1. 이 스키마 실행 후 사용자 페이지에서 게임 실행 재시도';
    RAISE NOTICE '2. 브라우저 콘솔에서 상세 로그 확인';
    RAISE NOTICE '3. 여전히 오류 발생 시 investApi.ts 로직 재확인';
    RAISE NOTICE '============================================';
END $$;