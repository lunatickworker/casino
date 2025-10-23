-- game_launch_sessions 테이블에 session_id 컬럼 추가
-- 실시간 게임 모니터링을 위한 고유 세션 식별자

DO $$
BEGIN
  -- session_id 컬럼이 없다면 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_launch_sessions' AND column_name = 'session_id'
  ) THEN
    
    -- session_id 컬럼 추가 (UUID 기반 고유 식별자)
    ALTER TABLE game_launch_sessions 
    ADD COLUMN session_id TEXT DEFAULT gen_random_uuid()::TEXT;
    
    -- 기존 레코드들의 session_id 업데이트
    UPDATE game_launch_sessions 
    SET session_id = gen_random_uuid()::TEXT 
    WHERE session_id IS NULL;
    
    -- session_id를 NOT NULL로 변경
    ALTER TABLE game_launch_sessions 
    ALTER COLUMN session_id SET NOT NULL;
    
    -- session_id에 고유 제약조건 추가
    ALTER TABLE game_launch_sessions 
    ADD CONSTRAINT unique_game_launch_session_id UNIQUE (session_id);
    
    -- 성능을 위한 인덱스 추가
    CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_session_id 
    ON game_launch_sessions(session_id);
    
    RAISE NOTICE 'session_id 컬럼이 game_launch_sessions 테이블에 추가되었습니다.';
    
  ELSE
    RAISE NOTICE 'session_id 컬럼이 이미 존재합니다.';
  END IF;
  
  -- status 컬럼이 없다면 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_launch_sessions' AND column_name = 'status'
  ) THEN
    
    -- status 컬럼 추가
    ALTER TABLE game_launch_sessions 
    ADD COLUMN status VARCHAR(20) DEFAULT 'active' 
    CHECK (status IN ('active', 'ended', 'expired', 'error'));
    
    -- 기존 레코드 중 ended_at이 있는 것은 'ended'로, 없는 것은 'active'로 설정
    UPDATE game_launch_sessions 
    SET status = CASE 
      WHEN ended_at IS NOT NULL THEN 'ended'
      ELSE 'active'
    END
    WHERE status IS NULL;
    
    -- status를 NOT NULL로 변경
    ALTER TABLE game_launch_sessions 
    ALTER COLUMN status SET NOT NULL;
    
    -- 성능을 위한 인덱스 추가
    CREATE INDEX IF NOT EXISTS idx_game_launch_sessions_status 
    ON game_launch_sessions(status);
    
    RAISE NOTICE 'status 컬럼이 game_launch_sessions 테이블에 추가되었습니다.';
    
  ELSE
    RAISE NOTICE 'status 컬럼이 이미 존재합니다.';
  END IF;

END $$;

-- 완료 확인
SELECT 'game_launch_sessions 테이블 업데이트 완료' as status, NOW() as completed_at;