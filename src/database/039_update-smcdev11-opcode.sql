-- ============================================================================
-- 045. smcdev11 계정에 시스템 관리자 OPCODE 설정
-- ============================================================================
-- 작성일: 2025-10-02
-- 목적: smcdev11 계정을 시스템 관리자로 설정
-- ============================================================================

-- smcdev11 계정 업데이트
UPDATE partners
SET 
    opcode = 'eeo2211',
    secret_key = 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
    api_token = '153b28230ef1c40c11ff526e9da93e2b',
    level = 1,
    updated_at = NOW()
WHERE username = 'smcdev11';

-- 확인
DO $$
DECLARE
    updated_count INTEGER;
    partner_info RECORD;
BEGIN
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    IF updated_count = 0 THEN
        RAISE NOTICE '⚠️ smcdev11 계정을 찾을 수 없습니다. 계정 생성이 필요합니다.';
    ELSE
        -- 업데이트된 정보 조회
        SELECT username, opcode, level, api_token
        INTO partner_info
        FROM partners
        WHERE username = 'smcdev11';
        
        RAISE NOTICE '============================================';
        RAISE NOTICE '✅ smcdev11 계정 업데이트 완료';
        RAISE NOTICE '============================================';
        RAISE NOTICE 'Username: %', partner_info.username;
        RAISE NOTICE 'OPCODE: %', partner_info.opcode;
        RAISE NOTICE 'Level: %', partner_info.level;
        RAISE NOTICE 'Token: %', partner_info.api_token;
        RAISE NOTICE '============================================';
    END IF;
END $$;
