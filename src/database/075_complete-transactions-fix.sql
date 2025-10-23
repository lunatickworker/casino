-- transactions 테이블 완전 수정: processed_by 관련 모든 제약조건 제거 및 재설정

-- 1. 기존 모든 외래 키 제약 조건 확인 및 삭제
DO $$
DECLARE
    constraint_name text;
BEGIN
    -- transactions 테이블의 모든 외래 키 제약 조건 조회 및 삭제
    FOR constraint_name IN 
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'transactions' 
        AND tc.constraint_type = 'FOREIGN KEY'
        AND ccu.column_name = 'processed_by'
    LOOP
        EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS %I', constraint_name);
        RAISE NOTICE '✓ 외래 키 제약 조건 % 삭제 완료', constraint_name;
    END LOOP;
END $$;

-- 2. processed_by 컬럼의 기본값 제거 및 NULL 허용
DO $$
BEGIN
    -- 기본값 제거
    ALTER TABLE transactions ALTER COLUMN processed_by DROP DEFAULT;
    RAISE NOTICE '✓ processed_by 기본값 제거 완료';
    
    -- NULL 허용으로 변경
    ALTER TABLE transactions ALTER COLUMN processed_by DROP NOT NULL;
    RAISE NOTICE '✓ processed_by NULL 허용 변경 완료';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠ processed_by 컬럼 수정 중 오류: %', SQLERRM;
END $$;

-- 3. partner_id 컬럼도 동일하게 처리
DO $$
BEGIN
    -- 기본값 제거
    ALTER TABLE transactions ALTER COLUMN partner_id DROP DEFAULT;
    RAISE NOTICE '✓ partner_id 기본값 제거 완료';
    
    -- NULL 허용으로 변경
    ALTER TABLE transactions ALTER COLUMN partner_id DROP NOT NULL;
    RAISE NOTICE '✓ partner_id NULL 허용 변경 완료';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠ partner_id 컬럼 수정 중 오류: %', SQLERRM;
END $$;

-- 4. 기존 잘못된 데이터 수정
DO $$
DECLARE
    updated_count int;
BEGIN
    -- processed_by에서 존재하지 않는 partner 참조 제거
    UPDATE transactions
    SET processed_by = NULL
    WHERE processed_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM partners WHERE id = transactions.processed_by
      );
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '✓ 잘못된 processed_by 값 % 건 NULL로 수정', updated_count;

    -- partner_id에서 존재하지 않는 partner 참조 제거
    UPDATE transactions
    SET partner_id = NULL
    WHERE partner_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM partners WHERE id = transactions.partner_id
      );
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '✓ 잘못된 partner_id 값 % 건 NULL로 수정', updated_count;
END $$;

-- 5. 새로운 외래 키 제약 조건 생성 (NULL 허용)
DO $$
BEGIN
    -- processed_by 외래 키 제약 조건 (NULL 허용)
    ALTER TABLE transactions
    ADD CONSTRAINT transactions_processed_by_fkey 
    FOREIGN KEY (processed_by) 
    REFERENCES partners(id) 
    ON DELETE SET NULL
    ON UPDATE CASCADE;
    
    RAISE NOTICE '✓ processed_by 외래 키 제약 조건 재생성 완료 (NULL 허용)';

    -- partner_id 외래 키 제약 조건도 확인 (이미 있으면 건너뜀)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'transactions' 
        AND constraint_name = 'transactions_partner_id_fkey'
    ) THEN
        ALTER TABLE transactions
        ADD CONSTRAINT transactions_partner_id_fkey 
        FOREIGN KEY (partner_id) 
        REFERENCES partners(id) 
        ON DELETE SET NULL
        ON UPDATE CASCADE;
        
        RAISE NOTICE '✓ partner_id 외래 키 제약 조건 생성 완료 (NULL 허용)';
    ELSE
        RAISE NOTICE '⊘ partner_id 외래 키 제약 조건이 이미 존재함';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠ 외래 키 제약 조건 생성 중 오류: %', SQLERRM;
END $$;

-- 6. 최종 상태 확인
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    CASE 
        WHEN column_default IS NULL THEN 'NULL'
        ELSE column_default 
    END as default_value
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('processed_by', 'partner_id', 'user_id')
ORDER BY column_name;

-- 7. 제약 조건 확인
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = 'transactions' 
AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY ccu.column_name;