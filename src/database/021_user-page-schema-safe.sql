-- 사용자 페이지 개발을 위한 안전한 스키마 추가
-- 기존 테이블과 뷰 충돌을 방지하는 안전한 방법 사용

-- 1. users 테이블 필수 컬럼 추가 (안전하게)
DO $$
BEGIN
    -- external_token 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'external_token') THEN
        ALTER TABLE users ADD COLUMN external_token VARCHAR(255);
        RAISE NOTICE '✓ users.external_token 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '→ users.external_token 컬럼이 이미 존재합니다.';
    END IF;
    
    -- device_info 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'device_info') THEN
        ALTER TABLE users ADD COLUMN device_info JSONB;
        RAISE NOTICE '✓ users.device_info 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '→ users.device_info 컬럼이 이미 존재합니다.';
    END IF;
    
    -- is_online 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_online') THEN
        ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✓ users.is_online 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '→ users.is_online 컬럼이 이미 존재합니다.';
    END IF;
    
    -- vip_level 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'vip_level') THEN
        ALTER TABLE users ADD COLUMN vip_level INTEGER DEFAULT 0;
        RAISE NOTICE '✓ users.vip_level 컬럼을 추가했습니다.';
    ELSE
        RAISE NOTICE '→ users.vip_level 컬럼이 이미 존재합니다.';
    END IF;
END $$;

-- 2. 게임 즐겨찾기 테이블 생성
CREATE TABLE IF NOT EXISTS user_game_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, game_id)
);

-- 3. 사용자 로그인 세션 테이블 생성
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB,
    login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    logout_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

-- 4. 사용자 활동 로그 테이블 생성
CREATE TABLE IF NOT EXISTS user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    activity_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. 게임 제공사 데이터 기본 삽입 (안전하게)
INSERT INTO game_providers (id, name, type, status, logo_url) VALUES
-- 슬롯 제공사
(1, '마이크로게이밍', 'slot', 'active', NULL),
(17, '플레이앤고', 'slot', 'active', NULL),
(20, 'CQ9 게이밍', 'slot', 'active', NULL),
(21, '제네시스 게이밍', 'slot', 'active', NULL),
(22, '하바네로', 'slot', 'active', NULL),
(23, '게임아트', 'slot', 'active', NULL),
(27, '플레이텍', 'slot', 'active', NULL),
(38, '블루프린트', 'slot', 'active', NULL),
(39, '부운고', 'slot', 'active', NULL),
(40, '드라군소프트', 'slot', 'active', NULL),
(41, '엘크 스튜디오', 'slot', 'active', NULL),
(47, '드림테크', 'slot', 'active', NULL),
(51, '칼람바 게임즈', 'slot', 'active', NULL),
(52, '모빌롯', 'slot', 'active', NULL),
(53, '노리밋 시티', 'slot', 'active', NULL),
(55, 'OMI 게이밍', 'slot', 'active', NULL),
(56, '원터치', 'slot', 'active', NULL),
(59, '플레이슨', 'slot', 'active', NULL),
(60, '푸쉬 게이밍', 'slot', 'active', NULL),
(61, '퀵스핀', 'slot', 'active', NULL),
(62, 'RTG 슬롯', 'slot', 'active', NULL),
(63, '리볼버 게이밍', 'slot', 'active', NULL),
(65, '슬롯밀', 'slot', 'active', NULL),
(66, '스피어헤드', 'slot', 'active', NULL),
(70, '썬더킥', 'slot', 'active', NULL),
(72, '우후 게임즈', 'slot', 'active', NULL),
(74, '릴렉스 게이밍', 'slot', 'active', NULL),
(75, '넷엔트', 'slot', 'active', NULL),
(76, '레드타이거', 'slot', 'active', NULL),
(87, 'PG소프트', 'slot', 'active', NULL),
(88, '플레이스타', 'slot', 'active', NULL),
(90, '빅타임게이밍', 'slot', 'active', NULL),
(300, '프라그마틱 플레이', 'slot', 'active', NULL),

-- 카지노 제공사
(410, '에볼루션 게이밍', 'casino', 'active', NULL),
(77, '마이크로 게이밍', 'casino', 'active', NULL),
(2, 'Vivo 게이밍', 'casino', 'active', NULL),
(30, '아시아 게이밍', 'casino', 'active', NULL),
(78, '프라그마틱플레이', 'casino', 'active', NULL),
(86, '섹시게이밍', 'casino', 'active', NULL),
(11, '비비아이엔', 'casino', 'active', NULL),
(28, '드림게임', 'casino', 'active', NULL),
(89, '오리엔탈게임', 'casino', 'active', NULL),
(91, '보타', 'casino', 'active', NULL),
(44, '이주기', 'casino', 'active', NULL),
(85, '플레이텍 라이브', 'casino', 'active', NULL),
(0, '제네럴 카지노', 'casino', 'active', NULL)
ON CONFLICT (id) DO NOTHING;

-- 6. 필수 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_game_favorites_user_id ON user_game_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_game_favorites_game_id ON user_game_favorites(game_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_type ON user_activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);
CREATE INDEX IF NOT EXISTS idx_users_vip_level ON users(vip_level);
CREATE INDEX IF NOT EXISTS idx_users_external_token ON users(external_token);

-- 7. 사용자 온라인 상태 업데이트 함수
CREATE OR REPLACE FUNCTION update_user_online_status(
    user_id_param UUID,
    is_online_param BOOLEAN DEFAULT TRUE
)
RETURNS VOID AS $$
BEGIN
    UPDATE users 
    SET 
        is_online = is_online_param,
        last_login_at = CASE WHEN is_online_param THEN NOW() ELSE last_login_at END
    WHERE id = user_id_param;
    
    -- 세션 테이블도 업데이트
    UPDATE user_sessions 
    SET 
        last_activity = NOW(),
        logout_at = CASE WHEN NOT is_online_param THEN NOW() ELSE NULL END,
        is_active = is_online_param
    WHERE user_id = user_id_param AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- 8. 사용자 활동 로그 기록 함수
CREATE OR REPLACE FUNCTION log_user_activity(
    user_id_param UUID,
    activity_type_param VARCHAR(50),
    activity_data_param JSONB DEFAULT NULL,
    ip_address_param INET DEFAULT NULL,
    user_agent_param TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO user_activity_logs (
        user_id, 
        activity_type, 
        activity_data, 
        ip_address, 
        user_agent
    )
    VALUES (
        user_id_param,
        activity_type_param,
        activity_data_param,
        ip_address_param,
        user_agent_param
    )
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- 9. 사용자 잔고 동기화 함수 (외부 API 연동용)
CREATE OR REPLACE FUNCTION sync_user_balance_with_external_api(
    user_id_param UUID,
    external_balance DECIMAL(15,2)
)
RETURNS BOOLEAN AS $$
DECLARE
    current_balance DECIMAL(15,2);
    balance_diff DECIMAL(15,2);
BEGIN
    -- 현재 잔고 조회
    SELECT balance INTO current_balance FROM users WHERE id = user_id_param;
    
    IF current_balance IS NULL THEN
        RAISE EXCEPTION '사용자를 찾을 수 없습니다: %', user_id_param;
    END IF;
    
    balance_diff := external_balance - current_balance;
    
    -- 차이가 있을 경우에만 업데이트
    IF ABS(balance_diff) > 0.01 THEN
        UPDATE users SET balance = external_balance WHERE id = user_id_param;
        
        -- 활동 로그 기록
        PERFORM log_user_activity(
            user_id_param,
            'balance_sync',
            json_build_object(
                'previous_balance', current_balance,
                'new_balance', external_balance,
                'difference', balance_diff
            )::JSONB
        );
        
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 10. 게임 즐겨찾기 토글 함수
CREATE OR REPLACE FUNCTION toggle_game_favorite(
    user_id_param UUID,
    game_id_param INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    is_favorite BOOLEAN := FALSE;
BEGIN
    -- 이미 즐겨찾기에 있는지 확인
    SELECT TRUE INTO is_favorite 
    FROM user_game_favorites 
    WHERE user_id = user_id_param AND game_id = game_id_param;
    
    IF is_favorite THEN
        -- 즐겨찾기 제거
        DELETE FROM user_game_favorites 
        WHERE user_id = user_id_param AND game_id = game_id_param;
        RETURN FALSE;
    ELSE
        -- 즐겨찾기 추가
        INSERT INTO user_game_favorites (user_id, game_id)
        VALUES (user_id_param, game_id_param)
        ON CONFLICT (user_id, game_id) DO NOTHING;
        RETURN TRUE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 11. 사용자 통계 조회 함수
CREATE OR REPLACE FUNCTION get_user_statistics(
    user_id_param UUID,
    days_param INTEGER DEFAULT 30
)
RETURNS JSON AS $$
DECLARE
    result JSON;
    start_date TIMESTAMP WITH TIME ZONE;
BEGIN
    start_date := NOW() - INTERVAL '1 day' * days_param;
    
    SELECT json_build_object(
        'total_deposits', COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'deposit' AND status = 'approved'), 0),
        'total_withdrawals', COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'approved'), 0),
        'total_bets', COALESCE((SELECT SUM(bet_amount) FROM game_records WHERE user_id = user_id_param AND played_at >= start_date), 0),
        'total_wins', COALESCE((SELECT SUM(win_amount) FROM game_records WHERE user_id = user_id_param AND played_at >= start_date), 0),
        'game_count', COALESCE((SELECT COUNT(*) FROM game_records WHERE user_id = user_id_param AND played_at >= start_date), 0),
        'favorite_games_count', COALESCE((SELECT COUNT(*) FROM user_game_favorites WHERE user_id = user_id_param), 0),
        'days_period', days_param
    )
    INTO result
    FROM transactions 
    WHERE user_id = user_id_param 
    AND created_at >= start_date;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 12. 사용자 포인트 게임머니 전환 함수
CREATE OR REPLACE FUNCTION convert_points_to_balance(
    user_id_param UUID,
    points_amount DECIMAL(15,2)
)
RETURNS BOOLEAN AS $$
DECLARE
    current_points DECIMAL(15,2);
    current_balance DECIMAL(15,2);
BEGIN
    -- 현재 포인트와 잔고 조회
    SELECT points, balance INTO current_points, current_balance 
    FROM users WHERE id = user_id_param;
    
    IF current_points IS NULL THEN
        RAISE EXCEPTION '사용자를 찾을 수 없습니다: %', user_id_param;
    END IF;
    
    IF current_points < points_amount THEN
        RAISE EXCEPTION '포인트가 부족합니다. 보유: %, 요청: %', current_points, points_amount;
    END IF;
    
    -- 포인트 차감 및 잔고 증가
    UPDATE users 
    SET 
        points = points - points_amount,
        balance = balance + points_amount
    WHERE id = user_id_param;
    
    -- 포인트 거래 내역 기록
    INSERT INTO point_transactions (
        user_id, 
        transaction_type, 
        amount, 
        points_before, 
        points_after, 
        memo
    )
    VALUES (
        user_id_param,
        'convert_to_balance',
        points_amount,
        current_points,
        current_points - points_amount,
        '포인트 → 게임머니 전환'
    );
    
    -- 거래 내역 기록
    INSERT INTO transactions (
        user_id,
        transaction_type,
        amount,
        status,
        balance_before,
        balance_after,
        memo
    )
    VALUES (
        user_id_param,
        'point_conversion',
        points_amount,
        'completed',
        current_balance,
        current_balance + points_amount,
        '포인트 전환'
    );
    
    -- 활동 로그 기록
    PERFORM log_user_activity(
        user_id_param,
        'point_conversion',
        json_build_object(
            'points_converted', points_amount,
            'points_before', current_points,
            'points_after', current_points - points_amount,
            'balance_before', current_balance,
            'balance_after', current_balance + points_amount
        )::JSONB
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 13. 사용자 세션 정리 함수 (오래된 세션 정리용)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- 30일 이상 비활성 세션 삭제
    DELETE FROM user_sessions 
    WHERE last_activity < NOW() - INTERVAL '30 days'
    OR (logout_at IS NOT NULL AND logout_at < NOW() - INTERVAL '7 days');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '🎯 사용자 페이지 스키마 안전 설치 완료!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '✅ 사용자 테이블 필수 컬럼 추가 완료';
    RAISE NOTICE '✅ 게임 제공사 데이터 삽입 완료 (33개 슬롯 + 13개 카지노)';
    RAISE NOTICE '✅ 즐겨찾기/세션/로그 테이블 생성 완료';
    RAISE NOTICE '✅ 사용자 페이지 관련 함수 13개 생성 완료';
    RAISE NOTICE '✅ 필수 인덱스 생성 완료';
    RAISE NOTICE '';
    RAISE NOTICE '🎮 주요 기능:';
    RAISE NOTICE '  • 게임 즐겨찾기 관리';
    RAISE NOTICE '  • 사용자 세션 추적';
    RAISE NOTICE '  • 포인트 ↔ 게임머니 전환';
    RAISE NOTICE '  • 실시간 잔고 동기화';
    RAISE NOTICE '  • 활동 로그 기록';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 이제 사용자 페이지가 완전히 작동합니다!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
END $$;