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
  Wallet,
  Activity,
  Clock,
  Brain,
  Trophy,
  BarChart3,
  Target,
  AlertTriangle,
  TrendingUp,
  ArrowDownToLine,
  Gamepad2,
  X
} from "lucide-react";
import { Button } from "../ui/button";

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
  notes?: string;
}

interface BettingRecord {
  id: string;
  game_id: number;
  provider_id: number;
  bet_amount: number;
  win_amount: number;
  played_at: string;
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
    lastActivity: '',
    gameCount: 0,
    winRate: 0
  });

  // 기본 통계 계산
  const calculateStats = async () => {
    try {
      setLoading(true);

      // 입출금 통계
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

      // 베팅 통계
      const { data: betData } = await supabase
        .from('game_records')
        .select('bet_amount, win_amount')
        .eq('user_id', user.id);

      const totalBets = (betData || []).reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      const totalWinAmount = (betData || []).reduce((sum, b) => sum + (b.win_amount || 0), 0);
      const gameCount = betData?.length || 0;
      const winCount = (betData || []).filter(b => (b.win_amount || 0) > (b.bet_amount || 0)).length;
      const winRate = gameCount > 0 ? (winCount / gameCount * 100) : 0;

      // 계정 나이
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
        lastActivity: lastSession?.launched_at || user.created_at,
        gameCount,
        winRate
      });

    } catch (error) {
      console.error('통계 계산 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  // 입출금 내역 조회
  const fetchTransactions = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setTransactions(data || []);
      
    } catch (error) {
      console.error('입출금 내역 조회 오류:', error);
      toast.error('입출금 내역을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 베팅 내역 조회
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

  // AI 게임 패턴 분석
  const analyzePattern = async () => {
    try {
      setLoading(true);

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

      // 게임별 통계 집계
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

      // 시간대 패턴 분석
      const hourlyPattern = new Array(24).fill(0);
      bets.forEach(bet => {
        const hour = new Date(bet.played_at).getHours();
        hourlyPattern[hour]++;
      });

      const peakHour = hourlyPattern.indexOf(Math.max(...hourlyPattern));
      const nightPlayCount = hourlyPattern.slice(22).reduce((a, b) => a + b, 0) + 
                             hourlyPattern.slice(0, 6).reduce((a, b) => a + b, 0);
      const nightPlayRatio = (nightPlayCount / bets.length) * 100;

      // 베팅 패턴 통계
      const betAmounts = bets.map(b => b.bet_amount || 0);
      const avgBet = betAmounts.reduce((a, b) => a + b, 0) / bets.length;
      const maxBet = Math.max(...betAmounts);

      const totalBet = bets.reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      const totalWin = bets.reduce((sum, b) => sum + (b.win_amount || 0), 0);
      const netProfit = totalWin - totalBet;
      
      const winCount = bets.filter(b => (b.win_amount || 0) > (b.bet_amount || 0)).length;
      const winRate = (winCount / bets.length) * 100;

      // 리스크 레벨 계산
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

      // AI 인사이트 생성
      const insights: string[] = [];

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

      insights.push(`🕐 주로 ${peakHour}시에 가장 활발한 활동을 보입니다.`);
      
      if (nightPlayRatio > 40) {
        insights.push(`🌙 야간 시간대(22시~6시) 플레이 비율이 ${nightPlayRatio.toFixed(1)}%로 높습니다.`);
      }

      if (winRate > 55) {
        insights.push(`📈 전체 승률 ${winRate.toFixed(1)}%로 평균 이상의 우수한 성과를 보입니다.`);
      } else if (winRate < 45) {
        insights.push(`📉 전체 승률 ${winRate.toFixed(1)}%로 게임 전략 재검토가 필요합니다.`);
      } else {
        insights.push(`📊 전체 승률 ${winRate.toFixed(1)}%로 평균적인 수준입니다.`);
      }

      if (netProfit > 0) {
        insights.push(`💰 총 ${Math.abs(netProfit).toLocaleString()}원의 수익을 달성했습니다.`);
      } else {
        insights.push(`💸 총 ${Math.abs(netProfit).toLocaleString()}원의 손실이 발생했습니다.`);
      }

      if (avgBet > 50000) {
        insights.push(`⚡ 평균 베팅액이 ${avgBet.toLocaleString()}원으로 고액 베팅 성향입니다.`);
      }

      const betVariance = maxBet / avgBet;
      if (betVariance > 10) {
        insights.push(`📊 베팅 금액 변동성이 높아 일관된 베팅 전략이 필요합니다.`);
      }

      // 사용자 성향 판단
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
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };
  const formatDateTime = (date: string) => {
    const d = new Date(date);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">승인</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">대기</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">거절</Badge>;
      default:
        return <Badge className="text-xs">{status}</Badge>;
    }
  };

  if (!user) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!max-w-[2400px] w-[98vw] max-h-[92vh] overflow-hidden glass-card border border-white/10 p-0">
        <DialogHeader className="border-b border-white/10 pb-3 pt-4 px-6">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span>{user.nickname}</span>
                <span className="text-muted-foreground text-sm">({user.username})</span>
                {user.status === 'active' ? (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">활성</Badge>
                ) : user.status === 'suspended' ? (
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">정지</Badge>
                ) : (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">대기</Badge>
                )}
                {user.is_online && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">접속중</Badge>
                )}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5 pl-12">
            회원의 상세 정보, 입출금 내역, 베팅 내역 및 AI 게임 패턴 분석을 확인할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full px-6">
          <TabsList className="grid w-full grid-cols-4 glass-card h-9">
            <TabsTrigger value="basic" className="flex items-center gap-1.5 text-xs">
              <User className="h-3 w-3" />
              기본정보
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex items-center gap-1.5 text-xs">
              <Wallet className="h-3 w-3" />
              입출금내역
            </TabsTrigger>
            <TabsTrigger value="betting" className="flex items-center gap-1.5 text-xs">
              <Gamepad2 className="h-3 w-3" />
              베팅내역
            </TabsTrigger>
            <TabsTrigger value="pattern" className="flex items-center gap-1.5 text-xs">
              <Brain className="h-3 w-3" />
              AI 게임패턴
            </TabsTrigger>
          </TabsList>

          {/* 기본정보 탭 */}
          <TabsContent value="basic" className="max-h-[calc(92vh-140px)] overflow-y-auto pr-2 pt-3">
            {loading ? (
              <LoadingSpinner />
            ) : (
              <div className="space-y-4 p-4">
                {/* 기본 정보 */}
                <div>
                  <h3 className="flex items-center gap-2 mb-3">
                    <User className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-xs">기본 정보</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">아이디</span>
                      <span className="text-xs font-mono">{user.username}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">닉네임</span>
                      <span className="text-xs">{user.nickname}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">가입일</span>
                      <span className="text-xs">{formatDate(user.created_at)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">가입 경과</span>
                      <span className="text-xs">{stats.accountAge}일</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">은행</span>
                      <span className="text-xs">{user.bank_name || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">계좌번호</span>
                      <span className="text-xs font-mono">{user.bank_account || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* 잔고 정보 */}
                <div>
                  <h3 className="flex items-center gap-2 mb-3">
                    <Wallet className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-xs">잔고 정보</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">보유금</span>
                      <span className="text-xs font-mono">{formatCurrency(user.balance || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">포인트</span>
                      <span className="text-xs font-mono">{formatCurrency(user.points || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">총 입금</span>
                      <span className="text-xs font-mono text-blue-400">{formatCurrency(stats.totalDeposit)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">총 출금</span>
                      <span className="text-xs font-mono text-pink-400">{formatCurrency(stats.totalWithdraw)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gradient-to-r from-white/10 to-white/5 border border-white/20">
                      <span className="text-xs">순 입출금</span>
                      <span className={`text-xs font-mono ${stats.totalDeposit - stats.totalWithdraw >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatCurrency(stats.totalDeposit - stats.totalWithdraw)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gradient-to-r from-white/10 to-white/5 border border-white/20">
                      <span className="text-xs">게임 손익</span>
                      <span className={`text-xs font-mono ${stats.totalWinAmount - stats.totalBets >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {stats.totalWinAmount - stats.totalBets >= 0 ? '+' : ''}
                        {formatCurrency(stats.totalWinAmount - stats.totalBets)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 베팅 통계 */}
                <div>
                  <h3 className="flex items-center gap-2 mb-3">
                    <Activity className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs">베팅 통계</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">게임 플레이</span>
                      <span className="text-xs font-mono">{stats.gameCount}회</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">승률</span>
                      <span className={`text-xs font-mono ${stats.winRate > 50 ? 'text-green-400' : 'text-red-400'}`}>
                        {stats.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">총 베팅액</span>
                      <span className="text-xs font-mono">{formatCurrency(stats.totalBets)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">총 당첨액</span>
                      <span className="text-xs font-mono">{formatCurrency(stats.totalWinAmount)}</span>
                    </div>
                  </div>
                </div>

                {/* 활동 정보 */}
                <div>
                  <h3 className="flex items-center gap-2 mb-3">
                    <Clock className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-xs">활동 정보</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">최근 활동</span>
                      <span className="text-xs">{formatDateTime(stats.lastActivity)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-xs text-muted-foreground">추천인</span>
                      <span className="text-xs">{user.referrer?.username || '-'}</span>
                    </div>
                    {user.memo && (
                      <div className="col-span-2 py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                        <span className="text-xs text-muted-foreground block mb-1">메모</span>
                        <span className="text-xs">{user.memo}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 입출금내역 탭 */}
          <TabsContent value="transactions" className="max-h-[calc(92vh-140px)] overflow-y-auto pr-2 pt-3">
            {loading ? (
              <LoadingSpinner />
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-xl">
                <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-xs">입출금 내역이 없습니다.</p>
              </div>
            ) : (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-white/10">
                      <tr className="bg-white/5">
                        <th className="px-3 py-2 text-left text-xs">구분</th>
                        <th className="px-3 py-2 text-left text-xs">상태</th>
                        <th className="px-3 py-2 text-left text-xs">일시</th>
                        <th className="px-3 py-2 text-left text-xs">메모</th>
                        <th className="px-3 py-2 text-right text-xs">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className={`p-1 rounded-lg ${
                                tx.transaction_type === 'deposit' 
                                  ? 'bg-green-500/20' 
                                  : 'bg-red-500/20'
                              }`}>
                                {tx.transaction_type === 'deposit' ? (
                                  <TrendingUp className="h-3 w-3 text-green-400" />
                                ) : (
                                  <ArrowDownToLine className="h-3 w-3 text-red-400" />
                                )}
                              </div>
                              <span className="text-xs">
                                {tx.transaction_type === 'deposit' ? '입금' : '출금'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {getStatusBadge(tx.status)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {formatDateTime(tx.created_at)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs max-w-xs truncate">
                            {tx.notes || '-'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-mono text-xs ${
                              tx.transaction_type === 'deposit' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {tx.transaction_type === 'deposit' ? '+' : '-'}
                              {formatCurrency(tx.amount)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 베팅내역 탭 */}
          <TabsContent value="betting" className="max-h-[calc(92vh-140px)] overflow-y-auto pr-2 pt-3">
            {loading ? (
              <LoadingSpinner />
            ) : bettingHistory.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-xl">
                <Gamepad2 className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-xs">베팅 내역이 없습니다.</p>
              </div>
            ) : (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-white/10">
                      <tr className="bg-white/5">
                        <th className="px-3 py-2 text-left text-xs">게임</th>
                        <th className="px-3 py-2 text-left text-xs">프로바이더</th>
                        <th className="px-3 py-2 text-left text-xs">일시</th>
                        <th className="px-3 py-2 text-right text-xs">베팅</th>
                        <th className="px-3 py-2 text-right text-xs">당첨</th>
                        <th className="px-3 py-2 text-right text-xs">손익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bettingHistory.map((bet) => {
                        const isWin = (bet.win_amount || 0) > (bet.bet_amount || 0);
                        const profit = (bet.win_amount || 0) - (bet.bet_amount || 0);
                        
                        return (
                          <tr key={bet.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <div className={`p-1 rounded-lg ${
                                  isWin ? 'bg-green-500/20' : 'bg-red-500/20'
                                }`}>
                                  <Gamepad2 className={`h-3 w-3 ${
                                    isWin ? 'text-green-400' : 'text-red-400'
                                  }`} />
                                </div>
                                <span className="text-xs">
                                  {bet.game_title || `게임 ID: ${bet.game_id}`}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">
                              {bet.provider_name || `프로바이더 ${bet.provider_id}`}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">
                              {formatDateTime(bet.played_at)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {formatCurrency(bet.bet_amount || 0)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {formatCurrency(bet.win_amount || 0)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className={`font-mono text-xs ${
                                isWin ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* AI 게임패턴 탭 */}
          <TabsContent value="pattern" className="space-y-3 max-h-[calc(92vh-140px)] overflow-y-auto pr-2 pt-3">
            {loading ? (
              <LoadingSpinner />
            ) : !aiAnalysis ? (
              <div className="text-center py-12 glass-card rounded-xl">
                <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-xs mb-2">분석할 베팅 데이터가 부족합니다.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {/* 사용자 성향 & 리스크 & 베팅 통계 & 시간 패턴 */}
                <div className="grid gap-3 grid-cols-4">
                  <Card className="glass-card metric-gradient-purple">
                    <CardContent className="pt-3 pb-3 px-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Target className="h-3 w-3 text-white" />
                        <h3 className="text-xs text-white">사용자 성향</h3>
                      </div>
                      <p className="text-sm font-bold text-white mb-1">{aiAnalysis.userType}</p>
                      <p className="text-xs text-white/80">베팅 패턴 종합 분석</p>
                    </CardContent>
                  </Card>

                  <Card className="glass-card">
                    <CardContent className="pt-3 pb-3 px-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <AlertTriangle className="h-3 w-3 text-yellow-400" />
                        <h3 className="text-xs">리스크 분석</h3>
                      </div>
                      <Badge className={`text-xs px-2 py-0.5 mb-1.5 ${
                        aiAnalysis.riskLevel === 'HIGH' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                        aiAnalysis.riskLevel === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                        'bg-green-500/20 text-green-400 border-green-500/30'
                      }`}>
                        {aiAnalysis.riskLevel === 'HIGH' ? '고위험' :
                         aiAnalysis.riskLevel === 'MEDIUM' ? '중위험' : '저위험'}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        평균: <span className="font-mono">{formatCurrency(aiAnalysis.avgBet)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="glass-card">
                    <CardContent className="pt-3 pb-3 px-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <BarChart3 className="h-3 w-3 text-cyan-400" />
                        <h3 className="text-xs">베팅 통계</h3>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">총 베팅</span>
                          <span className="text-xs font-mono">{aiAnalysis.totalBets}회</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">승률</span>
                          <span className={`text-xs font-mono ${aiAnalysis.winRate > 50 ? 'text-green-400' : 'text-red-400'}`}>
                            {aiAnalysis.winRate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="glass-card">
                    <CardContent className="pt-3 pb-3 px-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Clock className="h-3 w-3 text-orange-400" />
                        <h3 className="text-xs">시간 패턴</h3>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">피크</span>
                          <span className="text-xs font-mono">{aiAnalysis.peakHour}시</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">야간</span>
                          <span className="text-xs font-mono">{aiAnalysis.nightPlayRatio.toFixed(1)}%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* 선호 게임 TOP 5 */}
                <Card className="glass-card">
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-white/10">
                      <Trophy className="h-3 w-3 text-yellow-400" />
                      <h3 className="text-xs">선호 게임 TOP 5</h3>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {aiAnalysis.topGames.map((game: any, idx: number) => (
                        <div key={idx} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs px-1.5 py-0.5 mb-1.5">
                            {idx + 1}위
                          </Badge>
                          <p className="text-xs mb-0.5 truncate">{game.game}</p>
                          <p className="text-xs text-muted-foreground mb-1.5 truncate">{game.provider}</p>
                          <div className="space-y-0.5">
                            <p className="font-mono text-xs">{game.count}회</p>
                            <p className={`text-xs ${game.winRate > 50 ? 'text-green-400' : 'text-red-400'}`}>
                              승률 {game.winRate.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* AI 인사이트 */}
                <Card className="glass-card">
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-white/10">
                      <Brain className="h-3 w-3 text-purple-400" />
                      <h3 className="text-xs">AI 분석 인사이트</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {aiAnalysis.insights.map((insight: string, idx: number) => (
                        <div key={idx} className="flex items-start gap-1.5 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/15 transition-colors">
                          <Brain className="h-3 w-3 text-purple-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs leading-relaxed">{insight}</p>
                        </div>
                      ))}
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
