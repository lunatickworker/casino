-- transactions 테이블 완전 디버깅 및 수정
-- processed_by 관련 모든 문제 해결

-- 1. 현재 transactions 테이블 구조 확인
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

-- 2. 현재 제약 조건 확인
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    ccu.column_name,
    tc.table_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = 'transactions' 
AND ccu.column_name IN ('processed_by', 'partner_id')
ORDER BY ccu.column_name;

-- 3. 모든 외래 키 제약 조건 완전 삭제
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    -- transactions 테이블의 모든 외래 키 제약 조건 조회 및 삭제
    FOR constraint_record IN 
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'transactions' 
        AND tc.constraint_type = 'FOREIGN KEY'
        AND ccu.column_name IN ('processed_by', 'partner_id')
    LOOP
        EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS %I', constraint_record.constraint_name);
        RAISE NOTICE '✓ 외래 키 제약 조건 % 삭제 완료', constraint_record.constraint_name;
    END LOOP;
END $$;

-- 4. 컬럼 완전 재설정
DO $$
BEGIN
    -- processed_by 컬럼 완전 재설정
    BEGIN
        ALTER TABLE transactions ALTER COLUMN processed_by DROP DEFAULT;
        RAISE NOTICE '✓ processed_by 기본값 제거 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⊘ processed_by 기본값이 없음';
    END;
    
    BEGIN
        ALTER TABLE transactions ALTER COLUMN processed_by DROP NOT NULL;
        RAISE NOTICE '✓ processed_by NULL 허용 변경 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⊘ processed_by 이미 NULL 허용';
    END;

    -- partner_id 컬럼 완전 재설정
    BEGIN
        ALTER TABLE transactions ALTER COLUMN partner_id DROP DEFAULT;
        RAISE NOTICE '✓ partner_id 기본값 제거 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⊘ partner_id 기본값이 없음';
    END;
    
    BEGIN
        ALTER TABLE transactions ALTER COLUMN partner_id DROP NOT NULL;
        RAISE NOTICE '✓ partner_id NULL 허용 변경 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⊘ partner_id 이미 NULL 허용';
    END;
END $$;

-- 5. 잘못된 기존 데이터 완전 정리
DO $$
DECLARE
    updated_count int;
    total_count int;
BEGIN
    -- 전체 레코드 수 확인
    SELECT COUNT(*) INTO total_count FROM transactions;
    RAISE NOTICE '📊 전체 transactions 레코드 수: %', total_count;

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

    -- 특정 문제값 강제 수정 (00000000-0000-0000-0000-000000000001)
    UPDATE transactions
    SET processed_by = NULL
    WHERE processed_by = '00000000-0000-0000-0000-000000000001'::uuid;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '✓ 문제 UUID(00000000-0000-0000-0000-000000000001) % 건 NULL로 수정', updated_count;

    UPDATE transactions
    SET partner_id = NULL
    WHERE partner_id = '00000000-0000-0000-0000-000000000001'::uuid;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '✓ 문제 partner_id UUID % 건 NULL로 수정', updated_count;
END $$;

-- 6. 새로운 외래 키 제약 조건 생성 (NULL 허용, 안전함)
DO $$
BEGIN
    -- processed_by 외래 키 제약 조건 (NULL 허용)
    BEGIN
        ALTER TABLE transactions
        ADD CONSTRAINT transactions_processed_by_fkey 
        FOREIGN KEY (processed_by) 
        REFERENCES partners(id) 
        ON DELETE SET NULL
        ON UPDATE CASCADE;
        
        RAISE NOTICE '✓ processed_by 외래 키 제약 조건 재생성 완료 (NULL 허용)';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠ processed_by 외래 키 제약 조건 생성 실패: %', SQLERRM;
    END;

    -- partner_id 외래 키 제약 조건 (NULL 허용)
    BEGIN
        ALTER TABLE transactions
        ADD CONSTRAINT transactions_partner_id_fkey 
        FOREIGN KEY (partner_id) 
        REFERENCES partners(id) 
        ON DELETE SET NULL
        ON UPDATE CASCADE;
        
        RAISE NOTICE '✓ partner_id 외래 키 제약 조건 재생성 완료 (NULL 허용)';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠ partner_id 외래 키 제약 조건 생성 실패: %', SQLERRM;
    END;
END $$;

-- 7. 트리거 생성: INSERT/UPDATE 시 문제 값 자동 수정
CREATE OR REPLACE FUNCTION fix_transactions_processed_by()
RETURNS TRIGGER AS $$
BEGIN
    -- processed_by가 partners 테이블에 없으면 NULL로 설정
    IF NEW.processed_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM partners WHERE id = NEW.processed_by
    ) THEN
        NEW.processed_by = NULL;
    END IF;

    -- partner_id가 partners 테이블에 없으면 NULL로 설정  
    IF NEW.partner_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM partners WHERE id = NEW.partner_id
    ) THEN
        NEW.partner_id = NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 기존 트리거 삭제 후 재생성
DROP TRIGGER IF EXISTS trigger_fix_transactions_processed_by ON transactions;
CREATE TRIGGER trigger_fix_transactions_processed_by
    BEFORE INSERT OR UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION fix_transactions_processed_by();

-- 트리거 생성 알림
DO $
BEGIN
    RAISE NOTICE '✓ 자동 수정 트리거 생성 완료';
END $;

-- 8. 최종 상태 확인
SELECT 
    '=== 최종 컬럼 상태 ===' as info;

SELECT 
    column_name,
    data_type,
    is_nullable,
    COALESCE(column_default, 'NULL') as default_value
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('processed_by', 'partner_id', 'user_id')
ORDER BY column_name;

SELECT 
    '=== 최종 제약 조건 상태 ===' as info;

SELECT 
    tc.constraint_name,
    tc.constraint_type,
    ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = 'transactions' 
AND tc.constraint_type = 'FOREIGN KEY'
AND ccu.column_name IN ('processed_by', 'partner_id')
ORDER BY ccu.column_name;

SELECT 
    '=== 문제 데이터 확인 ===' as info;

-- 남은 문제 데이터가 있는지 확인
SELECT 
    COUNT(*) as problem_processed_by_count
FROM transactions 
WHERE processed_by IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM partners WHERE id = transactions.processed_by);

SELECT 
    COUNT(*) as problem_partner_id_count
FROM transactions 
WHERE partner_id IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM partners WHERE id = transactions.partner_id);