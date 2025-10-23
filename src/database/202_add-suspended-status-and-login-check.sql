-- 202: suspended 상태 추가 및 로그인 체크 강화
-- 차단(suspended)과 블랙리스트(blocked)를 구분하여 관리

-- ============================================
-- 0. users 테이블 status 체크 제약 조건 업데이트
-- ============================================

-- 기존 체크 제약 조건 삭제
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;

-- 새로운 체크 제약 조건 추가 (suspended 포함)
ALTER TABLE users ADD CONSTRAINT users_status_check 
  CHECK (status IN ('pending', 'active', 'suspended', 'blocked'));

COMMENT ON CONSTRAINT users_status_check ON users IS 
  'pending: 가입승인대기, active: 정상활성, suspended: 차단(회원관리 표시), blocked: 블랙리스트(숨김)';

-- ============================================
-- 1. 사용자 로그인 함수 업데이트 (suspended 체크)
-- ============================================

CREATE OR REPLACE FUNCTION public.user_login_v2(
  p_username text,
  p_password text
)
RETURNS TABLE (
  success boolean,
  message text,
  user_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_password_hash text;
  v_password_matches boolean;
BEGIN
  -- 사용자 조회
  SELECT *
  INTO v_user_record
  FROM users
  WHERE username = p_username;

  -- 사용자 존재 여부 확인
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '아이디 또는 비밀번호가 일치하지 않습니다.'::text, NULL::jsonb;
    RETURN;
  END IF;

  -- 차단된 사용자 확인 (suspended)
  IF v_user_record.status = 'suspended' THEN
    RETURN QUERY SELECT false, '차단된 계정입니다. 관리자에게 문의하세요.'::text, NULL::jsonb;
    RETURN;
  END IF;

  -- 블랙리스트 사용자 확인 (blocked)
  IF v_user_record.status = 'blocked' THEN
    RETURN QUERY SELECT false, '이용이 제한된 계정입니다. 관리자에게 문의하세요.'::text, NULL::jsonb;
    RETURN;
  END IF;

  -- 승인 대기 중인 사용자 확인
  IF v_user_record.status = 'pending' THEN
    RETURN QUERY SELECT false, '가입 승인 대기 중입니다. 관리자의 승인을 기다려주세요.'::text, NULL::jsonb;
    RETURN;
  END IF;

  -- 비밀번호 검증
  v_password_hash := crypt(p_password, v_user_record.password);
  v_password_matches := (v_password_hash = v_user_record.password);

  IF NOT v_password_matches THEN
    RETURN QUERY SELECT false, '아이디 또는 비밀번호가 일치하지 않습니다.'::text, NULL::jsonb;
    RETURN;
  END IF;

  -- 마지막 로그인 시간 업데이트
  UPDATE users
  SET 
    last_login_at = now(),
    is_online = true,
    updated_at = now()
  WHERE id = v_user_record.id;

  -- 로그인 성공
  RETURN QUERY SELECT 
    true,
    '로그인 성공'::text,
    jsonb_build_object(
      'id', v_user_record.id,
      'username', v_user_record.username,
      'nickname', v_user_record.nickname,
      'email', v_user_record.email,
      'phone', v_user_record.phone,
      'balance', COALESCE(v_user_record.balance, 0),
      'points', COALESCE(v_user_record.points, 0),
      'vip_level', COALESCE(v_user_record.vip_level, 0),
      'status', v_user_record.status,
      'referrer_id', v_user_record.referrer_id,
      'created_at', v_user_record.created_at
    );

END;
$$;

-- ============================================
-- 2. 게임 실행 시 차단 확인 함수
-- ============================================

CREATE OR REPLACE FUNCTION public.check_user_game_access(
  p_user_id uuid
)
RETURNS TABLE (
  can_play boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_status text;
BEGIN
  -- 사용자 상태 조회
  SELECT status INTO v_user_status
  FROM users
  WHERE id = p_user_id;

  -- 사용자가 없는 경우
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '사용자를 찾을 수 없습니다.'::text;
    RETURN;
  END IF;

  -- 차단된 사용자 (suspended)
  IF v_user_status = 'suspended' THEN
    RETURN QUERY SELECT false, '차단된 계정입니다. 게임을 이용할 수 없습니다.'::text;
    RETURN;
  END IF;

  -- 블랙리스트 사용자 (blocked)
  IF v_user_status = 'blocked' THEN
    RETURN QUERY SELECT false, '이용이 제한된 계정입니다.'::text;
    RETURN;
  END IF;

  -- 승인 대기 중
  IF v_user_status = 'pending' THEN
    RETURN QUERY SELECT false, '가입 승인 대기 중입니다.'::text;
    RETURN;
  END IF;

  -- 게임 접근 가능
  RETURN QUERY SELECT true, '게임 접근 가능'::text;

END;
$$;

-- ============================================
-- 3. 주석 추가
-- ============================================

COMMENT ON FUNCTION public.user_login_v2 IS '사용자 로그인 - suspended/blocked 상태 체크 포함';
COMMENT ON FUNCTION public.check_user_game_access IS '게임 접근 권한 확인 - 차단/블랙리스트 체크';

-- ============================================
-- 4. 상태 정의 문서화
-- ============================================

/*
사용자 상태(status) 정의:
- pending: 가입 승인 대기 (로그인 불가, 게임 불가)
- active: 정상 활성 상태 (로그인 가능, 게임 가능)
- suspended: 차단됨 (로그인 불가, 게임 불가, 회원관리 리스트에 표시)
- blocked: 블랙리스트 (로그인 불가, 게임 불가, 회원관리 리스트에서 숨김, BlacklistManagement에서만 관리)

차이점:
- suspended: 일시적 차단, 해제 가능, 관리자가 회원관리에서 직접 관리
- blocked: 영구 차단, 블랙리스트 전용 페이지에서 관리, 회원관리 리스트에서 제외
*/
