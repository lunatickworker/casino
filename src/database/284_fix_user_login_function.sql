-- 284_fix_user_login_function.sql
-- user_login 함수를 직접 SELECT로 변경 (RPC 사용 최소화)

-- 기존 user_login 함수 확인용 (실제로는 함수 대신 직접 SELECT 사용 권장)
-- 하지만 비밀번호 검증은 crypt 함수가 필요하므로 RPC 유지 필요

-- user_login 함수 재생성 (password 검증 포함)
CREATE OR REPLACE FUNCTION public.user_login(
  p_username text,
  p_password text
)
RETURNS TABLE (
  id uuid,
  username varchar,
  nickname varchar,
  status varchar,
  balance decimal,
  points decimal,
  partner_id uuid,
  referrer_id uuid,
  is_online boolean,
  last_login_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.nickname,
    u.status,
    u.balance,
    u.points,
    u.partner_id,
    u.referrer_id,
    u.is_online,
    u.last_login_at
  FROM users u
  WHERE u.username = p_username
    AND u.password_hash = crypt(p_password, u.password_hash);
END;
$$;

-- 권한 설정
GRANT EXECUTE ON FUNCTION public.user_login(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.user_login(text, text) TO authenticated;

\echo '✅ user_login 함수 업데이트 완료 (password 검증 포함)'
