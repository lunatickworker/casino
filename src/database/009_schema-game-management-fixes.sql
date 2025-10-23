-- 게임 관리 관련 스키마 수정 및 최적화

-- 1. games 테이블 상태값 기본값 수정 (visible이 기본값이어야 함)
DO $$
BEGIN
    -- games 테이블의 status 기본값을 visible로 변경
    ALTER TABLE games ALTER COLUMN status SET DEFAULT 'visible';
    
    -- 기존 active 상태를 visible로 업데이트
    UPDATE games SET status = 'visible' WHERE status = 'active';
    
    -- CHECK 제약조건 확인 및 수정
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname LIKE '%games_status_check%') THEN
        ALTER TABLE games DROP CONSTRAINT games_status_check;
    END IF;
    
    ALTER TABLE games ADD CONSTRAINT games_status_check 
    CHECK (status IN ('visible', 'hidden', 'maintenance'));
    
END $$;

-- 2. game_providers 테이블 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_game_providers_type_status ON game_providers(type, status);

-- 3. 게임 동기화를 위한 추가 컬럼 (필요시)
DO $$
BEGIN
    -- games 테이블에 external_id 컬럼 추가 (외부 API에서 사용하는 고유 ID)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'games' AND column_name = 'external_id') THEN
        ALTER TABLE games ADD COLUMN external_id VARCHAR(100);
        CREATE INDEX idx_games_external_id ON games(external_id);
    END IF;
    
    -- games 테이블에 last_sync_at 컬럼 추가 (마지막 동기화 시간)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'games' AND column_name = 'last_sync_at') THEN
        ALTER TABLE games ADD COLUMN last_sync_at TIMESTAMP WITH TIME ZONE;
        CREATE INDEX idx_games_last_sync ON games(last_sync_at);
    END IF;
    
    -- game_providers 테이블에 last_game_sync 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'game_providers' AND column_name = 'last_game_sync') THEN
        ALTER TABLE game_providers ADD COLUMN last_game_sync TIMESTAMP WITH TIME ZONE;
    END IF;
    
END $$;

-- 4. 베팅 내역 관련 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_game_records_user_date ON game_records(user_id, DATE(played_at));
CREATE INDEX IF NOT EXISTS idx_game_records_provider_date ON game_records(provider_id, DATE(played_at));

-- 5. 게임 상태 변경 로그 테이블 생성 (추적용)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_status_logs') THEN
        CREATE TABLE game_status_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            game_id INTEGER REFERENCES games(id),
            old_status VARCHAR(20),
            new_status VARCHAR(20),
            changed_by UUID REFERENCES partners(id),
            changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            reason TEXT
        );
        
        CREATE INDEX idx_game_status_logs_game_id ON game_status_logs(game_id);
        CREATE INDEX idx_game_status_logs_changed_at ON game_status_logs(changed_at);
    END IF;
END $$;

-- 6. 게임 상태 변경 트리거 함수
CREATE OR REPLACE FUNCTION log_game_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- 상태가 변경된 경우에만 로그 기록
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO game_status_logs (game_id, old_status, new_status, changed_at)
        VALUES (NEW.id, OLD.status, NEW.status, NOW());
    END IF;
    
    -- last_sync_at 업데이트
    NEW.last_sync_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성 (이미 있으면 재생성)
DROP TRIGGER IF EXISTS game_status_change_trigger ON games;
CREATE TRIGGER game_status_change_trigger
    BEFORE UPDATE ON games
    FOR EACH ROW
    EXECUTE FUNCTION log_game_status_change();

-- 7. 게임 제공사별 게임 수 뷰 생성
CREATE OR REPLACE VIEW provider_game_stats AS
SELECT 
    gp.id as provider_id,
    gp.name as provider_name,
    gp.type,
    gp.status as provider_status,
    COUNT(g.id) as total_games,
    COUNT(CASE WHEN g.status = 'visible' THEN 1 END) as visible_games,
    COUNT(CASE WHEN g.status = 'hidden' THEN 1 END) as hidden_games,
    COUNT(CASE WHEN g.status = 'maintenance' THEN 1 END) as maintenance_games,
    MAX(g.last_sync_at) as last_game_sync,
    gp.created_at
FROM game_providers gp
LEFT JOIN games g ON gp.id = g.provider_id
GROUP BY gp.id, gp.name, gp.type, gp.status, gp.created_at
ORDER BY gp.id;

-- 8. 실시간 베팅 통계 뷰
CREATE OR REPLACE VIEW realtime_betting_stats AS
SELECT 
    g.id as game_id,
    g.name as game_name,
    gp.name as provider_name,
    g.type,
    g.status,
    COUNT(gr.id) as total_bets_today,
    COALESCE(SUM(gr.bet_amount), 0) as total_bet_amount_today,
    COALESCE(SUM(gr.win_amount), 0) as total_win_amount_today,
    COALESCE(SUM(gr.bet_amount - gr.win_amount), 0) as profit_today,
    COUNT(DISTINCT gr.user_id) as unique_players_today,
    MAX(gr.played_at) as last_bet_at
FROM games g
LEFT JOIN game_providers gp ON g.provider_id = gp.id
LEFT JOIN game_records gr ON g.id = gr.game_id 
    AND DATE(gr.played_at) = CURRENT_DATE
GROUP BY g.id, g.name, gp.name, g.type, g.status
ORDER BY total_bet_amount_today DESC;

-- 9. 게임 관리 관련 시스템 설정 추가
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
('game_status_change_log_enabled', 'true', 'boolean', '게임 상태 변경 로그 기록', 1),
('game_sync_batch_size', '1000', 'number', '게임 동기화 배치 크기', 1),
('game_image_proxy_enabled', 'false', 'boolean', '게임 이미지 프록시 사용', 2),
('betting_realtime_update_interval', '5', 'number', '실시간 베팅 업데이트 간격(초)', 2)
ON CONFLICT (setting_key) DO NOTHING;

-- 10. 데이터 정리 및 최적화
-- 중복된 게임 기록 정리 (external_txid가 같은 것들)
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- 중복 게임 기록 삭제 (가장 최근 것만 남기고)
    WITH duplicate_records AS (
        SELECT id, 
               ROW_NUMBER() OVER (
                   PARTITION BY external_txid, user_id, DATE(played_at) 
                   ORDER BY created_at DESC
               ) as rn
        FROM game_records 
        WHERE external_txid IS NOT NULL
    )
    DELETE FROM game_records 
    WHERE id IN (
        SELECT id FROM duplicate_records WHERE rn > 1
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    IF deleted_count > 0 THEN
        RAISE NOTICE '중복된 게임 기록 %개가 정리되었습니다.', deleted_count;
    END IF;
END $$;

-- 11. 성능 최적화를 위한 추가 인덱스
CREATE INDEX IF NOT EXISTS idx_games_provider_status ON games(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_games_type_status ON games(type, status);
CREATE INDEX IF NOT EXISTS idx_game_records_txid_user ON game_records(external_txid, user_id);

-- 12. 코멘트 추가
COMMENT ON TABLE game_status_logs IS '게임 상태 변경 추적 로그';
COMMENT ON VIEW provider_game_stats IS '제공사별 게임 통계 뷰';
COMMENT ON VIEW realtime_betting_stats IS '실시간 베팅 통계 뷰';

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '게임 관리 스키마 최적화가 완료되었습니다.';
    RAISE NOTICE '- 게임 상태 기본값: visible로 변경';
    RAISE NOTICE '- 게임 동기화 컬럼: external_id, last_sync_at 추가';
    RAISE NOTICE '- 게임 상태 변경 로그: game_status_logs 테이블 생성';
    RAISE NOTICE '- 통계 뷰: provider_game_stats, realtime_betting_stats 생성';
    RAISE NOTICE '- 성능 인덱스: 베팅 및 게임 조회 최적화';
END $$;