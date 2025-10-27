# 보유금 동기화 시스템

## 개요

GMS 시스템의 보유금 동기화는 권한 레벨에 따라 다른 API를 호출하여 정확한 잔고 정보를 유지합니다.

## 문제점

- **기존**: 모든 권한 레벨에서 `GET /api/info`를 호출
- **발생한 오류**: 부본(level 3) 이하는 본사의 username을 사용하여 보유금 오류 발생

## 해결 방법

### 권한 레벨별 API 호출 분리

#### 1. level 1 (시스템관리자), level 2 (본사)
- **API**: `GET /api/info`
- **동기화 대상**: opcode 보유금 (대본사/본사 전체 보유금)
- **업데이트**: `partners` 테이블의 자신의 보유금만 업데이트

#### 2. level 2 user, level 3-7 (부본사, 총판, 매장, 회원)
- **API**: `PATCH /api/account/balance`
- **동기화 대상**: 모든 username의 잔고 변경사항
- **업데이트**: 
  - `users` 테이블: username 매핑하여 회원 잔고 업데이트
  - `partners` 테이블: username 매핑하여 파트너 잔고 업데이트

## 구현 내용

### 1. BalanceSyncManager 컴포넌트
**파일**: `/components/admin/BalanceSyncManager.tsx`

- 30초마다 자동 동기화 실행
- 권한 레벨에 따라 적절한 API 호출
- 백그라운드에서 조용히 실행 (UI 없음)

```typescript
// 사용법 (AdminLayout.tsx에 추가됨)
<BalanceSyncManager user={user} />
```

### 2. BalanceContext 수정
**파일**: `/contexts/BalanceContext.tsx`

- 수동 동기화 시에도 권한 레벨에 따라 다른 API 호출
- `syncBalance()` 함수 호출 시 자동으로 적절한 API 선택

### 3. Guidelines 업데이트
**파일**: `/guidelines/Guidelines.md`

- `GET /api/info`: level 1-2 사용
- `PATCH /api/account/balance`: level 2 user ~ 7 사용
- 각 API의 GMS 시스템 사용 방법 명시

## 동작 흐름

### 시스템관리자/본사 (level 1-2)

```
[30초마다]
  → GET /api/info 호출
  → opcode 보유금 파싱
  → partners 테이블 업데이트 (본인)
  → Realtime 이벤트 발생
  → UI 자동 업데이트
```

### 부본사 ~ 회원 (level 2 user ~ 7)

```
[30초마다]
  → PATCH /api/account/balance 호출
  → 모든 username의 잔고 데이터 수신
  → ⚠️ username이 있는 데이터만 처리 (없으면 무시)
  → username 매핑하여 users 테이블 업데이트 (존재하는 경우만)
  → username 매핑하여 partners 테이블 업데이트 (존재하는 경우만)
  → Realtime 이벤트 발생
  → UI 자동 업데이트
```

**주의**: DB에 없는 username은 업데이트하지 않고 무시합니다. 0으로 업데이트하지 않습니다.

## 주요 특징

### 1. 자동 동기화
- 30초 간격으로 자동 실행
- 로그인 시 즉시 1회 실행
- 컴포넌트 언마운트 시 자동 정리

### 2. 권한 레벨 자동 감지
```typescript
const shouldUseInfoAPI = user.level === 1 || user.level === 2;

if (shouldUseInfoAPI) {
  // GET /api/info
} else {
  // PATCH /api/account/balance
}
```

### 3. Username 매핑
- **중요**: API 응답에서 **username이 있는 데이터만** 업데이트
- **없는 username은 무시** (0으로 업데이트하지 않음)
- API 응답의 username과 DB의 username을 매칭
- users와 partners 테이블 모두 업데이트
- 매칭되는 레코드만 업데이트 (DB에 없는 username은 무시)

### 4. 중복 실행 방지
```typescript
const isSyncingRef = useRef(false);

if (isSyncingRef.current) {
  return; // 이미 실행 중이면 건너뜀
}
```

## 테스트 방법

### 1. level 1-2 테스트
1. 시스템관리자 또는 본사 계정으로 로그인
2. 콘솔에서 확인:
   ```
   📡 [BalanceSync] GET /api/info 호출 (level 1-2)
   ✅ [BalanceSync] 보유금 동기화 완료
   ```
3. 30초 후 자동 재실행 확인

### 2. level 3-7 테스트
1. 부본사 이하 계정으로 로그인
2. 콘솔에서 확인:
   ```
   📡 [BalanceSync] PATCH /api/account/balance 호출 (level 2 user ~ 7)
   📊 [BalanceSync] N건의 잔고 정보 수신
   ✅ [BalanceSync] 잔고 동기화 완료
   ```
3. 30초 후 자동 재실행 확인

### 3. 수동 동기화 테스트
1. 헤더의 보유금 새로고침 버튼 클릭
2. 권한 레벨에 따라 적절한 API 호출 확인
3. 보유금 업데이트 확인

## 로그 확인

### 성공적인 동기화
```
🔄 [BalanceSync] 자동 동기화 시작
📡 [BalanceSync] GET /api/info 호출 (level 1-2)
✅ [BalanceSync] 보유금 동기화 완료: { partner_id: '...', new_balance: 100000 }
```

### level 3-7 동기화
```
🔄 [BalanceSync] 자동 동기화 시작
📡 [BalanceSync] PATCH /api/account/balance 호출 (level 2 user ~ 7)
📊 [BalanceSync] 50건의 잔고 정보 수신
✅ [BalanceSync] 잔고 동기화 완료: {
  total_records: 50,
  users_updated: 45,
  partners_updated: 12,
  skipped_no_username: 5,
  note: '없는 username은 무시됨 (0으로 업데이트 안함)'
}
```

## 문제 해결

### 보유금이 업데이트되지 않는 경우
1. 콘솔에서 에러 메시지 확인
2. API 호출 로그 확인 (opcode, signature)
3. DB 연결 상태 확인
4. RLS 정책 확인 (비활성화 상태여야 함)

### username 매칭 실패
1. API 응답의 username 필드 확인
2. DB의 users/partners 테이블 username 확인
3. 대소문자 일치 확인
4. **중요**: username이 없는 데이터는 정상적으로 무시됨 (에러 아님)
5. **중요**: DB에 없는 username도 정상적으로 무시됨 (0으로 업데이트 안함)

## 관련 파일

- `/components/admin/BalanceSyncManager.tsx` - 자동 동기화 매니저
- `/contexts/BalanceContext.tsx` - 보유금 컨텍스트
- `/components/admin/AdminLayout.tsx` - 레이아웃 (BalanceSyncManager 포함)
- `/lib/investApi.ts` - API 호출 함수
- `/lib/opcodeHelper.ts` - opcode 조회 헬퍼
- `/guidelines/Guidelines.md` - API 매뉴얼

## 주의사항

1. **30초 간격 준수**: API 호출 간격은 최소 30초 유지 (Guidelines 권장사항)
2. **중복 실행 방지**: `isSyncingRef`로 동시 실행 방지
3. **에러 처리**: API 실패 시 조용히 무시하고 다음 주기에 재시도
4. **Realtime 연동**: DB 업데이트 시 Realtime 이벤트 자동 발생하여 모든 클라이언트 동기화
