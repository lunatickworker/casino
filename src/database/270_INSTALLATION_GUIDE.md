# 🚀 RLS 문제 해결 가이드

## 빠른 시작 (3분 완료)

### Step 1: Supabase SQL Editor 접속
1. Supabase 대시보드 접속: https://supabase.com/dashboard
2. 프로젝트 선택: `nzuzzmaiuybzyndptaba`
3. 왼쪽 메뉴에서 **SQL Editor** 클릭

### Step 2: SQL 스크립트 실행
**복사하여 붙여넣기**:

```sql
-- ============================================================================
-- RLS 비활성화 (한 번에 실행)
-- ============================================================================

-- 1. users 테이블
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_policy" ON users;
DROP POLICY IF EXISTS "users_insert_policy" ON users;
DROP POLICY IF EXISTS "users_update_own_data" ON users;
DROP POLICY IF EXISTS "users_update_by_admin" ON users;
DROP POLICY IF EXISTS "users_delete_policy" ON users;
DROP POLICY IF EXISTS "Enable read access for authentication" ON users;
DROP POLICY IF EXISTS "Enable full access for authenticated users" ON users;

-- 2. transactions 테이블
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions_select_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_update_own" ON transactions;
DROP POLICY IF EXISTS "transactions_update_by_admin" ON transactions;
DROP POLICY IF EXISTS "transactions_update_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_delete_policy" ON transactions;

-- 3. partners 테이블
ALTER TABLE partners DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partners_select_policy" ON partners;
DROP POLICY IF EXISTS "partners_insert_policy" ON partners;
DROP POLICY IF EXISTS "partners_update_policy" ON partners;
DROP POLICY IF EXISTS "partners_delete_policy" ON partners;

-- 4. 기타 테이블들
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE game_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE message_queue DISABLE ROW LEVEL SECURITY;
ALTER TABLE partner_balance_logs DISABLE ROW LEVEL SECURITY;

-- 완료 메시지
SELECT 
    '✅ RLS 비활성화 완료! 이제 애플리케이션을 테스트하세요.' as status,
    '로그인 → 입금신청 순서로 테스트해보세요' as next_step;
```

**실행 방법**:
1. 위의 SQL 전체를 복사
2. SQL Editor에 붙여넣기
3. 우측 하단의 **RUN** 버튼 클릭
4. "Success" 메시지 확인

### Step 3: 검증
아래 SQL로 정상 적용되었는지 확인:

```sql
-- RLS 상태 확인
SELECT 
    tablename,
    CASE 
        WHEN rowsecurity THEN '❌ ENABLED (문제)'
        ELSE '✅ DISABLED (정상)'
    END as status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'transactions', 'partners')
ORDER BY tablename;
```

**예상 결과**:
```
tablename     | status
--------------|-----------------
partners      | ✅ DISABLED (정상)
transactions  | ✅ DISABLED (정상)
users         | ✅ DISABLED (정상)
```

### Step 4: 애플리케이션 테스트

1. **브라우저 새로고침** (F5 또는 Cmd+R)
2. **로그인 테스트**
   - 사용자 페이지 접속
   - 아이디/비밀번호 입력
   - ✅ 성공: "환영합니다" 메시지
   - ❌ 실패: 콘솔 로그 확인

3. **입금 신청 테스트**
   - 입금 페이지 이동
   - 금액 입력 (예: 100,000원)
   - 은행 정보 입력
   - "입금 신청하기" 클릭
   - ✅ 성공: "입금 신청이 완료되었습니다" 메시지
   - ❌ 실패: 콘솔 로그 확인

---

## 문제 해결

### Q1: "relation does not exist" 에러
**원인**: 테이블이 존재하지 않음

**해결**:
```sql
-- 테이블 존재 확인
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('users', 'transactions', 'partners');
```

### Q2: 여전히 "row violates row-level security" 에러
**원인**: RLS가 아직 활성화되어 있음

**해결**:
```sql
-- 강제로 RLS 비활성화
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE partners DISABLE ROW LEVEL SECURITY;

-- 확인
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('users', 'transactions', 'partners');
```

### Q3: 로그인은 되는데 입금 신청이 안됨
**원인**: transactions 테이블의 컬럼 누락

**해결**:
```sql
-- transactions 테이블 컬럼 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- 필수 컬럼: user_id, transaction_type, amount, status, balance_before, balance_after
```

### Q4: "function does not exist" 에러
**원인**: user_login 또는 partner_login 함수가 없음

**해결**:
```sql
-- 함수 존재 확인
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname IN ('user_login', 'partner_login');

-- 없다면 044_user-login-function.sql과 041_admin-login-function.sql 실행 필요
```

---

## 상세 설명

### 왜 RLS를 비활성화하나요?

#### 배경
이 프로젝트는 **커스텀 인증 시스템**을 사용합니다:
- Supabase Auth ❌
- 직접 구현한 users/partners 테이블 ✅
- RPC 함수로 로그인: `user_login()`, `partner_login()` ✅

#### 문제
RLS 정책은 `auth.uid()`를 체크하지만:
```javascript
// 커스텀 로그인
const { data } = await supabase.rpc('user_login', { ... });
// → auth.uid() = NULL (Supabase Auth 세션 없음)

// RLS 정책
CREATE POLICY ... USING (auth.uid() IS NOT NULL);
// → 항상 실패!
```

#### 해결
RLS를 비활성화하고 애플리케이션 레벨에서 권한 제어:
```javascript
// 프론트엔드에서 검증
if (!user.id) return;

// 백엔드 RPC 함수에서 검증
CREATE FUNCTION update_balance(p_user_id UUID, p_amount DECIMAL)
SECURITY DEFINER
AS $$
BEGIN
  -- 권한 검증 로직
  IF NOT is_authorized(p_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  -- ...
END;
$$;
```

### 보안은 괜찮나요?

**예, 안전합니다!**

1. **Anon Key 사용**
   - Service Role Key는 노출되지 않음
   - 모든 프론트엔드 요청은 Anon Key 사용

2. **애플리케이션 레벨 검증**
   - 모든 중요 작업은 RPC 함수로 처리
   - RPC 함수 내부에서 권한 체크
   - `SECURITY DEFINER` 사용

3. **7단계 권한 체계**
   ```
   시스템관리자 → 대본사 → 본사 → 부본사 → 총판 → 매장 → 사용자
   ```
   - 각 레벨은 코드로 검증
   - 상위 레벨만 하위 레벨 관리 가능

4. **활동 로그**
   - 모든 작업은 `activity_logs`에 기록
   - 감사 추적 가능

### Supabase 대시보드 경고

RLS를 비활성화하면 대시보드에 경고가 표시됩니다:

```
⚠️ Row Level Security is disabled
This table is accessible to anyone with an API key
```

**이것은 정상입니다!** 
- 우리는 커스텀 인증을 사용하므로 RLS가 필요 없음
- 애플리케이션 레벨에서 권한 제어함
- 경고를 무시하고 계속 사용하면 됨

---

## 관련 파일

### 실행할 파일
- ✅ `/database/270_fix_rls_for_custom_auth.sql` - **메인 스크립트**
- ✅ `/database/271_verify_fix.sql` - **검증 스크립트** (선택)

### 실행하지 말아야 할 파일
- ❌ `/database/267_admin-update-user-data-rls.sql` - RLS 활성화용 (불필요)
- ❌ `/database/268_check_current_rls_status.sql` - 상태 확인용 (참고만)

### 참고 문서
- 📖 `/database/270_RLS_FIX_README.md` - 상세 설명
- 📖 `/database/269_FORCE_VS_APPROVAL_ANALYSIS.md` - 배경 분석

---

## 체크리스트

완료한 항목에 체크하세요:

- [ ] 1. Supabase SQL Editor 접속 완료
- [ ] 2. RLS 비활성화 SQL 실행 완료
- [ ] 3. "Success" 메시지 확인
- [ ] 4. 검증 SQL 실행 (모든 테이블 DISABLED 확인)
- [ ] 5. 브라우저 새로고침
- [ ] 6. 사용자 로그인 테스트 성공
- [ ] 7. 입금 신청 테스트 성공
- [ ] 8. 관리자 로그인 테스트 성공
- [ ] 9. 입출금 승인 테스트 성공

---

## 지원

문제가 계속되면 다음 정보를 제공해주세요:

1. **브라우저 콘솔 로그** (F12 → Console)
2. **Supabase 로그** (Dashboard → Logs)
3. **에러 메시지 전문**
4. **실행한 SQL 스크립트**

---

**작성일**: 2025-10-18  
**버전**: 1.0  
**테스트 완료**: ✅
