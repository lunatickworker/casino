-- ============================================================================
-- 055. 게임 관련 테이블에 partner_id 컬럼 추가
-- ============================================================================
-- 작성일: 2025-10-02
-- 목적: 게임 리스트 조회 시 사용하는 테이블들에 partner_id 컬럼 추가
-- ============================================================================

-- 1. users 테이블 (이미 partner_id 있을 수 있음)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE users ADD COLUMN partner_id UUID REFERENCES partners(id);
        RAISE NOTICE '✅ users 테이블에 partner_id 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ users 테이블에 partner_id 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- 2. partners 테이블 (자기 참조 테이블이므로 패스)
DO $$
BEGIN
    RAISE NOTICE '✅ partners 테이블은 자기 참조 테이블이므로 partner_id 추가 불필요.';
END $$;

-- 3. games 테이블 (전역 게임 목록이므로 partner_id 삭제)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE games DROP COLUMN partner_id;
        RAISE NOTICE '✅ games 테이블에서 partner_id 컬럼을 삭제했습니다.';
    ELSE
        RAISE NOTICE '⚠️ games 테이블에 partner_id 컬럼이 없습니다.';
    END IF;
END $$;

-- 4. organization_game_status 테이블 (이미 organization_id가 partner_id 역할)
DO $$
BEGIN
    -- organization_id가 partner_id 역할을 하지만, 명시적으로 partner_id도 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_game_status' AND column_name = 'partner_id'
    ) THEN
        -- partner_id 컬럼 추가 (organization_id와 동일한 값 사용)
        ALTER TABLE organization_game_status ADD COLUMN partner_id UUID REFERENCES partners(id);
        
        -- 기존 데이터에 대해 organization_id 값을 partner_id로 복사
        UPDATE organization_game_status SET partner_id = organization_id WHERE partner_id IS NULL;
        
        CREATE INDEX IF NOT EXISTS idx_organization_game_status_partner_id ON organization_game_status(partner_id);
        RAISE NOTICE '✅ organization_game_status 테이블에 partner_id 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ organization_game_status 테이블에 partner_id 컬럼이 이미 존재합니다.';
    END IF;
    
    -- is_featured 컬럼 추가 (054번 함수에서 참조하는 컬럼)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_game_status' AND column_name = 'is_featured'
    ) THEN
        ALTER TABLE organization_game_status ADD COLUMN is_featured BOOLEAN DEFAULT false;
        RAISE NOTICE '✅ organization_game_status 테이블에 is_featured 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ organization_game_status 테이블에 is_featured 컬럼이 이미 존재합니다.';
    END IF;
    
    -- priority 컬럼 확인 및 추가 (054번 함수에서 참조하는 컬럼)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_game_status' AND column_name = 'priority'
    ) THEN
        ALTER TABLE organization_game_status ADD COLUMN priority INTEGER DEFAULT 0;
        RAISE NOTICE '✅ organization_game_status 테이블에 priority 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ organization_game_status 테이블에 priority 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- 5. game_providers 테이블 (전역 제공사 목록이므로 partner_id 삭제)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_providers' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE game_providers DROP COLUMN partner_id;
        RAISE NOTICE '✅ game_providers 테이블에서 partner_id 컬럼을 삭제했습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_providers 테이블에 partner_id 컬럼이 없습니다.';
    END IF;
END $$;

-- 6. game_cache 테이블 (전역 캐시이므로 partner_id 삭제)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_cache' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE game_cache DROP COLUMN partner_id;
        RAISE NOTICE '✅ game_cache 테이블에서 partner_id 컬럼을 삭제했습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_cache 테이블에 partner_id 컬럼이 없습니다.';
    END IF;
END $$;

-- 7. 추가로 필요한 게임 관련 테이블들에도 partner_id 추가
-- game_records 테이블
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE game_records ADD COLUMN partner_id UUID REFERENCES partners(id);
        CREATE INDEX IF NOT EXISTS idx_game_records_partner_id ON game_records(partner_id);
        RAISE NOTICE '✅ game_records 테이블에 partner_id 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_records 테이블에 partner_id 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- game_status_logs 테이블 (이미 있을 가능성 높음)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_status_logs' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE game_status_logs ADD COLUMN partner_id UUID REFERENCES partners(id);
        CREATE INDEX IF NOT EXISTS idx_game_status_logs_partner_id ON game_status_logs(partner_id);
        RAISE NOTICE '✅ game_status_logs 테이블에 partner_id 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_status_logs 테이블에 partner_id 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- game_sync_logs 테이블
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_sync_logs' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE game_sync_logs ADD COLUMN partner_id UUID REFERENCES partners(id);
        CREATE INDEX IF NOT EXISTS idx_game_sync_logs_partner_id ON game_sync_logs(partner_id);
        RAISE NOTICE '✅ game_sync_logs 테이블에 partner_id 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_sync_logs 테이블에 partner_id 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- game_launch_sessions 테이블
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_launch_sessions' AND column_name = 'partner_id'
    ) THEN
        ALTER TABLE game_launch_sessions ADD COLUMN partner_id UUID REFERENCES partners(id);
        CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_partner_id ON game_launch_sessions(partner_id);
        RAISE NOTICE '✅ game_launch_sessions 테이블에 partner_id 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '⚠️ game_launch_sessions 테이블에 partner_id 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- 8. game_records 테이블의 기존 데이터 업데이트 (user_id로부터 partner_id 추출)
DO $$
BEGIN
    -- game_records의 partner_id를 users 테이블의 partner_id로 업데이트
    UPDATE game_records gr
    SET partner_id = u.partner_id
    FROM users u
    WHERE gr.user_id = u.id
      AND gr.partner_id IS NULL
      AND u.partner_id IS NOT NULL;
    
    RAISE NOTICE '✅ game_records 테이블의 기존 데이터에 partner_id를 업데이트했습니다.';
END $$;

-- 9. game_launch_sessions 테이블의 기존 데이터 업데이트
DO $$
BEGIN
    UPDATE game_launch_sessions gls
    SET partner_id = u.partner_id
    FROM users u
    WHERE gls.user_id = u.id
      AND gls.partner_id IS NULL
      AND u.partner_id IS NOT NULL;
    
    RAISE NOTICE '✅ game_launch_sessions 테이블의 기존 데이터에 partner_id를 업데이트했습니다.';
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 055. 게임 관련 테이블 partner_id 추가 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. users 테이블: partner_id 확인/추가';
    RAISE NOTICE '2. games 테이블: partner_id 추가';
    RAISE NOTICE '3. organization_game_status 테이블: partner_id 추가';
    RAISE NOTICE '4. game_providers 테이블: partner_id 추가';
    RAISE NOTICE '5. game_cache 테이블: partner_id 추가';
    RAISE NOTICE '6. game_records 테이블: partner_id 추가 및 기존 데이터 업데이트';
    RAISE NOTICE '7. game_status_logs 테이블: partner_id 추가';
    RAISE NOTICE '8. game_sync_logs 테이블: partner_id 추가';
    RAISE NOTICE '9. game_launch_sessions 테이블: partner_id 추가 및 기존 데이터 업데이트';
    RAISE NOTICE '10. 모든 테이블에 인덱스 생성 완료';
    RAISE NOTICE '============================================';
END $$;
