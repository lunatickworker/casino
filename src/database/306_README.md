# 306. 오래된 세션 자동 정리 시스템

## 📋 개요

DB에 4시간 이상 경과한 오래된 세션들이 계속 쌓이는 문제를 해결하기 위한 자동 정리 시스템입니다.

### 문제 상황
- `user_sessions` 테이블에 오래된 비활성 세션 누적
- `game_launch_sessions` 테이블에 ended 상태의 오래된 세션 누적
- 메모리 및 성능 저하 우려

### 해결 방안
1. **트리거 기반 자동 정리**: 새 세션 생성 시 10% 확률로 오래된 세션 삭제
2. **pg_cron 스케줄링**: 4시간마다 자동 정리 (가능한 경우)
3. **수동 실행 함수**: 필요 시 언제든지 수동으로 정리 가능

---

## 🚀 설치 방법

### 1. SQL 파일 실행

Supabase SQL Editor에서 실행:

```bash
/database/306_auto_cleanup_sessions.sql
```

### 2. 설치 확인

실행 후 다음 로그를 확인:

```
✅ 306. 오래된 세션 자동 정리 시스템 완료
```

---

## 📊 정리 기준

### user_sessions 테이블
- **조건**: `is_active = false` AND `logout_at < NOW() - 4시간`
- **설명**: 로그아웃한 지 4시간 이상 경과한 세션 삭제

### game_launch_sessions 테이블
- **조건**: `status = 'ended'` AND `ended_at < NOW() - 4시간`
- **설명**: 종료된 지 4시간 이상 경과한 게임 세션 삭제

---

## 🔧 사용 방법

### 1. 자동 정리 (권장)

**설치 후 자동으로 작동합니다.**

- 새로운 세션이 생성될 때마다 10% 확률로 자동 정리
- pg_cron이 활성화된 경우 4시간마다 자동 정리

### 2. 수동 정리

필요 시 언제든지 수동으로 정리 가능:

```sql
-- 전체 세션 정리 (user + game)
SELECT * FROM cleanup_all_old_sessions();

-- user_sessions만 정리
SELECT cleanup_old_user_sessions();

-- game_launch_sessions만 정리
SELECT cleanup_old_game_sessions();
```

### 3. 정리 결과 확인

```sql
SELECT * FROM cleanup_all_old_sessions();
```

**결과 예시:**
```
user_sessions_deleted | game_sessions_deleted | total_deleted
----------------------|----------------------|---------------
         145          |         2029         |      2174
```

---

## ⚙️ 작동 원리

### 1. 트리거 기반 자동 정리

```sql
-- user_sessions INSERT 시
CREATE TRIGGER auto_cleanup_user_sessions_trigger
    AFTER INSERT ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_cleanup_user_sessions();

-- game_launch_sessions INSERT 시
CREATE TRIGGER auto_cleanup_game_sessions_trigger
    AFTER INSERT ON game_launch_sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_cleanup_game_sessions();
```

- 새 세션 생성 시 10% 확률로 `cleanup_old_*_sessions()` 실행
- 매번 실행하면 성능 저하 우려 → 확률적 실행

### 2. pg_cron 스케줄링

```sql
-- 4시간마다 실행 (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
SELECT cron.schedule(
    'cleanup_sessions_every_4_hours',
    '0 */4 * * *',
    'SELECT cleanup_all_old_sessions();'
);
```

- Supabase에서 pg_cron extension이 활성화된 경우에만 작동
- 프리 티어에서는 pg_cron을 사용할 수 없으므로 트리거 기반으로 대체

---

## 📝 함수 목록

### 1. `cleanup_old_user_sessions()`
```sql
SELECT cleanup_old_user_sessions();
```
- **반환**: 삭제된 user_sessions 개수
- **조건**: logout_at < NOW() - 4시간

### 2. `cleanup_old_game_sessions()`
```sql
SELECT cleanup_old_game_sessions();
```
- **반환**: 삭제된 game_launch_sessions 개수
- **조건**: ended_at < NOW() - 4시간

### 3. `cleanup_all_old_sessions()`
```sql
SELECT * FROM cleanup_all_old_sessions();
```
- **반환**: 
  - `user_sessions_deleted`: 삭제된 user_sessions 개수
  - `game_sessions_deleted`: 삭제된 game_launch_sessions 개수
  - `total_deleted`: 총 삭제 개수

---

## 🔍 모니터링

### 오래된 세션 개수 확인

```sql
-- user_sessions (4시간 이상 경과)
SELECT COUNT(*) AS old_user_sessions
FROM user_sessions
WHERE is_active = false
AND logout_at IS NOT NULL
AND logout_at < NOW() - INTERVAL '4 hours';

-- game_launch_sessions (4시간 이상 경과)
SELECT COUNT(*) AS old_game_sessions
FROM game_launch_sessions
WHERE status = 'ended'
AND ended_at IS NOT NULL
AND ended_at < NOW() - INTERVAL '4 hours';
```

### 전체 세션 통계

```sql
SELECT 
    (SELECT COUNT(*) FROM user_sessions WHERE is_active = true) AS active_user_sessions,
    (SELECT COUNT(*) FROM user_sessions WHERE is_active = false) AS inactive_user_sessions,
    (SELECT COUNT(*) FROM game_launch_sessions WHERE status = 'active') AS active_game_sessions,
    (SELECT COUNT(*) FROM game_launch_sessions WHERE status = 'ended') AS ended_game_sessions;
```

---

## ⚠️ 주의사항

### 1. 트리거 확률 조정

현재 10% 확률로 설정되어 있습니다. 필요 시 조정 가능:

```sql
-- 확률을 20%로 변경 (0.2)
CREATE OR REPLACE FUNCTION trigger_cleanup_user_sessions() RETURNS TRIGGER AS $$
BEGIN
    IF random() < 0.2 THEN  -- 10% → 20%
        PERFORM cleanup_old_user_sessions();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2. pg_cron 활성화

Supabase 프로젝트에서 pg_cron을 활성화하려면:

1. Supabase Dashboard → Database → Extensions
2. `pg_cron` 검색 후 활성화
3. 306번 SQL 재실행

### 3. 수동 정리 권장 시기

- **대량 세션 삭제가 필요한 경우**: 수동으로 `cleanup_all_old_sessions()` 실행
- **정기 점검 시**: 주기적으로 오래된 세션 개수 확인 후 필요 시 수동 정리

---

## 🎯 기대 효과

### 1. DB 성능 개선
- 불필요한 세션 레코드 삭제로 테이블 크기 감소
- 쿼리 성능 향상

### 2. 메모리 최적화
- 세션 데이터 누적 방지
- 실시간 구독(Realtime) 성능 개선

### 3. 유지보수 편의성
- 자동 정리로 수동 관리 불필요
- 필요 시 수동 정리 가능

---

## 📌 체크리스트

설치 완료 후 확인:

- [ ] SQL 파일 실행 완료
- [ ] 로그에서 "✅ 306. 오래된 세션 자동 정리 시스템 완료" 확인
- [ ] 기존 오래된 세션 삭제 개수 확인
- [ ] 트리거 작동 여부 테스트 (새 세션 생성 후 확인)
- [ ] pg_cron 활성화 여부 확인 (선택)

---

## 🔗 관련 파일

- **306_auto_cleanup_sessions.sql**: 메인 SQL 파일
- **287_enhanced_session_management.sql**: 세션 관리 시스템 기본
- **263_complete_session_cleanup.sql**: 이전 세션 정리 시스템

---

## 📞 문제 해결

### Q1. 트리거가 작동하지 않는 것 같아요

**A1.** 트리거는 10% 확률로 실행되므로 즉시 확인이 어렵습니다. 수동으로 테스트:

```sql
-- 트리거 함수 직접 실행
SELECT trigger_cleanup_user_sessions();
SELECT trigger_cleanup_game_sessions();
```

### Q2. pg_cron 스케줄이 작동하지 않아요

**A2.** pg_cron extension이 활성화되어 있는지 확인:

```sql
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
```

결과가 없으면 extension을 활성화해야 합니다.

### Q3. 오래된 세션이 여전히 많이 남아있어요

**A3.** 수동으로 즉시 정리:

```sql
SELECT * FROM cleanup_all_old_sessions();
```

---

## 📊 예상 시나리오

### 시나리오 1: 일반적인 사용
- 매일 100명의 사용자 로그인
- 평균 게임 세션 200개 생성
- 트리거로 자동 정리 → 4시간 후 세션 삭제

### 시나리오 2: 대량 사용자 유입
- 이벤트 기간 동안 1000명 로그인
- 게임 세션 5000개 생성
- pg_cron으로 4시간마다 자동 정리
- 필요 시 수동 정리

---

## ✅ 결론

이제 더 이상 오래된 세션이 DB에 쌓이지 않습니다!

- **자동 정리**: 트리거 + pg_cron (가능한 경우)
- **수동 정리**: `cleanup_all_old_sessions()` 함수
- **모니터링**: 오래된 세션 개수 확인 쿼리

문제가 지속되면 수동으로 정리하거나 트리거 확률을 높이세요.
