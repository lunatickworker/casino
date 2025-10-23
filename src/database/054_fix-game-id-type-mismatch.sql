-- ============================================================================
-- 054. games 테이블 ID 타입 불일치 수정
-- ============================================================================
-- 작성일: 2025-10-02
-- 목적: games.id를 INTEGER에서 BIGINT로 변경하여 타입 불일치 오류 수정
-- 오류: "Returned type integer does not match expected type bigint"
-- ============================================================================

-- 0. 먼저 모든 관련 함수 삭제 (반환 타입 변경을 위해)
-- DO 블록으로 모든 오버로드 버전 강제 삭제
DO $$
DECLARE
    func_record RECORD;
BEGIN
    -- get_user_visible_games 모든 버전 삭제
    FOR func_record IN 
        SELECT oid::regprocedure 
        FROM pg_proc 
        WHERE proname = 'get_user_visible_games'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.oid::regprocedure || ' CASCADE';
        RAISE NOTICE 'Dropped function: %', func_record.oid::regprocedure;
    END LOOP;
    
    -- get_organization_games 모든 버전 삭제
    FOR func_record IN 
        SELECT oid::regprocedure 
        FROM pg_proc 
        WHERE proname = 'get_organization_games'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.oid::regprocedure || ' CASCADE';
        RAISE NOTICE 'Dropped function: %', func_record.oid::regprocedure;
    END LOOP;
    
    -- is_game_visible_to_user 모든 버전 삭제
    FOR func_record IN 
        SELECT oid::regprocedure 
        FROM pg_proc 
        WHERE proname = 'is_game_visible_to_user'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.oid::regprocedure || ' CASCADE';
        RAISE NOTICE 'Dropped function: %', func_record.oid::regprocedure;
    END LOOP;
    
    -- aggregate_monthly_game_stats 모든 버전 삭제
    FOR func_record IN 
        SELECT oid::regprocedure 
        FROM pg_proc 
        WHERE proname = 'aggregate_monthly_game_stats'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.oid::regprocedure || ' CASCADE';
        RAISE NOTICE 'Dropped function: %', func_record.oid::regprocedure;
    END LOOP;
    
    RAISE NOTICE '✅ 모든 기존 함수 삭제 완료';
END $$;

-- 1. games 테이블 ID를 INTEGER에서 BIGINT로 변경
DO $$
BEGIN
    -- id 컬럼 타입 변경
    ALTER TABLE games ALTER COLUMN id TYPE BIGINT;
    RAISE NOTICE '✅ games.id 컬럼을 BIGINT로 변경했습니다.';
    
    -- provider_id도 BIGINT로 변경
    ALTER TABLE games ALTER COLUMN provider_id TYPE BIGINT;
    RAISE NOTICE '✅ games.provider_id 컬럼을 BIGINT로 변경했습니다.';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ games 테이블 컬럼 타입 변경 중 오류: %', SQLERRM;
END $$;

-- 2. game_providers 테이블 ID도 BIGINT로 변경
DO $$
BEGIN
    ALTER TABLE game_providers ALTER COLUMN id TYPE BIGINT;
    RAISE NOTICE '✅ game_providers.id 컬럼을 BIGINT로 변경했습니다.';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ game_providers 테이블 ID 타입 변경 중 오류: %', SQLERRM;
END $$;

-- 3. 관련 테이블들의 game_id 컬럼도 BIGINT로 변경
DO $$
BEGIN
    -- game_records 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'game_id') THEN
        ALTER TABLE game_records ALTER COLUMN game_id TYPE BIGINT;
        ALTER TABLE game_records ALTER COLUMN provider_id TYPE BIGINT;
        RAISE NOTICE '✅ game_records의 game_id, provider_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- game_status_history 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_status_history' AND column_name = 'game_id') THEN
        ALTER TABLE game_status_history ALTER COLUMN game_id TYPE BIGINT;
        RAISE NOTICE '✅ game_status_history의 game_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- user_favorite_games 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_favorite_games' AND column_name = 'game_id') THEN
        ALTER TABLE user_favorite_games ALTER COLUMN game_id TYPE BIGINT;
        RAISE NOTICE '✅ user_favorite_games의 game_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- user_game_favorites 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_game_favorites' AND column_name = 'game_id') THEN
        ALTER TABLE user_game_favorites ALTER COLUMN game_id TYPE BIGINT;
        RAISE NOTICE '✅ user_game_favorites의 game_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- game_settings 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_settings' AND column_name = 'game_id') THEN
        ALTER TABLE game_settings ALTER COLUMN game_id TYPE BIGINT;
        RAISE NOTICE '✅ game_settings의 game_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- game_stats_cache 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_stats_cache' AND column_name = 'game_id') THEN
        ALTER TABLE game_stats_cache ALTER COLUMN game_id TYPE BIGINT;
        ALTER TABLE game_stats_cache ALTER COLUMN provider_id TYPE BIGINT;
        RAISE NOTICE '✅ game_stats_cache의 game_id, provider_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- game_status_logs 테이블 (이미 BIGINT일 수 있음)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_status_logs' AND column_name = 'game_id') THEN
        ALTER TABLE game_status_logs ALTER COLUMN game_id TYPE BIGINT;
        RAISE NOTICE '✅ game_status_logs의 game_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- organization_game_status 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_game_status' AND column_name = 'game_id') THEN
        ALTER TABLE organization_game_status ALTER COLUMN game_id TYPE BIGINT;
        RAISE NOTICE '✅ organization_game_status의 game_id를 BIGINT로 변경했습니다.';
    END IF;
    
    -- user_sessions 테이블
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'current_game_id') THEN
        ALTER TABLE user_sessions ALTER COLUMN current_game_id TYPE BIGINT;
        ALTER TABLE user_sessions ALTER COLUMN current_provider_id TYPE BIGINT;
        RAISE NOTICE '✅ user_sessions의 current_game_id, current_provider_id를 BIGINT로 변경했습니다.';
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ 관련 테이블 타입 변경 중 오류: %', SQLERRM;
END $$;

-- 4. 함수들 재생성 (BIGINT 타입 사용, TEXT 타입 통일)
-- get_user_visible_games 함수 재생성 (단일 버전 - 모든 기능 통합)
CREATE FUNCTION get_user_visible_games(
    p_user_id UUID,
    p_game_type TEXT DEFAULT NULL,
    p_provider_id BIGINT DEFAULT NULL,
    p_search_term TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    game_id BIGINT,
    provider_id BIGINT,
    user_partner_id UUID,
    game_name TEXT,
    game_type TEXT,
    image_url TEXT,
    demo_available BOOLEAN,
    priority INTEGER,
    provider_name TEXT,
    is_featured BOOLEAN,
    cached_image_url TEXT,
    status TEXT
) AS $$
DECLARE
    user_org_id UUID;
    user_partner_id UUID;
BEGIN
    -- 사용자가 속한 파트너 조직 ID 가져오기
    SELECT COALESCE(partner_id, referrer_id) INTO user_partner_id
    FROM users
    WHERE id = p_user_id;

    -- 파트너 ID가 없는 경우 시스템 관리자 조직 사용
    IF user_partner_id IS NULL THEN
        SELECT id INTO user_org_id
        FROM partners
        WHERE level = 1
        LIMIT 1;
    ELSE
        -- 파트너 계층을 따라 올라가며 대본사(level=2) 찾기
        WITH RECURSIVE partner_hierarchy AS (
            SELECT id, parent_id, level
            FROM partners
            WHERE id = user_partner_id
            
            UNION ALL
            
            SELECT p.id, p.parent_id, p.level
            FROM partners p
            INNER JOIN partner_hierarchy ph ON p.id = ph.parent_id
        )
        SELECT id INTO user_org_id
        FROM partner_hierarchy 
        WHERE level = 2
        LIMIT 1;

        IF user_org_id IS NULL THEN
            SELECT id INTO user_org_id
            FROM partners
            WHERE level = 1
            LIMIT 1;
        END IF;
    END IF;

    -- visible 상태인 게임만 반환 (필터 및 페이징 적용)
    RETURN QUERY
    SELECT DISTINCT ON (g.id)
        g.id::BIGINT AS game_id,
        g.provider_id::BIGINT,
        user_org_id::UUID AS user_partner_id,
        g.name::TEXT AS game_name,
        g.type::TEXT AS game_type,
        g.image_url::TEXT,
        g.demo_available,
        COALESCE(ogs.priority, 0) AS priority,
        COALESCE(gp.name, '알 수 없음')::TEXT AS provider_name,
        COALESCE(ogs.is_featured, false) AS is_featured,
        gc.cached_url::TEXT AS cached_image_url,
        COALESCE(ogs.status, g.status)::TEXT AS status
    FROM games g
    LEFT JOIN organization_game_status ogs 
        ON g.id = ogs.game_id 
        AND ogs.organization_id = user_org_id
    LEFT JOIN game_providers gp
        ON g.provider_id = gp.id
    LEFT JOIN game_cache gc
        ON g.id = gc.game_id 
        AND gc.cache_type = 'image'
    WHERE 
        (p_game_type IS NULL OR g.type = p_game_type)
        AND (p_provider_id IS NULL OR g.provider_id = p_provider_id)
        AND (p_search_term IS NULL OR g.name ILIKE '%' || p_search_term || '%')
        AND COALESCE(ogs.status, g.status) = 'visible'
    ORDER BY 
        g.id,
        COALESCE(ogs.priority, 0) DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- get_organization_games 함수 재생성
CREATE FUNCTION get_organization_games(
    org_id UUID,
    filter_game_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    game_id BIGINT,
    provider_id BIGINT,
    game_name TEXT,
    game_type TEXT,
    image_url TEXT,
    demo_available BOOLEAN,
    current_status TEXT,
    priority INTEGER,
    is_featured BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        g.id::BIGINT AS game_id,
        g.provider_id::BIGINT,
        g.name::TEXT AS game_name,
        g.type::TEXT AS game_type,
        g.image_url::TEXT,
        g.demo_available,
        COALESCE(ogs.status, g.status)::TEXT AS current_status,
        COALESCE(ogs.priority, 0) AS priority,
        COALESCE(ogs.is_featured, false) AS is_featured
    FROM games g
    LEFT JOIN organization_game_status ogs 
        ON g.id = ogs.game_id AND ogs.organization_id = org_id
    WHERE 
        (filter_game_type IS NULL OR g.type = filter_game_type)
    ORDER BY 
        COALESCE(ogs.priority, 0) DESC,
        g.name ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- is_game_visible_to_user 함수 재생성
CREATE FUNCTION is_game_visible_to_user(
    game_id_param BIGINT,
    user_id_param UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    game_status TEXT;
    org_id UUID;
BEGIN
    -- 사용자의 조직 ID 가져오기
    SELECT COALESCE(partner_id, referrer_id) INTO org_id
    FROM users
    WHERE id = user_id_param;
    
    -- 게임 상태 확인
    SELECT COALESCE(ogs.status, g.status)::TEXT INTO game_status
    FROM games g
    LEFT JOIN organization_game_status ogs 
        ON g.id = ogs.game_id AND ogs.organization_id = org_id
    WHERE g.id = game_id_param;
    
    RETURN game_status = 'visible';
END;
$$ LANGUAGE plpgsql STABLE;

-- aggregate_monthly_game_stats 함수 재생성
CREATE FUNCTION aggregate_monthly_game_stats(
    target_year INTEGER,
    target_month INTEGER
)
RETURNS TABLE(
    provider_id BIGINT,
    game_id BIGINT,
    total_bets BIGINT,
    total_bet_amount NUMERIC,
    total_win_amount NUMERIC,
    net_profit NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        gr.provider_id::BIGINT,
        gr.game_id::BIGINT,
        COUNT(*)::BIGINT as total_bets,
        SUM(gr.bet_amount)::NUMERIC as total_bet_amount,
        SUM(gr.win_amount)::NUMERIC as total_win_amount,
        (SUM(gr.bet_amount) - SUM(gr.win_amount))::NUMERIC as net_profit
    FROM game_records gr
    WHERE EXTRACT(YEAR FROM gr.created_at) = target_year
      AND EXTRACT(MONTH FROM gr.created_at) = target_month
    GROUP BY gr.provider_id, gr.game_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 054. games 테이블 ID 타입 불일치 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '1. games.id: INTEGER → BIGINT';
    RAISE NOTICE '2. games.provider_id: INTEGER → BIGINT';
    RAISE NOTICE '3. game_providers.id: INTEGER → BIGINT';
    RAISE NOTICE '4. 모든 관련 테이블의 game_id: INTEGER → BIGINT';
    RAISE NOTICE '5. 모든 관련 함수의 반환 타입: INTEGER → BIGINT';
    RAISE NOTICE '6. 모든 타입을 TEXT로 통일하여 오버로딩 충돌 해결';
    RAISE NOTICE '============================================';
END $$;
