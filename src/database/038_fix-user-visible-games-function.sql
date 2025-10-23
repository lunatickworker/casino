-- ============================================================================
-- 044. get_user_visible_games 함수 수정
-- ============================================================================
-- 작성일: 2025-10-02
-- 목적: "User referrer not found" 오류 수정
-- ============================================================================

-- get_user_visible_games 함수 수정 (referrer_id 체크 제거)
CREATE OR REPLACE FUNCTION get_user_visible_games(
    user_id_param UUID,
    filter_game_type VARCHAR(20) DEFAULT NULL
)
RETURNS TABLE (
    game_id INTEGER,
    provider_id INTEGER,
    game_name VARCHAR(255),
    game_type VARCHAR(20),
    image_url TEXT,
    demo_available BOOLEAN,
    priority INTEGER
) AS $$
DECLARE
    user_org_id UUID;
    user_partner_id UUID;
BEGIN
    -- 사용자가 속한 파트너 조직 ID 가져오기
    -- users 테이블의 partner_id 또는 referrer_id 컬럼 사용
    SELECT COALESCE(partner_id, referrer_id) INTO user_partner_id
    FROM users
    WHERE id = user_id_param;

    -- 파트너 ID가 없는 경우 시스템 관리자 조직 사용
    IF user_partner_id IS NULL THEN
        RAISE NOTICE '⚠️ 사용자 %의 파트너 정보가 없습니다. 시스템 관리자 조직 사용', user_id_param;
        
        SELECT id INTO user_org_id
        FROM partners
        WHERE level = 1
        LIMIT 1;
    ELSE
        -- 파트너 계층을 따라 올라가며 대본사(level=2) 찾기
        WITH RECURSIVE partner_hierarchy AS (
            -- 현재 파트너
            SELECT id, parent_id, level
            FROM partners
            WHERE id = user_partner_id
            
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

        -- 대본사를 못 찾은 경우 시스템관리자 조직 사용
        IF user_org_id IS NULL THEN
            SELECT id INTO user_org_id
            FROM partners
            WHERE level = 1
            LIMIT 1;
        END IF;
    END IF;

    RAISE NOTICE '✅ 사용자 %의 조직 ID: %', user_id_param, user_org_id;

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

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 044. get_user_visible_games 함수 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. referrer_id NULL 체크 제거';
    RAISE NOTICE '2. COALESCE(partner_id, referrer_id) 사용';
    RAISE NOTICE '3. 파트너 정보 없을 경우 시스템 관리자 조직 사용';
    RAISE NOTICE '4. 디버깅용 NOTICE 추가';
    RAISE NOTICE '============================================';
END $$;
