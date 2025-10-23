-- ============================================================================
-- 041. 누락된 컬럼 추가
-- ============================================================================
-- 작성일: 2025-10-02
-- ============================================================================

-- 1. games 테이블에 priority 컬럼이 없으면 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'priority'
    ) THEN
        ALTER TABLE games ADD COLUMN priority INTEGER DEFAULT 0;
        RAISE NOTICE '✅ games 테이블에 priority 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️  games.priority 컬럼이 이미 존재합니다';
    END IF;
END $$;

-- 2. games 테이블에 external_id 컬럼이 없으면 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'external_id'
    ) THEN
        ALTER TABLE games ADD COLUMN external_id VARCHAR(100);
        RAISE NOTICE '✅ games 테이블에 external_id 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️  games.external_id 컬럼이 이미 존재합니다';
    END IF;
END $$;

-- 3. games 테이블에 last_sync_at 컬럼이 없으면 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'games' AND column_name = 'last_sync_at'
    ) THEN
        ALTER TABLE games ADD COLUMN last_sync_at TIMESTAMP WITH TIME ZONE;
        RAISE NOTICE '✅ games 테이블에 last_sync_at 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️  games.last_sync_at 컬럼이 이미 존재합니다';
    END IF;
END $$;

-- 4. 인덱스 추가 (존재하지 않는 경우에만)
CREATE INDEX IF NOT EXISTS idx_games_priority ON games(priority DESC);
CREATE INDEX IF NOT EXISTS idx_games_external_id ON games(external_id);
CREATE INDEX IF NOT EXISTS idx_games_last_sync_at ON games(last_sync_at DESC);

-- 5. 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 041. 누락된 컬럼 추가 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '추가된 컬럼:';
    RAISE NOTICE '- games.priority: 게임 노출 순서 (기본값: 0)';
    RAISE NOTICE '- games.external_id: 외부 게임 ID';
    RAISE NOTICE '- games.last_sync_at: 마지막 동기화 시각';
    RAISE NOTICE '============================================';
END $$;
