import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { 
  User, 
  Wallet,
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  Coins,
  Eye,
  EyeOff,
  Edit,
  Save,
  X,
  Calendar,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Gamepad2,
  Trophy,
  Crown,
  Settings
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Alert, AlertDescription } from "../ui/alert";
import { supabase } from "../../lib/supabase";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";

interface UserProfileProps {
  user: any;
  onRouteChange: (route: string) => void;
}

interface Transaction {
  id: string;
  transaction_type: 'deposit' | 'withdrawal' | 'point_conversion' | 'admin_adjustment';
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  balance_before: number;
  balance_after: number;
  bank_name?: string;
  bank_account?: string;
  memo?: string;
  created_at: string;
  processed_at?: string;
}

interface PointTransaction {
  id: string;
  transaction_type: 'earn' | 'use' | 'convert_to_balance' | 'admin_adjustment';
  amount: number;
  points_before: number;
  points_after: number;
  memo?: string;
  created_at: string;
}

interface GameRecord {
  id: string;
  bet_amount: number;
  win_amount: number;
  balance_before: number;
  balance_after: number;
  played_at: string;
  games?: {
    name: string;
    type: string;
  };
  game_providers?: {
    name: string;
  };
}

interface UserStats {
  total_deposits: number;
  total_withdrawals: number;
  total_bets: number;
  total_wins: number;
  game_count: number;
  win_rate: number;
}

export function UserProfile({ user, onRouteChange }: UserProfileProps) {
  const [activeTab, setActiveTab] = useState('info');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pointTransactions, setPointTransactions] = useState<PointTransaction[]>([]);
  const [gameRecords, setGameRecords] = useState<GameRecord[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showBalance, setShowBalance] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showPointConvertDialog, setShowPointConvertDialog] = useState(false);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [currentPoints, setCurrentPoints] = useState(0);

  // 편집 가능한 정보
  const [editableInfo, setEditableInfo] = useState({
    nickname: user.nickname || '',
    bank_name: user.bank_name || '',
    bank_account: user.bank_account || '',
    bank_holder: user.bank_holder || ''
  });

  // 비밀번호 변경
  const [passwordChange, setPasswordChange] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // 현재 잔고 및 포인트 조회
  const fetchCurrentBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('balance, points')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      
      setCurrentBalance(parseFloat(data.balance) || 0);
      setCurrentPoints(parseFloat(data.points) || 0);
    } catch (error) {
      console.error('잔고 조회 오류:', error);
    }
  };

  // 입출금 내역 조회
  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .in('transaction_type', ['deposit', 'withdrawal'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('거래 내역 조회 오류:', error);
    }
  };

  // 포인트 내역 조회
  const fetchPointTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('point_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setPointTransactions(data || []);
    } catch (error) {
      console.error('포인트 내역 조회 오류:', error);
    }
  };

  // 베팅 내역 조회
  const fetchGameRecords = async () => {
    try {
      const { data, error } = await supabase
        .from('game_records')
        .select(`
          *,
          games (name, type),
          game_providers (name)
        `)
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setGameRecords(data || []);
    } catch (error) {
      console.error('게임 기록 조회 오류:', error);
    }
  };

  // 사용자 통계 조회
  const fetchUserStats = async () => {
    try {
      // 입출금 통계
      const { data: transactionStats } = await supabase
        .from('transactions')
        .select('transaction_type, amount, status')
        .eq('user_id', user.id)
        .eq('status', 'completed');

      const totalDeposits = (transactionStats || [])
        .filter(t => t.transaction_type === 'deposit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const totalWithdrawals = (transactionStats || [])
        .filter(t => t.transaction_type === 'withdrawal')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      // 게임 통계
      const { data: gameStats } = await supabase
        .from('game_records')
        .select('bet_amount, win_amount')
        .eq('user_id', user.id);

      const totalBets = (gameStats || []).reduce((sum, g) => sum + parseFloat(g.bet_amount), 0);
      const totalWins = (gameStats || []).reduce((sum, g) => sum + parseFloat(g.win_amount), 0);
      const gameCount = gameStats?.length || 0;
      const winRate = gameCount > 0 ? ((gameStats || []).filter(g => parseFloat(g.win_amount) > parseFloat(g.bet_amount)).length / gameCount) * 100 : 0;

      setUserStats({
        total_deposits: totalDeposits,
        total_withdrawals: totalWithdrawals,
        total_bets: totalBets,
        total_wins: totalWins,
        game_count: gameCount,
        win_rate: winRate
      });
    } catch (error) {
      console.error('통계 조회 오류:', error);
    }
  };

  // 정보 수정
  const handleUpdateInfo = async () => {
    try {
      const { error } = await supabase
        .from('users')
        .update({
          nickname: editableInfo.nickname,
          bank_name: editableInfo.bank_name,
          bank_account: editableInfo.bank_account,
          bank_holder: editableInfo.bank_holder
        })
        .eq('id', user.id);

      if (error) throw error;

      // 활동 로그 기록
      await supabase
        .from('activity_logs')
        .insert([{
          actor_type: 'user',
          actor_id: user.id,
          action: 'profile_update',
          details: {
            nickname: editableInfo.nickname,
            bank_updated: !!(editableInfo.bank_name || editableInfo.bank_account)
          }
        }]);

      setIsEditing(false);
      toast.success('정보가 성공적으로 수정되었습니다.');
    } catch (error: any) {
      console.error('정보 수정 오류:', error);
      toast.error(error.message || '정보 수정 중 오류가 발생했습니다.');
    }
  };

  // 비밀번호 변경
  const handlePasswordChange = async () => {
    if (passwordChange.newPassword !== passwordChange.confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    if (passwordChange.newPassword.length < 6) {
      toast.error('비밀번호는 6자리 이상이어야 합니다.');
      return;
    }

    try {
      // 현재 비밀번호 확인
      const { data: authData, error: authError } = await supabase
        .rpc('user_login', {
          p_username: user.username,
          p_password: passwordChange.currentPassword
        });

      if (authError || !authData || authData.length === 0) {
        toast.error('현재 비밀번호가 올바르지 않습니다.');
        return;
      }

      // 새 비밀번호로 업데이트
      const { error } = await supabase
        .from('users')
        .update({ 
          password_hash: passwordChange.newPassword // 실제로는 해시화해야 함
        })
        .eq('id', user.id);

      if (error) throw error;

      // 비밀번호 변경 로그
      await supabase
        .from('activity_logs')
        .insert([{
          actor_type: 'user',
          actor_id: user.id,
          action: 'password_change',
          details: {
            changed_at: new Date().toISOString()
          }
        }]);

      setPasswordChange({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswordDialog(false);
      toast.success('비밀번호가 성공적으로 변경되었습니다.');
    } catch (error: any) {
      console.error('비밀번호 변경 오류:', error);
      toast.error(error.message || '비밀번호 변경 중 오류가 발생했습니다.');
    }
  };

  // 포인트를 잔고로 전환
  const convertPointsToBalance = async (points: number) => {
    if (points > currentPoints) {
      toast.error('보유 포인트가 부족합니다.');
      return;
    }

    try {
      // 포인트 차감 및 잔고 증가
      const { error: userError } = await supabase
        .from('users')
        .update({
          points: currentPoints - points,
          balance: currentBalance + points
        })
        .eq('id', user.id);

      if (userError) throw userError;

      // 포인트 거래 기록
      await supabase
        .from('point_transactions')
        .insert([{
          user_id: user.id,
          transaction_type: 'convert_to_balance',
          amount: points,
          points_before: currentPoints,
          points_after: currentPoints - points,
          memo: '포인트를 잔고로 전환'
        }]);

      // 잔고 거래 기록
      await supabase
        .from('transactions')
        .insert([{
          user_id: user.id,
          transaction_type: 'point_conversion',
          amount: points,
          status: 'completed',
          balance_before: currentBalance,
          balance_after: currentBalance + points,
          memo: '포인트 전환'
        }]);

      fetchCurrentBalance();
      fetchTransactions();
      fetchPointTransactions();

      toast.success(`${points.toLocaleString()} 포인트가 잔고로 전환되었습니다.`);
    } catch (error: any) {
      console.error('포인트 전환 오류:', error);
      toast.error(error.message || '포인트 전환 중 오류가 발생했습니다.');
    }
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'pending':
        return { color: 'bg-yellow-500', textColor: 'text-yellow-400', icon: Clock, label: '대기중' };
      case 'approved':
        return { color: 'bg-blue-500', textColor: 'text-blue-400', icon: RefreshCw, label: '처리중' };
      case 'completed':
        return { color: 'bg-green-500', textColor: 'text-green-400', icon: CheckCircle, label: '완료' };
      case 'rejected':
        return { color: 'bg-red-500', textColor: 'text-red-400', icon: XCircle, label: '거절' };
      default:
        return { color: 'bg-slate-500', textColor: 'text-slate-400', icon: Clock, label: '알 수 없음' };
    }
  };

  const getVipBadge = (vipLevel: number) => {
    if (vipLevel >= 5) return { label: 'DIAMOND', color: 'bg-purple-600', textColor: 'text-purple-300' };
    if (vipLevel >= 4) return { label: 'PLATINUM', color: 'bg-gray-400', textColor: 'text-gray-300' };
    if (vipLevel >= 3) return { label: 'GOLD', color: 'bg-yellow-500', textColor: 'text-yellow-300' };
    if (vipLevel >= 2) return { label: 'SILVER', color: 'bg-gray-300', textColor: 'text-gray-700' };
    if (vipLevel >= 1) return { label: 'BRONZE', color: 'bg-orange-400', textColor: 'text-orange-300' };
    return { label: 'MEMBER', color: 'bg-slate-500', textColor: 'text-slate-300' };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(amount);
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  const vipBadge = getVipBadge(user.vip_level || 0);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchCurrentBalance(),
        fetchTransactions(),
        fetchPointTransactions(),
        fetchGameRecords(),
        fetchUserStats()
      ]);
      setIsLoading(false);
    };

    loadData();

    // 실시간 업데이트 구독
    const subscription = supabase
      .channel('profile_updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${user.id}`
      }, () => {
        fetchCurrentBalance();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${user.id}`
      }, () => {
        fetchTransactions();
        fetchUserStats();
      })
      .subscribe();

    return () => subscription.unsubscribe();
  }, [user.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">내 정보</h1>
          <p className="text-slate-400">계정 정보 및 이용 내역을 확인하세요</p>
        </div>
      </div>

      {/* 사용자 정보 카드 */}
      <Card className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border-blue-600/50">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <User className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-bold text-white">{user.nickname}</h2>
                  <Badge className={`${vipBadge.color} text-white px-3 py-1`}>
                    <Crown className="w-4 h-4 mr-1" />
                    {vipBadge.label}
                  </Badge>
                </div>
                <p className="text-slate-300">@{user.username}</p>
                <p className="text-slate-400 text-sm">
                  가입일: {formatDateTime(user.created_at)}
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400 flex items-center justify-center gap-2">
                  {showBalance ? (
                    <>₩{formatCurrency(currentBalance)}</>
                  ) : (
                    '••••••••'
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowBalance(!showBalance)}
                    className="w-6 h-6 p-0"
                  >
                    {showBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <div className="text-sm text-slate-400">보유금</div>
              </div>
              <div className="text-center">
                {currentPoints > 0 ? (
                  <Button
                    variant="ghost"
                    className="flex flex-col items-center p-2 h-auto hover:bg-yellow-500/10 transition-colors"
                    onClick={() => setShowPointConvertDialog(true)}
                  >
                    <div className="text-2xl font-bold text-yellow-400 flex items-center gap-2">
                      {formatCurrency(currentPoints)}P
                      <ArrowUpRight className="w-4 h-4" />
                    </div>
                    <div className="text-sm text-slate-400">포인트 (클릭하여 전환)</div>
                  </Button>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-yellow-400">
                      {formatCurrency(currentPoints)}P
                    </div>
                    <div className="text-sm text-slate-400">포인트</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 통계 카드 */}
      {userStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <TrendingUp className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <div className="text-lg font-bold text-white">₩{formatCurrency(userStats.total_deposits)}</div>
              <div className="text-sm text-slate-400">총 입금</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <TrendingDown className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <div className="text-lg font-bold text-white">₩{formatCurrency(userStats.total_withdrawals)}</div>
              <div className="text-sm text-slate-400">총 출금</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <Gamepad2 className="w-8 h-8 text-purple-400 mx-auto mb-2" />
              <div className="text-lg font-bold text-white">{userStats.game_count.toLocaleString()}</div>
              <div className="text-sm text-slate-400">게임 횟수</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <Trophy className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <div className="text-lg font-bold text-white">{userStats.win_rate.toFixed(1)}%</div>
              <div className="text-sm text-slate-400">승률</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 탭 메뉴 */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 bg-slate-800/50">
          <TabsTrigger value="info" className="flex items-center gap-2">
            <User className="w-4 h-4" />
            기본정보
          </TabsTrigger>
          <TabsTrigger value="transactions" className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            입출금내역
          </TabsTrigger>
          <TabsTrigger value="points" className="flex items-center gap-2">
            <Coins className="w-4 h-4" />
            포인트내역
          </TabsTrigger>
          <TabsTrigger value="games" className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4" />
            베팅내역
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            설정
          </TabsTrigger>
        </TabsList>

        {/* 기본정보 탭 */}
        <TabsContent value="info">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">기본 정보</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (isEditing) {
                      setEditableInfo({
                        nickname: user.nickname || '',
                        bank_name: user.bank_name || '',
                        bank_account: user.bank_account || '',
                        bank_holder: user.bank_holder || ''
                      });
                      setIsEditing(false);
                    } else {
                      setIsEditing(true);
                    }
                  }}
                >
                  {isEditing ? (
                    <>
                      <X className="w-4 h-4 mr-2" />
                      취소
                    </>
                  ) : (
                    <>
                      <Edit className="w-4 h-4 mr-2" />
                      수정
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">아이디</Label>
                  <Input
                    value={user.username}
                    disabled
                    className="bg-slate-700/50 border-slate-600 text-slate-400"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">닉네임</Label>
                  <Input
                    value={editableInfo.nickname}
                    onChange={(e) => setEditableInfo(prev => ({ ...prev, nickname: e.target.value }))}
                    disabled={!isEditing}
                    className="bg-slate-700/50 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">은행명</Label>
                  <Select
                    value={editableInfo.bank_name}
                    onValueChange={(value) => setEditableInfo(prev => ({ ...prev, bank_name: value }))}
                    disabled={!isEditing}
                  >
                    <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                      <SelectValue placeholder="은행을 선택하세요" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {['국민은행', '신한은행', '우리은행', 'KB국민은행', 'KEB하나은행', '농협은행', '기업은행'].map((bank) => (
                        <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">계좌번호</Label>
                  <Input
                    value={editableInfo.bank_account}
                    onChange={(e) => setEditableInfo(prev => ({ ...prev, bank_account: e.target.value }))}
                    disabled={!isEditing}
                    className="bg-slate-700/50 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">예금주명</Label>
                  <Input
                    value={editableInfo.bank_holder}
                    onChange={(e) => setEditableInfo(prev => ({ ...prev, bank_holder: e.target.value }))}
                    disabled={!isEditing}
                    className="bg-slate-700/50 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">VIP 등급</Label>
                  <div className="flex items-center gap-2">
                    <Badge className={`${vipBadge.color} text-white px-3 py-1`}>
                      <Crown className="w-4 h-4 mr-1" />
                      {vipBadge.label}
                    </Badge>
                    <span className="text-slate-400 text-sm">레벨 {user.vip_level || 0}</span>
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    onClick={handleUpdateInfo}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    저장
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 입출금내역 탭 */}
        <TabsContent value="transactions">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">입출금 내역</CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <div className="space-y-4">
                  {transactions.map((transaction) => {
                    const statusInfo = getStatusInfo(transaction.status);
                    const StatusIcon = statusInfo.icon;
                    const isDeposit = transaction.transaction_type === 'deposit';
                    
                    return (
                      <div key={transaction.id} className="p-4 bg-slate-700/30 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isDeposit ? (
                              <ArrowUpRight className="w-5 h-5 text-green-400" />
                            ) : (
                              <ArrowDownLeft className="w-5 h-5 text-blue-400" />
                            )}
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-white">
                                  {isDeposit ? '입금' : '출금'}
                                </span>
                                <Badge className={`${statusInfo.color} text-white text-xs`}>
                                  <StatusIcon className="w-3 h-3 mr-1" />
                                  {statusInfo.label}
                                </Badge>
                              </div>
                              <div className="text-sm text-slate-400">
                                {formatDateTime(transaction.created_at)}
                              </div>
                              {transaction.bank_name && (
                                <div className="text-sm text-slate-500">
                                  {transaction.bank_name} {transaction.bank_account}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-lg font-bold ${isDeposit ? 'text-green-400' : 'text-blue-400'}`}>
                              {isDeposit ? '+' : '-'}₩{formatCurrency(transaction.amount)}
                            </div>
                            <div className="text-sm text-slate-400">
                              잔고: ₩{formatCurrency(transaction.balance_after)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CreditCard className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">입출금 내역이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 포인트내역 탭 */}
        <TabsContent value="points">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">포인트 내역</CardTitle>
                {currentPoints > 0 && (
                  <Button
                    onClick={() => convertPointsToBalance(currentPoints)}
                    size="sm"
                    className="bg-yellow-600 hover:bg-yellow-700"
                  >
                    <Coins className="w-4 h-4 mr-2" />
                    전체 전환 ({formatCurrency(currentPoints)}P)
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {pointTransactions.length > 0 ? (
                <div className="space-y-4">
                  {pointTransactions.map((transaction) => {
                    const isEarn = transaction.transaction_type === 'earn';
                    const isConvert = transaction.transaction_type === 'convert_to_balance';
                    
                    return (
                      <div key={transaction.id} className="p-4 bg-slate-700/30 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Coins className={`w-5 h-5 ${isEarn ? 'text-yellow-400' : isConvert ? 'text-blue-400' : 'text-slate-400'}`} />
                            <div>
                              <div className="font-medium text-white mb-1">
                                {transaction.transaction_type === 'earn' && '포인트 적립'}
                                {transaction.transaction_type === 'use' && '포인트 사용'}
                                {transaction.transaction_type === 'convert_to_balance' && '잔고 전환'}
                                {transaction.transaction_type === 'admin_adjustment' && '관리자 조정'}
                              </div>
                              <div className="text-sm text-slate-400">
                                {formatDateTime(transaction.created_at)}
                              </div>
                              {transaction.memo && (
                                <div className="text-sm text-slate-500">
                                  {transaction.memo}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-lg font-bold ${isEarn ? 'text-yellow-400' : 'text-slate-400'}`}>
                              {isEarn ? '+' : '-'}{formatCurrency(transaction.amount)}P
                            </div>
                            <div className="text-sm text-slate-400">
                              포인트: {formatCurrency(transaction.points_after)}P
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Coins className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">포인트 내역이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 베팅내역 탭 */}
        <TabsContent value="games">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">베팅 내역</CardTitle>
            </CardHeader>
            <CardContent>
              {gameRecords.length > 0 ? (
                <div className="space-y-4">
                  {gameRecords.map((record) => {
                    const isWin = parseFloat(record.win_amount) > parseFloat(record.bet_amount);
                    const profit = parseFloat(record.win_amount) - parseFloat(record.bet_amount);
                    
                    return (
                      <div key={record.id} className="p-4 bg-slate-700/30 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Gamepad2 className="w-5 h-5 text-purple-400" />
                            <div>
                              <div className="font-medium text-white mb-1">
                                {record.games?.name || '알 수 없는 게임'}
                              </div>
                              <div className="text-sm text-slate-400">
                                {formatDateTime(record.played_at)}
                              </div>
                              <div className="text-sm text-slate-500">
                                {record.game_providers?.name} • {record.games?.type}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-slate-400 mb-1">
                              베팅: ₩{formatCurrency(parseFloat(record.bet_amount))}
                            </div>
                            <div className="text-sm text-slate-400 mb-1">
                              당첨: ₩{formatCurrency(parseFloat(record.win_amount))}
                            </div>
                            <div className={`font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                              {isWin ? '+' : ''}₩{formatCurrency(profit)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Gamepad2 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">베팅 내역이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 설정 탭 */}
        <TabsContent value="settings">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">계정 설정</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <Settings className="w-4 h-4 mr-2" />
                    비밀번호 변경
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-800 border-slate-700 text-white">
                  <DialogHeader>
                    <DialogTitle>비밀번호 변경</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-slate-300">현재 비밀번호</Label>
                      <Input
                        type="password"
                        value={passwordChange.currentPassword}
                        onChange={(e) => setPasswordChange(prev => ({ ...prev, currentPassword: e.target.value }))}
                        className="bg-slate-700/50 border-slate-600 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">새 비밀번호</Label>
                      <Input
                        type="password"
                        value={passwordChange.newPassword}
                        onChange={(e) => setPasswordChange(prev => ({ ...prev, newPassword: e.target.value }))}
                        className="bg-slate-700/50 border-slate-600 text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">새 비밀번호 확인</Label>
                      <Input
                        type="password"
                        value={passwordChange.confirmPassword}
                        onChange={(e) => setPasswordChange(prev => ({ ...prev, confirmPassword: e.target.value }))}
                        className="bg-slate-700/50 border-slate-600 text-white"
                      />
                    </div>
                    <Alert className="border-yellow-600 bg-yellow-900/20">
                      <AlertDescription className="text-yellow-300">
                        비밀번호는 6자리 이상이어야 합니다.
                      </AlertDescription>
                    </Alert>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowPasswordDialog(false)}
                        className="flex-1"
                      >
                        취소
                      </Button>
                      <Button
                        onClick={handlePasswordChange}
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        disabled={!passwordChange.currentPassword || !passwordChange.newPassword || !passwordChange.confirmPassword}
                      >
                        변경
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 포인트 전환 확인 다이얼로그 */}
      <Dialog open={showPointConvertDialog} onOpenChange={setShowPointConvertDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-yellow-400" />
              포인트 → 보유금 전환
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-400 mb-2">
                  {formatCurrency(currentPoints)}P
                </div>
                <div className="text-sm text-slate-400 mb-4">
                  전환할 포인트
                </div>
                <div className="text-lg font-bold text-green-400">
                  ₩{formatCurrency(currentPoints)}
                </div>
                <div className="text-sm text-slate-400">
                  전환 후 추가될 보유금
                </div>
              </div>
            </div>
            
            <Alert className="border-blue-600 bg-blue-900/20">
              <AlertDescription className="text-blue-300">
                포인트를 보유금으로 전환하면 되돌릴 수 없습니다. 전환하시겠습니까?
              </AlertDescription>
            </Alert>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowPointConvertDialog(false)}
                className="flex-1"
              >
                취소
              </Button>
              <Button
                onClick={() => {
                  convertPointsToBalance(currentPoints);
                  setShowPointConvertDialog(false);
                }}
                className="flex-1 bg-yellow-600 hover:bg-yellow-700"
              >
                <ArrowUpRight className="w-4 h-4 mr-2" />
                전환하기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}