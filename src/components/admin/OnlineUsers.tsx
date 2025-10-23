import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { Partner } from "../../types";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { toast } from "sonner@2.0.3";
import { RefreshCw, Power, Smartphone, Monitor, Wifi, Clock, MapPin, CreditCard } from "lucide-react";
import {
  AdminDialog as Dialog,
  AdminDialogContent as DialogContent,
  AdminDialogDescription as DialogDescription,
  AdminDialogFooter as DialogFooter,
  AdminDialogHeader as DialogHeader,
  AdminDialogTitle as DialogTitle,
} from "./AdminDialog";
import { MetricCard } from "./MetricCard";
import * as investApi from "../../lib/investApi";

interface OnlineSession {
  session_id: string;
  user_id: string;
  username: string;
  nickname: string;
  partner_nickname: string;
  game_name: string;
  provider_name: string;
  balance_before: number;
  current_balance: number;
  vip_level: number;
  device_type: string;
  ip_address: string;
  location: string;
  launched_at: string;
  last_activity: string;
}

interface OnlineUsersProps {
  user: Partner;
}

export function OnlineUsers({ user }: OnlineUsersProps) {
  const [sessions, setSessions] = useState<OnlineSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<OnlineSession | null>(null);
  const [showKickDialog, setShowKickDialog] = useState(false);
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 온라인 세션 로드
  const loadOnlineSessions = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.rpc("get_active_game_sessions", {
        p_user_id: null,
        p_admin_partner_id: user.id,
      });

      if (error) throw error;

      setSessions(data || []);
    } catch (error: any) {
      console.error("온라인 세션 로드 오류:", error);
      toast.error("온라인 현황을 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  };

  // 개별 사용자 보유금 수동 동기화
  const syncUserBalance = async (session: OnlineSession) => {
    try {
      console.log('💰 사용자 보유금 동기화 시작:', session.username);

      // 1. users 테이블에서 referrer_id 조회
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("referrer_id, username")
        .eq("id", session.user_id)
        .single();

      if (userError || !userData) {
        throw new Error(`사용자 정보를 찾을 수 없습니다: ${userError?.message || '알 수 없음'}`);
      }

      if (!userData.referrer_id) {
        throw new Error("소속 파트너 정보(referrer_id)가 없습니다");
      }

      // 2. partners 테이블에서 API 설정 조회
      const { data: partnerData, error: partnerError } = await supabase
        .from("partners")
        .select("opcode, secret_key, api_token")
        .eq("id", userData.referrer_id)
        .single();

      if (partnerError || !partnerData) {
        throw new Error(`파트너 정보를 찾을 수 없습니다: ${partnerError?.message || '알 수 없음'}`);
      }

      if (!partnerData.opcode || !partnerData.secret_key || !partnerData.api_token) {
        throw new Error(`파트너의 API 설정이 없습니다`);
      }

      // 3. Invest API 호출 (GET /api/account/balance)
      const apiResult = await investApi.getUserBalance(
        partnerData.opcode,
        userData.username,
        partnerData.api_token,
        partnerData.secret_key
      );

      if (apiResult.error) {
        throw new Error(`API 호출 실패: ${apiResult.error}`);
      }

      // 4. API 응답 직접 파싱
      let newBalance = 0;
      const apiData = apiResult.data;

      if (apiData) {
        if (typeof apiData === 'object' && !apiData.is_text) {
          if (apiData.RESULT === true && apiData.DATA) {
            newBalance = parseFloat(apiData.DATA.balance || apiData.DATA.users_balance || 0);
          } else if (apiData.balance !== undefined) {
            newBalance = parseFloat(apiData.balance || 0);
          } else if (apiData.DATA?.balance !== undefined) {
            newBalance = parseFloat(apiData.DATA.balance || 0);
          }
        } else if (apiData.is_text && apiData.text_response) {
          const balanceMatch = apiData.text_response.match(/balance["'\s:]+(\\d+\\.?\\d*)/i);
          if (balanceMatch) {
            newBalance = parseFloat(balanceMatch[1]);
          }
        }
      }

      // 5. DB 업데이트 (Realtime 이벤트 발생)
      const { error: updateError } = await supabase
        .from("users")
        .update({
          balance: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.user_id);

      if (updateError) {
        throw new Error(`DB 업데이트 실패: ${updateError.message}`);
      }

      console.log('✅ 보유금 동기화 완료:', {
        username: userData.username,
        oldBalance: session.current_balance,
        newBalance: newBalance,
        diff: newBalance - session.current_balance
      });

      // 화면 업데이트: sessions 상태 직접 갱신 (API 값으로 강제)
      setSessions(prevSessions => {
        const updated = prevSessions.map(s => 
          s.session_id === session.session_id
            ? { ...s, current_balance: newBalance }
            : s
        );
        console.log('💾 로컬 상태 업데이트 완료 - 새 보유금:', newBalance);
        return updated;
      });

      toast.success(`${session.username} 보유금 동기화 완료: ₩${newBalance.toLocaleString()}`);
      
    } catch (error: any) {
      console.error("❌ 보유금 동기화 오류:", error);
      toast.error(`보유금 동기화 실패: ${error.message || '알 수 없는 오류'}`);
    }
  };

  // 사용자 강제 종료
  const kickUser = async () => {
    if (!selectedSession) return;

    try {
      const { error } = await supabase
        .from("game_launch_sessions")
        .update({
          status: "ended",
          ended_at: new Date().toISOString()
        })
        .eq("id", selectedSession.session_id);

      if (error) {
        console.error("❌ game_launch_sessions 종료 오류:", error);
        throw error;
      }

      toast.success(`${selectedSession.username} 사용자를 강제 종료했습니다`);
      setShowKickDialog(false);
      setSelectedSession(null);
      await loadOnlineSessions();
    } catch (error: any) {
      console.error("강제 종료 오류:", error);
      toast.error(`강제 종료 실패: ${error.message || '알 수 없는 오류'}`);
    }
  };

  // 초기 로드 및 주기적 새로고침
  useEffect(() => {
    loadOnlineSessions();

    // 30초마다 화면 새로고침 (Realtime이 실패할 경우 대비)
    const interval = setInterval(loadOnlineSessions, 30000);
    return () => clearInterval(interval);
  }, [user.id]);

  // Realtime 구독: game_launch_sessions, users, game_records 변경 감지
  useEffect(() => {
    console.log('🔔 Realtime 구독 시작: game_launch_sessions, users, game_records');

    const channel = supabase
      .channel('online-sessions-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_launch_sessions'
        },
        (payload) => {
          console.log('🔔 game_launch_sessions 변경 감지:', payload);
          
          // Debounce: 500ms 후에 재로드
          if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current);
          }
          reloadTimeoutRef.current = setTimeout(() => {
            loadOnlineSessions();
          }, 500);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('🔔 users 변경 감지:', payload);
          
          // users 테이블 업데이트 시 해당 사용자의 balance를 직접 업데이트
          const updatedUser = payload.new as any;
          if (updatedUser && updatedUser.id && updatedUser.balance !== undefined) {
            console.log(`💰 사용자 ${updatedUser.username} 보유금 Realtime 업데이트: ${updatedUser.balance}`);
            
            setSessions(prevSessions => 
              prevSessions.map(s => 
                s.user_id === updatedUser.id 
                  ? { ...s, current_balance: updatedUser.balance }
                  : s
              )
            );
          }
          
          // 안전장치: 1초 후에 전체 재로드 (다른 변경사항 반영)
          if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current);
          }
          reloadTimeoutRef.current = setTimeout(() => {
            loadOnlineSessions();
          }, 1000);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_records'
        },
        (payload) => {
          console.log('🔔 game_records INSERT 감지:', payload);
          
          // Debounce: 500ms 후에 재로드
          if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current);
          }
          reloadTimeoutRef.current = setTimeout(() => {
            loadOnlineSessions();
          }, 500);
        }
      )
      .subscribe();

    return () => {
      console.log('🔕 Realtime 구독 해제');
      supabase.removeChannel(channel);
      
      // Timeout 정리
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, [user.id]);

  const columns = [
    {
      header: "사용자",
      cell: (session: OnlineSession) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span>{session.username}</span>
            <Badge variant="outline" className="text-xs">
              {session.nickname}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {session.partner_nickname}
          </span>
        </div>
      ),
    },
    {
      header: "게임",
      cell: (session: OnlineSession) => (
        <div className="flex flex-col gap-1">
          <span>{session.game_name || "알 수 없음"}</span>
          <span className="text-xs text-muted-foreground">
            {session.provider_name || ""}
          </span>
        </div>
      ),
    },
    {
      header: "시작 보유금",
      cell: (session: OnlineSession) => (
        <span>₩{session.balance_before.toLocaleString()}</span>
      ),
    },
    {
      header: "현재 보유금",
      cell: (session: OnlineSession) => (
        <div className="flex items-center gap-2">
          <span className={session.current_balance > session.balance_before ? "text-green-500" : session.current_balance < session.balance_before ? "text-red-500" : ""}>
            ₩{session.current_balance.toLocaleString()}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncUserBalance(session)}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      ),
    },
    {
      header: "VIP",
      cell: (session: OnlineSession) => (
        <Badge variant="secondary">LV.{session.vip_level}</Badge>
      ),
    },
    {
      header: "접속 정보",
      cell: (session: OnlineSession) => (
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1">
            {session.device_type === "mobile" ? (
              <Smartphone className="w-3 h-3" />
            ) : (
              <Monitor className="w-3 h-3" />
            )}
            <span>{session.device_type === "mobile" ? "모바일" : "PC"}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span>{session.ip_address}</span>
          </div>
        </div>
      ),
    },
    {
      header: "시작 시간",
      cell: (session: OnlineSession) => (
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{new Date(session.launched_at).toLocaleString()}</span>
          </div>
          <span className="text-muted-foreground">
            최종: {new Date(session.last_activity).toLocaleTimeString()}
          </span>
        </div>
      ),
    },
    {
      header: "관리",
      cell: (session: OnlineSession) => (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            setSelectedSession(session);
            setShowKickDialog(true);
          }}
        >
          <Power className="w-3 h-3 mr-1" />
          강제종료
        </Button>
      ),
    },
  ];

  const totalBalanceChange = sessions.reduce(
    (sum, s) => sum + (s.current_balance - s.balance_before),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl">온라인 현황</h2>
          <p className="text-sm text-muted-foreground mt-1">
            실시간 게임 중인 사용자 현황 (UserLayout에서 자동 동기화)
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="온라인 서버"
          value={sessions.length.toLocaleString()}
          subtitle="실시간 게임 세션"
          icon={Wifi}
          color="purple"
        />
        <MetricCard
          title="총 게임 보유금"
          value={`₩${sessions.reduce((sum, s) => sum + s.current_balance, 0).toLocaleString()}`}
          subtitle="전체 사용자 보유금"
          icon={CreditCard}
          color="pink"
        />
        <MetricCard
          title="시작 대비 변동"
          value={`₩${totalBalanceChange.toLocaleString()}`}
          subtitle={totalBalanceChange > 0 ? "↑ 증가" : totalBalanceChange < 0 ? "↓ 감소" : "변동 없음"}
          icon={CreditCard}
          color={totalBalanceChange > 0 ? "green" : totalBalanceChange < 0 ? "red" : "cyan"}
        />
        <MetricCard
          title="경고 보유금"
          value={sessions.length > 0 ? `₩${Math.round(sessions.reduce((sum, s) => sum + s.current_balance, 0) / sessions.length).toLocaleString()}` : "₩0"}
          subtitle="평균 사용자 보유금"
          icon={CreditCard}
          color="amber"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          </div>
        </div>
      ) : (
        <DataTable
          data={sessions}
          columns={columns}
          emptyMessage="현재 게임 중인 사용자가 없습니다"
        />
      )}

      <Dialog open={showKickDialog} onOpenChange={setShowKickDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사용자 강제 종료</DialogTitle>
            <DialogDescription>
              {selectedSession?.username} 사용자를 강제로 로그아웃시키겠습니까?
              <br />
              <span className="text-xs text-muted-foreground mt-2 block">
                현재 게임: {selectedSession?.game_name}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowKickDialog(false);
                setSelectedSession(null);
              }}
            >
              취소
            </Button>
            <Button variant="destructive" onClick={kickUser}>
              강제 종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
