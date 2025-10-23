-- =====================================================
-- 사용자 비밀번호 해시 수정 및 로그인 함수 개선
-- =====================================================

-- smcdev11 사용자의 비밀번호를 올바른 해시로 업데이트
UPDATE users 
SET password_hash = crypt('a12345678', gen_salt('bf'))
WHERE username = 'smcdev11';

-- 기존 user_login 함수 DROP
DROP FUNCTION IF EXISTS user_login(text, text);

-- 향상된 사용자 로그인 함수 (평문/해시 모두 지원)
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
    -- 사용자 인증 및 정보 반환 (해시된 비밀번호와 비교)
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
        -- 해시된 비밀번호와 비교 (bcrypt)
        u.password_hash = crypt(p_password, u.password_hash)
        OR
        -- 임시로 평문 비교도 지원 (개발 환경용)
        u.password_hash = p_password
    );
    
    -- 로그인 성공 시 최종 로그인 시간 업데이트
    IF FOUND THEN
        UPDATE users u2
        SET 
            last_login_at = NOW(),
            is_online = TRUE,
            updated_at = NOW()
        WHERE u2.username = p_username;
    END IF;
    
    RETURN;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;