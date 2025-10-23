-- ============================================================================
-- 040. 조직별 게임 상태 관리 시스템
-- ============================================================================
-- 목적: 대본사(조직)별로 게임 노출/비노출/점검중 상태를 개별 관리
-- 작성일: 2025-10-02
-- ============================================================================

-- 1. 조직별 게임 상태 관리 테이블 생성
CREATE TABLE IF NOT EXISTS organization_game_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES partners(id), -- 대본사(level=2) ID
    game_id INTEGER NOT NULL REFERENCES games(id),
    status VARCHAR(20) NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'maintenance')),
    priority INTEGER DEFAULT 0, -- 게임 노출 순서 (높을수록 상위 노출)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, game_id) -- 조직당 게임 하나만 설정 가능
);

-- 2. 인덱스 생성 (조회 성능 최적화)
CREATE INDEX IF NOT EXISTS idx_org_game_status_org_id ON organization_game_status(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_game_status_game_id ON organization_game_status(game_id);
CREATE INDEX IF NOT EXISTS idx_org_game_status_priority ON organization_game_status(organization_id, priority DESC);

-- 3. updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_organization_game_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_organization_game_status_updated_at
BEFORE UPDATE ON organization_game_status
FOR EACH ROW
EXECUTE FUNCTION update_organization_game_status_updated_at();

-- 4. 조직별 게임 목록 조회 함수 (상태 상속 로직 적용)
CREATE OR REPLACE FUNCTION get_organization_games(org_id UUID, filter_game_type VARCHAR DEFAULT NULL)
RETURNS TABLE (
    game_id INTEGER,
    provider_id INTEGER,
    game_name VARCHAR(200),
    game_type VARCHAR(20),
    status VARCHAR(20),
    image_url TEXT,
    demo_available BOOLEAN,
    priority INTEGER,
    last_sync_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        g.id AS game_id,
        g.provider_id,
        g.name AS game_name,
        g.type AS game_type,
        COALESCE(ogs.status, g.status) AS status, -- 조직 설정이 있으면 우선, 없으면 기본값
        g.image_url,
        g.demo_available,
        COALESCE(ogs.priority, 0) AS priority,
        g.last_sync_at
    FROM games g
    LEFT JOIN organization_game_status ogs 
        ON g.id = ogs.game_id AND ogs.organization_id = org_id
    WHERE 
        (filter_game_type IS NULL OR g.type = filter_game_type)
    ORDER BY 
        COALESCE(ogs.priority, 0) DESC, -- priority 높은 순
        g.name ASC;
END;
$$ LANGUAGE plpgsql;

-- 5. 사용자용 게임 목록 조회 함수 (visible 게임만)
CREATE OR REPLACE FUNCTION get_user_visible_games(user_id_param UUID, filter_game_type VARCHAR DEFAULT NULL)
RETURNS TABLE (
    game_id INTEGER,
    provider_id INTEGER,
    game_name VARCHAR(200),
    game_type VARCHAR(20),
    image_url TEXT,
    demo_available BOOLEAN,
    priority INTEGER
) AS $$
DECLARE
    user_org_id UUID;
    current_partner_id UUID;
BEGIN
    -- 사용자의 추천인(파트너) ID 가져오기
    SELECT referrer_id INTO current_partner_id
    FROM users
    WHERE id = user_id_param;

    IF current_partner_id IS NULL THEN
        RAISE EXCEPTION 'User referrer not found';
    END IF;

    -- 파트너 계층을 따라 올라가며 대본사(level=2) 찾기
    WITH RECURSIVE partner_hierarchy AS (
        -- 현재 파트너
        SELECT id, parent_id, level
        FROM partners
        WHERE id = current_partner_id
        
        UNION ALL
        
        -- 부모 파트너들
        SELECT p.id, p.parent_id, p.level
        FROM partners p
        INNER JOIN partner_hierarchy ph ON p.id = ph.parent_id
    )
    SELECT id INTO user_org_id
    FROM partner_hierarchy 
    WHERE level = 2 -- 대본사 레벨
    LIMIT 1;

    -- 대본사를 못 찾은 경우 (시스템관리자 직속 사용자 등)
    -- 시스템관리자를 organization으로 사용
    IF user_org_id IS NULL THEN
        SELECT id INTO user_org_id
        FROM partners
        WHERE level = 1 -- 시스템관리자
        LIMIT 1;
    END IF;

    -- visible 상태인 게임만 반환
    RETURN QUERY
    SELECT 
        g.id AS game_id,
        g.provider_id,
        g.name AS game_name,
        g.type AS game_type,
        g.image_url,
        g.demo_available,
        COALESCE(ogs.priority, 0) AS priority
    FROM games g
    LEFT JOIN organization_game_status ogs 
        ON g.id = ogs.game_id AND ogs.organization_id = user_org_id
    WHERE 
        (filter_game_type IS NULL OR g.type = filter_game_type)
        AND COALESCE(ogs.status, g.status) = 'visible' -- 조직 설정 또는 기본값이 visible
    ORDER BY 
        COALESCE(ogs.priority, 0) DESC,
        g.name ASC;
END;
$$ LANGUAGE plpgsql;

-- 6. 게임 상태 업데이트 함수 (조직별)
CREATE OR REPLACE FUNCTION set_organization_game_status(
    org_id UUID,
    game_id_param INTEGER,
    new_status VARCHAR(20),
    new_priority INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    -- organization_game_status에 upsert
    INSERT INTO organization_game_status (organization_id, game_id, status, priority)
    VALUES (org_id, game_id_param, new_status, new_priority)
    ON CONFLICT (organization_id, game_id) 
    DO UPDATE SET 
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 7. 조직의 모든 게임 상태 초기화 (기본값으로 리셋)
CREATE OR REPLACE FUNCTION reset_organization_game_status(org_id UUID)
RETURNS VOID AS $$
BEGIN
    DELETE FROM organization_game_status WHERE organization_id = org_id;
END;
$$ LANGUAGE plpgsql;

-- 8. 게임 동기화 로그 테이블 (API 호출 이력 추적)
CREATE TABLE IF NOT EXISTS game_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type VARCHAR(20) NOT NULL CHECK (sync_type IN ('full', 'provider', 'single')),
    provider_id INTEGER REFERENCES game_providers(id),
    total_games INTEGER DEFAULT 0,
    new_games INTEGER DEFAULT 0,
    updated_games INTEGER DEFAULT 0,
    failed_games INTEGER DEFAULT 0,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (sync_status IN ('in_progress', 'completed', 'failed')),
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 9. 게임 동기화 시작 함수
CREATE OR REPLACE FUNCTION start_game_sync(
    sync_type_param VARCHAR(20),
    provider_id_param INTEGER DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    sync_log_id UUID;
BEGIN
    INSERT INTO game_sync_logs (sync_type, provider_id, sync_status)
    VALUES (sync_type_param, provider_id_param, 'in_progress')
    RETURNING id INTO sync_log_id;
    
    RETURN sync_log_id;
END;
$$ LANGUAGE plpgsql;

-- 10. 게임 동기화 완료 함수
CREATE OR REPLACE FUNCTION complete_game_sync(
    sync_log_id_param UUID,
    total_games_param INTEGER,
    new_games_param INTEGER,
    updated_games_param INTEGER,
    failed_games_param INTEGER,
    error_message_param TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE game_sync_logs
    SET 
        total_games = total_games_param,
        new_games = new_games_param,
        updated_games = updated_games_param,
        failed_games = failed_games_param,
        sync_status = CASE WHEN failed_games_param > 0 THEN 'failed' ELSE 'completed' END,
        error_message = error_message_param,
        completed_at = NOW()
    WHERE id = sync_log_id_param;
END;
$$ LANGUAGE plpgsql;

-- 11. 게임 Upsert 함수 (동기화시 사용)
CREATE OR REPLACE FUNCTION upsert_game(
    external_id_param VARCHAR(100),
    provider_id_param INTEGER,
    name_param VARCHAR(200),
    type_param VARCHAR(20),
    image_url_param TEXT DEFAULT NULL,
    demo_available_param BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER AS $$
DECLARE
    game_id_result INTEGER;
BEGIN
    -- external_id 기준으로 upsert
    INSERT INTO games (id, provider_id, name, type, image_url, demo_available, external_id, last_sync_at)
    VALUES (
        CAST(external_id_param AS INTEGER), -- external_id를 id로 사용
        provider_id_param, 
        name_param, 
        type_param, 
        image_url_param, 
        demo_available_param,
        external_id_param,
        NOW()
    )
    ON CONFLICT (id) 
    DO UPDATE SET
        name = EXCLUDED.name,
        image_url = EXCLUDED.image_url,
        demo_available = EXCLUDED.demo_available,
        last_sync_at = NOW(),
        updated_at = NOW()
    RETURNING id INTO game_id_result;
    
    RETURN game_id_result;
END;
$$ LANGUAGE plpgsql;

-- 12. RLS 정책 설정 (organization_game_status)
ALTER TABLE organization_game_status ENABLE ROW LEVEL SECURITY;

-- 시스템 관리자는 모든 조직의 게임 상태 관리 가능
CREATE POLICY "System admin can manage all organization game status"
ON organization_game_status
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM partners p
        WHERE p.id = auth.uid()::uuid
        AND p.level = 1
    )
);

-- 대본사는 자신의 게임 상태만 관리 가능
CREATE POLICY "Organization admin can manage own game status"
ON organization_game_status
FOR ALL
TO authenticated
USING (
    organization_id IN (
        SELECT id FROM partners
        WHERE id = auth.uid()::uuid
        AND level = 2
    )
);

-- 하위 조직은 자신이 속한 대본사의 게임 상태 조회만 가능
CREATE POLICY "Partners can view their organization game status"
ON organization_game_status
FOR SELECT
TO authenticated
USING (
    organization_id IN (
        -- 현재 파트너가 대본사면 자기 자신의 ID 반환
        -- 하위 조직이면 상위로 올라가면서 대본사 찾기
        WITH RECURSIVE partner_hierarchy AS (
            -- 현재 파트너
            SELECT id, parent_id, level
            FROM partners
            WHERE id = auth.uid()::uuid
            
            UNION ALL
            
            -- 부모 파트너들
            SELECT p.id, p.parent_id, p.level
            FROM partners p
            INNER JOIN partner_hierarchy ph ON p.id = ph.parent_id
        )
        SELECT id 
        FROM partner_hierarchy 
        WHERE level = 2 -- 대본사 레벨
        LIMIT 1
    )
);

-- 13. RLS 정책 설정 (game_sync_logs)
ALTER TABLE game_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view game sync logs"
ON game_sync_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM partners p
        WHERE p.id = auth.uid()::uuid
        AND p.level IN (1, 2) -- 시스템 관리자, 대본사만
    )
);

-- 14. 코멘트 추가
COMMENT ON TABLE organization_game_status IS '조직(대본사)별 게임 상태 오버라이드 설정';
COMMENT ON COLUMN organization_game_status.priority IS '게임 노출 순서 (높을수록 상위 노출)';
COMMENT ON TABLE game_sync_logs IS '게임 API 동기화 이력 추적';
COMMENT ON FUNCTION get_organization_games IS '조직별 게임 목록 조회 (상태 상속 로직 적용)';
COMMENT ON FUNCTION get_user_visible_games IS '사용자용 visible 게임만 조회';
COMMENT ON FUNCTION set_organization_game_status IS '조직별 게임 상태 설정';
COMMENT ON FUNCTION upsert_game IS 'API 동기화시 게임 정보 upsert';

-- 15. 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 조직별 게임 상태 관리 시스템 설정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '생성된 테이블:';
    RAISE NOTICE '- organization_game_status: 조직별 게임 상태 오버라이드';
    RAISE NOTICE '- game_sync_logs: 게임 동기화 이력';
    RAISE NOTICE '';
    RAISE NOTICE '주요 함수:';
    RAISE NOTICE '- get_organization_games(org_id, type): 조직별 게임 목록';
    RAISE NOTICE '- get_user_visible_games(user_id, type): 사용자용 visible 게임';
    RAISE NOTICE '- set_organization_game_status(org_id, game_id, status, priority): 상태 설정';
    RAISE NOTICE '- upsert_game(...): 게임 정보 동기화';
    RAISE NOTICE '- start_game_sync/complete_game_sync: 동기화 로그';
    RAISE NOTICE '';
    RAISE NOTICE '상태 상속 로직:';
    RAISE NOTICE '- organization_game_status에 설정 있으면 → 해당 설정 사용';
    RAISE NOTICE '- organization_game_status에 설정 없으면 → games.status 기본값 사용';
    RAISE NOTICE '============================================';
END $$;
