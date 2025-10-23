import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../utils/supabase/info';

const supabaseUrl = `https://${projectId}.supabase.co`;
const supabaseAnonKey = publicAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 프록시 서버 URL (외부 API 직접 호출)
export const PROXY_SERVER_URL = 'https://vi8282.com/proxy';

// API 헤더
export const getApiHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${supabaseAnonKey}`,
});

// 로컬 로그인 처리 (서버 없이)
export async function localLogin(username: string, password: string): Promise<{ data: any | null; error: string | null }> {
  try {
    // 시스템 관리자 계정 하드코딩
    if (username === "sadmin" && password === "sadmin123!") {
      const user = {
        id: "system-admin-001",
        username: "sadmin",
        nickname: "시스템관리자",
        partner_type: "system_admin",
        level: 1,
        status: "active",
        balance: 0,
        commission_rolling: 0,
        commission_losing: 0,
        withdrawal_fee: 0,
        created_at: new Date().toISOString(),
      };

      return {
        data: {
          success: true,
          data: {
            user,
            token: "system-admin-token-001"
          }
        },
        error: null
      };
    }

    // 실제 데이터베이스에서 파트너 조회
    const { data: partner, error } = await supabase
      .from('partners')
      .select('*')
      .eq('username', username)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      console.error('파트너 조회 오류:', error);
      return {
        data: null,
        error: "아이디 또는 비밀번호가 잘못되었습니다."
      };
    }

    if (!partner) {
      console.log('파트너를 찾을 수 없음:', username);
      return {
        data: null,
        error: "아이디 또는 비밀번호가 잘못되었습니다."
      };
    }

    console.log('파트너 조회 성공:', { 
      username: partner.username, 
      has_password: !!partner.password_hash,
      password_length: partner.password_hash?.length || 0
    });

    // 비밀번호 검증
    if (!partner.password_hash || partner.password_hash !== password) {
      console.log('비밀번호 불일치');
      return {
        data: null,
        error: "아이디 또는 비밀번호가 잘못되었습니다."
      };
    }

    console.log('✅ 로그인 성공:', username);

    // 마지막 로그인 시간 업데이트
    await supabase
      .from('partners')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', partner.id);

    return {
      data: {
        success: true,
        data: {
          user: partner,
          token: `partner-token-${partner.id}`
        }
      },
      error: null
    };
  } catch (error) {
    console.error("Login error:", error);
    return {
      data: null,
      error: "로그인 처리 중 오류가 발생했습니다."
    };
  }
}

// 대시보드 통계 데이터 (로컬)
export async function getDashboardStats(): Promise<{ data: any | null; error: string | null }> {
  try {
    // 실제 데이터베이스에서 통계를 가져와야 함
    // 현재는 모사 데이터 반환
    const stats = {
      total_users: 1247,
      total_balance: 15847293,
      daily_deposit: 3428592,
      daily_withdrawal: 2847281,
      daily_net_deposit: 581311,
      casino_betting: 8472951,
      slot_betting: 12846372,
      total_betting: 21319323,
      online_users: 143,
      pending_approvals: 7,
      pending_messages: 12,
      pending_deposits: 5,
      pending_withdrawals: 8,
    };

    return {
      data: {
        success: true,
        data: stats
      },
      error: null
    };
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return {
      data: null,
      error: "통계 데이터를 불러오는 중 오류가 발생했습니다."
    };
  }
}

// 외부 API 프록시 호출
export async function proxyApiCall(
  url: string,
  method: string,
  body: any,
  timeout: number = 15000
): Promise<{ data: any | null; error: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch('https://vi8282.com/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { data: null, error: `프록시 호출 실패 (${response.status})` };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Proxy API Timeout:', url);
      return { data: null, error: '외부 API 호출 시간이 초과되었습니다.' };
    }
    console.error('Proxy API Error:', error);
    return { data: null, error: '외부 API 호출 실패' };
  }
}

// WebSocket 관련 기능은 WebSocketContext로 이동됨