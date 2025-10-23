-- 게임 시스템 개선을 위한 스키마 업데이트
-- 요구사항: Opcode별 게임 상태 관리, 이미지 URL 저장, 실시간 연동

-- 1. games 테이블에 필수 컬럼 추가
ALTER TABLE games 
ADD COLUMN IF NOT EXISTS external_game_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS category VARCHAR(50),
ADD COLUMN IF NOT EXISTS rtp DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS volatility VARCHAR(20),
ADD COLUMN IF NOT EXISTS min_bet DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS max_bet DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS play_count BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMP WITH TIME ZONE;

-- 2. game_status_logs 테이블 개선 (Opcode별 게임 상태 관리)
-- 기존 테이블 삭제 및 재생성
DROP TABLE IF EXISTS game_status_logs CASCADE;

CREATE TABLE game_status_logs (
    id BIGSERIAL PRIMARY KEY,
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'visible', -- visible, hidden, maintenance
    priority INTEGER DEFAULT 0, -- 노출 순서
    is_featured BOOLEAN DEFAULT false, -- 추천 게임 여부
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(partner_id, game_id)
);

-- 3. game_sync_logs 테이블 (API 동기화 로그)
CREATE TABLE IF NOT EXISTS game_sync_logs (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES game_providers(id),
    opcode VARCHAR(50),
    sync_type VARCHAR(20) NOT NULL, -- full, incremental
    games_added INTEGER DEFAULT 0,
    games_updated INTEGER DEFAULT 0,
    games_removed INTEGER DEFAULT 0,
    error_message TEXT,
    sync_duration INTEGER, -- milliseconds
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'in_progress' -- in_progress, completed, failed
);

-- 4. game_launch_sessions 테이블 (게임 실행 세션 관리)
CREATE TABLE IF NOT EXISTS game_launch_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    game_id BIGINT NOT NULL REFERENCES games(id),
    opcode VARCHAR(50) NOT NULL,
    launch_url TEXT,
    session_token VARCHAR(255),
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    launched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'active' -- active, ended, error
);

-- 5. game_cache 테이블 (게임 이미지 및 데이터 캐싱)
CREATE TABLE IF NOT EXISTS game_cache (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games(id),
    cache_type VARCHAR(50) NOT NULL, -- image, metadata, launch_url
    original_url TEXT,
    cached_url TEXT,
    cache_size BIGINT,
    mime_type VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(game_id, cache_type)
);

-- 6. 게임 상태 관리 함수
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

-- 7. 사용자에게 보이는 게임 목록 조회 함수 (개선)
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
    opcode_info JSON;
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

-- 8. 게임 상태 업데이트 함수
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

-- 9. 게임 동기화 결과 저장 함수
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

-- 10. 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_game_status_logs_partner_game ON game_status_logs(partner_id, game_id);
CREATE INDEX IF NOT EXISTS idx_game_status_logs_status ON game_status_logs(status);
CREATE INDEX IF NOT EXISTS idx_games_type_status ON games(type, status);
CREATE INDEX IF NOT EXISTS idx_games_provider_type ON games(provider_id, type);
CREATE INDEX IF NOT EXISTS idx_game_cache_game_type ON game_cache(game_id, cache_type);
CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_user_game ON game_launch_sessions(user_id, game_id);

-- 11. RLS 정책 설정
ALTER TABLE game_status_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_launch_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_cache ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS game_status_logs_policy ON game_status_logs;
DROP POLICY IF EXISTS game_sync_logs_policy ON game_sync_logs;
DROP POLICY IF EXISTS game_launch_sessions_policy ON game_launch_sessions;
DROP POLICY IF EXISTS game_cache_policy ON game_cache;

-- 게임 상태 로그 정책
CREATE POLICY game_status_logs_policy ON game_status_logs
FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM partners p 
        WHERE p.id = game_status_logs.partner_id
        AND (
            p.partner_type IN ('system_admin', 'head_office')
            OR p.id IN (
                SELECT referrer_id FROM users WHERE id = auth.uid()
            )
        )
    )
);

-- 게임 동기화 로그 정책 (관리자만)
CREATE POLICY game_sync_logs_policy ON game_sync_logs
FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM partners p 
        WHERE p.id IN (
            SELECT referrer_id FROM users WHERE id = auth.uid()
        )
        AND p.partner_type IN ('system_admin', 'head_office')
    )
);

-- 게임 실행 세션 정책
CREATE POLICY game_launch_sessions_policy ON game_launch_sessions
FOR ALL TO authenticated
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM partners p 
        WHERE p.id IN (
            SELECT referrer_id FROM users WHERE id = auth.uid()
        )
        AND p.partner_type IN ('system_admin', 'head_office', 'main_office')
    )
);

-- 게임 캐시 정책 (모든 인증된 사용자 읽기 가능)
CREATE POLICY game_cache_policy ON game_cache
FOR SELECT TO authenticated
USING (true);

-- 12. 트리거 설정 (updated_at 자동 업데이트)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_game_status_logs_updated_at ON game_status_logs;

CREATE TRIGGER update_game_status_logs_updated_at
    BEFORE UPDATE ON game_status_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 13. 기본 데이터 설정
-- 시스템 관리자의 모든 게임을 기본으로 visible 상태로 설정
DO $$
DECLARE
    system_admin_id UUID;
BEGIN
    -- 시스템 관리자 ID 찾기
    SELECT id INTO system_admin_id
    FROM partners
    WHERE partner_type = 'system_admin' AND username = 'sadmin'
    LIMIT 1;
    
    IF system_admin_id IS NOT NULL THEN
        INSERT INTO game_status_logs (partner_id, game_id, status, priority)
        SELECT 
            system_admin_id as partner_id,
            g.id as game_id,
            'visible' as status,
            0 as priority
        FROM games g
        WHERE NOT EXISTS (
            SELECT 1 FROM game_status_logs gsl 
            WHERE gsl.partner_id = system_admin_id AND gsl.game_id = g.id
        );
        
        RAISE NOTICE 'System admin game status initialized for partner: %', system_admin_id;
    ELSE
        RAISE NOTICE 'System admin not found, skipping game status initialization';
    END IF;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ 게임 시스템 개선 스키마 적용 완료';
    RAISE NOTICE '- Opcode별 게임 상태 관리 시스템 구축';
    RAISE NOTICE '- 게임 캐시 및 이미지 URL 관리';
    RAISE NOTICE '- 실시간 동기화 로그 시스템';
    RAISE NOTICE '- 게임 실행 세션 추적';
    RAISE NOTICE '- 성능 최적화 인덱스 추가';
END $$;
