import { useState, useEffect } from "react";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle } from "./AdminDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { 
  User, 
  TrendingUp, 
  ArrowDownToLine,
  Gamepad2,
  Brain,
  Clock,
  BarChart3,
  Target,
  AlertTriangle,
  Trophy,
  TrendingDown,
  Activity,
  Wallet
} from "lucide-react";

interface UserDetailModalProps {
  user: any;
  isOpen: boolean;
  onClose: () => void;
}

interface TransactionRecord {
  id: string;
  transaction_type: string;
  amount: number;
  status: string;
  created_at: string;
  updated_at: string;
  notes?: string;
}

interface BettingRecord {
  id: string;
  game_id: number;
  provider_id: number;
  bet_amount: number;
  win_amount: number;
  played_at: string;
  username: string;
  game_title?: string;
  provider_name?: string;
}

export function UserDetailModal({ user, isOpen, onClose }: UserDetailModalProps) {
  const [activeTab, setActiveTab] = useState("basic");
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [bettingHistory, setBettingHistory] = useState<BettingRecord[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  
  const [stats, setStats] = useState({
    totalDeposit: 0,
    totalWithdraw: 0,
    totalBets: 0,
    totalWinAmount: 0,
    accountAge: 0,
    lastActivity: ''
  });

  // 기본 통계 계산 - 직접 SELECT 쿼리
  const calculateStats = async () => {
    try {
      setLoading(true);

      // 입출금 통계 계산
      const { data: txData } = await supabase
        .from('transactions')
        .select('transaction_type, amount, status')
        .eq('user_id', user.id);

      const totalDeposit = (txData || [])
        .filter(t => t.transaction_type === 'deposit' && t.status === 'approved')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const totalWithdraw = (txData || [])
        .filter(t => t.transaction_type === 'withdrawal' && t.status === 'approved')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      // 베팅 통계 계산
      const { data: betData } = await supabase
        .from('game_records')
        .select('bet_amount, win_amount')
        .eq('user_id', user.id);

      const totalBets = (betData || []).reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      const totalWinAmount = (betData || []).reduce((sum, b) => sum + (b.win_amount || 0), 0);

      // 계정 나이 계산
      const accountAge = Math.floor(
        (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // 최근 활동
      const { data: lastSession } = await supabase
        .from('game_launch_sessions')
        .select('launched_at')
        .eq('user_id', user.id)
        .order('launched_at', { ascending: false })
        .limit(1)
        .single();

      setStats({
        totalDeposit,
        totalWithdraw,
        totalBets,
        totalWinAmount,
        accountAge,
        lastActivity: lastSession?.launched_at || user.created_at
      });

    } catch (error) {
      console.error('통계 계산 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  // 입출금 내역 조회 - 직접 SELECT
  const fetchTransactions = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setTransactions(data || []);
      
    } catch (error) {
      console.error('입출금 내역 조회 오류:', error);
      toast.error('입출금 내역을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 베팅 내역 조회 - 직접 SELECT
  const fetchBettingHistory = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('game_records')
        .select('*')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setBettingHistory(data || []);
      
    } catch (error) {
      console.error('베팅 내역 조회 오류:', error);
      toast.error('베팅 내역을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // AI 게임 패턴 분석 - 직접 SELECT 및 로직 처리
  const analyzePattern = async () => {
    try {
      setLoading(true);

      // 베팅 데이터 가져오기
      const { data: bets } = await supabase
        .from('game_records')
        .select('*')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(500);

      if (!bets || bets.length === 0) {
        setAiAnalysis(null);
        return;
      }

      // 1. 게임별 통계 집계
      const gameStats = new Map();
      bets.forEach(bet => {
        const gameKey = `${bet.game_id}_${bet.game_title || ''}`;
        if (!gameStats.has(gameKey)) {
          gameStats.set(gameKey, {
            gameName: bet.game_title || `게임 ${bet.game_id}`,
            providerName: bet.provider_name || '',
            count: 0,
            totalBet: 0,
            totalWin: 0,
            wins: 0
          });
        }
        const stat = gameStats.get(gameKey);
        stat.count++;
        stat.totalBet += bet.bet_amount || 0;
        stat.totalWin += bet.win_amount || 0;
        if ((bet.win_amount || 0) > (bet.bet_amount || 0)) stat.wins++;
      });

      // 상위 5개 게임
      const topGames = Array.from(gameStats.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(g => ({
          game: g.gameName,
          provider: g.providerName,
          count: g.count,
          winRate: g.count > 0 ? (g.wins / g.count * 100) : 0,
          netProfit: g.totalWin - g.totalBet
        }));

      // 2. 시간대 패턴 분석
      const hourlyPattern = new Array(24).fill(0);
      bets.forEach(bet => {
        const hour = new Date(bet.played_at).getHours();
        hourlyPattern[hour]++;
      });

      const peakHour = hourlyPattern.indexOf(Math.max(...hourlyPattern));
      const nightPlayCount = hourlyPattern.slice(22).reduce((a, b) => a + b, 0) + 
                             hourlyPattern.slice(0, 6).reduce((a, b) => a + b, 0);
      const nightPlayRatio = (nightPlayCount / bets.length) * 100;

      // 3. 베팅 패턴 통계
      const betAmounts = bets.map(b => b.bet_amount || 0);
      const avgBet = betAmounts.reduce((a, b) => a + b, 0) / bets.length;
      const maxBet = Math.max(...betAmounts);
      const minBet = Math.min(...betAmounts.filter(a => a > 0));

      const totalBet = bets.reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      const totalWin = bets.reduce((sum, b) => sum + (b.win_amount || 0), 0);
      const netProfit = totalWin - totalBet;
      
      const winCount = bets.filter(b => (b.win_amount || 0) > (b.bet_amount || 0)).length;
      const winRate = (winCount / bets.length) * 100;

      // 4. 리스크 레벨 계산
      let riskScore = 0;
      if (avgBet > 100000) riskScore += 3;
      else if (avgBet > 50000) riskScore += 2;
      else if (avgBet > 10000) riskScore += 1;

      if (maxBet > 500000) riskScore += 3;
      else if (maxBet > 200000) riskScore += 2;
      else if (maxBet > 50000) riskScore += 1;

      if (netProfit < -1000000) riskScore += 3;
      else if (netProfit < -500000) riskScore += 2;
      else if (netProfit < -100000) riskScore += 1;

      if (bets.length > 500) riskScore += 1;

      const riskLevel = riskScore >= 6 ? 'HIGH' : riskScore >= 3 ? 'MEDIUM' : 'LOW';

      // 5. AI 인사이트 생성
      const insights: string[] = [];

      // 게임 선호도 인사이트
      if (topGames.length > 0) {
        const top = topGames[0];
        const concentration = (top.count / bets.length * 100).toFixed(1);
        insights.push(`💎 가장 선호하는 게임은 "${top.game}"로, 전체 플레이의 ${concentration}%를 차지합니다.`);
        
        if (top.winRate > 60) {
          insights.push(`✅ "${top.game}"에서 ${top.winRate.toFixed(1)}%의 높은 승률을 기록 중입니다.`);
        } else if (top.winRate < 40) {
          insights.push(`⚠️ "${top.game}"에서 ${top.winRate.toFixed(1)}%의 낮은 승률로, 전략 개선이 필요합니다.`);
        }
      }

      // 시간대 패턴 인사이트
      insights.push(`🕐 주로 ${peakHour}시에 가장 활발한 활동을 보입니다.`);
      
      if (nightPlayRatio > 40) {
        insights.push(`🌙 야간 시간대(22시~6시) 플레이 비율이 ${nightPlayRatio.toFixed(1)}%로 높습니다.`);
      }

      // 베팅 성향 인사이트
      if (winRate > 55) {
        insights.push(`📈 전체 승률 ${winRate.toFixed(1)}%로 평균 이상의 우수한 성과를 보입니다.`);
      } else if (winRate < 45) {
        insights.push(`📉 전체 승률 ${winRate.toFixed(1)}%로 게임 전략 재검토가 필요합니다.`);
      } else {
        insights.push(`📊 전체 승률 ${winRate.toFixed(1)}%로 평균적인 수준입니다.`);
      }

      // 손익 인사이트
      if (netProfit > 0) {
        insights.push(`💰 총 ${Math.abs(netProfit).toLocaleString()}원의 수익을 달성했습니다.`);
      } else {
        insights.push(`💸 총 ${Math.abs(netProfit).toLocaleString()}원의 손실이 발생했습니다.`);
      }

      // 베팅 규모 인사이트
      if (avgBet > 50000) {
        insights.push(`⚡ 평균 베팅액이 ${avgBet.toLocaleString()}원으로 고액 베팅 성향입니다.`);
      }

      // 베팅 변동성 인사이트
      const betVariance = maxBet / avgBet;
      if (betVariance > 10) {
        insights.push(`📊 베팅 금액 변동성이 높아 일관된 베팅 전략이 필요합니다.`);
      }

      // 6. 사용자 성향 판단
      let userType = '';
      if (riskLevel === 'HIGH') {
        userType = '공격적 고위험 플레이어';
      } else if (riskLevel === 'MEDIUM') {
        if (winRate > 50) {
          userType = '적극적 안정형 플레이어';
        } else {
          userType = '도전적 중위험 플레이어';
        }
      } else {
        if (avgBet < 10000) {
          userType = '보수적 저위험 플레이어';
        } else {
          userType = '신중한 안정형 플레이어';
        }
      }

      setAiAnalysis({
        topGames,
        peakHour,
        nightPlayRatio,
        avgBet,
        maxBet,
        minBet,
        totalBets: bets.length,
        winRate,
        netProfit,
        riskLevel,
        userType,
        insights
      });

    } catch (error) {
      console.error('패턴 분석 오류:', error);
      toast.error('패턴 분석에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (!isOpen || !user) return;

    if (activeTab === "basic") {
      calculateStats();
    } else if (activeTab === "transactions") {
      fetchTransactions();
    } else if (activeTab === "betting") {
      fetchBettingHistory();
    } else if (activeTab === "pattern") {
      analyzePattern();
    }
  }, [activeTab, isOpen, user]);

  const formatCurrency = (amount: number) => `₩${amount.toLocaleString()}`;
  const formatDate = (date: string) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  };
  const formatDateTime = (date: string) => new Date(date).toLocaleString('ko-KR');

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'HIGH': return 'text-red-500';
      case 'MEDIUM': return 'text-yellow-500';
      default: return 'text-green-500';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">승인</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">대기</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">거절</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (!user) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[1400px] max-h-[90vh] overflow-hidden glass-card">
        <DialogHeader className="pb-4 border-b border-white/10">
          <DialogTitle className="flex items-center gap-4 text-xl">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <User className="h-6 w-6 text-white" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold">{user.nickname}</span>
                <span className="text-lg text-muted-foreground">({user.username})</span>
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="text-base pl-16">
            회원의 상세 정보와 활동 패턴을 확인합니다.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mt-2">
          <TabsList className="grid w-full grid-cols-4 glass-card h-12">
            <TabsTrigger value="basic" className="flex items-center gap-2 text-base">
              <User className="h-5 w-5" />
              기본정보
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex items-center gap-2 text-base">
              <Wallet className="h-5 w-5" />
              입출금내역
            </TabsTrigger>
            <TabsTrigger value="betting" className="flex items-center gap-2 text-base">
              <Gamepad2 className="h-5 w-5" />
              베팅내역
            </TabsTrigger>
            <TabsTrigger value="pattern" className="flex items-center gap-2 text-base">
              <Brain className="h-5 w-5" />
              AI 게임패턴
            </TabsTrigger>
          </TabsList>

          {/* 기본정보 탭 */}
          <TabsContent value="basic" className="space-y-6 max-h-[calc(90vh-240px)] overflow-y-auto pr-2 pt-4">
            {loading ? (
              <LoadingSpinner />
            ) : (
              <div className="glass-card p-6">
                {/* 회원 정보 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <User className="h-5 w-5 text-blue-400" />
                    <h3 className="font-semibold">회원 정보</h3>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">아이디</span>
                    <span className="font-mono">{user.username}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">닉네임</span>
                    <span>{user.nickname}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">상태</span>
                    {user.status === 'active' ? (
                      <Badge className="bg-green-500/20 text-green-400">활성</Badge>
                    ) : user.status === 'suspended' ? (
                      <Badge className="bg-red-500/20 text-red-400">정지</Badge>
                    ) : (
                      <Badge className="bg-gray-500/20">대기</Badge>
                    )}
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">가입일</span>
                    <span>{formatDate(user.created_at)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">가입기간</span>
                    <span>{stats.accountAge}일</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">온라인</span>
                    {user.is_online ? (
                      <Badge className="bg-green-500/20 text-green-400">접속중</Badge>
                    ) : (
                      <Badge className="bg-gray-500/20">오프라인</Badge>
                    )}
                  </div>
                </div>

                {/* 구분선 */}
                <div className="border-t border-white/10 my-6"></div>

                {/* 잔고 정보 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <Wallet className="h-5 w-5 text-emerald-400" />
                    <h3 className="font-semibold">잔고 정보</h3>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">보유금</span>
                    <span className="font-mono font-semibold">{formatCurrency(user.balance || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">포인트</span>
                    <span className="font-mono">{formatCurrency(user.points || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">총 입금</span>
                    <span className="font-mono text-blue-400">{formatCurrency(stats.totalDeposit)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">총 출금</span>
                    <span className="font-mono text-pink-400">{formatCurrency(stats.totalWithdraw)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-white/10 pt-3 mt-2">
                    <span className="text-muted-foreground font-semibold">순 입출금</span>
                    <span className={`font-mono font-semibold ${stats.totalDeposit - stats.totalWithdraw >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(stats.totalDeposit - stats.totalWithdraw)}
                    </span>
                  </div>
                </div>

                {/* 구분선 */}
                <div className="border-t border-white/10 my-6"></div>

                {/* 베팅 통계 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="h-5 w-5 text-amber-400" />
                    <h3 className="font-semibold">베팅 통계</h3>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">총 베팅액</span>
                    <span className="font-mono">{formatCurrency(stats.totalBets)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">총 당첨액</span>
                    <span className="font-mono">{formatCurrency(stats.totalWinAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-white/10 pt-3 mt-2">
                    <span className="text-muted-foreground font-semibold">손익</span>
                    <span className={`font-mono font-semibold ${stats.totalWinAmount - stats.totalBets >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stats.totalWinAmount - stats.totalBets >= 0 ? '+' : ''}
                      {formatCurrency(stats.totalWinAmount - stats.totalBets)}
                    </span>
                  </div>
                </div>

                {/* 구분선 */}
                <div className="border-t border-white/10 my-6"></div>

                {/* 활동 정보 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="h-5 w-5 text-purple-400" />
                    <h3 className="font-semibold">활동 정보</h3>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">최근 활동</span>
                    <span>{formatDateTime(stats.lastActivity)}</span>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 입출금내역 탭 */}
          <TabsContent value="transactions" className="space-y-4 max-h-[calc(90vh-240px)] overflow-y-auto pr-2 pt-4">
            {loading ? (
              <LoadingSpinner />
            ) : transactions.length === 0 ? (
              <div className="text-center py-20 glass-card rounded-xl">
                <Wallet className="h-20 w-20 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground text-lg">입출금 내역이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {transactions.map((tx) => (
                  <Card key={tx.id} className="glass-card hover:bg-white/5 transition-colors">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-5">
                          <div className={`p-4 rounded-xl ${
                            tx.transaction_type === 'deposit' 
                              ? 'bg-green-500/20' 
                              : 'bg-red-500/20'
                          }`}>
                            {tx.transaction_type === 'deposit' ? (
                              <TrendingUp className="h-6 w-6 text-green-400" />
                            ) : (
                              <ArrowDownToLine className="h-6 w-6 text-red-400" />
                            )}
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-lg">
                                {tx.transaction_type === 'deposit' ? '입금' : '출금'}
                              </span>
                              {getStatusBadge(tx.status)}
                            </div>
                            <p className="text-base text-muted-foreground">
                              {formatDateTime(tx.created_at)}
                            </p>
                            {tx.notes && (
                              <p className="text-sm text-muted-foreground mt-1">{tx.notes}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-2xl font-mono font-bold ${
                            tx.transaction_type === 'deposit' ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {tx.transaction_type === 'deposit' ? '+' : '-'}
                            {formatCurrency(tx.amount)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* 베팅내역 탭 */}
          <TabsContent value="betting" className="space-y-4 max-h-[calc(90vh-240px)] overflow-y-auto pr-2 pt-4">
            {loading ? (
              <LoadingSpinner />
            ) : bettingHistory.length === 0 ? (
              <div className="text-center py-20 glass-card rounded-xl">
                <Gamepad2 className="h-20 w-20 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground text-lg">베팅 내역이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bettingHistory.map((bet) => {
                  const isWin = (bet.win_amount || 0) > (bet.bet_amount || 0);
                  const profit = (bet.win_amount || 0) - (bet.bet_amount || 0);
                  
                  return (
                    <Card key={bet.id} className="glass-card hover:bg-white/5 transition-colors">
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-5">
                            <div className={`p-4 rounded-xl ${
                              isWin ? 'bg-green-500/20' : 'bg-red-500/20'
                            }`}>
                              <Gamepad2 className={`h-6 w-6 ${
                                isWin ? 'text-green-400' : 'text-red-400'
                              }`} />
                            </div>
                            <div className="space-y-1">
                              <p className="font-bold text-lg">
                                {bet.game_title || `게임 ID: ${bet.game_id}`}
                              </p>
                              <p className="text-base text-muted-foreground">
                                {bet.provider_name || `프로바이더 ${bet.provider_id}`}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {formatDateTime(bet.played_at)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right space-y-2">
                            <div className="flex items-center gap-3 justify-end">
                              <span className="text-base text-muted-foreground">베팅</span>
                              <span className="font-mono text-base">{formatCurrency(bet.bet_amount || 0)}</span>
                            </div>
                            <div className="flex items-center gap-3 justify-end">
                              <span className="text-base text-muted-foreground">당첨</span>
                              <span className="font-mono text-base">{formatCurrency(bet.win_amount || 0)}</span>
                            </div>
                            <div className={`font-mono font-bold text-2xl ${
                              isWin ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* AI 게임패턴 탭 */}
          <TabsContent value="pattern" className="space-y-5 max-h-[calc(90vh-240px)] overflow-y-auto pr-2 pt-4">
            {loading ? (
              <LoadingSpinner />
            ) : !aiAnalysis ? (
              <div className="text-center py-20 glass-card rounded-xl">
                <Brain className="h-20 w-20 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground text-lg mb-4">분석할 베팅 데이터가 부족합니다.</p>
              </div>
            ) : (
              <div className="grid gap-5">
                {/* 사용자 성향 & 리스크 */}
                <div className="grid gap-5 md:grid-cols-2">
                  <Card className="glass-card metric-gradient-purple">
                    <CardContent className="pt-8 pb-8 px-8">
                      <div className="flex items-center gap-3 mb-6">
                        <Target className="h-6 w-6 text-white" />
                        <h3 className="text-xl font-bold text-white">사용자 성향</h3>
                      </div>
                      <p className="text-3xl font-bold text-white mb-3">{aiAnalysis.userType}</p>
                      <p className="text-base text-white/80">
                        베팅 패턴과 금액을 종합 분석한 결과입니다.
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="glass-card">
                    <CardContent className="pt-8 pb-8 px-8">
                      <div className="flex items-center gap-3 mb-6">
                        <AlertTriangle className="h-6 w-6 text-yellow-400" />
                        <h3 className="text-xl font-bold">리스크 분석</h3>
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                        <Badge className={`text-xl px-5 py-2 ${
                          aiAnalysis.riskLevel === 'HIGH' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                          aiAnalysis.riskLevel === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                          'bg-green-500/20 text-green-400 border-green-500/30'
                        }`}>
                          {aiAnalysis.riskLevel === 'HIGH' ? '고위험' :
                           aiAnalysis.riskLevel === 'MEDIUM' ? '중위험' : '저위험'}
                        </Badge>
                      </div>
                      <div className="text-base text-muted-foreground">
                        평균 베팅: <span className="font-mono font-semibold">{formatCurrency(aiAnalysis.avgBet)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* 선호 게임 TOP 5 */}
                <Card className="glass-card">
                  <CardContent className="pt-8 pb-8 px-8">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                      <Trophy className="h-6 w-6 text-yellow-400" />
                      <h3 className="text-xl font-bold">선호 게임 TOP 5</h3>
                    </div>
                    <div className="space-y-3">
                      {aiAnalysis.topGames.map((game: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                          <div className="flex items-center gap-4">
                            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-lg px-3 py-1">
                              {idx + 1}
                            </Badge>
                            <div>
                              <p className="font-bold text-lg">{game.game}</p>
                              <p className="text-sm text-muted-foreground">{game.provider}</p>
                            </div>
                          </div>
                          <div className="text-right space-y-1">
                            <p className="font-mono text-base font-semibold">{game.count}회</p>
                            <p className={`text-base font-semibold ${game.winRate > 50 ? 'text-green-400' : 'text-red-400'}`}>
                              승률 {game.winRate.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* 베팅 통계 */}
                <Card className="glass-card">
                  <CardContent className="pt-8 pb-8 px-8">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                      <BarChart3 className="h-6 w-6 text-cyan-400" />
                      <h3 className="text-xl font-bold">베팅 통계</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div className="space-y-2">
                        <p className="text-base text-muted-foreground">총 베팅 횟수</p>
                        <p className="text-2xl font-mono font-bold">{aiAnalysis.totalBets}회</p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-base text-muted-foreground">평균 베팅액</p>
                        <p className="text-2xl font-mono font-bold">{formatCurrency(aiAnalysis.avgBet)}</p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-base text-muted-foreground">승률</p>
                        <p className={`text-2xl font-mono font-bold ${
                          aiAnalysis.winRate > 50 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {aiAnalysis.winRate.toFixed(1)}%
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-base text-muted-foreground">총 손익</p>
                        <p className={`text-2xl font-mono font-bold ${
                          aiAnalysis.netProfit >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {aiAnalysis.netProfit >= 0 ? '+' : ''}
                          {formatCurrency(aiAnalysis.netProfit)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* AI 인사이트 */}
                <Card className="glass-card">
                  <CardContent className="pt-8 pb-8 px-8">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                      <Brain className="h-6 w-6 text-purple-400" />
                      <h3 className="text-xl font-bold">AI 분석 인사이트</h3>
                    </div>
                    <div className="space-y-3">
                      {aiAnalysis.insights.map((insight: string, idx: number) => (
                        <div key={idx} className="flex items-start gap-4 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/15 transition-colors">
                          <Brain className="h-5 w-5 text-purple-400 mt-1 flex-shrink-0" />
                          <p className="text-base leading-relaxed">{insight}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* 활동 시간 패턴 */}
                <Card className="glass-card">
                  <CardContent className="pt-8 pb-8 px-8">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                      <Clock className="h-6 w-6 text-orange-400" />
                      <h3 className="text-xl font-bold">활동 시간 패턴</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                        <span className="text-base text-muted-foreground">피크 시간대</span>
                        <span className="font-bold text-2xl">{aiAnalysis.peakHour}시</span>
                      </div>
                      <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                        <span className="text-base text-muted-foreground">야간 활동 비율</span>
                        <span className="font-bold text-2xl">{aiAnalysis.nightPlayRatio.toFixed(1)}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}