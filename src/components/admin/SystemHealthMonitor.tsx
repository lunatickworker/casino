import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Separator } from '../ui/separator';
import { toast } from 'sonner@2.0.3';
import { 
  Activity, 
  Server, 
  Database, 
  Wifi, 
  WifiOff,
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Loader2,
  TrendingUp,
  Clock,
  Users,
  Zap
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWebSocketContext } from '../../contexts/WebSocketContext';
import { useAuth } from '../../hooks/useAuth';
import { investApi } from '../../lib/investApi';

interface HealthMetrics {
  database: {
    connected: boolean;
    responseTime: number;
    error?: string;
    lastChecked: Date;
  };
  websocket: {
    connected: boolean;
    connectionState: string;
    lastMessage?: Date;
    error?: string;
  };
  investApi: {
    connected: boolean;
    responseTime: number;
    error?: string;
    lastChecked: Date;
  };
  auth: {
    authenticated: boolean;
    userLevel: number;
    error?: string;
  };
}

const SystemHealthMonitor: React.FC = () => {
  const { connected: wsConnected, connectionState, lastMessage, sendMessage } = useWebSocketContext();
  const { authState } = useAuth();
  
  const [healthMetrics, setHealthMetrics] = useState<HealthMetrics>({
    database: { connected: false, responseTime: 0, lastChecked: new Date() },
    websocket: { connected: false, connectionState: 'disconnected' },
    investApi: { connected: false, responseTime: 0, lastChecked: new Date() },
    auth: { authenticated: false, userLevel: 0 }
  });

  const [isChecking, setIsChecking] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFullCheck, setLastFullCheck] = useState<Date | null>(null);

  // 실제 시스템 상태 확인 함수
  const checkSystemHealth = async () => {
    if (isChecking) return;
    setIsChecking(true);

    const newMetrics: HealthMetrics = {
      database: { connected: false, responseTime: 0, lastChecked: new Date() },
      websocket: { 
        connected: wsConnected, 
        connectionState,
        lastMessage: lastMessage ? new Date(lastMessage.timestamp) : undefined
      },
      investApi: { connected: false, responseTime: 0, lastChecked: new Date() },
      auth: { 
        authenticated: authState.isAuthenticated, 
        userLevel: authState.user?.level || 0 
      }
    };

    // 1. 데이터베이스 연결 상태 확인 (실제 Supabase 연결)
    try {
      const dbStart = Date.now();
      const { data, error } = await supabase.from('partners').select('count').limit(1);
      const responseTime = Date.now() - dbStart;
      
      newMetrics.database = {
        connected: !error,
        responseTime,
        lastChecked: new Date(),
        error: error?.message
      };

      if (error) {
        console.error('Database health check failed:', error);
        toast.error(`데이터베이스 연결 오류: ${error.message}`);
      }
    } catch (error) {
      const responseTime = Date.now() - Date.now();
      newMetrics.database = {
        connected: false,
        responseTime,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : '연결 실패'
      };
      console.error('Database connection test failed:', error);
      toast.error('데이터베이스 연결을 확인할 수 없습니다');
    }

    // 2. Invest API 연결 상태 확인 (실제 API 호출)
    if (authState.user?.opcode && authState.user?.secret_key) {
      try {
        const apiStart = Date.now();
        const result = await investApi.getInfo(
          authState.user.opcode,
          authState.user.secret_key
        );
        const responseTime = Date.now() - apiStart;

        newMetrics.investApi = {
          connected: !result.error && result.data,
          responseTime,
          lastChecked: new Date(),
          error: result.error || undefined
        };

        if (result.error) {
          console.error('Invest API health check failed:', result.error);
          toast.error(`Invest API 연결 오류: ${result.error}`);
        }
      } catch (error) {
        newMetrics.investApi = {
          connected: false,
          responseTime: 0,
          lastChecked: new Date(),
          error: error instanceof Error ? error.message : '연결 실패'
        };
        console.error('Invest API connection test failed:', error);
        toast.error('Invest API 연결을 확인할 수 없습니다');
      }
    } else {
      newMetrics.investApi = {
        connected: false,
        responseTime: 0,
        lastChecked: new Date(),
        error: 'API 설정 정보가 없습니다'
      };
    }

    // 3. WebSocket 실시간 상태 업데이트
    newMetrics.websocket = {
      connected: wsConnected,
      connectionState,
      lastMessage: lastMessage ? new Date(lastMessage.timestamp) : undefined,
      error: !wsConnected ? `연결 상태: ${connectionState}` : undefined
    };

    // 4. 인증 상태 확인
    newMetrics.auth = {
      authenticated: authState.isAuthenticated,
      userLevel: authState.user?.level || 0,
      error: !authState.isAuthenticated ? '로그인이 필요합니다' : undefined
    };

    setHealthMetrics(newMetrics);
    setLastFullCheck(new Date());
    setIsChecking(false);

    // 전체 시스템 상태 알림
    const totalSystems = 4;
    const healthySystems = [
      newMetrics.database.connected,
      newMetrics.websocket.connected,
      newMetrics.investApi.connected,
      newMetrics.auth.authenticated
    ].filter(Boolean).length;

    if (healthySystems === totalSystems) {
      toast.success('모든 시스템이 정상 작동 중입니다');
    } else if (healthySystems === 0) {
      toast.error('모든 시스템에 문제가 발생했습니다');
    } else {
      toast.warning(`${healthySystems}/${totalSystems} 시스템이 정상입니다`);
    }
  };

  // WebSocket 핑 테스트
  const testWebSocketConnection = async () => {
    if (!wsConnected) {
      toast.error('WebSocket이 연결되지 않았습니다');
      return;
    }

    try {
      const success = sendMessage('ping', { 
        test: true, 
        timestamp: Date.now(),
        from: 'health_monitor'
      });

      if (success) {
        toast.success('WebSocket 핑 전송 완료');
      } else {
        toast.error('WebSocket 핑 전송 실패');
      }
    } catch (error) {
      console.error('WebSocket ping test failed:', error);
      toast.error('WebSocket 테스트 중 오류 발생');
    }
  };



  // 자동 새로고침
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      checkSystemHealth();
    }, 30000); // 30초마다

    return () => clearInterval(interval);
  }, [autoRefresh, authState]);

  // WebSocket 상태 변화 감지
  useEffect(() => {
    setHealthMetrics(prev => ({
      ...prev,
      websocket: {
        connected: wsConnected,
        connectionState,
        lastMessage: lastMessage ? new Date(lastMessage.timestamp) : prev.websocket.lastMessage,
        error: !wsConnected ? `연결 상태: ${connectionState}` : undefined
      }
    }));
  }, [wsConnected, connectionState, lastMessage]);

  // 초기 로드
  useEffect(() => {
    checkSystemHealth();
  }, []);

  const getStatusIcon = (connected: boolean) => {
    return connected ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );
  };

  const getResponseTimeColor = (responseTime: number) => {
    if (responseTime < 100) return 'text-green-600';
    if (responseTime < 500) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getOverallHealthScore = () => {
    const systems = [
      healthMetrics.database.connected,
      healthMetrics.websocket.connected,
      healthMetrics.investApi.connected,
      healthMetrics.auth.authenticated
    ];
    const healthyCount = systems.filter(Boolean).length;
    return Math.round((healthyCount / systems.length) * 100);
  };

  const criticalIssues = [
    !healthMetrics.database.connected && healthMetrics.database.error,
    !healthMetrics.investApi.connected && healthMetrics.investApi.error,
    !healthMetrics.websocket.connected && healthMetrics.websocket.error,
    !healthMetrics.auth.authenticated && healthMetrics.auth.error
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2">
            <Activity className="h-6 w-6" />
            시스템 헬스 모니터
          </h1>
          <p className="text-muted-foreground">
            실제 연결 상태를 확인하고 시스템 건강도를 모니터링합니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '자동새로고침 끄기' : '자동새로고침 켜기'}
          </Button>
          <Button 
            onClick={checkSystemHealth} 
            disabled={isChecking}
            variant="outline"
          >
            {isChecking ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            상태 확인
          </Button>
        </div>
      </div>

      {/* 전체 상태 요약 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              시스템 전체 상태
            </span>
            <Badge 
              variant={getOverallHealthScore() === 100 ? "default" : 
                      getOverallHealthScore() > 50 ? "secondary" : "destructive"}
            >
              {getOverallHealthScore()}% 정상
            </Badge>
          </CardTitle>
          {lastFullCheck && (
            <CardDescription>
              마지막 확인: {lastFullCheck.toLocaleTimeString()}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Progress value={getOverallHealthScore()} className="mb-6" />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 데이터베이스 상태 */}
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  <span className="font-medium">Supabase DB</span>
                </div>
                {getStatusIcon(healthMetrics.database.connected)}
              </div>
              <div className="text-sm space-y-1">
                <p className={getResponseTimeColor(healthMetrics.database.responseTime)}>
                  응답: {healthMetrics.database.responseTime}ms
                </p>
                <p className="text-muted-foreground">
                  확인: {healthMetrics.database.lastChecked.toLocaleTimeString()}
                </p>
                {healthMetrics.database.error && (
                  <p className="text-red-500 text-xs">
                    {healthMetrics.database.error}
                  </p>
                )}
              </div>
            </div>

            {/* WebSocket 상태 */}
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {healthMetrics.websocket.connected ? (
                    <Wifi className="h-4 w-4" />
                  ) : (
                    <WifiOff className="h-4 w-4" />
                  )}
                  <span className="font-medium">WebSocket</span>
                </div>
                {getStatusIcon(healthMetrics.websocket.connected)}
              </div>
              <div className="text-sm space-y-1">
                <p className="text-muted-foreground">
                  상태: {healthMetrics.websocket.connectionState}
                </p>
                {healthMetrics.websocket.lastMessage && (
                  <p className="text-muted-foreground">
                    메시지: {healthMetrics.websocket.lastMessage.toLocaleTimeString()}
                  </p>
                )}
                {healthMetrics.websocket.error && (
                  <p className="text-red-500 text-xs">
                    {healthMetrics.websocket.error}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full mt-2"
                onClick={testWebSocketConnection}
                disabled={!healthMetrics.websocket.connected}
              >
                연결 테스트
              </Button>
            </div>

            {/* Invest API 상태 */}
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  <span className="font-medium">Invest API</span>
                </div>
                {getStatusIcon(healthMetrics.investApi.connected)}
              </div>
              <div className="text-sm space-y-1">
                <p className={getResponseTimeColor(healthMetrics.investApi.responseTime)}>
                  응답: {healthMetrics.investApi.responseTime}ms
                </p>
                <p className="text-muted-foreground">
                  확인: {healthMetrics.investApi.lastChecked.toLocaleTimeString()}
                </p>
                {healthMetrics.investApi.error && (
                  <p className="text-red-500 text-xs">
                    {healthMetrics.investApi.error}
                  </p>
                )}
              </div>
            </div>

            {/* 인증 상태 */}
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span className="font-medium">인증 시스템</span>
                </div>
                {getStatusIcon(healthMetrics.auth.authenticated)}
              </div>
              <div className="text-sm space-y-1">
                <p className="text-muted-foreground">
                  사용자: {authState.user?.username || 'N/A'}
                </p>
                <p className="text-muted-foreground">
                  권한 레벨: {healthMetrics.auth.userLevel}
                </p>
                {healthMetrics.auth.error && (
                  <p className="text-red-500 text-xs">
                    {healthMetrics.auth.error}
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>



      {/* 시스템 알림 */}
      {criticalIssues.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {criticalIssues.length}개의 시스템에 문제가 발생했습니다. 
            시스템 관리자에게 문의하거나 관련 서비스를 점검해 주세요.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default SystemHealthMonitor;