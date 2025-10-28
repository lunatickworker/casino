# 데이터베이스 SQL 파일 설치 순서

## ⚠️ 중요 안내

이 문서는 전체 SQL 파일의 설치 순서를 정리한 것입니다.
**신규 설치 시 순서대로 실행**하고, **기존 시스템은 최신 파일만 실행**하세요.

## 🚨 최신 긴급 패치 (2025-01-21)

**베팅 중복 및 세션 모니터 로그 문제 해결:**
```
298_fix_duplicate_betting_and_session_monitor.sql  ⚡ 필수 실행!
```

**문제:**
- 베팅 데이터가 DB에 두 개씩 저장됨
- "세션 XXX 경과시간:YY초" 로그가 콘솔에 표시되지 않음

**해결:**
1. 위 SQL 파일을 Supabase SQL Editor에서 실행
2. 페이지 새로고침 (캐시 삭제)
3. 상세한 가이드: `300_QUICK_FIX_GUIDE.md` 참고
4. 테스트 방법: `299_TESTING_GUIDE_DUPLICATE_FIX.md` 참고

---

## 📋 카테고리별 분류

### 1️⃣ 기본 스키마 (필수)
```
001_database-schema.sql             - 메인 스키마 (partners, users, transactions 등)
002_settlement-schema-updates.sql   - 정산 스키마
003_additional-schema-updates.sql   - 추가 스키마
```

### 2️⃣ 게임 시스템
```
005_game-management-additional-schema.sql
006_realtime-integration-schema.sql
007_game-management-schema-updates.sql
012_schema-casino-lobby-games-seed.sql - 카지노 게임 데이터
013_schema-game-providers-seed.sql     - 게임 제공사 데이터
014_schema-add-updated-at-to-game-providers.sql
019_user-games-schema-fix.sql
030_game-provider-logos-update.sql
050_enhanced-game-system.sql
053_add-missing-games-columns.sql
055_add-partner-id-to-game-tables.sql
```

### 3️⃣ 사용자 페이지
```
018_user-page-schema-safe.sql       - 사용자 페이지 스키마 (테이블만)
020_user-opcode-function.sql
023_user-opcode-balance-functions.sql
029_user-mypage-functions.sql       - 내정보 페이지 함수 (최신)
044_user-login-function.sql
045_user-additional-functions.sql   - 사용자 함수들 (최신)
062_enhance-user-visible-games-function.sql
065_user-registration-schema.sql
```

### 4️⃣ 관리자 페이지
```
041_admin-login-function.sql
042_rls-policies-for-login.sql
210_ADD_GET_PARTNER_MENUS_FUNCTION.sql
211_get-hierarchical-partners-function.sql
212_update-menu-name.sql
213_create-partner-menu-permissions.sql
214_URGENT_FIX_MENU_PERMISSIONS.sql
```

### 5️⃣ 베팅 관리
```
011_schema-betting-management-addition.sql
015_schema-betting-management-complete.sql
068_betting-history-functions.sql
082_save-betting-from-api.sql       - 베팅 내역 저장 함수
083_add-game-records-updated-at.sql
084_auto-sync-betting-on-game-end.sql
089_complete-betting-sync-system.sql
133_add-betting-auto-sync.sql
135_auto-update-user-balance-from-betting.sql - 베팅 시 잔고 자동 업데이트
140_game-records-direct-query.sql
182_add-game-title-provider-name.sql
```

### 6️⃣ 트랜잭션 관리
```
069_transactions-rls-policies.sql
075_complete-transactions-fix.sql
105_transaction-approval-system.sql
204_add-admin-transaction-types.sql
251_realtime_balance_update_trigger.sql - 입출금 시 잔고 자동 업데이트 ⭐
255_partner_balance_immediate_update.sql - 파트너 잔고 자동 업데이트 ⭐
```

### 7️⃣ 실시간 시스템
```
098_realtime-balance-sync-system.sql
099_realtime-game-monitor-functions.sql
115_realtime-overview-functions.sql
121_integrate-heartbeat-with-betting.sql
185_remove-heartbeat-event-based.sql    - Heartbeat 제거 ⭐
188_betting-based-session-activation.sql - 베팅 기반 세션 ⭐
189_enhance-online-users-display.sql
190_setup-automatic-session-management.sql
```

### 8️⃣ 커뮤니케이션
```
016_communication-schema-addition.sql
017_banner-management-schema.sql
067_message-queue-system.sql
```

### 9️⃣ 통계 및 분석
```
104_add-point-summary-function.sql
113_user-pattern-analysis-functions.sql
245_dashboard_realtime_stats.sql
247_fix_dashboard_include_admin_transactions.sql
248_fix_dashboard_data_zero.sql
249_debug_and_fix_dashboard.sql
250_fix_dashboard_complete.sql
252_fix_dashboard_admin_transactions.sql
```

### 🔟 기타 시스템
```
022_final-system-optimization-safe.sql
024_smcdev11-user-creation.sql
026_create-user-with-api-function.sql
032_complete-management-hierarchy-fix.sql
036_organization-game-status-management.sql
037_add-missing-columns.sql
039_update-smcdev11-opcode.sql
043_add-missing-uesrs-colunms.sql
059_sync-api-configs.sql
061_comprehensive-system-review.sql
085_user-sync-and-reconciliation.sql
086_add-user-sync-columns.sql
101_add-session-id-column.sql
106_user-deletion-system.sql
112_simple-blacklist-system.sql
139_ensure-system-admin-api-config.sql
153_unify-to-referrer-id.sql          - referrer_id 통일 ⭐
158_comprehensive-rls-audit-and-fix.sql
163_rename-external-username-to-username.sql
202_add-suspended-status-and-login-check.sql
203_partner-balance-logs.sql
239_add_balance_sync_system.sql
243_complete_balance_trigger_cleanup.sql
253_partner_balance_auto_update_trigger.sql
254_partner_balance_realtime_notification.sql
```

### 1️⃣1️⃣ 최신 정리 파일 (⭐ 필수)
```
256_CLEANUP_DEPRECATED_FUNCTIONS.sql      - 중복 함수/테이블 정리 ⭐
257_UPDATE_029_FUNCTIONS.sql              - 029 함수 최신화 ⭐
270_fix_rls_for_custom_auth.sql           - RLS 비활성화 (커스텀 인증용) ⭐⭐⭐
271_verify_fix.sql                        - RLS 수정 검증 (선택)
272_fix_balance_trigger_for_update.sql    - Users Balance 트리거 수정 ⭐⭐⭐
273_test_balance_trigger.sql              - Users Balance 트리거 테스트 (선택)
276_add_user_approval_partner_balance.sql - 사용자 승인 시 관리자 보유금 ⭐⭐⭐
277_fix_balance_update_session_check.sql  - 베팅 업데이트 Session 체크 ⭐⭐⭐ (최신, 보안!)
286_enforce_head_office_balance_limit.sql - 관리자 보유금 초과 방지 ⭐⭐⭐ (필수, 보안!)
289_fix_session_and_balance_update.sql    - 세션 활성화 및 타이머 수정 ⭐⭐⭐ (필수!)
290_disable_game_records_rls.sql          - game_records RLS 비활성화 ⭐⭐⭐ (필수!)
291_fix_balance_before_calculation.sql    - balance_before 계산 오류 수정 ⭐⭐⭐ (필수!)
311_consolidate_session_management.sql    - session_timers 통합 제거 ⭐⭐⭐ (필수, 최신!)
```

### ❌ 사용하지 않는 파일
```
258_unified_balance_realtime_system.sql  - INSERT만 처리 (272로 대체됨)
267_admin-update-user-data-rls.sql       - RLS 활성화용 (Supabase Auth 사용 시에만)
268_check_current_rls_status.sql         - RLS 상태 확인 (참고용)
274_partner_balance_on_user_approval.sql - 복잡한 버전 (276으로 대체됨)
275_test_partner_balance_update.sql      - 274용 테스트 (불필요)

---

## 🚀 신규 설치 시 권장 순서

### Phase 1: 기본 스키마 (필수)
```bash
001_database-schema.sql
002_settlement-schema-updates.sql
003_additional-schema-updates.sql
037_add-missing-columns.sql
043_add-missing-uesrs-colunms.sql
153_unify-to-referrer-id.sql
```

### Phase 2: 게임 시스템
```bash
005_game-management-additional-schema.sql
013_game-providers-seed.sql
018_user-page-schema-safe.sql
050_enhanced-game-system.sql
055_add-partner-id-to-game-tables.sql
```

### Phase 3: 사용자/관리자
```bash
020_user-opcode-function.sql
023_user-opcode-balance-functions.sql
041_admin-login-function.sql
042_rls-policies-for-login.sql
044_user-login-function.sql
045_user-additional-functions.sql
029_user-mypage-functions.sql
```

### Phase 4: 트랜잭션 및 베팅
```bash
075_complete-transactions-fix.sql
082_save-betting-from-api.sql
135_auto-update-user-balance-from-betting.sql
251_realtime_balance_update_trigger.sql
255_partner_balance_immediate_update.sql
```

### Phase 5: 실시간 시스템
```bash
185_remove-heartbeat-event-based.sql
188_betting-based-session-activation.sql
190_setup-automatic-session-management.sql
```

### Phase 6: 메뉴 및 권한
```bash
210_ADD_GET_PARTNER_MENUS_FUNCTION.sql
211_get-hierarchical-partners-function.sql
213_create-partner-menu-permissions.sql
214_URGENT_FIX_MENU_PERMISSIONS.sql
```

### Phase 7: 최종 정리 (⭐ 필수)
```bash
256_CLEANUP_DEPRECATED_FUNCTIONS.sql
257_UPDATE_029_FUNCTIONS.sql
270_fix_rls_for_custom_auth.sql           # RLS 비활성화 (필수!)
271_verify_fix.sql                        # RLS 검증 (선택)
272_fix_balance_trigger_for_update.sql    # Users Balance 트리거 (필수!)
273_test_balance_trigger.sql              # Users Balance 테스트 (선택)
276_add_user_approval_partner_balance.sql # Partners Balance 케이스 추가 (필수!)
277_fix_balance_update_session_check.sql  # 베팅 업데이트 Session 체크 (필수, 보안!)
286_enforce_head_office_balance_limit.sql # 관리자 보유금 초과 방지 (필수, 보안!)
289_fix_session_and_balance_update.sql    # 세션 활성화 및 타이머 수정 (필수!)
290_disable_game_records_rls.sql          # game_records RLS 비활성화 (필수!)
291_fix_balance_before_calculation.sql    # balance_before 계산 오류 수정 (필수!)
292_update_online_balance_from_betting.sql # 온라인 현황 보유금 표시 (필수!)
293_auto_reactivate_session_on_betting.sql # 세션 자동 재활성화 (필수!)
294_add_pgcrypto_extension.sql            # pgcrypto Extension (필수!)
295_fix_partner_login.sql                 # partner_login 함수 수정 (필수!)
311_consolidate_session_management.sql    # session_timers 통합 제거 (필수, 최신!)
```

---

## ⚠️ 삭제된 파일 (사용 금지)

```
021_user-page-schema-safe.sql - 018과 중복 (삭제됨)
```

---

## 💡 Guidelines 준수 사항

1. **RPC 함수 최소화**: 꼭 필요한 경우만 사용 (비밀번호 검증 등)
2. **직접 SELECT 사용**: 조회는 프론트엔드에서 직접 쿼리
3. **트리거 자동화**: 잔고 업데이트는 트리거로 자동 처리
4. **Heartbeat 사용 금지**: 이벤트 발생 시 업데이트
5. **리소스 재사용**: 중복 함수/테이블 제거

---

## 📌 주요 변경 사항

### ✅ 잔고 업데이트 자동화
- **사용자**: 251_realtime_balance_update_trigger.sql (transactions INSERT 시 자동)
- **파트너**: 255_partner_balance_immediate_update.sql (transactions INSERT 시 자동)
- **베팅**: 135_auto-update-user-balance-from-betting.sql (API 응답 파싱)

### ✅ 세션 관리 자동화
- 185_remove-heartbeat-event-based.sql (Heartbeat 제거)
- 188_betting-based-session-activation.sql (베팅 발생 시 세션 활성화)
- 190_setup-automatic-session-management.sql (자동 정리)

### ✅ 중복 제거
- 256_CLEANUP_DEPRECATED_FUNCTIONS.sql (중복 함수/테이블 삭제)
- 257_UPDATE_029_FUNCTIONS.sql (029 함수 최신화)

---

## 🔍 문제 발생 시

1. **파라미터 이름 오류**: DROP FUNCTION 후 재생성
2. **테이블 없음**: 001_database-schema.sql 먼저 실행
3. **권한 오류 (RLS)**: 270_fix_rls_for_custom_auth.sql 실행 ⭐
4. **로그인 실패**: 270_fix_rls_for_custom_auth.sql 실행 ⭐
5. **입금/출금 실패**: 270_fix_rls_for_custom_auth.sql 실행 ⭐
6. **중복 오류**: 256_CLEANUP_DEPRECATED_FUNCTIONS.sql 실행

---

## 🆘 긴급 수정 가이드

### 1️⃣ 로그인 실패 또는 입금 신청 실패 시

**증상**:
```
로그인 실패: null
❌ 입금 신청 오류: new row violates row-level security policy
```

**해결**:
1. `/database/270_INSTALLATION_GUIDE.md` 파일 열기
2. "빠른 시작" 섹션의 SQL 복사
3. Supabase SQL Editor에서 실행
4. 브라우저 새로고침 후 재테스트

**상세 문서**: `/database/270_RLS_FIX_README.md`

---

### 2️⃣ 입출금 승인 시 users balance 업데이트 안됨

**증상**:
```
✅ transactions 업데이트 로그 있음
✅ 통계 업데이트 로그 있음
❌ users balance 업데이트 로그 없음  <-- 문제!
```

**해결**:
1. `/database/272_fix_balance_trigger_for_update.sql` 실행
2. `/database/273_test_balance_trigger.sql` 실행 (검증)
3. 입출금 승인 재테스트
4. Postgres Logs에서 "트리거" 검색

**상세 문서**: `/database/272_BALANCE_UPDATE_FIX_GUIDE.md`

---

### 3️⃣ 입출금 승인 시 관리자 보유금 업데이트 안됨

**증상**:
```
✅ 관리자 강제 입출금: 관리자 잔고 업데이트됨
✅ 사용자 잔고 업데이트됨
❌ 사용자 입금 승인 시: 관리자 잔고 업데이트 안됨  <-- 문제!
```

**해결**:
1. `users.referrer_id` 설정 확인
2. `/database/276_add_user_approval_partner_balance.sql` 실행
3. 입출금 승인 재테스트
4. partners.balance 변동 확인

**가이드**: `/database/276_SIMPLE_GUIDE.md` (간단 버전)

---

### 4️⃣ 베팅 기록 업데이트 시 session 없는 사용자 잔고 변경됨 (보안!)

**증상**:
```
⚠️ session이 ended 또는 없는 사용자의 잔고가 변경됨
⚠️ 게임 종료 후에도 잔고가 업데이트됨
```

**해결**:
1. `/database/277_fix_balance_update_session_check.sql` 실행
2. `/database/277_TEST_SESSION_CHECK.sql` 실행 (검증)
3. 테스트 2 (No Active Session) 성공 확인 필수
4. Postgres Logs에서 `[No Active Session]` 확인

**가이드**: `/database/277_SESSION_CHECK_GUIDE.md` (보안 필수)

---

### 5️⃣ 관리자 보유금 초과하여 입금 승인됨 (보안!)

**증상**:
```
⚠️ 매장 A 보유금: 100,000원
⚠️ 사용자 입금 승인: 1,000,000원
✅ 승인 완료됨 (문제!)
⚠️ 매장 A 보유금: -900,000원 (음수!)
```

**해결**:
1. `/database/286_enforce_head_office_balance_limit.sql` 실행
2. 관리자 보유금 부족 상태에서 입금 승인 테스트
3. "관리자 보유금이 부족합니다" 오류 발생 확인
4. Postgres Logs에서 `[보유금 검증]` 로그 확인

**가이드**: `/database/286_README.md` (관리자 보유금 초과 방지)

---

### 6️⃣ balance_before가 0으로 저장됨 (데이터 정확도!)

**증상**:
```
⚠️ game_records 테이블의 balance_before가 모두 0으로 저장됨
✅ balance_after는 정상적으로 저장됨
⚠️ 베팅 전후 잔고 추적 불가능
```

**해결**:
1. `/database/291_fix_balance_before_calculation.sql` 실행
2. 기존 데이터 재계산 (최근 10,000건 자동)
3. game_records 조회하여 balance_before 정상 확인
4. Postgres Logs에서 `balance_before 역산` 로그 확인

**가이드**: `/database/291_README.md` (balance_before 계산 수정)

---

---

### 7️⃣ session_timers 테이블 통합 제거 (최신!)

**증상**:
```
⚠️ session_timers와 game_launch_sessions 테이블 중복
⚠️ 복잡한 JOIN 쿼리
⚠️ 데이터 동기화 문제 가능성
```

**해결**:
1. `/database/311_consolidate_session_management.sql` 실행
2. session_timers 테이블 완전 삭제
3. game_launch_sessions만 사용하는 간소화된 세션 관리
4. Cron 작업 재설정 필요

**가이드**: `/database/311_README.md` (세션 관리 통합)

---

**마지막 업데이트**: 2025-01-XX  
**버전**: 최신 (311 session_timers 통합 제거 추가)