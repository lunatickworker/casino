-- ============================================================================
-- 281. check_nickname_available 함수 오버로딩 에러 수정
-- ============================================================================
-- 작성일: 2025-10-18
-- 목적: 중복된 check_nickname_available 함수 제거 및 통일
-- 에러: "Could not choose the best candidate function between: 
--        public.check_nickname_available(p_nickname => character varying), 
--        public.check_nickname_available(p_nickname => text)"
-- ============================================================================

-- ============================================
-- 1. 기존 함수 모두 삭제
-- ============================================

DROP FUNCTION IF EXISTS check_nickname_available(VARCHAR);
DROP FUNCTION IF EXISTS check_nickname_available(TEXT);
DROP FUNCTION IF EXISTS check_nickname_available(character varying);

-- ============================================
-- 2. 단일 함수로 재생성 (TEXT 타입 사용)
-- ============================================

CREATE OR REPLACE FUNCTION check_nickname_available(
    p_nickname TEXT
)
RETURNS TABLE (
    available BOOLEAN,
    message TEXT
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
    -- NULL 또는 빈 문자열 체크
    IF p_nickname IS NULL OR LENGTH(TRIM(p_nickname)) = 0 THEN
        RETURN QUERY SELECT FALSE, '닉네임을 입력해주세요.'::TEXT;
        RETURN;
    END IF;
    
    -- 닉네임 중복 체크
    IF EXISTS (SELECT 1 FROM users WHERE nickname = TRIM(p_nickname)) THEN
        RETURN QUERY SELECT FALSE, '이미 사용중인 닉네임입니다.'::TEXT;
    ELSE
        RETURN QUERY SELECT TRUE, '사용 가능한 닉네임입니다.'::TEXT;
    END IF;
END;
$$;

-- ============================================
-- 3. 함수에 주석 추가
-- ============================================

COMMENT ON FUNCTION check_nickname_available(TEXT) IS 
'사용자 닉네임 중복 체크 함수. TEXT 타입을 사용하여 오버로딩 에러 방지.';

-- ============================================
-- 4. 테스트 쿼리
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '🧪 닉네임 중복 체크 함수 테스트';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '1. NULL 체크 테스트';
    RAISE NOTICE '   SELECT * FROM check_nickname_available(NULL);';
    RAISE NOTICE '';
    RAISE NOTICE '2. 빈 문자열 체크 테스트';
    RAISE NOTICE '   SELECT * FROM check_nickname_available('''');';
    RAISE NOTICE '';
    RAISE NOTICE '3. 사용 가능한 닉네임 테스트';
    RAISE NOTICE '   SELECT * FROM check_nickname_available(''테스트닉네임123'');';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '✅ 281. check_nickname_available 함수 수정 완료!';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '📝 변경 사항:';
    RAISE NOTICE '  ✅ 중복된 함수 모두 삭제';
    RAISE NOTICE '  ✅ TEXT 타입을 사용하는 단일 함수로 통일';
    RAISE NOTICE '  ✅ 오버로딩 에러 해결';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 함수 시그니처:';
    RAISE NOTICE '  check_nickname_available(p_nickname TEXT)';
    RAISE NOTICE '';
    RAISE NOTICE '📊 반환값:';
    RAISE NOTICE '  available BOOLEAN - 사용 가능 여부';
    RAISE NOTICE '  message TEXT      - 메시지';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;
