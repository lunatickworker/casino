-- 309_drop_unnecessary_rpc_functions.sql
-- RPC 함수 사용 금지 원칙에 따라 불필요한 함수 삭제
-- 클라이언트에서 직접 API 호출 및 DB 처리

-- create_user_with_api 함수 삭제 (http extension 의존성 제거)
-- 클라이언트에서 investApi.createAccount() + supabase.from('users').insert() 방식으로 처리
DROP FUNCTION IF EXISTS create_user_with_api(VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS create_user_with_api(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS create_user_with_api CASCADE;

-- 완료
SELECT '✅ 불필요한 RPC 함수 삭제 완료 - 클라이언트에서 직접 처리' as message;
