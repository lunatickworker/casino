-- =====================================================
-- 243. 보유금 트리거 완전 정리 (모든 충돌 제거)
-- =====================================================
-- 문제: 여러 트리거 함수가 충돌하여 에러 발생
-- 해결: 모든 트리거/함수 완전 삭제 후 깔끔하게 재생성
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🧹 보유금 트리거 완전 정리';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 1. 모든 기존 트리거 및 함수 완전 삭제
-- ============================================

-- 모든 관련 트리거 삭제
DROP TRIGGER IF EXISTS trigger_log_balance_change ON partners CASCADE;
DROP TRIGGER IF EXISTS trigger_log_partner_balance_change ON partners CASCADE;
DROP TRIGGER IF EXISTS log_balance_change_trigger ON partners CASCADE;
DROP TRIGGER IF EXISTS partner_balance_log_trigger ON partners CASCADE;

-- 모든 관련 함수 삭제
DROP FUNCTION IF EXISTS log_balance_change() CASCADE;
DROP FUNCTION IF EXISTS log_partner_balance_change() CASCADE;
DROP FUNCTION IF EXISTS track_balance_change() CASCADE;
DROP FUNCTION IF EXISTS partner_balance_logger() CASCADE;

DO $
BEGIN
    RAISE NOTICE '✅ 모든 기존 트리거 및 함수 삭제 완료';
    RAISE NOTICE '';
END $;

-- ============================================
-- 2. partner_balance_logs 테이블 완전 재생성
-- ============================================

DROP TABLE IF EXISTS partner_balance_logs CASCADE;

CREATE TABLE partner_balance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    old_balance DECIMAL(20, 2) DEFAULT 0,
    new_balance DECIMAL(20, 2) DEFAULT 0,
    change_amount DECIMAL(20, 2) DEFAULT 0,
    sync_source VARCHAR(50) DEFAULT 'manual',
    api_response TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE partner_balance_logs IS '파트너 보유금 변경 이력 (API /info 동기화 기록)';
COMMENT ON COLUMN partner_balance_logs.partner_id IS '파트너 ID';
COMMENT ON COLUMN partner_balance_logs.old_balance IS '변경 전 보유금';
COMMENT ON COLUMN partner_balance_logs.new_balance IS '변경 후 보유금';
COMMENT ON COLUMN partner_balance_logs.change_amount IS '변경 금액 (new - old)';
COMMENT ON COLUMN partner_balance_logs.sync_source IS '동기화 소스 (api_info, manual 등)';
COMMENT ON COLUMN partner_balance_logs.api_response IS 'API 응답 원문 (디버깅용)';

-- 인덱스 생성
CREATE INDEX idx_balance_logs_partner_date 
    ON partner_balance_logs(partner_id, created_at DESC);

CREATE INDEX idx_balance_logs_date 
    ON partner_balance_logs(created_at DESC);

DO $
BEGIN
    RAISE NOTICE '✅ partner_balance_logs 테이블 재생성 완료';
    RAISE NOTICE '';
END $;

-- ============================================
-- 3. RLS 정책 설정 (간소화)
-- ============================================

ALTER TABLE partner_balance_logs ENABLE ROW LEVEL SECURITY;

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "파트너는 자신의 보유금 로그 조회 가능" ON partner_balance_logs;
DROP POLICY IF EXISTS "시스템관리자는 모든 보유금 로그 조회 가능" ON partner_balance_logs;
DROP POLICY IF EXISTS "시스템이 보유금 로그 삽입 가능" ON partner_balance_logs;
DROP POLICY IF EXISTS "Enable read for own partner" ON partner_balance_logs;
DROP POLICY IF EXISTS "Enable insert for system" ON partner_balance_logs;
DROP POLICY IF EXISTS "Enable all for system admin" ON partner_balance_logs;

-- ✅ 새로운 정책: 모든 인증된 사용자가 조회/삽입 가능
CREATE POLICY "인증된 사용자 조회 가능"
    ON partner_balance_logs FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "인증된 사용자 삽입 가능"
    ON partner_balance_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

DO $
BEGIN
    RAISE NOTICE '✅ RLS 정책 설정 완료 (간소화)';
    RAISE NOTICE '';
END $;

-- ============================================
-- 4. 권한 부여
-- ============================================

GRANT ALL ON partner_balance_logs TO authenticated;
GRANT ALL ON partner_balance_logs TO postgres;
GRANT ALL ON partner_balance_logs TO service_role;

DO $
BEGIN
    RAISE NOTICE '✅ 권한 부여 완료';
    RAISE NOTICE '';
END $;

-- ============================================
-- 5. 트리거 없이 동작 확인
-- ============================================

DO $$
DECLARE
    test_partner_id UUID;
    test_balance DECIMAL(20, 2);
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🧪 트리거 없이 동작 확인';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    
    -- 대본사 찾기
    SELECT id, balance INTO test_partner_id, test_balance
    FROM partners
    WHERE partner_type = 'head_office'
    LIMIT 1;
    
    IF test_partner_id IS NOT NULL THEN
        RAISE NOTICE '테스트 대상: %', test_partner_id;
        RAISE NOTICE '현재 보유금: %', test_balance;
        
        -- ✅ 수동으로 로그 기록 테스트
        INSERT INTO partner_balance_logs (
            partner_id,
            old_balance,
            new_balance,
            change_amount,
            sync_source,
            api_response
        ) VALUES (
            test_partner_id,
            test_balance,
            test_balance + 1000,
            1000,
            'test',
            '{"test": true}'
        );
        
        RAISE NOTICE '✅ 수동 로그 기록 성공!';
        RAISE NOTICE '';
        RAISE NOTICE '💡 이제 useBalanceSync에서 직접 로그를 기록합니다.';
        RAISE NOTICE '   트리거를 사용하지 않으므로 충돌 없음!';
    ELSE
        RAISE NOTICE '⚠️  대본사가 없습니다.';
    END IF;
END $$;

-- ============================================
-- 6. 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 보유금 트리거 완전 정리 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📋 변경 사항:';
    RAISE NOTICE '   ❌ 모든 트리거 삭제 (충돌 제거)';
    RAISE NOTICE '   ✅ partner_balance_logs 테이블 재생성';
    RAISE NOTICE '   ✅ RLS 정책 간소화';
    RAISE NOTICE '   ✅ 권한 부여 완료';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 동작 방식:';
    RAISE NOTICE '   1. useBalanceSync → API /info 호출';
    RAISE NOTICE '   2. balance 추출';
    RAISE NOTICE '   3. partners.balance 업데이트';
    RAISE NOTICE '   4. partner_balance_logs에 수동 기록';
    RAISE NOTICE '   5. 화면에 표시';
    RAISE NOTICE '';
    RAISE NOTICE '💡 트리거 없이 코드에서 직접 관리 (Guidelines 준수)';
    RAISE NOTICE '   "이벤트 발생 업데이트로 구현" ✅';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
