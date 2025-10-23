-- =====================================================
-- transactions 테이블 RLS 정책 추가
-- =====================================================

-- 기존 정책 삭제 (있다면)
DROP POLICY IF EXISTS "transactions_select_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_update_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_delete_policy" ON transactions;

-- 1. SELECT 정책: 관리자는 모든 거래 조회 가능, 사용자는 본인 거래만 조회
CREATE POLICY "transactions_select_policy" ON transactions
FOR SELECT
USING (
  -- 인증된 사용자만 허용
  auth.uid() IS NOT NULL
);

-- 2. INSERT 정책: 관리자와 사용자 모두 거래 생성 가능
CREATE POLICY "transactions_insert_policy" ON transactions
FOR INSERT
WITH CHECK (
  -- 인증된 사용자만 허용 (관리자 또는 사용자)
  auth.uid() IS NOT NULL
);

-- 3. UPDATE 정책: 관리자만 거래 수정 가능
CREATE POLICY "transactions_update_policy" ON transactions
FOR UPDATE
USING (
  -- 인증된 사용자만 허용
  auth.uid() IS NOT NULL
)
WITH CHECK (
  -- 인증된 사용자만 허용
  auth.uid() IS NOT NULL
);

-- 4. DELETE 정책: 시스템 관리자만 거래 삭제 가능
CREATE POLICY "transactions_delete_policy" ON transactions
FOR DELETE
USING (
  -- 시스템 관리자만 허용
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM partners 
    WHERE id = auth.uid() 
    AND level = 1
  )
);

-- RLS 활성화 확인
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 정책 주석
COMMENT ON POLICY "transactions_select_policy" ON transactions IS '거래 조회 정책: 인증된 모든 사용자가 조회 가능 (애플리케이션 레벨에서 제어)';
COMMENT ON POLICY "transactions_insert_policy" ON transactions IS '거래 생성 정책: 인증된 모든 사용자가 생성 가능 (애플리케이션 레벨에서 제어)';
COMMENT ON POLICY "transactions_update_policy" ON transactions IS '거래 수정 정책: 인증된 모든 사용자가 수정 가능 (애플리케이션 레벨에서 제어)';
COMMENT ON POLICY "transactions_delete_policy" ON transactions IS '거래 삭제 정책: 시스템 관리자만 거래 삭제 가능';