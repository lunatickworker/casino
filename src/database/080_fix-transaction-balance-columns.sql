-- 거래 내역의 처리전잔고/처리후잔고 컬럼 수정 및 데이터 복구
-- 이미지에서 확인된 "처리 후 잔고" ₩0 문제 해결

DO $$
DECLARE
    transaction_record RECORD;
    user_balance DECIMAL(15,2);
    calculated_balance_after DECIMAL(15,2);
    update_count INTEGER := 0;
BEGIN
    RAISE NOTICE '🔧 거래 내역 잔고 컬럼 수정 시작';

    -- 1. 기존 완료된 거래들의 balance_before와 balance_after 재계산
    FOR transaction_record IN 
        SELECT t.*, u.balance as current_user_balance
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.status = 'completed'
        AND (t.balance_before IS NULL OR t.balance_after IS NULL OR t.balance_after = 0)
        ORDER BY t.created_at ASC
    LOOP
        -- 사용자의 현재 잔고 조회
        SELECT balance INTO user_balance 
        FROM users 
        WHERE id = transaction_record.user_id;
        
        IF user_balance IS NULL THEN
            user_balance := 0;
        END IF;

        -- 처리 후 잔고 계산
        IF transaction_record.transaction_type = 'deposit' THEN
            -- 입금의 경우: 현재 잔고에서 거래 금액을 빼면 처리 전 잔고
            calculated_balance_after := user_balance;
            user_balance := user_balance - transaction_record.amount;
        ELSE
            -- 출금의 경우: 현재 잔고에 거래 금액을 더하면 처리 전 잔고  
            calculated_balance_after := user_balance;
            user_balance := user_balance + transaction_record.amount;
        END IF;

        -- 거래 레코드 업데이트
        UPDATE transactions 
        SET 
            balance_before = user_balance,
            balance_after = calculated_balance_after,
            updated_at = NOW()
        WHERE id = transaction_record.id;
        
        update_count := update_count + 1;
        
        -- 진행상황 로그 (100건마다)
        IF update_count % 100 = 0 THEN
            RAISE NOTICE '✓ 거래 레코드 % 건 업데이트 완료', update_count;
        END IF;
    END LOOP;

    RAISE NOTICE '✅ 총 % 건의 거래 레코드 잔고 정보 업데이트 완료', update_count;

    -- 2. pending 상태 거래들의 balance_before 확인 및 수정  
    UPDATE transactions 
    SET balance_before = (
        SELECT balance 
        FROM users 
        WHERE users.id = transactions.user_id
    )
    WHERE status = 'pending' 
    AND balance_before IS NULL;

    GET DIAGNOSTICS update_count = ROW_COUNT;
    RAISE NOTICE '✅ % 건의 대기 중인 거래에 처리전잔고 설정 완료', update_count;

    -- 3. 데이터 검증
    SELECT COUNT(*) INTO update_count
    FROM transactions 
    WHERE status = 'completed' 
    AND (balance_before IS NULL OR balance_after IS NULL);
    
    IF update_count > 0 THEN
        RAISE WARNING '⚠️ % 건의 완료된 거래에 여전히 누락된 잔고 정보가 있습니다', update_count;
    ELSE
        RAISE NOTICE '✅ 모든 완료된 거래의 잔고 정보가 올바르게 설정되었습니다';
    END IF;

    -- 4. 샘플 데이터 확인
    RAISE NOTICE '📊 최근 거래 5건의 잔고 정보:';
    FOR transaction_record IN 
        SELECT 
            t.id,
            t.transaction_type,
            t.amount,
            t.status,
            t.balance_before,
            t.balance_after,
            u.nickname
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
        LIMIT 5
    LOOP
        RAISE NOTICE '  • %: % %원, 처리전: %원, 처리후: %원 (상태: %)', 
            transaction_record.nickname,
            CASE WHEN transaction_record.transaction_type = 'deposit' THEN '입금' ELSE '출금' END,
            transaction_record.amount,
            COALESCE(transaction_record.balance_before, 0),
            COALESCE(transaction_record.balance_after, 0),
            transaction_record.status;
    END LOOP;

    RAISE NOTICE '✅ 거래 내역 잔고 데이터 복구 완료!';

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION '❌ 거래 잔고 업데이트 중 오류 발생: %', SQLERRM;
END $$;

-- 5. 향후 거래 처리를 위한 트리거 함수 생성
CREATE OR REPLACE FUNCTION update_transaction_balance_info()
RETURNS TRIGGER AS $$
DECLARE
    user_current_balance DECIMAL(15,2);
    calculated_balance_after DECIMAL(15,2);
BEGIN
    -- 거래 승인/완료 시에만 실행
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- 사용자 현재 잔고 조회
        SELECT balance INTO user_current_balance
        FROM users 
        WHERE id = NEW.user_id;
        
        IF user_current_balance IS NULL THEN
            user_current_balance := 0;
        END IF;
        
        -- balance_before가 설정되지 않은 경우 설정
        IF NEW.balance_before IS NULL THEN
            NEW.balance_before := user_current_balance;
        END IF;
        
        -- balance_after 계산
        IF NEW.transaction_type = 'deposit' THEN
            calculated_balance_after := user_current_balance + NEW.amount;
        ELSE
            calculated_balance_after := user_current_balance - NEW.amount;
        END IF;
        
        NEW.balance_after := calculated_balance_after;
        
        RAISE NOTICE '💰 거래 % 잔고 정보 자동 설정: 처리전 %원 → 처리후 %원', 
            NEW.id, NEW.balance_before, NEW.balance_after;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. 트리거 생성 (기존 트리거가 있으면 교체)
DROP TRIGGER IF EXISTS transaction_balance_update_trigger ON transactions;
CREATE TRIGGER transaction_balance_update_trigger
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_transaction_balance_info();

-- 7. 권한 설정
GRANT EXECUTE ON FUNCTION update_transaction_balance_info() TO authenticated;
GRANT EXECUTE ON FUNCTION update_transaction_balance_info() TO service_role;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '🎉 거래 내역 처리전잔고/처리후잔고 수정 작업 완료!';
    RAISE NOTICE '📝 이제 TransactionManagement에서 새로고침하여 확인하세요.';
END $$;
