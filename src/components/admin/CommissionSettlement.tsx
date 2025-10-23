import { useState, useEffect } from "react";
import { Calculator, Download, RefreshCw, TrendingUp, TrendingDown, Search, Calendar, Info } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar as CalendarComponent } from "../ui/calendar";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle } from "./AdminDialog";
import { Label } from "../ui/label";
import { toast } from "sonner@2.0.3";
import { Partner, Settlement } from "../../types";
import { supabase } from "../../lib/supabase";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { cn } from "../../lib/utils";
import { MetricCard } from "./MetricCard";

interface CommissionSettlementProps {
  user: Partner;
}

export function CommissionSettlement({ user }: CommissionSettlementProps) {
  const { lastMessage, sendMessage } = useWebSocketContext();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // 데이터 상태
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  
  // 필터 상태 (간소화)
  const [settlementType, setSettlementType] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("today");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  
  // 자동 정산 계산 정보 다이얼로그
  const [showCalculationDialog, setShowCalculationDialog] = useState(false);
  const [calculationInfo, setCalculationInfo] = useState<any>(null);
  
  // 통계 데이터
  const [stats, setStats] = useState({
    totalRollingCommission: 0,
    totalLosingCommission: 0,
    pendingSettlements: 0,
    completedSettlements: 0,
    totalBetAmount: 0,
    avgCommissionRate: 0
  });

  // 데이터 로드 (깜박임 없이)
  const loadData = async (isInitial = false) => {
    try {
      if (isInitial) {
        setInitialLoading(true);
      }
      
      const dateFilter = getDateRange(periodFilter, dateRange);
      
      // 정산 데이터 로드 (롤링/루징만)
      let query = supabase
        .from('settlements')
        .select(`
          *,
          partner:partners!settlements_partner_id_fkey(id, nickname, level, commission_rolling, commission_losing)
        `)
        .in('settlement_type', ['rolling', 'losing'])
        .gte('created_at', dateFilter.start)
        .lte('created_at', dateFilter.end);

      // 권한에 따른 필터링
      // 시스템관리자가 아니면 본인의 정산만 조회
      if (user.level > 1) {
        query = query.eq('partner_id', user.id);
      }

      const { data: settlementsData, error: settlementsError } = await query
        .order('created_at', { ascending: false });

      if (settlementsError) throw settlementsError;

      // 파트너 목록 로드 (최초 1회만)
      if (isInitial || partners.length === 0) {
        let partnerQuery = supabase
          .from('partners')
          .select('id, nickname, level, commission_rolling, commission_losing')
          .neq('level', 6); // 사용자 제외

        // 시스템관리자가 아니면 본인만 조회
        if (user.level > 1) {
          partnerQuery = partnerQuery.eq('id', user.id);
        }

        const { data: partnersData, error: partnersError } = await partnerQuery
          .order('level')
          .order('nickname');

        if (partnersError) throw partnersError;
        setPartners(partnersData || []);
      }

      setSettlements(settlementsData || []);

      // 통계 계산
      if (settlementsData) {
        const rollingSum = settlementsData
          .filter(s => s.settlement_type === 'rolling' && s.status === 'completed')
          .reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0);
        
        const losingSum = settlementsData
          .filter(s => s.settlement_type === 'losing' && s.status === 'completed')
          .reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0);
        
        const pendingCount = settlementsData.filter(s => s.status === 'pending').length;
        const completedCount = settlementsData.filter(s => s.status === 'completed').length;
        
        const totalBet = settlementsData
          .reduce((sum, s) => sum + parseFloat(s.total_bet_amount.toString()), 0);
        
        const avgRate = settlementsData.length > 0
          ? settlementsData.reduce((sum, s) => sum + parseFloat(s.commission_rate.toString()), 0) / settlementsData.length
          : 0;

        setStats({
          totalRollingCommission: rollingSum,
          totalLosingCommission: losingSum,
          pendingSettlements: pendingCount,
          completedSettlements: completedCount,
          totalBetAmount: totalBet,
          avgCommissionRate: avgRate
        });
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      if (isInitial) {
        setInitialLoading(false);
      }
    }
  };

  // 날짜 범위 계산
  const getDateRange = (filter: string, customRange?: DateRange) => {
    if (customRange?.from && customRange?.to) {
      return {
        start: customRange.from.toISOString(),
        end: new Date(customRange.to.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString()
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (filter) {
      case 'today':
        return { start: today.toISOString(), end: now.toISOString() };
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - 7);
        return { start: weekStart.toISOString(), end: now.toISOString() };
      case 'month':
        const monthStart = new Date(today);
        monthStart.setMonth(today.getMonth() - 1);
        return { start: monthStart.toISOString(), end: now.toISOString() };
      default:
        return { start: today.toISOString(), end: now.toISOString() };
    }
  };

  // 정산 승인/거절 처리
  const handleSettlementAction = async (settlementId: string, action: 'approve' | 'reject') => {
    try {
      const { error } = await supabase
        .from('settlements')
        .update({
          status: action === 'approve' ? 'completed' : 'rejected',
          processed_at: new Date().toISOString()
        })
        .eq('id', settlementId);

      if (error) throw error;

      toast.success(`정산이 ${action === 'approve' ? '승인' : '거절'}되었습니다.`);
      
      // WebSocket으로 실시간 알림
      sendMessage({
        type: 'settlement_processed',
        data: { settlementId, action, processedBy: user.nickname }
      });
      
      await loadData(false);
    } catch (error) {
      console.error('정산 처리 실패:', error);
      toast.error('정산 처리에 실패했습니다.');
    }
  };

  // 자동 정산 실행
  const handleAutoSettlement = async () => {
    try {
      setRefreshing(true);
      
      // 자동 정산 전 계산 정보 조회
      const { data: settlementsData, error: queryError } = await supabase
        .from('settlements')
        .select(`
          *,
          partner:partners!settlements_partner_id_fkey(id, nickname, commission_rolling, commission_losing)
        `)
        .eq('status', 'pending')
        .in('settlement_type', ['rolling', 'losing']);

      if (queryError) throw queryError;

      // 계산 정보 준비
      const rollingSettlements = (settlementsData || []).filter(s => s.settlement_type === 'rolling');
      const losingSettlements = (settlementsData || []).filter(s => s.settlement_type === 'losing');

      const calculationDetails = {
        rolling: {
          count: rollingSettlements.length,
          totalBet: rollingSettlements.reduce((sum, s) => sum + parseFloat(s.total_bet_amount.toString()), 0),
          totalCommission: rollingSettlements.reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0),
          formula: '롤링 수수료 = 총 베팅액 × 롤링 수수료율',
          items: rollingSettlements.map(s => ({
            partner: s.partner?.nickname,
            betAmount: parseFloat(s.total_bet_amount.toString()),
            rate: parseFloat(s.commission_rate.toString()),
            commission: parseFloat(s.commission_amount.toString())
          }))
        },
        losing: {
          count: losingSettlements.length,
          totalLoss: losingSettlements.reduce((sum, s) => sum + (parseFloat(s.total_bet_amount.toString()) - parseFloat(s.total_win_amount.toString())), 0),
          totalCommission: losingSettlements.reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0),
          formula: '루징 수수료 = (베팅액 - 당첨액) × 루징 수수료율',
          items: losingSettlements.map(s => ({
            partner: s.partner?.nickname,
            betAmount: parseFloat(s.total_bet_amount.toString()),
            winAmount: parseFloat(s.total_win_amount.toString()),
            loss: parseFloat(s.total_bet_amount.toString()) - parseFloat(s.total_win_amount.toString()),
            rate: parseFloat(s.commission_rate.toString()),
            commission: parseFloat(s.commission_amount.toString())
          }))
        },
        totalCount: (settlementsData || []).length,
        totalCommission: (settlementsData || []).reduce((sum, s) => sum + parseFloat(s.commission_amount.toString()), 0)
      };

      setCalculationInfo(calculationDetails);
      setShowCalculationDialog(true);
      
      // auto_calculate_settlements 함수 호출
      const { data, error } = await supabase.rpc('auto_calculate_settlements');
      
      if (error) throw error;
      
      toast.success(`${data}건의 정산이 자동으로 처리되었습니다.`);
      await loadData(false);
    } catch (error) {
      console.error('자동 정산 실패:', error);
      toast.error('자동 정산에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  // 엑셀 다운로드
  const handleExportExcel = () => {
    const csvData = settlements.map(settlement => ({
      '파트너': settlement.partner?.nickname,
      '정산타입': settlement.settlement_type === 'rolling' ? '롤링' : '루징',
      '기간시작': settlement.period_start,
      '기간종료': settlement.period_end,
      '총베팅금액': parseFloat(settlement.total_bet_amount.toString()),
      '총당첨금액': parseFloat(settlement.total_win_amount.toString()),
      '수수료율': parseFloat(settlement.commission_rate.toString()),
      '수수료금액': parseFloat(settlement.commission_amount.toString()),
      '상태': settlement.status === 'pending' ? '대기' : '완료',
      '생성일시': new Date(settlement.created_at).toLocaleString()
    }));
    
    // CSV 변환 및 다운로드 로직
    const csv = [
      Object.keys(csvData[0] || {}).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `정산내역_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  useEffect(() => {
    loadData(true);
  }, []);

  // 필터 변경 시 자동 새로고침 (깜박임 없이)
  useEffect(() => {
    if (!initialLoading) {
      loadData(false);
    }
  }, [periodFilter, dateRange]);

  // WebSocket 메시지 처리
  useEffect(() => {
    if (lastMessage?.type === 'settlement_complete') {
      loadData(false);
    }
  }, [lastMessage]);

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  const filteredData = settlements.filter(settlement => {
    const matchesType = settlementType === 'all' || settlement.settlement_type === settlementType;
    const matchesSearch = searchTerm === '' || 
      settlement.partner?.nickname?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesType && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">파트너별 수수료 정산</h1>
          <p className="text-sm text-slate-400">파트너별 카지노/슬롯 롤링/루징 정산 관리</p>
        </div>
        <Button onClick={handleAutoSettlement} disabled={refreshing} className="btn-premium-primary">
          <Calculator className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          자동 정산
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-5">
        <MetricCard
          title="롤링 수수료"
          value={`₩${stats.totalRollingCommission.toLocaleString()}`}
          subtitle="총 롤링"
          icon={Calculator}
          color="purple"
        />
        
        <MetricCard
          title="루징 수수료"
          value={`₩${stats.totalLosingCommission.toLocaleString()}`}
          subtitle="총 루징"
          icon={TrendingDown}
          color="amber"
        />
        
        <MetricCard
          title="총 베팅액"
          value={`₩${stats.totalBetAmount.toLocaleString()}`}
          subtitle="누적 베팅"
          icon={TrendingUp}
          color="green"
        />
        
        <MetricCard
          title="평균 수수료율"
          value={`${stats.avgCommissionRate.toFixed(2)}%`}
          subtitle="전체 평균"
          icon={Calculator}
          color="cyan"
        />
        
        <MetricCard
          title="대기 중"
          value={`${stats.pendingSettlements}건`}
          subtitle="처리 대기"
          icon={RefreshCw}
          color="amber"
        />
        
        <MetricCard
          title="처리 완료"
          value={`${stats.completedSettlements}건`}
          subtitle="정산 완료"
          icon={TrendingUp}
          color="green"
        />
      </div>

      {/* 메인 컨텐츠 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            파트너별 수수료 정산 내역
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* 필터 - 간소화 */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-slate-300 whitespace-nowrap">기간</Label>
                <Select value={periodFilter} onValueChange={setPeriodFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">오늘</SelectItem>
                    <SelectItem value="week">최근 7일</SelectItem>
                    <SelectItem value="month">최근 30일</SelectItem>
                    <SelectItem value="custom">직접 설정</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {periodFilter === 'custom' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-64">
                      <Calendar className="h-4 w-4 mr-2" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          `${dateRange.from.toLocaleDateString()} - ${dateRange.to.toLocaleDateString()}`
                        ) : (
                          dateRange.from.toLocaleDateString()
                        )
                      ) : (
                        "날짜 선택"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              )}

              <div className="flex items-center gap-2">
                <Label className="text-slate-300 whitespace-nowrap">구분</Label>
                <Select value={settlementType} onValueChange={setSettlementType}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="rolling">롤링</SelectItem>
                    <SelectItem value="losing">루징</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 flex-1">
                <Search className="h-4 w-4 text-slate-400" />
                <Input
                  placeholder="파트너 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              <Button onClick={handleExportExcel} size="sm" variant="outline">
                <Download className="h-4 w-4 mr-2" />
                엑셀 다운로드
              </Button>
            </div>

            {/* 정산 테이블 - 검색 기능 비활성화 */}
            <DataTable
              enableSearch={false}
              columns={[
                {
                  header: "파트너",
                  accessorKey: "partner",
                  cell: ({ row }) => (
                    <div>
                      <p className="font-medium">{row.original.partner?.nickname}</p>
                      <p className="text-sm text-slate-500">레벨 {row.original.partner?.level}</p>
                    </div>
                  )
                },
                {
                  header: "정산 타입",
                  accessorKey: "settlement_type",
                  cell: ({ row }) => (
                    <Badge variant={row.original.settlement_type === 'rolling' ? 'default' : 'secondary'}>
                      {row.original.settlement_type === 'rolling' ? '롤링' : '루징'}
                    </Badge>
                  )
                },
                {
                  header: "정산 기간",
                  cell: ({ row }) => (
                    <div className="text-sm">
                      <p>{row.original.period_start}</p>
                      <p className="text-slate-500">~ {row.original.period_end}</p>
                    </div>
                  )
                },
                {
                  header: "베팅 금액",
                  accessorKey: "total_bet_amount",
                  cell: ({ row }) => (
                    <span className="font-medium">
                      ₩{parseFloat(row.original.total_bet_amount).toLocaleString()}
                    </span>
                  )
                },
                {
                  header: "당첨 금액",
                  accessorKey: "total_win_amount",
                  cell: ({ row }) => (
                    <span className="font-medium">
                      ₩{parseFloat(row.original.total_win_amount).toLocaleString()}
                    </span>
                  )
                },
                {
                  header: "수수료율",
                  accessorKey: "commission_rate",
                  cell: ({ row }) => (
                    <span className="font-medium">
                      {row.original.commission_rate}%
                    </span>
                  )
                },
                {
                  header: "수수료 금액",
                  accessorKey: "commission_amount",
                  cell: ({ row }) => (
                    <span className="font-semibold text-green-600">
                      ₩{parseFloat(row.original.commission_amount).toLocaleString()}
                    </span>
                  )
                },
                {
                  header: "상태",
                  accessorKey: "status",
                  cell: ({ row }) => (
                    <Badge variant={row.original.status === 'pending' ? 'destructive' : 'default'}>
                      {row.original.status === 'pending' ? '대기' : '완료'}
                    </Badge>
                  )
                },
                {
                  header: "처리일시",
                  accessorKey: "processed_at",
                  cell: ({ row }) => row.original.processed_at ? 
                    new Date(row.original.processed_at).toLocaleString() : '-'
                },
                {
                  header: "작업",
                  cell: ({ row }) => (
                    <div className="flex items-center gap-2">
                      {row.original.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleSettlementAction(row.original.id, 'approve')}
                            className="h-8 px-3"
                          >
                            승인
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSettlementAction(row.original.id, 'reject')}
                            className="h-8 px-3"
                          >
                            거절
                          </Button>
                        </>
                      )}
                    </div>
                  )
                }
              ]}
              data={filteredData}
            />
          </div>
        </CardContent>
      </Card>

      {/* 자동 정산 계산 정보 다이얼로그 */}
      <Dialog open={showCalculationDialog} onOpenChange={setShowCalculationDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <Info className="h-5 w-5 text-cyan-400" />
              자동 정산 계산 정보
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              정산 내역의 계산식과 상세 정보를 확인할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          {calculationInfo && (
            <div className="space-y-6 py-4">
              {/* 요약 */}
              <div className="grid grid-cols-3 gap-4">
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-slate-400 mb-1">총 정산 건수</p>
                      <p className="text-2xl font-bold text-cyan-400">{calculationInfo.totalCount}건</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-slate-400 mb-1">롤링 정산</p>
                      <p className="text-2xl font-bold text-purple-400">{calculationInfo.rolling.count}건</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-slate-400 mb-1">루징 정산</p>
                      <p className="text-2xl font-bold text-amber-400">{calculationInfo.losing.count}건</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 롤링 수수료 */}
              {calculationInfo.rolling.count > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-100">롤링 수수료</h3>
                    <Badge className="bg-purple-500 text-white">
                      총 ₩{calculationInfo.rolling.totalCommission.toLocaleString()}
                    </Badge>
                  </div>
                  <div className="bg-slate-800/30 p-3 rounded border border-slate-700">
                    <p className="text-sm text-slate-300 mb-2">
                      <span className="text-cyan-400">계산식:</span> {calculationInfo.rolling.formula}
                    </p>
                    <div className="space-y-2">
                      {calculationInfo.rolling.items.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm bg-slate-800/50 p-2 rounded">
                          <span className="text-slate-300">{item.partner}</span>
                          <div className="flex items-center gap-3 text-slate-400">
                            <span>베팅: ₩{item.betAmount.toLocaleString()}</span>
                            <span>×</span>
                            <span>{item.rate}%</span>
                            <span>=</span>
                            <span className="text-green-400 font-semibold">₩{item.commission.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 루징 수수료 */}
              {calculationInfo.losing.count > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-100">루징 수수료</h3>
                    <Badge className="bg-amber-500 text-white">
                      총 ₩{calculationInfo.losing.totalCommission.toLocaleString()}
                    </Badge>
                  </div>
                  <div className="bg-slate-800/30 p-3 rounded border border-slate-700">
                    <p className="text-sm text-slate-300 mb-2">
                      <span className="text-cyan-400">계산식:</span> {calculationInfo.losing.formula}
                    </p>
                    <div className="space-y-2">
                      {calculationInfo.losing.items.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm bg-slate-800/50 p-2 rounded">
                          <span className="text-slate-300">{item.partner}</span>
                          <div className="flex items-center gap-2 text-slate-400">
                            <span>(₩{item.betAmount.toLocaleString()} - ₩{item.winAmount.toLocaleString()})</span>
                            <span>×</span>
                            <span>{item.rate}%</span>
                            <span>=</span>
                            <span className="text-green-400 font-semibold">₩{item.commission.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 총계 */}
              <div className="border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-slate-100">총 정산 수수료</span>
                  <span className="text-2xl font-bold text-green-400">
                    ₩{calculationInfo.totalCommission.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CommissionSettlement;