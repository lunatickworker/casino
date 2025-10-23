-- ===================================================================
-- 파트너 메뉴 권한 시스템 생성
-- 213_create-partner-menu-permissions.sql
-- ===================================================================

-- 1. partner_menu_permissions 테이블 생성
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

-- 4. 기존 파트너들에게 기본 메뉴 할당 (한 번만 실행)
DO $$
DECLARE
    partner_record RECORD;
    menu_record RECORD;
BEGIN
    FOR partner_record IN SELECT id, level, nickname FROM partners
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
        END LOOP;
        
        RAISE NOTICE '✅ 기존 파트너 % (level: %)에게 메뉴 할당 완료', partner_record.nickname, partner_record.level;
    END LOOP;
END $$;

-- 5. RLS 정책 설정
ALTER TABLE partner_menu_permissions ENABLE ROW LEVEL SECURITY;

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

-- 확인
DO $$
DECLARE
    total_partners INTEGER;
    total_assignments INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_partners FROM partners;
    SELECT COUNT(*) INTO total_assignments FROM partner_menu_permissions;
    
    RAISE NOTICE '======================================';
    RAISE NOTICE '✅ 파트너 메뉴 권한 시스템 생성 완료';
    RAISE NOTICE '총 파트너 수: %', total_partners;
    RAISE NOTICE '총 메뉴 할당 수: %', total_assignments;
    RAISE NOTICE '======================================';
END $$;
