import { useState, useEffect } from "react";
import { Calculator, Download, RefreshCw, TrendingUp, Calendar as CalendarIcon, AlertCircle, Wallet, BadgeDollarSign } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";
import { cn } from "../../lib/utils";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { MetricCard } from "./MetricCard";
import { calculateChildPartnersCommission, PartnerCommissionInfo } from "../../lib/settlementCalculator";

interface CommissionSettlementProps {
  user: Partner;
}

export function CommissionSettlement({ user }: CommissionSettlementProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settlementMethod, setSettlementMethod] = useState<'differential' | 'direct_subordinate'>('direct_subordinate');
  const [periodFilter, setPeriodFilter] = useState("today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [commissions, setCommissions] = useState<PartnerCommissionInfo[]>([]);
  
  const [stats, setStats] = useState({
    totalRollingCommission: 0,
    totalLosingCommission: 0,
    totalWithdrawalCommission: 0,
    totalCommission: 0,
    partnerCount: 0
  });

  useEffect(() => {
    loadSettlementMethod();
    loadCommissions();
  }, [user.id, periodFilter, dateRange]);

  const loadSettlementMethod = async () => {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('setting_value')
        .eq('setting_key', 'settlement_method')
        .single();

      if (error) throw error;
      if (data) {
        setSettlementMethod(data.setting_value as 'differential' | 'direct_subordinate');
      }
    } catch (error) {
      console.error('정산 방식 로드 실패:', error);
    }
  };

  const getDateRange = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (periodFilter) {
      case "today":
        return {
          start: today.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      case "yesterday":
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
          start: yesterday.toISOString(),
          end: today.toISOString()
        };
      case "week":
        const weekStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        return {
          start: weekStart.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      case "month":
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
          start: monthStart.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      case "custom":
        if (dateRange?.from) {
          const start = new Date(dateRange.from);
          const end = dateRange.to ? new Date(dateRange.to) : new Date(dateRange.from);
          return {
            start: start.toISOString(),
            end: new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString()
          };
        }
        return {
          start: today.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      default:
        return {
          start: today.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
    }
  };

  const loadCommissions = async () => {
    try {
      if (!refreshing) {
        setLoading(true);
      }
      const { start, end } = getDateRange();

      // ✅ 통합 모듈 사용: 직속 하위 파트너들의 커미션 계산
      const commissionsData = await calculateChildPartnersCommission(user.id, start, end);

      if (commissionsData.length === 0) {
        setCommissions([]);
        setStats({
          totalRollingCommission: 0,
          totalLosingCommission: 0,
          totalWithdrawalCommission: 0,
          totalCommission: 0,
          partnerCount: 0
        });
        return;
      }

      setCommissions(commissionsData);

      // 통계 계산
      const newStats = commissionsData.reduce((acc, comm) => ({
        totalRollingCommission: acc.totalRollingCommission + comm.rolling_commission,
        totalLosingCommission: acc.totalLosingCommission + comm.losing_commission,
        totalWithdrawalCommission: acc.totalWithdrawalCommission + comm.withdrawal_commission,
        totalCommission: acc.totalCommission + comm.total_commission,
        partnerCount: acc.partnerCount + 1
      }), {
        totalRollingCommission: 0,
        totalLosingCommission: 0,
        totalWithdrawalCommission: 0,
        totalCommission: 0,
        partnerCount: 0
      });

      setStats(newStats);
    } catch (error) {
      console.error('수수료 계산 실패:', error);
      toast.error('수수료 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ✅ 중복 로직 제거: settlementCalculator 모듈 사용

  const handleRefresh = () => {
    setRefreshing(true);
    loadCommissions();
  };

  const handleExport = () => {
    toast.info('엑셀 내보내기 기능은 준비중입니다.');
  };

  const getLevelText = (level: number) => {
    switch (level) {
      case 2: return '대본사';
      case 3: return '본사';
      case 4: return '부본사';
      case 5: return '총판';
      case 6: return '매장';
      default: return '알 수 없음';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-white mb-2">파트너별 수수료 정산</h1>
          <p className="text-slate-400">
            직속 하위 파트너들에게 지급할 수수료를 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            새로고침
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
          >
            <Download className="h-4 w-4 mr-2" />
            엑셀 내보내기
          </Button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <MetricCard
          title="롤링 수수료"
          value={`₩${stats.totalRollingCommission.toLocaleString()}`}
          subtitle="↑ 베팅 기반 수수료"
          icon={TrendingUp}
          color="blue"
        />
        <MetricCard
          title="죽장 수수료"
          value={`₩${stats.totalLosingCommission.toLocaleString()}`}
          subtitle="↑ 손실 기반 수수료"
          icon={BadgeDollarSign}
          color="purple"
        />
        <MetricCard
          title="이체 수수료"
          value={`₩${stats.totalWithdrawalCommission.toLocaleString()}`}
          subtitle="↑ 출금 기반 수수료"
          icon={Wallet}
          color="emerald"
        />
        <MetricCard
          title="총 수수료"
          value={`₩${stats.totalCommission.toLocaleString()}`}
          subtitle="↑ 전체 수수료 합계"
          icon={Calculator}
          color="orange"
        />
      </div>

      {/* 수수료 테이블 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle>하위 파트너별 수수료 상세</CardTitle>
              <CardDescription>
                총 {stats.partnerCount}명의 하위 파트너 수수료 내역
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">오늘</SelectItem>
                  <SelectItem value="yesterday">어제</SelectItem>
                  <SelectItem value="week">최근 7일</SelectItem>
                  <SelectItem value="month">이번 달</SelectItem>
                  <SelectItem value="custom">직접 선택</SelectItem>
                </SelectContent>
              </Select>

              {periodFilter === "custom" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[280px] justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "PPP", { locale: ko })} -{" "}
                            {format(dateRange.to, "PPP", { locale: ko })}
                          </>
                        ) : (
                          format(dateRange.from, "PPP", { locale: ko })
                        )
                      ) : (
                        <span>날짜를 선택하세요</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                      locale={ko}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {commissions.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>조회된 하위 파트너가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left p-3 text-slate-400">파트너</th>
                    <th className="text-left p-3 text-slate-400">등급</th>
                    <th className="text-right p-3 text-slate-400">베팅액</th>
                    <th className="text-right p-3 text-slate-400">롤링 수수료</th>
                    <th className="text-right p-3 text-slate-400">죽장 수수료</th>
                    <th className="text-right p-3 text-slate-400">이체 수수료</th>
                    <th className="text-right p-3 text-slate-400">총 수수료</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((comm) => (
                    <tr key={comm.partner_id} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td className="p-3">
                        <div>
                          <p className="text-white">{comm.partner_nickname}</p>
                          <p className="text-xs text-slate-400">{comm.partner_username}</p>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline">{getLevelText(comm.partner_level)}</Badge>
                      </td>
                      <td className="p-3 text-right text-slate-300">
                        ₩{comm.total_bet_amount.toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <div>
                          <p className="text-blue-400">₩{comm.rolling_commission.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">{comm.commission_rolling}%</p>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <div>
                          <p className="text-purple-400">₩{comm.losing_commission.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">{comm.commission_losing}%</p>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <div>
                          <p className="text-green-400">₩{comm.withdrawal_commission.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">{comm.withdrawal_fee}%</p>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <p className="text-orange-400 font-mono">₩{comm.total_commission.toLocaleString()}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800/50 border-t-2 border-slate-600">
                    <td colSpan={3} className="p-3 text-white">총합</td>
                    <td className="p-3 text-right text-blue-400 font-mono">
                      ₩{stats.totalRollingCommission.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-purple-400 font-mono">
                      ₩{stats.totalLosingCommission.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-green-400 font-mono">
                      ₩{stats.totalWithdrawalCommission.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-orange-400 font-mono">
                      ₩{stats.totalCommission.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
