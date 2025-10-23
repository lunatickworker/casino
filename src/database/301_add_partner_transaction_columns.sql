-- =====================================================
-- 파트너 간 입출금 추적을 위한 컬럼 추가 및 정리
-- =====================================================
-- 불필요한 컬럼 삭제 및 필요한 컬럼만 추가

-- 1. 불필요한 컬럼 삭제
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS change_type;
ALTER TABLE partner_balance_logs DROP COLUMN IF EXISTS description;

-- 2. from_partner_id 컬럼 추가 (송금 파트너)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS from_partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

-- 3. to_partner_id 컬럼 추가 (수신 파트너)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS to_partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

-- 4. processed_by 컬럼 추가 (처리한 관리자)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES partners(id) ON DELETE SET NULL;

-- 5. transaction_type 컬럼 추가 (거래 유형)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(50) DEFAULT 'admin_adjustment';

-- 6. memo 컬럼 추가 (거래 메모)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS memo TEXT;

-- 7. amount 컬럼 추가 (기존 change_amount를 복사)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS amount DECIMAL(20,2);

-- 8. balance_before 컬럼 추가 (기존 old_balance를 복사)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS balance_before DECIMAL(20,2);

-- 9. balance_after 컬럼 추가 (기존 new_balance를 복사)
ALTER TABLE partner_balance_logs 
ADD COLUMN IF NOT EXISTS balance_after DECIMAL(20,2);

-- 10. 기존 데이터 복사 (기존 컬럼 값을 새 컬럼으로)
UPDATE partner_balance_logs
SET 
    amount = COALESCE(amount, change_amount),
    balance_before = COALESCE(balance_before, old_balance),
    balance_after = COALESCE(balance_after, new_balance)
WHERE amount IS NULL OR balance_before IS NULL OR balance_after IS NULL;

-- 11. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_from_partner ON partner_balance_logs(from_partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_to_partner ON partner_balance_logs(to_partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_processed_by ON partner_balance_logs(processed_by);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_transaction_type ON partner_balance_logs(transaction_type);

-- 12. transaction_type CHECK 제약 조건
DO $
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'partner_balance_logs_transaction_type_check'
    ) THEN
        ALTER TABLE partner_balance_logs
        ADD CONSTRAINT partner_balance_logs_transaction_type_check 
        CHECK (transaction_type IN ('deposit', 'withdrawal', 'admin_adjustment', 'commission', 'refund'));
    END IF;
END $;

-- 13. 컬럼 코멘트
COMMENT ON COLUMN partner_balance_logs.from_partner_id IS '송금 파트너 ID';
COMMENT ON COLUMN partner_balance_logs.to_partner_id IS '수신 파트너 ID';
COMMENT ON COLUMN partner_balance_logs.processed_by IS '처리한 관리자 ID';
COMMENT ON COLUMN partner_balance_logs.transaction_type IS 'deposit/withdrawal/admin_adjustment/commission/refund';
COMMENT ON COLUMN partner_balance_logs.memo IS '거래 메모';
COMMENT ON COLUMN partner_balance_logs.amount IS '거래 금액';
COMMENT ON COLUMN partner_balance_logs.balance_before IS '이전 잔고';
COMMENT ON COLUMN partner_balance_logs.balance_after IS '이후 잔고';

-- 14. 완료
DO $
BEGIN
    RAISE NOTICE '✅ partner_balance_logs 테이블 업데이트 완료';
    RAISE NOTICE '   삭제: change_type, description';
    RAISE NOTICE '   추가: from_partner_id, to_partner_id, processed_by, transaction_type, memo, amount, balance_before, balance_after';
END $;
