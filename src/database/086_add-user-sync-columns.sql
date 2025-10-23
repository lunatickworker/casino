-- =====================================================
-- 사용자 동기화를 위한 컬럼 추가
-- =====================================================

-- users 테이블에 total_deposit, total_withdraw 컬럼 추가
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS total_deposit DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_withdraw DECIMAL(15,2) DEFAULT 0;

-- 컬럼 주석
COMMENT ON COLUMN users.total_deposit IS '총 입금 누적 금액';
COMMENT ON COLUMN users.total_withdraw IS '총 출금 누적 금액';

-- 기존 데이터에 대해 total_deposit, total_withdraw 계산
UPDATE users u
SET 
    total_deposit = COALESCE((
        SELECT SUM(amount)
        FROM transactions
        WHERE user_id = u.id 
        AND transaction_type = 'deposit' 
        AND status = 'approved'
    ), 0),
    total_withdraw = COALESCE((
        SELECT SUM(amount)
        FROM transactions
        WHERE user_id = u.id 
        AND transaction_type = 'withdrawal' 
        AND status = 'approved'
    ), 0)
WHERE total_deposit = 0 AND total_withdraw = 0;

-- 트리거 함수: 거래 승인 시 자동으로 total_deposit/total_withdraw 업데이트
CREATE OR REPLACE FUNCTION update_user_totals_on_transaction()
RETURNS TRIGGER AS $
BEGIN
    -- 승인된 거래만 처리
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        IF NEW.transaction_type = 'deposit' THEN
            UPDATE users
            SET total_deposit = total_deposit + NEW.amount
            WHERE id = NEW.user_id;
        ELSIF NEW.transaction_type = 'withdrawal' THEN
            UPDATE users
            SET total_withdraw = total_withdraw + NEW.amount
            WHERE id = NEW.user_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_user_totals ON transactions;
CREATE TRIGGER trigger_update_user_totals
AFTER INSERT OR UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_user_totals_on_transaction();

-- 인덱스 추가 (검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_users_total_deposit ON users(total_deposit);
CREATE INDEX IF NOT EXISTS idx_users_total_withdraw ON users(total_withdraw);
