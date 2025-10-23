# 관리자 보유금 초과 방지 시스템

## 📋 개요

286_enforce_head_office_balance_limit.sql 스크립트는 각 관리자가 강제 입금/입금 승인/하위 파트너 지급 시 **자신의 보유금**을 초과할 수 없도록 검증하는 시스템입니다.

## 🎯 목적

- **문제**: 기존에는 입출금 승인 시 단순히 관리자 보유금만 차감하고, 보유금 부족 여부를 확인하지 않음
- **해결**: 보유금 차감 전 해당 관리자의 보유금을 확인하고, 부족 시 거래를 거부

## 📦 구현된 기능

### 1. `check_partner_balance_sufficient()` 함수
- 관리자 자신의 보유금이 충분한지 검증
- 시스템관리자는 무제한 (검증 스킵)
- 보유금 부족 시 명확한 에러 메시지 반환

### 2. 트리거 함수 강화
- 입출금 승인 시 관리자 보유금 검증 추가
- 보유금 부족 시 EXCEPTION 발생 → 거래 전체 롤백
- 관리자 강제 입금, 사용자 입금 승인 모두 적용

### 3. 파트너 간 이체 함수 강화
- `transfer_partner_balance()` 함수에도 보유금 검증 추가
- 이체 전 송금자 보유금 확인

## 🔧 설치 방법

```sql
-- Supabase SQL Editor에서 실행
\i /database/286_enforce_head_office_balance_limit.sql
```

## 📊 적용 범위

### ✅ 검증이 적용되는 경우

1. **사용자 입금 승인** (`deposit`)
   - 사용자가 입금 신청 → 관리자 승인
   - 관리자 보유금 차감 전 **관리자 자신의 보유금** 확인

2. **관리자 강제 입금** (`admin_deposit`)
   - 관리자가 사용자에게 강제로 보유금 지급
   - 관리자 보유금 차감 전 **관리자 자신의 보유금** 확인

3. **파트너 간 이체** (`transfer_partner_balance`)
   - 파트너 A → 파트너 B로 보유금 이체
   - 송금 전 **송금자(파트너 A)의 보유금** 확인

### ⏭️ 검증이 스킵되는 경우

1. **시스템관리자** (`system_admin`)
   - 무제한 보유금 (검증 불필요)

2. **출금 관련** (`withdrawal`, `admin_withdrawal`)
   - 보유금이 증가하므로 검증 불필요

3. **금액이 0 이하인 경우**
   - 검증 의미 없음

## 🚨 오류 처리

### 보유금 부족 시

```sql
ERROR: 관리자 보유금이 부족합니다. (관리자: 매장A, 현재: 100000, 필요: 500000, 사용자 입금 승인)
```

### 프론트엔드 에러 메시지

```javascript
❌ 관리자 보유금이 부족하여 처리할 수 없습니다.
상위 관리자에게 보유금을 요청하거나, 관리자에게 문의하세요.
```

## 📝 로그 예시

```
💰 [보유금 검증] 시작: partner_id=xxx, amount=100000
✅ [보유금 검증] 통과: 관리자=매장A, 보유금=500000, 필요금액=100000
```

## 🔄 계층 구조 예시

```
시스템관리자 (무제한)
  └── 대본사 A (balance: 10,000,000) - 자신의 보유금만 확인
      ├── 본사 A1 (balance: 5,000,000) - 자신의 보유금만 확인
      │   └── 부본사 A1a (balance: 2,000,000) - 자신의 보유금만 확인
      │       └── 총판 A1a1 (balance: 1,000,000) - 자신의 보유금만 확인
      │           └── 매장 A1a1x (balance: 500,000) - 자신의 보유금만 확인
      │               └── 사용자 입금 승인 → 매장 A1a1x의 보유금 확인
      └── 본사 A2 (balance: 3,000,000) - 자신의 보유금만 확인
          └── ...
```

## 🧪 테스트 시나리오

### 1. 정상 승인 (보유금 충분)
```sql
-- 매장 A 보유금: 500,000
-- 사용자 입금 신청: 100,000
-- 결과: ✅ 승인 완료, 매장 A 보유금 400,000으로 감소
```

### 2. 승인 거부 (보유금 부족)
```sql
-- 매장 A 보유금: 50,000
-- 사용자 입금 신청: 100,000
-- 결과: ❌ 오류 발생 "관리자 보유금이 부족합니다. (관리자: 매장A, 현재: 50000, 필요: 100000)", 거래 롤백
```

### 3. 시스템관리자 (무제한)
```sql
-- 시스템관리자가 직접 승인
-- 어떤 금액이든 승인 가능
-- 결과: ✅ 검증 스킵, 승인 완료
```

### 4. 파트너 간 이체 (보유금 부족)
```sql
-- 총판 B 보유금: 300,000
-- 매장 C에게 500,000 이체 시도
-- 결과: ❌ 오류 발생 "관리자 보유금이 부족합니다.", 이체 실패
```

## 📌 주의사항

1. **트랜잭션 롤백**: 보유금 부족 시 전체 거래가 롤백됨
2. **동시성 제어**: `FOR UPDATE` 사용으로 동시 처리 시 안전
3. **검증 대상**: 대본사가 아닌 **해당 관리자 자신의 보유금**만 확인
4. **성능**: 단순 SELECT 1회로 매우 빠름

## 🔗 관련 파일

- `/database/276_add_user_approval_partner_balance.sql` - 기존 보유금 업데이트 로직
- `/database/203_partner-balance-logs.sql` - 파트너 보유금 로그 시스템
- `/components/admin/TransactionApprovalManager.tsx` - 프론트엔드 승인 처리

## ✅ 확인 방법

### 1. 함수 생성 확인
```sql
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'check_partner_balance_sufficient';
```

### 2. 트리거 확인
```sql
SELECT tgname, tgrelid::regclass, tgfoid::regproc
FROM pg_trigger
WHERE tgname LIKE '%balance%';
```

### 3. 실제 테스트
```sql
-- 테스트 입금 승인 (보유금 부족 상황 만들기)
INSERT INTO transactions (
    user_id, 
    transaction_type, 
    amount, 
    status
) VALUES (
    '사용자ID',
    'deposit',
    999999999, -- 매우 큰 금액
    'pending'
);

-- 승인 시도 (보유금 부족 오류 발생해야 함)
UPDATE transactions
SET status = 'approved'
WHERE id = '거래ID';
```

## 📞 문제 해결

### Q: "관리자 보유금이 부족합니다" 오류
**A**: 해당 관리자의 보유금이 실제로 부족합니다. 상위 관리자에게 보유금을 요청하세요.
```sql
-- 관리자 보유금 확인
SELECT id, username, nickname, balance
FROM partners
WHERE id = '파트너ID';
```

### Q: 시스템관리자인데도 검증됨
**A**: partner_type이 'system_admin'인지 확인
```sql
SELECT id, username, partner_type
FROM partners
WHERE id = '파트너ID';
-- partner_type이 'system_admin'이면 검증 스킵됨
```

### Q: 보유금이 충분한데도 오류 발생
**A**: transactions 처리 중 다른 거래가 동시에 진행되어 보유금이 차감되었을 수 있습니다.
```sql
-- 최근 거래 내역 확인
SELECT * FROM partner_balance_logs
WHERE partner_id = '파트너ID'
ORDER BY created_at DESC
LIMIT 10;
```

## 🎉 완료!

이제 각 관리자가 강제 입금/입금 승인/하위 파트너 지급 시 자신의 보유금을 초과할 수 없습니다!

## 💡 핵심 차이점

**기존 (276번 스크립트)**:
- 관리자 보유금을 차감하기만 하고, 보유금 부족 확인 없음
- 음수 보유금 가능 (문제!)

**개선 (286번 스크립트)**:
- 보유금 차감 **전**에 충분한지 확인
- 부족 시 거래 전체 롤백
- 음수 보유금 불가능 (안전!)
