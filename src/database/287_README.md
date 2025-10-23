# 287. 세션 관리 시스템 개선

## 적용 날짜
2025-10-19

## 목적
게임 세션 관리 시스템을 개선하여 다음 요구사항을 충족:
1. 30초 내 중복 세션 생성 방지
2. 4시간 이내 재활성화 (기존 30분에서 확장)
3. ended 세션 4시간 후 자동 삭제
4. played_at 감시는 기존 game_records 기반 유지

## 변경 사항

### 1. save_game_launch_session 함수 수정
- **30초 중복 방지**: 같은 사용자가 30초 이내 새 세션 생성 시도 시 "잠시 후에 다시 시도하세요" 에러 반환
- **4시간 재활성화**: ended 세션 재활성화 기간을 30분 → 4시간으로 연장

### 2. reactivate_session_on_betting 함수 수정
- **4시간 재활성화**: 베팅 감지 시 ended 세션 재활성화 기간을 30분 → 4시간으로 연장

### 3. cleanup_old_ended_sessions 함수 추가
- **자동 삭제**: ended_at 기준 4시간 경과한 ended 세션 자동 삭제
- **주기 실행**: 1시간마다 실행 권장

## 시스템 동작 흐름

### 게임 실행 시
```
1. 사용자가 게임 실행 요청
2. save_game_launch_session() 호출
3. 30초 이내 중복 확인 → 중복이면 에러 반환
4. 4시간 이내 ended 세션 찾기 → 있으면 재활성화
5. 없으면 새 세션 생성
6. 4분 타이머 시작 (session_timers 테이블)
```

### 베팅 발생 시
```
1. game_records에 베팅 기록 저장 (played_at)
2. reactivate_session_on_betting() 호출
3. active 세션 있음 → 타이머 재설정
4. active 세션 없음 → 4시간 이내 ended 세션 재활성화
5. 타이머 4분으로 재설정
```

### 4분 무활동 시
```
1. execute_scheduled_session_ends() 실행 (1분마다)
2. scheduled_end_at <= NOW() 인 타이머 확인
3. last_betting_at < NOW() - 4분 재확인
4. 세션 status='ended', ended_at=NOW() 업데이트
5. 타이머 is_cancelled=TRUE 처리
```

### 4시간 후 삭제
```
1. cleanup_old_ended_sessions() 실행 (1시간마다)
2. ended_at < NOW() - 4시간 세션 찾기
3. game_launch_sessions에서 삭제
4. session_timers는 CASCADE로 자동 삭제
```

## 주기적 실행 함수

### 1. execute_scheduled_session_ends()
- **실행 주기**: 1분마다
- **목적**: 4분 무활동 세션 자동 종료
- **구현 위치**: `/components/admin/OnlineUsers.tsx`

### 2. cleanup_old_ended_sessions()
- **실행 주기**: 1시간마다
- **목적**: 4시간 경과한 ended 세션 삭제
- **구현 위치**: `/components/admin/OnlineUsers.tsx`

## 에러 처리

### 30초 중복 방지 에러
```typescript
// SQL 함수에서 발생
RAISE EXCEPTION '잠시 후에 다시 시도하세요. (30초 이내 중복 요청)';

// 프론트엔드 처리 (gameApi.ts)
if (sessionError.message && sessionError.message.includes('30초')) {
  return {
    success: false,
    error: sessionError.message,
    sessionId: null
  };
}
```

## 테스트 시나리오

### 1. 30초 중복 방지
```sql
-- 1. 게임 실행
SELECT save_game_launch_session(
  '사용자UUID'::UUID,
  게임ID::BIGINT,
  'opcode',
  'http://game.url',
  'token',
  1000.00
);

-- 2. 즉시 다시 실행 (에러 발생)
SELECT save_game_launch_session(
  '사용자UUID'::UUID,
  게임ID::BIGINT,
  'opcode',
  'http://game.url',
  'token',
  1000.00
);
-- 결과: ERROR: 잠시 후에 다시 시도하세요. (30초 이내 중복 요청)

-- 3. 30초 후 재시도 (성공)
SELECT pg_sleep(30);
SELECT save_game_launch_session(...);
```

### 2. 4시간 재활성화
```sql
-- 1. 세션 생성
SELECT save_game_launch_session(...);

-- 2. 세션 종료
UPDATE game_launch_sessions 
SET status = 'ended', ended_at = NOW() 
WHERE user_id = '사용자UUID';

-- 3. 3시간 50분 후 베팅 발생 (재활성화 성공)
SELECT reactivate_session_on_betting('사용자UUID'::UUID, 게임ID::BIGINT);
-- 결과: TRUE

-- 4. 4시간 10분 후 베팅 발생 (재활성화 실패)
SELECT reactivate_session_on_betting('사용자UUID'::UUID, 게임ID::BIGINT);
-- 결과: FALSE
```

### 3. 자동 삭제
```sql
-- 1. 오래된 ended 세션 생성 (테스트용)
UPDATE game_launch_sessions 
SET 
  status = 'ended',
  ended_at = NOW() - INTERVAL '5 hours'
WHERE id = 테스트세션ID;

-- 2. 삭제 함수 실행
SELECT cleanup_old_ended_sessions();
-- 결과: 삭제된 세션 수 반환

-- 3. 확인
SELECT * FROM game_launch_sessions WHERE id = 테스트세션ID;
-- 결과: 레코드 없음
```

## 모니터링

### 세션 현황 확인
```sql
SELECT 
  status,
  COUNT(*) as count,
  MIN(launched_at) as oldest_launched,
  MAX(launched_at) as newest_launched
FROM game_launch_sessions
GROUP BY status;
```

### 타이머 현황 확인
```sql
SELECT 
  is_cancelled,
  COUNT(*) as count,
  MIN(scheduled_end_at) as next_end,
  MAX(last_betting_at) as last_activity
FROM session_timers
GROUP BY is_cancelled;
```

### 4시간 경과 세션 확인
```sql
SELECT 
  COUNT(*) as old_sessions,
  MIN(ended_at) as oldest_ended
FROM game_launch_sessions
WHERE status = 'ended'
AND ended_at < NOW() - INTERVAL '4 hours';
```

## 롤백 방법

기존 265 버전으로 롤백하려면:
```sql
-- 1. 287 버전 함수 제거
DROP FUNCTION IF EXISTS cleanup_old_ended_sessions();

-- 2. 265 버전 재실행
\i 265_event_based_session_system.sql
```

## 참고 사항

- RPC 함수를 사용하고 있으며, 필요에 따라 직접 SELECT 쿼리로 변경 가능
- WebSocket은 실시간 세션 상태 업데이트에만 사용
- Heartbeat는 사용하지 않음 (이벤트 기반 시스템)
- played_at 감시는 game_records 테이블의 베팅 데이터 기반
