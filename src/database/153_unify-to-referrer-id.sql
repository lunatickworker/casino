-- ============================================================================
-- 153. referrer_id로 완전 통일 (사용자 요구사항)
-- ============================================================================
-- 목적: 
-- 1. partners: parent_id로 조직 계층 구성 ✅
-- 2. users: referrer_id로 소속 조직 결정 ✅
-- 3. partner_id 사용 중지 및 모든 쿼리 referrer_id로 통일
-- ============================================================================

-- ============================================================================
-- STEP 1: partner_id → referrer_id 데이터 동기화
-- ============================================================================

UPDATE users 
SET referrer_id = partner_id,
    updated_at = NOW()
WHERE partner_id IS NOT NULL 
  AND referrer_id IS NULL;

-- ============================================================================
-- STEP 2: 기존 함수 삭제 (CASCADE로 의존성 제거)
-- ============================================================================

DROP FUNCTION IF EXISTS get_hierarchical_users(UUID) CASCADE;
DROP FUNCTION IF EXISTS create_user_with_api CASCADE;
DROP FUNCTION IF EXISTS get_hierarchical_game_records CASCADE;
DROP FUNCTION IF EXISTS get_active_game_sessions CASCADE;

-- ============================================================================
-- STEP 3: get_hierarchical_users 함수 (referrer_id 기준)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_hierarchical_users(p_partner_id UUID)
RETURNS TABLE (
    id UUID,
    username VARCHAR,
    nickname VARCHAR,
    status VARCHAR,
    balance NUMERIC,
    points NUMERIC,
    vip_level INTEGER,
    partner_id UUID,
    referrer_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    bank_name VARCHAR,
    bank_account VARCHAR,
    bank_holder VARCHAR,
    memo TEXT,
    is_online BOOLEAN,
    last_login_at TIMESTAMPTZ
) AS $$
DECLARE
    v_partner_type VARCHAR(50);
    v_level INTEGER;
BEGIN
    -- 관리자 권한 조회
    SELECT partner_type, level INTO v_partner_type, v_level
    FROM partners
    WHERE partners.id = p_partner_id;

    IF v_partner_type IS NULL AND v_level IS NULL THEN
        RAISE EXCEPTION '관리자 정보를 찾을 수 없습니다. Partner ID: %', p_partner_id;
    END IF;

    -- 시스템관리자: 레벨 1 또는 partner_type이 '시스템관리자' 또는 'system_admin'인 경우
    IF v_level = 1 OR v_partner_type IN ('시스템관리자', 'system_admin') THEN
        RETURN QUERY
        SELECT 
            u.id, u.username, u.nickname, u.status, u.balance, u.points, 
            u.vip_level, u.partner_id, u.referrer_id, u.created_at, u.updated_at,
            u.bank_name, u.bank_account, u.bank_holder, u.memo,
            COALESCE(u.is_online, false), u.last_login_at
        FROM users u
        ORDER BY u.created_at DESC;
        RETURN;
    END IF;

    -- 대본사 이하: referrer_id 기준으로 본인 조직 사용자만 조회
    RETURN QUERY
    SELECT 
        u.id, u.username, u.nickname, u.status, u.balance, u.points,
        u.vip_level, u.partner_id, u.referrer_id, u.created_at, u.updated_at,
        u.bank_name, u.bank_account, u.bank_holder, u.memo,
        COALESCE(u.is_online, false), u.last_login_at
    FROM users u
    WHERE u.referrer_id = p_partner_id
    ORDER BY u.created_at DESC;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_hierarchical_users IS 'referrer_id 기준으로 사용자 조회';

-- ============================================================================
-- STEP 4: create_user_with_api 함수 (referrer_id만 사용)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_user_with_api(
    p_username VARCHAR(50),
    p_nickname VARCHAR(50),
    p_password TEXT,
    p_bank_name VARCHAR(50) DEFAULT NULL,
    p_bank_account VARCHAR(50) DEFAULT NULL,
    p_memo TEXT DEFAULT NULL,
    p_referrer_id UUID DEFAULT NULL
) RETURNS TABLE (
    success BOOLEAN,
    user_id UUID,
    username TEXT,
    message TEXT,
    error TEXT
) AS $$
DECLARE
    v_user_id UUID;
    v_opcode VARCHAR(50);
    v_secret_key TEXT;
    v_token TEXT;
    v_signature TEXT;
    v_api_result JSONB;
BEGIN
    -- 1. 사용자명 중복 확인
    IF EXISTS (SELECT 1 FROM users WHERE users.username = p_username) THEN
        RETURN QUERY SELECT 
            FALSE, 
            NULL::UUID,
            p_username,
            ''::TEXT,
            '이미 존재하는 사용자명입니다.'::TEXT;
        RETURN;
    END IF;

    -- 2. 추천인의 OPCODE 정보 조회
    IF p_referrer_id IS NOT NULL THEN
        SELECT 
            COALESCE(p.opcode, parent.opcode),
            COALESCE(p.secret_key, parent.secret_key),
            COALESCE(p.token, parent.token)
        INTO v_opcode, v_secret_key, v_token
        FROM partners p
        LEFT JOIN partners parent ON parent.id = p.parent_id
        WHERE p.id = p_referrer_id;

        IF v_opcode IS NULL OR v_secret_key IS NULL OR v_token IS NULL THEN
            RETURN QUERY SELECT 
                FALSE,
                NULL::UUID,
                p_username,
                ''::TEXT,
                'OPCODE 정보를 찾을 수 없습니다.'::TEXT;
            RETURN;
        END IF;
    ELSE
        RETURN QUERY SELECT 
            FALSE,
            NULL::UUID,
            p_username,
            ''::TEXT,
            '추천인 정보가 필요합니다.'::TEXT;
        RETURN;
    END IF;

    -- 3. Invest API로 계정 생성
    v_signature := md5(v_opcode || p_username || v_secret_key);
    
    BEGIN
        SELECT content::jsonb INTO v_api_result
        FROM http((
            'POST',
            'https://vi8282.com/proxy',
            ARRAY[http_header('Content-Type', 'application/json')],
            'application/json',
            json_build_object(
                'url', 'https://api.invest-ho.com/api/account',
                'method', 'POST',
                'headers', json_build_object('Content-Type', 'application/json'),
                'body', json_build_object(
                    'opcode', v_opcode,
                    'username', p_username,
                    'signature', v_signature
                )
            )::text
        )::http_request);

        IF v_api_result->>'success' = 'false' THEN
            RETURN QUERY SELECT 
                FALSE,
                NULL::UUID,
                p_username,
                ''::TEXT,
                ('API 오류: ' || COALESCE(v_api_result->>'message', '알 수 없는 오류'))::TEXT;
            RETURN;
        END IF;

    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 
            FALSE,
            NULL::UUID,
            p_username,
            ''::TEXT,
            ('API 호출 실패: ' || SQLERRM)::TEXT;
        RETURN;
    END;

    -- 4. DB에 사용자 생성 (referrer_id만 설정)
    v_user_id := gen_random_uuid();
    
    INSERT INTO users (
        id,
        username,
        nickname,
        password_hash,
        status,
        balance,
        points,
        referrer_id,
        bank_name,
        bank_account,
        memo,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        p_username,
        COALESCE(p_nickname, p_username),
        crypt(p_password, gen_salt('bf')),
        'active',
        0,
        0,
        p_referrer_id,
        p_bank_name,
        p_bank_account,
        p_memo,
        NOW(),
        NOW()
    );

    RETURN QUERY SELECT 
        TRUE,
        v_user_id,
        p_username,
        '회원이 성공적으로 생성되었습니다.'::TEXT,
        ''::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        FALSE,
        NULL::UUID,
        p_username,
        ''::TEXT,
        ('DB 오류: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_user_with_api IS 'referrer_id로 소속 조직을 결정하여 사용자 생성';

-- ============================================================================
-- STEP 5: get_hierarchical_game_records 함수 (referrer_id 기준)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_hierarchical_game_records(
    p_partner_id UUID,
    p_start_date TIMESTAMPTZ DEFAULT NULL,
    p_end_date TIMESTAMPTZ DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    external_txid BIGINT,
    user_id UUID,
    username VARCHAR,
    game_id INTEGER,
    game_name VARCHAR,
    provider_id INTEGER,
    provider_name VARCHAR,
    bet_amount NUMERIC,
    win_amount NUMERIC,
    balance_before NUMERIC,
    balance_after NUMERIC,
    game_round_id VARCHAR,
    played_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    v_partner_type VARCHAR(50);
    v_level INTEGER;
BEGIN
    -- 관리자 권한 조회
    SELECT partner_type, level INTO v_partner_type, v_level
    FROM partners
    WHERE partners.id = p_partner_id;

    IF v_partner_type IS NULL AND v_level IS NULL THEN
        RAISE EXCEPTION '관리자 정보를 찾을 수 없습니다. Partner ID: %', p_partner_id;
    END IF;

    -- 시스템관리자: 레벨 1 또는 partner_type이 '시스템관리자' 또는 'system_admin'인 경우
    IF v_level = 1 OR v_partner_type IN ('시스템관리자', 'system_admin') THEN
        RETURN QUERY
        SELECT 
            gr.id,
            gr.external_txid,
            gr.user_id,
            u.username,
            gr.game_id,
            g.name AS game_name,
            gr.provider_id,
            gp.name AS provider_name,
            gr.bet_amount,
            gr.win_amount,
            gr.balance_before,
            gr.balance_after,
            gr.game_round_id,
            gr.played_at,
            gr.created_at
        FROM game_records gr
        LEFT JOIN users u ON gr.user_id = u.id
        LEFT JOIN games g ON gr.game_id = g.id
        LEFT JOIN game_providers gp ON gr.provider_id = gp.id
        WHERE (p_start_date IS NULL OR gr.played_at >= p_start_date)
          AND (p_end_date IS NULL OR gr.played_at <= p_end_date)
        ORDER BY gr.played_at DESC
        LIMIT p_limit;
        RETURN;
    END IF;

    -- 대본사 이하: referrer_id 기준으로 본인 조직 베팅만 조회
    RETURN QUERY
    SELECT 
        gr.id,
        gr.external_txid,
        gr.user_id,
        u.username,
        gr.game_id,
        g.name AS game_name,
        gr.provider_id,
        gp.name AS provider_name,
        gr.bet_amount,
        gr.win_amount,
        gr.balance_before,
        gr.balance_after,
        gr.game_round_id,
        gr.played_at,
        gr.created_at
    FROM game_records gr
    INNER JOIN users u ON gr.user_id = u.id
    LEFT JOIN games g ON gr.game_id = g.id
    LEFT JOIN game_providers gp ON gr.provider_id = gp.id
    WHERE u.referrer_id = p_partner_id
      AND (p_start_date IS NULL OR gr.played_at >= p_start_date)
      AND (p_end_date IS NULL OR gr.played_at <= p_end_date)
    ORDER BY gr.played_at DESC
    LIMIT p_limit;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_hierarchical_game_records IS 'referrer_id 기준으로 베팅 기록 조회';

-- ============================================================================
-- STEP 6: get_active_game_sessions 함수 (referrer_id 기준)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_active_game_sessions(p_partner_id UUID)
RETURNS TABLE (
    id BIGINT,
    user_id UUID,
    username VARCHAR,
    game_id BIGINT,
    game_name VARCHAR,
    provider_id INTEGER,
    provider_name VARCHAR,
    session_token VARCHAR,
    status VARCHAR,
    launched_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
) AS $$
DECLARE
    v_partner_type VARCHAR(50);
    v_level INTEGER;
BEGIN
    -- 관리자 권한 조회
    SELECT partner_type, level INTO v_partner_type, v_level
    FROM partners
    WHERE partners.id = p_partner_id;

    IF v_partner_type IS NULL AND v_level IS NULL THEN
        RAISE EXCEPTION '관리자 정보를 찾을 수 없습니다. Partner ID: %', p_partner_id;
    END IF;

    -- 시스템관리자: 레벨 1 또는 partner_type이 '시스템관리자' 또는 'system_admin'인 경우
    IF v_level = 1 OR v_partner_type IN ('시스템관리자', 'system_admin') THEN
        RETURN QUERY
        SELECT 
            gls.id,
            gls.user_id,
            u.username,
            gls.game_id,
            g.name AS game_name,
            g.provider_id,
            gp.name AS provider_name,
            gls.session_token,
            gls.status,
            gls.launched_at,
            gls.ended_at
        FROM game_launch_sessions gls
        LEFT JOIN users u ON gls.user_id = u.id
        LEFT JOIN games g ON gls.game_id = g.id
        LEFT JOIN game_providers gp ON g.provider_id = gp.id
        WHERE gls.status = 'active'
        ORDER BY gls.launched_at DESC;
        RETURN;
    END IF;

    -- 대본사 이하: referrer_id 기준으로 본인 조직 세션만 조회
    RETURN QUERY
    SELECT 
        gls.id,
        gls.user_id,
        u.username,
        gls.game_id,
        g.name AS game_name,
        g.provider_id,
        gp.name AS provider_name,
        gls.session_token,
        gls.status,
        gls.launched_at,
        gls.ended_at
    FROM game_launch_sessions gls
    INNER JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
    WHERE gls.status = 'active'
      AND u.referrer_id = p_partner_id
    ORDER BY gls.launched_at DESC;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_active_game_sessions IS 'referrer_id 기준으로 활성 게임 세션 조회';

-- ============================================================================
-- STEP 7: partner_id 컬럼 중지 (NULL 설정)
-- ============================================================================

UPDATE users SET partner_id = NULL WHERE partner_id IS NOT NULL;

COMMENT ON COLUMN users.partner_id IS '⚠️ DEPRECATED - referrer_id를 사용하세요 (153번 SQL)';
COMMENT ON COLUMN users.referrer_id IS '✅ 사용자 소속 조직 (필수) - 권한 및 데이터 조회의 기준';

-- ============================================================================
-- STEP 8: 인덱스 최적화
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_referrer_id ON users(referrer_id);

-- ============================================================================
-- 완료!
-- ============================================================================

-- 최종 확인 쿼리 (수동 실행 가능)
-- SELECT username, referrer_id, partner_id FROM users WHERE referrer_id IS NOT NULL;
