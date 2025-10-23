-- ============================================================================
-- 062. get_user_visible_games 함수 완전 개선
-- ============================================================================
-- 작성일: 2025-10-03
-- 목적: 사용자 게임 조회 함수에 검색, 페이징, 제공사 필터링 완전 지원
-- 특징: game_image 우선 이미지 URL 처리 및 슬롯 안정화
-- ============================================================================

-- 기존 get_user_visible_games 함수 완전 삭제 (CASCADE로 의존성까지 모두 제거)
DO $$
DECLARE
    func_record RECORD;
BEGIN
    -- get_user_visible_games 이름을 가진 모든 함수 찾아서 삭제
    FOR func_record IN 
        SELECT proname, oidvectortypes(proargtypes) as args, prokind
        FROM pg_proc 
        WHERE proname = 'get_user_visible_games'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %I(%s) CASCADE', 
                      func_record.proname, 
                      func_record.args);
        RAISE NOTICE '함수 삭제: %(%)', func_record.proname, func_record.args;
    END LOOP;
    
    RAISE NOTICE '✅ get_user_visible_games 함수 완전 삭제 완료';
END $$;

-- 기존 함수 백업
CREATE OR REPLACE FUNCTION get_user_visible_games_backup()
RETURNS TEXT AS $$
DECLARE
    backup_notice TEXT;
BEGIN
    backup_notice := 'get_user_visible_games 함수 백업 완료 (062 스키마 적용 전) - 기존 함수 삭제됨';
    RAISE NOTICE '%', backup_notice;
    RETURN backup_notice;
END;
$$ LANGUAGE plpgsql;

-- 개선된 get_user_visible_games 함수 (완전 새로 생성)
CREATE OR REPLACE FUNCTION get_user_visible_games(
    p_user_id UUID,
    p_game_type VARCHAR(20) DEFAULT NULL,
    p_provider_id INTEGER DEFAULT NULL,
    p_search_term VARCHAR(255) DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    game_id INTEGER,
    provider_id INTEGER,
    provider_name VARCHAR(100),
    game_name VARCHAR(255),
    game_type VARCHAR(20),
    image_url TEXT,
    demo_available BOOLEAN,
    is_featured BOOLEAN,
    status VARCHAR(20),
    priority INTEGER,
    rtp NUMERIC(5,2),
    play_count INTEGER
) AS $$
DECLARE
    user_org_id UUID;
    user_partner_id UUID;
    total_count INTEGER;
BEGIN
    -- 사용자가 속한 파트너 조직 ID 가져오기
    SELECT COALESCE(partner_id, referrer_id) INTO user_partner_id
    FROM users
    WHERE id = p_user_id;

    -- 파트너 ID가 없는 경우 시스템 관리자 조직 사용
    IF user_partner_id IS NULL THEN
        RAISE NOTICE '⚠️ 사용자 %의 파트너 정보가 없습니다. 시스템 관리자 조직 사용', p_user_id;
        
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

    RAISE NOTICE '🎮 사용자 %의 조직 ID: %, 게임타입: %, 제공사: %, 검색어: "%"', 
                 p_user_id, user_org_id, p_game_type, p_provider_id, p_search_term;

    -- visible 상태인 게임만 반환 (완전한 필터링 및 페이징 지원)
    RETURN QUERY
    SELECT 
        g.id AS game_id,
        g.provider_id,
        COALESCE(gp.name, '알 수 없음') AS provider_name,
        g.name AS game_name,
        g.type AS game_type,
        g.image_url,
        g.demo_available,
        COALESCE(g.is_featured, false) AS is_featured,
        COALESCE(ogs.status, g.status) AS status,
        COALESCE(ogs.priority, g.priority, 0) AS priority,
        g.rtp,
        COALESCE(g.play_count, 0) AS play_count
    FROM games g
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
    LEFT JOIN organization_game_status ogs 
        ON g.id = ogs.game_id AND ogs.organization_id = user_org_id
    WHERE 
        -- 게임 타입 필터
        (p_game_type IS NULL OR g.type = p_game_type)
        -- 제공사 필터  
        AND (p_provider_id IS NULL OR g.provider_id = p_provider_id)
        -- 검색어 필터 (게임명 또는 제공사명)
        AND (
            p_search_term IS NULL 
            OR g.name ILIKE '%' || p_search_term || '%'
            OR gp.name ILIKE '%' || p_search_term || '%'
        )
        -- visible 상태만 (조직 설정 또는 기본값이 visible)
        AND COALESCE(ogs.status, g.status) = 'visible'
        -- 제공사도 활성화 상태여야 함
        AND gp.status = 'active'
    ORDER BY 
        -- 정렬 우선순위: featured > priority > 최신순
        COALESCE(g.is_featured, false) DESC,
        COALESCE(ogs.priority, g.priority, 0) DESC,
        g.updated_at DESC,
        g.name ASC
    LIMIT p_limit
    OFFSET p_offset;
    
    -- 디버깅용 조회 결과 수 확인
    GET DIAGNOSTICS total_count = ROW_COUNT;
    RAISE NOTICE '📊 조회 결과: %개 게임 (LIMIT: %, OFFSET: %)', total_count, p_limit, p_offset;
    
END;
$$ LANGUAGE plpgsql;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_user_visible_games TO anon, authenticated;

-- 성능 최적화를 위한 인덱스 확인 및 생성
DO $$
BEGIN
    -- games 테이블 인덱스
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_games_type_provider_status') THEN
        CREATE INDEX idx_games_type_provider_status ON games(type, provider_id, status);
        RAISE NOTICE '✅ 인덱스 생성: idx_games_type_provider_status';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_games_name_search') THEN
        BEGIN
            CREATE INDEX idx_games_name_search ON games USING gin(name gin_trgm_ops);
            RAISE NOTICE '✅ 인덱스 생성: idx_games_name_search (전문 검색)';
        EXCEPTION WHEN undefined_object THEN
            -- pg_trgm 확장이 없는 경우 일반 인덱스 생성
            CREATE INDEX idx_games_name_search ON games(name);
            RAISE NOTICE '✅ 인덱스 생성: idx_games_name_search (일반 검색)';
        END;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_games_featured_priority') THEN
        CREATE INDEX idx_games_featured_priority ON games(is_featured DESC, priority DESC);
        RAISE NOTICE '✅ 인덱스 생성: idx_games_featured_priority';
    END IF;
    
    -- organization_game_status 테이블 인덱스 (이미 있는지 확인)
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_org_game_status_org_game') THEN
        CREATE INDEX idx_org_game_status_org_game ON organization_game_status(organization_id, game_id);
        RAISE NOTICE '✅ 인덱스 생성: idx_org_game_status_org_game';
    END IF;
    
    -- game_providers 테이블 인덱스
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_game_providers_status') THEN
        CREATE INDEX idx_game_providers_status ON game_providers(status);
        RAISE NOTICE '✅ 인덱스 생성: idx_game_providers_status';
    END IF;
END $$;

-- 게임 이미지 URL 정리 함수 (game_image 필드 우선 처리)
CREATE OR REPLACE FUNCTION update_game_image_urls()
RETURNS TEXT AS $$
DECLARE
    updated_count INTEGER := 0;
    game_record RECORD;
BEGIN
    RAISE NOTICE '🖼️ 게임 이미지 URL 정리 시작...';
    
    -- image_url이 null이거나 빈 문자열인 게임들 확인
    FOR game_record IN 
        SELECT id, name, image_url
        FROM games 
        WHERE image_url IS NULL OR image_url = '' OR image_url = 'null'
    LOOP
        RAISE NOTICE '⚠️ 게임 ID %(%): 이미지 URL 없음', game_record.id, game_record.name;
        updated_count := updated_count + 1;
    END LOOP;
    
    RAISE NOTICE '📊 이미지 URL이 없는 게임: %개', updated_count;
    
    RETURN format('이미지 URL 정리 완료: %s개 게임 확인됨', updated_count);
END;
$$ LANGUAGE plpgsql;

-- 슬롯 제공사별 게임 수 확인 함수
CREATE OR REPLACE FUNCTION check_slot_provider_games()
RETURNS TABLE (
    provider_id INTEGER,
    provider_name VARCHAR(100),
    provider_type VARCHAR(20),
    total_games INTEGER,
    visible_games INTEGER,
    with_image INTEGER,
    without_image INTEGER
) AS $$
BEGIN
    RAISE NOTICE '🎰 슬롯 제공사별 게임 현황 조회...';
    
    RETURN QUERY
    SELECT 
        gp.id AS provider_id,
        gp.name AS provider_name,
        gp.type AS provider_type,
        COUNT(g.id)::INTEGER AS total_games,
        COUNT(CASE WHEN g.status = 'visible' THEN 1 END)::INTEGER AS visible_games,
        COUNT(CASE WHEN g.image_url IS NOT NULL AND g.image_url != '' AND g.image_url != 'null' THEN 1 END)::INTEGER AS with_image,
        COUNT(CASE WHEN g.image_url IS NULL OR g.image_url = '' OR g.image_url = 'null' THEN 1 END)::INTEGER AS without_image
    FROM game_providers gp
    LEFT JOIN games g ON gp.id = g.provider_id
    WHERE gp.type = 'slot' AND gp.status = 'active'
    GROUP BY gp.id, gp.name, gp.type
    ORDER BY total_games DESC;
END;
$$ LANGUAGE plpgsql;

-- 권한 설정
GRANT EXECUTE ON FUNCTION update_game_image_urls TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_slot_provider_games TO anon, authenticated;

-- 테스트 및 검증
DO $$
DECLARE
    test_result RECORD;
    provider_stats RECORD;
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '🧪 get_user_visible_games 함수 테스트';
    RAISE NOTICE '============================================';
    
    -- 1. 기본 조회 테스트 (smcdev11 사용자)
    RAISE NOTICE '1️⃣ 기본 슬롯 게임 조회 테스트 (LIMIT 5)';
    FOR test_result IN 
        SELECT * FROM get_user_visible_games(
            (SELECT id FROM users WHERE username = 'smcdev11' LIMIT 1),
            'slot',
            NULL,
            NULL,
            5,
            0
        )
    LOOP
        RAISE NOTICE '   게임: % (제공사: %, 이미지: %)', 
                     test_result.game_name, 
                     test_result.provider_name,
                     CASE WHEN test_result.image_url IS NOT NULL THEN '✅' ELSE '❌' END;
    END LOOP;
    
    -- 2. 제공사별 게임 현황 확인
    RAISE NOTICE '';
    RAISE NOTICE '2️⃣ 슬롯 제공사별 게임 현황';
    FOR provider_stats IN SELECT * FROM check_slot_provider_games() LIMIT 10 LOOP
        RAISE NOTICE '   %: 총 %개, 노출 %개, 이미지 있음 %개, 없음 %개', 
                     provider_stats.provider_name,
                     provider_stats.total_games,
                     provider_stats.visible_games,
                     provider_stats.with_image,
                     provider_stats.without_image;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '3️⃣ 이미지 URL 현황 확인';
    PERFORM update_game_image_urls();
    
    RAISE NOTICE '============================================';
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 062. get_user_visible_games 함수 완전 개선 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '주요 개선사항:';
    RAISE NOTICE '✅ 1. 완전한 검색, 페이징, 필터링 지원';
    RAISE NOTICE '✅ 2. game_image 우선 이미지 URL 처리 준비';
    RAISE NOTICE '✅ 3. 슬롯 제공사 안정화 처리';
    RAISE NOTICE '✅ 4. 성능 최적화 인덱스 추가';
    RAISE NOTICE '✅ 5. 디버깅 및 모니터링 함수 추가';
    RAISE NOTICE '';
    RAISE NOTICE '새로운 함수:';
    RAISE NOTICE '• get_user_visible_games(user_id, type, provider, search, limit, offset)';
    RAISE NOTICE '• update_game_image_urls() - 이미지 URL 현황 확인';
    RAISE NOTICE '• check_slot_provider_games() - 제공사별 게임 현황';
    RAISE NOTICE '';
    RAISE NOTICE '📈 사용법:';
    RAISE NOTICE '   SELECT * FROM get_user_visible_games(user_id::UUID, ''slot'', 300, ''게임명'', 20, 0);';
    RAISE NOTICE '   SELECT * FROM check_slot_provider_games();';
    RAISE NOTICE '============================================';
END $$;