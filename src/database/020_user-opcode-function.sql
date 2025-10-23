-- 사용자의 OPCODE 정보를 가져오는 함수
-- 사용자 → 매장 → 총판 → 부본사 → 본사 → 대본사 순으로 올라가며 OPCODE 찾기

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
    
    -- 파트너 계층을 따라 올라가며 OPCODE를 가진 대본사 찾기
    WHILE current_partner_id IS NOT NULL LOOP
        SELECT * INTO partner_record
        FROM partners
        WHERE id = current_partner_id
        AND status = 'active';
        
        -- 파트너가 존재하지 않으면 종료
        IF partner_record.id IS NULL THEN
            EXIT;
        END IF;
        
        -- OPCODE가 있으면 (대본사 level = 2) 반환
        IF partner_record.opcode IS NOT NULL 
           AND partner_record.secret_key IS NOT NULL 
           AND partner_record.level = 2 THEN
            
            RETURN json_build_object(
                'success', true,
                'opcode', partner_record.opcode,
                'secret_key', partner_record.secret_key,
                'api_token', partner_record.api_token,
                'partner_id', partner_record.id,
                'partner_name', partner_record.nickname
            );
        END IF;
        
        -- 상위 파트너로 이동
        current_partner_id := partner_record.parent_id;
    END LOOP;
    
    -- OPCODE를 찾지 못한 경우
    RETURN json_build_object(
        'success', false,
        'error', '연결된 대본사의 OPCODE 정보를 찾을 수 없습니다.'
    );
END;
$$ LANGUAGE plpgsql;

-- 테스트용 샘플 데이터 추가 (옵션)
DO $$
BEGIN
    -- 시스템 관리자가 없으면 생성
    IF NOT EXISTS (SELECT 1 FROM partners WHERE username = 'sadmin') THEN
        INSERT INTO partners (
            username, nickname, password_hash, partner_type, level, status
        ) VALUES (
            'sadmin', '시스템관리자', 'sadmin123!', 'system_admin', 1, 'active'
        );
        RAISE NOTICE '✓ 시스템 관리자 계정 생성됨 (sadmin/sadmin123!)';
    END IF;
    
    -- 테스트용 대본사가 없으면 생성
    IF NOT EXISTS (SELECT 1 FROM partners WHERE partner_type = 'head_office' AND opcode IS NOT NULL) THEN
        INSERT INTO partners (
            username, nickname, password_hash, partner_type, level, status,
            opcode, secret_key, api_token,
            parent_id
        ) 
        SELECT 
            'test_head_office', '테스트대본사', 'test123!', 'head_office', 2, 'active',
            'TEST_OPCODE_001', 'TEST_SECRET_KEY_001', 'TEST_API_TOKEN_001',
            id
        FROM partners 
        WHERE username = 'sadmin'
        LIMIT 1;
        
        RAISE NOTICE '✓ 테스트 대본사 계정 생성됨 (OPCODE: TEST_OPCODE_001)';
    END IF;
    
    -- 테스트용 사용자가 없으면 생성
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'testuser') THEN
        INSERT INTO users (
            username, nickname, password_hash, status,
            referrer_id, balance, points
        )
        SELECT 
            'testuser', '테스트사용자', 'test123!', 'active',
            id, 100000, 5000
        FROM partners 
        WHERE username = 'test_head_office'
        LIMIT 1;
        
        RAISE NOTICE '✓ 테스트 사용자 계정 생성됨 (testuser/test123!)';
    END IF;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '🔧 OPCODE 조회 함수 생성 완료!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '✅ get_user_opcode_info() 함수 생성';
    RAISE NOTICE '✅ 테스트 계정 생성 (필요시)';
    RAISE NOTICE '';
    RAISE NOTICE '📝 사용법:';
    RAISE NOTICE '   SELECT get_user_opcode_info(''사용자UUID'');';
    RAISE NOTICE '';
    RAISE NOTICE '🧪 테스트 계정:';
    RAISE NOTICE '   관리자: sadmin / sadmin123!';
    RAISE NOTICE '   사용자: testuser / test123!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
END $$;