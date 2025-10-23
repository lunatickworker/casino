-- ============================================================================
-- 182. game_records에 game_title, provider_name 컬럼 추가
-- ============================================================================
-- 목적: API의 game_title, provider_name을 직접 저장
-- ============================================================================

-- 1. 컬럼 추가 (이미 있으면 무시)
DO $$
BEGIN
    -- game_title 컬럼 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'game_title'
    ) THEN
        ALTER TABLE game_records ADD COLUMN game_title TEXT;
        RAISE NOTICE '✅ game_title 컬럼 추가 완료';
    ELSE
        RAISE NOTICE 'ℹ️ game_title 컬럼 이미 존재';
    END IF;

    -- provider_name 컬럼 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'provider_name'
    ) THEN
        ALTER TABLE game_records ADD COLUMN provider_name TEXT;
        RAISE NOTICE '✅ provider_name 컬럼 추가 완료';
    ELSE
        RAISE NOTICE 'ℹ️ provider_name 컬럼 이미 존재';
    END IF;
END $$;

-- 2. 인덱스 추가 (검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_game_records_game_title ON game_records(game_title);
CREATE INDEX IF NOT EXISTS idx_game_records_provider_name ON game_records(provider_name);

-- 3. 확인
DO $
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ game_title, provider_name 컬럼 추가 완료';
    RAISE NOTICE 'ℹ️ 이제 API에서 받은 데이터를 직접 저장할 수 있습니다.';
    RAISE NOTICE '';
END $;

-- 4. 컬럼 확인
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'game_records' 
AND column_name IN ('game_title', 'provider_name')
ORDER BY column_name;
