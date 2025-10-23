-- ============================================================================
-- 270. Custom Auth 시스템을 위한 RLS 정책 수정
-- ============================================================================
-- 작성일: 2025-10-18
-- 문제: auth.uid()가 NULL이어서 RLS 정책 위반 발생
-- 원인: 커스텀 인증 시스템 사용 (Supabase Auth 미사용)
-- 해결: RLS 비활성화하고 애플리케이션 레벨에서 권한 제어
-- ============================================================================

-- ============================================
-- 1단계: users 테이블 RLS 비활성화
-- ============================================

-- users 테이블 RLS 비활성화
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "users_select_policy" ON users;
DROP POLICY IF EXISTS "users_insert_policy" ON users;
DROP POLICY IF EXISTS "users_update_own_data" ON users;
DROP POLICY IF EXISTS "users_update_by_admin" ON users;
DROP POLICY IF EXISTS "users_delete_policy" ON users;
DROP POLICY IF EXISTS "Enable read access for authentication" ON users;
DROP POLICY IF EXISTS "Enable full access for authenticated users" ON users;

-- ============================================
-- 2단계: transactions 테이블 RLS 비활성화
-- ============================================

-- transactions 테이블 RLS 비활성화
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "transactions_select_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_update_own" ON transactions;
DROP POLICY IF EXISTS "transactions_update_by_admin" ON transactions;
DROP POLICY IF EXISTS "transactions_update_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_delete_policy" ON transactions;

-- ============================================
-- 3단계: partners 테이블 RLS 비활성화
-- ============================================

-- partners 테이블 RLS 비활성화
ALTER TABLE partners DISABLE ROW LEVEL SECURITY;

-- 기존 정책 모두 삭제 (있다면)
DROP POLICY IF EXISTS "partners_select_policy" ON partners;
DROP POLICY IF EXISTS "partners_insert_policy" ON partners;
DROP POLICY IF EXISTS "partners_update_policy" ON partners;
DROP POLICY IF EXISTS "partners_delete_policy" ON partners;

-- ============================================
-- 4단계: 기타 테이블 RLS 비활성화
-- ============================================

-- activity_logs 테이블
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_logs_select_policy" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert_policy" ON activity_logs;

-- user_sessions 테이블
ALTER TABLE user_sessions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_sessions_select_policy" ON user_sessions;
DROP POLICY IF EXISTS "user_sessions_insert_policy" ON user_sessions;
DROP POLICY IF EXISTS "user_sessions_update_policy" ON user_sessions;

-- game_records 테이블
ALTER TABLE game_records DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_records_select_policy" ON game_records;
DROP POLICY IF EXISTS "game_records_insert_policy" ON game_records;

-- messages 테이블
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_policy" ON messages;
DROP POLICY IF EXISTS "messages_insert_policy" ON messages;
DROP POLICY IF EXISTS "messages_update_policy" ON messages;

-- message_queue 테이블
ALTER TABLE message_queue DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "message_queue_select_policy" ON message_queue;
DROP POLICY IF EXISTS "message_queue_insert_policy" ON message_queue;
DROP POLICY IF EXISTS "message_queue_update_policy" ON message_queue;

-- partner_balance_logs 테이블
ALTER TABLE partner_balance_logs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_balance_logs_select_policy" ON partner_balance_logs;
DROP POLICY IF EXISTS "partner_balance_logs_insert_policy" ON partner_balance_logs;

-- ============================================
-- 5단계: 완료 메시지
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔓 RLS 정책 비활성화 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '적용된 변경사항:';
    RAISE NOTICE '  ✓ users 테이블 RLS 비활성화';
    RAISE NOTICE '  ✓ transactions 테이블 RLS 비활성화';
    RAISE NOTICE '  ✓ partners 테이블 RLS 비활성화';
    RAISE NOTICE '  ✓ 기타 모든 테이블 RLS 비활성화';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  보안 알림:';
    RAISE NOTICE '  - RLS가 비활성화되었습니다';
    RAISE NOTICE '  - 애플리케이션 레벨에서 권한 제어를 해야 합니다';
    RAISE NOTICE '  - Supabase 대시보드의 RLS 비활성화 경고는 정상입니다';
    RAISE NOTICE '';
    RAISE NOTICE '✅ 이제 다음 기능이 정상 동작합니다:';
    RAISE NOTICE '  • 사용자 로그인';
    RAISE NOTICE '  • 입출금 신청 (transactions INSERT)';
    RAISE NOTICE '  • 관리자의 입출금 승인';
    RAISE NOTICE '  • 사용자 balance 업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;
