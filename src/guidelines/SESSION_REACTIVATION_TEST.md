# 세션 재활성화 테스트 가이드

## 🎯 목적
세션이 재활성화된 후에도 4분 타임아웃이 정상 작동하는지 확인

---

## 📋 테스트 시나리오

### 1단계: 초기 세션 생성 및 타임아웃
```
1. 사용자 로그인
2. 게임 실행 (아무 게임)
3. 베팅 1-2회 진행
4. 콘솔 확인:
   ✅ "🎯 세션 X 모니터링 시작"
   ✅ "🚀 세션 X 첫 베팅 동기화 (즉시 실행)"
   ✅ "⏱️ 세션 X 경과시간: N초"
   
5. 4분간 베팅하지 않고 대기
6. 콘솔 확인:
   ✅ "⏱️ 세션 X 4분간 베팅 없음, 종료 처리"
   ✅ "✅ 세션 X 모니터링 종료"
   
7. Supabase 확인:
   ✅ game_launch_sessions.status = 'ended'
   ✅ game_launch_sessions.ended_at = (4분 후 시간)
```

**예상 소요 시간**: 약 5분

---

### 2단계: 세션 재활성화
```
1. 다시 베팅 진행 (1회)
2. 콘솔 확인:
   ✅ "🔄 베팅 감지로 세션 재활성화: session_id=X"
   ✅ "🔔 [UserLayout] 세션 변경 감지! UPDATE"
   ✅ "🔄 [UserLayout] 세션 재활성화 감지! 모니터링 재시작"
   ✅ "🧹 [UserLayout] 기존 세션 X 모니터 정리"
   ✅ "🎯 세션 X 모니터링 시작"
   
3. Supabase 확인:
   ✅ game_launch_sessions.status = 'active'
   ✅ game_launch_sessions.ended_at = NULL
   ✅ game_launch_sessions.last_activity_at = (방금 시간)
```

**예상 소요 시간**: 즉시

---

### 3단계: 재활성화 후 타임아웃 확인 ⭐ 중요!
```
1. 베팅을 1-2회 더 진행
2. 콘솔 확인:
   ✅ "⏱️ 세션 X 경과시간: 0초" (초기화됨!)
   ✅ "📊 세션 X 베팅 내역 동기화"
   ✅ "✅ 세션 X 새 베팅 N건 업데이트"
   
3. 4분간 베팅하지 않고 대기
4. 콘솔 확인:
   ✅ "⏱️ 세션 X 경과시간: 240초"
   ✅ "⏱️ 세션 X 4분간 베팅 없음, 종료 처리"
   ✅ "✅ 세션 X 모니터링 종료"
   
5. Supabase 확인:
   ✅ game_launch_sessions.status = 'ended'
   ✅ game_launch_sessions.ended_at = (4분 후 시간)
```

**예상 소요 시간**: 약 5분

---

### 4단계: 반복 테스트
```
1. 3단계를 2-3회 반복
2. 매번 정상적으로 타임아웃 되는지 확인
3. 컴퓨터 재시작 후에도 테스트
```

**예상 소요 시간**: 약 10-15분

---

## ✅ 성공 기준

### 필수 체크리스트
- [ ] 초기 세션: 4분 후 자동 종료됨
- [ ] 재활성화 감지: "🔄 세션 재활성화 감지" 로그 출력
- [ ] 기존 모니터 정리: "🧹 기존 세션 X 모니터 정리" 로그 출력
- [ ] 새 모니터 시작: "🎯 세션 X 모니터링 시작" 로그 출력
- [ ] 타이머 초기화: "⏱️ 경과시간: 0초" 확인
- [ ] 재활성화 후 4분 타임아웃: 정상 작동
- [ ] 반복 테스트: 여러 번 재활성화 후에도 정상 작동
- [ ] 컴퓨터 재시작: 재시작 후에도 정상 작동

---

## 🚨 실패 징후

### 다음과 같은 경우 문제가 있음:

#### ❌ 타임아웃 작동 안 함
```
증상:
- 재활성화 후 4분이 지나도 세션이 ended 안 됨
- "⏱️ 경과시간" 로그가 240초를 넘어도 계속 증가
- "4분간 베팅 없음" 로그가 출력되지 않음

원인:
- lastBettingUpdateRef가 초기화되지 않음
- 기존 모니터가 정리되지 않음
- 새 모니터가 시작되지 않음

확인 방법:
console.log('lastBettingUpdateRef:', lastBettingUpdateRef.current);
console.log('sessionMonitorsRef:', sessionMonitorsRef.current);
```

#### ❌ 중복 모니터 실행
```
증상:
- "📊 베팅 내역 동기화" 로그가 30초보다 빠르게 중복 출력
- API 호출이 과도하게 발생
- 메모리 사용량 증가

원인:
- 기존 clearInterval이 실행되지 않음
- sessionMonitorsRef에 여러 인터벌이 저장됨

확인 방법:
console.log('Active monitors:', sessionMonitorsRef.current.size);
```

#### ❌ 재활성화 감지 안 됨
```
증상:
- 베팅 후에도 "🔄 세션 재활성화 감지" 로그 없음
- Supabase에서 status는 'active'로 변경되었지만 모니터링 시작 안 됨

원인:
- DB 트리거가 실행되지 않음
- Realtime 구독이 작동하지 않음

확인 방법:
1. Supabase > Database > game_launch_sessions 확인
2. Postgres Logs에서 "베팅 감지로 세션 재활성화" 검색
3. 브라우저 콘솔에서 "🔔 세션 변경 감지" 검색
```

---

## 🔍 디버깅 도구

### 콘솔에서 실행
```javascript
// 현재 활성 모니터 확인
console.log('Session Monitors:', window.sessionMonitorsRef?.current);

// lastBettingUpdate 확인
console.log('Last Betting Updates:', window.lastBettingUpdateRef?.current);

// 수동으로 세션 모니터 시작
window.startSessionMonitor(세션ID, 사용자ID);

// 수동으로 세션 종료
window.endGameSession(세션ID);
```

### Supabase에서 확인
```sql
-- 현재 active 세션 조회
SELECT id, user_id, status, launched_at, ended_at, last_activity_at
FROM game_launch_sessions
WHERE status = 'active'
ORDER BY launched_at DESC;

-- 재활성화된 세션 조회 (last_activity_at이 launched_at보다 훨씬 나중)
SELECT id, user_id, status, 
       launched_at,
       last_activity_at,
       EXTRACT(EPOCH FROM (last_activity_at - launched_at))/60 as minutes_diff
FROM game_launch_sessions
WHERE status = 'active'
  AND last_activity_at > launched_at + INTERVAL '5 minutes'
ORDER BY last_activity_at DESC;

-- 최근 베팅 기록
SELECT * FROM game_records
ORDER BY played_at DESC
LIMIT 10;
```

---

## 📊 예상 로그 흐름

### 정상 케이스
```
[초기 세션]
🎯 세션 123 모니터링 시작
🚀 세션 123 첫 베팅 동기화 (즉시 실행)
📊 세션 123 베팅 내역 동기화 (index: 0)
⏱️ 세션 123 경과시간: 0초
⏱️ 세션 123 경과시간: 30초
⏱️ 세션 123 경과시간: 240초
⏱️ 세션 123 4분간 베팅 없음, 종료 처리
✅ 세션 123 모니터링 종료

[재활성화]
🔄 베팅 감지로 세션 재활성화: session_id=123
🔔 [UserLayout] 세션 변경 감지! UPDATE
🔄 [UserLayout] 세션 재활성화 감지! 모니터링 재시작: 123
🧹 [UserLayout] 기존 세션 123 모니터 정리
🎯 세션 123 모니터링 시작
🚀 세션 123 첫 베팅 동기화 (즉시 실행)
⏱️ 세션 123 경과시간: 0초  ← 초기화됨!
⏱️ 세션 123 경과시간: 30초
⏱️ 세션 123 경과시간: 240초
⏱️ 세션 123 4분간 베팅 없음, 종료 처리
✅ 세션 123 모니터링 종료
```

---

## 🎓 결론

이 테스트를 통과하면:
- ✅ 세션 재활성화 시스템이 완벽하게 작동
- ✅ 4분 타임아웃이 항상 정상 작동
- ✅ 메모리 누수 없음
- ✅ 중복 모니터 실행 없음
- ✅ 사용자가 게임을 오래 플레이해도 안정적

실패하면:
- ❌ UserLayout.tsx의 재활성화 로직 수정 필요
- ❌ 293_auto_reactivate_session_on_betting.sql 확인 필요
- ❌ Realtime 구독 설정 확인 필요
