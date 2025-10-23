-- games 테이블에 누락된 컬럼들 추가
-- 기존 001_database-schema.sql의 games 테이블을 050에서 요구하는 구조로 확장

-- 1. games 테이블에 누락된 컬럼들 추가
ALTER TABLE games 
ADD COLUMN IF NOT EXISTS external_game_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS category VARCHAR(50),
ADD COLUMN IF NOT EXISTS rtp DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS volatility VARCHAR(20),
ADD COLUMN IF NOT EXISTS min_bet DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS max_bet DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS play_count BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'visible',
ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'slot';

-- 2. game_providers 테이블에 누락된 컬럼 추가 (이미 있을 수 있지만 안전하게)
ALTER TABLE game_providers 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. game_status_logs 테이블 구조 확인 및 조정
-- 기존 테이블에서 partner_id 컬럼이 없다면 추가
DO $$
BEGIN
    -- partner_id 컬럼이 없다면 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_status_logs' 
        AND column_name = 'partner_id'
    ) THEN
        -- organization_id가 있다면 partner_id로 변경
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_status_logs' 
            AND column_name = 'organization_id'
        ) THEN
            ALTER TABLE game_status_logs RENAME COLUMN organization_id TO partner_id;
            ALTER TABLE game_status_logs ALTER COLUMN partner_id TYPE UUID;
            RAISE NOTICE 'organization_id를 partner_id로 변경했습니다.';
        ELSE
            -- partner_id 컬럼 추가
            ALTER TABLE game_status_logs ADD COLUMN partner_id UUID REFERENCES partners(id) ON DELETE CASCADE;
            RAISE NOTICE 'partner_id 컬럼을 추가했습니다.';
        END IF;
    END IF;
    
    -- 테이블이 아예 없다면 생성
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_status_logs') THEN
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
        RAISE NOTICE 'game_status_logs 테이블을 생성했습니다.';
    END IF;
END $$;

-- 4. game_sync_logs 테이블 구조 확인 및 조정
DO $$
BEGIN
    -- 테이블이 없다면 생성
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_sync_logs') THEN
        CREATE TABLE game_sync_logs (
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
        RAISE NOTICE 'game_sync_logs 테이블을 생성했습니다.';
    ELSE
        -- 기존 테이블에 opcode 컬럼이 없다면 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_sync_logs' 
            AND column_name = 'opcode'
        ) THEN
            ALTER TABLE game_sync_logs ADD COLUMN opcode VARCHAR(50);
            RAISE NOTICE 'game_sync_logs에 opcode 컬럼을 추가했습니다.';
        END IF;
        
        -- 기타 누락된 컬럼들 확인 및 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_sync_logs' 
            AND column_name = 'sync_duration'
        ) THEN
            ALTER TABLE game_sync_logs ADD COLUMN sync_duration INTEGER;
            RAISE NOTICE 'game_sync_logs에 sync_duration 컬럼을 추가했습니다.';
        END IF;
        
        -- status 컬럼 확인 및 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_sync_logs' 
            AND column_name = 'status'
        ) THEN
            ALTER TABLE game_sync_logs ADD COLUMN status VARCHAR(20) DEFAULT 'in_progress';
            RAISE NOTICE 'game_sync_logs에 status 컬럼을 추가했습니다.';
        END IF;
    END IF;
END $$;

-- 5. game_cache 테이블 생성
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

-- 6. 인덱스 생성 (성능 최적화) - 안전하게 생성
-- games 테이블 인덱스 (컬럼 존재 여부 확인 후 생성)
DO $$
BEGIN
    -- type, status 컬럼이 모두 존재할 때만 인덱스 생성
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'type'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'status'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_games_type_status ON games(type, status);
        RAISE NOTICE 'games type_status 인덱스를 생성했습니다.';
    END IF;
    
    -- provider_id, type 컬럼이 모두 존재할 때만 인덱스 생성
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'provider_id'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'type'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_games_provider_type ON games(provider_id, type);
        RAISE NOTICE 'games provider_type 인덱스를 생성했습니다.';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_games_external_id ON games(external_game_id) WHERE external_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_featured ON games(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_games_play_count ON games(play_count DESC);

CREATE INDEX IF NOT EXISTS idx_game_status_logs_partner_game ON game_status_logs(partner_id, game_id);
CREATE INDEX IF NOT EXISTS idx_game_status_logs_status ON game_status_logs(status);

CREATE INDEX IF NOT EXISTS idx_game_sync_logs_provider ON game_sync_logs(provider_id);

-- game_sync_logs status 인덱스 (컬럼 존재 여부 확인 후 생성)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_sync_logs' AND column_name = 'status'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_game_sync_logs_status ON game_sync_logs(status);
        RAISE NOTICE 'game_sync_logs status 인덱스를 생성했습니다.';
    END IF;
END $$;

-- opcode 컬럼이 존재할 때만 인덱스 생성
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_sync_logs' 
        AND column_name = 'opcode'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_game_sync_logs_opcode ON game_sync_logs(opcode);
        RAISE NOTICE 'game_sync_logs opcode 인덱스를 생성했습니다.';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_cache_game_type ON game_cache(game_id, cache_type);

-- 7. RLS 정책 설정
ALTER TABLE game_status_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_cache ENABLE ROW LEVEL SECURITY;

-- 게임 상태 로그 정책
DROP POLICY IF EXISTS game_status_logs_policy ON game_status_logs;
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
DROP POLICY IF EXISTS game_sync_logs_policy ON game_sync_logs;
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

-- 게임 캐시 정책 (모든 인증된 사용자 읽기 가능)
DROP POLICY IF EXISTS game_cache_policy ON game_cache;
CREATE POLICY game_cache_policy ON game_cache
FOR SELECT TO authenticated
USING (true);

-- 8. 기본 데이터 설정 (시스템 관리자의 모든 게임을 visible 상태로 설정)
DO $$
DECLARE
    system_admin_id UUID;
    admin_count INTEGER;
BEGIN
    -- 시스템 관리자 ID 찾기
    SELECT id INTO system_admin_id
    FROM partners
    WHERE partner_type = 'system_admin' AND username = 'sadmin'
    LIMIT 1;
    
    IF system_admin_id IS NOT NULL THEN
        -- partner_id 컬럼이 존재하는지 확인
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_status_logs' 
            AND column_name = 'partner_id'
        ) THEN
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
            
            GET DIAGNOSTICS admin_count = ROW_COUNT;
            RAISE NOTICE '시스템 관리자 게임 상태 초기화 완료: % (% 게임)', system_admin_id, admin_count;
        ELSE
            RAISE NOTICE 'partner_id 컬럼이 없어서 게임 상태 초기화를 생략합니다.';
        END IF;
    ELSE
        RAISE NOTICE '시스템 관리자를 찾을 수 없습니다. 게임 상태 초기화 생략';
    END IF;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ games 테이블 컬럼 확장 완료';
    RAISE NOTICE '- external_game_id, category, rtp, volatility 등 게임 상세 정보 컬럼 추가';
    RAISE NOTICE '- is_featured, play_count 등 운영 관련 컬럼 추가';
    RAISE NOTICE '- game_status_logs, game_sync_logs, game_cache 테이블 생성 또는 조정';
    RAISE NOTICE '- 성능 최적화 인덱스 추가';
    RAISE NOTICE '- RLS 정책 설정 완료';
END $$;