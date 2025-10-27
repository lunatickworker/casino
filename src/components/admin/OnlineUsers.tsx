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
  const [syncingBalance, setSyncingBalance] = useState<string | null>(null);
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 온라인 세션 로드
  const loadOnlineSessions = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);

      // 자신 이하 모든 파트너 ID 가져오기
      let childPartnerIds: string[] = [];
      if (user.level !== 1) {
        childPartnerIds = await getAllChildPartnerIds(user.id);
      }

      // game_launch_sessions 테이블에서 온라인 세션 조회
      let query = supabase
        .from('game_launch_sessions')
        .select(`
          id,
          user_id,
          game_id,
          status,
          launched_at,
          last_activity_at,
          balance_before,
          users!inner (
            id,
            username,
            nickname,
            balance,
            vip_level,
            referrer_id,
            partners!users_referrer_id_fkey (
              id,
              nickname
            )
          ),
          games (
            name,
            game_providers (
              name
            )
          )
        `)
        .eq('status', 'active')
        .order('launched_at', { ascending: false });

      // 시스템관리자(level 1)가 아닌 경우 자신의 하위 사용자만 필터링
      if (user.level !== 1) {
        if (childPartnerIds.length === 0) {
          // 하위 파트너가 없으면 자신의 직속 사용자만
          query = query.eq('users.referrer_id', user.id);
        } else {
          // 자신과 하위 파트너의 사용자 포함
          const allPartnerIds = [user.id, ...childPartnerIds];
          query = query.in('users.referrer_id', allPartnerIds);
        }
      }

      const { data, error } = await query;

      if (error) throw error;

      // 데이터 포맷팅
      const formattedSessions: OnlineSession[] = (data || []).map((session: any) => ({
        session_id: session.id,
        user_id: session.users.id,
        username: session.users.username,
        nickname: session.users.nickname || session.users.username,
        partner_nickname: session.users.partners?.nickname || '-',
        game_name: session.games?.name || 'Unknown Game',
        provider_name: session.games?.game_providers?.name || 'Unknown',
        balance_before: session.balance_before || 0,
        current_balance: session.users.balance || 0,
        vip_level: session.users.vip_level || 0,
        device_type: 'Web', // 기본값
        ip_address: '-', // user_sessions에서 가져와야 함
        location: '-',
        launched_at: session.launched_at,
        last_activity: session.last_activity_at || session.launched_at,
      }));

      setSessions(formattedSessions);

    } catch (error: any) {
      console.error("온라인 세션 로드 오류:", error);
      if (isInitial) toast.error("온라인 현황을 불러올 수 없습니다");
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  // 모든 하위 파트너 ID를 재귀적으로 가져오기
  const getAllChildPartnerIds = async (partnerId: string): Promise<string[]> => {
    const partnerIds: string[] = [];
    const queue: string[] = [partnerId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      const { data, error } = await supabase
        .from('partners')
        .select('id')
        .eq('parent_id', currentId);

      if (!error && data) {
        for (const partner of data) {
          partnerIds.push(partner.id);
          queue.push(partner.id);
        }
      }
    }

    return partnerIds;
  };

  // 보유금 동기화
  const handleSyncBalance = async (session: OnlineSession) => {
    try {
      setSyncingBalance(session.user_id);

      // API 호출하여 보유금 조회
      const apiConfig = await investApi.getApiConfig(user.id);
      const balanceResult = await investApi.getUserBalance(
        apiConfig.opcode,
        session.username,
        apiConfig.token,
        apiConfig.secret_key
      );

      if (balanceResult && balanceResult.balance !== undefined) {
        // 보유금 업데이트
        const { error } = await supabase
          .from('users')
          .update({ balance: balanceResult.balance })
          .eq('id', session.user_id);

        if (error) throw error;

        toast.success(`${session.nickname}의 보유금이 동기화되었습니다`);
        loadOnlineSessions();
      } else {
        toast.error("보유금 조회에 실패했습니다");
      }
    } catch (error: any) {
      console.error("보유금 동기화 오류:", error);
      toast.error("보유금 동기화 중 오류가 발생했습니다");
    } finally {
      setSyncingBalance(null);
    }
  };

  // 세션 강제 종료
  const handleKickSession = async () => {
    if (!selectedSession) return;

    try {
      const { error } = await supabase
        .from('game_launch_sessions')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('id', selectedSession.session_id);

      if (error) throw error;

      toast.success(`${selectedSession.nickname}의 세션이 종료되었습니다`);
      setShowKickDialog(false);
      setSelectedSession(null);
      loadOnlineSessions();
    } catch (error: any) {
      console.error("세션 종료 오류:", error);
      toast.error("세션 종료 중 오류가 발생했습니다");
    }
  };

  // 초기 로드
  useEffect(() => {
    loadOnlineSessions(true);
  }, [user.id]);

  // Realtime 구독
  useEffect(() => {
    console.log('🔔 Realtime 구독 시작: game_launch_sessions');

    const channel = supabase
      .channel('online-users-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_launch_sessions'
        },
        (payload) => {
          console.log('🔔 game_launch_sessions 변경 감지:', payload);
          
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
      supabase.removeChannel(channel);
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, [user.id]);

  // 세션 시간 계산
  const getSessionTime = (launchedAt: string) => {
    const diffMinutes = Math.floor((Date.now() - new Date(launchedAt).getTime()) / 1000 / 60);
    
    if (diffMinutes < 60) {
      return `${diffMinutes}분`;
    }
    
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return `${hours}시간 ${minutes}분`;
  };

  // 총 게임 보유금
  const totalGameBalance = sessions.reduce((sum, s) => sum + s.current_balance, 0);

  // 손익 계산
  const totalBalanceChange = sessions.reduce(
    (sum, s) => sum + (s.current_balance - s.balance_before),
    0
  );

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
            소속: {session.partner_nickname}
          </span>
        </div>
      ),
    },
    {
      header: "게임",
      cell: (session: OnlineSession) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm">{session.game_name}</span>
          <span className="text-xs text-muted-foreground">
            {session.provider_name}
          </span>
        </div>
      ),
    },
    {
      header: "게임 시작금",
      cell: (session: OnlineSession) => (
        <span>₩{session.balance_before.toLocaleString()}</span>
      ),
    },
    {
      header: "현재 보유금",
      cell: (session: OnlineSession) => {
        const profit = session.current_balance - session.balance_before;
        return (
          <div className="flex flex-col gap-1">
            <span>₩{session.current_balance.toLocaleString()}</span>
            <span className={`text-xs ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {profit >= 0 ? '+' : ''}{profit.toLocaleString()}
            </span>
          </div>
        );
      },
    },
    {
      header: "접속 정보",
      cell: (session: OnlineSession) => (
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            <span>{session.location}</span>
          </div>
          <div className="flex items-center gap-1">
            <Smartphone className="h-3 w-3" />
            <span>{session.ip_address}</span>
          </div>
        </div>
      ),
    },
    {
      header: "세션 시간",
      cell: (session: OnlineSession) => (
        <div className="flex items-center gap-1 text-xs">
          <Clock className="h-3 w-3" />
          <span>{getSessionTime(session.launched_at)}</span>
        </div>
      ),
    },
    {
      header: "관리",
      cell: (session: OnlineSession) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSyncBalance(session)}
            disabled={syncingBalance === session.user_id}
          >
            <RefreshCw className={`h-3 w-3 ${syncingBalance === session.user_id ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setSelectedSession(session);
              setShowKickDialog(true);
            }}
          >
            <Power className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl">온라인 현황</h2>
          <p className="text-sm text-muted-foreground mt-1">
            실시간 게임 중인 사용자 현황
          </p>
        </div>
        <Button onClick={() => loadOnlineSessions(true)} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          새로고침
        </Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="온라인 사용자"
          value={`${sessions.length}명`}
          subtitle="현재 게임 중"
          icon={Wifi}
          color="purple"
        />
        <MetricCard
          title="총 게임 보유금"
          value={`₩${totalGameBalance.toLocaleString()}`}
          subtitle="전체 게임 중 보유금"
          icon={CreditCard}
          color="pink"
        />
        <MetricCard
          title="총 손익"
          value={`${totalBalanceChange >= 0 ? '+' : ''}₩${totalBalanceChange.toLocaleString()}`}
          subtitle="게임 시작 대비"
          icon={CreditCard}
          color={totalBalanceChange >= 0 ? "green" : "red"}
        />
        <MetricCard
          title="평균 세션"
          value={sessions.length > 0 
            ? `${Math.floor(sessions.reduce((sum, s) => sum + (Date.now() - new Date(s.launched_at).getTime()), 0) / sessions.length / 1000 / 60)}분`
            : '0분'
          }
          subtitle="평균 게임 시간"
          icon={Clock}
          color="cyan"
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
          rowKey="session_id"
        />
      )}

      {/* 강제 종료 확인 다이얼로그 */}
      <Dialog open={showKickDialog} onOpenChange={setShowKickDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>세션 강제 종료</DialogTitle>
            <DialogDescription>
              {selectedSession?.nickname}님의 게임 세션을 강제로 종료하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKickDialog(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleKickSession}>
              종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
