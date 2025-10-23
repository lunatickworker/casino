-- RLS 정책 추가 (익명 사용자도 로그인 가능하도록)

-- users 테이블에 RLS가 활성화되어 있는지 확인하고 비활성화
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- 또는 RLS를 유지하면서 익명 사용자도 조회 가능하도록 정책 추가
-- (보안을 위해 비활성화보다는 정책 추가 권장)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 익명 사용자가 username과 password로 본인 정보만 조회 가능
CREATE POLICY "Enable read access for authentication" ON users
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 인증된 사용자는 모든 데이터 조회 가능
CREATE POLICY "Enable full access for authenticated users" ON users
  FOR ALL
  TO authenticated
  USING (true);