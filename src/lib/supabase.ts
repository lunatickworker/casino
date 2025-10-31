// ✅ CRITICAL: 경고 필터링을 가장 먼저 실행
import './consoleFilter';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../utils/supabase/info';

const supabaseUrl = `https://${projectId}.supabase.co`;
const supabaseAnonKey = publicAnonKey;

/**
 * ✅ 메인 Supabase 클라이언트
 * 
 * - 커스텀 인증 사용 (Supabase Auth 미사용)
 * - DB 직접 쿼리 전용
 * - RLS 정책 적용됨
 * - localStorage 사용 (supabaseAdmin과 격리)
 */

// ✅ 싱글톤 패턴: 클라이언트 중복 생성 방지
let supabaseInstance: SupabaseClient | null = null;

const getSupabaseClient = () => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // ✅ 커스텀 인증 사용으로 Auth 기능 최소화
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        // ✅ 메인 클라이언트용 고유 storageKey
        storageKey: 'sb-gms-main-client',
        storage: {
          getItem: (key: string) => {
            try {
              return localStorage.getItem(key);
            } catch {
              return null;
            }
          },
          setItem: (key: string, value: string) => {
            try {
              localStorage.setItem(key, value);
            } catch {}
          },
          removeItem: (key: string) => {
            try {
              localStorage.removeItem(key);
            } catch {}
          }
        } as any
      },
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'X-Client-Info': 'gms-main-client'
        }
      }
    });
  }
  return supabaseInstance;
};

/**
 * 메인 클라이언트
 * - 커스텀 인증 사용
 * - localStorage 기반 storage
 */
export const supabase = getSupabaseClient();