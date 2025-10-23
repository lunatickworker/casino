-- users 테이블 누락된 컬럼 추가 (회원 정보 수정 오류 수정)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS memo TEXT;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

-- 안전한 사용자 정보 업데이트 함수
CREATE OR REPLACE FUNCTION update_user_info_safe(
    user_id_param UUID,
    nickname_param VARCHAR(50) DEFAULT NULL,
    email_param VARCHAR(100) DEFAULT NULL,
    phone_param VARCHAR(20) DEFAULT NULL,
    birth_date_param DATE DEFAULT NULL,
    bank_name_param VARCHAR(50) DEFAULT NULL,
    bank_account_param VARCHAR(50) DEFAULT NULL,
    bank_holder_param VARCHAR(50) DEFAULT NULL,
    vip_level_param INTEGER DEFAULT NULL,
    memo_param TEXT DEFAULT NULL,
    password_hash_param VARCHAR(255) DEFAULT NULL
) RETURNS JSON AS $$
BEGIN
    UPDATE users SET
        nickname = COALESCE(nickname_param, nickname),
        email = COALESCE(email_param, email),
        phone = COALESCE(phone_param, phone),
        birth_date = COALESCE(birth_date_param, birth_date),
        bank_name = COALESCE(bank_name_param, bank_name),
        bank_account = COALESCE(bank_account_param, bank_account),
        bank_holder = COALESCE(bank_holder_param, bank_holder),
        vip_level = COALESCE(vip_level_param, vip_level),
        memo = COALESCE(memo_param, memo),
        password_hash = COALESCE(password_hash_param, password_hash),
        updated_at = NOW()
    WHERE id = user_id_param;

    RETURN json_build_object('success', true, 'message', '업데이트 완료');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;