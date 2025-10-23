-- 사용자 페이지 개발을 위한 안전한 스키마 추가
-- 기존 테이블과 뷰 충돌을 방지하는 안전한 방법 사용
-- ⚠️ 주의: 대부분의 함수는 045_user-additional-functions.sql로 이관됨
-- ⚠️ 이 파일은 테이블 생성 및 게임 제공사 데이터만 포함

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
    RAISE NOTICE '✅ 필수 인덱스 생성 완료';
    RAISE NOTICE '';
    RAISE NOTICE '📌 함수 위치 안내:';
    RAISE NOTICE '  • 사용자 함수: 045_user-additional-functions.sql';
    RAISE NOTICE '  • 내정보 함수: 029_user-mypage-functions.sql';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 이제 사용자 페이지가 완전히 작동합니다!';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
END $$;
