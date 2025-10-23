-- transactions 테이블의 processed_by 컬럼 NULL 허용 및 제약조건 수정
-- 사용자가 입금/출금 신청 시 processed_by는 NULL이어야 하고
-- 관리자가 승인/거절 시 processed_by를 업데이트

-- 1. 기존 외래 키 제약 조건 삭제 (존재하는 경우에만)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transactions_processed_by_fkey'
    ) THEN
        ALTER TABLE transactions DROP CONSTRAINT transactions_processed_by_fkey;
        RAISE NOTICE '✓ transactions_processed_by_fkey 제약 조건 삭제 완료';
    ELSE
        RAISE NOTICE '⊘ transactions_processed_by_fkey 제약 조건이 존재하지 않음';
    END IF;
END $$;

-- 2. processed_by 컬럼을 NULL 허용으로 변경
DO $$
BEGIN
    ALTER TABLE transactions 
    ALTER COLUMN processed_by DROP NOT NULL;
    
    RAISE NOTICE '✓ transactions.processed_by 컬럼 NULL 허용으로 변경 완료';
END $$;

-- 3. 외래 키 제약 조건 재생성 (NULL 허용)
DO $$
BEGIN
    ALTER TABLE transactions
    ADD CONSTRAINT transactions_processed_by_fkey 
    FOREIGN KEY (processed_by) 
    REFERENCES partners(id) 
    ON DELETE SET NULL;
    
    RAISE NOTICE '✓ transactions_processed_by_fkey 제약 조건 재생성 완료 (NULL 허용)';
END $$;

-- 4. 기존 잘못된 processed_by 값들을 NULL로 업데이트
DO $$
DECLARE
    updated_count int;
BEGIN
    UPDATE transactions
    SET processed_by = NULL
    WHERE processed_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM partners WHERE id = transactions.processed_by
      );
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '✓ 잘못된 processed_by 값 % 건 NULL로 업데이트 완료', updated_count;
END $$;

-- 5. 상태 확인
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name = 'processed_by';
