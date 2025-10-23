# 267. 관리자 권한으로 사용자 데이터 업데이트 RLS 정책

## 문제 상황

TransactionApprovalManager에서 관리자가 입출금 승인 시 다음과 같은 문제가 발생:

1. **users 테이블**: "users can update own data" 정책만 있어서 관리자가 다른 사용자의 balance를 업데이트할 수 없음
2. **transactions 테이블**: 관리자가 거래 상태를 변경할 수 없음

## 해결 방안

7단계 권한 체계를 고려한 계층적 RLS 정책 구현:

### 1. users 테이블 정책

#### 1.1 본인 데이터 수정
- **정책명**: `users_update_own_data`
- **적용 대상**: 일반 사용자
- **내용**: 사용자는 자신의 데이터만 수정 가능

#### 1.2 관리자 권한 데이터 수정
- **정책명**: `users_update_by_admin`
- **적용 대상**: 관리자 (partners 테이블의 사용자)
- **내용**:
  - 시스템 관리자(level=1)는 모든 사용자 데이터 수정 가능
  - 상위 파트너는 하위 조직 사용자 데이터 수정 가능
  - 재귀적으로 상위 파트너 체인을 확인

### 2. transactions 테이블 정책

#### 2.1 본인 거래 수정
- **정책명**: `transactions_update_own`
- **적용 대상**: 일반 사용자
- **내용**: 사용자는 본인의 pending 상태 거래만 취소 가능

#### 2.2 관리자 권한 거래 처리
- **정책명**: `transactions_update_by_admin`
- **적용 대상**: 관리자 (partners 테이블의 사용자)
- **내용**:
  - 시스템 관리자(level=1)는 모든 거래 처리 가능
  - 상위 파트너는 하위 조직 사용자의 거래 승인/거부 가능
  - 재귀적으로 상위 파트너 체인을 확인

## 권한 체계 (7단계)

```
1. 시스템관리자 (level=1)
   └─ 2. 대본사 (level=2)
       └─ 3. 본사 (level=3)
           └─ 4. 부본사 (level=4)
               └─ 5. 총판 (level=5)
                   └─ 6. 매장 (level=6)
                       └─ 7. 사용자 (level=7)
```

## RLS 정책 동작 원리

### 예시 1: 대본사가 사용자 승인

1. 대본사(level=2)가 로그인 → `auth.uid()` = 대본사 partner_id
2. 사용자의 입금 요청 승인
3. RLS 정책 확인:
   ```sql
   -- 사용자의 referrer_id를 통해 상위 파트너 체인 확인
   WITH RECURSIVE parent_chain AS (
     SELECT id, parent_id, level
     FROM partners
     WHERE id = (사용자의 referrer_id)
     
     UNION ALL
     
     SELECT p.id, p.parent_id, p.level
     FROM partners p
     INNER JOIN parent_chain pc ON p.id = pc.parent_id
   )
   SELECT 1 FROM parent_chain
   WHERE id = auth.uid()  -- 대본사 ID가 체인에 있으면 승인
   ```

4. 승인되면 users.balance 업데이트 가능

### 예시 2: 매장이 사용자 승인

1. 매장(level=6)이 로그인 → `auth.uid()` = 매장 partner_id
2. 해당 매장의 사용자 입금 요청 승인
3. RLS 정책 확인:
   - 사용자의 referrer_id가 매장 ID와 일치하면 직접 승인 가능
   - 또는 상위 파트너 체인에서 매장 ID를 찾으면 승인 가능

## 적용 방법

### 1. Supabase SQL Editor에서 실행

```sql
-- 파일 내용 전체를 복사하여 실행
-- /database/267_admin-update-user-data-rls.sql
```

### 2. 또는 터미널에서 실행

```bash
psql -h <SUPABASE_HOST> -U postgres -d postgres -f database/267_admin-update-user-data-rls.sql
```

## 주의사항

### 1. RLS 활성화 후 기존 코드 영향

- **영향 없음**: 관리자 로그인 시 `auth.uid()`가 설정되므로 정책이 자동으로 적용됨
- **확인 필요**: 익명 사용자(anon)로 직접 업데이트하는 경우는 실패함

### 2. 성능 고려사항

- 재귀 쿼리가 포함되어 있어 깊은 계층에서는 성능이 저하될 수 있음
- 필요시 인덱스 추가:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_users_referrer_id 
  ON users(referrer_id) WHERE referrer_id IS NOT NULL;
  
  CREATE INDEX IF NOT EXISTS idx_partners_parent_id 
  ON partners(parent_id) WHERE parent_id IS NOT NULL;
  ```

### 3. 디버깅

RLS 정책으로 인해 업데이트가 실패하는 경우:

```sql
-- 현재 사용자 확인
SELECT auth.uid(), auth.role();

-- 정책 테스트 (시스템 관리자로 실행)
SET LOCAL role postgres;
SELECT * FROM users WHERE id = '<user_id>';

-- RLS 임시 비활성화 (개발 환경에서만)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
-- 테스트 후 다시 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

## 테스트 방법

### 1. 관리자 로그인 후 사용자 balance 업데이트 테스트

```typescript
// TransactionApprovalManager.tsx
const handleApprove = async (transactionId: string) => {
  const { data: transaction } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .single();
  
  // 1. users.balance 업데이트
  const { error: userError } = await supabase
    .from('users')
    .update({ 
      balance: transaction.balance_after 
    })
    .eq('id', transaction.user_id);
  
  if (userError) {
    console.error('RLS 정책으로 인한 업데이트 실패:', userError);
    return;
  }
  
  // 2. transactions.status 업데이트
  const { error: txError } = await supabase
    .from('transactions')
    .update({ 
      status: 'completed',
      processed_at: new Date().toISOString(),
      processed_by: user.id
    })
    .eq('id', transactionId);
  
  if (txError) {
    console.error('거래 상태 업데이트 실패:', txError);
    return;
  }
  
  console.log('승인 완료!');
};
```

### 2. 사용자 로그인 후 본인 데이터 수정 테스트

```typescript
// UserProfile.tsx
const handleUpdateProfile = async () => {
  const { error } = await supabase
    .from('users')
    .update({ 
      nickname: '새로운닉네임',
      phone: '010-1234-5678'
    })
    .eq('id', user.id);
  
  if (error) {
    console.error('프로필 업데이트 실패:', error);
    return;
  }
  
  console.log('프로필 업데이트 완료!');
};
```

## 롤백 방법

문제 발생 시 RLS를 다시 비활성화:

```sql
-- users 테이블 RLS 비활성화
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- transactions 테이블 RLS 비활성화
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- 정책 삭제
DROP POLICY IF EXISTS "users_update_by_admin" ON users;
DROP POLICY IF EXISTS "transactions_update_by_admin" ON transactions;
```

## 참고 자료

- Supabase RLS 문서: https://supabase.com/docs/guides/auth/row-level-security
- PostgreSQL Policy 문서: https://www.postgresql.org/docs/current/sql-createpolicy.html
- 재귀 쿼리 문서: https://www.postgresql.org/docs/current/queries-with.html
