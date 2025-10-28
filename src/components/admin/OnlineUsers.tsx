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
import { investApi } from "../../lib/investApi";

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
            ip_address,
            device_info,
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
      const formattedSessions: OnlineSession[] = (data || []).map((session: any) => {
        // device_info에서 기기 타입 추출 (더 정확한 감지)
        let deviceType = 'PC';
        let deviceName = 'Desktop';
        
        if (session.users.device_info) {
          const deviceInfo = session.users.device_info;
          
          // 직접 device 필드가 있는 경우 최우선 적용
          if (deviceInfo.device) {
            deviceType = deviceInfo.device;
          } else if (deviceInfo.userAgent) {
            // userAgent 분석 - 모바일 우선 감지
            const ua = deviceInfo.userAgent.toLowerCase();
            
            // 모바일 우선 감지 (더 정확한 패턴)
            if (
              ua.includes('mobile') || 
              ua.includes('android') || 
              ua.includes('iphone') ||
              ua.includes('ipod') ||
              ua.includes('blackberry') ||
              ua.includes('windows phone') ||
              ua.includes('iemobile') ||
              ua.includes('opera mini')
            ) {
              deviceType = 'Mobile';
              if (ua.includes('iphone')) deviceName = 'iPhone';
              else if (ua.includes('android')) deviceName = 'Android';
              else deviceName = 'Mobile';
            }
            // iPad 및 태블릿 감지
            else if (ua.includes('ipad') || ua.includes('tablet')) {
              deviceType = 'Mobile';
              deviceName = ua.includes('ipad') ? 'iPad' : 'Tablet';
            }
            // PC - macintosh, windows, linux 등
            else {
              deviceType = 'PC';
              if (ua.includes('macintosh') || ua.includes('mac os')) deviceName = 'Mac';
              else if (ua.includes('windows')) deviceName = 'Windows';
              else if (ua.includes('linux')) deviceName = 'Linux';
              else deviceName = 'PC';
            }
          }
          
          // deviceName 필드가 있는 경우 우선 적용
          if (deviceInfo.deviceName) {
            deviceName = deviceInfo.deviceName;
          }
        }

        // IP 주소 처리
        const ipAddress = session.users.ip_address || '-';
        
        // IP 기반 간단한 통신사/지역 판별
        let location = '알 수 없음';
        if (ipAddress !== '-' && ipAddress.match(/^\d+\.\d+\.\d+\.\d+$/)) {
          const parts = ipAddress.split('.');
          const firstOctet = parseInt(parts[0]);
          const secondOctet = parseInt(parts[1]);
          
          // 한국 주요 통신사 IP 대역 (간단한 구분)
          if (firstOctet === 211 || firstOctet === 210 || firstOctet === 175) {
            location = 'KT';
          } else if (firstOctet === 218 || firstOctet === 121) {
            location = 'SKT';
          } else if (firstOctet === 220 || firstOctet === 117) {
            location = 'LG U+';
          } else if (firstOctet === 106 || firstOctet === 112) {
            location = '서울';
          } else if (firstOctet >= 1 && firstOctet <= 126) {
            location = '국내';
          } else if (firstOctet >= 128 && firstOctet <= 191) {
            location = '국내';
          } else if (firstOctet >= 192 && firstOctet <= 223) {
            location = '국내';
          } else {
            location = '기타';
          }
        }

        return {
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
          device_type: deviceType,
          ip_address: ipAddress,
          location: location,
          launched_at: session.launched_at,
          last_activity: session.last_activity_at || session.launched_at,
        };
      });

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

      console.log('💰 [보유금 동기화] 시작:', {
        user_id: session.user_id,
        username: session.username,
        nickname: session.nickname
      });

      // API 호출하여 보유금 조회
      const apiConfig = await investApi.getApiConfig(user.id);
      const balanceResult = await investApi.getUserBalance(
        apiConfig.opcode,
        session.username,
        apiConfig.token,
        apiConfig.secretKey
      );

      console.log('📡 [보유금 동기화] API 응답:', balanceResult);

      if (balanceResult.error) {
        console.error('❌ [보유금 동기화] API 오류:', balanceResult.error);
        toast.error("보유금 조회에 실패했습니다");
        return;
      }

      // extractBalanceFromResponse 함수를 사용하여 잔고 추출
      const newBalance = investApi.extractBalanceFromResponse(balanceResult.data, session.username);
      
      console.log('💵 [보유금 동기화] 추출된 잔고:', newBalance);

      if (newBalance >= 0) {
        // 보유금 업데이트
        const { error } = await supabase
          .from('users')
          .update({ 
            balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', session.user_id);

        if (error) {
          console.error('❌ [보유금 동기화] DB 업데이트 오류:', error);
          throw error;
        }

        console.log('✅ [보유금 동기화] 완료:', {
          user_id: session.user_id,
          username: session.username,
          new_balance: newBalance
        });

        toast.success(`${session.nickname}의 보유금이 ₩${newBalance.toLocaleString()}으로 동기화되었습니다`);
        loadOnlineSessions();
      } else {
        console.warn('⚠️ [보유금 동기화] 잔고 추출 실패');
        toast.error("보유금 조회에 실패했습니다");
      }
    } catch (error: any) {
      console.error("❌ [보유금 동기화] 오류:", error);
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
          status: 'force_ended',
          ended_at: new Date().toISOString()
        })
        .eq('id', selectedSession.session_id);

      if (error) throw error;

      console.log('🔴 관리자 강제 종료:', {
        sessionId: selectedSession.session_id,
        userId: selectedSession.user_id,
        nickname: selectedSession.nickname
      });

      toast.success(`${selectedSession.nickname}의 게임이 강제 종료되었습니다`);
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

  // 기기 아이콘 가져오기
  const getDeviceIcon = (deviceType: string) => {
    if (deviceType === 'Mobile') return Smartphone;
    if (deviceType === 'Tablet') return Smartphone;
    return Monitor;
  };

  const columns = [
    {
      header: "사용자",
      cell: (session: OnlineSession) => (
        <div className="py-3">
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-medium text-white">{session.username}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">{session.nickname}</span>
              {session.vip_level > 0 && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0.5 bg-gradient-to-r from-amber-500 to-yellow-500 border-0">
                  VIP{session.vip_level}
                </Badge>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "닉네임",
      cell: (session: OnlineSession) => (
        <div className="py-3">
          <span className="text-slate-300">{session.nickname}</span>
        </div>
      ),
    },
    {
      header: "게임",
      cell: (session: OnlineSession) => (
        <div className="py-3">
          <div className="flex flex-col items-center gap-1">
            <span className="font-medium text-emerald-300">{session.game_name}</span>
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
              {session.provider_name}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      header: "게임 시작금",
      cell: (session: OnlineSession) => (
        <div className="py-3">
          <span className="font-medium text-slate-300">₩{session.balance_before.toLocaleString()}</span>
        </div>
      ),
    },
    {
      header: "현재 보유금",
      cell: (session: OnlineSession) => {
        const profit = session.current_balance - session.balance_before;
        return (
          <div className="py-3">
            <div className="flex flex-col items-center gap-1">
              <span className="font-medium text-white">₩{session.current_balance.toLocaleString()}</span>
              <span className={`text-xs font-medium ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {profit >= 0 ? '+' : ''}₩{Math.abs(profit).toLocaleString()}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      header: "접속경로",
      cell: (session: OnlineSession) => {
        const DeviceIcon = getDeviceIcon(session.device_type);
        return (
          <div className="py-3">
            <div className="flex items-center justify-center gap-1.5">
              <DeviceIcon className="h-3.5 w-3.5 text-purple-400 shrink-0" />
              <span className="text-sm text-purple-300">{session.device_type}</span>
            </div>
          </div>
        );
      },
    },
    {
      header: "IP 주소",
      cell: (session: OnlineSession) => (
        <div className="py-3">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs font-mono text-cyan-300">{session.ip_address}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-cyan-500/10 border-cyan-500/30 text-cyan-400">
              {session.location}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      header: "접속 시간",
      cell: (session: OnlineSession) => (
        <div className="py-3">
          <div className="flex items-center justify-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-orange-400" />
            <span className="font-medium text-orange-300">{getSessionTime(session.launched_at)}</span>
          </div>
        </div>
      ),
    },
    {
      header: "관리",
      cell: (session: OnlineSession) => (
        <div className="flex gap-2 py-3 justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSyncBalance(session)}
            disabled={syncingBalance === session.user_id}
            className="h-7 w-7 p-0 bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20"
            title="보유금 동기화"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-blue-400 ${syncingBalance === session.user_id ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setSelectedSession(session);
              setShowKickDialog(true);
            }}
            className="h-7 w-7 p-0 bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
            title="세션 강제 종료"
          >
            <Power className="h-3.5 w-3.5 text-red-400" />
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
