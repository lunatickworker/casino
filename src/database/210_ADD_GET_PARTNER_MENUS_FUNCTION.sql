-- ===================================================================
-- 파트너 활성화 메뉴 조회 함수 추가
-- 210_ADD_GET_PARTNER_MENUS_FUNCTION.sql
-- ===================================================================

-- get_partner_enabled_menus 함수 생성
CREATE OR REPLACE FUNCTION get_partner_enabled_menus(p_partner_id UUID)
RETURNS TABLE (
    menu_id UUID,
    menu_name VARCHAR,
    menu_path VARCHAR,
    parent_menu VARCHAR,
    display_order INTEGER,
    description TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mp.id as menu_id,
        mp.menu_name,
        mp.menu_path,
        mp.parent_menu,
        mp.display_order,
        mp.description
    FROM menu_permissions mp
    INNER JOIN partner_menu_permissions pmp ON pmp.menu_permission_id = mp.id
    WHERE pmp.partner_id = p_partner_id
        AND pmp.is_enabled = TRUE
        AND mp.is_visible = TRUE
    ORDER BY mp.display_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_partner_enabled_menus(UUID) TO authenticated;

-- 확인
DO $$
BEGIN
    RAISE NOTICE '✅ get_partner_enabled_menus 함수가 생성되었습니다.';
END $$;
