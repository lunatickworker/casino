-- =====================================================
-- 239. 보유금 동기화 시스템 지원
-- =====================================================
-- 목적: 프론트엔드 보유금 동기화를 위한 DB 지원
-- 기능: partners 테이블 balance 컬럼 확인 및 인덱스 생성
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔧 보유금 동기화 시스템 설정';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 1. partners 테이블 balance 컬럼 확인
-- ============================================

DO $$
DECLARE
    balance_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'partners' 
        AND column_name = 'balance'
    ) INTO balance_exists;
    
    IF balance_exists THEN
        RAISE NOTICE '✅ partners.balance 컬럼 존재';
    ELSE
        RAISE NOTICE '❌ partners.balance 컬럼 없음 - 생성 필요';
        
        -- balance 컬럼 추가
        ALTER TABLE partners 
        ADD COLUMN balance DECIMAL(20, 2) DEFAULT 0 NOT NULL;
        
        RAISE NOTICE '✅ partners.balance 컬럼 생성 완료';
    END IF;
END $$;

-- ============================================
-- 2. 인덱스 생성 (조회 성능 향상)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_partners_balance 
    ON partners(balance) 
    WHERE balance > 0;

CREATE INDEX IF NOT EXISTS idx_partners_opcode 
    ON partners(api_opcode) 
    WHERE api_opcode IS NOT NULL;

-- ============================================
-- 3. 보유금 업데이트 로그 테이블 생성 (선택)
-- ============================================

CREATE TABLE IF NOT EXISTS partner_balance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    old_balance DECIMAL(20, 2),
    new_balance DECIMAL(20, 2),
    change_amount DECIMAL(20, 2),
    change_reason VARCHAR(100),  -- 'api_sync', 'transaction', 'admin_adjust'
    sync_source VARCHAR(50),     -- 'api/info', 'manual', 'auto_sync'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_logs_partner 
    ON partner_balance_logs(partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_balance_logs_date 
    ON partner_balance_logs(created_at DESC);

-- ============================================
-- 4. 보유금 업데이트 트리거 (로그 기록)
-- ============================================

CREATE OR REPLACE FUNCTION log_balance_change()
RETURNS TRIGGER AS $$
BEGIN
    -- balance가 실제로 변경된 경우에만 로그 기록
    IF OLD.balance IS DISTINCT FROM NEW.balance THEN
        INSERT INTO partner_balance_logs (
            partner_id,
            old_balance,
            new_balance,
            change_amount,
            change_reason,
            sync_source
        ) VALUES (
            NEW.id,
            OLD.balance,
            NEW.balance,
            NEW.balance - OLD.balance,
            'auto_sync',  -- 기본값
            'api/info'    -- 기본값
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_balance_change ON partners;
CREATE TRIGGER trigger_log_balance_change
    AFTER UPDATE OF balance ON partners
    FOR EACH ROW
    EXECUTE FUNCTION log_balance_change();

-- ============================================
-- 5. RLS 정책 설정
-- ============================================

ALTER TABLE partner_balance_logs ENABLE ROW LEVEL SECURITY;

-- 파트너는 자신의 로그만 조회
DROP POLICY IF EXISTS "파트너는 자신의 보유금 로그 조회 가능" ON partner_balance_logs;
CREATE POLICY "파트너는 자신의 보유금 로그 조회 가능"
    ON partner_balance_logs FOR SELECT
    USING (partner_id = auth.uid());

-- 시스템관리자는 모든 로그 조회
DROP POLICY IF EXISTS "시스템관리자는 모든 보유금 로그 조회 가능" ON partner_balance_logs;
CREATE POLICY "시스템관리자는 모든 보유금 로그 조회 가능"
    ON partner_balance_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM partners
            WHERE id = auth.uid()
            AND level = 1
        )
    );

-- ============================================
-- 6. 권한 부여
-- ============================================

GRANT SELECT ON partner_balance_logs TO authenticated;

-- ============================================
-- 7. 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 보유금 동기화 시스템 설정 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📋 설정 내용:';
    RAISE NOTICE '   1. partners.balance 컬럼 확인/생성';
    RAISE NOTICE '   2. 인덱스 생성 (balance, api_opcode)';
    RAISE NOTICE '   3. partner_balance_logs 테이블 생성';
    RAISE NOTICE '   4. 보유금 변경 로그 트리거 설정';
    RAISE NOTICE '   5. RLS 정책 적용';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 프론트엔드 동작:';
    RAISE NOTICE '   • 로그인 시: API /info 호출 (opcode 있으면)';
    RAISE NOTICE '   • 4분마다: 자동 동기화';
    RAISE NOTICE '   • 실시간: 내부 계산으로 업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '💡 사용 방법:';
    RAISE NOTICE '   import { useBalanceSync } from "./hooks/useBalanceSync";';
    RAISE NOTICE '   const { balance } = useBalanceSync(user);';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
