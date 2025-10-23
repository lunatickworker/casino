# 강제 입출금 vs 입출금 승인 분석

## 질문: 둘은 같은 경우가 아닌가?

**답변: 맞습니다! 본질적으로 동일한 작업입니다.**

## 1. 두 기능의 비교

### 1.1 강제 입출금 (UserManagement.tsx)

**시나리오:**
- 관리자가 사용자 관리 화면에서 직접 입출금 처리
- 사용자의 요청 없이 관리자가 주도적으로 처리

**프로세스:**
```
1. 관리자가 "강제 입금" 또는 "강제 출금" 버튼 클릭
2. Invest API 호출 (depositBalance / withdrawBalance)
3. API 응답에서 새로운 balance 파싱
4. users 테이블의 balance 업데이트
5. (선택) transactions 테이블에 기록 (admin_deposit / admin_withdraw)
```

**코드:**
```typescript
// UserManagement.tsx
const handleForceDeposit = async (userId: string, amount: number) => {
  // 1. API 호출
  const apiResult = await investApi.depositBalance(username, amount, opcode, token, secretKey);
  
  // 2. balance 파싱
  const newBalance = investApi.extractBalanceFromResponse(apiResult.data, username);
  
  // 3. DB 업데이트
  await supabase.from('users').update({ balance: newBalance }).eq('id', userId);
};
```

### 1.2 입출금 승인 (TransactionApprovalManager.tsx)

**시나리오:**
- 사용자가 입출금 요청 (UserDeposit / UserWithdraw)
- 관리자가 승인 또는 거부

**프로세스:**
```
1. 사용자가 입출금 요청 → transactions 테이블에 'pending' 상태로 저장
2. 관리자가 "승인" 버튼 클릭
3. Invest API 호출 (depositBalance / withdrawBalance)
4. API 응답에서 새로운 balance 파싱
5. users 테이블의 balance 업데이트
6. transactions 테이블의 status를 'completed'로 변경
```

**코드:**
```typescript
// TransactionApprovalManager.tsx
const handleApprove = async (transaction: Transaction) => {
  // 1. API 호출
  const apiResult = await investApi.depositBalance(
    transaction.username, 
    transaction.amount, 
    opcode, 
    token, 
    secretKey
  );
  
  // 2. balance 파싱
  const newBalance = investApi.extractBalanceFromResponse(apiResult.data, transaction.username);
  
  // 3. DB 업데이트
  await supabase.from('users').update({ balance: newBalance }).eq('id', transaction.user_id);
  await supabase.from('transactions').update({ status: 'completed' }).eq('id', transaction.id);
};
```

## 2. 공통점

### 2.1 API 호출 측면
- **동일한 Invest API 사용**: `depositBalance()` / `withdrawBalance()`
- **동일한 파라미터**: opcode, username, amount, token, secretKey
- **동일한 응답 파싱**: `extractBalanceFromResponse()`

### 2.2 DB 업데이트 측면
- **동일한 테이블**: users 테이블의 balance 필드 업데이트
- **동일한 권한 필요**: 관리자가 다른 사용자의 balance를 수정
- **동일한 RLS 정책 적용**: `users_update_by_admin` 정책

### 2.3 권한 측면
- **누가 실행**: 관리자 (파트너)
- **무엇을 수정**: 사용자의 balance
- **어떻게**: Invest API 호출 → DB 업데이트

## 3. 차이점 (UI/UX만 다름)

| 구분 | 강제 입출금 | 입출금 승인 |
|------|-------------|-------------|
| **트리거** | 관리자가 직접 시작 | 사용자 요청 → 관리자 승인 |
| **transactions 기록** | 선택적 (admin_deposit/admin_withdraw) | 필수 (deposit/withdrawal) |
| **거부 가능 여부** | 해당 없음 | 가능 (rejected 상태) |
| **처리 노트** | 선택적 | 선택적 |
| **사용자 알림** | 선택적 | 권장 (WebSocket으로 실시간 알림) |

## 4. RLS 정책 관점

### 4.1 두 경우 모두 동일한 정책 적용

```sql
-- 267_admin-update-user-data-rls.sql
CREATE POLICY "users_update_by_admin" ON users
FOR UPDATE
USING (
  auth.uid() IS NOT NULL
  AND (
    -- 시스템 관리자는 모든 사용자 업데이트 가능
    EXISTS (
      SELECT 1 FROM partners 
      WHERE id = auth.uid() 
      AND level = 1
    )
    OR
    -- 상위 파트너는 하위 조직 사용자 업데이트 가능
    EXISTS (
      SELECT 1 FROM partners p1
      INNER JOIN users u ON u.referrer_id = p1.id
      WHERE u.id = users.id
      AND (재귀적으로 상위 파트너 체인 확인)
    )
  )
)
```

이 정책은:
- ✅ 강제 입출금 시 적용
- ✅ 입출금 승인 시 적용
- ✅ 기타 관리자의 사용자 정보 수정 시 적용

## 5. 현재 문제 진단

### 5.1 문제 상황
"지금 DB에 업데이트 하는 RLS가 안맞아서 업데이트를 못하는것 같다"

### 5.2 가능한 원인

#### 원인 1: RLS가 비활성화되어 있었는데 최근 활성화됨
```sql
-- 158_comprehensive-rls-audit-and-fix.sql에서 모든 RLS 비활성화
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- 하지만 다른 파일에서 다시 활성화했을 가능성
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

**확인 방법:**
```sql
-- 268_check_current_rls_status.sql 실행
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('users', 'transactions');
```

#### 원인 2: 정책이 없거나 잘못됨
```sql
-- users_update_by_admin 정책이 없음
-- 또는 정책의 조건이 현재 관리자를 허용하지 않음
```

**확인 방법:**
```sql
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'users' 
  AND cmd = 'UPDATE';
```

#### 원인 3: auth.uid()가 NULL
```typescript
// 로그인하지 않았거나 세션이 만료됨
const { data: { user } } = await supabase.auth.getUser();
console.log('Current user:', user); // null이면 문제
```

## 6. 해결 방안

### 6.1 즉시 해결 (RLS 정책 추가)

**Step 1: 현재 상태 확인**
```sql
-- 268_check_current_rls_status.sql 실행
psql -f database/268_check_current_rls_status.sql
```

**Step 2: RLS 정책 추가**
```sql
-- 267_admin-update-user-data-rls.sql 실행
psql -f database/267_admin-update-user-data-rls.sql
```

**Step 3: 테스트**
- 강제 입출금 테스트
- 입출금 승인 테스트
- Console 로그에서 "✅ [잔고 업데이트 완료]" 확인

### 6.2 근본 해결 (코드 통합 - 선택사항)

**현재 문제:**
- UserManagement.tsx와 TransactionApprovalManager.tsx에 중복 코드
- 같은 로직을 두 곳에서 유지보수해야 함

**개선 방안: 공통 함수 분리**

```typescript
// lib/balanceManager.ts (새 파일)
export async function updateUserBalance(
  userId: string,
  username: string,
  amount: number,
  transactionType: 'deposit' | 'withdrawal',
  opcode: string,
  token: string,
  secretKey: string,
  options?: {
    transactionId?: string;
    note?: string;
    processedBy?: string;
  }
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  try {
    // 1. Invest API 호출
    const apiResult = transactionType === 'deposit'
      ? await investApi.depositBalance(username, amount, opcode, token, secretKey)
      : await investApi.withdrawBalance(username, amount, opcode, token, secretKey);

    if (apiResult.error) {
      throw new Error(apiResult.error);
    }

    // 2. balance 파싱
    const newBalance = investApi.extractBalanceFromResponse(apiResult.data, username);

    // 3. users 테이블 업데이트
    const { error: userError } = await supabase
      .from('users')
      .update({ 
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (userError) throw userError;

    // 4. transactions 테이블 업데이트 (있는 경우)
    if (options?.transactionId) {
      const { error: txError } = await supabase
        .from('transactions')
        .update({
          status: 'completed',
          balance_after: newBalance,
          processed_at: new Date().toISOString(),
          processed_by: options.processedBy,
          processing_note: options.note,
          external_transaction_id: apiResult.data?.transaction_id || null
        })
        .eq('id', options.transactionId);

      if (txError) throw txError;
    }

    return { success: true, newBalance };

  } catch (error) {
    console.error('❌ Balance update failed:', error);
    return { 
      success: false, 
      newBalance: 0, 
      error: error instanceof Error ? error.message : '알 수 없는 오류' 
    };
  }
}
```

**사용 예시:**

```typescript
// UserManagement.tsx - 강제 입출금
const handleForceDeposit = async (userId: string, amount: number) => {
  const result = await updateUserBalance(
    userId,
    user.username,
    amount,
    'deposit',
    opcode,
    token,
    secretKey,
    {
      note: '관리자 강제 입금',
      processedBy: currentAdmin.username
    }
  );

  if (result.success) {
    toast.success(`입금 완료: ${result.newBalance}원`);
  } else {
    toast.error(result.error);
  }
};

// TransactionApprovalManager.tsx - 입출금 승인
const handleApprove = async (transaction: Transaction) => {
  const result = await updateUserBalance(
    transaction.user_id,
    transaction.username,
    transaction.amount,
    transaction.transaction_type,
    opcode,
    token,
    secretKey,
    {
      transactionId: transaction.id,
      note: processingNote,
      processedBy: currentAdmin.username
    }
  );

  if (result.success) {
    toast.success('승인 완료');
  } else {
    toast.error(result.error);
  }
};
```

### 6.3 장점

1. **코드 중복 제거**
   - 같은 로직을 한 곳에서만 관리
   - 버그 수정 시 한 번만 수정

2. **일관성 보장**
   - 강제 입출금과 승인이 동일한 방식으로 처리
   - API 호출 → balance 파싱 → DB 업데이트 순서 보장

3. **유지보수 용이**
   - 새로운 기능 추가 시 한 곳만 수정
   - 테스트도 한 곳만 하면 됨

4. **에러 처리 통일**
   - 모든 입출금 처리에 동일한 에러 핸들링 적용

## 7. 결론

### 7.1 질문에 대한 답변

> "관리자가 강제 입출금하는거하고 사용자가 입출금 요청해서 관리자가 승인하는거하고 같은 경우라고 생각하는데 맞지않나?"

**✅ 맞습니다!**

- **본질적으로 동일한 작업**: Invest API 호출 → balance 업데이트
- **동일한 권한 필요**: 관리자가 사용자 balance 수정
- **동일한 RLS 정책 적용**: `users_update_by_admin`
- **차이는 UI/UX뿐**: 트리거 방식과 기록 여부만 다름

### 7.2 현재 해야 할 일

1. **즉시 조치**: RLS 정책 추가
   ```bash
   # Supabase SQL Editor에서 실행
   267_admin-update-user-data-rls.sql
   ```

2. **확인**: 두 기능 모두 정상 작동하는지 테스트
   - 강제 입출금
   - 입출금 승인

3. **선택적 개선**: 코드 통합 (리팩토링)
   - `lib/balanceManager.ts` 생성
   - 중복 로직 제거

### 7.3 핵심 포인트

**RLS 정책은 "누가 무엇을 할 수 있는가"를 정의합니다.**

- **누가**: 관리자 (auth.uid()가 partners 테이블에 있는 경우)
- **무엇을**: 사용자의 balance 업데이트
- **조건**: 시스템 관리자이거나 상위 파트너인 경우

이 정책이 있으면:
- ✅ 강제 입출금 가능
- ✅ 입출금 승인 가능
- ✅ 기타 관리자의 사용자 정보 수정 가능

이 정책이 없으면:
- ❌ "new row violates row-level security policy" 에러 발생
- ❌ 어떤 방식으로도 사용자 balance 업데이트 불가

## 8. 추가 질문이 있으시면

- "코드 통합을 해야 할까요?" → 선택사항이지만 권장합니다
- "RLS를 비활성화하면 안되나요?" → 보안상 권장하지 않습니다
- "다른 테이블도 같은 문제가 있나요?" → transactions 테이블도 동일하게 처리했습니다
