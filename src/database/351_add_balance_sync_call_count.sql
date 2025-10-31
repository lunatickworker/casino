-- =====================================================
-- 온라인 사용자 60번 호출 로그아웃을 위한 컬럼 추가
-- =====================================================

-- users 테이블에 balance_sync_call_count 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_sync_call_count INTEGER DEFAULT 0;

-- users 테이블에 balance_sync_started_at 컬럼 추가 (로그인 시간 추적)
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_sync_started_at TIMESTAMP WITH TIME ZONE;

-- 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_users_is_online_sync_count ON users(is_online, balance_sync_call_count) WHERE is_online = true;

-- 코멘트 추가
COMMENT ON COLUMN users.balance_sync_call_count IS '온라인 상태에서 보유금 동기화 호출 횟수 (30초마다 1회, 60회 도달 시 자동 로그아웃)';
COMMENT ON COLUMN users.balance_sync_started_at IS '온라인 상태 시작 시간 (로그인 시간 또는 is_online = true로 변경된 시간)';
