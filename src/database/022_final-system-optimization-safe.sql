-- =====================================================
-- GMS 시스템 최종 최적화 스키마 (안전 버전)
-- 기존 스키마와 충돌하지 않는 안전한 방식
-- =====================================================

-- 1. 파트너 테이블 필수 컬럼 추가 (안전하게)
DO $$
BEGIN
    -- 메뉴 접근 권한 관리용
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'menu_permissions') THEN
        ALTER TABLE partners ADD COLUMN menu_permissions JSONB DEFAULT '[]'::jsonb;
        RAISE NOTICE '✓ partners.menu_permissions 컬럼을 추가했습니다.';
    END IF;
    
    -- 알림 설정
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'notification_settings') THEN
        ALTER TABLE partners ADD COLUMN notification_settings JSONB DEFAULT '{"sound": true, "popup": true, "email": false}'::jsonb;
        RAISE NOTICE '✓ partners.notification_settings 컬럼을 추가했습니다.';
    END IF;
    
    -- 온라인 상태
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'is_online') THEN
        ALTER TABLE partners ADD COLUMN is_online BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✓ partners.is_online 컬럼을 추가했습니다.';
    END IF;
END $$;

-- 2. 실시간 알림 테이블 생성
CREATE TABLE IF NOT EXISTS realtime_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

-- 3. API 호출 로그 테이블 생성
CREATE TABLE IF NOT EXISTS api_call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id),
    api_endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    request_data JSONB,
    response_data JSONB,
    status_code INTEGER,
    response_time_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 사용자 활동 통계 테이블 생성
CREATE TABLE IF NOT EXISTS user_activity_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stat_date DATE NOT NULL,
    login_count INTEGER DEFAULT 0,
    game_sessions INTEGER DEFAULT 0,
    total_bet_amount DECIMAL(15,2) DEFAULT 0,
    total_win_amount DECIMAL(15,2) DEFAULT 0,
    deposit_count INTEGER DEFAULT 0,
    withdrawal_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, stat_date)
);

-- 5. 필수 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_partners_online ON partners(is_online);
CREATE INDEX IF NOT EXISTS idx_realtime_notifications_recipient ON realtime_notifications(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_realtime_notifications_type ON realtime_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_partner ON api_call_logs(partner_id);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_endpoint ON api_call_logs(api_endpoint);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_created_at ON api_call_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_stats_user_date ON user_activity_stats(user_id, stat_date);

-- 6. 권한별 메뉴 접근 확인 함수
CREATE OR REPLACE FUNCTION check_menu_access(
    partner_id_param UUID,
    menu_path VARCHAR(255)
)
RETURNS BOOLEAN AS $$
DECLARE
    partner_level INTEGER;
    has_access BOOLEAN := FALSE;
BEGIN
    -- 파트너 레벨 조회
    SELECT level INTO partner_level
    FROM partners 
    WHERE id = partner_id_param AND status = 'active';
    
    IF partner_level IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- 시스템 관리자는 모든 메뉴 접근 가능
    IF partner_level = 1 THEN
        RETURN TRUE;
    END IF;
    
    -- 메뉴별 최소 권한 레벨 확인 (menufunction.md 기준)
    CASE 
        WHEN menu_path LIKE '/admin/dashboard%' THEN has_access := partner_level <= 6;
        WHEN menu_path LIKE '/admin/users%' THEN has_access := partner_level <= 6;
        WHEN menu_path LIKE '/admin/partners%' THEN has_access := partner_level <= 3;
        WHEN menu_path LIKE '/admin/settlement%' THEN has_access := partner_level <= 4;
        WHEN menu_path LIKE '/admin/games%' THEN has_access := partner_level <= 2;
        WHEN menu_path LIKE '/admin/system%' THEN has_access := partner_level <= 1;
        WHEN menu_path LIKE '/admin/banners%' THEN has_access := partner_level <= 5;
        WHEN menu_path LIKE '/admin/announcements%' THEN has_access := partner_level <= 5;
        WHEN menu_path LIKE '/admin/messages%' THEN has_access := partner_level <= 6;
        WHEN menu_path LIKE '/admin/customer%' THEN has_access := partner_level <= 6;
        ELSE has_access := FALSE;
    END CASE;
    
    RETURN has_access;
END;
$$ LANGUAGE plpgsql;

-- 7. 실시간 알림 생성 함수
CREATE OR REPLACE FUNCTION create_realtime_notification(
    recipient_id_param UUID,
    type_param VARCHAR(50),
    title_param VARCHAR(255),
    message_param TEXT,
    data_param JSONB DEFAULT NULL,
    priority_param VARCHAR(10) DEFAULT 'normal'
)
RETURNS UUID AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO realtime_notifications (
        recipient_id,
        notification_type,
        title,
        message,
        data,
        priority
    )
    VALUES (
        recipient_id_param,
        type_param,
        title_param,
        message_param,
        data_param,
        priority_param
    )
    RETURNING id INTO notification_id;
    
    RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- 8. API 호출 로그 기록 함수
CREATE OR REPLACE FUNCTION log_api_call(
    partner_id_param UUID,
    endpoint_param VARCHAR(255),
    method_param VARCHAR(10),
    request_data_param JSONB,
    response_data_param JSONB,
    status_code_param INTEGER,
    response_time_param INTEGER,
    success_param BOOLEAN,
    error_message_param TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO api_call_logs (
        partner_id,
        api_endpoint,
        method,
        request_data,
        response_data,
        status_code,
        response_time_ms,
        success,
        error_message
    )
    VALUES (
        partner_id_param,
        endpoint_param,
        method_param,
        request_data_param,
        response_data_param,
        status_code_param,
        response_time_param,
        success_param,
        error_message_param
    )
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- 9. 실시간 통계 함수
CREATE OR REPLACE FUNCTION get_realtime_dashboard_stats(partner_id_param UUID)
RETURNS JSON AS $$
DECLARE
    partner_level INTEGER;
    stats JSON;
BEGIN
    -- 파트너 레벨 확인
    SELECT level INTO partner_level FROM partners WHERE id = partner_id_param;
    
    IF partner_level IS NULL THEN
        RETURN json_build_object('error', '파트너를 찾을 수 없습니다.');
    END IF;
    
    -- 권한에 따른 통계 데이터 조회
    SELECT json_build_object(
        'total_users', (
            SELECT COUNT(*) FROM users u 
            WHERE (partner_level = 1 OR u.referrer_id = partner_id_param OR u.referrer_id IN (
                SELECT id FROM partners WHERE parent_id = partner_id_param
            ))
        ),
        'online_users', (
            SELECT COUNT(*) FROM users u 
            WHERE u.is_online = true 
            AND (partner_level = 1 OR u.referrer_id = partner_id_param OR u.referrer_id IN (
                SELECT id FROM partners WHERE parent_id = partner_id_param
            ))
        ),
        'total_balance', (
            SELECT COALESCE(SUM(balance), 0) FROM users u 
            WHERE (partner_level = 1 OR u.referrer_id = partner_id_param OR u.referrer_id IN (
                SELECT id FROM partners WHERE parent_id = partner_id_param
            ))
        ),
        'daily_deposits', (
            SELECT COALESCE(SUM(amount), 0) FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.transaction_type = 'deposit' 
            AND t.status = 'approved'
            AND DATE(t.created_at) = CURRENT_DATE
            AND (partner_level = 1 OR u.referrer_id = partner_id_param OR u.referrer_id IN (
                SELECT id FROM partners WHERE parent_id = partner_id_param
            ))
        ),
        'daily_withdrawals', (
            SELECT COALESCE(SUM(amount), 0) FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.transaction_type = 'withdrawal' 
            AND t.status = 'approved'
            AND DATE(t.created_at) = CURRENT_DATE
            AND (partner_level = 1 OR u.referrer_id = partner_id_param OR u.referrer_id IN (
                SELECT id FROM partners WHERE parent_id = partner_id_param
            ))
        ),
        'pending_requests', (
            SELECT COUNT(*) FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.status = 'pending'
            AND (partner_level = 1 OR u.referrer_id = partner_id_param OR u.referrer_id IN (
                SELECT id FROM partners WHERE parent_id = partner_id_param
            ))
        ),
        'unread_notifications', (
            SELECT COUNT(*) FROM realtime_notifications
            WHERE recipient_id = partner_id_param AND is_read = false
        )
    ) INTO stats;
    
    RETURN stats;
END;
$$ LANGUAGE plpgsql;

-- 10. 사용자 활동 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_user_activity_stats(
    user_id_param UUID,
    activity_type VARCHAR(50),
    amount_param DECIMAL(15,2) DEFAULT 0
)
RETURNS VOID AS $$
DECLARE
    today_date DATE := CURRENT_DATE;
BEGIN
    -- 오늘 날짜 통계 레코드가 없으면 생성
    INSERT INTO user_activity_stats (user_id, stat_date)
    VALUES (user_id_param, today_date)
    ON CONFLICT (user_id, stat_date) DO NOTHING;
    
    -- 활동 타입에 따라 통계 업데이트
    UPDATE user_activity_stats 
    SET 
        login_count = CASE WHEN activity_type = 'login' THEN login_count + 1 ELSE login_count END,
        game_sessions = CASE WHEN activity_type = 'game_start' THEN game_sessions + 1 ELSE game_sessions END,
        total_bet_amount = CASE WHEN activity_type = 'bet' THEN total_bet_amount + amount_param ELSE total_bet_amount END,
        total_win_amount = CASE WHEN activity_type = 'win' THEN total_win_amount + amount_param ELSE total_win_amount END,
        deposit_count = CASE WHEN activity_type = 'deposit' THEN deposit_count + 1 ELSE deposit_count END,
        withdrawal_count = CASE WHEN activity_type = 'withdrawal' THEN withdrawal_count + 1 ELSE withdrawal_count END,
        updated_at = NOW()
    WHERE user_id = user_id_param AND stat_date = today_date;
END;
$$ LANGUAGE plpgsql;

-- 11. 파트너 온라인 상태 업데이트 함수
CREATE OR REPLACE FUNCTION update_partner_online_status(
    partner_id_param UUID,
    is_online_param BOOLEAN DEFAULT TRUE
)
RETURNS VOID AS $$
BEGIN
    UPDATE partners 
    SET 
        is_online = is_online_param,
        last_login_at = CASE WHEN is_online_param THEN NOW() ELSE last_login_at END
    WHERE id = partner_id_param;
END;
$$ LANGUAGE plpgsql;

-- 12. 알림 읽음 처리 함수
CREATE OR REPLACE FUNCTION mark_notification_as_read(
    notification_id_param UUID,
    recipient_id_param UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE realtime_notifications 
    SET 
        is_read = true,
        read_at = NOW()
    WHERE id = notification_id_param 
    AND recipient_id = recipient_id_param
    AND is_read = false;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;

-- 13. 기본 시스템 설정 추가 (기존 테이블 활용)
DO $$
BEGIN
    -- 기본 설정들을 하나씩 안전하게 추가
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'sound_enabled', 'true', '알림 소리 활성화'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'sound_enabled');
    
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'popup_enabled', 'true', '팝업 알림 활성화'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'popup_enabled');
    
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'sync_interval', '30', 'API 동기화 간격 (초)'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'sync_interval');
    
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'max_retry_count', '3', 'API 호출 최대 재시도 횟수'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'max_retry_count');
    
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'default_rtp', '96.5', '기본 RTP 비율'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'default_rtp');
    
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'auto_processing', 'false', '자동 정산 처리'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'auto_processing');
    
    INSERT INTO system_settings (setting_key, setting_value, description) 
    SELECT 'maintenance_mode', 'false', '시스템 점검 모드'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'maintenance_mode');
    
    RAISE NOTICE '✓ 기본 시스템 설정이 추가되었습니다.';
END $$;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================== ';
    RAISE NOTICE '🎯 GMS 시스템 최종 최적화 완료! (안전 버전)';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '✅ 파트너 테이블 확장 (메뉴 권한, 알림 설정, 온라인 상태)';
    RAISE NOTICE '✅ 실시간 알림 시스템';
    RAISE NOTICE '✅ API 호출 로그 시스템';
    RAISE NOTICE '✅ 사용자 활동 통계 시스템';
    RAISE NOTICE '✅ 권한별 메뉴 접근 제어';
    RAISE NOTICE '✅ 실시간 대시보드 통계';
    RAISE NOTICE '✅ 기본 시스템 설정';
    RAISE NOTICE '';
    RAISE NOTICE '📊 주요 함수:';
    RAISE NOTICE '  • check_menu_access() - 메뉴 접근 권한 확인';
    RAISE NOTICE '  • get_realtime_dashboard_stats() - 실시간 통계';
    RAISE NOTICE '  • create_realtime_notification() - 알림 생성';
    RAISE NOTICE '  • update_user_activity_stats() - 활동 통계 업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 GMS 시스템이 완전히 준비되었습니다!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
END $$;