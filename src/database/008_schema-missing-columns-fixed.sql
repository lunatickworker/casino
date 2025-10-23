-- 누락된 컬럼 및 스키마 추가를 위한 ALTER TABLE 구문 (오류 수정 버전)

-- 1. games 테이블에 필요한 인덱스가 이미 있는지 확인 후 추가
DO $$
BEGIN
    -- games 테이블의 provider_id, status 복합 인덱스
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_games_provider_status') THEN
        CREATE INDEX idx_games_provider_status ON games(provider_id, status);
    END IF;

    -- games 테이블의 type, status 복합 인덱스
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_games_type_status') THEN
        CREATE INDEX idx_games_type_status ON games(type, status);
    END IF;

    -- game_records 테이블의 provider_id, played_at 복합 인덱스
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_game_records_provider_played') THEN
        CREATE INDEX idx_game_records_provider_played ON game_records(provider_id, played_at);
    END IF;
END $$;

-- 2. 시스템 설정에 게임 관리 관련 설정 추가 (setting_key에 UNIQUE 제약조건이 있음)
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
('game_sync_enabled', 'true', 'boolean', '게임 자동 동기화 활성화', 2),
('game_sync_interval_minutes', '30', 'number', '게임 동기화 주기(분)', 2),
('betting_sync_interval_seconds', '30', 'number', '베팅 내역 동기화 주기(초)', 2),
('max_games_per_provider', '10000', 'number', '제공사당 최대 게임 수', 1),
('game_image_cache_enabled', 'true', 'boolean', '게임 이미지 캐시 사용', 3),
('betting_history_retention_days', '365', 'number', '베팅 내역 보관 일수', 1)
ON CONFLICT (setting_key) DO NOTHING;

-- 3. 메뉴 권한 테이블에 UNIQUE 제약조건 추가 (없는 경우에만)
DO $$
BEGIN
    -- menu_permissions 테이블에 복합 UNIQUE 제약조건 추가
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_permissions_unique_menu_path') THEN
        ALTER TABLE menu_permissions ADD CONSTRAINT menu_permissions_unique_menu_path UNIQUE (menu_name, menu_path);
    END IF;
END $$;

-- 게임 관리 세부 메뉴 추가 (이제 UNIQUE 제약조건이 있으므로 ON CONFLICT 사용 가능)
INSERT INTO menu_permissions (menu_name, menu_path, partner_level, display_order, parent_menu) VALUES
('게임 상태 관리', '/admin/game-status', 2, 503, '게임 관리'),
('게임 동기화', '/admin/game-sync', 2, 504, '게임 관리'),
('베팅 통계', '/admin/betting-stats', 2, 505, '게임 관리')
ON CONFLICT (menu_name, menu_path) DO NOTHING;

-- 4. 시스템관리자 비밀번호 업데이트 (username에 UNIQUE 제약조건이 있음)
INSERT INTO partners (username, nickname, password_hash, partner_type, level, status, balance, commission_rolling, commission_losing, withdrawal_fee) 
VALUES ('sadmin', '시스템관리자', 'sadmin123!', 'system_admin', 1, 'active', 0, 0, 0, 0)
ON CONFLICT (username) DO UPDATE SET
    password_hash = 'sadmin123!',
    updated_at = NOW();

-- 5. 게임 제공사 상태 업데이트 (모든 제공사를 활성 상태로)
UPDATE game_providers SET status = 'active' WHERE status IS NULL OR status = '';

-- 6. 필요시 추가할 수 있는 테이블들을 위한 준비
-- 게임 즐겨찾기 테이블 (사용자 페이지용)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_favorite_games') THEN
        CREATE TABLE user_favorite_games (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, game_id)
        );
    END IF;
END $$;

-- 게임 통계 캐시 테이블 (성능 최적화용)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_stats_cache') THEN
        CREATE TABLE game_stats_cache (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id INTEGER REFERENCES game_providers(id),
            game_id INTEGER REFERENCES games(id),
            stat_date DATE NOT NULL,
            total_bets INTEGER DEFAULT 0,
            total_bet_amount DECIMAL(15,2) DEFAULT 0,
            total_win_amount DECIMAL(15,2) DEFAULT 0,
            unique_players INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(provider_id, game_id, stat_date)
        );
    END IF;
END $$;

-- 7. 인덱스 추가 (새로 생성된 테이블용)
CREATE INDEX IF NOT EXISTS idx_user_favorite_games_user_id ON user_favorite_games(user_id);
CREATE INDEX IF NOT EXISTS idx_game_stats_cache_date ON game_stats_cache(stat_date);
CREATE INDEX IF NOT EXISTS idx_game_stats_cache_provider ON game_stats_cache(provider_id, stat_date);

-- 8. RLS 정책 추가 (테이블이 존재하는 경우에만)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_favorite_games') THEN
        ALTER TABLE user_favorite_games ENABLE ROW LEVEL SECURITY;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_stats_cache') THEN
        ALTER TABLE game_stats_cache ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- 9. 트리거 함수 및 트리거 추가
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_stats_cache') THEN
        -- 트리거 함수 생성
        CREATE OR REPLACE FUNCTION update_game_stats_cache()
        RETURNS TRIGGER AS $func$
        BEGIN
            -- 게임 기록이 추가될 때마다 통계 캐시 업데이트
            INSERT INTO game_stats_cache (provider_id, game_id, stat_date, total_bets, total_bet_amount, total_win_amount, unique_players, updated_at)
            VALUES (
                NEW.provider_id,
                NEW.game_id,
                DATE(NEW.played_at),
                1,
                NEW.bet_amount,
                NEW.win_amount,
                1,
                NOW()
            )
            ON CONFLICT (provider_id, game_id, stat_date)
            DO UPDATE SET
                total_bets = game_stats_cache.total_bets + 1,
                total_bet_amount = game_stats_cache.total_bet_amount + NEW.bet_amount,
                total_win_amount = game_stats_cache.total_win_amount + NEW.win_amount,
                updated_at = NOW();
            
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;

        -- 트리거 생성
        DROP TRIGGER IF EXISTS update_game_stats_cache_trigger ON game_records;
        CREATE TRIGGER update_game_stats_cache_trigger
            AFTER INSERT ON game_records
            FOR EACH ROW
            EXECUTE FUNCTION update_game_stats_cache();
    END IF;
END $$;

-- 10. 성능 최적화를 위한 추가 인덱스
CREATE INDEX IF NOT EXISTS idx_partners_opcode_status ON partners(opcode, status) WHERE opcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_status_online ON users(status, is_online);
CREATE INDEX IF NOT EXISTS idx_transactions_status_created ON transactions(status, created_at);

-- 11. 유용한 뷰 생성 (테이블들이 존재하는 경우에만)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'games') 
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_providers')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_records') THEN
        
        DROP VIEW IF EXISTS game_stats_view;
        
        CREATE VIEW game_stats_view AS
        SELECT 
            g.id as game_id,
            g.name as game_name,
            gp.id as provider_id,
            gp.name as provider_name,
            g.type,
            g.status,
            COALESCE(stats.total_bets, 0) as total_bets,
            COALESCE(stats.total_bet_amount, 0) as total_bet_amount,
            COALESCE(stats.total_win_amount, 0) as total_win_amount,
            COALESCE(stats.profit_loss, 0) as profit_loss,
            COALESCE(stats.unique_players, 0) as unique_players,
            g.created_at,
            g.updated_at
        FROM games g
        LEFT JOIN game_providers gp ON g.provider_id = gp.id
        LEFT JOIN (
            SELECT 
                game_id,
                COUNT(*) as total_bets,
                SUM(bet_amount) as total_bet_amount,
                SUM(win_amount) as total_win_amount,
                SUM(bet_amount - win_amount) as profit_loss,
                COUNT(DISTINCT user_id) as unique_players
            FROM game_records
            WHERE played_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY game_id
        ) stats ON g.id = stats.game_id;
    END IF;
END $$;

-- 12. 코멘트 추가
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_favorite_games') THEN
        COMMENT ON TABLE user_favorite_games IS '사용자 게임 즐겨찾기 테이블';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_stats_cache') THEN
        COMMENT ON TABLE game_stats_cache IS '게임 통계 캐시 테이블 (성능 최적화용)';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'game_stats_view') THEN
        COMMENT ON VIEW game_stats_view IS '게임 통계 조회용 뷰 (최근 30일 기준)';
    END IF;
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '스키마 업데이트가 완료되었습니다.';
    RAISE NOTICE '- 인덱스 추가: games, game_records 성능 최적화';
    RAISE NOTICE '- 시스템 설정: 게임 관리 관련 설정 추가';
    RAISE NOTICE '- 메뉴 권한: 게임 관리 세부 메뉴 추가';
    RAISE NOTICE '- 파트너: sadmin 계정 업데이트';
    RAISE NOTICE '- 테이블: user_favorite_games, game_stats_cache 추가';
    RAISE NOTICE '- 뷰: game_stats_view 생성';
    RAISE NOTICE '- 트리거: 게임 통계 자동 업데이트';
END $$;