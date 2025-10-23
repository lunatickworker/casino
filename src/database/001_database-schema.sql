-- =====================================================
-- GMS (게임 관리 시스템) Database Schema
-- 7단계 권한 체계: 시스템관리자 → 대본사 → 본사 → 부본사 → 총판 → 매장 → 사용자
-- =====================================================

-- 1. 파트너 테이블 (7단계 권한 체계)
CREATE TABLE partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    partner_type VARCHAR(20) NOT NULL CHECK (partner_type IN ('system_admin', 'head_office', 'main_office', 'sub_office', 'distributor', 'store')),
    parent_id UUID REFERENCES partners(id),
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6), -- 1:시스템관리자, 2:대본사, 3:본사, 4:부본사, 5:총판, 6:매장
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
    balance DECIMAL(15,2) DEFAULT 0,
    opcode VARCHAR(100), -- 대본사만 사용
    secret_key VARCHAR(255), -- 대본사만 사용 
    api_token VARCHAR(255), -- 대본사만 사용
    commission_rolling DECIMAL(5,2) DEFAULT 0, -- 롤링 커미션 요율(%)
    commission_losing DECIMAL(5,2) DEFAULT 0, -- 루징 커미션 요율(%)
    withdrawal_fee DECIMAL(5,2) DEFAULT 0, -- 환전 수수료(%)
    bank_name VARCHAR(50),
    bank_account VARCHAR(50),
    bank_holder VARCHAR(50),
    contact_info JSONB,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 사용자 테이블
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked')),
    balance DECIMAL(15,2) DEFAULT 0,
    points DECIMAL(15,2) DEFAULT 0,
    external_token VARCHAR(255), -- 외부 API 토큰
    bank_name VARCHAR(50),
    bank_account VARCHAR(50),
    bank_holder VARCHAR(50),
    referrer_id UUID REFERENCES partners(id), -- 추천인(파트너)
    ip_address INET,
    device_info JSONB,
    last_login_at TIMESTAMP WITH TIME ZONE,
    is_online BOOLEAN DEFAULT FALSE,
    vip_level INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 블랙리스트 테이블
CREATE TABLE blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    partner_id UUID REFERENCES partners(id), -- 처리한 파트너
    reason TEXT,
    blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    unblocked_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

-- 4. 거래 내역 테이블 (입출금)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    partner_id UUID REFERENCES partners(id), -- 처리한 파트너
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'point_conversion', 'admin_adjustment')),
    amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    bank_name VARCHAR(50),
    bank_account VARCHAR(50),
    bank_holder VARCHAR(50),
    memo TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    external_response JSONB, -- 외부 API 응답
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. 포인트 거래 내역 테이블
CREATE TABLE point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    partner_id UUID REFERENCES partners(id), -- 지급한 파트너
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'use', 'convert_to_balance', 'admin_adjustment')),
    amount DECIMAL(15,2) NOT NULL,
    points_before DECIMAL(15,2) NOT NULL,
    points_after DECIMAL(15,2) NOT NULL,
    memo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. 게임 제공사 테이블
CREATE TABLE game_providers (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('slot', 'casino')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. 게임 테이블
CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    provider_id INTEGER REFERENCES game_providers(id),
    name VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('slot', 'casino')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('visible', 'hidden', 'maintenance')),
    image_url TEXT,
    demo_available BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. 게임 기록 테이블
CREATE TABLE game_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_txid BIGINT NOT NULL, -- 외부 API txid
    user_id UUID REFERENCES users(id),
    game_id INTEGER REFERENCES games(id),
    provider_id INTEGER REFERENCES game_providers(id),
    bet_amount DECIMAL(15,2) NOT NULL,
    win_amount DECIMAL(15,2) DEFAULT 0,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    game_round_id VARCHAR(100),
    external_data JSONB, -- 외부 API 상세 데이터
    played_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 중복 방지를 위한 유니크 제약
    UNIQUE(external_txid, user_id, played_at)
);

-- 9. 정산 테이블
CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id),
    settlement_type VARCHAR(20) NOT NULL CHECK (settlement_type IN ('rolling', 'losing')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_bet_amount DECIMAL(15,2) DEFAULT 0,
    total_win_amount DECIMAL(15,2) DEFAULT 0,
    commission_rate DECIMAL(5,2) NOT NULL,
    commission_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. 공지사항 테이블
CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id), -- 작성자
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    target_type VARCHAR(20) DEFAULT 'users' CHECK (target_type IN ('users', 'partners', 'all')),
    target_level INTEGER, -- 특정 파트너 레벨 대상시
    is_popup BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. 공지사항 읽음 기록 테이블
CREATE TABLE announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID REFERENCES announcements(id),
    user_id UUID REFERENCES users(id),
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(announcement_id, user_id)
);

-- 12. 메시지 테이블 (1:1 문의, 쪽지)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'partner')),
    sender_id UUID NOT NULL, -- users.id 또는 partners.id
    receiver_type VARCHAR(20) NOT NULL CHECK (receiver_type IN ('user', 'partner')),
    receiver_id UUID NOT NULL, -- users.id 또는 partners.id
    subject VARCHAR(200),
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'inquiry' CHECK (message_type IN ('inquiry', 'notice', 'message')),
    status VARCHAR(20) DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied')),
    parent_id UUID REFERENCES messages(id), -- 답글인 경우
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. 배너 테이블
CREATE TABLE banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID REFERENCES partners(id), -- 생성자
    title VARCHAR(200) NOT NULL,
    content TEXT,
    image_url TEXT,
    banner_type VARCHAR(20) DEFAULT 'popup' CHECK (banner_type IN ('popup', 'banner')),
    target_audience VARCHAR(20) DEFAULT 'all' CHECK (target_audience IN ('all', 'users', 'partners')),
    target_level INTEGER, -- 특정 파트너 레벨 대상시
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    display_order INTEGER DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. 시스템 설정 테이블
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(20) DEFAULT 'string' CHECK (setting_type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    partner_level INTEGER, -- 어느 레벨까지 설정 가능한지
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. 메뉴 관리 테이블 (시스템관리자용)
CREATE TABLE menu_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_name VARCHAR(100) NOT NULL,
    menu_path VARCHAR(200) NOT NULL,
    partner_level INTEGER NOT NULL, -- 1~6
    is_visible BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    parent_menu VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 16. 로그 테이블
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('user', 'partner', 'system')),
    actor_id UUID, -- users.id 또는 partners.id
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 17. API 동기화 로그 테이블
CREATE TABLE api_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opcode VARCHAR(100) NOT NULL,
    api_endpoint VARCHAR(200) NOT NULL,
    sync_type VARCHAR(50) NOT NULL, -- 'balance', 'game_history', 'user_list' 등
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'error', 'partial')),
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    response_data JSONB,
    sync_duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 18. 온라인 세션 테이블
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    device_info JSONB,
    location_info JSONB,
    login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    logout_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

-- =====================================================
-- 인덱스 생성
-- =====================================================

-- 파트너 관련 인덱스
CREATE INDEX idx_partners_parent_id ON partners(parent_id);
CREATE INDEX idx_partners_level ON partners(level);
CREATE INDEX idx_partners_opcode ON partners(opcode);

-- 사용자 관련 인덱스
CREATE INDEX idx_users_referrer_id ON users(referrer_id);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_is_online ON users(is_online);

-- 거래 관련 인덱스
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_partner_id ON transactions(partner_id);
CREATE INDEX idx_transactions_type_status ON transactions(transaction_type, status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- 게임 기록 관련 인덱스
CREATE INDEX idx_game_records_user_id ON game_records(user_id);
CREATE INDEX idx_game_records_game_id ON game_records(game_id);
CREATE INDEX idx_game_records_played_at ON game_records(played_at);
CREATE INDEX idx_game_records_external_txid ON game_records(external_txid);

-- 메시지 관련 인덱스
CREATE INDEX idx_messages_sender ON messages(sender_type, sender_id);
CREATE INDEX idx_messages_receiver ON messages(receiver_type, receiver_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- 로그 관련 인덱스
CREATE INDEX idx_activity_logs_actor ON activity_logs(actor_type, actor_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX idx_api_sync_logs_opcode ON api_sync_logs(opcode);
CREATE INDEX idx_api_sync_logs_created_at ON api_sync_logs(created_at);

-- =====================================================
-- 초기 데이터 삽입
-- =====================================================

-- 게임 제공사 데이터 (README.md 기준)
INSERT INTO game_providers (id, name, type) VALUES
-- 슬롯 제공사
(1, '마이크로게이밍', 'slot'),
(17, '플레이앤고', 'slot'),
(20, 'CQ9 게이밍', 'slot'),
(21, '제네시스 게이밍', 'slot'),
(22, '하바네로', 'slot'),
(23, '게임아트', 'slot'),
(27, '플레이텍', 'slot'),
(38, '블루프린트', 'slot'),
(39, '부운고', 'slot'),
(40, '드라군소프트', 'slot'),
(41, '엘크 스튜디오', 'slot'),
(47, '드림테크', 'slot'),
(51, '칼람바 게임즈', 'slot'),
(52, '모빌롯', 'slot'),
(53, '노리밋 시티', 'slot'),
(55, 'OMI 게이밍', 'slot'),
(56, '원터치', 'slot'),
(59, '플레이슨', 'slot'),
(60, '푸쉬 게이밍', 'slot'),
(61, '퀵스핀', 'slot'),
(62, 'RTG 슬롯', 'slot'),
(63, '리볼버 게이밍', 'slot'),
(65, '슬롯밀', 'slot'),
(66, '스피어헤드', 'slot'),
(70, '썬더킥', 'slot'),
(72, '우후 게임즈', 'slot'),
(74, '릴렉스 게이밍', 'slot'),
(75, '넷엔트', 'slot'),
(76, '레드타이거', 'slot'),
(87, 'PG소프트', 'slot'),
(88, '플레이스타', 'slot'),
(90, '빅타임게이밍', 'slot'),
(300, '프라그마틱 플레이', 'slot'),
-- 카지노 제공사
(410, '에볼루션 게이밍', 'casino'),
(77, '마이크로 게이밍', 'casino'),
(2, 'Vivo 게이밍', 'casino'),
(30, '아시아 게이밍', 'casino'),
(78, '프라그마틱플레이', 'casino'),
(86, '섹시게이밍', 'casino'),
(11, '비비아이엔', 'casino'),
(28, '드림게임', 'casino'),
(89, '오리엔탈게임', 'casino'),
(91, '보타', 'casino'),
(44, '이주기', 'casino'),
(85, '플레이텍 라이브', 'casino'),
(0, '제네럴 카지노', 'casino');

-- 시스템 기본 설정
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level) VALUES
('system_name', 'GMS 통합 관리 시스템', 'string', '시스템 이름', 1),
('default_rolling_commission', '0.5', 'number', '기본 롤링 커미션 요율(%)', 2),
('default_losing_commission', '5.0', 'number', '기본 루징 커미션 요율(%)', 2),
('default_withdrawal_fee', '1.0', 'number', '기본 환전 수수료(%)', 2),
('api_sync_interval', '30', 'number', 'API 동기화 주기(초)', 1),
('notification_sound', 'true', 'boolean', '알림 소리 사용', 3),
('auto_approval_limit', '100000', 'number', '자동 승인 한도', 2),
('maintenance_mode', 'false', 'boolean', '점검 모드', 1);

-- 기본 메뉴 권한 설정
INSERT INTO menu_permissions (menu_name, menu_path, partner_level, display_order, parent_menu) VALUES
-- 시스템관리자 전용 (level 1)
('시스템 정보', '/admin/system-info', 1, 701, '시스템 설정'),
('서버 API 테스터', '/admin/api-tester', 1, 702, '시스템 설정'),
('메뉴 관리', '/admin/menu-management', 1, 703, '시스템 설정'),
('콜주기', '/admin/call-cycle', 1, 501, '게임 관리'),

-- 대본사 이상 (level 2)
('대본사 관리', '/admin/head-office', 2, 301, '파트너 관리'),
('게임 관리', '/admin/games', 2, 500, null),
('게임 리스트 관리', '/admin/game-lists', 2, 501, '게임 관리'),
('베팅 내역 관리', '/admin/betting-history', 2, 502, '게임 관리'),

-- 본사 이상 (level 3)
('설정', '/admin/settings', 3, 700, '시스템 설정'),

-- 부본사 이상 (level 4)
('시스템 설정', '/admin/system', 4, 700, null),

-- 총판 이상 (level 5)
('공지사항', '/admin/announcements', 5, 601, '커뮤니케이션'),
('배너 관리', '/admin/banners', 5, 704, '시스템 설정'),

-- 매장 이상 (level 6)
('메시지 센터', '/admin/messages', 6, 603, '커뮤니케이션'),

-- 모든 파트너 (level 6)
('대시보드', '/admin/dashboard', 6, 100, null),
('실시간 현황', '/admin/realtime', 6, 101, '대시보드'),
('회원 관리', '/admin/users', 6, 200, null),
('회원 관리', '/admin/user-management', 6, 201, '회원 관리'),
('블랙 회원 관리', '/admin/blacklist', 6, 202, '회원 관리'),
('포인트 관리', '/admin/points', 6, 203, '회원 관리'),
('온라인 현황', '/admin/online-status', 6, 204, '회원 관리'),
('로그 관리', '/admin/logs', 6, 205, '회원 관리'),
('파트너 관리', '/admin/partners', 6, 300, null),
('파트너 계층 관리', '/admin/partner-hierarchy', 6, 302, '파트너 관리'),
('파트너 입출금 관리', '/admin/partner-transactions', 6, 303, '파트너 관리'),
('파트너별 접속 현황', '/admin/partner-online', 6, 304, '파트너 관리'),
('파트너 대시보드', '/admin/partner-dashboard', 6, 305, '파트너 관리'),
('정산 및 거래', '/admin/settlement', 6, 400, null),
('파트너별 수수료 정산', '/admin/commission-settlement', 6, 401, '정산 및 거래'),
('통합 정산', '/admin/integrated-settlement', 6, 402, '정산 및 거래'),
('입출금 관리', '/admin/transactions', 6, 403, '정산 및 거래'),
('커뮤니케이션', '/admin/communication', 6, 600, null),
('고객센터', '/admin/customer-service', 6, 602, '커뮤니케이션');

-- =====================================================
-- RLS (Row Level Security) 정책
-- =====================================================

-- 파트너 테이블 RLS
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

-- 사용자 테이블 RLS  
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 거래 테이블 RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 게임 기록 테이블 RLS
ALTER TABLE game_records ENABLE ROW LEVEL SECURITY;

-- 메시지 테이블 RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 함수 및 트리거
-- =====================================================

-- 업데이트 시간 자동 갱신 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 업데이트 트리거 생성
CREATE TRIGGER update_partners_updated_at BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_banners_updated_at BEFORE UPDATE ON banners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();