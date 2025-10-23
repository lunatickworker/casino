-- =====================================================
-- game_records 테이블에 updated_at 컬럼 추가
-- =====================================================

DO $$ 
BEGIN
    -- updated_at 컬럼 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE game_records 
        ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        
        -- 기존 데이터에 대해 created_at 값으로 초기화
        UPDATE game_records 
        SET updated_at = created_at 
        WHERE updated_at IS NULL;
        
        RAISE NOTICE 'game_records 테이블에 updated_at 컬럼 추가 완료';
    ELSE
        RAISE NOTICE 'game_records.updated_at 컬럼이 이미 존재합니다';
    END IF;
    
    -- updated_at 자동 업데이트 트리거 함수
    CREATE OR REPLACE FUNCTION update_game_records_timestamp()
    RETURNS TRIGGER AS $func$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
    
    -- 트리거 생성
    DROP TRIGGER IF EXISTS game_records_updated_at_trigger ON game_records;
    CREATE TRIGGER game_records_updated_at_trigger
        BEFORE UPDATE ON game_records
        FOR EACH ROW
        EXECUTE FUNCTION update_game_records_timestamp();
    
    RAISE NOTICE 'game_records updated_at 트리거 생성 완료';
END $$;

-- 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_game_records_updated_at 
    ON game_records(updated_at DESC);

COMMENT ON COLUMN game_records.updated_at IS '베팅 기록 마지막 업데이트 시간';
