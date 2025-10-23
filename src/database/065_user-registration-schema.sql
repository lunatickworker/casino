-- =====================================================
-- 사용자 회원가입을 위한 스키마 추가
-- =====================================================

-- 1. users 테이블에 필요한 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- 2. 은행 목록 테이블 생성
CREATE TABLE IF NOT EXISTS banks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) UNIQUE NOT NULL,
    bank_name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 은행 목록 초기 데이터
INSERT INTO banks (bank_code, bank_name) VALUES
('001', 'KB국민은행'),
('002', '신한은행'),
('003', '우리은행'),
('004', 'KEB하나은행'),
('005', '기업은행'),
('006', '농협은행'),
('007', '수협은행'),
('008', '부산은행'),
('009', '대구은행'),
('010', '경남은행'),
('011', '광주은행'),
('012', '전북은행'),
('013', '제주은행'),
('014', '카카오뱅크'),
('015', '토스뱅크'),
('016', 'SC제일은행'),
('017', '씨티은행'),
('018', '새마을금고'),
('019', '신협'),
('020', '우체국')
('021', '케이뱅크')
ON CONFLICT (bank_code) DO NOTHING;

-- 4. 사용자 회원가입 함수
CREATE OR REPLACE FUNCTION register_user(
    p_username VARCHAR(50),
    p_nickname VARCHAR(50),
    p_password VARCHAR(255),
    p_email VARCHAR(255) DEFAULT NULL,
    p_phone VARCHAR(20) DEFAULT NULL,
    p_bank_name VARCHAR(50) DEFAULT NULL,
    p_bank_account VARCHAR(50) DEFAULT NULL,
    p_bank_holder VARCHAR(50) DEFAULT NULL,
    p_referrer_username VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    user_id UUID
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_referrer_id UUID := NULL;
    v_password_hash TEXT;
BEGIN
    -- 입력값 검증
    IF p_username IS NULL OR LENGTH(TRIM(p_username)) = 0 THEN
        RETURN QUERY SELECT FALSE, '아이디를 입력해주세요.'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    
    IF p_nickname IS NULL OR LENGTH(TRIM(p_nickname)) = 0 THEN
        RETURN QUERY SELECT FALSE, '닉네임을 입력해주세요.'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    
    IF p_password IS NULL OR LENGTH(p_password) < 4 THEN
        RETURN QUERY SELECT FALSE, '비밀번호는 최소 4자 이상이어야 합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 아이디 중복 체크
    IF EXISTS (SELECT 1 FROM users WHERE username = TRIM(p_username)) THEN
        RETURN QUERY SELECT FALSE, '이미 사용중인 아이디입니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    
    -- 닉네임 중복 체크
    IF EXISTS (SELECT 1 FROM users WHERE nickname = TRIM(p_nickname)) THEN
        RETURN QUERY SELECT FALSE, '이미 사용중인 닉네임입니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    
    -- 추천인 확인 (파트너 테이블에서 검색)
    IF p_referrer_username IS NOT NULL AND LENGTH(TRIM(p_referrer_username)) > 0 THEN
        SELECT id INTO v_referrer_id 
        FROM partners 
        WHERE username = TRIM(p_referrer_username) AND status = 'active';
        
        IF v_referrer_id IS NULL THEN
            RETURN QUERY SELECT FALSE, '존재하지 않는 추천인입니다.'::TEXT, NULL::UUID;
            RETURN;
        END IF;
    ELSE
        RETURN QUERY SELECT FALSE, '추천인을 입력해주세요.'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    
    -- 비밀번호 해시 생성 (단순 MD5 사용)
    v_password_hash := MD5(p_password);
    
    -- 사용자 생성
    INSERT INTO users (
        username,
        nickname,
        password_hash,
        email,
        phone,
        bank_name,
        bank_account,
        bank_holder,
        referrer_id,
        status
    ) VALUES (
        TRIM(p_username),
        TRIM(p_nickname),
        v_password_hash,
        TRIM(p_email),
        TRIM(p_phone),
        TRIM(p_bank_name),
        TRIM(p_bank_account),
        TRIM(p_bank_holder),
        v_referrer_id,
        'active'  -- 즉시 활성화
    ) RETURNING id INTO v_user_id;
    
    -- 활동 로그 기록
    INSERT INTO activity_logs (
        actor_type,
        actor_id,
        action,
        details
    ) VALUES (
        'user',
        v_user_id,
        'register',
        jsonb_build_object(
            'username', TRIM(p_username),
            'nickname', TRIM(p_nickname),
            'referrer_username', p_referrer_username,
            'registration_time', NOW()
        )
    );
    
    RETURN QUERY SELECT TRUE, '회원가입이 완료되었습니다.'::TEXT, v_user_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT FALSE, ('회원가입 중 오류가 발생했습니다: ' || SQLERRM)::TEXT, NULL::UUID;
END;
$$;

-- 5. 닉네임 중복 체크 함수 (TEXT 타입 사용으로 오버로딩 에러 방지)
DROP FUNCTION IF EXISTS check_nickname_available(VARCHAR);
DROP FUNCTION IF EXISTS check_nickname_available(TEXT);
DROP FUNCTION IF EXISTS check_nickname_available(character varying);

CREATE OR REPLACE FUNCTION check_nickname_available(
    p_nickname TEXT
)
RETURNS TABLE (
    available BOOLEAN,
    message TEXT
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $
BEGIN
    IF p_nickname IS NULL OR LENGTH(TRIM(p_nickname)) = 0 THEN
        RETURN QUERY SELECT FALSE, '닉네임을 입력해주세요.'::TEXT;
        RETURN;
    END IF;
    
    IF EXISTS (SELECT 1 FROM users WHERE nickname = TRIM(p_nickname)) THEN
        RETURN QUERY SELECT FALSE, '이미 사용중인 닉네임입니다.'::TEXT;
    ELSE
        RETURN QUERY SELECT TRUE, '사용 가능한 닉네임입니다.'::TEXT;
    END IF;
END;
$;

-- 6. RLS 정책 추가
ALTER TABLE banks ENABLE ROW LEVEL SECURITY;

-- 은행 목록은 모든 사용자가 조회 가능
CREATE POLICY "Banks are viewable by everyone" ON banks
    FOR SELECT USING (true);