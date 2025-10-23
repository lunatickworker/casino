-- transactions 테이블의 partner_id를 NULL 허용으로 변경
-- 사용자가 입금/출금 신청 시 referrer_id가 없는 경우를 대비

-- 1. partner_id를 NULL 허용으로 변경
DO $$
BEGIN
    ALTER TABLE transactions 
    ALTER COLUMN partner_id DROP NOT NULL;
    
    RAISE NOTICE '✓ transactions.partner_id 컬럼 NULL 허용으로 변경 완료';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠ partner_id 컬럼 변경 중 오류: %', SQLERRM;
END $$;

-- 2. 기존 잘못된 partner_id 값들을 NULL로 업데이트
DO $$
DECLARE
    updated_count int;
BEGIN
    UPDATE transactions
    SET partner_id = NULL
    WHERE partner_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM partners WHERE id = transactions.partner_id
      );
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '✓ 잘못된 partner_id 값 % 건 NULL로 업데이트 완료', updated_count;
END $$;

-- 3. 상태 확인
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('partner_id', 'processed_by')
ORDER BY column_name;