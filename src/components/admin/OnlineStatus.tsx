import { useState, useEffect } from "react";
import { Users, MapPin, Monitor, Smartphone, Wifi, WifiOff, LogOut, Search, Filter, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";

interface UserSession {
  id: string;
  user_id: string;
  user_username: string;
  user_nickname: string;
  user_balance: number;
  user_vip_level: number;
  session_token: string;
  ip_address: string;
  device_info: {
    device: string;
    browser: string;
    os: string;
    screen?: string;
  };
  location_info: {
    country: string;
    city: string;
    region: string;
  };
  login_at: string;
  last_activity: string;
  is_active: boolean;
  current_game?: string;
  game_session_id?: number;
}

const getDeviceIcon = (device: string) => {
  if (device?.toLowerCase().includes('mobile') || device?.toLowerCase().includes('android') || device?.toLowerCase().includes('iphone')) {
    return <Smartphone className="h-4 w-4" />;
  }
  return <Monitor className="h-4 w-4" />;
};

const getConnectionStatus = (lastActivity: string, currentGame?: string) => {
  const now = new Date();
  const activity = new Date(lastActivity);
  const diffMinutes = (now.getTime() - activity.getTime()) / 1000 / 60;
  
  // 게임 중인 경우 항상 활성으로 표시
  if (currentGame && currentGame !== null && currentGame !== 'null') return 'active';
  
  if (diffMinutes < 5) return 'active';
  if (diffMinutes < 30) return 'idle';
  return 'away';
};

const statusColors = {
  active: 'bg-green-500',
  idle: 'bg-yellow-500',
  away: 'bg-gray-500'
};

const statusTexts = {
  active: '활성',
  idle: '대기',
  away: '자리비움'
};

export function OnlineStatus() {
  const { authState } = useAuth();
  const { connected, sendMessage } = useWebSocketContext();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<UserSession | null>(null);
  const [showForceLogoutDialog, setShowForceLogoutDialog] = useState(false);
  const [gamingSessions, setGamingSessions] = useState<any[]>([]);
  const [gamesList, setGamesList] = useState<Map<number, string>>(new Map());

  // 게임 목록 로드 (게임명 표시용)
  // 📝 중요: 게임 세션은 POST /api/game/launch 호출 시에만 생성됩니다 (로그인 시 생성 X)
  const loadGamesList = async () => {
    try {
      const { data: gamesData } = await supabase
        .from('games')
        .select('id, name');

      if (gamesData) {
        const gamesMap = new Map();
        gamesData.forEach(game => {
          gamesMap.set(game.id, game.name);
        });
        setGamesList(gamesMap);
        console.log('🎮 게임 목록 로드 완료:', gamesMap.size, '개 게임');
      }
    } catch (error) {
      console.error('게임 목록 로드 오류:', error);
    }
  };

  // 게임 세션 데이터 동기화 (간소화)
  const syncRealtimeData = async () => {
    try {
      console.log('🔄 게임 세션 동기화 시작');
      
      // 먼저 전체 세션 수 확인
      const { count: totalCount } = await supabase
        .from('game_launch_sessions')
        .select('*', { count: 'exact', head: true });
      
      console.log('📊 전체 게임 세션 수:', totalCount);
      
      // 활성 게임 세션 조회만 수행 (POST /api/game/launch로 생성된 세션만)
      const { data: gamingData, error: gameSessionError } = await supabase
        .from('game_launch_sessions')
        .select(`
          user_id,
          game_id,
          status,
          launched_at
        `)
        .eq('status', 'active')
        .is('ended_at', null);

      if (gameSessionError) {
        console.error('❌ 게임 세션 조회 오류:', gameSessionError);
      } else {
        console.log(`📊 활성 게임 세션 수: ${gamingData?.length || 0}개 (전체: ${totalCount || 0}개)`);
        if (gamingData && gamingData.length > 0) {
          console.log('🎮 게임 세션 상세:', gamingData);
        } else {
          console.log('⚠️ 활성 게임 세션이 없습니다. (전체 세션은 있지만 status=active인 세션이 없음)');
        }
        setGamingSessions(gamingData || []);
      }
      
    } catch (error) {
      console.error('❌ 게임 세션 동기화 오류:', error);
    }
  };

  // 사용자 잔고 동기화 (API 호출)
  const syncUserBalance = async (username: string) => {
    try {
      toast.info(`${username} 잔고 동기화 중...`);
      
      // 사용자의 OPCODE 정보 조회
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
          id,
          username,
          referrer_id,
          partners:referrer_id (opcode, secret_key)
        `)
        .eq('username', username)
        .single();

      if (userError || !userData) {
        throw new Error('사용자 정보를 찾을 수 없습니다.');
      }

      const opcode = userData.partners?.opcode;
      const secretKey = userData.partners?.secret_key;

      if (!opcode || !secretKey) {
        throw new Error('OPCODE 정보가 없습니다.');
      }

      // 개별 사용자 잔고 조회 API 호출 (올바른 방식)
      const { generateSignature } = await import('../../lib/investApi');
      const signature = generateSignature([opcode, username], secretKey);

      const response = await fetch('https://vi8282.com/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://api.invest-ho.com/api/info',
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: { 
            opcode, 
            username,
            signature 
          }
        })
      });

      if (!response.ok) {
        throw new Error('API 호출 실패');
      }

      const result = await response.json();
      
      // 응답에서 해당 사용자의 잔고 찾기
      let userBalance = null;
      if (Array.isArray(result)) {
        const userInfo = result.find((u: any) => u.username === username || u.user_id === username);
        userBalance = userInfo?.balance || userInfo?.money;
      } else if (result.DATA && Array.isArray(result.DATA)) {
        const userInfo = result.DATA.find((u: any) => u.username === username || u.user_id === username);
        userBalance = userInfo?.balance || userInfo?.money;
      }

      if (userBalance !== null) {
        // DB 업데이트
        const { error: updateError } = await supabase
          .from('users')
          .update({ 
            balance: parseFloat(userBalance),
            updated_at: new Date().toISOString()
          })
          .eq('username', username);

        if (updateError) throw updateError;

        toast.success(`${username} 잔고 동기화 완료: ${parseFloat(userBalance).toLocaleString()}원`);
        
        // 목록 새로고침
        fetchOnlineSessions(false);
      } else {
        toast.warning('API에서 잔고 정보를 찾을 수 없습니다.');
      }

    } catch (error) {
      console.error('잔고 동기화 오류:', error);
      toast.error('잔고 동기화에 실패했습니다.');
    }
  };

  // 게임 세션이 있는 사용자만 조회 (실시간 현황은 게임 플레이 중인 사용자만 표시)
  const fetchOnlineSessions = async (showLoader = false) => {
    try {
      if (showLoader) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }

      console.log(`🔍 게임 세션 기반 실시간 현황 조회 시작 (로더: ${showLoader})`);

      // 먼저 전체 데이터 확인
      const { data: allSessions, count: allCount } = await supabase
        .from('game_launch_sessions')
        .select('*', { count: 'exact' });
      
      console.log(`📊 전체 게임 세션: ${allCount}개`, allSessions);

      // 활성 게임 세션 조회 (1분 이내 베팅 활동이 있는 세션만)
      const { data: activeSessions, error: sessionError } = await supabase
        .from('game_launch_sessions')
        .select(`
          id,
          user_id,
          game_id,
          status,
          launched_at,
          last_heartbeat,
          users:user_id (
            id,
            username,
            nickname,
            balance,
            vip_level,
            is_online
          )
        `)
        .eq('status', 'active')
        .is('ended_at', null)
        .gte('last_heartbeat', new Date(Date.now() - 1 * 60 * 1000).toISOString()); // 1분 이내

      if (sessionError) {
        console.error('❌ 게임 세션 조회 쿼리 오류:', sessionError);
        throw sessionError;
      }

      console.log(`📊 조회된 활성 게임 세션 수: ${activeSessions?.length || 0} (1분 이내 베팅 활동)`);
      console.log(`📊 활성 세션 상세:`, activeSessions);

      // 사용자별로 세션 정보를 추가로 조회
      const userIds = activeSessions?.map(s => s.user_id).filter(Boolean) || [];
      let userSessionsMap = new Map();
      
      if (userIds.length > 0) {
        const { data: userSessions } = await supabase
          .from('user_sessions')
          .select('*')
          .in('user_id', userIds)
          .eq('is_active', true)
          .order('last_activity', { ascending: false });
          
        if (userSessions) {
          userSessions.forEach(session => {
            if (!userSessionsMap.has(session.user_id)) {
              userSessionsMap.set(session.user_id, session);
            }
          });
        }
      }

      // 사용자별로 그룹화 (중복 제거)
      const userSessionsMap2 = new Map();
      
      activeSessions?.forEach(gameSession => {
        const userInfo = gameSession.users || {};
        const userId = userInfo.id;
        
        if (!userId || !userInfo.username) return;
        
        // 이미 해당 사용자가 있으면 게임 목록에 추가
        if (userSessionsMap2.has(userId)) {
          const existing = userSessionsMap2.get(userId);
          existing.game_ids.push(gameSession.game_id);
          existing.game_session_ids.push(gameSession.id);
          // 가장 최근 게임으로 업데이트
          if (new Date(gameSession.launched_at) > new Date(existing.last_launched_at)) {
            existing.current_game = gameSession.game_id;
            existing.game_session_id = gameSession.id;
            existing.last_launched_at = gameSession.launched_at;
          }
        } else {
          // 새로운 사용자 추가
          const sessionInfo = userSessionsMap.get(userId) || {};
          
          userSessionsMap2.set(userId, {
            user_id: userId,
            user_username: userInfo.username,
            user_nickname: userInfo.nickname || '',
            user_balance: typeof userInfo.balance === 'number' ? userInfo.balance : 0,
            user_vip_level: typeof userInfo.vip_level === 'number' ? userInfo.vip_level : 0,
            session_token: sessionInfo.session_token || `session-${gameSession.id}`,
            ip_address: sessionInfo.ip_address || '127.0.0.1',
            device_info: sessionInfo.device_info || { device: 'Desktop', browser: 'Chrome', os: 'Windows' },
            location_info: sessionInfo.location_info || { country: 'KR', city: '서울', region: '서울' },
            login_at: sessionInfo.login_at || gameSession.launched_at,
            last_activity: sessionInfo.last_activity || new Date().toISOString(),
            is_active: true,
            current_game: gameSession.game_id,
            game_session_id: gameSession.id,
            game_ids: [gameSession.game_id],
            game_session_ids: [gameSession.id],
            last_launched_at: gameSession.launched_at
          });
        }
      });
      
      // Map을 배열로 변환하고 고유 ID 추가
      const formattedData = Array.from(userSessionsMap2.values()).map(userData => ({
        ...userData,
        id: `user-${userData.user_id}`, // 사용자 ID를 고유 키로 사용
      }));
      
      console.log(`✅ 사용자별로 그룹화된 데이터: ${formattedData.length}명`, formattedData);

      console.log(`✅ 변환된 게임 세션 데이터: ${formattedData.length}개`, formattedData);

      setSessions(prevSessions => {
        const hasChanges = JSON.stringify(prevSessions) !== JSON.stringify(formattedData);
        if (hasChanges) {
          console.log('📱 게임 세션 데이터 변경 감지 - UI 업데이트');
          return formattedData;
        }
        console.log('📱 게임 세션 데이터 변경사항 없음 - UI 유지');
        return prevSessions;
      });
      
      setLastUpdate(new Date());
    } catch (error) {
      console.error('❌ 게임 세션 조회 오류:', error);
      if (showLoader) {
        toast.error('실시간 현황을 불러오는데 실패했습니다.');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  // 게임 세션 강제 종료
  const forceLogout = async (sessionId: string, userId: string) => {
    try {
      setLoading(true);

      // 먼저 게임 세션 종료
      if (selectedSession?.game_session_id) {
        const { error: gameSessionError } = await supabase
          .from('game_launch_sessions')
          .update({ 
            status: 'terminated',
            ended_at: new Date().toISOString()
          })
          .eq('id', selectedSession.game_session_id);

        if (gameSessionError) {
          console.error('게임 세션 종료 오류:', gameSessionError);
        }
      }

      // 사용자 세션 종료
      const { error: sessionError } = await supabase
        .from('user_sessions')
        .update({ 
          is_active: false,
          logout_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (sessionError) {
        console.error('사용자 세션 종료 오류:', sessionError);
      }

      // 사용자 상태 업데이트
      const { error: userError } = await supabase
        .from('users')
        .update({ is_online: false })
        .eq('id', userId);

      if (userError) {
        console.error('사용자 상태 업데이트 오류:', userError);
      }

      toast.success('게임 세션이 강제 종료되었습니다.');
      setShowForceLogoutDialog(false);
      setSelectedSession(null);

      if (connected && sendMessage) {
        sendMessage({
          type: 'force_game_logout',
          data: { 
            sessionId, 
            userId, 
            gameSessionId: selectedSession?.game_session_id 
          }
        });
      }

      fetchOnlineSessions();
    } catch (error) {
      console.error('게임 세션 강제 종료 오류:', error);
      toast.error('게임 세션 강제 종료에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 필터링된 세션 목록 (게임 세션 기반)
  const filteredSessions = sessions.filter(session => {
    const matchesSearch = session.user_username.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         session.user_nickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         session.ip_address.includes(searchTerm);
    
    const deviceType = session.device_info?.device?.toLowerCase() || '';
    const matchesDevice = deviceFilter === 'all' || 
                         (deviceFilter === 'mobile' && (deviceType.includes('mobile') || deviceType.includes('android') || deviceType.includes('iphone'))) ||
                         (deviceFilter === 'desktop' && !deviceType.includes('mobile') && !deviceType.includes('android') && !deviceType.includes('iphone'));
    
    // 게임 세션은 모두 활성 상태이므로 상태 필터는 의미 없음
    const matchesStatus = statusFilter === 'all' || statusFilter === 'active';
    
    return matchesSearch && matchesDevice && matchesStatus;
  });

  // 테이블 컬럼 정의
  const columns = [
    {
      key: "user_username",
      header: "아이디",
    },
    {
      key: "user_nickname",
      header: "닉네임",
    },
    {
      key: "current_game",
      header: "게임명",
      cell: (row: UserSession) => {
        // 여러 게임을 플레이 중인 경우
        const gameIds = (row as any).game_ids || [row.current_game];
        const gameCount = gameIds.length;
        const mainGameName = row.current_game ? gamesList.get(parseInt(row.current_game)) : null;
        
        if (gameCount > 1) {
          return (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-green-600">
                  {mainGameName || `게임 ID: ${row.current_game}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  외 {gameCount - 1}개 게임
                </span>
              </div>
            </div>
          );
        }
        
        return (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-sm font-medium text-green-600">
              {mainGameName || `게임 ID: ${row.current_game}`}
            </span>
          </div>
        );
      }
    },
    {
      key: "user_balance",
      header: "보유금액",
      cell: (row: UserSession) => (
        <button
          onClick={() => syncUserBalance(row.user_username)}
          className="font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer transition-colors"
          title="클릭하여 잔고 동기화"
        >
          {row.user_balance.toLocaleString()}원
        </button>
      )
    },
    {
      key: "user_vip_level",
      header: "VIP",
      cell: (row: UserSession) => (
        <Badge variant={row.user_vip_level > 0 ? "default" : "secondary"}>
          {row.user_vip_level > 0 ? `VIP${row.user_vip_level}` : "일반"}
        </Badge>
      )
    },
    {
      key: "device_info",
      header: "접속환경",
      cell: (row: UserSession) => (
        <div className="flex items-center gap-2">
          {getDeviceIcon(row.device_info?.device)}
          <span className="text-sm">
            {row.device_info?.browser || 'Unknown'}
          </span>
        </div>
      )
    },
    {
      key: "ip_address",
      header: "IP 주소",
      cell: (row: UserSession) => (
        <span className="font-mono text-sm">{row.ip_address}</span>
      )
    },
    {
      key: "location_info",
      header: "위치",
      cell: (row: UserSession) => (
        <div className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          <span className="text-sm">
            {row.location_info?.city || '서울'}, {row.location_info?.country || 'KR'}
          </span>
        </div>
      )
    },
    {
      key: "last_activity",
      header: "접속상태",
      cell: (row: UserSession) => {
        const status = getConnectionStatus(row.last_activity, row.current_game);
        const isPlaying = row.current_game && row.current_game !== null;
        
        return (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500' : statusColors[status]}`}></div>
            <span className="text-sm">
              {isPlaying ? '플레이중' : statusTexts[status]}
            </span>
          </div>
        );
      }
    },
    {
      key: "login_at",
      header: "게임 시작",
      cell: (row: UserSession) => (
        <span className="text-sm">
          {new Date(row.login_at).toLocaleString('ko-KR')}
        </span>
      )
    },
    {
      key: "actions",
      header: "관리",
      cell: (row: UserSession) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedSession(row);
              setShowForceLogoutDialog(true);
            }}
            className="h-8 px-2 text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-3 w-3" />
          </Button>
        </div>
      )
    }
  ];

  // 통계 계산 (사용자별 그룹화 기준)
  const stats = {
    total: sessions.length, // 고유 사용자 수
    active: sessions.length, // 모든 사용자가 게임 중
    idle: 0,
    away: 0,
    mobile: sessions.filter(s => {
      const device = s.device_info?.device?.toLowerCase() || '';
      return device.includes('mobile') || device.includes('android') || device.includes('iphone');
    }).length,
    desktop: sessions.filter(s => {
      const device = s.device_info?.device?.toLowerCase() || '';
      return !device.includes('mobile') && !device.includes('android') && !device.includes('iphone');
    }).length
  };

  // 초기 데이터 로드 및 실시간 구독
  useEffect(() => {
    fetchOnlineSessions(true);

    const channel = supabase
      .channel('online-status-updates')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'user_sessions' },
        (payload) => {
          console.log('🔔 세션 변경 감지:', payload);
          fetchOnlineSessions(false);
        }
      )
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'users' },
        (payload) => {
          console.log('🔔 사용자 변경 감지:', payload);
          fetchOnlineSessions(false);
        }
      )
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'game_launch_sessions' },
        (payload) => {
          console.log('🔔 게임 세션 변경 감지:', payload);
          syncRealtimeData(); // 게임 세션 데이터 다시 로드
          fetchOnlineSessions(false);
        }
      )
      .subscribe();

    // 10초마다 게임 세션 동기화 (더 빠른 업데이트)
    const interval = setInterval(() => {
      syncRealtimeData();
      fetchOnlineSessions(false);
    }, 10000);

    // 초기 데이터 로드
    loadGamesList();
    syncRealtimeData();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  if (loading && sessions.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8 text-blue-500" />
            실시간 게임 세션 모니터링
          </h1>
          <p className="text-muted-foreground mt-2">
            게임 플레이 중인 사용자들의 실시간 현황을 모니터링합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">
            마지막 업데이트: {lastUpdate.toLocaleTimeString('ko-KR')}
          </div>
          <Button 
            onClick={() => fetchOnlineSessions(true)} 
            variant="outline"
            disabled={loading || isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">실시간 게임 세션</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Wifi className="h-3 w-3 text-green-500" />
              활성 게임 세션
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">게임 중</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              실시간 게임 플레이
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">모바일</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.mobile}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Smartphone className="h-3 w-3" />
              모바일 기기
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">데스크톱</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats.desktop}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Monitor className="h-3 w-3" />
              데스크톱 기기
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 실시간 게임 세션 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>실시간 게임 세션 목록</CardTitle>
          <CardDescription>
            현재 게임을 플레이 중인 사용자들의 실시간 현황입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 검색 및 필터 */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="아이디, 닉네임, IP로 검색..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={deviceFilter} onValueChange={setDeviceFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 기기</SelectItem>
                <SelectItem value="mobile">모바일</SelectItem>
                <SelectItem value="desktop">데스크톱</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="active">게임 중</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 데이터 테이블 */}
          <DataTable
            data={filteredSessions}
            columns={columns}
            loading={loading}
            emptyMessage="현재 게임 플레이 중인 사용자가 없습니다."
          />
        </CardContent>
      </Card>

      {/* 강제 로그아웃 다이얼로그 */}
      <Dialog open={showForceLogoutDialog} onOpenChange={setShowForceLogoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>강제 로그아웃</DialogTitle>
            <DialogDescription>
              정말로 {selectedSession?.user_username}님의 게임 세션을 강제 종료하시겠습니까?
              이 작업은 취소할 수 없으며, 현재 진행 중인 게임이 즉시 종료됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceLogoutDialog(false)}>
              취소
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => selectedSession && forceLogout(selectedSession.id, selectedSession.user_id)}
              disabled={loading}
            >
              {loading ? '처리 중...' : '강제 로그아웃'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Default export 추가
export default OnlineStatus;