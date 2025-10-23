-- =====================================================
-- 288: 카지노 게임 썸네일 이미지 전체 업데이트
-- =====================================================
-- 작성일: 2025-10-19
-- 목적: 사용자 페이지에서 카지노 로비 게임들의 썸네일 이미지를 Supabase Storage URL로 업데이트
-- 참고: image_route.md에 정의된 11개 이미지 경로 모두 사용
-- =====================================================

-- 1. 에볼루션 게이밍 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/evolution.png',
  is_featured = true,
  priority = 1000,
  updated_at = now()
WHERE id = 410000
  AND provider_id = 410
  AND type = 'casino';

-- 2. Vivo 게이밍 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/vivo.png',
  is_featured = true,
  priority = 900,
  updated_at = now()
WHERE id = 2029
  AND provider_id = 2
  AND type = 'casino';

-- 3. 섹시게이밍 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/sexy_casino.png',
  is_featured = true,
  priority = 800,
  updated_at = now()
WHERE id = 86001
  AND provider_id = 86
  AND type = 'casino';

-- 4. 이주기 (Ezugi) 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/ezugi.png',
  is_featured = true,
  priority = 700,
  updated_at = now()
WHERE id = 44006
  AND provider_id = 44
  AND type = 'casino';

-- 5. 아시아 게이밍 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/asiagaming.png',
  is_featured = true,
  priority = 600,
  updated_at = now()
WHERE id = 30000
  AND provider_id = 30
  AND type = 'casino';

-- 6. 드림게임 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/dreamgaming.png',
  is_featured = true,
  priority = 500,
  updated_at = now()
WHERE id = 28000
  AND provider_id = 28
  AND type = 'casino';

-- 7. 플레이텍 라이브 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/playtech.png',
  is_featured = true,
  priority = 400,
  updated_at = now()
WHERE id = 85036
  AND provider_id = 85
  AND type = 'casino';

-- 8. 비비아이엔 (BBIN) 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/bbin.png',
  is_featured = true,
  priority = 300,
  updated_at = now()
WHERE id = 11000
  AND provider_id = 11
  AND type = 'casino';

-- 9. 마이크로 게이밍 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/microgaming.png',
  is_featured = true,
  priority = 200,
  updated_at = now()
WHERE id = 77060
  AND provider_id = 77
  AND type = 'casino';

-- 10. 보타 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/bota.png',
  is_featured = true,
  priority = 100,
  updated_at = now()
WHERE id = 91000
  AND provider_id = 91
  AND type = 'casino';

-- 11. 오리엔탈게임 (Orient) 로비 이미지 업데이트
UPDATE games
SET 
  image_url = 'https://nzuzzmaiuybzyndptaba.supabase.co/storage/v1/object/public/thumnail/orient.png',
  is_featured = true,
  priority = 50,
  updated_at = now()
WHERE id = 89000
  AND provider_id = 89
  AND type = 'casino';

-- 업데이트 확인 - 모든 11개 카지노 로비 게임
SELECT 
  id,
  name,
  provider_id,
  type,
  image_url,
  is_featured,
  priority,
  status
FROM games
WHERE id IN (410000, 2029, 86001, 44006, 30000, 28000, 85036, 11000, 77060, 91000, 89000)
ORDER BY priority DESC;

-- 성공 메시지
DO $$
BEGIN
  RAISE NOTICE '✅ 카지노 게임 썸네일 이미지 11개가 성공적으로 업데이트되었습니다.';
  RAISE NOTICE '   ';
  RAISE NOTICE '   1. 에볼루션 게이밍 (Game ID: 410000, Provider: 410) - Priority: 1000';
  RAISE NOTICE '      Image: evolution.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   2. Vivo 게이밍 (Game ID: 2029, Provider: 2) - Priority: 900';
  RAISE NOTICE '      Image: vivo.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   3. 섹시게이밍 (Game ID: 86001, Provider: 86) - Priority: 800';
  RAISE NOTICE '      Image: sexy_casino.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   4. 이주기/Ezugi (Game ID: 44006, Provider: 44) - Priority: 700';
  RAISE NOTICE '      Image: ezugi.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   5. 아시아 게이밍 (Game ID: 30000, Provider: 30) - Priority: 600';
  RAISE NOTICE '      Image: asiagaming.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   6. 드림게임 (Game ID: 28000, Provider: 28) - Priority: 500';
  RAISE NOTICE '      Image: dreamgaming.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   7. 플레이텍 라이브 (Game ID: 85036, Provider: 85) - Priority: 400';
  RAISE NOTICE '      Image: playtech.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   8. 비비아이엔/BBIN (Game ID: 11000, Provider: 11) - Priority: 300';
  RAISE NOTICE '      Image: bbin.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   9. 마이크로 게이밍 (Game ID: 77060, Provider: 77) - Priority: 200';
  RAISE NOTICE '      Image: microgaming.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   10. 보타 (Game ID: 91000, Provider: 91) - Priority: 100';
  RAISE NOTICE '      Image: bota.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   11. 오리엔탈게임 (Game ID: 89000, Provider: 89) - Priority: 50';
  RAISE NOTICE '      Image: orient.png';
  RAISE NOTICE '   ';
  RAISE NOTICE '   📌 참고: image_route.md에서 정의된 11개 이미지 경로 모두 사용';
  RAISE NOTICE '   📌 모든 카지노 게임이 Featured로 설정되었으며 Priority 순서대로 표시됩니다';
END $$;
