-- =====================================================
-- user_login 함수 업데이트: 로그인 시 balance_sync_call_count 초기화
-- =====================================================

-- 기존 함수 DROP
DROP FUNCTION IF EXISTS user_login(text, text);

-- 사용자 로그인 함수 재생성 (평문 비밀번호 지원)
CREATE OR REPLACE FUNCTION user_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS TABLE (
    id UUID,
    username VARCHAR(50),
    nickname VARCHAR(50),
    status VARCHAR(20),
    balance DECIMAL(15,2),
    points DECIMAL(15,2),
    vip_level INTEGER,
    referrer_id UUID,
    is_online BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $function$
BEGIN
    -- 사용자 인증 및 정보 반환 (평문 비밀번호 또는 해시 비밀번호 모두 지원)
    RETURN QUERY
    SELECT 
        u.id,
        u.username,
        u.nickname,
        u.status,
        u.balance,
        u.points,
        u.vip_level,
        u.referrer_id,
        u.is_online,
        u.created_at,
        u.updated_at
    FROM users u
    WHERE u.username = p_username 
    AND (
        u.password_hash = p_password  -- 평문 비밀번호 (기존 방식)
        OR u.password_hash = crypt(p_password, u.password_hash)  -- 암호화된 비밀번호
    );
    
    -- ✅ 로그인 성공 시: 온라인 상태 변경 + 호출 카운터 초기화 + 시작 시간 기록
    IF FOUND THEN
        UPDATE users 
        SET 
            last_login_at = NOW(),
            is_online = TRUE,
            balance_sync_call_count = 0,
            balance_sync_started_at = NOW(),
            updated_at = NOW()
        WHERE username = p_username;
        
        RAISE NOTICE '✅ 사용자 로그인 성공: username=%, 호출 카운터 초기화', p_username;
    END IF;
    
    RETURN;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION user_login IS '사용자 로그인 - 성공 시 is_online=true, balance_sync_call_count=0 초기화';
