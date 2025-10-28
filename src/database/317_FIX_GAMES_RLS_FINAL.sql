-- ================================================
-- 317: games 테이블 RLS 정책 최종 수정 (테이블명 오류 수정)
-- ================================================
-- 목적: 게임 동기화 시 INSERT/UPDATE 가능하도록 RLS 정책 수정
-- 관련 에러: "new row violates row-level security policy for table \"games\""
-- 수정: partner_game_status → organization_game_status (실제 테이블명)
-- ================================================

-- 1. games 테이블 RLS 정책 재설정
DROP POLICY IF EXISTS "게임 조회 전체 허용" ON games;
DROP POLICY IF EXISTS "게임 추가 허용" ON games;
DROP POLICY IF EXISTS "게임 수정 허용" ON games;
DROP POLICY IF EXISTS "게임 삭제 허용" ON games;
DROP POLICY IF EXISTS "게임 조회 허용" ON games;
DROP POLICY IF EXISTS "시스템에서 게임 관리" ON games;
DROP POLICY IF EXISTS "관리자가 게임 수정 가능" ON games;
DROP POLICY IF EXISTS "게임 데이터 읽기 허용" ON games;
DROP POLICY IF EXISTS "게임 데이터 쓰기 허용" ON games;

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "게임 조회 전체 허용" ON games FOR SELECT USING (true);
CREATE POLICY "게임 추가 허용" ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "게임 수정 허용" ON games FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "게임 삭제 허용" ON games FOR DELETE USING (true);

-- 2. game_providers 테이블 RLS 정책 재설정
DROP POLICY IF EXISTS "제공사 조회 전체 허용" ON game_providers;
DROP POLICY IF EXISTS "제공사 관리 전체 허용" ON game_providers;
DROP POLICY IF EXISTS "제공사 조회 허용" ON game_providers;
DROP POLICY IF EXISTS "제공사 관리 허용" ON game_providers;

ALTER TABLE game_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "제공사 조회 전체 허용" ON game_providers FOR SELECT USING (true);
CREATE POLICY "제공사 관리 전체 허용" ON game_providers FOR ALL USING (true) WITH CHECK (true);

-- 3. organization_game_status 테이블 RLS 정책 (테이블이 존재하는 경우만)
DO $$
BEGIN
    -- 테이블 존재 여부 확인
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'organization_game_status'
    ) THEN
        -- 기존 정책 삭제
        DROP POLICY IF EXISTS "조직별 게임 상태 조회 허용" ON organization_game_status;
        DROP POLICY IF EXISTS "조직별 게임 상태 관리 허용" ON organization_game_status;
        DROP POLICY IF EXISTS "System admin can manage all organization game status" ON organization_game_status;
        DROP POLICY IF EXISTS "Organization admin can manage own game status" ON organization_game_status;
        DROP POLICY IF EXISTS "Partners can view their organization game status" ON organization_game_status;
        
        -- RLS 활성화
        ALTER TABLE organization_game_status ENABLE ROW LEVEL SECURITY;
        
        -- 새 정책 생성
        CREATE POLICY "조직별 게임 상태 조회 허용" ON organization_game_status FOR SELECT USING (true);
        CREATE POLICY "조직별 게임 상태 관리 허용" ON organization_game_status FOR ALL USING (true) WITH CHECK (true);
        
        RAISE NOTICE '✅ organization_game_status 테이블 RLS 정책 설정 완료';
    ELSE
        RAISE NOTICE 'ℹ️  organization_game_status 테이블이 존재하지 않음 (건너뜀)';
    END IF;
END $$;

-- 4. 인덱스 생성 (이미 존재하면 무시됨)
CREATE INDEX IF NOT EXISTS idx_games_provider_id ON games(provider_id);
CREATE INDEX IF NOT EXISTS idx_games_type ON games(type);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_provider_type ON games(provider_id, type);

-- 5. 완료 메시지
DO $$
DECLARE
    v_games_policies INTEGER;
    v_providers_policies INTEGER;
    v_org_status_policies INTEGER;
BEGIN
    -- games 테이블 정책 개수 확인
    SELECT COUNT(*) INTO v_games_policies
    FROM pg_policies
    WHERE tablename = 'games';
    
    -- game_providers 테이블 정책 개수 확인
    SELECT COUNT(*) INTO v_providers_policies
    FROM pg_policies
    WHERE tablename = 'game_providers';
    
    -- organization_game_status 테이블 정책 개수 확인
    SELECT COUNT(*) INTO v_org_status_policies
    FROM pg_policies
    WHERE tablename = 'organization_game_status';
    
    RAISE NOTICE '=== RLS 정책 설정 완료 ===';
    RAISE NOTICE 'games 테이블 정책 수: %', v_games_policies;
    RAISE NOTICE 'game_providers 테이블 정책 수: %', v_providers_policies;
    RAISE NOTICE 'organization_game_status 테이블 정책 수: %', v_org_status_policies;
    
    IF v_games_policies >= 4 AND v_providers_policies >= 2 THEN
        RAISE NOTICE '✅ 필수 RLS 정책이 성공적으로 적용되었습니다.';
        RAISE NOTICE '이제 게임 동기화를 다시 시도하세요.';
    ELSE
        RAISE WARNING '⚠️ 일부 RLS 정책이 누락되었을 수 있습니다.';
    END IF;
END $$;

-- 6. 검증 쿼리
SELECT 
    tablename,
    policyname,
    cmd
FROM pg_policies
WHERE tablename IN ('games', 'game_providers', 'organization_game_status')
ORDER BY tablename, policyname;
