-- =====================================================
-- 파트너 로그인 함수 (bcrypt 비밀번호 검증)
-- =====================================================

-- 1. 기존 함수 삭제
DROP FUNCTION IF EXISTS partner_login(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS admin_login(TEXT, TEXT) CASCADE;

-- 2. 파트너 로그인 함수 생성 (타입을 실제 테이블과 일치시킴)
CREATE OR REPLACE FUNCTION partner_login(
  p_username TEXT,
  p_password TEXT
)
RETURNS TABLE (
  id UUID,
  username VARCHAR(50),
  nickname VARCHAR(50),
  level INTEGER,
  partner_type VARCHAR(20),
  status VARCHAR(20),
  balance DECIMAL(15,2),
  opcode VARCHAR(100),
  secret_key VARCHAR(255),
  api_token VARCHAR(255),
  parent_id UUID,
  commission_rolling DECIMAL(5,2),
  commission_losing DECIMAL(5,2),
  withdrawal_fee DECIMAL(5,2),
  bank_name VARCHAR(50),
  bank_account VARCHAR(50),
  bank_holder VARCHAR(50),
  contact_info JSONB,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $
BEGIN
  -- 로그인 시간 업데이트
  UPDATE partners 
  SET last_login_at = NOW() 
  WHERE partners.username = p_username AND partners.status = 'active';
  
  -- bcrypt 비밀번호 검증 후 반환
  RETURN QUERY
  SELECT 
    p.id,
    p.username,
    p.nickname,
    p.level,
    p.partner_type,
    p.status,
    p.balance,
    p.opcode,
    p.secret_key,
    p.api_token,
    p.parent_id,
    p.commission_rolling,
    p.commission_losing,
    p.withdrawal_fee,
    p.bank_name,
    p.bank_account,
    p.bank_holder,
    p.contact_info,
    p.last_login_at,
    p.created_at,
    p.updated_at
  FROM partners p
  WHERE 
    p.username = p_username 
    AND p.password_hash = crypt(p_password, p.password_hash)
    AND p.status = 'active'
  LIMIT 1;
END;
$;

-- 3. 권한 부여
GRANT EXECUTE ON FUNCTION partner_login(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION partner_login(TEXT, TEXT) TO anon;

-- 4. 완료 메시지
DO $$
BEGIN
  RAISE NOTICE '✅ partner_login 함수 생성 완료';
  RAISE NOTICE '   - bcrypt 비밀번호 검증';
  RAISE NOTICE '   - 로그인 시간 자동 업데이트';
  RAISE NOTICE '   - active 상태만 로그인 허용';
END $$;
