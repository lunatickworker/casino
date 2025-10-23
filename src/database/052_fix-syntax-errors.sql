-- 050_enhanced-game-system.sql의 syntax error 수정
-- LINE 78 근처의 함수 정의 오류 수정

-- 1. 잘못된 함수들 삭제 후 재생성
DROP FUNCTION IF EXISTS get_game_status_for_partner(UUID, BIGINT);
DROP FUNCTION IF EXISTS get_user_visible_games(UUID, VARCHAR(20), BIGINT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS update_game_status_for_partner(UUID, BIGINT, VARCHAR(20), INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS save_game_sync_result(BIGINT, VARCHAR(50), VARCHAR(20), INTEGER, INTEGER, INTEGER, TEXT, INTEGER);

-- 2. 게임 상태 관리 함수 (올바른 syntax로 재생성)
CREATE OR REPLACE FUNCTION get_game_status_for_partner(
    p_partner_id UUID,
    p_game_id BIGINT
) RETURNS VARCHAR(20) AS $$
DECLARE
    custom_status VARCHAR(20);
    default_status VARCHAR(20);
BEGIN
    -- 파트너별 커스텀 상태 확인
    SELECT status INTO custom_status
    FROM game_status_logs 
    WHERE partner_id = p_partner_id AND game_id = p_game_id;
    
    IF custom_status IS NOT NULL THEN
        RETURN custom_status;
    END IF;
    
    -- 기본 상태 반환
    SELECT status INTO default_status
    FROM games 
    WHERE id = p_game_id;
    
    RETURN COALESCE(default_status, 'hidden');
END;
$$ LANGUAGE plpgsql;

-- 3. 사용자에게 보이는 게임 목록 조회 함수 (올바른 syntax로 재생성)
CREATE OR REPLACE FUNCTION get_user_visible_games(
    p_user_id UUID,
    p_game_type VARCHAR(20) DEFAULT NULL,
    p_provider_id BIGINT DEFAULT NULL,
    p_search_term TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    game_id BIGINT,
    provider_id BIGINT,
    provider_name VARCHAR(100),
    game_name VARCHAR(200),
    game_type VARCHAR(20),
    image_url TEXT,
    cached_image_url TEXT,
    is_featured BOOLEAN,
    rtp DECIMAL(5,2),
    status VARCHAR(20),
    priority INTEGER
) AS $$
DECLARE
    user_partner_id UUID;
BEGIN
    -- 사용자의 파트너 ID 조회
    SELECT referrer_id INTO user_partner_id
    FROM users 
    WHERE id = p_user_id;
    
    IF user_partner_id IS NULL THEN
        RAISE EXCEPTION 'User partner not found for user_id: %', p_user_id;
    END IF;
    
    RETURN QUERY
    SELECT 
        g.id as game_id,
        g.provider_id,
        gp.name as provider_name,
        g.name as game_name,
        g.type as game_type,
        g.image_url,
        gc.cached_url as cached_image_url,
        COALESCE(gsl.is_featured, g.is_featured) as is_featured,
        g.rtp,
        COALESCE(gsl.status, g.status) as status,
        COALESCE(gsl.priority, 0) as priority
    FROM games g
    JOIN game_providers gp ON g.provider_id = gp.id
    LEFT JOIN game_status_logs gsl ON gsl.game_id = g.id AND gsl.partner_id = user_partner_id
    LEFT JOIN game_cache gc ON gc.game_id = g.id AND gc.cache_type = 'image'
    WHERE 
        -- 게임 타입 필터
        (p_game_type IS NULL OR g.type = p_game_type)
        -- 제공사 필터
        AND (p_provider_id IS NULL OR g.provider_id = p_provider_id)
        -- 상태 필터 (visible만)
        AND COALESCE(gsl.status, g.status) = 'visible'
        -- 검색 필터
        AND (p_search_term IS NULL OR 
             g.name ILIKE '%' || p_search_term || '%' OR 
             gp.name ILIKE '%' || p_search_term || '%')
    ORDER BY 
        COALESCE(gsl.priority, 0) DESC, 
        COALESCE(gsl.is_featured, g.is_featured) DESC,
        g.play_count DESC,
        g.name
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- 4. 게임 상태 업데이트 함수 (올바른 syntax로 재생성)
CREATE OR REPLACE FUNCTION update_game_status_for_partner(
    p_partner_id UUID,
    p_game_id BIGINT,
    p_status VARCHAR(20),
    p_priority INTEGER DEFAULT NULL,
    p_is_featured BOOLEAN DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO game_status_logs (
        partner_id, 
        game_id, 
        status, 
        priority, 
        is_featured, 
        updated_at
    ) VALUES (
        p_partner_id,
        p_game_id,
        p_status,
        COALESCE(p_priority, 0),
        COALESCE(p_is_featured, false),
        NOW()
    )
    ON CONFLICT (partner_id, game_id) 
    DO UPDATE SET 
        status = EXCLUDED.status,
        priority = COALESCE(EXCLUDED.priority, game_status_logs.priority),
        is_featured = COALESCE(EXCLUDED.is_featured, game_status_logs.is_featured),
        updated_at = NOW();
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 5. 게임 동기화 결과 저장 함수 (올바른 syntax로 재생성)
CREATE OR REPLACE FUNCTION save_game_sync_result(
    p_provider_id BIGINT,
    p_opcode VARCHAR(50),
    p_sync_type VARCHAR(20),
    p_games_added INTEGER,
    p_games_updated INTEGER,
    p_games_removed INTEGER,
    p_error_message TEXT DEFAULT NULL,
    p_sync_duration INTEGER DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    sync_log_id BIGINT;
BEGIN
    INSERT INTO game_sync_logs (
        provider_id,
        opcode,
        sync_type,
        games_added,
        games_updated,
        games_removed,
        error_message,
        sync_duration,
        completed_at,
        status
    ) VALUES (
        p_provider_id,
        p_opcode,
        p_sync_type,
        p_games_added,
        p_games_updated,
        p_games_removed,
        p_error_message,
        p_sync_duration,
        NOW(),
        CASE WHEN p_error_message IS NULL THEN 'completed' ELSE 'failed' END
    ) RETURNING id INTO sync_log_id;
    
    RETURN sync_log_id;
END;
$$ LANGUAGE plpgsql;

-- 6. 기존 051에서 생성한 함수들도 확인 및 재생성
CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    session_id BIGINT;
BEGIN
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        status
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        p_balance_before,
        NOW(),
        'active'
    ) RETURNING id INTO session_id;
    
    RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- 7. 게임 실행 세션 종료 함수
CREATE OR REPLACE FUNCTION end_game_launch_session(
    p_session_id BIGINT,
    p_balance_after DECIMAL(15,2) DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE game_launch_sessions 
    SET 
        ended_at = NOW(),
        balance_after = p_balance_after,
        status = 'ended'
    WHERE id = p_session_id
    AND status = 'active';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 8. updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. 트리거 생성 (이미 존재할 수 있으므로 안전하게 처리)
DROP TRIGGER IF EXISTS update_game_status_logs_updated_at ON game_status_logs;
CREATE TRIGGER update_game_status_logs_updated_at
    BEFORE UPDATE ON game_status_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 완료 메시지
DO $
BEGIN
    RAISE NOTICE 'Syntax Error 수정 완료';
    RAISE NOTICE '- 모든 함수의 달러 쿼팅 구문 수정';
    RAISE NOTICE '- PostgreSQL 함수 정의 오류 해결';
    RAISE NOTICE '- 트리거 함수 재생성 완료';
END $;