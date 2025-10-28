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

interface IntegratedSettlementProps {
  user: Partner;
}

interface SettlementSummary {
  // 내 수입
  myRollingIncome: number;
  myLosingIncome: number;
  myWithdrawalIncome: number;
  myTotalIncome: number;

  // 하위 파트너 지급
  partnerRollingPayments: number;
  partnerLosingPayments: number;
  partnerWithdrawalPayments: number;
  partnerTotalPayments: number;

  // 순수익
  netRollingProfit: number;
  netLosingProfit: number;
  netWithdrawalProfit: number;
  netTotalProfit: number;
}

interface PartnerPaymentDetail {
  partner_id: string;
  partner_nickname: string;
  rolling_payment: number;
  losing_payment: number;
  withdrawal_payment: number;
  total_payment: number;
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

      // 1. 내 총 수입 계산 (모든 하위 사용자로부터)
      const myIncome = await calculateMyIncome(start, end);

      // 2. 하위 파트너 지급 계산
      const payments = await calculatePartnerPayments(start, end);

      // 3. 순수익 계산
      const newSummary: SettlementSummary = {
        myRollingIncome: myIncome.rolling,
        myLosingIncome: myIncome.losing,
        myWithdrawalIncome: myIncome.withdrawal,
        myTotalIncome: myIncome.total,
        partnerRollingPayments: payments.totalRolling,
        partnerLosingPayments: payments.totalLosing,
        partnerWithdrawalPayments: payments.totalWithdrawal,
        partnerTotalPayments: payments.total,
        netRollingProfit: myIncome.rolling - payments.totalRolling,
        netLosingProfit: myIncome.losing - payments.totalLosing,
        netWithdrawalProfit: myIncome.withdrawal - payments.totalWithdrawal,
        netTotalProfit: myIncome.total - payments.total
      };

      setSummary(newSummary);
      setPartnerPayments(payments.details);
    } catch (error) {
      console.error('통합 정산 계산 실패:', error);
      toast.error('정산 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const calculateMyIncome = async (start: string, end: string) => {
    try {
      // 모든 하위 사용자 ID 조회
      const descendantUserIds = await getDescendantUserIds(user.id);

      if (descendantUserIds.length === 0) {
        return { rolling: 0, losing: 0, withdrawal: 0, total: 0 };
      }

      // 베팅 데이터 조회
      const { data: bettingData, error: bettingError } = await supabase
        .from('game_records')
        .select('bet_amount, win_amount')
        .in('user_id', descendantUserIds)
        .gte('created_at', start)
        .lte('created_at', end);

      if (bettingError) throw bettingError;

      let totalBetAmount = 0;
      let totalLossAmount = 0;

      if (bettingData) {
        totalBetAmount = bettingData.reduce((sum, record) => sum + (record.bet_amount || 0), 0);
        totalLossAmount = bettingData.reduce((sum, record) => {
          const loss = (record.bet_amount || 0) - (record.win_amount || 0);
          return sum + (loss > 0 ? loss : 0);
        }, 0);
      }

      // 출금 데이터 조회
      const { data: withdrawalData, error: withdrawalError } = await supabase
        .from('transactions')
        .select('amount')
        .in('user_id', descendantUserIds)
        .eq('transaction_type', 'withdrawal')
        .eq('status', 'approved')
        .gte('created_at', start)
        .lte('created_at', end);

      if (withdrawalError) throw withdrawalError;

      let totalWithdrawalAmount = 0;
      if (withdrawalData) {
        totalWithdrawalAmount = withdrawalData.reduce((sum, tx) => sum + (tx.amount || 0), 0);
      }

      // 내 수수료율로 계산
      const rollingIncome = totalBetAmount * (user.commission_rolling / 100);
      const losingIncome = totalLossAmount * (user.commission_losing / 100);
      const withdrawalIncome = totalWithdrawalAmount * (user.withdrawal_fee / 100);

      return {
        rolling: rollingIncome,
        losing: losingIncome,
        withdrawal: withdrawalIncome,
        total: rollingIncome + losingIncome + withdrawalIncome
      };
    } catch (error) {
      console.error('내 수입 계산 실패:', error);
      return { rolling: 0, losing: 0, withdrawal: 0, total: 0 };
    }
  };

  const calculatePartnerPayments = async (start: string, end: string) => {
    try {
      // 직속 하위 파트너 조회
      const { data: childPartners, error: partnersError } = await supabase
        .from('partners')
        .select('id, nickname, commission_rolling, commission_losing, withdrawal_fee')
        .eq('parent_id', user.id);

      if (partnersError) throw partnersError;

      if (!childPartners || childPartners.length === 0) {
        return {
          totalRolling: 0,
          totalLosing: 0,
          totalWithdrawal: 0,
          total: 0,
          details: []
        };
      }

      const details: PartnerPaymentDetail[] = [];
      let totalRolling = 0;
      let totalLosing = 0;
      let totalWithdrawal = 0;

      for (const partner of childPartners) {
        const payment = await calculatePartnerPayment(partner.id, partner, start, end);
        details.push(payment);
        totalRolling += payment.rolling_payment;
        totalLosing += payment.losing_payment;
        totalWithdrawal += payment.withdrawal_payment;
      }

      return {
        totalRolling,
        totalLosing,
        totalWithdrawal,
        total: totalRolling + totalLosing + totalWithdrawal,
        details
      };
    } catch (error) {
      console.error('파트너 지급 계산 실패:', error);
      return {
        totalRolling: 0,
        totalLosing: 0,
        totalWithdrawal: 0,
        total: 0,
        details: []
      };
    }
  };

  const calculatePartnerPayment = async (
    partnerId: string,
    partner: any,
    start: string,
    end: string
  ): Promise<PartnerPaymentDetail> => {
    try {
      // 해당 파트너의 모든 하위 사용자 조회
      const descendantUserIds = await getDescendantUserIds(partnerId);

      if (descendantUserIds.length === 0) {
        return {
          partner_id: partnerId,
          partner_nickname: partner.nickname,
          rolling_payment: 0,
          losing_payment: 0,
          withdrawal_payment: 0,
          total_payment: 0
        };
      }

      // 베팅 데이터 조회
      const { data: bettingData, error: bettingError } = await supabase
        .from('game_records')
        .select('bet_amount, win_amount')
        .in('user_id', descendantUserIds)
        .gte('created_at', start)
        .lte('created_at', end);

      if (bettingError) throw bettingError;

      let totalBetAmount = 0;
      let totalLossAmount = 0;

      if (bettingData) {
        totalBetAmount = bettingData.reduce((sum, record) => sum + (record.bet_amount || 0), 0);
        totalLossAmount = bettingData.reduce((sum, record) => {
          const loss = (record.bet_amount || 0) - (record.win_amount || 0);
          return sum + (loss > 0 ? loss : 0);
        }, 0);
      }

      // 출금 데이터 조회
      const { data: withdrawalData, error: withdrawalError } = await supabase
        .from('transactions')
        .select('amount')
        .in('user_id', descendantUserIds)
        .eq('transaction_type', 'withdrawal')
        .eq('status', 'approved')
        .gte('created_at', start)
        .lte('created_at', end);

      if (withdrawalError) throw withdrawalError;

      let totalWithdrawalAmount = 0;
      if (withdrawalData) {
        totalWithdrawalAmount = withdrawalData.reduce((sum, tx) => sum + (tx.amount || 0), 0);
      }

      // 파트너 수수료율로 계산
      const rollingPayment = totalBetAmount * (partner.commission_rolling / 100);
      const losingPayment = totalLossAmount * (partner.commission_losing / 100);
      const withdrawalPayment = totalWithdrawalAmount * (partner.withdrawal_fee / 100);

      return {
        partner_id: partnerId,
        partner_nickname: partner.nickname,
        rolling_payment: rollingPayment,
        losing_payment: losingPayment,
        withdrawal_payment: withdrawalPayment,
        total_payment: rollingPayment + losingPayment + withdrawalPayment
      };
    } catch (error) {
      console.error('파트너 지급 계산 실패:', error);
      return {
        partner_id: partnerId,
        partner_nickname: partner.nickname,
        rolling_payment: 0,
        losing_payment: 0,
        withdrawal_payment: 0,
        total_payment: 0
      };
    }
  };

  // 재귀적으로 모든 하위 사용자 ID 가져오기
  const getDescendantUserIds = async (partnerId: string): Promise<string[]> => {
    const allUserIds: string[] = [];

    // 직속 사용자 조회
    const { data: directUsers } = await supabase
      .from('users')
      .select('id')
      .eq('referrer_id', partnerId);

    if (directUsers) {
      allUserIds.push(...directUsers.map(u => u.id));
    }

    // 하위 파트너 조회
    const { data: childPartners } = await supabase
      .from('partners')
      .select('id')
      .eq('parent_id', partnerId);

    if (childPartners) {
      for (const child of childPartners) {
        const childUserIds = await getDescendantUserIds(child.id);
        allUserIds.push(...childUserIds);
      }
    }

    return allUserIds;
  };

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
