-- ========================================
-- 30. 게임 제공사 로고 업데이트
-- ========================================
-- 설명: 슬롯 게임 제공사에 로고 이미지 추가

-- 1. game_providers 테이블에 logo_url 컬럼 확인 및 추가 (이미 있을 수 있음)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'game_providers' AND column_name = 'logo_url') THEN
        ALTER TABLE game_providers ADD COLUMN logo_url TEXT;
    END IF;
END $$;

-- 2. 슬롯 제공사 로고 URL 업데이트
-- 주요 슬롯 제공사들의 로고를 Figma Asset으로 매핑

UPDATE game_providers SET logo_url = 'figma:asset/f5025db68f1234fda1e065506d4bac72c024b97c.png' WHERE id = 300; -- 프라그마틱 플레이
UPDATE game_providers SET logo_url = 'figma:asset/3addbde22490eae5545f6b4784e2be344b2fbb18.png' WHERE id = 87;  -- PG소프트
UPDATE game_providers SET logo_url = 'figma:asset/5fdf72d618bdff26d47f49a9b8cf972b7f088705.png' WHERE id = 75;  -- 넷엔트

-- 3. 나머지 주요 제공사들을 위한 로고 URL 준비 (필요시 추가)
-- 관리자 페이지에서 업로드 기능을 통해 로고를 추가할 수 있도록 준비

COMMENT ON COLUMN game_providers.logo_url IS '게임 제공사 로고 이미지 URL (figma:asset 또는 외부 URL)';
