-- 사용자의 상위 파트너 OPCODE 정보 조회 함수
CREATE OR REPLACE FUNCTION get_user_partner_opcode(username_param TEXT)
RETURNS JSON AS $$
DECLARE
    result_data JSON;
    user_record RECORD;
    partner_record RECORD;
BEGIN
    -- 사용자 정보 조회
    SELECT * INTO user_record
    FROM users 
    WHERE username = username_param;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.'
        );
    END IF;
    
    -- 상위 파트너의 OPCODE 정보 조회
    SELECT opcode, secret_key, token INTO partner_record
    FROM partners 
    WHERE id = user_record.referrer_id
    AND opcode IS NOT NULL 
    AND secret_key IS NOT NULL;
    
    IF NOT FOUND THEN
        -- 상위 파트너가 없거나 OPCODE가 없는 경우 시스템 기본값 반환
        RETURN json_build_object(
            'success', true,
            'data', json_build_object(
                'opcode', 'eeo2211',
                'secret_key', 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
                'token', '153b28230ef1c40c11ff526e9da93e2b'
            )
        );
    END IF;
    
    -- OPCODE 정보 반환
    RETURN json_build_object(
        'success', true,
        'data', json_build_object(
            'opcode', partner_record.opcode,
            'secret_key', partner_record.secret_key,
            'token', partner_record.token
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '파트너 OPCODE 조회 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 사용자 잔고 동기화 함수
CREATE OR REPLACE FUNCTION sync_user_balance(
    username_param TEXT,
    real_balance NUMERIC
)
RETURNS JSON AS $$
DECLARE
    updated_rows INTEGER;
BEGIN
    -- 사용자 잔고 업데이트
    UPDATE users 
    SET 
        balance = real_balance,
        updated_at = NOW()
    WHERE username = username_param;
    
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    
    IF updated_rows = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.'
        );
    END IF;
    
    -- 잔고 변경 로그 기록
    INSERT INTO user_balance_logs (
        user_id,
        amount,
        balance_before,
        balance_after,
        transaction_type,
        description,
        created_at
    )
    SELECT 
        u.id,
        real_balance - u.balance,
        u.balance,
        real_balance,
        'api_sync',
        'API 잔고 동기화',
        NOW()
    FROM users u
    WHERE u.username = username_param;
    
    RETURN json_build_object(
        'success', true,
        'message', '잔고가 성공적으로 동기화되었습니다.',
        'data', json_build_object(
            'username', username_param,
            'new_balance', real_balance
        )
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '잔고 동기화 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- user_balance_logs 테이블이 없는 경우 생성
CREATE TABLE IF NOT EXISTS user_balance_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    balance_before NUMERIC(15,2) NOT NULL,
    balance_after NUMERIC(15,2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_balance_logs_user_id ON user_balance_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_balance_logs_created_at ON user_balance_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_user_balance_logs_transaction_type ON user_balance_logs(transaction_type);