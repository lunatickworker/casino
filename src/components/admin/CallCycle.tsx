import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Separator } from "../ui/separator";
import { 
  Clock, 
  Play, 
  Pause, 
  Settings, 
  Database, 
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Zap
} from "lucide-react";
import { Partner } from "../../types";
import { toast } from "sonner@2.0.3";

interface CallCycleProps {
  user: Partner;
}

interface CycleSettings {
  balance_sync_interval: number;
  game_history_interval: number;
  user_status_interval: number;
  betting_sync_interval: number;
  auto_settlement_enabled: boolean;
  settlement_interval: number;
  api_timeout: number;
  max_retry_count: number;
}

interface CycleStatus {
  balance_sync: { status: string; last_run: string; next_run: string };
  game_history: { status: string; last_run: string; next_run: string };
  user_status: { status: string; last_run: string; next_run: string };
  betting_sync: { status: string; last_run: string; next_run: string };
  settlement: { status: string; last_run: string; next_run: string };
}

export function CallCycle({ user }: CallCycleProps) {
  const [settings, setSettings] = useState<CycleSettings>({
    balance_sync_interval: 30,
    game_history_interval: 60,
    user_status_interval: 120,
    betting_sync_interval: 45,
    auto_settlement_enabled: true,
    settlement_interval: 300,
    api_timeout: 30,
    max_retry_count: 3,
  });

  const [status, setStatus] = useState<CycleStatus>({
    balance_sync: { status: 'running', last_run: '2024-01-20 14:30:15', next_run: '2024-01-20 14:31:15' },
    game_history: { status: 'running', last_run: '2024-01-20 14:29:45', next_run: '2024-01-20 14:30:45' },
    user_status: { status: 'paused', last_run: '2024-01-20 14:28:30', next_run: '2024-01-20 14:30:30' },
    betting_sync: { status: 'running', last_run: '2024-01-20 14:30:00', next_run: '2024-01-20 14:30:45' },
    settlement: { status: 'running', last_run: '2024-01-20 14:25:00', next_run: '2024-01-20 14:30:00' },
  });

  const [isLoading, setIsLoading] = useState(false);

  // 권한 확인
  const canManageCallCycle = user.level <= 2; // 시스템관리자, 대본사만 가능

  if (!canManageCallCycle) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1>API 호출 주기 관리</h1>
        </div>
        
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            이 기능은 시스템관리자 및 대본사만 접근할 수 있습니다.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleSettingUpdate = async (key: keyof CycleSettings, value: number | boolean) => {
    setIsLoading(true);
    try {
      setSettings(prev => ({ ...prev, [key]: value }));
      toast.success('설정이 업데이트되었습니다.');
    } catch (error) {
      toast.error('설정 업데이트에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCycle = async (cycleType: string, action: 'start' | 'stop') => {
    setIsLoading(true);
    try {
      setStatus(prev => ({
        ...prev,
        [cycleType]: {
          ...prev[cycleType as keyof CycleStatus],
          status: action === 'start' ? 'running' : 'paused'
        }
      }));
      toast.success(`${cycleType} 주기가 ${action === 'start' ? '시작' : '중지'}되었습니다.`);
    } catch (error) {
      toast.error('작업 실행에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />실행중</Badge>;
      case 'paused':
        return <Badge variant="secondary"><Pause className="h-3 w-3 mr-1" />중지됨</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />오류</Badge>;
      default:
        return <Badge variant="outline">알 수 없음</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>API 호출 주기 관리</h1>
          <p className="text-muted-foreground">
            Invest API와의 동기화 주기를 설정하고 관리합니다.
          </p>
        </div>
      </div>

      {/* 현재 상태 개요 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(status).map(([key, value]) => (
          <Card key={key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {key === 'balance_sync' && '잔고 동기화'}
                  {key === 'game_history' && '게임 기록'}
                  {key === 'user_status' && '사용자 상태'}
                  {key === 'betting_sync' && '베팅 동기화'}
                  {key === 'settlement' && '정산 처리'}
                </CardTitle>
                {getStatusBadge(value.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs text-muted-foreground">
                마지막 실행: {value.last_run}
              </div>
              <div className="text-xs text-muted-foreground">
                다음 실행: {value.next_run}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleCycle(key, value.status === 'running' ? 'stop' : 'start')}
                  disabled={isLoading}
                >
                  {value.status === 'running' ? (
                    <><Pause className="h-3 w-3 mr-1" />중지</>
                  ) : (
                    <><Play className="h-3 w-3 mr-1" />시작</>
                  )}
                </Button>
                <Button size="sm" variant="ghost">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 설정 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 동기화 간격 설정 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              동기화 간격 설정
            </CardTitle>
            <CardDescription>
              각 API 호출의 간격을 초 단위로 설정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>잔고 동기화 (초)</Label>
              <Input
                type="number"
                value={settings.balance_sync_interval}
                onChange={(e) => handleSettingUpdate('balance_sync_interval', parseInt(e.target.value))}
                min="10"
                max="300"
              />
              <p className="text-xs text-muted-foreground">권장: 30초 이상</p>
            </div>

            <div className="space-y-2">
              <Label>게임 기록 동기화 (초)</Label>
              <Input
                type="number"
                value={settings.game_history_interval}
                onChange={(e) => handleSettingUpdate('game_history_interval', parseInt(e.target.value))}
                min="30"
                max="600"
              />
              <p className="text-xs text-muted-foreground">권장: 60초 이상</p>
            </div>

            <div className="space-y-2">
              <Label>사용자 상태 확인 (초)</Label>
              <Input
                type="number"
                value={settings.user_status_interval}
                onChange={(e) => handleSettingUpdate('user_status_interval', parseInt(e.target.value))}
                min="60"
                max="3600"
              />
            </div>

            <div className="space-y-2">
              <Label>베팅 동기화 (초)</Label>
              <Input
                type="number"
                value={settings.betting_sync_interval}
                onChange={(e) => handleSettingUpdate('betting_sync_interval', parseInt(e.target.value))}
                min="15"
                max="300"
              />
            </div>
          </CardContent>
        </Card>

        {/* 고급 설정 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              고급 설정
            </CardTitle>
            <CardDescription>
              API 타임아웃 및 재시도 정책을 설정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>자동 정산 활성화</Label>
                <p className="text-xs text-muted-foreground">
                  일정 시간마다 자동으로 정산을 처리합니다.
                </p>
              </div>
              <Switch
                checked={settings.auto_settlement_enabled}
                onCheckedChange={(checked) => handleSettingUpdate('auto_settlement_enabled', checked)}
              />
            </div>

            {settings.auto_settlement_enabled && (
              <div className="space-y-2">
                <Label>정산 간격 (초)</Label>
                <Input
                  type="number"
                  value={settings.settlement_interval}
                  onChange={(e) => handleSettingUpdate('settlement_interval', parseInt(e.target.value))}
                  min="60"
                  max="3600"
                />
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label>API 타임아웃 (초)</Label>
              <Input
                type="number"
                value={settings.api_timeout}
                onChange={(e) => handleSettingUpdate('api_timeout', parseInt(e.target.value))}
                min="10"
                max="120"
              />
            </div>

            <div className="space-y-2">
              <Label>최대 재시도 횟수</Label>
              <Input
                type="number"
                value={settings.max_retry_count}
                onChange={(e) => handleSettingUpdate('max_retry_count', parseInt(e.target.value))}
                min="1"
                max="10"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 주의사항 */}
      <Alert>
        <Zap className="h-4 w-4" />
        <AlertDescription>
          <strong>주의사항:</strong> API 호출 간격을 너무 짧게 설정하면 서버에 부하를 줄 수 있습니다. 
          잔고 동기화는 최소 30초, 게임 기록은 최소 60초 간격을 권장합니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export default CallCycle;