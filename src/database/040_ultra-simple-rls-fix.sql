-- ============================================================================
-- 050. smcdev11 계정 이중 설정 (관리자 + 사용자)
-- ============================================================================
-- 작성일: 2025-10-02
-- 목적: smcdev11을 시스템 관리자이면서 동시에 사용자로도 사용 가능하도록 설정
-- ============================================================================

-- 1. partners 테이블에 smcdev11 시스템 관리자 확인 및 업데이트
DO $$
DECLARE
    admin_id UUID;
    admin_info RECORD;
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '1. smcdev11 시스템 관리자 계정 확인/생성';
    RAISE NOTICE '============================================';
    
    -- 기존 smcdev11 관리자 계정 확인
    SELECT id, username, level, opcode, api_token
    INTO admin_info
    FROM partners
    WHERE username = 'smcdev11';
    
    IF admin_info.username IS NULL THEN
        -- 계정이 없으면 생성
        INSERT INTO partners (
            username,
            nickname,
            password_hash,
            partner_type,
            level,
            status,
            opcode,
            secret_key,
            api_token,
            balance
        ) VALUES (
            'smcdev11',
            '시스템관리자',
            'smcdev11!',  -- 실제 환경에서는 bcrypt 해시 사용
            'system_admin',
            1,
            'active',
            'eeo2211',
            'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
            '153b28230ef1c40c11ff526e9da93e2b',
            0
        )
        RETURNING id INTO admin_id;
        
        RAISE NOTICE '✅ smcdev11 시스템 관리자 계정 생성 완료 (ID: %)', admin_id;
    ELSE
        -- 기존 계정 업데이트
        UPDATE partners
        SET 
            level = 1,
            partner_type = 'system_admin',
            opcode = 'eeo2211',
            secret_key = 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
            api_token = '153b28230ef1c40c11ff526e9da93e2b',
            status = 'active',
            updated_at = NOW()
        WHERE username = 'smcdev11'
        RETURNING id INTO admin_id;
        
        RAISE NOTICE '✅ smcdev11 시스템 관리자 계정 업데이트 완료 (ID: %)', admin_id;
    END IF;
    
    RAISE NOTICE '  - Username: smcdev11';
    RAISE NOTICE '  - Level: 1 (시스템관리자)';
    RAISE NOTICE '  - OPCODE: eeo2211';
    RAISE NOTICE '';
END $$;

-- 2. users 테이블에 smcdev11 사용자 계정 확인 및 생성
DO $$
DECLARE
    user_id UUID;
    admin_partner_id UUID;
    user_info RECORD;
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '2. smcdev11 사용자 계정 확인/생성';
    RAISE NOTICE '============================================';
    
    -- 관리자 ID 조회
    SELECT id INTO admin_partner_id
    FROM partners
    WHERE username = 'smcdev11' AND level = 1;
    
    IF admin_partner_id IS NULL THEN
        RAISE EXCEPTION '❌ smcdev11 관리자 계정을 찾을 수 없습니다. 먼저 관리자 계정을 생성하세요.';
    END IF;
    
    -- 기존 smcdev11 사용자 계정 확인
    SELECT id, username, status, balance, external_token
    INTO user_info
    FROM users
    WHERE username = 'smcdev11';
    
    IF user_info.username IS NULL THEN
        -- 사용자 계정 생성
        INSERT INTO users (
            username,
            nickname,
            password_hash,
            status,
            balance,
            points,
            external_token,
            referrer_id,
            vip_level,
            bank_name,
            bank_account,
            bank_holder
        ) VALUES (
            'smcdev11',
            '시스템관리자',
            'smcdev11!',  -- 실제 환경에서는 bcrypt 해시 사용
            'active',
            0,
            0,
            '153b28230ef1c40c11ff526e9da93e2b',  -- 관리자와 동일한 토큰
            admin_partner_id,  -- 자기 자신을 referrer로 설정
            10,  -- VIP 최상위 레벨
            NULL,
            NULL,
            NULL
        )
        RETURNING id INTO user_id;
        
        RAISE NOTICE '✅ smcdev11 사용자 계정 생성 완료 (ID: %)', user_id;
    ELSE
        -- 기존 사용자 계정 업데이트
        UPDATE users
        SET 
            status = 'active',
            external_token = '153b28230ef1c40c11ff526e9da93e2b',
            referrer_id = admin_partner_id,
            vip_level = 10,
            updated_at = NOW()
        WHERE username = 'smcdev11'
        RETURNING id INTO user_id;
        
        RAISE NOTICE '✅ smcdev11 사용자 계정 업데이트 완료 (ID: %)', user_id;
    END IF;
    
    RAISE NOTICE '  - Username: smcdev11';
    RAISE NOTICE '  - Status: active';
    RAISE NOTICE '  - VIP Level: 10';
    RAISE NOTICE '  - Token: 153b28230ef1c40c11ff526e9da93e2b';
    RAISE NOTICE '';
END $$;

-- 3. 최종 확인
DO $$
DECLARE
    partner_rec RECORD;
    user_rec RECORD;
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '3. smcdev11 계정 최종 확인';
    RAISE NOTICE '============================================';
    
    -- 관리자 계정 확인
    SELECT username, level, partner_type, opcode, api_token, status
    INTO partner_rec
    FROM partners
    WHERE username = 'smcdev11';
    
    IF partner_rec.username IS NOT NULL THEN
        RAISE NOTICE '✅ 관리자 계정:';
        RAISE NOTICE '  - Username: %', partner_rec.username;
        RAISE NOTICE '  - Level: % (%)', partner_rec.level, partner_rec.partner_type;
        RAISE NOTICE '  - OPCODE: %', partner_rec.opcode;
        RAISE NOTICE '  - Token: %', partner_rec.api_token;
        RAISE NOTICE '  - Status: %', partner_rec.status;
    ELSE
        RAISE WARNING '❌ 관리자 계정을 찾을 수 없습니다!';
    END IF;
    
    RAISE NOTICE '';
    
    -- 사용자 계정 확인
    SELECT username, status, vip_level, external_token, referrer_id
    INTO user_rec
    FROM users
    WHERE username = 'smcdev11';
    
    IF user_rec.username IS NOT NULL THEN
        RAISE NOTICE '✅ 사용자 계정:';
        RAISE NOTICE '  - Username: %', user_rec.username;
        RAISE NOTICE '  - Status: %', user_rec.status;
        RAISE NOTICE '  - VIP Level: %', user_rec.vip_level;
        RAISE NOTICE '  - Token: %', user_rec.external_token;
        RAISE NOTICE '  - Referrer ID: %', user_rec.referrer_id;
    ELSE
        RAISE WARNING '❌ 사용자 계정을 찾을 수 없습니다!';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 050. smcdev11 이중 계정 설정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '로그인 방법:';
    RAISE NOTICE '1. 관리자 로그인: /admin 경로에서 smcdev11 / smcdev11! 입력';
    RAISE NOTICE '2. 사용자 로그인: / 경로에서 smcdev11 / smcdev11! 입력';
    RAISE NOTICE '';
END $$;
