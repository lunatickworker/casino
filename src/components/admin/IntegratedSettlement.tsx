import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, DollarSign, RefreshCw, Calendar as CalendarIcon, Info, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
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
import { calculateIntegratedSettlement, calculatePartnerPayments, SettlementSummary, PartnerPaymentDetail } from "../../lib/settlementCalculator";

interface IntegratedSettlementProps {
  user: Partner;
}

export function IntegratedSettlement({ user }: IntegratedSettlementProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settlementMethod, setSettlementMethod] = useState<'differential' | 'direct_subordinate'>('direct_subordinate');
  const [periodFilter, setPeriodFilter] = useState("today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [summary, setSummary] = useState<SettlementSummary>({
    myRollingIncome: 0,
    myLosingIncome: 0,
    myWithdrawalIncome: 0,
    myTotalIncome: 0,
    partnerRollingPayments: 0,
    partnerLosingPayments: 0,
    partnerWithdrawalPayments: 0,
    partnerTotalPayments: 0,
    netRollingProfit: 0,
    netLosingProfit: 0,
    netWithdrawalProfit: 0,
    netTotalProfit: 0
  });
  const [partnerPayments, setPartnerPayments] = useState<PartnerPaymentDetail[]>([]);

  useEffect(() => {
    loadSettlementMethod();
    loadIntegratedSettlement();
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

  const loadIntegratedSettlement = async () => {
    try {
      if (!refreshing) {
        setLoading(true);
      }
      const { start, end } = getDateRange();

      // ✅ 통합 모듈 사용: 통합 정산 계산 (내 수입 - 하위 파트너 지급)
      const settlement = await calculateIntegratedSettlement(
        user.id,
        {
          rolling: user.commission_rolling,
          losing: user.commission_losing,
          withdrawal: user.withdrawal_fee
        },
        start,
        end
      );

      setSummary(settlement);
      
      // 하위 파트너 지급 상세 조회 (settlement에는 상세가 없으므로 별도 조회)
      const payments = await calculatePartnerPayments(user.id, start, end);
      setPartnerPayments(payments.details);
    } catch (error) {
      console.error('통합 정산 계산 실패:', error);
      toast.error('정산 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ✅ 중복 로직 제거: settlementCalculator 모듈 사용

  const handleRefresh = () => {
    setRefreshing(true);
    loadIntegratedSettlement();
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
          <h1 className="text-2xl text-white mb-2">통합 정산 현황</h1>
          <p className="text-slate-400">
            내 총 수익에서 하위 파트너 지급액을 제외한 순수익을 확인합니다.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          새로고침
        </Button>
      </div>

      {/* 메인 정산 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* 내 총 수입 */}
        <MetricCard
          title="내 총 수입 (A)"
          value={`₩${summary.myTotalIncome.toLocaleString()}`}
          subtitle={`롤링: ₩${summary.myRollingIncome.toLocaleString()} | 죽장: ₩${summary.myLosingIncome.toLocaleString()}`}
          icon={ArrowUpCircle}
          color="emerald"
        />

        {/* 하위 파트너 지급 */}
        <MetricCard
          title="하위 파트너 지급 (B)"
          value={`₩${summary.partnerTotalPayments.toLocaleString()}`}
          subtitle={`롤링: ₩${summary.partnerRollingPayments.toLocaleString()} | 죽장: ₩${summary.partnerLosingPayments.toLocaleString()}`}
          icon={ArrowDownCircle}
          color="red"
        />

        {/* 순수익 */}
        <MetricCard
          title="순수익 (A - B)"
          value={`₩${summary.netTotalProfit.toLocaleString()}`}
          subtitle={`롤링: ₩${summary.netRollingProfit.toLocaleString()} | 죽장: ₩${summary.netLosingProfit.toLocaleString()}`}
          icon={DollarSign}
          color="blue"
        />
      </div>

      {/* 하위 파트너 지급 상세 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle>하위 파트너 지급 상세</CardTitle>
              <CardDescription>
                총 {partnerPayments.length}명의 직속 하위 파트너 지급 내역
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
          {partnerPayments.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Info className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>지급할 하위 파트너가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left p-3 text-slate-400">파트너</th>
                    <th className="text-right p-3 text-slate-400">롤링 지급</th>
                    <th className="text-right p-3 text-slate-400">죽장 지급</th>
                    <th className="text-right p-3 text-slate-400">이체 지급</th>
                    <th className="text-right p-3 text-slate-400">총 지급액</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerPayments.map((payment) => (
                    <tr key={payment.partner_id} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td className="p-3">
                        <p className="text-white">{payment.partner_nickname}</p>
                      </td>
                      <td className="p-3 text-right text-blue-400 font-mono">
                        ₩{payment.rolling_payment.toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-purple-400 font-mono">
                        ₩{payment.losing_payment.toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-green-400 font-mono">
                        ₩{payment.withdrawal_payment.toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-orange-400 font-mono">
                        ₩{payment.total_payment.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800/50 border-t-2 border-slate-600">
                    <td className="p-3 text-white">총합</td>
                    <td className="p-3 text-right text-blue-400 font-mono">
                      ₩{summary.partnerRollingPayments.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-purple-400 font-mono">
                      ₩{summary.partnerLosingPayments.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-green-400 font-mono">
                      ₩{summary.partnerWithdrawalPayments.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-orange-400 font-mono">
                      ₩{summary.partnerTotalPayments.toLocaleString()}
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
