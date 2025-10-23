import { useState, useEffect } from "react";
import { Database, RefreshCw, TrendingUp, AlertTriangle, Users, Calculator } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { Alert, AlertDescription } from "../ui/alert";
import { toast } from "sonner@2.0.3";
import { Partner, Settlement } from "../../types";
import { supabase } from "../../lib/supabase";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { cn } from "../../lib/utils";
import { MetricCard } from "./MetricCard";

interface IntegratedSettlementProps {
  user: Partner;
}

interface SettlementStats {
  totalCommission: number;
  dailyAverage: number;
  monthlyGrowth: number;
  activePartners: number;
  totalBetVolume: number;
  avgCommissionRate: number;
}

export function IntegratedSettlement({ user }: IntegratedSettlementProps) {
  const { lastMessage, sendMessage } = useWebSocketContext();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // 데이터 상태
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  
  // 필터 상태
  const [periodFilter, setPeriodFilter] = useState("month");
  
  // 통계 데이터
  const [stats, setStats] = useState<SettlementStats>({
    totalCommission: 0,
    dailyAverage: 0,
    monthlyGrowth: 0,
    activePartners: 0,
    totalBetVolume: 0,
    avgCommissionRate: 0
  });

  // 동기화 상태
  const [syncStatus, setSyncStatus] = useState({
    lastSync: new Date(),
    isSync: true,
    errorCount: 0
  });

  // 데이터 로드 (깜박임 없이)
  const loadData = async (isInitial = false) => {
    try {
      if (isInitial) {
        setInitialLoading(true);
      }
      
      const dateFilter = getDateRange(periodFilter);
      
      // 모든 정산 데이터 로드
      let query = supabase
        .from('settlements')
        .select(`
          *,
          partner:partners!settlements_partner_id_fkey(id, nickname, level, commission_rolling, commission_losing)
        `)
        .gte('created_at', dateFilter.start)
        .lte('created_at', dateFilter.end);

      // 시스템관리자가 아니면 본인의 정산만 조회
      if (user.level > 1) {
        query = query.eq('partner_id', user.id);
      }

      const { data: settlementsData, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      setSettlements(settlementsData || []);

      // 통계 계산
      if (settlementsData) {
        await calculateStats(settlementsData);
      }

      // 실시간 동기화 상태 업데이트
      await updateSyncStatus();

    } catch (error) {
      console.error('데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      if (isInitial) {
        setInitialLoading(false);
      }
    }
  };

  // 통계 계산
  const calculateStats = async (data: Settlement[]) => {
    const totalCommission = data
      .filter(s => s.status === 'completed')
      .reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0);

    const totalBetVolume = data
      .reduce((sum, s) => sum + parseFloat(s.total_bet_amount.toString()), 0);

    const activePartners = new Set(data.map(s => s.partner_id)).size;

    const avgCommissionRate = data.length > 0
      ? data.reduce((sum, s) => sum + parseFloat(s.commission_rate.toString()), 0) / data.length
      : 0;

    // 일일 평균 계산
    const days = Math.max(1, Math.ceil((new Date().getTime() - new Date(getDateRange(periodFilter).start).getTime()) / (24 * 60 * 60 * 1000)));
    const dailyAverage = totalCommission / days;

    // 월별 성장률 계산 (이전 기간과 비교)
    const prevPeriodStart = new Date(new Date(getDateRange(periodFilter).start).getTime() - days * 24 * 60 * 60 * 1000);
    const { data: prevData } = await supabase
      .from('settlements')
      .select('commission_amount')
      .gte('created_at', prevPeriodStart.toISOString())
      .lt('created_at', getDateRange(periodFilter).start);

    const prevTotal = prevData?.reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0) || 0;
    const monthlyGrowth = prevTotal > 0 ? ((totalCommission - prevTotal) / prevTotal) * 100 : 0;

    setStats({
      totalCommission,
      dailyAverage,
      monthlyGrowth,
      activePartners,
      totalBetVolume,
      avgCommissionRate
    });
  };



  // 동기화 상태 업데이트
  const updateSyncStatus = async () => {
    try {
      const { data: syncLogs } = await supabase
        .from('api_sync_logs')
        .select('*')
        .eq('sync_type', 'settlement')
        .order('created_at', { ascending: false })
        .limit(1);

      if (syncLogs && syncLogs.length > 0) {
        const lastLog = syncLogs[0];
        setSyncStatus({
          lastSync: new Date(lastLog.created_at),
          isSync: lastLog.status === 'success',
          errorCount: lastLog.status === 'error' ? 1 : 0
        });
      }
    } catch (error) {
      console.error('동기화 상태 업데이트 실패:', error);
    }
  };

  // 날짜 범위 계산
  const getDateRange = (filter: string) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (filter) {
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - 7);
        return { start: weekStart.toISOString(), end: now.toISOString() };
      case 'month':
        const monthStart = new Date(today);
        monthStart.setMonth(today.getMonth() - 1);
        return { start: monthStart.toISOString(), end: now.toISOString() };
      case 'quarter':
        const quarterStart = new Date(today);
        quarterStart.setMonth(today.getMonth() - 3);
        return { start: quarterStart.toISOString(), end: now.toISOString() };
      default:
        return { start: monthStart.toISOString(), end: now.toISOString() };
    }
  };

  // 새로고침 실행
  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      
      // 외부 API 동기화 로직 실행
      const { data, error } = await supabase.rpc('sync_external_settlement_data');
      
      if (error) throw error;
      
      toast.success('새로고침이 완료되었습니다.');
      await loadData(false);
    } catch (error) {
      console.error('새로고침 실패:', error);
      toast.error('새로고침에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, []);

  // 필터 변경 시 자동 새로고침 (깜박임 없이)
  useEffect(() => {
    if (!initialLoading) {
      loadData(false);
    }
  }, [periodFilter]);

  // WebSocket 메시지 처리
  useEffect(() => {
    if (lastMessage) {
      switch (lastMessage.type) {
        case 'settlement_sync':
          loadData(false);
          break;
        case 'api_sync_complete':
          updateSyncStatus();
          break;
      }
    }
  }, [lastMessage]);

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">통합정산내역</h1>
          <p className="text-sm text-slate-400">모든 정산 데이터 통합 관리 및 분석</p>
        </div>
      </div>

      {/* 동기화 상태 알림 */}
      {!syncStatus.isSync && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            외부 API와 동기화 중 오류가 발생했습니다. 
            마지막 동기화: {syncStatus.lastSync.toLocaleString()}
          </AlertDescription>
        </Alert>
      )}

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-5">
        <MetricCard
          title="총 수수료"
          value={`₩${stats.totalCommission.toLocaleString()}`}
          subtitle="누적 수수료"
          icon={Calculator}
          color="green"
        />
        
        <MetricCard
          title="일일 평균"
          value={`₩${stats.dailyAverage.toLocaleString()}`}
          subtitle="평균 수수료"
          icon={TrendingUp}
          color="blue"
        />
        
        <MetricCard
          title="월별 성장률"
          value={`${stats.monthlyGrowth.toFixed(1)}%`}
          subtitle={stats.monthlyGrowth >= 0 ? "↑ 증가" : "↓ 감소"}
          icon={TrendingUp}
          color={stats.monthlyGrowth >= 0 ? 'green' : 'red'}
        />
        
        <MetricCard
          title="활성 파트너"
          value={`${stats.activePartners}개`}
          subtitle="운영 중"
          icon={Users}
          color="orange"
        />
        
        <MetricCard
          title="총 베팅량"
          value={`₩${stats.totalBetVolume.toLocaleString()}`}
          subtitle="누적 베팅"
          icon={Database}
          color="purple"
        />
        
        <MetricCard
          title="평균 수수료율"
          value={`${stats.avgCommissionRate.toFixed(2)}%`}
          subtitle="전체 평균"
          icon={Calculator}
          color="pink"
        />
      </div>

      {/* 통합 정산 내역 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            통합 정산 내역
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* 필터 */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-slate-300 whitespace-nowrap">기간</Label>
                <Select value={periodFilter} onValueChange={setPeriodFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">최근 7일</SelectItem>
                    <SelectItem value="month">최근 30일</SelectItem>
                    <SelectItem value="quarter">최근 90일</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleRefresh} disabled={refreshing} size="sm" className="btn-premium-primary">
                <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
                새로고침
              </Button>
            </div>

            {/* 정산 테이블 */}
            <DataTable
              enableSearch={false}
              columns={[
                {
                  header: "파트너",
                  cell: (row: any) => (
                    <div>
                      <p className="font-medium">{row.partner?.nickname}</p>
                      <p className="text-sm text-slate-500">레벨 {row.partner?.level}</p>
                    </div>
                  )
                },
                {
                  key: "settlement_type",
                  header: "정산 타입",
                  cell: (row: any) => (
                    <Badge variant={row.settlement_type === 'rolling' ? 'default' : 'secondary'}>
                      {row.settlement_type === 'rolling' ? '롤링' : '루징'}
                    </Badge>
                  )
                },
                {
                  key: "total_bet_amount",
                  header: "총 베팅",
                  cell: (row: any) => `₩${parseFloat(row.total_bet_amount).toLocaleString()}`
                },
                {
                  key: "total_win_amount",
                  header: "총 당첨",
                  cell: (row: any) => `₩${parseFloat(row.total_win_amount).toLocaleString()}`
                },
                {
                  key: "commission_amount",
                  header: "수수료",
                  cell: (row: any) => (
                    <span className="font-semibold text-green-600">
                      ₩{parseFloat(row.commission_amount).toLocaleString()}
                    </span>
                  )
                },
                {
                  key: "auto_calculated",
                  header: "자동 처리",
                  cell: (row: any) => (
                    <Badge variant={row.auto_calculated ? 'default' : 'outline'}>
                      {row.auto_calculated ? '자동' : '수동'}
                    </Badge>
                  )
                },
                {
                  key: "processed_at",
                  header: "처리일",
                  cell: (row: any) => row.processed_at ? 
                    new Date(row.processed_at).toLocaleString() : '-'
                }
              ]}
              data={settlements}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default IntegratedSettlement;