-- 시스템 관리자 중복 확인 및 정리

-- 1. 현재 시스템 관리자 확인
DO $$
DECLARE
    admin_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO admin_count
    FROM partners
    WHERE level = 1;
    
    RAISE NOTICE '시스템 관리자(level=1) 개수: %', admin_count;
    
    IF admin_count > 1 THEN
        RAISE NOTICE '⚠️ 시스템 관리자가 여러 명 존재합니다. 정리가 필요합니다.';
    ELSIF admin_count = 0 THEN
        RAISE NOTICE '⚠️ 시스템 관리자가 존재하지 않습니다.';
    ELSE
        RAISE NOTICE '✅ 시스템 관리자가 정상입니다.';
    END IF;
END $$;

-- 2. 시스템 관리자 목록 확인
SELECT 
    id,
    username,
    name,
    level,
    status,
    opcode,
    created_at,
    updated_at
FROM partners
WHERE level = 1
ORDER BY created_at ASC;

-- 3. 중복된 시스템 관리자가 있는 경우 정리 (선택적 실행)
-- ⚠️ 주의: 아래 주석을 해제하고 실행하면 가장 최근에 생성된 시스템 관리자를 제외하고 모두 삭제됩니다.
-- ⚠️ 실행 전 반드시 백업하고 확인하세요!

/*
DO $$
DECLARE
    keep_admin_id UUID;
    deleted_count INTEGER;
BEGIN
    -- 가장 먼저 생성된 시스템 관리자의 ID 가져오기
    SELECT id INTO keep_admin_id
    FROM partners
    WHERE level = 1
    ORDER BY created_at ASC
    LIMIT 1;
    
    -- 해당 관리자를 제외한 나머지 시스템 관리자 삭제
    WITH deleted AS (
        DELETE FROM partners
        WHERE level = 1 AND id != keep_admin_id
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;
    
    RAISE NOTICE '✅ % 개의 중복 시스템 관리자를 삭제했습니다.', deleted_count;
    RAISE NOTICE '✅ 유지된 시스템 관리자 ID: %', keep_admin_id;
END $$;
*/

-- 4. 최종 확인
SELECT 
    id,
    username,
    name,
    level,
    status,
    opcode,
    secret_key IS NOT NULL as has_secret_key,
    api_token IS NOT NULL as has_api_token,
    created_at
FROM partners
WHERE level = 1;
