-- ===================================================================
-- 긴급 수정: 메뉴 권한 시스템 완전 복구
-- 214_URGENT_FIX_MENU_PERMISSIONS.sql
-- 
-- 실행 방법: Supabase SQL Editor에서 전체 복사 후 실행
-- ===================================================================

-- 1. partner_menu_permissions 테이블 생성 (없으면)
CREATE TABLE IF NOT EXISTS partner_menu_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    menu_permission_id UUID NOT NULL REFERENCES menu_permissions(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(partner_id, menu_permission_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_partner_menu_permissions_partner ON partner_menu_permissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_menu_permissions_menu ON partner_menu_permissions(menu_permission_id);

-- 2. 파트너 생성 시 기본 메뉴 할당 함수
CREATE OR REPLACE FUNCTION assign_default_menus_to_partner()
RETURNS TRIGGER AS $$
DECLARE
    menu_record RECORD;
    partner_level_num INTEGER;
BEGIN
    partner_level_num := NEW.level;
    
    -- 해당 파트너 레벨에 접근 가능한 모든 메뉴 할당
    FOR menu_record IN 
        SELECT id 
        FROM menu_permissions 
        WHERE partner_level <= partner_level_num 
          AND is_visible = TRUE
    LOOP
        INSERT INTO partner_menu_permissions (partner_id, menu_permission_id, is_enabled)
        VALUES (NEW.id, menu_record.id, TRUE)
        ON CONFLICT (partner_id, menu_permission_id) DO NOTHING;
    END LOOP;
    
    RAISE NOTICE '✅ 파트너 % (level: %)에게 기본 메뉴가 할당되었습니다.', NEW.nickname, partner_level_num;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 트리거 생성
DROP TRIGGER IF EXISTS trigger_assign_default_menus ON partners;
CREATE TRIGGER trigger_assign_default_menus
    AFTER INSERT ON partners
    FOR EACH ROW
    EXECUTE FUNCTION assign_default_menus_to_partner();

-- 4. get_partner_enabled_menus 함수 생성
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

-- 5. RLS 정책 설정
ALTER TABLE partner_menu_permissions ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "파트너는 자신의 메뉴 권한 조회 가능" ON partner_menu_permissions;
DROP POLICY IF EXISTS "시스템관리자는 모든 메뉴 권한 관리 가능" ON partner_menu_permissions;

-- 파트너는 자신의 메뉴 권한만 조회 가능
CREATE POLICY "파트너는 자신의 메뉴 권한 조회 가능" 
    ON partner_menu_permissions FOR SELECT
    USING (
        partner_id = auth.uid()
        OR partner_id IN (
            SELECT id FROM partners WHERE id = auth.uid()
        )
    );

-- 시스템관리자는 모든 메뉴 권한 관리 가능
CREATE POLICY "시스템관리자는 모든 메뉴 권한 관리 가능" 
    ON partner_menu_permissions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM partners 
            WHERE id = auth.uid() AND level = 1
        )
    );

-- 6. 권한 부여
GRANT SELECT ON partner_menu_permissions TO authenticated;
GRANT SELECT ON menu_permissions TO authenticated;
GRANT EXECUTE ON FUNCTION get_partner_enabled_menus(UUID) TO authenticated;

-- 7. 기존 파트너들에게 기본 메뉴 할당 (중요!)
DO $$
DECLARE
    partner_record RECORD;
    menu_record RECORD;
    total_assigned INTEGER := 0;
BEGIN
    RAISE NOTICE '======================================';
    RAISE NOTICE '기존 파트너들에게 메뉴 할당 시작...';
    RAISE NOTICE '======================================';
    
    FOR partner_record IN SELECT id, level, nickname FROM partners ORDER BY level
    LOOP
        FOR menu_record IN 
            SELECT id 
            FROM menu_permissions 
            WHERE partner_level <= partner_record.level 
              AND is_visible = TRUE
        LOOP
            INSERT INTO partner_menu_permissions (partner_id, menu_permission_id, is_enabled)
            VALUES (partner_record.id, menu_record.id, TRUE)
            ON CONFLICT (partner_id, menu_permission_id) DO NOTHING;
            
            total_assigned := total_assigned + 1;
        END LOOP;
        
        RAISE NOTICE '✅ 파트너: % (level: %) - 메뉴 할당 완료', partner_record.nickname, partner_record.level;
    END LOOP;
    
    RAISE NOTICE '======================================';
    RAISE NOTICE '총 %개 메뉴 권한이 할당되었습니다.', total_assigned;
    RAISE NOTICE '======================================';
END $$;

-- 8. 최종 확인
DO $$
DECLARE
    total_partners INTEGER;
    total_menus INTEGER;
    total_assignments INTEGER;
    partner_record RECORD;
BEGIN
    SELECT COUNT(*) INTO total_partners FROM partners;
    SELECT COUNT(*) INTO total_menus FROM menu_permissions WHERE is_visible = TRUE;
    SELECT COUNT(*) INTO total_assignments FROM partner_menu_permissions;
    
    RAISE NOTICE '';
    RAISE NOTICE '====================================== ';
    RAISE NOTICE '✅ 메뉴 권한 시스템 복구 완료';
    RAISE NOTICE '======================================';
    RAISE NOTICE '총 파트너 수: %', total_partners;
    RAISE NOTICE '총 활성 메뉴 수: %', total_menus;
    RAISE NOTICE '총 메뉴 할당 수: %', total_assignments;
    RAISE NOTICE '======================================';
    RAISE NOTICE '';
    RAISE NOTICE '파트너별 메뉴 할당 현황:';
    RAISE NOTICE '======================================';
    
    FOR partner_record IN 
        SELECT 
            p.nickname,
            p.level,
            COUNT(pmp.id) as menu_count
        FROM partners p
        LEFT JOIN partner_menu_permissions pmp ON pmp.partner_id = p.id
        GROUP BY p.id, p.nickname, p.level
        ORDER BY p.level
    LOOP
        RAISE NOTICE '파트너: % (Level %): % 개 메뉴', 
            partner_record.nickname, 
            partner_record.level, 
            partner_record.menu_count;
    END LOOP;
    
    RAISE NOTICE '======================================';
    RAISE NOTICE '';
    
    -- 메뉴가 없는 파트너 체크
    IF EXISTS (
        SELECT 1 FROM partners p
        LEFT JOIN partner_menu_permissions pmp ON pmp.partner_id = p.id
        WHERE pmp.id IS NULL
    ) THEN
        RAISE WARNING '⚠️  경고: 메뉴가 할당되지 않은 파트너가 있습니다!';
        RAISE NOTICE '';
        FOR partner_record IN 
            SELECT p.nickname, p.level
            FROM partners p
            LEFT JOIN partner_menu_permissions pmp ON pmp.partner_id = p.id
            WHERE pmp.id IS NULL
        LOOP
            RAISE WARNING '  - % (Level %)', partner_record.nickname, partner_record.level;
        END LOOP;
    ELSE
        RAISE NOTICE '✅ 모든 파트너에게 메뉴가 정상적으로 할당되었습니다.';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '====================================== ';
END $$;
