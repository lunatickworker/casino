-- 354_fix_user_login_complete.sql
-- 사용자 로그인 함수 완전 수정 (모든 필요 컬럼 반환)

-- 기존 함수 DROP
DROP FUNCTION IF EXISTS public.user_login(text, text);

-- 사용자 로그인 함수 재생성 (SETOF users 사용으로 ambiguous 오류 해결)
CREATE OR REPLACE FUNCTION public.user_login(
  p_username TEXT,
  p_password TEXT
)
RETURNS SETOF users
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_record users%ROWTYPE;
  v_has_sync_count BOOLEAN;
BEGIN
  -- balance_sync_call_count 컬럼 존재 여부 확인
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'balance_sync_call_count'
  ) INTO v_has_sync_count;

  -- 1단계: 비밀번호 검증 (평문/암호화 모두 지원)
  SELECT * INTO v_user_record
  FROM users
  WHERE username = p_username
    AND (
      -- 암호화된 비밀번호 체크
      password_hash = crypt(p_password, password_hash)
      OR
      -- 평문 비밀번호 호환성 (레거시 지원)
      password_hash = p_password
    );

  -- 인증 실패
  IF v_user_record.id IS NULL THEN
    RETURN;
  END IF;

  -- 2단계: 로그인 상태 업데이트
  IF v_has_sync_count THEN
    -- 351번 스키마가 적용된 경우
    UPDATE users
    SET 
      last_login_at = NOW(),
      is_online = TRUE,
      balance_sync_call_count = 0,
      balance_sync_started_at = NOW()
    WHERE id = v_user_record.id
    RETURNING * INTO v_user_record;
  ELSE
    -- 351번 스키마가 적용되지 않은 경우
    UPDATE users
    SET 
      last_login_at = NOW(),
      is_online = TRUE
    WHERE id = v_user_record.id
    RETURNING * INTO v_user_record;
  END IF;

  -- 3단계: 업데이트된 사용자 정보 반환
  RETURN NEXT v_user_record;
  RETURN;
END;
$$;

-- 권한 설정
GRANT EXECUTE ON FUNCTION public.user_login(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.user_login(text, text) TO authenticated;

-- 인덱스 확인 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_users_username_login ON users(username) WHERE status != 'blocked';

-- 완료: ambiguous 오류 해결 (RETURNS SETOF users 사용)
