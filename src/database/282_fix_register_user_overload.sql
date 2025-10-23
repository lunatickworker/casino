-- 282_fix_register_user_overload.sql
-- register_user 함수 오버로딩 에러 해결

-- 기존 모든 register_user 함수 삭제
DROP FUNCTION IF EXISTS public.register_user(text, text, text, text, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.register_user(character varying, character varying, character varying, character varying, character varying, character varying, character varying, character varying, character varying) CASCADE;
DROP FUNCTION IF EXISTS public.register_user CASCADE;

-- 단일 통합 함수 생성 (text 타입)
CREATE OR REPLACE FUNCTION public.register_user(
  p_username text,
  p_nickname text,
  p_password text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_bank_account text DEFAULT NULL,
  p_bank_holder text DEFAULT NULL,
  p_referrer_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id uuid;
  v_new_user_id uuid;
  v_user_role text;
  v_partner_id uuid;
  v_result jsonb;
BEGIN
  -- 아이디 중복 체크
  IF EXISTS (SELECT 1 FROM users WHERE username = p_username) THEN
    RETURN jsonb_build_object('success', false, 'error', '이미 사용 중인 아이디입니다');
  END IF;

  -- 닉네임 중복 체크
  IF EXISTS (SELECT 1 FROM users WHERE nickname = p_nickname) THEN
    RETURN jsonb_build_object('success', false, 'error', '이미 사용 중인 닉네임입니다');
  END IF;

  -- 추천인 확인
  IF p_referrer_username IS NOT NULL THEN
    SELECT id, role, partner_id INTO v_referrer_id, v_user_role, v_partner_id
    FROM users 
    WHERE username = p_referrer_username;
    
    IF v_referrer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', '존재하지 않는 추천인입니다');
    END IF;
    
    -- 추천인이 파트너인 경우
    IF v_user_role IN ('system_admin', 'super_master', 'master', 'sub_master', 'distributor', 'store') THEN
      v_partner_id := v_referrer_id;
    END IF;
  END IF;

  -- 사용자 생성
  INSERT INTO users (
    username,
    nickname,
    password,
    email,
    phone,
    bank_name,
    bank_account,
    bank_holder,
    referrer_id,
    partner_id,
    role,
    status,
    balance,
    point
  ) VALUES (
    p_username,
    p_nickname,
    crypt(p_password, gen_salt('bf')),
    p_email,
    p_phone,
    p_bank_name,
    p_bank_account,
    p_bank_holder,
    v_referrer_id,
    v_partner_id,
    'user',
    'pending',
    0,
    0
  )
  RETURNING id INTO v_new_user_id;

  -- 결과 반환
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_new_user_id,
    'username', p_username,
    'nickname', p_nickname,
    'message', '회원가입이 완료되었습니다. 승인 대기 중입니다.'
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION public.register_user(text, text, text, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.register_user(text, text, text, text, text, text, text, text, text) TO authenticated;
