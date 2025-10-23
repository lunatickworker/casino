-- 거래 테이블의 balance_before/balance_after 컬럼 제약 조건 수정
-- NOT NULL 제약을 제거하여 pending 상태에서도 레코드 생성 가능하도록 함

DO $
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '🔧 거래 테이블 balance 컬럼 제약 조건 수정 시작';

    -- 1. balance_before 컬럼의 NOT NULL 제약 조건 제거
    BEGIN
        ALTER TABLE transactions 
        ALTER COLUMN balance_before DROP NOT NULL;
        RAISE NOTICE '✅ balance_before 컬럼의 NOT NULL 제약 조건 제거 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠️ balance_before 컬럼 제약 조건 제거 실패 (이미 제거되었을 수 있음): %', SQLERRM;
    END;

    -- 2. balance_after 컬럼의 NOT NULL 제약 조건 제거
    BEGIN
        ALTER TABLE transactions 
        ALTER COLUMN balance_after DROP NOT NULL;
        RAISE NOTICE '✅ balance_after 컬럼의 NOT NULL 제약 조건 제거 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠️ balance_after 컬럼 제약 조건 제거 실패 (이미 제거되었을 수 있음): %', SQLERRM;
    END;

    -- 3. processed_by 컬럼 추가 (없는 경우에만)
    BEGIN
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES partners(id);
        RAISE NOTICE '✅ processed_by 컬럼 추가 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠️ processed_by 컬럼 추가 실패 (이미 존재할 수 있음): %', SQLERRM;
    END;

    -- 4. auto_processed 컬럼 추가 (없는 경우에만)
    BEGIN
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS auto_processed BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✅ auto_processed 컬럼 추가 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠️ auto_processed 컬럼 추가 실패 (이미 존재할 수 있음): %', SQLERRM;
    END;

    -- 5. notification_sent 컬럼 추가 (없는 경우에만)
    BEGIN
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✅ notification_sent 컬럼 추가 완료';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠️ notification_sent 컬럼 추가 실패 (이미 존재할 수 있음): %', SQLERRM;
    END;

    -- 6. 컬럼 정보 확인
    RAISE NOTICE '📋 transactions 테이블의 balance 관련 컬럼 정보:';
    
    -- 컬럼 정보 조회 및 출력 (FOR 루프 사용)
    FOR rec IN 
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'transactions' 
        AND column_name IN ('balance_before', 'balance_after', 'processed_by', 'auto_processed', 'notification_sent')
        ORDER BY column_name
    LOOP
        IF rec.is_nullable = 'YES' THEN
            RAISE NOTICE '  • % : % (NULL 허용)', rec.column_name, rec.data_type;
        ELSE
            RAISE NOTICE '  • % : % (NOT NULL)', rec.column_name, rec.data_type;
        END IF;
    END LOOP;

    -- 7. 기존 pending 거래들의 balance_before 설정
    UPDATE transactions 
    SET balance_before = (
        SELECT COALESCE(balance, 0) 
        FROM users 
        WHERE users.id = transactions.user_id
    )
    WHERE status = 'pending' 
    AND balance_before IS NULL;

    RAISE NOTICE '✅ 거래 테이블 balance 컬럼 제약 조건 수정 완료';

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION '❌ 거래 테이블 수정 중 오류 발생: %', SQLERRM;
END $$;