-- 메뉴명 변경: "파트너 계층 관리" -> "파트너 관리" 
-- (기존 "파트너 관리"는 그룹명이므로 충돌 방지)

-- 1. 기존 "파트너 계층 관리" 메뉴 이름 변경
UPDATE menu_permissions
SET 
    menu_name = '파트너 관리',
    menu_path = '/admin/partners',
    display_order = 301
WHERE menu_name = '파트너 계층 관리' 
  AND parent_menu = '파트너 관리';

-- 2. 기존 parent_menu가 null인 "파트너 관리" (그룹명)은 유지
-- 이미 존재하므로 변경 없음

-- 3. 중복 방지를 위해 기존 /admin/partners 메뉴가 있다면 삭제
DELETE FROM menu_permissions
WHERE menu_path = '/admin/partners' 
  AND parent_menu IS NULL;

-- 4. 변경 결과 확인
SELECT 
    menu_name,
    menu_path,
    parent_menu,
    display_order,
    partner_level
FROM menu_permissions
WHERE menu_path = '/admin/partners' 
   OR parent_menu = '파트너 관리'
ORDER BY display_order;
