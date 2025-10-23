-- ============================================================================
-- 280. Auto-Sync 사용자별 Session 체크 강화
-- ============================================================================
-- 작성일: 2025-10-18
-- 목적: Auto-Sync 시 각 사용자별로 Active Session 체크 후 보유금 업데이트
-- 배경: Auto-Sync가 전체적으로 Active 세션만 확인하고 모든 사용자 업데이트하는 문제 해결
-- ============================================================================

-- ============================================
-- 현재 문제 분석
-- ============================================

-- 문제 1: Auto-Sync의 동작 방식
-- ✅ Active 세션이 하나라도 있으면 → 전체 동기화 시작
-- ❌ 동기화 시작 후 → 모든 사용자의 보유금을 무조건 업데이트
-- 
-- 예시:
-- - 사용자 A: Active 세션 있음 (게임 플레이 중) ✅
-- - 사용자 B: Ended 세션 (게임 종료됨) ⛔
-- - 사용자 C: 세션 없음 ⛔
-- 
-- 기존 동작:
-- 1. Active 세션 확인 → A가 있으니 동기화 시작 ✅
-- 2. A, B, C 모두 보유금 업데이트 ❌ (문제!)
--
-- 올바른 동작:
-- 1. Active 세션 확인 → A가 있으니 동기화 시작 ✅
-- 2. A만 보유금 업데이트, B와 C는 스킵 ✅ (보안!)

-- ============================================
-- 해결 방법
-- ============================================

-- BettingHistory.tsx 수정 완료:
-- - manualSyncFromApi() 함수 내부
-- - 각 사용자별로 Active 세션 체크 추가
-- - Active 세션 있는 경우에만 보유금 업데이트
-- - Active 세션 없는 경우 스킵 (보안)

-- ============================================
-- 참고: 현재 시스템 구조
-- ============================================

-- 1. 프론트엔드 (BettingHistory.tsx)
--    - auto-sync: 30초마다 Active 세션 전체 확인
--    - Active 세션 있으면 → manualSyncFromApi() 호출
--    - manualSyncFromApi()에서 각 사용자별 Active 세션 체크 (280번 수정)
--
-- 2. 백엔드 (save_betting_records_batch)
--    - Invest API에서 베팅 기록 수신
--    - 각 레코드별로 Active 세션 체크
--    - Active 세션 있는 사용자만 보유금 업데이트

-- ============================================
-- 로그 메시지
-- ============================================

-- ✅ Active 세션 있는 사용자:
-- "[Active Session] 사용자 {username} 잔고 업데이트: {balance}"
-- 
-- ⛔ Active 세션 없는 사용자:
-- "[No Active Session] 사용자 {username} 잔고 업데이트 스킵 (session 없음 또는 ended)"

-- ============================================
-- 동작 시나리오
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '📋 Auto-Sync Session 체크 시나리오';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '상황: 파트너에 3명의 사용자가 있음';
    RAISE NOTICE '  - 사용자 A: 게임 플레이 중 (Active 세션 ✅)';
    RAISE NOTICE '  - 사용자 B: 게임 종료 (Ended 세션 ⛔)';
    RAISE NOTICE '  - 사용자 C: 게임 안 함 (세션 없음 ⛔)';
    RAISE NOTICE '';
    RAISE NOTICE '1️⃣ Auto-Sync 전체 세션 확인';
    RAISE NOTICE '   → Active 세션 발견 (사용자 A) ✅';
    RAISE NOTICE '   → 동기화 시작';
    RAISE NOTICE '';
    RAISE NOTICE '2️⃣ Invest API에서 베팅 기록 조회';
    RAISE NOTICE '   → A, B, C 모두 베팅 기록 있음';
    RAISE NOTICE '   → balance 정보 포함됨';
    RAISE NOTICE '';
    RAISE NOTICE '3️⃣ 각 사용자별 Active 세션 체크 (280번 수정)';
    RAISE NOTICE '   ';
    RAISE NOTICE '   사용자 A (Active 세션 ✅):';
    RAISE NOTICE '     → Session 확인: Active ✅';
    RAISE NOTICE '     → 보유금 업데이트 실행 ✅';
    RAISE NOTICE '     → 로그: "[Active Session] 사용자 A 잔고 업데이트: 150000"';
    RAISE NOTICE '';
    RAISE NOTICE '   사용자 B (Ended 세션 ⛔):';
    RAISE NOTICE '     → Session 확인: Ended ⛔';
    RAISE NOTICE '     → 보유금 업데이트 스킵 ⛔';
    RAISE NOTICE '     → 로그: "[No Active Session] 사용자 B 잔고 업데이트 스킵"';
    RAISE NOTICE '';
    RAISE NOTICE '   사용자 C (세션 없음 ⛔):';
    RAISE NOTICE '     → Session 확인: 없음 ⛔';
    RAISE NOTICE '     → 보유금 업데이트 스킵 ⛔';
    RAISE NOTICE '     → 로그: "[No Active Session] 사용자 C 잔고 업데이트 스킵"';
    RAISE NOTICE '';
    RAISE NOTICE '4️⃣ 베팅 기록 저장';
    RAISE NOTICE '   → A, B, C 모두 game_records에 저장 ✅';
    RAISE NOTICE '   → 히스토리는 보존, 보유금만 조건부 업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 보안 효과
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '🔒 보안 강화 효과';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '✅ 장점:';
    RAISE NOTICE '';
    RAISE NOTICE '1. 게임 종료 후 늦게 도착한 베팅 기록 차단';
    RAISE NOTICE '   - 게임 종료 → Session status = ended';
    RAISE NOTICE '   - 이후 베팅 기록 도착 → 보유금 업데이트 안됨';
    RAISE NOTICE '   - 비정상 베팅으로부터 보호';
    RAISE NOTICE '';
    RAISE NOTICE '2. 사용자별 독립적인 보안';
    RAISE NOTICE '   - 한 파트너의 여러 사용자 중';
    RAISE NOTICE '   - Active 세션 있는 사용자만 업데이트';
    RAISE NOTICE '   - 다른 사용자는 보호됨';
    RAISE NOTICE '';
    RAISE NOTICE '3. 베팅 히스토리 보존';
    RAISE NOTICE '   - 베팅 기록은 항상 game_records에 저장';
    RAISE NOTICE '   - 보유금 업데이트만 조건부';
    RAISE NOTICE '   - 정산 및 분석 데이터 유지';
    RAISE NOTICE '';
    RAISE NOTICE '4. 이중 보안 체계';
    RAISE NOTICE '   - Auto-Sync (프론트엔드): 사용자별 체크';
    RAISE NOTICE '   - save_betting_records_batch (백엔드): 레코드별 체크';
    RAISE NOTICE '   - 두 단계 모두 Active 세션 확인';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 테스트 방법
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '🧪 테스트 방법';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '1. 다중 사용자 환경 준비';
    RAISE NOTICE '   - 사용자 A: 게임 실행 (Active 세션 생성)';
    RAISE NOTICE '   - 사용자 B: 게임 종료 (Ended 세션)';
    RAISE NOTICE '   - 사용자 C: 게임 실행 안함 (세션 없음)';
    RAISE NOTICE '';
    RAISE NOTICE '2. Auto-Sync 로그 확인';
    RAISE NOTICE '   - 브라우저 Console 열기';
    RAISE NOTICE '   - "[AUTO-SYNC]" 로그 확인';
    RAISE NOTICE '';
    RAISE NOTICE '   예상 로그:';
    RAISE NOTICE '   🔍 [AUTO-SYNC] Active 세션 확인 중...';
    RAISE NOTICE '   ✅ [AUTO-SYNC] Active 세션 발견: [...]';
    RAISE NOTICE '   🚀 [AUTO-SYNC] 베팅 기록 동기화 시작...';
    RAISE NOTICE '   💰 [Active Session] 사용자 A 잔고 업데이트: 150000';
    RAISE NOTICE '   ⛔ [No Active Session] 사용자 B 잔고 업데이트 스킵';
    RAISE NOTICE '   ⛔ [No Active Session] 사용자 C 잔고 업데이트 스킵';
    RAISE NOTICE '   ✅ [AUTO-SYNC] 베팅 기록 동기화 완료';
    RAISE NOTICE '';
    RAISE NOTICE '3. 데이터베이스 확인';
    RAISE NOTICE '   ';
    RAISE NOTICE '   -- 세션 상태 확인';
    RAISE NOTICE '   SELECT ';
    RAISE NOTICE '     u.username,';
    RAISE NOTICE '     s.status,';
    RAISE NOTICE '     s.launched_at,';
    RAISE NOTICE '     s.ended_at';
    RAISE NOTICE '   FROM game_launch_sessions s';
    RAISE NOTICE '   JOIN users u ON s.user_id = u.id';
    RAISE NOTICE '   ORDER BY s.id DESC';
    RAISE NOTICE '   LIMIT 10;';
    RAISE NOTICE '';
    RAISE NOTICE '   -- 보유금 변경 이력 확인';
    RAISE NOTICE '   SELECT ';
    RAISE NOTICE '     username,';
    RAISE NOTICE '     balance,';
    RAISE NOTICE '     updated_at';
    RAISE NOTICE '   FROM users';
    RAISE NOTICE '   WHERE username IN (''A'', ''B'', ''C'')';
    RAISE NOTICE '   ORDER BY updated_at DESC;';
    RAISE NOTICE '';
    RAISE NOTICE '4. 정상 동작 확인';
    RAISE NOTICE '   ✅ 사용자 A: balance 업데이트됨 (Active)';
    RAISE NOTICE '   ✅ 사용자 B: balance 그대로 (Ended)';
    RAISE NOTICE '   ✅ 사용자 C: balance 그대로 (없음)';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '✅ 280. Auto-Sync Session 체크 강화 완료!';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '📝 변경 사항:';
    RAISE NOTICE '  ✅ BettingHistory.tsx 수정 완료';
    RAISE NOTICE '  ✅ 각 사용자별 Active 세션 체크 추가';
    RAISE NOTICE '  ✅ Active 세션 있는 사용자만 보유금 업데이트';
    RAISE NOTICE '  ✅ 로그 메시지 개선 (Active/No Active 구분)';
    RAISE NOTICE '';
    RAISE NOTICE '🔒 보안 효과:';
    RAISE NOTICE '  ⭐ 사용자별 독립적인 보안 체크';
    RAISE NOTICE '  ⭐ 게임 종료 후 베팅 기록 차단';
    RAISE NOTICE '  ⭐ 비정상 베팅으로부터 보호';
    RAISE NOTICE '  ⭐ 이중 보안 체계 (프론트+백엔드)';
    RAISE NOTICE '';
    RAISE NOTICE '📊 시스템 구조:';
    RAISE NOTICE '  1. Auto-Sync (프론트) → 전체 Active 세션 확인';
    RAISE NOTICE '  2. manualSyncFromApi() → 사용자별 Active 세션 체크';
    RAISE NOTICE '  3. save_betting_records_batch() → 레코드별 Active 세션 체크';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 다음 단계:';
    RAISE NOTICE '  1. 브라우저 Console에서 로그 확인';
    RAISE NOTICE '  2. 다중 사용자 환경에서 테스트';
    RAISE NOTICE '  3. Active/Ended 세션별 동작 확인';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;
