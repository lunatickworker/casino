-- =====================================================
-- 로그아웃 시 balance_sync_call_count 초기화 트리거
-- =====================================================

-- 트리거 함수 생성
CREATE OR REPLACE FUNCTION reset_call_count_on_logout()
RETURNS TRIGGER AS $$
BEGIN
    -- is_online이 true에서 false로 변경될 때
    IF OLD.is_online = true AND NEW.is_online = false THEN
        NEW.balance_sync_call_count := 0;
        NEW.balance_sync_started_at := NULL;
        
        RAISE NOTICE '✅ 로그아웃으로 호출 카운터 초기화: username=%', NEW.username;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 기존 트리거 삭제 (있다면)
DROP TRIGGER IF EXISTS trigger_reset_call_count_on_logout ON users;

-- 트리거 생성
CREATE TRIGGER trigger_reset_call_count_on_logout
    BEFORE UPDATE ON users
    FOR EACH ROW
    WHEN (OLD.is_online IS DISTINCT FROM NEW.is_online)
    EXECUTE FUNCTION reset_call_count_on_logout();

COMMENT ON TRIGGER trigger_reset_call_count_on_logout ON users IS '로그아웃 시 보유금 동기화 호출 카운터 자동 초기화';
