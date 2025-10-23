-- =====================================================
-- transactions 테이블 processed_by 컬럼 추가 및 관련 수정
-- =====================================================

-- 1. transactions 테이블에 processed_by 컬럼 추가
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES partners(id);

-- 2. transactions 테이블에 external_transaction_id 컬럼 추가 (외부 API 거래 ID)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_transaction_id VARCHAR(255);

-- 3. 기존 데이터의 processed_by를 partner_id와 동일하게 설정
UPDATE transactions 
SET processed_by = partner_id 
WHERE processed_by IS NULL AND partner_id IS NOT NULL;

-- 4. 회원가입 함수 업데이트 (거래 기록 저장 시 processed_by 사용)
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

-- 5. 트리거 함수 생성 (transactions 테이블 updated_at 자동 업데이트)
CREATE OR REPLACE FUNCTION update_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 6. 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_transactions_updated_at ON transactions;
CREATE TRIGGER trigger_update_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_transactions_updated_at();

-- 7. 컬럼 코멘트 추가
COMMENT ON COLUMN transactions.processed_by IS '거래를 처리한 파트너 ID';
COMMENT ON COLUMN transactions.external_transaction_id IS '외부 API 거래 ID';
COMMENT ON COLUMN transactions.partner_id IS '연관된 파트너 ID (추천인 등)';

-- 8. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_transactions_processed_by ON transactions(processed_by);
CREATE INDEX IF NOT EXISTS idx_transactions_external_transaction_id ON transactions(external_transaction_id);