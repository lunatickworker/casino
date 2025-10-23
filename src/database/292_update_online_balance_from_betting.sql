-- =====================================================
-- 온라인 현황 보유금 표시를 베팅 기록의 최신 balance_after로 변경
-- =====================================================

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
    launched_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_type TEXT;
    v_allowed_partner_ids UUID[];
    v_expired_count INTEGER;
BEGIN
    -- 비정상 세션 자동 만료 (함수가 없으면 건너뜀)
    BEGIN
        SELECT expire_old_game_sessions() INTO v_expired_count;
    EXCEPTION WHEN undefined_function THEN
        NULL; -- 함수 없으면 무시
    END;
    
    -- 관리자 권한 확인
    IF p_admin_partner_id IS NOT NULL THEN
        SELECT partner_type INTO v_admin_type
        FROM partners
        WHERE id = p_admin_partner_id;
        
        IF v_admin_type = '시스템관리자' THEN
            v_allowed_partner_ids := NULL;
        ELSIF v_admin_type = '대본사' THEN
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
        ELSE
            SELECT ARRAY_AGG(id) INTO v_allowed_partner_ids
            FROM partners
            WHERE id = p_admin_partner_id
               OR parent_id = p_admin_partner_id;
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
        -- ✅ 베팅 기록의 최신 balance_after를 사용 (없으면 users.balance)
        COALESCE(
            (
                SELECT gr.balance_after
                FROM game_records gr
                WHERE gr.user_id = gls.user_id
                ORDER BY gr.played_at DESC, gr.id DESC
                LIMIT 1
            ),
            u.balance
        ) as current_balance,
        EXTRACT(EPOCH FROM (NOW() - gls.launched_at))::INTEGER / 60 as session_duration_minutes,
        gls.launched_at
    FROM game_launch_sessions gls
    JOIN users u ON gls.user_id = u.id
    LEFT JOIN games g ON gls.game_id = g.id
    LEFT JOIN game_providers gp ON g.provider_id = gp.id
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

-- 권한 설정
GRANT EXECUTE ON FUNCTION get_active_game_sessions(UUID, UUID) TO anon, authenticated;

-- ✅ 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ 온라인 현황 보유금 표시: 베팅 기록의 최신 balance_after로 변경 완료';
END $$;