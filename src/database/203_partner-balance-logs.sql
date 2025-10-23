-- =====================================================
-- 파트너 보유금 변경 로그 시스템
-- =====================================================
-- 조직(파트너) 간 자금 이동 내역 추적

-- 1. 파트너 보유금 로그 테이블 생성
CREATE TABLE IF NOT EXISTS partner_balance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
        'deposit',           -- 입금 (상위 조직에서)
        'withdrawal',        -- 출금 (하위 조직에게)
        'admin_adjustment',  -- 관리자 조정
        'commission',        -- 수수료 정산
        'refund'            -- 환불
    )),
    amount DECIMAL(15,2) NOT NULL,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    from_partner_id UUID REFERENCES partners(id),  -- 송금 파트너
    to_partner_id UUID REFERENCES partners(id),    -- 수신 파트너
    processed_by UUID REFERENCES partners(id),     -- 처리한 관리자
    memo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_partner_id ON partner_balance_logs(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_created_at ON partner_balance_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_from_partner ON partner_balance_logs(from_partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_to_partner ON partner_balance_logs(to_partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_balance_logs_processed_by ON partner_balance_logs(processed_by);

-- 3. RLS 활성화
ALTER TABLE partner_balance_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS 정책 - 시스템관리자는 모두 조회, 그 외는 본인 관련 로그만
DROP POLICY IF EXISTS partner_balance_logs_select_policy ON partner_balance_logs;
CREATE POLICY partner_balance_logs_select_policy ON partner_balance_logs
    FOR SELECT
    USING (
        -- 시스템관리자는 모든 로그 조회
        EXISTS (
            SELECT 1 FROM partners
            WHERE id = auth.uid()
            AND level = 1
        )
        OR
        -- 본인 관련 로그 (본인이 송금자, 수신자, 또는 직접 당사자)
        partner_id = auth.uid()
        OR from_partner_id = auth.uid()
        OR to_partner_id = auth.uid()
        OR processed_by = auth.uid()
    );

-- 5. INSERT 정책 - 시스템관리자만 직접 삽입 가능 (일반적으로는 트리거로 자동 생성)
DROP POLICY IF EXISTS partner_balance_logs_insert_policy ON partner_balance_logs;
CREATE POLICY partner_balance_logs_insert_policy ON partner_balance_logs
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM partners
            WHERE id = auth.uid()
            AND level <= 2  -- 시스템관리자 또는 대본사
        )
    );

-- 6. 파트너 보유금 변경 시 자동 로그 기록 함수
CREATE OR REPLACE FUNCTION log_partner_balance_change()
RETURNS TRIGGER AS $$
BEGIN
    -- balance가 변경된 경우에만 로그 기록
    IF OLD.balance IS DISTINCT FROM NEW.balance THEN
        INSERT INTO partner_balance_logs (
            partner_id,
            transaction_type,
            amount,
            balance_before,
            balance_after,
            processed_by,
            memo
        ) VALUES (
            NEW.id,
            'admin_adjustment',  -- 기본값
            NEW.balance - OLD.balance,
            OLD.balance,
            NEW.balance,
            auth.uid(),
            CASE 
                WHEN NEW.balance > OLD.balance THEN '보유금 증가'
                ELSE '보유금 감소'
            END
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. 트리거 생성 - partners 테이블의 balance 변경 감지
DROP TRIGGER IF EXISTS trigger_log_partner_balance ON partners;
CREATE TRIGGER trigger_log_partner_balance
    AFTER UPDATE OF balance ON partners
    FOR EACH ROW
    WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
    EXECUTE FUNCTION log_partner_balance_change();

-- 8. 파트너 간 자금 이체 함수
CREATE OR REPLACE FUNCTION transfer_partner_balance(
    p_from_partner_id UUID,
    p_to_partner_id UUID,
    p_amount DECIMAL(15,2),
    p_memo TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_from_balance DECIMAL(15,2);
    v_to_balance DECIMAL(15,2);
    v_from_balance_after DECIMAL(15,2);
    v_to_balance_after DECIMAL(15,2);
    v_result JSON;
BEGIN
    -- 입력 검증
    IF p_amount <= 0 THEN
        RAISE EXCEPTION '이체 금액은 0보다 커야 합니다.';
    END IF;

    -- 송금 파트너의 현재 잔고 조회 (FOR UPDATE로 잠금)
    SELECT balance INTO v_from_balance
    FROM partners
    WHERE id = p_from_partner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '송금 파트너를 찾을 수 없습니다.';
    END IF;

    -- 잔고 부족 검증
    IF v_from_balance < p_amount THEN
        RAISE EXCEPTION '송금 파트너의 보유금이 부족합니다. (현재: %, 필요: %)', v_from_balance, p_amount;
    END IF;

    -- 수신 파트너의 현재 잔고 조회
    SELECT balance INTO v_to_balance
    FROM partners
    WHERE id = p_to_partner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '수신 파트너를 찾을 수 없습니다.';
    END IF;

    -- 송금 파트너 잔고 차감
    UPDATE partners
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE id = p_from_partner_id
    RETURNING balance INTO v_from_balance_after;

    -- 수신 파트너 잔고 증가
    UPDATE partners
    SET balance = balance + p_amount,
        updated_at = NOW()
    WHERE id = p_to_partner_id
    RETURNING balance INTO v_to_balance_after;

    -- 송금 로그 기록
    INSERT INTO partner_balance_logs (
        partner_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        from_partner_id,
        to_partner_id,
        processed_by,
        memo
    ) VALUES (
        p_from_partner_id,
        'withdrawal',
        -p_amount,
        v_from_balance,
        v_from_balance_after,
        p_from_partner_id,
        p_to_partner_id,
        auth.uid(),
        COALESCE(p_memo, '파트너 간 이체')
    );

    -- 수신 로그 기록
    INSERT INTO partner_balance_logs (
        partner_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        from_partner_id,
        to_partner_id,
        processed_by,
        memo
    ) VALUES (
        p_to_partner_id,
        'deposit',
        p_amount,
        v_to_balance,
        v_to_balance_after,
        p_from_partner_id,
        p_to_partner_id,
        auth.uid(),
        COALESCE(p_memo, '파트너 간 이체')
    );

    -- 결과 반환
    v_result := json_build_object(
        'success', true,
        'from_partner_id', p_from_partner_id,
        'to_partner_id', p_to_partner_id,
        'amount', p_amount,
        'from_balance_after', v_from_balance_after,
        'to_balance_after', v_to_balance_after,
        'message', '이체가 완료되었습니다.'
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION '이체 처리 중 오류 발생: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ 파트너 보유금 로그 시스템이 생성되었습니다.';
    RAISE NOTICE '   - partner_balance_logs 테이블';
    RAISE NOTICE '   - 자동 로그 기록 트리거';
    RAISE NOTICE '   - 파트너 간 이체 함수 (transfer_partner_balance)';
END $$;
