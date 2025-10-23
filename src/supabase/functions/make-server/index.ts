import { Hono } from "https://deno.land/x/hono@v3.12.6/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.12.6/middleware.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const app = new Hono();

// Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 관리자 로그인 엔드포인트
app.post("/auth/login", async (c) => {
  try {
    const { username, password } = await c.req.json();

    // 시스템 관리자 계정 하드코딩 (빠른 로그인용)
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

      return c.json({
        success: true,
        data: {
          user,
          token: "system-admin-token-001"
        }
      });
    }

    // 실제 데이터베이스에서 파트너 조회
    const { data: partner, error } = await supabase
      .from('partners')
      .select('*')
      .eq('username', username)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !partner) {
      return c.json({
        success: false,
        error: "아이디 또는 비밀번호가 잘못되었습니다."
      }, 401);
    }

    // 실제 환경에서는 bcrypt 등으로 비밀번호 해시 검증
    // 현재는 개발용으로 간단히 처리
    if (partner.password_hash !== password) {
      return c.json({
        success: false,
        error: "아이디 또는 비밀번호가 잘못되었습니다."
      }, 401);
    }

    // 마지막 로그인 시간 업데이트
    await supabase
      .from('partners')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', partner.id);

    return c.json({
      success: true,
      data: {
        user: partner,
        token: `partner-token-${partner.id}`
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({
      success: false,
      error: "로그인 처리 중 오류가 발생했습니다."
    }, 500);
  }
});

// 대시보드 통계 데이터 엔드포인트
app.get("/dashboard/stats", async (c) => {
  try {
    // 실제로는 데이터베이스에서 실시간 통계를 가져와야 함
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

    return c.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return c.json({
      success: false,
      error: "통계 데이터를 불러오는 중 오류가 발생했습니다."
    }, 500);
  }
});

// Invest API 프록시 엔드포인트
app.post("/api/proxy", async (c) => {
  try {
    const { url, method, headers, body } = await c.req.json();
    
    const response = await fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    
    return c.json({
      success: true,
      data: data,
      status: response.status
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return c.json({
      success: false,
      error: "외부 API 호출 중 오류가 발생했습니다.",
      details: error.message
    }, 500);
  }
});

// WebSocket 연결 상태 관리
app.get("/websocket/status", (c) => {
  return c.json({
    success: true,
    data: {
      status: "active",
      endpoint: "wws://vi8282.com/ws",
      connected_clients: 0
    }
  });
});

// 오류 처리 미들웨어
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({
    success: false,
    error: "서버 내부 오류가 발생했습니다.",
    details: err.message
  }, 500);
});

// 404 처리
app.notFound((c) => {
  return c.json({
    success: false,
    error: "요청한 엔드포인트를 찾을 수 없습니다.",
    path: c.req.url
  }, 404);
});

Deno.serve(app.fetch);