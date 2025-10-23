-- 파트너의 모든 하위 파트너를 재귀적으로 조회하는 함수
CREATE OR REPLACE FUNCTION get_hierarchical_partners(p_partner_id UUID)
RETURNS TABLE (
    id UUID,
    username VARCHAR,
    nickname VARCHAR,
    partner_type VARCHAR,
    parent_id UUID,
    level INTEGER,
    status VARCHAR,
    balance DECIMAL,
    opcode VARCHAR,
    secret_key VARCHAR,
    api_token VARCHAR,
    commission_rolling DECIMAL,
    commission_losing DECIMAL,
    withdrawal_fee DECIMAL,
    bank_name VARCHAR,
    bank_account VARCHAR,
    bank_holder VARCHAR,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    parent JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE partner_tree AS (
        -- 직접 하위 파트너 (1단계)
        SELECT 
            p.id,
            p.username,
            p.nickname,
            p.partner_type,
            p.parent_id,
            p.level,
            p.status,
            p.balance,
            p.opcode,
            p.secret_key,
            p.api_token,
            p.commission_rolling,
            p.commission_losing,
            p.withdrawal_fee,
            p.bank_name,
            p.bank_account,
            p.bank_holder,
            p.last_login_at,
            p.created_at,
            p.updated_at,
            jsonb_build_object('nickname', parent_p.nickname) as parent
        FROM partners p
        LEFT JOIN partners parent_p ON p.parent_id = parent_p.id
        WHERE p.parent_id = p_partner_id
        
        UNION ALL
        
        -- 재귀적으로 하위 파트너들 (2단계 이상)
        SELECT 
            p.id,
            p.username,
            p.nickname,
            p.partner_type,
            p.parent_id,
            p.level,
            p.status,
            p.balance,
            p.opcode,
            p.secret_key,
            p.api_token,
            p.commission_rolling,
            p.commission_losing,
            p.withdrawal_fee,
            p.bank_name,
            p.bank_account,
            p.bank_holder,
            p.last_login_at,
            p.created_at,
            p.updated_at,
            jsonb_build_object('nickname', parent_p.nickname) as parent
        FROM partners p
        INNER JOIN partner_tree pt ON p.parent_id = pt.id
        LEFT JOIN partners parent_p ON p.parent_id = parent_p.id
    )
    SELECT * FROM partner_tree
    ORDER BY level ASC, created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 실행 권한 부여
GRANT EXECUTE ON FUNCTION get_hierarchical_partners(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_hierarchical_partners(UUID) TO anon;

-- 함수 설명
COMMENT ON FUNCTION get_hierarchical_partners IS '파트너의 모든 하위 파트너를 재귀적으로 조회 (1단계 자식부터 모든 하위 레벨까지)';
