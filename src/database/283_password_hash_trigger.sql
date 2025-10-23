-- 283_password_hash_trigger.sql
-- users 테이블 password_hash 자동 암호화 트리거

-- password_hash 자동 암호화 함수
CREATE OR REPLACE FUNCTION encrypt_user_password()
RETURNS TRIGGER AS $$
BEGIN
  -- password_hash가 평문으로 들어오면 자동 암호화
  -- crypt 함수 결과는 $2a$ 또는 $2b$로 시작하므로, 이미 암호화된 경우 재암호화 방지
  IF NEW.password_hash IS NOT NULL AND NEW.password_hash NOT LIKE '$2%' THEN
    NEW.password_hash := crypt(NEW.password_hash, gen_salt('bf'));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 트리거 삭제 (있을 경우)
DROP TRIGGER IF EXISTS trigger_encrypt_user_password ON users;

-- 트리거 생성
CREATE TRIGGER trigger_encrypt_user_password
  BEFORE INSERT OR UPDATE OF password_hash ON users
  FOR EACH ROW
  EXECUTE FUNCTION encrypt_user_password();

-- 확인
\echo '✅ password_hash 자동 암호화 트리거 생성 완료'
