import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { Partner } from "../../types";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { toast } from "sonner@2.0.3";
import { RefreshCw, Power, Smartphone, Monitor, Users, DollarSign, TrendingDown, Clock } from "lucide-react";
import {
  AdminDialog as Dialog,
  AdminDialogContent as DialogContent,
  AdminDialogDescription as DialogDescription,
  AdminDialogFooter as DialogFooter,
  AdminDialogHeader as DialogHeader,
  AdminDialogTitle as DialogTitle,
} from "./AdminDialog";
import { MetricCard } from "./MetricCard";
import { getApiConfig, getUserBalanceWithConfig } from "../../lib/investApi";

// 게임 공급사 한글명 매핑
const PROVIDER_NAMES: Record<number, string> = {
  1: '마이크로게이밍',
  17: '플레이앤고',
  20: 'CQ9 게이밍',
  21: '제네시스 게이밍',
  22: '하바네로',
  23: '게임아트',
  27: '플레이텍',
  38: '블루프린트',
  39: '부운고',
  40: '드라군소프트',
  41: '엘크 스튜디오',
  47: '드림테크',
  51: '칼람바 게임즈',
  52: '모빌롯',
  53: '노리밋 시티',
  55: 'OMI 게이밍',
  56: '원터치',
  59: '플레이슨',
  60: '푸쉬 게이밍',
  61: '퀵스핀',
  62: 'RTG 슬롯',
  63: '리볼버 게이밍',
  65: '슬롯밀',
  66: '스피어헤드',
  70: '썬더킥',
  72: '우후 게임즈',
  74: '릴렉스 게이밍',
  75: '넷엔트',
  76: '레드타이거',
  87: 'PG소프트',
  88: '플레이스타',
  90: '빅타임게이밍',
  300: '프라그마틱 플레이',
  410: '에볼루션 게이밍',
  77: '마이크로게이밍 라이브',
  2: 'Vivo 게이밍',
  30: '아시아 게이밍',
  78: '프라그마틱 플레이 라이브',
  86: '섹시게이밍',
  11: '비비아이엔',
  28: '드림게임',
  89: '오리엔탈게임',
  91: '보타',
  44: '이주기',
  85: '플레이텍 라이브',
  0: '제네럴 카지노'
};

// 카지노 로비 한글명 매핑
const CASINO_LOBBY_NAMES: Record<number, string> = {
  410000: '에볼루션 라이브카지노',
  77060: '마이크로게이밍 라이브카지노',
  2029: 'Vivo 라이브카지노',
  30000: '아시아게이밍 라이브카지노',
  78001: '프라그마틱 라이브카지노',
  86001: '섹시게이밍 라이브카지노',
  11000: '비비아이엔 라이브카지노',
  28000: '드림게임 라이브카지노',
  89000: '오리엔탈게임 라이브카지노',
  91000: '보타 라이브카지노',
  44006: '이주기 라이브카지노',
  85036: '플레이텍 라이브카지노',
  0: '제네럴 라이브카지노'
};

interface OnlineSession {
  id: number;
  session_id: string;
  user_id: string;
  username: string;
  nickname: string;
  game_name: string;
  provider_name: string;
  balance_before: number;
  current_balance: number;
  device_type: string;
  ip_address: string;
  launched_at: string;
  last_activity_at: string;
}

interface OnlineUsersProps {
  user: Partner;
}

export function OnlineUsers({ user }: OnlineUsersProps) {
  const [sessions, setSessions] = useState<OnlineSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSession, setSelectedSession] = useState<OnlineSession | null>(null);
  const [showKickDialog, setShowKickDialog] = useState(false);
  const [syncingBalance, setSyncingBalance] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // 1초마다 접속시간 업데이트용
  useEffect(() => {
    const timer = setInterval(() => setTick(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // 온라인 세션 로드
  const loadSessions = async (isRefresh = false) => {
    try {
      // 첫 로딩이 아니면 refreshing 상태만 변경 (깜박임 방지)
      if (!isRefresh && loading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      // 60초 이상 비활성 세션 자동 종료
      const now = new Date();
      const sixtySecondsAgo = new Date(now.getTime() - 60000);
      
      console.log('🕐 세션 자동 종료 체크:', {
        현재시간: now.toISOString(),
        기준시간_60초전: sixtySecondsAgo.toISOString()
      });
      
      const { data: endedSessions, error: endError } = await supabaseAdmin
        .from('game_launch_sessions')
        .update({ 
          status: 'auto_ended',
          ended_at: now.toISOString()
        })
        .eq('status', 'active')
        .lt('last_activity_at', sixtySecondsAgo.toISOString())
        .select('id, user_id, last_activity_at');
      
      if (endError) {
        console.error('❌ 세션 자동 종료 오류:', endError);
      } else if (endedSessions && endedSessions.length > 0) {
        console.log(`✅ ${endedSessions.length}개 세션 자동 종료:`, endedSessions.map(s => ({
          id: s.id,
          user_id: s.user_id,
          마지막활동: s.last_activity_at,
          경과시간_초: Math.floor((now.getTime() - new Date(s.last_activity_at).getTime()) / 1000)
        })));
        
        // 세션 종료된 사용자의 보유금 동기화
        for (const session of endedSessions) {
          await syncBalanceOnSessionEnd(session.user_id);
        }
      }

      let query = supabase
        .from('game_launch_sessions')
        .select(`
          id,
          session_id,
          user_id,
          game_id,
          balance_before,
          launched_at,
          last_activity_at,
          users!inner(
            id,
            username,
            nickname,
            balance,
            ip_address,
            device_info,
            referrer_id
          )
        `)
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false });

      // 권한별 필터링
      if (user.partner_type !== '시스템관리자') {
        const { data: childPartners } = await supabase
          .from('partners')
          .select('id')
          .or(`parent_id.eq.${user.id},id.eq.${user.id}`);

        const allowedPartnerIds = childPartners?.map(p => p.id) || [user.id];
        query = query.in('users.referrer_id', allowedPartnerIds);
      }

      const { data, error } = await query;

      if (error) throw error;

      // game_id로 게임 정보 조회
      const gameIds = [...new Set((data || []).map((s: any) => s.game_id).filter(Boolean))];
      let gamesMap: Record<number, any> = {};
      
      if (gameIds.length > 0) {
        const { data: gamesData } = await supabase
          .from('games')
          .select('id, name, provider_id, game_providers(name)')
          .in('id', gameIds);
        
        if (gamesData) {
          gamesMap = Object.fromEntries(gamesData.map(g => [g.id, g]));
        }
      }

      const formattedSessions: OnlineSession[] = (data || []).map((session: any) => {
        // IP 주소 처리
        const ipAddress = session.users.ip_address || '-';
        
        // device_info에서 디바이스 타입 추출
        let deviceType = 'PC';
        if (session.users.device_info) {
          const deviceInfo = session.users.device_info;
          if (deviceInfo.device === 'Mobile' || deviceInfo.device === 'mobile') {
            deviceType = 'Mobile';
          } else if (deviceInfo.platform) {
            const platform = String(deviceInfo.platform).toLowerCase();
            if (platform.includes('android') || platform.includes('iphone') || platform.includes('ipad') || platform.includes('mobile')) {
              deviceType = 'Mobile';
            }
          } else if (deviceInfo.userAgent) {
            const ua = String(deviceInfo.userAgent).toLowerCase();
            if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
              deviceType = 'Mobile';
            }
          }
        }

        // 게임 정보 가져오기 - 한글명 우선 사용
        const providerId = Math.floor(session.game_id / 1000);
        const providerName = PROVIDER_NAMES[providerId] || `Provider ${providerId}`;
        
        // 카지노 로비인 경우 한글명 매핑
        let gameName = CASINO_LOBBY_NAMES[session.game_id];
        
        // 로비가 아닌 경우 games 테이블에서 조회
        if (!gameName) {
          const gameInfo = gamesMap[session.game_id];
          gameName = gameInfo?.name || `Game ${session.game_id}`;
        }

        return {
          id: session.id,
          session_id: session.session_id,
          user_id: session.users.id,
          username: session.users.username,
          nickname: session.users.nickname || session.users.username,
          game_name: gameName,
          provider_name: providerName,
          balance_before: Number(session.balance_before) || 0,
          current_balance: Number(session.users.balance) || 0,
          device_type: deviceType,
          ip_address: ipAddress,
          launched_at: session.launched_at,
          last_activity_at: session.last_activity_at,
        };
      });

      setSessions(formattedSessions);
    } catch (error) {
      console.error('세션 로드 오류:', error);
      toast.error('세션 로드 실패');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 30초마다 세션 자동 종료 + 데이터 갱신
  useEffect(() => {
    console.log('🔄 OnlineUsers 30초 타이머 시작');
    
    // 즉시 실행
    loadSessions();

    // 30초마다 실행
    const interval = setInterval(() => {
      console.log('⏰ 30초 경과 - 세션 자동 종료 체크 실행');
      loadSessions();
    }, 30000);

    return () => {
      console.log('🛑 OnlineUsers 30초 타이머 종료');
      clearInterval(interval);
    };
  }, [user.id, user.partner_type]);

  // 1시간마다 오래된 세션 정리
  useEffect(() => {
    const cleanupSessions = async () => {
      try {
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
          .from('game_launch_sessions')
          .delete()
          .in('status', ['auto_ended', 'ended', 'force_ended'])
          .lt('ended_at', fourHoursAgo)
          .select('id');

        if (error) {
          console.error('세션 정리 오류:', error);
        } else if (data && data.length > 0) {
          console.log(`🗑️ ${data.length}개 오래된 세션 삭제 (4시간 경과)`);
        }
      } catch (error) {
        console.error('세션 정리 실행 오류:', error);
      }
    };

    cleanupSessions();
    const interval = setInterval(cleanupSessions, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // 접속시간 계산
  const getSessionTime = (launchedAt: string) => {
    const launchTime = new Date(launchedAt).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - launchTime);
    
    if (isNaN(diffMs)) return '0분';
    
    const diffMinutes = Math.floor(diffMs / 1000 / 60);
    if (diffMinutes < 60) return `${diffMinutes}분`;
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return `${hours}시간 ${minutes}분`;
  };

  // 보유금 동기화
  const syncBalance = async (session: OnlineSession) => {
    try {
      setSyncingBalance(session.user_id);

      const apiConfig = await getApiConfig(user.id);
      if (!apiConfig) {
        toast.error('API 설정을 찾을 수 없습니다');
        return;
      }

      const balanceData = await getUserBalanceWithConfig(
        apiConfig.opcode,
        session.username,
        apiConfig.token,
        apiConfig.secret_key
      );

      if (balanceData && balanceData.success && typeof balanceData.balance === 'number') {
        await supabase
          .from('users')
          .update({ balance: balanceData.balance })
          .eq('id', session.user_id);

        toast.success('보유금 동기화 완료');
        loadSessions();
      } else {
        toast.error(balanceData?.error || '보유금 조회 실패');
      }
    } catch (error) {
      console.error('보유금 동기화 오류:', error);
      toast.error('보유금 동기화 실패');
    } finally {
      setSyncingBalance(null);
    }
  };

  // 세션 종료 시 보유금 동기화
  const syncBalanceOnSessionEnd = async (userId: string) => {
    try {
      const apiConfig = await getApiConfig(user.id);
      if (!apiConfig) {
        console.error('세션 종료 시 API 설정을 찾을 수 없습니다');
        return;
      }

      const userRecord = await supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .single();

      if (!userRecord.data) {
        console.error('세션 종료 시 사용자 정보를 찾을 수 없습니다');
        return;
      }

      const balanceData = await getUserBalanceWithConfig(
        apiConfig.opcode,
        userRecord.data.username,
        apiConfig.token,
        apiConfig.secret_key
      );

      if (balanceData && balanceData.success && typeof balanceData.balance === 'number') {
        await supabase
          .from('users')
          .update({ balance: balanceData.balance })
          .eq('id', userId);

        console.log(`세션 종료 시 보유금 동기화 완료: ${userId}`);
      } else {
        console.error(balanceData?.error || '세션 종료 시 보유금 조회 실패');
      }
    } catch (error) {
      console.error('세션 종료 시 보유금 동기화 오류:', error);
    }
  };

  // 강제 종료
  const handleKickUser = async () => {
    if (!selectedSession) return;

    try {
      const { error } = await supabase
        .from('game_launch_sessions')
        .update({ 
          status: 'force_ended',
          ended_at: new Date().toISOString()
        })
        .eq('id', selectedSession.id);

      if (error) {
        console.error('세션 종료 오류:', error);
        toast.error(`세션 종료 실패: ${error.message}`);
        return;
      }

      toast.success('세션 강제 종료 완료');
      setShowKickDialog(false);
      setSelectedSession(null);
      
      await loadSessions();
    } catch (error) {
      console.error('강제 종료 오류:', error);
      toast.error('강제 종료 실패');
    }
  };

  // 통계 계산
  const totalUsers = sessions.length;
  const totalGameBalance = sessions.reduce((sum, s) => sum + s.current_balance, 0);
  const totalProfitLoss = sessions.reduce((sum, s) => sum + (s.current_balance - s.balance_before), 0);
  
  // 평균 세션 시간 계산 (분)
  let avgSessionTime = 0;
  if (sessions.length > 0) {
    const now = Date.now();
    const totalMinutes = sessions.reduce((sum, s) => {
      const launchTime = new Date(s.launched_at).getTime();
      const diffMs = Math.max(0, now - launchTime);
      return sum + (diffMs / 1000 / 60);
    }, 0);
    avgSessionTime = Math.floor(totalMinutes / sessions.length);
  }

  const columns = [
    {
      key: 'username',
      header: '사용자',
      sortable: true,
    },
    {
      key: 'nickname',
      header: '닉네임',
      sortable: true,
    },
    {
      key: 'game_name',
      header: '게임',
      sortable: true,
      render: (value: string, row: OnlineSession) => (
        <div className="space-y-1">
          <div className="text-slate-200">{value}</div>
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            {row.provider_name}
          </Badge>
        </div>
      ),
    },
    {
      key: 'balance_before',
      header: '게임 시작금',
      sortable: true,
      render: (value: number) => (
        <span className="font-mono text-slate-300">₩{value.toLocaleString()}</span>
      ),
    },
    {
      key: 'current_balance',
      header: '변경 보유금',
      sortable: true,
      render: (value: number, row: OnlineSession) => {
        const diff = value - row.balance_before;
        const diffColor = diff >= 0 ? 'text-emerald-400' : 'text-red-400';
        const diffSign = diff >= 0 ? '+' : '';
        
        return (
          <div className="space-y-1">
            <div className="font-mono text-slate-200">₩{value.toLocaleString()}</div>
            {diff !== 0 && (
              <div className={`text-xs font-mono ${diffColor}`}>
                {diffSign}₩{diff.toLocaleString()}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'device_type',
      header: '접속경로',
      render: (value: string) => (
        <Badge variant={value === 'Mobile' ? 'default' : 'secondary'} className="gap-1">
          {value === 'Mobile' ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
          {value}
        </Badge>
      ),
    },
    {
      key: 'ip_address',
      header: 'IP 주소',
      sortable: true,
      render: (value: string) => (
        <span className="text-slate-300 font-mono text-xs">{value}</span>
      ),
    },
    {
      key: 'launched_at',
      header: '접속 시간',
      render: (value: string) => (
        <span className="text-slate-300">{getSessionTime(value)}</span>
      ),
    },
    {
      key: 'actions',
      header: '관리',
      render: (_: any, row: OnlineSession) => (
        <div className="flex items-center gap-2 justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => syncBalance(row)}
            disabled={syncingBalance === row.user_id}
            className="text-slate-400 hover:text-slate-200"
          >
            <RefreshCw className={`w-3 h-3 ${syncingBalance === row.user_id ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedSession(row);
              setShowKickDialog(true);
            }}
            className="bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
          >
            <Power className="w-3 h-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">온라인 현황</h2>
          <p className="text-sm text-slate-400 mt-1">
            실시간 게임 사용자 관리
          </p>
        </div>
        <Button onClick={() => loadSessions(true)} disabled={loading || refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="온라인 사용자"
          value={`${totalUsers}명`}
          subtitle="실시간 접속자"
          icon={Users}
          color="purple"
        />
        <MetricCard
          title="총 게임 보유금"
          value={`₩${totalGameBalance.toLocaleString()}`}
          subtitle="게임 내 총 잔고"
          icon={DollarSign}
          color="amber"
        />
        <MetricCard
          title="총 손익"
          value={`₩${totalProfitLoss.toLocaleString()}`}
          subtitle={totalProfitLoss >= 0 ? '↑ 사용자 이익' : '↓ 사용자 손실'}
          icon={TrendingDown}
          color={totalProfitLoss >= 0 ? 'green' : 'red'}
        />
        <MetricCard
          title="평균 세션"
          value={`${avgSessionTime}분`}
          subtitle="평균 접속 시간"
          icon={Clock}
          color="cyan"
        />
      </div>

      <DataTable
        data={sessions}
        columns={columns}
        loading={loading}
        emptyMessage="현재 온라인 사용자가 없습니다"
      />

      <Dialog open={showKickDialog} onOpenChange={setShowKickDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>세션 강제 종료</DialogTitle>
            <DialogDescription>
              {selectedSession?.username}({selectedSession?.nickname}) 님의 세션을 강제 종료하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKickDialog(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleKickUser}>
              강제 종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}