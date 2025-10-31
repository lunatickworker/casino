// ✅ CRITICAL: 경고 필터링을 가장 먼저 실행
import './consoleFilter';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { projectId } from '../utils/supabase/info';

const supabaseUrl = `https://${projectId}.supabase.co`;
const supabaseServiceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56dXp6bWFpdXlienluZHB0YWJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTIwMzk0MywiZXhwIjoyMDc0Nzc5OTQzfQ.ITQXw1UhEdqMvTNcWFi1WJVO4npUDCCG7G96EkjQMhI';

/**
 * ✅ CRITICAL FIX: GoTrueClient 중복 인스턴스 경고 완전 제거
 * 
 * 문제: Supabase JS 라이브러리가 각 클라이언트마다 GoTrueClient를 생성하여
 *       같은 브라우저 컨텍스트에서 경고 발생
 * 
 * 해결: Auth 클라이언트를 사용하지 않도록 설정
 *       - autoRefreshToken: false
 *       - persistSession: false  
 *       - 완전히 독립적인 storageKey
 *       - 메모리 전용 storage (localStorage 미사용)
 */

// ✅ 싱글톤 패턴: 클라이언트 중복 생성 방지
let supabaseAdminInstance: SupabaseClient | null = null;

// ✅ 메모리 전용 storage: localStorage와 완전히 독립
const memoryStorage: { [key: string]: string } = {};

const getSupabaseAdminClient = () => {
  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        // ✅ CRITICAL: Auth 기능 완전 비활성화
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        // ✅ CRITICAL: 고유한 storageKey (메인 클라이언트와 완전히 다름)
        storageKey: 'sb-admin-service-role-key',
        // ✅ CRITICAL: 메모리 전용 storage (localStorage 미사용)
        storage: {
          getItem: (key: string) => memoryStorage[key] || null,
          setItem: (key: string, value: string) => {
            memoryStorage[key] = value;
          },
          removeItem: (key: string) => {
            delete memoryStorage[key];
          }
        } as any
      },
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'X-Client-Info': 'gms-service-role-admin'
        }
      }
    });
  }
  return supabaseAdminInstance;
};

/**
 * Service Role 클라이언트
 * - RLS 우회 전용
 * - 커스텀 인증 사용으로 Supabase Auth 불필요
 * - 메모리 전용 storage로 localStorage와 격리
 */
export const supabaseAdmin = getSupabaseAdminClient();