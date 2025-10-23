-- =====================================================
-- 사용자 로그인 함수 수정 (기존 함수 DROP 후 재생성)
-- =====================================================

-- 기존 함수 DROP (리턴 타입 변경을 위해)
DROP FUNCTION IF EXISTS user_login(text, text);

-- 사용자 로그인 함수 재생성
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
    -- 사용자 인증 및 정보 반환
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
    AND u.password_hash = crypt(p_password, u.password_hash);
    
    -- 로그인 성공 시 최종 로그인 시간 업데이트
    IF FOUND THEN
        UPDATE users 
        SET 
            last_login_at = NOW(),
            is_online = TRUE
        WHERE username = p_username;
    END IF;
    
    RETURN;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;