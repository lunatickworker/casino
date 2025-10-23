import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { 
  Activity, 
  CheckCircle, 
  AlertTriangle, 
  Clock,
  RefreshCw,
  Database,
  Gamepad2
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { MetricCard } from "./MetricCard";

interface ApiSyncLog {
  id: string;
  opcode: string;
  api_endpoint: string;
  sync_type: string;
  status: string;
  records_processed: number;
  error_message: string | null;
  response_data: any;
  sync_duration_ms: number;
  created_at: string;
}

export function AutoSyncMonitor() {
  const [logs, setLogs] = useState<ApiSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    success: 0,
    error: 0,
    lastSync: null as string | null
  });

  // 로그 조회
  const fetchLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('api_sync_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setLogs(data || []);
      
      // 통계 계산
      if (data && data.length > 0) {
        setStats({
          total: data.length,
          success: data.filter(log => log.status === 'success').length,
          error: data.filter(log => log.status === 'error').length,
          lastSync: data[0].created_at
        });
      }
    } catch (error) {
      console.error('❌ 동기화 로그 조회 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  // 한국 시간(KST)으로 변환
  const formatKST = (utcDateString: string) => {
    const date = new Date(utcDateString);
    // UTC에서 KST로 변환 (UTC + 9시간)
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    
    const year = kstDate.getUTCFullYear();
    const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getUTCDate()).padStart(2, '0');
    const hours = String(kstDate.getUTCHours()).padStart(2, '0');
    const minutes = String(kstDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(kstDate.getUTCSeconds()).padStart(2, '0');
    
    return `${year}년${month}월${day}일 ${hours}:${minutes}:${seconds}`;
  };

  // 초기 로드
  useEffect(() => {
    fetchLogs();
  }, []);

  // Realtime 구독
  useEffect(() => {
    const channel = supabase
      .channel('api_sync_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'api_sync_logs'
        },
        (payload) => {
          console.log('🔄 새로운 동기화 로그:', payload);
          fetchLogs(); // 새 로그가 들어오면 다시 조회
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
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
      case 'success':
        return <Badge className="bg-green-600">성공</Badge>;
      case 'error':
        return <Badge variant="destructive">오류</Badge>;
      default:
        return <Badge variant="outline">대기</Badge>;
    }
  };

  const getSyncTypeInfo = (syncType: string) => {
    switch (syncType) {
      case 'balance':
        return { icon: <Database className="h-4 w-4 text-blue-400" />, label: '잔고 동기화' };
      case 'game_history':
        return { icon: <Gamepad2 className="h-4 w-4 text-green-400" />, label: '게임 기록' };
      default:
        return { icon: <Activity className="h-4 w-4 text-purple-400" />, label: syncType };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="h-6 w-6" />
            자동 동기화 모니터
          </h2>
          <p className="text-slate-400 mt-1">
            실시간 API 동기화 상태를 확인합니다
          </p>
        </div>
        <Button
          onClick={fetchLogs}
          className="bg-slate-700 hover:bg-slate-600"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          새로고침
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <MetricCard
          title="총 동기화"
          value={stats.total.toLocaleString()}
          subtitle="전체 동기화"
          icon={RefreshCw}
          color="blue"
        />
        
        <MetricCard
          title="성공"
          value={stats.success.toLocaleString()}
          subtitle="성공한 동기화"
          icon={CheckCircle}
          color="green"
        />
        
        <MetricCard
          title="오류"
          value={stats.error.toLocaleString()}
          subtitle="실패한 동기화"
          icon={AlertTriangle}
          color="red"
        />
        
        <MetricCard
          title="마지막 동기화"
          value={stats.lastSync ? formatKST(stats.lastSync) : '-'}
          subtitle="최근 실행"
          icon={Clock}
          color="purple"
        />
      </div>

      {/* 로그 목록 */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">동기화 로그</CardTitle>
          <CardDescription className="text-slate-400">
            최근 50개의 동기화 기록 (실시간 업데이트)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-3">
              {logs.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  동기화 로그가 없습니다
                </div>
              ) : (
                logs.map((log) => {
                  const syncTypeInfo = getSyncTypeInfo(log.sync_type);
                  
                  return (
                    <div
                      key={log.id}
                      className="p-4 bg-slate-700/30 rounded-lg border border-slate-600 hover:bg-slate-700/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {syncTypeInfo.icon}
                          <span className="text-white font-medium">{syncTypeInfo.label}</span>
                          {getStatusBadge(log.status)}
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(log.status)}
                          <span className="text-slate-400 text-sm font-mono">
                            {log.sync_duration_ms}ms
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-slate-400">OPCODE:</span>
                          <span className="text-white ml-2 font-mono">{log.opcode}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">처리 건수:</span>
                          <span className="text-white ml-2">{log.records_processed}건</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-slate-400">시간:</span>
                          <span className="text-white ml-2 font-mono text-xs">
                            {formatKST(log.created_at)}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-slate-400">API:</span>
                          <span className="text-white ml-2 font-mono text-xs">
                            {log.api_endpoint}
                          </span>
                        </div>
                      </div>

                      {log.error_message && (
                        <div className="mt-2 p-2 bg-red-900/20 border border-red-500/30 rounded">
                          <div className="text-red-400 text-sm">
                            오류: {log.error_message}
                          </div>
                        </div>
                      )}

                      {log.response_data && (
                        <details className="mt-2">
                          <summary className="text-slate-400 text-xs cursor-pointer hover:text-white">
                            응답 데이터 보기
                          </summary>
                          <pre className="mt-2 p-2 bg-slate-900 rounded text-xs text-slate-300 overflow-x-auto">
                            {JSON.stringify(log.response_data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
