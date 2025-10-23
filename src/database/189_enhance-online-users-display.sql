-- ============================================================================
-- 189. 온라인 사용자 현황 컬럼 추가 (접속IP, 접속지역, 보유금, 패턴감지)
-- ============================================================================
-- 작성일: 2025-10-11
-- 목적: 
--   온라인 사용자 현황에 필요한 추가 정보 표시
--   - 접속 IP
--   - 접속 지역
--   - 보유금 (실시간)
--   - 패턴 감지 정보
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '189. 온라인 사용자 현황 컬럼 추가';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: user_sessions 테이블에 IP 및 지역 정보 컬럼 추가
-- ============================================

DO $$
BEGIN
    -- ip_address 컬럼 추가 (없을 경우만)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_sessions'
        AND column_name = 'ip_address'
    ) THEN
        ALTER TABLE user_sessions 
        ADD COLUMN ip_address VARCHAR(45);  -- IPv4/IPv6 모두 지원
        
        RAISE NOTICE '✅ ip_address 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️ ip_address 컬럼 이미 존재';
    END IF;
    
    -- location 컬럼 추가 (없을 경우만)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_sessions'
        AND column_name = 'location'
    ) THEN
        ALTER TABLE user_sessions 
        ADD COLUMN location TEXT;  -- "서울특별시", "부산광역시" 등
        
        RAISE NOTICE '✅ location 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️ location 컬럼 이미 존재';
    END IF;
    
    -- country_code 컬럼 추가 (없을 경우만)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_sessions'
        AND column_name = 'country_code'
    ) THEN
        ALTER TABLE user_sessions 
        ADD COLUMN country_code VARCHAR(2);  -- ISO 3166-1 alpha-2 (KR, US, JP 등)
        
        RAISE NOTICE '✅ country_code 컬럼 추가 완료';
    ELSE
        RAISE NOTICE '⏭️ country_code 컬럼 이미 존재';
    END IF;
END $$;

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_sessions_ip_address 
ON user_sessions(ip_address);

CREATE INDEX IF NOT EXISTS idx_user_sessions_location 
ON user_sessions(location);

DO $$
BEGIN
    RAISE NOTICE '✅ user_sessions 인덱스 생성 완료';
END $$;

-- ============================================
-- 2단계: get_active_game_sessions 함수 수정 (추가 정보 포함)
-- ============================================

DROP FUNCTION IF EXISTS get_active_game_sessions(UUID, UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_active_game_sessions(
    p_user_id UUID DEFAULT NULL,
    p_admin_partner_id UUID DEFAULT NULL
)
RETURNS TABLE (
    session_id BIGINT,
    user_id UUID,
    username VARCHAR(50),
    nickname VARCHAR(50),
    game_name VARCHAR(200),
    provider_name VARCHAR(100),
    balance_before DECIMAL(15,2),
    current_balance DECIMAL(15,2),
    session_duration_minutes INTEGER,
    launched_at TIMESTAMPTZ,
    -- 새로 추가되는 컬럼
    ip_address VARCHAR(45),
    location TEXT,
    country_code VARCHAR(2),
    last_activity_at TIMESTAMPTZ,
    risk_score DECIMAL(5,2),
    pattern_flags TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_type TEXT;
    v_allowed_partner_ids UUID[];
BEGIN
    -- 비정상 세션 자동 만료
    PERFORM expire_old_game_sessions();
    
    -- 관리자 권한 확인
    IF p_admin_partner_id IS NOT NULL THEN
        SELECT partner_type INTO v_admin_type
        FROM partners
        WHERE id = p_admin_partner_id;
        
        IF v_admin_type = '시스템관리자' THEN
            v_allowed_partner_ids := NULL;
        ELSE
            -- 계층별 하위 조직 조회
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id
               OR id IN (
                   SELECT id FROM partners 
                   WHERE parent_id IN (
                       SELECT id FROM partners WHERE parent_id = p_admin_partner_id
                   )
               );
        END IF;
    END IF;
    
    RETURN QUERY
    SELECT DISTINCT ON (gls.user_id, gls.game_id)
        gls.id as session_id,
        gls.user_id,
        u.username,
        COALESCE(u.nickname, u.username) as nickname,
        COALESCE(g.name, 'Unknown Game') as game_name,
        COALESCE(gp.name, 'Unknown Provider') as provider_name,
        gls.balance_before,
        u.balance as current_balance,
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60 as session_duration_minutes,
        gls.launched_at,
        -- 추가 정보
        us.session_ip,
        COALESCE(us.session_location, 'Unknown') as location,
        us.session_country,
        gls.last_activity_at,
        COALESCE(upa.risk_score, 0) as risk_score,
        COALESCE(upa.pattern_flags, ARRAY[]::TEXT[]) as pattern_flags
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
    LEFT JOIN LATERAL (
        -- 가장 최근 활성 세션 정보
        SELECT 
            CAST(user_sessions.ip_address AS VARCHAR(45)) as session_ip,
            user_sessions.location as session_location,
            user_sessions.country_code as session_country
        FROM user_sessions
        WHERE user_sessions.user_id = gls.user_id
        AND user_sessions.is_active = true
        ORDER BY user_sessions.login_at DESC
        LIMIT 1
    ) us ON true
    LEFT JOIN LATERAL (
        -- 사용자 패턴 분석 정보
        SELECT 
            CASE 
                WHEN suspicious_count > 5 THEN 85.0
                WHEN suspicious_count > 2 THEN 60.0
                WHEN suspicious_count > 0 THEN 35.0
                ELSE 10.0
            END as risk_score,
            ARRAY_REMOVE(ARRAY[flag1, flag2, flag3], NULL) as pattern_flags
        FROM (
            SELECT 
                COUNT(*) FILTER (
                    WHERE gr_outer.bet_amount > (
                        SELECT AVG(gr_inner.bet_amount) * 3 
                        FROM game_records gr_inner
                        WHERE gr_inner.user_id = gls.user_id
                    )
                ) as suspicious_count,
                CASE WHEN COUNT(*) > 100 THEN '고빈도베팅' ELSE NULL END as flag1,
                CASE WHEN MAX(gr_outer.bet_amount) > 1000000 THEN '고액베팅' ELSE NULL END as flag2,
                CASE WHEN COUNT(DISTINCT gr_outer.game_id) > 20 THEN '다중게임' ELSE NULL END as flag3
            FROM game_records gr_outer
            WHERE gr_outer.user_id = gls.user_id
            AND gr_outer.played_at > NOW() - INTERVAL '24 hours'
        ) pattern_check
    ) upa ON true
    WHERE gls.status = 'active'
        AND gls.ended_at IS NULL
        AND (p_user_id IS NULL OR gls.user_id = p_user_id)
        AND (
            v_allowed_partner_ids IS NULL
            OR u.referrer_id = ANY(v_allowed_partner_ids)
        )
    ORDER BY gls.user_id, gls.game_id, gls.launched_at DESC;
END;
$$;

COMMENT ON FUNCTION get_active_game_sessions IS '활성 게임 세션 조회 (IP, 지역, 보유금, 패턴 감지 포함)';

-- 권한 설정
GRANT EXECUTE ON FUNCTION get_active_game_sessions(UUID, UUID) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ get_active_game_sessions 함수 확장 완료';
END $$;

-- ============================================
-- 3단계: 사용자 로그인 시 IP 및 지역 정보 저장 함수
-- ============================================

CREATE OR REPLACE FUNCTION save_user_session_with_location(
    p_user_id UUID,
    p_session_token VARCHAR(255),
    p_ip_address VARCHAR(45),
    p_location TEXT DEFAULT NULL,
    p_country_code VARCHAR(2) DEFAULT NULL,
    p_device_info JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- 기존 활성 세션 비활성화
    UPDATE user_sessions
    SET 
        is_active = false,
        logout_at = NOW()
    WHERE user_id = p_user_id
    AND is_active = true;
    
    -- 새 세션 생성
    INSERT INTO user_sessions (
        user_id,
        session_token,
        ip_address,
        location,
        country_code,
        device_info,
        login_at,
        last_activity,
        is_active
    ) VALUES (
        p_user_id,
        p_session_token,
        p_ip_address,
        p_location,
        p_country_code,
        p_device_info,
        NOW(),
        NOW(),
        true
    ) RETURNING id INTO v_session_id;
    
    -- users 테이블 is_online 상태 업데이트
    UPDATE users
    SET is_online = true
    WHERE id = p_user_id;
    
    RAISE NOTICE '✅ 사용자 세션 생성: user_id=%, ip=%, location=%', 
        p_user_id, p_ip_address, COALESCE(p_location, 'Unknown');
    
    RETURN v_session_id;
END;
$$;

COMMENT ON FUNCTION save_user_session_with_location IS '사용자 로그인 시 IP 및 지역 정보와 함께 세션 생성';

-- 권한 설정
GRANT EXECUTE ON FUNCTION save_user_session_with_location(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ save_user_session_with_location 함수 생성 완료';
END $$;

-- ============================================
-- 4단계: 패턴 감지 개선 함수
-- ============================================

CREATE OR REPLACE FUNCTION get_user_risk_assessment(
    p_user_id UUID
)
RETURNS TABLE (
    risk_score DECIMAL(5,2),
    risk_level TEXT,
    pattern_flags TEXT[],
    total_bets INTEGER,
    total_wagered DECIMAL(15,2),
    avg_bet_amount DECIMAL(15,2),
    max_bet_amount DECIMAL(15,2),
    unique_games_count INTEGER,
    suspicious_activity_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_avg_bet DECIMAL(15,2);
    v_max_bet DECIMAL(15,2);
    v_total_bets INTEGER;
    v_total_wagered DECIMAL(15,2);
    v_unique_games INTEGER;
    v_high_bet_count INTEGER;
    v_rapid_bet_count INTEGER;
    v_multi_game_count INTEGER;
    v_flags TEXT[] := ARRAY[]::TEXT[];
    v_score DECIMAL(5,2) := 0;
    v_level TEXT;
BEGIN
    -- 최근 24시간 베팅 통계
    SELECT 
        COUNT(*),
        COALESCE(SUM(bet_amount), 0),
        COALESCE(AVG(bet_amount), 0),
        COALESCE(MAX(bet_amount), 0),
        COUNT(DISTINCT game_id)
    INTO 
        v_total_bets,
        v_total_wagered,
        v_avg_bet,
        v_max_bet,
        v_unique_games
    FROM game_records
    WHERE user_id = p_user_id
    AND played_at > NOW() - INTERVAL '24 hours';
    
    -- 의심 패턴 감지
    
    -- 1. 고액 베팅 (평균의 3배 이상)
    SELECT COUNT(*) INTO v_high_bet_count
    FROM game_records
    WHERE user_id = p_user_id
    AND played_at > NOW() - INTERVAL '24 hours'
    AND bet_amount > v_avg_bet * 3;
    
    IF v_high_bet_count > 5 THEN
        v_flags := array_append(v_flags, '고액베팅');
        v_score := v_score + 25;
    END IF;
    
    -- 2. 빠른 베팅 (1분 내 5회 이상)
    SELECT COUNT(*) INTO v_rapid_bet_count
    FROM (
        SELECT 
            played_at,
            LAG(played_at) OVER (ORDER BY played_at) as prev_bet_time
        FROM game_records
        WHERE user_id = p_user_id
        AND played_at > NOW() - INTERVAL '1 hour'
    ) rapid_bets
    WHERE EXTRACT(EPOCH FROM (played_at - prev_bet_time)) < 60;
    
    IF v_rapid_bet_count > 10 THEN
        v_flags := array_append(v_flags, '고빈도베팅');
        v_score := v_score + 20;
    END IF;
    
    -- 3. 다중 게임 플레이 (20개 이상)
    IF v_unique_games > 20 THEN
        v_flags := array_append(v_flags, '다중게임');
        v_score := v_score + 15;
    END IF;
    
    -- 4. 매우 높은 베팅 금액 (100만원 이상)
    IF v_max_bet > 1000000 THEN
        v_flags := array_append(v_flags, '초고액베팅');
        v_score := v_score + 30;
    END IF;
    
    -- 5. 총 베팅 횟수 (100회 이상)
    IF v_total_bets > 100 THEN
        v_flags := array_append(v_flags, '과다베팅');
        v_score := v_score + 10;
    END IF;
    
    -- 위험 레벨 결정
    IF v_score >= 70 THEN
        v_level := '높음';
    ELSIF v_score >= 40 THEN
        v_level := '중간';
    ELSIF v_score >= 20 THEN
        v_level := '낮음';
    ELSE
        v_level := '정상';
    END IF;
    
    RETURN QUERY SELECT 
        v_score,
        v_level,
        v_flags,
        v_total_bets,
        v_total_wagered,
        v_avg_bet,
        v_max_bet,
        v_unique_games,
        v_high_bet_count + v_rapid_bet_count;
END;
$$;

COMMENT ON FUNCTION get_user_risk_assessment IS '사용자 위험도 평가 (패턴 감지)';

-- 권한 설정
GRANT EXECUTE ON FUNCTION get_user_risk_assessment(UUID) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ get_user_risk_assessment 함수 생성 완료';
END $$;

-- ============================================
-- 5단계: 검증 및 테스트
-- ============================================

DO $$
DECLARE
    v_session_count INTEGER;
    v_with_ip_count INTEGER;
    v_with_location_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_session_count FROM user_sessions WHERE is_active = true;
    SELECT COUNT(*) INTO v_with_ip_count FROM user_sessions WHERE ip_address IS NOT NULL AND is_active = true;
    SELECT COUNT(*) INTO v_with_location_count FROM user_sessions WHERE location IS NOT NULL AND is_active = true;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 사용자 세션 통계';
    RAISE NOTICE '============================================';
    RAISE NOTICE '전체 활성 세션: % 건', v_session_count;
    RAISE NOTICE '  - IP 정보 있음: % 건', v_with_ip_count;
    RAISE NOTICE '  - 지역 정보 있음: % 건', v_with_location_count;
    RAISE NOTICE '============================================';
END $$;

-- 샘플 테스트
DO $$
DECLARE
    v_test_result RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🧪 테스트 실행: 활성 게임 세션 조회';
    RAISE NOTICE '--------------------------------------------';
    
    FOR v_test_result IN 
        SELECT * FROM get_active_game_sessions(NULL, NULL)
        LIMIT 5
    LOOP
        RAISE NOTICE '세션 #%: User=%, Game=%, IP=%, Location=%, Risk=%', 
            v_test_result.session_id,
            v_test_result.username,
            v_test_result.game_name,
            COALESCE(v_test_result.ip_address, 'N/A'),
            COALESCE(v_test_result.location, 'Unknown'),
            v_test_result.risk_score;
    END LOOP;
    
    RAISE NOTICE '--------------------------------------------';
END $$;

-- ============================================
-- 6단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 189. 온라인 사용자 현황 컬럼 추가 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '구현 내용:';
    RAISE NOTICE '1. ✅ user_sessions 테이블에 IP/지역 정보 컬럼 추가';
    RAISE NOTICE '   - ip_address (VARCHAR 45)';
    RAISE NOTICE '   - location (TEXT)';
    RAISE NOTICE '   - country_code (VARCHAR 2)';
    RAISE NOTICE '2. ✅ get_active_game_sessions 함수 확장';
    RAISE NOTICE '   - IP 주소';
    RAISE NOTICE '   - 접속 지역';
    RAISE NOTICE '   - 보유금 (current_balance)';
    RAISE NOTICE '   - 위험도 점수 (risk_score)';
    RAISE NOTICE '   - 패턴 플래그 (pattern_flags)';
    RAISE NOTICE '3. ✅ save_user_session_with_location 함수 생성';
    RAISE NOTICE '   - 로그인 시 IP/지역 정보 저장';
    RAISE NOTICE '4. ✅ get_user_risk_assessment 함수 생성';
    RAISE NOTICE '   - 패턴 감지 개선';
    RAISE NOTICE '   - 위험도 레벨 자동 판정';
    RAISE NOTICE '';
    RAISE NOTICE '📌 프론트엔드 연동:';
    RAISE NOTICE '  OnlineUsers.tsx에서 추가 컬럼 표시 필요';
    RAISE NOTICE '  - IP Address';
    RAISE NOTICE '  - Location';
    RAISE NOTICE '  - Current Balance';
    RAISE NOTICE '  - Risk Score';
    RAISE NOTICE '  - Pattern Flags (Badge)';
    RAISE NOTICE '============================================';
END $$;
