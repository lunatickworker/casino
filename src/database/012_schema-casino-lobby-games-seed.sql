-- 카지노 로비 진입용 게임 데이터 추가 (Guidelines.md 4.2 기준)
-- 카지노는 게임 목록이 없고 로비로 직접 진입하므로 provider별 대표 게임 ID 사용

-- 카지노 로비 게임 추가 (13개)
INSERT INTO games (id, provider_id, name, type, status, demo_available, created_at, updated_at) VALUES
(410000, 410, '에볼루션 게이밍 로비', 'casino', 'visible', false, NOW(), NOW()),
(77060, 77, '마이크로 게이밍 로비', 'casino', 'visible', false, NOW(), NOW()),
(2029, 2, 'Vivo 게이밍 로비', 'casino', 'visible', false, NOW(), NOW()),
(30000, 30, '아시아 게이밍 로비', 'casino', 'visible', false, NOW(), NOW()),
(78001, 78, '프라그마틱플레이 로비', 'casino', 'visible', false, NOW(), NOW()),
(86001, 86, '섹시게이밍 로비', 'casino', 'visible', false, NOW(), NOW()),
(11000, 11, '비비아이엔 로비', 'casino', 'visible', false, NOW(), NOW()),
(28000, 28, '드림게임 로비', 'casino', 'visible', false, NOW(), NOW()),
(89000, 89, '오리엔탈게임 로비', 'casino', 'visible', false, NOW(), NOW()),
(91000, 91, '보타 로비', 'casino', 'visible', false, NOW(), NOW()),
(44006, 44, '이주기 로비', 'casino', 'visible', false, NOW(), NOW()),
(85036, 85, '플레이텍 라이브 로비', 'casino', 'visible', false, NOW(), NOW()),
(0, 0, '제네럴 카지노 로비', 'casino', 'visible', false, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    updated_at = NOW();

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '카지노 로비 게임 데이터가 추가되었습니다.';
    RAISE NOTICE '- 카지노 로비 게임: 13개';
    RAISE NOTICE '- 각 카지노 제공사별 로비 진입용 게임 ID 생성 완료';
END $$;