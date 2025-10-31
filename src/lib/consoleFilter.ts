/**
 * ✅ GoTrueClient 중복 인스턴스 경고 필터링
 * 
 * 이 파일은 모든 Supabase 클라이언트보다 먼저 실행되어야 합니다.
 * 
 * 배경:
 * - GMS는 커스텀 인증을 사용하므로 Supabase Auth를 사용하지 않음
 * - Service Role과 Anon Key 두 개의 클라이언트가 필요 (RLS 우회/적용)
 * - Supabase JS 라이브러리는 각 클라이언트마다 GoTrueClient를 생성
 * - 같은 브라우저 컨텍스트에서 여러 GoTrueClient가 있으면 경고 발생
 * 
 * 해결:
 * - 경고는 실제로 문제를 일으키지 않음 (Auth를 사용하지 않으므로)
 * - console.warn을 오버라이드하여 이 특정 경고만 필터링
 */

if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  const originalWarn = console.warn;
  const originalError = console.error;
  
  console.warn = function(...args: any[]) {
    // GoTrueClient 중복 인스턴스 경고 무시
    const message = args[0];
    if (
      typeof message === 'string' &&
      (message.includes('Multiple GoTrueClient instances') ||
       message.includes('GoTrueClient'))
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
  
  console.error = function(...args: any[]) {
    // GoTrueClient 관련 에러도 무시
    const message = args[0];
    if (
      typeof message === 'string' &&
      message.includes('Multiple GoTrueClient instances')
    ) {
      return;
    }
    originalError.apply(console, args);
  };
}
