-- 204: Add admin_deposit and admin_withdrawal to transactions table
-- 관리자 강제 입출금 타입 추가

-- transactions 테이블의 transaction_type CHECK constraint 업데이트
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;

ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check 
CHECK (transaction_type IN (
  'deposit',
  'withdrawal',
  'point_conversion',
  'admin_adjustment',
  'admin_deposit',
  'admin_withdrawal'
));

-- 기존 admin_adjustment 데이터는 그대로 유지
-- 새로운 admin_deposit, admin_withdrawal 타입 사용 가능

COMMENT ON CONSTRAINT transactions_transaction_type_check ON transactions IS 
'거래 유형 제약: deposit(사용자 입금), withdrawal(사용자 출금), admin_deposit(관리자 강제 입금), admin_withdrawal(관리자 강제 출금), point_conversion(포인트 전환), admin_adjustment(관리자 조정)';
