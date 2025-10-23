-- 컴파일 에러 수정을 위한 데이터베이스 스키마 정리

-- game_providers 테이블 정리 및 누락된 컬럼 확인
ALTER TABLE game_providers 
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

-- 게임 제공사 상태 확인 및 업데이트
UPDATE game_providers SET status = 'active' WHERE status IS NULL;

-- RLS 정책 확인 및 업데이트
DROP POLICY IF EXISTS "game_providers_select_policy" ON game_providers;
CREATE POLICY "game_providers_select_policy" ON game_providers
  FOR SELECT TO authenticated USING (true);

-- users 테이블의 필수 컬럼 확인
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS balance DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS points DECIMAL(15,2) DEFAULT 0.00;

-- games 테이블 정리
ALTER TABLE games 
ADD COLUMN IF NOT EXISTS demo_available BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_hot BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_new BOOLEAN DEFAULT false;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_game_providers_type_status_order 
ON game_providers(type, status, order_index);

CREATE INDEX IF NOT EXISTS idx_games_provider_type_status 
ON games(provider_id, type, status);

CREATE INDEX IF NOT EXISTS idx_users_status_balance 
ON users(status, balance);

-- 통계 함수 생성 (게임 제공사별 게임 수)
CREATE OR REPLACE FUNCTION get_provider_game_count(provider_id INTEGER, game_type TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER 
    FROM games 
    WHERE games.provider_id = get_provider_game_count.provider_id 
      AND games.type = get_provider_game_count.game_type 
      AND games.status = 'visible'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게임 가시성 체크 함수
CREATE OR REPLACE FUNCTION is_game_visible_to_user(game_id INTEGER, user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  game_status TEXT;
  user_organization_id UUID;
BEGIN
  -- 게임 상태 확인
  SELECT status INTO game_status FROM games WHERE id = game_id;
  
  IF game_status IS NULL OR game_status != 'visible' THEN
    RETURN FALSE;
  END IF;
  
  -- 사용자 조직 확인 (향후 조직별 게임 제한 기능을 위해)
  SELECT organization_id INTO user_organization_id FROM users WHERE id = user_id;
  
  -- 현재는 모든 visible 게임을 허용
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 실시간 구독을 위한 트리거 함수들
CREATE OR REPLACE FUNCTION notify_game_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('game_status_changed', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS game_status_change_trigger ON games;
CREATE TRIGGER game_status_change_trigger
  AFTER UPDATE OF status ON games
  FOR EACH ROW
  EXECUTE FUNCTION notify_game_status_change();

-- 제공사 상태 변경 알림
CREATE OR REPLACE FUNCTION notify_provider_status_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('provider_status_changed', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provider_status_change_trigger ON game_providers;
CREATE TRIGGER provider_status_change_trigger
  AFTER UPDATE OF status ON game_providers
  FOR EACH ROW
  EXECUTE FUNCTION notify_provider_status_change();

-- 시스템 설정 확인
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('game_api_sync_interval', '30', '게임 API 동기화 간격 (초)')
ON CONFLICT (setting_key) DO NOTHING;

-- 권한 확인
GRANT SELECT ON game_providers TO authenticated;
GRANT SELECT ON games TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_game_count(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_game_visible_to_user(INTEGER, UUID) TO authenticated;