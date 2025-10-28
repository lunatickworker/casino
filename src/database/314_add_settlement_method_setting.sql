-- =====================================================
-- 정산 방식 설정 추가
-- =====================================================
-- 작성일: 2025-10-28
-- 설명: 차등정산 vs 직속하위정산 방식을 선택할 수 있는 설정 추가

-- 정산 방식 설정 추가
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, partner_level)
VALUES 
  ('settlement_method', 'direct_subordinate', 'string', '정산 방식 (differential: 차등정산, direct_subordinate: 직속하위정산)', 1)
ON CONFLICT (setting_key) DO NOTHING;

-- 설명:
-- 1. differential (차등정산): 상위가 하위의 수수료를 제외한 차액만 받음
--    예: 매장 0.1% → 총판 0.2% → 부본사 0.3%
--    각각 차액만 받음: 매장 0.1%, 총판 0.1%, 부본사 0.1%
--
-- 2. direct_subordinate (직속하위정산): 각 파트너가 전체 하위로부터 수입을 받고 직속 하위에게 지급
--    예: 본사가 모든 하위 사용자로부터 수입 받고, 직속 부본사들에게만 지급
--    순수익 = 총수입 - 직속하위지급
