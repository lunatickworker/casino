# 베팅 데이터 동기화 아키텍처

## 개요
historyindex API 중복 호출을 제거하고, 단일 소스(UserLayout.tsx)에서만 자동 호출하도록 최적화했습니다.

---

## 아키텍처 설계

### ✅ 자동 호출: UserLayout.tsx (사용자 페이지)
**역할:** 게임 세션별 실시간 베팅 데이터 동기화

**동작 방식:**
1. **게임 세션 생성** → `game_launch_sessions` 테이블에 INSERT
2. **즉시 호출** → 세션 생성과 동시에 첫 번째 `historyindex` API 호출
3. **30초 주기** → 이후 30초마다 반복 호출
4. **4분 무활동** → 세션 자동 종료 (`status='ended'`)

**최적화 포인트:**
- `lastTxidRef`로 마지막 처리 txid 추적 → 중복 방지
- 해당 사용자의 베팅만 필터링 → 불필요한 데이터 제거
- `INSERT` 사용 (중복 시 자동 무시)
- 새 베팅만 타이머 리셋 → 정확한 세션 종료

**코드 위치:**
```typescript
// /components/user/UserLayout.tsx

// 즉시 첫 호출
console.log(`🚀 세션 ${sessionId} 첫 베팅 동기화 (즉시 실행)`);
checkBettingAndTimeout();

// 30초마다 반복
const monitorInterval = setInterval(checkBettingAndTimeout, 30000);
sessionMonitorsRef.current.set(sessionId, monitorInterval);
```

---

### ✅ Realtime 구독: OnlineUsers.tsx (관리자 페이지)
**역할:** DB 변경 감지 후 화면 업데이트

**동작 방식:**
1. **Realtime 구독**
   - `game_launch_sessions` 테이블: 세션 생성/종료 감지
   - `users` 테이블: 보유금 변경 감지
   - `game_records` 테이블: 베팅 기록 추가 감지

2. **수동 새로고침**
   - 버튼 클릭 시 `loadOnlineSessions()` 호출
   - 개별 사용자 보유금 동기화 (`syncUserBalance`)

3. **자동 갱신 제거**
   - 기존 `syncBettingDataAndBalances` 함수 완전 삭제
   - 30초 주기 자동 호출 제거

**코드 위치:**
```typescript
// /components/admin/OnlineUsers.tsx

useEffect(() => {
  const channel = supabase
    .channel('online-sessions-realtime')
    .on('postgres_changes', { event: '*', table: 'game_launch_sessions' }, () => {
      loadOnlineSessions();
    })
    .on('postgres_changes', { event: 'UPDATE', table: 'users' }, () => {
      loadOnlineSessions();
    })
    .on('postgres_changes', { event: 'INSERT', table: 'game_records' }, () => {
      loadOnlineSessions();
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [user.id]);
```

---

### ✅ 수동 호출: BettingHistory.tsx, BettingManagement.tsx
**역할:** 관리자가 필요할 때만 수동으로 데이터 동기화

**동작 방식:**
- 버튼 클릭 시에만 `getGameHistory` 호출
- 자동 호출 로직 없음

---

## 데이터 흐름도

```
┌─────────────────────────────────────────────────────────────────┐
│                        사용자 게임 실행                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │  game_launch_sessions INSERT  │
         │  (status='active')            │
         └───────────┬───────────────────┘
                     │
                     ▼
         ┌───────────────────────────────┐
         │   UserLayout.tsx              │
         │   startSessionMonitor()       │
         │   - 15초 후 첫 호출           │
         │   - 30초마다 반복             │
         └───────────┬───────────────────┘
                     │
                     ▼
         ┌───────────────────────────────┐
         │   investApi.getGameHistory    │
         │   (lastTxid로 중복 방지)      │
         └───────────┬───────────────────┘
                     │
                     ▼
         ┌───────────────────────────────┐
         │   game_records INSERT         │
         │   (베팅 기록 저장)            │
         └───────────┬───────────────────┘
                     │
                     ▼
         ┌───────────────────────────────┐
         │   Realtime 이벤트 발생        │
         └───────────┬───────────────────┘
                     │
                     ▼
         ┌───────────────────────────────┐
         │   OnlineUsers.tsx 구독        │
         │   loadOnlineSessions()        │
         │   (화면 자동 업데이트)        │
         └───────────────────────────────┘
```

---

## 세션 재활성화 시스템

### 문제점
- 4분간 베팅 없으면 세션이 `status='ended'`로 변경됨
- 사용자가 게임을 계속하고 있지만 베팅이 잠시 없었을 경우
- 이후 베팅이 다시 발생해도 세션이 재활성화되지 않는 문제

### 해결 방법

#### 1. DB 트리거 (293_auto_reactivate_session_on_betting.sql)
```sql
-- game_records INSERT 시 자동으로 ended 세션을 active로 재활성화
CREATE TRIGGER trigger_reactivate_session_on_betting
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION reactivate_session_on_betting();
```

**동작 방식:**
1. `game_records`에 베팅 기록 INSERT
2. 해당 사용자의 최근 `ended` 세션 검색 (30분 이내)
3. `status='ended'` → `status='active'` 자동 변경
4. `ended_at = NULL`, `last_activity_at = NOW()`

#### 2. UserLayout.tsx Realtime 감지
```typescript
// 세션 상태 변경 감지
if (oldSession?.status === 'ended' && newSession.status === 'active') {
  console.log('🔄 세션 재활성화 감지! 모니터링 재시작');
  
  // 🔥 기존 모니터가 있으면 명시적으로 정리
  const existingInterval = sessionMonitorsRef.current.get(newSession.id);
  if (existingInterval) {
    clearInterval(existingInterval);
    sessionMonitorsRef.current.delete(newSession.id);
    lastBettingUpdateRef.current.delete(newSession.id);
    lastTxidRef.current.delete(newSession.id);
  }
  
  // 새로운 모니터 시작
  await startSessionMonitor(newSession.id, newSession.user_id);
}
```

**동작 방식:**
1. Realtime 구독으로 `game_launch_sessions` UPDATE 감지
2. `ended` → `active` 변경 확인
3. **기존 모니터 명시적 정리** (중요!)
4. `lastBettingUpdateRef`, `lastTxidRef` 초기화
5. 베팅 모니터링 새로 시작
6. 30초마다 `historyindex` 호출 재개
7. **4분 타임아웃 정상 작동**

### 시나리오 예시

```
1. 사용자 게임 실행 → 세션 생성 (status='active')
2. 베팅 진행 → game_records INSERT
3. 4분간 베팅 없음 → UserLayout.tsx가 세션 종료 (status='ended')
4. 사용자가 다시 베팅 → game_records INSERT
5. 🔄 DB 트리거 발동 → 세션 재활성화 (status='active')
6. 🔔 UserLayout.tsx Realtime 감지 → 기존 모니터 정리
7. ✅ 새로운 모니터 시작 → lastBettingUpdateRef = NOW()
8. 30초마다 historyindex 호출 재개
9. ⏱️ 4분 타임아웃 정상 작동 (새로운 타이머)
```

### 중요 포인트

**재활성화 시 반드시 필요한 작업:**
1. ✅ 기존 인터벌 정리 (`clearInterval`)
2. ✅ `sessionMonitorsRef` 삭제
3. ✅ `lastBettingUpdateRef` 초기화 (NOW로 설정)
4. ✅ `lastTxidRef` 초기화 (0으로 설정)
5. ✅ 새로운 인터벌 시작

**하지 않으면 발생하는 문제:**
- ❌ 4분 타임아웃 작동 안 함 (이전 lastUpdate 값 유지)
- ❌ 중복 모니터 실행 (메모리 누수)
- ❌ 타이머 꼬임 (컴퓨터 재시작해도 해결 안 됨)

---

## 제거된 코드

### OnlineUsers.tsx
```typescript
// ❌ 삭제됨
const syncBettingDataAndBalances = async () => { ... }

// ❌ 삭제됨
useEffect(() => {
  const bettingSyncInterval = setInterval(() => {
    syncBettingDataAndBalances();
  }, 30000);
}, []);

// ❌ 삭제됨
const executeScheduledSessionEnds = async () => { ... }

// ❌ 삭제됨
const cleanupOldSessions = async () => { ... }
```

---

## 성능 최적화 효과

### Before (문제점)
1. **UserLayout.tsx**: 30초마다 호출
2. **OnlineUsers.tsx**: 15초 후 시작, 30초마다 호출
3. **중복 호출**: 동일 데이터를 2곳에서 조회 → API 부하 2배
4. **시스템 불안정**: 충돌 가능성, 메모리 낭비

### After (개선)
1. **UserLayout.tsx**: 15초 후 시작, 30초마다 호출 (유일한 소스)
2. **OnlineUsers.tsx**: Realtime 구독만 → API 호출 없음
3. **API 부하**: 50% 감소
4. **시스템 안정성**: 단일 소스 원칙 (Single Source of Truth)

---

## 추가 개선 사항

### 1. lastTxid 기반 조회
- 매번 index=0으로 전체 조회 → lastTxid로 증분 조회
- 네트워크 트래픽 대폭 감소
- 중복 데이터 처리 제거

### 2. 사용자별 필터링
- 전체 베팅 데이터 조회 → 해당 사용자만 필터링
- 불필요한 데이터 처리 제거

### 3. INSERT vs UPSERT
- UPSERT는 중복 데이터도 성공 처리 → 타이머가 계속 리셋
- INSERT는 중복 시 에러 → 실제 새 데이터만 타이머 리셋

---

## 테스트 시나리오

### 1. 정상 동작 확인
```
1. 사용자 게임 실행
2. 즉시 콘솔 확인: "🚀 세션 X 첫 베팅 동기화 (즉시 실행)"
3. 즉시 콘솔 확인: "📊 세션 X 베팅 내역 동기화 (index: 0)"
4. 30초 대기
5. 콘솔 확인: "📊 세션 X 베팅 내역 동기화 (index: Y)"
6. 베팅 발생 시: "✅ 세션 X 새 베팅 Z건 업데이트"
```

### 2. 4분 타임아웃 확인
```
1. 게임 실행 후 베팅 없이 대기
2. 4분 30초 후 콘솔 확인: "⏱️ 세션 X 4분간 베팅 없음, 종료 처리"
3. DB 확인: game_launch_sessions.status = 'ended'
```

### 3. Realtime 동기화 확인
```
1. 관리자 페이지 OnlineUsers 오픈
2. 사용자 게임 실행
3. 자동으로 온라인 현황 업데이트 확인
4. 베팅 발생 시 보유금 자동 업데이트 확인
```

---

## 결론

✅ **단일 소스 원칙**: UserLayout.tsx에서만 자동 호출
✅ **Realtime 활용**: 관리자 페이지는 DB 변경 감지
✅ **API 부하 감소**: 중복 호출 제거 → 50% 감소
✅ **시스템 안정성**: 충돌 제거, 메모리 최적화
✅ **정확한 세션 관리**: 실제 베팅만 타이머 리셋

---

## 관련 파일

### 프론트엔드
- `/components/user/UserLayout.tsx` - 베팅 동기화 자동 호출, 세션 재활성화 감지
- `/components/admin/OnlineUsers.tsx` - Realtime 구독
- `/components/admin/BettingHistory.tsx` - 수동 동기화
- `/components/admin/BettingManagement.tsx` - 수동 동기화
- `/lib/investApi.ts` - API 호출 함수

### 데이터베이스
- `/database/293_auto_reactivate_session_on_betting.sql` - 세션 재활성화 트리거
- `/database/264_user_betting_tracker.sql` - reactivate_or_create_session 함수
- `/database/292_update_online_balance_from_betting.sql` - 온라인 현황 보유금 표시
