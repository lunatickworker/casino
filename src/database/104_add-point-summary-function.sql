-- 사용자 포인트 요약 정보 조회 함수
CREATE OR REPLACE FUNCTION get_user_point_summary(user_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
    total_earned BIGINT := 0;
    total_used BIGINT := 0;
    current_balance BIGINT := 0;
    last_transaction TIMESTAMP;
    transaction_count INTEGER := 0;
BEGIN
    -- 사용자 존재 확인
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = user_id_param) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not found'
        );
    END IF;

    -- 현재 포인트 잔고 조회
    SELECT points INTO current_balance 
    FROM users 
    WHERE id = user_id_param;

    -- 포인트 거래 내역 요약 조회
    SELECT 
        COALESCE(SUM(CASE WHEN transaction_type IN ('earn', 'credit') THEN amount ELSE 0 END), 0) as earned,
        COALESCE(SUM(CASE WHEN transaction_type IN ('use', 'debit') THEN amount ELSE 0 END), 0) as used,
        COUNT(*) as count,
        MAX(created_at) as last_trans
    INTO total_earned, total_used, transaction_count, last_transaction
    FROM point_transactions
    WHERE user_id = user_id_param;

    -- 결과 JSON 생성
    result := json_build_object(
        'success', true,
        'data', json_build_object(
            'user_id', user_id_param,
            'current_balance', current_balance,
            'total_earned', total_earned,
            'total_used', total_used,
            'net_points', total_earned - total_used,
            'transaction_count', transaction_count,
            'last_transaction', last_transaction,
            'calculated_at', NOW()
        )
    );

    RETURN result;

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Database error: ' || SQLERRM
        );
END;
$$;

-- 포인트 거래 테이블이 없으면 생성
CREATE TABLE IF NOT EXISTS point_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'use', 'credit', 'debit')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    balance_before BIGINT,
    balance_after BIGINT,
    description TEXT,
    processed_by UUID REFERENCES partners(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 누락된 컬럼들 추가 (존재하지 않는 경우에만)
DO $ 
BEGIN
    -- reference_type 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'point_transactions' AND column_name = 'reference_type') THEN
        ALTER TABLE point_transactions ADD COLUMN reference_type VARCHAR(50);
        COMMENT ON COLUMN point_transactions.reference_type IS 'betting, event, admin, bonus 등';
    END IF;
    
    -- reference_id 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'point_transactions' AND column_name = 'reference_id') THEN
        ALTER TABLE point_transactions ADD COLUMN reference_id UUID;
        COMMENT ON COLUMN point_transactions.reference_id IS '참조 대상 ID (게임 기록, 이벤트 등)';
    END IF;
    
    -- type 컬럼 추가 (transaction_type의 별칭으로 사용)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'point_transactions' AND column_name = 'type') THEN
        ALTER TABLE point_transactions ADD COLUMN type VARCHAR(20);
        UPDATE point_transactions SET type = transaction_type WHERE type IS NULL;
    END IF;
    
    -- memo 컬럼 추가 (description의 별칭으로 사용)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'point_transactions' AND column_name = 'memo') THEN
        ALTER TABLE point_transactions ADD COLUMN memo TEXT;
        UPDATE point_transactions SET memo = description WHERE memo IS NULL;
    END IF;
END $;

-- 포인트 거래 인덱스
CREATE INDEX IF NOT EXISTS idx_point_transactions_user_id ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_type ON point_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_point_transactions_created_at ON point_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_transactions_reference ON point_transactions(reference_type, reference_id);

-- 포인트 거래 RLS 정책
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "point_transactions_select_policy" ON point_transactions;
CREATE POLICY "point_transactions_select_policy" ON point_transactions
    FOR SELECT USING (
        auth.uid() IN (
            SELECT id FROM partners WHERE level <= 3
            UNION
            SELECT user_id
        )
    );

DROP POLICY IF EXISTS "point_transactions_insert_policy" ON point_transactions;
CREATE POLICY "point_transactions_insert_policy" ON point_transactions
    FOR INSERT WITH CHECK (
        auth.uid() IN (
            SELECT id FROM partners WHERE level <= 3
        )
    );

DROP POLICY IF EXISTS "point_transactions_update_policy" ON point_transactions;
CREATE POLICY "point_transactions_update_policy" ON point_transactions
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT id FROM partners WHERE level <= 3
        )
    );

-- 포인트 거래 트리거 함수 (사용자 포인트 잔고 자동 업데이트)
CREATE OR REPLACE FUNCTION update_user_points_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- 포인트 적립/차감에 따라 사용자 포인트 잔고 업데이트
    IF TG_OP = 'INSERT' THEN
        IF NEW.transaction_type IN ('earn', 'credit') THEN
            UPDATE users 
            SET points = points + NEW.amount,
                updated_at = NOW()
            WHERE id = NEW.user_id;
        ELSIF NEW.transaction_type IN ('use', 'debit') THEN
            UPDATE users 
            SET points = GREATEST(points - NEW.amount, 0),
                updated_at = NOW()
            WHERE id = NEW.user_id;
        END IF;
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$;

-- 포인트 거래 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_user_points ON point_transactions;
CREATE TRIGGER trigger_update_user_points
    AFTER INSERT ON point_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_points_balance();

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_user_point_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_points_balance() TO authenticated;

-- 테이블 권한 설정
GRANT SELECT, INSERT, UPDATE ON point_transactions TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;