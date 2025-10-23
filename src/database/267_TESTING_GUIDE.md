# 267 RLS 정책 테스트 가이드

## 테스트 목적

관리자가 입출금 승인 시 사용자의 balance를 정상적으로 업데이트할 수 있는지 확인합니다.

## 사전 준비

### 1. SQL 파일 실행

```bash
# Supabase SQL Editor에서 실행
/database/267_admin-update-user-data-rls.sql
```

### 2. 테스트 계정 준비

```sql
-- 시스템 관리자 확인
SELECT id, username, level, opcode 
FROM partners 
WHERE level = 1
LIMIT 1;

-- 일반 사용자 확인
SELECT id, username, balance, referrer_id 
FROM users 
WHERE referrer_id IS NOT NULL
LIMIT 1;
```

## 테스트 시나리오

### 시나리오 1: 관리자가 사용자 입금 승인

#### Step 1: 사용자 로그인 후 입금 요청

1. **사용자 페이지 로그인**
   - URL: `http://localhost:5173/user/login`
   - 사용자명: `test_user` (예시)
   - 비밀번호: `password123`

2. **입금 요청**
   - 메뉴: 충전하기 (UserDeposit)
   - 입금액: 100,000원
   - 계좌 정보 입력 후 요청

3. **확인 (브라우저 개발자 도구)**
   ```javascript
   // Console에서 확인
   console.log('입금 요청 완료:', {
     transactionId: '<transaction_id>',
     status: 'pending',
     amount: 100000
   });
   ```

#### Step 2: 관리자 로그인 후 승인

1. **관리자 페이지 로그인**
   - URL: `http://localhost:5173/admin/login`
   - 파트너명: `smcdev11` (시스템 관리자)
   - 비밀번호: `password123`

2. **입출금 관리 메뉴 진입**
   - 메뉴: TransactionApprovalManager
   - 탭: 대기중 (pending)

3. **승인 처리**
   - 입금 요청 선택
   - "승인" 버튼 클릭
   - 처리 노트 입력 (선택)
   - "확인" 클릭

4. **Console 로그 확인**
   ```
   🔄 [거래처리] deposit approve 시작
   🔐 [파트너 정보]: { has_opcode: true, has_token: true }
   💰 [API 입금] 외부 API 입금 처리 시작
   📡 [API 응답]: { data: { balance: 100000 } }
   ✅ [API 성공] 새로운 잔고: 100000
   ✅ [거래 업데이트 완료] <transaction_id> -> completed
   💰 [잔고 업데이트 준비]: { user_id: '<user_id>', new_balance: 100000 }
   ✅ [잔고 업데이트 완료] test_user: 0 -> 100000
   ```

5. **에러 발생 시 (RLS 문제)**
   ```
   ❌ [잔고 업데이트 실패]: {
     code: '42501',
     message: 'new row violates row-level security policy for table "users"'
   }
   ```
   
   **해결**: 267_admin-update-user-data-rls.sql을 다시 실행하세요.

#### Step 3: 데이터베이스 확인

```sql
-- 1. transactions 테이블 확인
SELECT 
  id,
  username,
  transaction_type,
  amount,
  status,
  balance_after,
  processed_by,
  processed_at
FROM transactions
WHERE id = '<transaction_id>';

-- 예상 결과:
-- status: 'completed'
-- balance_after: 100000
-- processed_by: 'smcdev11'
-- processed_at: '2025-01-30T...'

-- 2. users 테이블 확인
SELECT 
  id,
  username,
  balance,
  updated_at
FROM users
WHERE username = 'test_user';

-- 예상 결과:
-- balance: 100000 (업데이트됨)
-- updated_at: '2025-01-30T...' (최근 시각)
```

### 시나리오 2: 관리자가 사용자 출금 승인

#### Step 1: 사용자 로그인 후 출금 요청

1. **사용자 페이지 로그인**
   - URL: `http://localhost:5173/user/login`
   - 사용자명: `test_user`

2. **출금 요청**
   - 메뉴: 환전하기 (UserWithdraw)
   - 출금액: 50,000원
   - 계좌 정보 확인 후 요청

#### Step 2: 관리자 로그인 후 승인

1. **관리자 페이지 로그인**
2. **입출금 관리 메뉴 진입**
3. **승인 처리**

4. **Console 로그 확인**
   ```
   🔄 [거래처리] withdrawal approve 시작
   💸 [API 출금] 외부 API 출금 처리 시작
   📡 [API 응답]: { data: { balance: 50000 } }
   ✅ [API 성공] 새로운 잔고: 50000
   ✅ [거래 업데이트 완료] <transaction_id> -> completed
   ✅ [잔고 업데이트 완료] test_user: 100000 -> 50000
   ```

#### Step 3: 데이터베이스 확인

```sql
SELECT 
  username,
  balance
FROM users
WHERE username = 'test_user';

-- 예상 결과:
-- balance: 50000 (100000 - 50000)
```

### 시나리오 3: 사용자가 본인 데이터 수정

#### Step 1: 사용자 로그인 후 프로필 수정

1. **사용자 페이지 로그인**
2. **내정보 메뉴** (UserProfile)
3. **프로필 수정**
   - 닉네임: "새로운닉네임"
   - 전화번호: "010-1234-5678"
   - "저장" 클릭

4. **확인**
   ```sql
   SELECT 
     username,
     nickname,
     phone
   FROM users
   WHERE username = 'test_user';
   
   -- 예상 결과:
   -- nickname: '새로운닉네임'
   -- phone: '010-1234-5678'
   ```

5. **balance 수정 시도 (실패해야 함)**
   ```typescript
   // 브라우저 Console에서 실행
   const { data, error } = await supabase
     .from('users')
     .update({ balance: 9999999 })
     .eq('id', '<current_user_id>');
   
   console.log('결과:', { data, error });
   // 예상: 성공 (RLS 정책이 balance 필드를 제한하지 않으므로)
   // 주의: 실제 운영에서는 balance를 사용자가 직접 수정하지 못하도록 애플리케이션 레벨에서 제어 필요
   ```

### 시나리오 4: 사용자가 다른 사용자 데이터 수정 시도 (실패해야 함)

```sql
-- SQL Editor에서 사용자 세션으로 실행
-- auth.uid()를 사용자의 UUID로 설정

-- 다른 사용자의 balance 수정 시도
UPDATE users 
SET balance = 9999999 
WHERE username = 'other_user';

-- 예상 결과: 
-- ERROR: new row violates row-level security policy for table "users"
```

## 성능 테스트

### 1. 재귀 쿼리 성능 측정

```sql
-- 깊은 계층 구조에서의 업데이트 성능 측정
EXPLAIN ANALYZE
UPDATE users 
SET balance = 100000 
WHERE id = '<user_id>';
```

### 2. 대량 거래 처리 성능

```sql
-- 100건의 거래를 순차적으로 승인할 때의 성능
SELECT 
  COUNT(*) as total_transactions,
  AVG(EXTRACT(EPOCH FROM (processed_at - request_time))) as avg_processing_seconds
FROM transactions
WHERE status = 'completed'
  AND processed_at >= NOW() - INTERVAL '1 hour';
```

## 디버깅 팁

### 1. 현재 사용자 확인

```sql
-- Supabase에서 현재 인증된 사용자 확인
SELECT 
  auth.uid() as current_user_id,
  auth.role() as current_role;
```

### 2. RLS 정책 활성화 상태 확인

```sql
-- users 테이블 RLS 확인
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'transactions');

-- 예상 결과:
-- users: rowsecurity = true
-- transactions: rowsecurity = true
```

### 3. 정책 목록 확인

```sql
-- users 테이블의 정책 목록
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN ('users', 'transactions')
ORDER BY tablename, policyname;
```

### 4. 특정 사용자의 상위 파트너 체인 확인

```sql
-- 재귀 쿼리로 상위 파트너 체인 확인
WITH RECURSIVE parent_chain AS (
  SELECT 
    p.id,
    p.username,
    p.parent_id,
    p.level,
    1 as depth
  FROM partners p
  INNER JOIN users u ON u.referrer_id = p.id
  WHERE u.username = 'test_user'
  
  UNION ALL
  
  SELECT 
    p.id,
    p.username,
    p.parent_id,
    p.level,
    pc.depth + 1
  FROM partners p
  INNER JOIN parent_chain pc ON p.id = pc.parent_id
)
SELECT 
  depth,
  username,
  level,
  id
FROM parent_chain
ORDER BY depth;

-- 예상 결과:
-- depth | username    | level | id
-- ------|-------------|-------|------
--   1   | store01     |   6   | <id>
--   2   | distributor |   5   | <id>
--   3   | region_hq   |   4   | <id>
--   4   | hq          |   3   | <id>
--   5   | main_office |   2   | <id>
--   6   | smcdev11    |   1   | <id>
```

### 5. RLS 정책 임시 비활성화 (개발 환경 전용)

```sql
-- 디버깅을 위해 임시 비활성화
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- 테스트 완료 후 다시 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
```

## 문제 해결

### 문제 1: "new row violates row-level security policy"

**원인**: RLS 정책이 관리자의 업데이트를 허용하지 않음

**해결**:
```sql
-- 1. 정책 확인
SELECT * FROM pg_policies 
WHERE tablename = 'users' 
  AND policyname = 'users_update_by_admin';

-- 2. 정책이 없거나 잘못된 경우
-- 267_admin-update-user-data-rls.sql을 다시 실행

-- 3. 현재 사용자가 관리자인지 확인
SELECT 
  auth.uid() as current_user,
  p.username,
  p.level
FROM partners p
WHERE p.id = auth.uid();
```

### 문제 2: auth.uid()가 NULL

**원인**: 로그인하지 않았거나 세션이 만료됨

**해결**:
```typescript
// 1. 로그인 상태 확인
const { data: { user } } = await supabase.auth.getUser();
console.log('Current user:', user);

// 2. 재로그인
await supabase.auth.signInWithPassword({
  email: 'admin@example.com',
  password: 'password'
});
```

### 문제 3: 관리자가 시스템 관리자가 아닌데도 모든 사용자 업데이트 가능

**원인**: 재귀 쿼리가 모든 상위 파트너를 찾아서 허용

**해결**: 정상 동작입니다. 7단계 권한 체계에서 상위 파트너는 모든 하위 조직의 사용자를 관리할 수 있습니다.

### 문제 4: 성능 저하

**원인**: 재귀 쿼리가 깊은 계층 구조에서 느림

**해결**:
```sql
-- 1. 인덱스 확인
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('users', 'partners')
  AND schemaname = 'public';

-- 2. 필요한 인덱스가 없으면 추가
CREATE INDEX IF NOT EXISTS idx_users_referrer_id 
ON users(referrer_id) WHERE referrer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_parent_id 
ON partners(parent_id) WHERE parent_id IS NOT NULL;

-- 3. 쿼리 플랜 분석
EXPLAIN ANALYZE
UPDATE users 
SET balance = 100000 
WHERE id = '<user_id>';
```

## 체크리스트

- [ ] 267_admin-update-user-data-rls.sql 실행 완료
- [ ] users 테이블 RLS 활성화 확인
- [ ] transactions 테이블 RLS 활성화 확인
- [ ] 시스템 관리자로 입금 승인 테스트 성공
- [ ] 시스템 관리자로 출금 승인 테스트 성공
- [ ] 사용자가 본인 프로필 수정 테스트 성공
- [ ] 사용자가 다른 사용자 데이터 수정 실패 확인
- [ ] 재귀 쿼리 성능 측정 완료
- [ ] 인덱스 생성 확인
- [ ] Console 로그에서 "✅ [잔고 업데이트 완료]" 확인

## 추가 고려사항

### 1. balance 필드 직접 수정 방지

현재 RLS 정책은 사용자가 본인의 balance를 직접 수정할 수 있습니다. 이를 방지하려면:

```sql
-- users_update_own_data 정책 수정
DROP POLICY IF EXISTS "users_update_own_data" ON users;

CREATE POLICY "users_update_own_data" ON users
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  -- balance 변경 방지 체크
  AND (
    (SELECT balance FROM users WHERE id = auth.uid()) = balance
    OR NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid())
  )
);
```

### 2. 트리거를 통한 balance 자동 업데이트

```sql
-- 이미 251_realtime_balance_update_trigger.sql에 구현되어 있음
-- transactions INSERT 시 자동으로 users.balance 업데이트
```

### 3. 감사 로그 (Audit Log)

```sql
-- balance 변경 이력 추적
CREATE TABLE IF NOT EXISTS balance_change_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  old_balance DECIMAL(15, 2),
  new_balance DECIMAL(15, 2),
  changed_by UUID REFERENCES partners(id),
  transaction_id UUID REFERENCES transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 트리거 추가
-- (필요시 별도 SQL 파일로 구현)
```

## 참고 문서

- [267_admin-update-user-data-rls.sql](/database/267_admin-update-user-data-rls.sql)
- [267_README.md](/database/267_README.md)
- [TransactionApprovalManager.tsx](/components/admin/TransactionApprovalManager.tsx)
- [Supabase RLS 문서](https://supabase.com/docs/guides/auth/row-level-security)
