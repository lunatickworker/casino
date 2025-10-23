import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { 
  RefreshCw, 
  Database, 
  Users, 
  Gamepad2,
  CheckCircle,
  AlertTriangle,
  Clock,
  Activity,
  Settings,
  Play,
  Pause,
  Zap
} from "lucide-react";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { supabase } from "../../lib/supabase";
import { 
  getAllAccountBalances,
  getGameHistory,
  getInfo
} from "../../lib/investApi";
import { toast } from "sonner@2.0.3";

interface SyncStatus {
  type: 'balance' | 'game_history' | 'user_info';
  status: 'idle' | 'running' | 'success' | 'error';
  lastSync: Date | null;
  nextSync: Date | null;
  recordsProcessed: number;
  errorMessage?: string;
}

interface Partner {
  id: string;
  nickname: string;
  opcode: string;
  secret_key: string;
  api_token: string;
}

export function ApiSyncManager() {
  const { connected, sendMessage } = useWebSocketContext();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(true);
  const [syncInterval, setSyncInterval] = useState(30); // 30초
  const [partners, setPartners] = useState<Partner[]>([]);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, SyncStatus[]>>({});
  const [currentProgress, setCurrentProgress] = useState(0);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [lastFullSync, setLastFullSync] = useState<Date | null>(null);

  // 대본사 목록 조회
  const fetchPartners = async () => {
    try {
      const { data, error } = await supabase
        .from('partners')
        .select('id, nickname, opcode, secret_key, api_token')
        .eq('partner_type', 'head_office')
        .eq('status', 'active')
        .not('opcode', 'is', null);

      if (error) throw error;

      setPartners(data || []);
      
      // 초기 동기화 상태 설정
      const initialStatuses: Record<string, SyncStatus[]> = {};
      (data || []).forEach(partner => {
        initialStatuses[partner.id] = [
          {
            type: 'balance',
            status: 'idle',
            lastSync: null,
            nextSync: null,
            recordsProcessed: 0
          },
          {
            type: 'game_history',
            status: 'idle',
            lastSync: null,
            nextSync: null,
            recordsProcessed: 0
          },
          {
            type: 'user_info',
            status: 'idle',
            lastSync: null,
            nextSync: null,
            recordsProcessed: 0
          }
        ];
      });
      setSyncStatuses(initialStatuses);
    } catch (error) {
      console.error('대본사 목록 조회 오류:', error);
      toast.error('대본사 목록을 불러오는데 실패했습니다.');
    }
  };

  // 단일 파트너 잔고 동기화
  const syncPartnerBalances = async (partner: Partner): Promise<boolean> => {
    try {
      setSyncStatuses(prev => ({
        ...prev,
        [partner.id]: prev[partner.id]?.map(status => 
          status.type === 'balance' 
            ? { ...status, status: 'running', recordsProcessed: 0 }
            : status
        ) || []
      }));

      const result = await getAllAccountBalances(partner.opcode, partner.secret_key);
      
      if (result.error) {
        throw new Error(result.error);
      }

      // 동기화 로그 기록
      await supabase
        .from('api_sync_logs')
        .insert([{
          opcode: partner.opcode,
          api_endpoint: '/api/account/balance',
          sync_type: 'balance',
          status: 'success',
          records_processed: result.data?.users?.length || 0,
          response_data: result.data
        }]);

      setSyncStatuses(prev => ({
        ...prev,
        [partner.id]: prev[partner.id]?.map(status => 
          status.type === 'balance' 
            ? { 
                ...status, 
                status: 'success', 
                lastSync: new Date(),
                recordsProcessed: result.data?.users?.length || 0
              }
            : status
        ) || []
      }));

      return true;
    } catch (error) {
      console.error(`${partner.nickname} 잔고 동기화 오류:`, error);
      
      await supabase
        .from('api_sync_logs')
        .insert([{
          opcode: partner.opcode,
          api_endpoint: '/api/account/balance',
          sync_type: 'balance',
          status: 'error',
          error_message: error instanceof Error ? error.message : '알 수 없는 오류'
        }]);

      setSyncStatuses(prev => ({
        ...prev,
        [partner.id]: prev[partner.id]?.map(status => 
          status.type === 'balance' 
            ? { 
                ...status, 
                status: 'error', 
                errorMessage: error instanceof Error ? error.message : '알 수 없는 오류'
              }
            : status
        ) || []
      }));

      return false;
    }
  };

  // 단일 파트너 게임 내역 동기화
  const syncPartnerGameHistory = async (partner: Partner): Promise<boolean> => {
    try {
      setSyncStatuses(prev => ({
        ...prev,
        [partner.id]: prev[partner.id]?.map(status => 
          status.type === 'game_history' 
            ? { ...status, status: 'running', recordsProcessed: 0 }
            : status
        ) || []
      }));

      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString();
      
      const result = await getGameHistory(partner.opcode, year, month, 0, 1000, partner.secret_key);
      
      if (result.error) {
        throw new Error(result.error);
      }

      // 동기화 로그 기록
      await supabase
        .from('api_sync_logs')
        .insert([{
          opcode: partner.opcode,
          api_endpoint: '/api/game/historyindex',
          sync_type: 'game_history',
          status: 'success',
          records_processed: result.data?.history?.length || 0,
          response_data: result.data
        }]);

      setSyncStatuses(prev => ({
        ...prev,
        [partner.id]: prev[partner.id]?.map(status => 
          status.type === 'game_history' 
            ? { 
                ...status, 
                status: 'success', 
                lastSync: new Date(),
                recordsProcessed: result.data?.history?.length || 0
              }
            : status
        ) || []
      }));

      return true;
    } catch (error) {
      console.error(`${partner.nickname} 게임 내역 동기화 오류:`, error);
      
      await supabase
        .from('api_sync_logs')
        .insert([{
          opcode: partner.opcode,
          api_endpoint: '/api/game/historyindex',
          sync_type: 'game_history',
          status: 'error',
          error_message: error instanceof Error ? error.message : '알 수 없는 오류'
        }]);

      setSyncStatuses(prev => ({
        ...prev,
        [partner.id]: prev[partner.id]?.map(status => 
          status.type === 'game_history' 
            ? { 
                ...status, 
                status: 'error', 
                errorMessage: error instanceof Error ? error.message : '알 수 없는 오류'
              }
            : status
        ) || []
      }));

      return false;
    }
  };

  // 전체 동기화 실행
  const performFullSync = async () => {
    if (partners.length === 0) {
      toast.warning('동기화할 대본사가 없습니다.');
      return;
    }

    setIsManualSyncing(true);
    setCurrentProgress(0);
    
    let completedTasks = 0;
    const totalTasks = partners.length * 2; // 각 파트너당 잔고 + 게임내역

    for (const partner of partners) {
      // 잔고 동기화
      await syncPartnerBalances(partner);
      completedTasks++;
      setCurrentProgress((completedTasks / totalTasks) * 100);
      
      // 짧은 대기
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 게임 내역 동기화
      await syncPartnerGameHistory(partner);
      completedTasks++;
      setCurrentProgress((completedTasks / totalTasks) * 100);
      
      // 파트너 간 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setLastFullSync(new Date());
    setIsManualSyncing(false);
    setCurrentProgress(0);
    
    // WebSocket으로 동기화 완료 알림
    if (connected && sendMessage) {
      sendMessage('sync_completed', {
        timestamp: new Date().toISOString(),
        partners_synced: partners.length
      });
    }

    toast.success(`${partners.length}개 대본사 동기화가 완료되었습니다.`);
  };

  // 자동 동기화 스케줄러
  useEffect(() => {
    if (isAutoSyncEnabled && partners.length > 0) {
      const startAutoSync = () => {
        intervalRef.current = setInterval(async () => {
          console.log('자동 동기화 실행 중...');
          await performFullSync();
        }, syncInterval * 1000);
      };

      startAutoSync();

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [isAutoSyncEnabled, syncInterval, partners]);

  // 컴포넌트 마운트시 파트너 목록 조회
  useEffect(() => {
    fetchPartners();
  }, []);

  // 다음 동기화 시간 계산
  const getNextSyncTime = () => {
    if (!isAutoSyncEnabled || !lastFullSync) return null;
    return new Date(lastFullSync.getTime() + syncInterval * 1000);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <LoadingSpinner size="sm" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge variant="secondary" className="animate-pulse">동기화 중</Badge>;
      case 'success':
        return <Badge className="bg-green-600">완료</Badge>;
      case 'error':
        return <Badge variant="destructive">오류</Badge>;
      default:
        return <Badge variant="outline">대기</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <RefreshCw className={`h-6 w-6 ${isManualSyncing ? 'animate-spin' : ''}`} />
            API 동기화 관리
          </h2>
          <p className="text-slate-400 mt-1">
            외부 API와 30초 주기 자동 동기화를 관리합니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={performFullSync}
            disabled={isManualSyncing || partners.length === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isManualSyncing ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                동기화 중
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                수동 동기화
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 동기화 설정 */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Settings className="h-5 w-5" />
            동기화 설정
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-white">자동 동기화</Label>
                <p className="text-slate-400 text-sm">
                  자동으로 주기적 동기화 실행
                </p>
              </div>
              <Switch
                checked={isAutoSyncEnabled}
                onCheckedChange={setIsAutoSyncEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-white">동기화 간격 (초)</Label>
              <select
                value={syncInterval}
                onChange={(e) => setSyncInterval(Number(e.target.value))}
                className="w-full p-2 bg-slate-700/50 border border-slate-600 rounded text-white"
                disabled={isManualSyncing}
              >
                <option value={30}>30초</option>
                <option value={60}>1분</option>
                <option value={300}>5분</option>
                <option value={600}>10분</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-white">다음 동기화</Label>
              <div className="p-2 bg-slate-700/50 rounded text-white text-sm">
                {getNextSyncTime() ? getNextSyncTime()!.toLocaleTimeString('ko-KR') : '자동 동기화 비활성'}
              </div>
            </div>
          </div>

          {isManualSyncing && (
            <div className="space-y-2">
              <Label className="text-white">진행률</Label>
              <Progress value={currentProgress} className="w-full" />
              <p className="text-slate-400 text-sm text-center">
                {Math.round(currentProgress)}% 완료
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{partners.length}</div>
              <div className="text-slate-400 text-sm">등록된 대본사</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">
                {lastFullSync ? lastFullSync.toLocaleTimeString('ko-KR') : '-'}
              </div>
              <div className="text-slate-400 text-sm">마지막 동기화</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">
                {Object.values(syncStatuses).flat().filter(s => s.status === 'success').length}
              </div>
              <div className="text-slate-400 text-sm">성공한 작업</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 파트너별 동기화 상태 */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="h-5 w-5" />
            파트너별 동기화 상태
          </CardTitle>
          <CardDescription className="text-slate-400">
            각 대본사별 API 동기화 현황을 확인합니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          {partners.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              등록된 대본사가 없습니다
            </div>
          ) : (
            <div className="space-y-4">
              {partners.map((partner) => (
                <div key={partner.id} className="border border-slate-600 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-white font-medium">{partner.nickname}</h3>
                      <p className="text-slate-400 text-sm">OPCODE: {partner.opcode}</p>
                    </div>
                    <Badge variant="outline" className="font-mono">
                      {syncStatuses[partner.id]?.filter(s => s.status === 'success').length || 0} / 
                      {syncStatuses[partner.id]?.length || 0} 완료
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {syncStatuses[partner.id]?.map((sync) => (
                      <div key={sync.type} className="flex items-center justify-between p-3 bg-slate-700/30 rounded">
                        <div className="flex items-center gap-2">
                          {sync.type === 'balance' && <Database className="h-4 w-4 text-blue-400" />}
                          {sync.type === 'game_history' && <Gamepad2 className="h-4 w-4 text-green-400" />}
                          {sync.type === 'user_info' && <Users className="h-4 w-4 text-purple-400" />}
                          <div>
                            <div className="text-white text-sm font-medium">
                              {sync.type === 'balance' && '잔고 동기화'}
                              {sync.type === 'game_history' && '게임 내역'}
                              {sync.type === 'user_info' && '사용자 정보'}
                            </div>
                            {sync.lastSync && (
                              <div className="text-slate-400 text-xs">
                                {sync.lastSync.toLocaleTimeString('ko-KR')}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(sync.status)}
                          {getStatusBadge(sync.status)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 오류 메시지 표시 */}
                  {syncStatuses[partner.id]?.some(s => s.errorMessage) && (
                    <div className="mt-3 p-2 bg-red-900/20 border border-red-500/30 rounded">
                      <div className="text-red-400 text-sm">
                        오류: {syncStatuses[partner.id]?.find(s => s.errorMessage)?.errorMessage}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}