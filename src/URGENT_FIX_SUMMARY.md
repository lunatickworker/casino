# 🚨 베팅 중복 & 세션 로그 문제 긴급 수정 요약

**작성일:** 2025-01-21  
**우선순위:** 🔴 긴급  
**영향 범위:** 온라인 현황, 베팅 기록, 세션 관리

---

## 📋 문제 상황

사용자 보고:
> "지금 디비에 베팅 기록을 보면 똑같은 데이터가 두개씩 파싱되고 있다. 그리고, 세션 145경과시간:xx초 이런 로그는 콘솔에 보이지 않는다."

### 문제 1: 베팅 데이터 중복 저장
- **증상:** 같은 `external_txid`를 가진 베팅 기록이 `game_records` 테이블에 2개 이상 저장됨
- **원인:** 
  - `game_records.external_txid`에 UNIQUE 제약이 `(external_txid, user_id, played_at)` 조합으로만 설정됨
  - `user_id`가 NULL로 저장되면서 중복 허용됨
  - 베팅 동기화 시 중복 체크 로직 부족

### 문제 2: 세션 모니터 로그 미표시
- **증상:** "⏱️ 세션 145 경과시간:xx초" 로그가 콘솔에 표시되지 않음
- **원인:**
  - `startSessionMonitor` 함수의 로그 출력이 부족
  - `checkBettingAndTimeout` 함수 실행 여부 추적 어려움
  - 디버깅을 위한 상세 로그 부재

---

## ✅ 해결 방법

### 1. 데이터베이스 수정

**파일:** `/database/298_fix_duplicate_betting_and_session_monitor.sql`

**주요 변경:**
1. `game_records.external_txid`에 단독 UNIQUE 제약 추가
2. 기존 중복 데이터 자동 정리 (최신 것만 유지)
3. `reactivate_session_on_betting` 트리거 개선:
   - `user_id` NULL 시 `username`으로 자동 조회
   - 중복 실행 방지 (이미 active면 업데이트 안 함)
   - BEFORE INSERT로 변경하여 트리거 순서 최적화

**실행 방법:**
```sql
-- Supabase SQL Editor에서 실행
-- 파일 전체 내용을 복사 후 붙여넣기
```

### 2. 프론트엔드 수정

**파일:** `/components/user/UserLayout.tsx`

**주요 변경:**

#### `syncSessionBetting` 함수 개선:
- ✅ 베팅 저장 전 DB에서 중복 체크 추가
- ✅ 상세한 단계별 로그 출력
- ✅ 중복 카운트 추적 및 표시
- ✅ txid 범위 추적 개선

```typescript
// Before
console.log(`📊 세션 ${sessionId} 베팅 내역 동기화 (index: ${lastTxid})`);

// After
console.log(`📊 세션 ${sessionId} 베팅 내역 동기화 (lastTxid: ${lastTxid}, username: ${username})`);
console.log(`📦 세션 ${sessionId} API 응답: ${bettingData.length}건의 전체 베팅`);
console.log(`👤 세션 ${sessionId} 사용자 ${username} 베팅: ${userBettingData.length}건`);
```

#### `startSessionMonitor` 함수 개선:
- ✅ 모니터링 시작/종료 로그 강화
- ✅ 세션 경과시간 로그 상세화
- ✅ 퍼센트 진행률 표시
- ✅ 남은 시간 계산 및 표시

```typescript
// Before
console.log(`⏱️ 세션 ${sessionId} 경과시간: ${Math.floor(timeSinceLastUpdate / 1000)}초`);

// After
const secondsElapsed = Math.floor(timeSinceLastUpdate / 1000);
const timeoutSeconds = 240;
console.log(`⏱️ 세션 ${sessionId} 경과시간: ${secondsElapsed}초 / ${timeoutSeconds}초 (${(secondsElapsed / timeoutSeconds * 100).toFixed(1)}%)`);
console.log(`✅ 세션 ${sessionId} 아직 활성 (남은 시간: ${Math.floor((240000 - timeSinceLastUpdate) / 1000)}초)`);
```

---

## 📊 예상 효과

### Before (문제 상황)
```
❌ game_records에 같은 external_txid가 2개 이상 존재
❌ 콘솔에 세션 타임아웃 로그 없음
❌ 디버깅 어려움
```

### After (해결 후)
```
✅ game_records에 같은 external_txid는 1개만 존재 (UNIQUE 제약)
✅ 30초마다 "⏱️ 세션 XXX 경과시간: YY초 / 240초 (ZZ%)" 로그 표시
✅ 베팅 저장 전 중복 체크: "⏭️ 세션 XXX txid YYY 이미 DB에 존재"
✅ 상세한 디버깅 로그로 문제 추적 용이
✅ 4분 타임아웃 정확히 동작
```

---

## 🔍 테스트 방법

### 1. 즉시 확인 (브라우저 콘솔)

게임 실행 후 콘솔에서 다음 로그 확인:

```
🎯 ========== 세션 145 모니터링 시작 요청 ==========
✅ 세션 145 사용자 정보: username=testuser, referrer_id=xxx
✅ 세션 145 API 설정: opcode=490006
⏰ 세션 145 인터벌 설정: 30초마다 반복
✅ ========== 세션 145 모니터 등록 완료 ==========

... 30초 후 ...

🔄 ========== 세션 145 베팅 체크 시작 ==========
⏱️ 세션 145 경과시간: 30초 / 240초 (12.5%) ← 이 로그가 나타나면 성공!
✅ 세션 145 아직 활성 (남은 시간: 210초)
```

### 2. 중복 방지 확인 (SQL)

```sql
-- 중복 베팅 확인 (결과: 0건이어야 함)
SELECT external_txid, COUNT(*)
FROM game_records
GROUP BY external_txid
HAVING COUNT(*) > 1;
```

### 3. 상세 테스트

자세한 테스트 가이드: `/database/299_TESTING_GUIDE_DUPLICATE_FIX.md` 참고

---

## 📝 변경 파일 목록

### 신규 파일
1. `/database/298_fix_duplicate_betting_and_session_monitor.sql` - DB 수정 스크립트
2. `/database/299_TESTING_GUIDE_DUPLICATE_FIX.md` - 상세 테스트 가이드
3. `/database/300_QUICK_FIX_GUIDE.md` - 빠른 실행 가이드
4. `/URGENT_FIX_SUMMARY.md` - 본 문서

### 수정 파일
1. `/components/user/UserLayout.tsx` - 베팅 동기화 및 세션 모니터링 로직 개선
2. `/database/000_INSTALLATION_ORDER.md` - 최신 패치 정보 추가

---

## 🚀 실행 단계

### Step 1: 데이터베이스 마이그레이션
```sql
-- Supabase SQL Editor에서 실행
-- 파일: /database/298_fix_duplicate_betting_and_session_monitor.sql
```

### Step 2: 브라우저 캐시 삭제
- Ctrl + F5 (강력 새로고침)
- 또는 브라우저 캐시 완전 삭제

### Step 3: 동작 확인
1. 사용자 페이지에서 게임 실행
2. 브라우저 개발자 도구 (F12) → Console 탭
3. 위 "테스트 방법" 섹션의 로그 확인

### Step 4: 검증
- [ ] "🎯 세션 XXX 모니터링 시작" 로그 확인
- [ ] "⏱️ 세션 XXX 경과시간" 로그 30초마다 확인
- [ ] SQL로 중복 베팅 0건 확인
- [ ] 관리자 페이지 온라인 현황에서 보유금 정상 표시 확인

---

## 💡 주요 개선 사항 요약

### 데이터베이스
| 항목 | Before | After |
|------|--------|-------|
| UNIQUE 제약 | (external_txid, user_id, played_at) | external_txid 단독 |
| 중복 데이터 | 존재 | 자동 정리 |
| 트리거 타이밍 | AFTER INSERT | BEFORE INSERT |
| user_id NULL | 처리 안 함 | username으로 자동 조회 |

### 프론트엔드
| 항목 | Before | After |
|------|--------|-------|
| 중복 체크 | txid > lastTxid만 | DB 중복 체크 추가 |
| 로그 레벨 | 기본 | 상세 (단계별) |
| 타임아웃 표시 | 초 단위만 | 초 + % + 남은시간 |
| 디버깅 | 어려움 | 쉬움 (상세 로그) |

---

## 📞 문의 사항

문제가 계속되거나 추가 질문이 있으면:

1. **콘솔 로그 전체 복사** (F12 → Console → 우클릭 → Save as...)
2. **SQL 쿼리 결과** (중복 베팅 확인 쿼리)
3. **문제 발생 시간** 기록
4. **스크린샷** (온라인 현황 페이지, 베팅 기록 등)

위 정보와 함께 문의하시면 빠르게 해결할 수 있습니다.

---

## ✅ 완료 체크리스트

실행 후 다음 항목을 확인하세요:

- [ ] 298번 SQL 파일 실행 완료
- [ ] 브라우저 캐시 삭제 및 새로고침
- [ ] 콘솔에 "🎯 세션 모니터링 시작" 로그 확인
- [ ] 콘솔에 "⏱️ 세션 경과시간" 로그 30초마다 확인
- [ ] SQL에서 중복 베팅 0건 확인
- [ ] 베팅 저장 시 "⏭️ 이미 DB에 존재" 로그 확인
- [ ] 4분 타임아웃 정상 동작 확인
- [ ] 세션 재활성화 정상 동작 확인

**모든 항목이 체크되면 수정 완료! 🎉**
