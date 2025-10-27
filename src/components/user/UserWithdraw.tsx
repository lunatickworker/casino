import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { AlertTriangle, Minus, CreditCard, Clock, CheckCircle, XCircle, RefreshCw, AlertCircle, Bell } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { supabase } from '../../lib/supabase';
import { useMessageQueue } from '../common/MessageQueueProvider';

interface User {
  id: string;
  username: string;
  nickname: string;
  balance: string;
}

interface UserWithdrawProps {
  user: User;
  onRouteChange: (route: string) => void;
}

interface WithdrawHistory {
  id: string;
  amount: number;
  status: string;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  memo?: string;
  created_at: string;
  updated_at: string;
  balance_before: number;
  balance_after: number;
}

export function UserWithdraw({ user, onRouteChange }: UserWithdrawProps) {
  const { sendMessage } = useMessageQueue();
  const [amount, setAmount] = useState('');
  const [selectedBank, setSelectedBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [memo, setMemo] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [isWithdrawLocked, setIsWithdrawLocked] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [quickAmounts] = useState([1000, 3000, 5000, 10000, 30000, 50000, 100000, 300000, 500000, 1000000]);
  
  const availableBanks = [
    '국민은행', '신한은행', '우리은행', 'KB국민은행', 'KEB하나은행',
    '농협은행', '기업은행', '새마을금고', '신협', '우체국',
    '카카오뱅크', '토스뱅크', '케이뱅크'
  ];

  // 출금 제한 상태 확인
  const checkWithdrawStatus = async () => {
    try {
      // 진행 중인 출금 신청이 있는지 확인
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq('transaction_type', 'withdrawal')
        .in('status', ['pending', 'approved'])
        .limit(1);

      if (error) throw error;
      
      if (data && data.length > 0) {
        setIsWithdrawLocked(true);
        toast.warning('진행 중인 출금 신청이 있어 새로운 출금을 신청할 수 없습니다.');
      } else {
        setIsWithdrawLocked(false);
      }
    } catch (error) {
      console.error('출금 상태 확인 오류:', error);
    }
  };

  // 출금 내역 조회
  const fetchWithdrawHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq('transaction_type', 'withdrawal')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setWithdrawHistory(data || []);
    } catch (error) {
      console.error('출금 내역 조회 오류:', error);
      toast.error('출금 내역을 불러오는데 실패했습니다.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // 현재 잔고 조회
  const fetchCurrentBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('balance')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setCurrentBalance(parseFloat(data.balance) || 0);
    } catch (error) {
      console.error('잔고 조회 오류:', error);
    }
  };

  // 출금 신청
  const handleWithdrawSubmit = async () => {
    if (!amount || !selectedBank || !accountNumber || !accountHolder || !password) {
      toast.error('모든 필수 항목을 입력해주세요.');
      return;
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount < 10000) {
      toast.error('최소 출금액은 10,000원입니다.');
      return;
    }

    // 현재 잔고 재확인
    await fetchCurrentBalance();

    if (withdrawAmount > currentBalance) {
      toast.error(`출금 가능 금액이 부족합니다.\n현재 잔고: ${currentBalance.toLocaleString()}원`);
      return;
    }

    setIsSubmitting(true);

    try {
      // 비밀번호 확인
      const { data: authData, error: authError } = await supabase
        .rpc('user_login', {
          p_username: user.username,
          p_password: password
        });

      if (authError || !authData || authData.length === 0) {
        throw new Error('비밀번호가 올바르지 않습니다.');
      }

      // 출금 신청 데이터 생성
      const withdrawData = {
        user_id: user.id,
        partner_id: user.referrer_id || null, // 사용자의 소속 파트너 (없으면 NULL)
        transaction_type: 'withdrawal',
        amount: withdrawAmount,
        status: 'pending',
        balance_before: currentBalance,
        balance_after: currentBalance, // 승인 전에는 잔고 변동 없음
        bank_name: selectedBank,
        bank_account: accountNumber,
        bank_holder: accountHolder,
        memo: memo || null,
        // processed_by는 명시하지 않음 - 기본값 NULL 사용
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 디버깅용 로그
      console.log('💸 출금 신청 데이터:', {
        ...withdrawData,
        user_info: {
          id: user.id,
          username: user.username,
          referrer_id: user.referrer_id
        }
      });

      // 출금 신청 저장
      const { data: insertData, error: insertError } = await supabase
        .from('transactions')
        .insert([withdrawData])
        .select()
        .single();

      if (insertError) throw insertError;

      // 메시지 큐를 통한 실시간 알림 전송
      const success = await sendMessage('withdrawal_request', {
        transaction_id: insertData.id,
        user_id: user.id,
        username: user.username,
        nickname: user.nickname,
        amount: withdrawAmount,
        bank_name: selectedBank,
        bank_account: accountNumber,
        bank_holder: accountHolder,
        memo: memo || null,
        subject: `${user.nickname}님의 출금 신청`,
        reference_type: 'transaction',
        reference_id: insertData.id
      }, 3); // 높은 우선순위

      if (success) {
        console.log('✅ 출금 요청 알림이 관리자에게 전송되었습니다.');
      }

      // 활동 로그 기록
      await supabase
        .from('activity_logs')
        .insert([{
          actor_type: 'user',
          actor_id: user.id,
          action: 'withdrawal_request',
          target_type: 'transaction',
          target_id: insertData.id,
          details: {
            amount: withdrawAmount,
            bank_name: selectedBank,
            bank_holder: accountHolder
          }
        }]);

      toast.success('출금 신청이 완료되었습니다.\n관리자 승인 후 계좌로 송금됩니다.', {
        duration: 4000,
      });
      
      // 폼 초기화
      setAmount('');
      setSelectedBank('');
      setAccountNumber('');
      setAccountHolder('');
      setMemo('');
      setPassword('');
      setShowConfirmDialog(false);

      // 즉시 데이터 새로고침
      await Promise.all([
        fetchWithdrawHistory(),
        checkWithdrawStatus()
      ]);

    } catch (error: any) {
      console.error('❌ 출금 신청 오류:', error);
      toast.error(error.message || '출금 신청 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 상태별 아이콘 및 색상
  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'pending':
        return { 
          color: 'bg-yellow-500', 
          textColor: 'text-yellow-400', 
          icon: Clock, 
          label: '승인대기' 
        };
      case 'approved':
        return { 
          color: 'bg-blue-500', 
          textColor: 'text-blue-400', 
          icon: RefreshCw, 
          label: '처리중' 
        };
      case 'completed':
        return { 
          color: 'bg-green-500', 
          textColor: 'text-green-400', 
          icon: CheckCircle, 
          label: '완료' 
        };
      case 'rejected':
        return { 
          color: 'bg-red-500', 
          textColor: 'text-red-400', 
          icon: XCircle, 
          label: '거절' 
        };
      default:
        return { 
          color: 'bg-gray-500', 
          textColor: 'text-slate-400', 
          icon: AlertCircle, 
          label: '알 수 없음' 
        };
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(amount);
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  const currentAmount = parseFloat(amount) || 0;

  useEffect(() => {
    checkWithdrawStatus();
    fetchWithdrawHistory();
    fetchCurrentBalance();

    // 실시간 출금 상태 업데이트 구독
    const subscription = supabase
      .channel(`withdrawal_updates_${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        console.log('🔄 출금 상태 업데이트 수신:', payload);
        
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const newTransaction = payload.new as any;
          
          if (newTransaction.transaction_type === 'withdrawal') {
            // 즉시 데이터 새로고침
            fetchWithdrawHistory();
            checkWithdrawStatus();
            
            if (newTransaction.status === 'completed') {
              fetchCurrentBalance();
              toast.success(`출금이 완료되었습니다!\n금액: ₩${formatCurrency(newTransaction.amount)}`, {
                duration: 5000,
              });
            } else if (newTransaction.status === 'rejected') {
              toast.error(`출금 신청이 거절되었습니다.\n금액: ₩${formatCurrency(newTransaction.amount)}`, {
                duration: 5000,
              });
            } else if (newTransaction.status === 'approved') {
              toast.info(`출금이 승인되었습니다. 처리 중입니다.\n금액: ₩${formatCurrency(newTransaction.amount)}`, {
                duration: 4000,
              });
            }
          }
        }
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user.id]);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">출금 신청</h1>
          <p className="text-slate-400 mt-1">안전하고 빠른 출금 서비스를 제공합니다</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400">현재 잔고</p>
          <p className="text-xl font-bold text-green-400">₩{formatCurrency(currentBalance)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 출금 신청 폼 */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Minus className="w-5 h-5" />
              출금 신청
            </CardTitle>
            <CardDescription className="text-slate-400">
              출금할 금액과 계좌 정보를 입력하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isWithdrawLocked && (
              <Alert className="border-yellow-600 bg-yellow-900/20">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                <AlertDescription className="text-yellow-300">
                  진행 중인 출금 신청이 있어 새로운 출금을 신청할 수 없습니다.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 출금 금액 */}
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="amount" className="text-slate-300">출금 금액 *</Label>
                <Input
                  id="amount"
                  type="text"
                  placeholder="출금할 금액을 입력하세요"
                  value={amount}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, '');
                    setAmount(value);
                  }}
                  className="bg-slate-700/50 border-slate-600 text-white"
                  disabled={isWithdrawLocked}
                />
                
                {/* 빠른 금액 선택 + 전액 출금 */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {quickAmounts.map((quickAmount) => (
                    <Button
                      key={quickAmount}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const currentAmount = parseInt(amount) || 0;
                        setAmount((currentAmount + quickAmount).toString());
                      }}
                      className="text-xs border-slate-600 text-slate-300 hover:bg-slate-700"
                      disabled={isWithdrawLocked}
                    >
                      +{formatCurrency(quickAmount)}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(currentBalance.toString())}
                    className="text-xs border-green-600 text-green-400 hover:bg-green-900/20"
                    disabled={isWithdrawLocked}
                  >
                    전액출금
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount('')}
                    className="text-xs border-red-600 text-red-400 hover:bg-red-900/20"
                    disabled={isWithdrawLocked}
                  >
                    삭제
                  </Button>
                </div>
              </div>

              {/* 은행 선택 */}
              <div className="space-y-2">
                <Label htmlFor="bank" className="text-slate-300">은행 선택 *</Label>
                <Select value={selectedBank} onValueChange={setSelectedBank} disabled={isWithdrawLocked}>
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="은행을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {availableBanks.map((bank) => (
                      <SelectItem key={bank} value={bank} className="text-white">
                        {bank}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 계좌번호 */}
              <div className="space-y-2">
                <Label htmlFor="accountNumber" className="text-slate-300">계좌번호 *</Label>
                <Input
                  id="accountNumber"
                  placeholder="'-' 없이 숫자만 입력"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9]/g, ''))}
                  className="bg-slate-700/50 border-slate-600 text-white"
                  disabled={isWithdrawLocked}
                />
              </div>

              {/* 예금주명 */}
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="accountHolder" className="text-slate-300">예금주명 *</Label>
                <Input
                  id="accountHolder"
                  placeholder="계좌의 예금주명을 입력하세요"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  className="bg-slate-700/50 border-slate-600 text-white"
                  disabled={isWithdrawLocked}
                />
              </div>

              {/* 메모 */}
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="memo" className="text-slate-300">메모 (선택)</Label>
                <Textarea
                  id="memo"
                  placeholder="추가 요청사항이 있으시면 입력하세요"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="bg-slate-700/50 border-slate-600 text-white"
                  rows={3}
                  disabled={isWithdrawLocked}
                />
              </div>
            </div>

            {/* 주의사항 */}
            <Alert className="border-red-600 bg-red-900/20">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <AlertDescription className="text-red-300">
                <div className="space-y-1">
                  <p>• 최소 출금액: 10,000원</p>
                  <p>• 출금 신청 시 게임 이용이 제한됩니다</p>
                  <p>• 예금주명은 회원 본인과 일치해야 합니다</p>
                  <p>• 출금 처리 시간: 평일 기준 1-3시간</p>
                </div>
              </AlertDescription>
            </Alert>

            {/* 출금 신청 버튼 */}
            <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
              <DialogTrigger asChild>
                <Button
                  disabled={isWithdrawLocked || !amount || !selectedBank || !accountNumber || !accountHolder}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3"
                >
                  <Minus className="w-4 h-4 mr-2" />
                  출금 신청하기
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-800 border-slate-700 text-white">
                <DialogHeader>
                  <DialogTitle>출금 신청 확인</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    출금 신청 정보를 확인하고 최종 승인해주세요.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="p-4 bg-slate-700/50 rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span>출금 금액:</span>
                      <span>₩{formatCurrency(currentAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-slate-400">
                      <span>출금 후 잔액:</span>
                      <span>₩{formatCurrency(currentBalance - currentAmount)}</span>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-slate-700/50 rounded-lg">
                    <p className="text-sm text-slate-300">출금 계좌 정보</p>
                    <p>{selectedBank} {accountNumber}</p>
                    <p>예금주: {accountHolder}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-slate-300">
                      비밀번호 확인 *
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="비밀번호를 입력하세요"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-slate-700/50 border-slate-600 text-white"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowConfirmDialog(false)}
                      className="flex-1"
                    >
                      취소
                    </Button>
                    <Button
                      onClick={handleWithdrawSubmit}
                      disabled={isSubmitting || !password}
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          처리중...
                        </>
                      ) : (
                        '출금 신청'
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {/* 출금 내역 */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              최근 출금 내역
            </CardTitle>
            <CardDescription className="text-slate-400">
              최근 10개의 출금 신청 내역을 확인할 수 있습니다
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
              </div>
            ) : withdrawHistory.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                출금 내역이 없습니다
              </div>
            ) : (
              <div className="space-y-3">
                {withdrawHistory.map((transaction) => {
                  const statusInfo = getStatusInfo(transaction.status);
                  const StatusIcon = statusInfo.icon;
                  
                  return (
                    <div
                      key={transaction.id}
                      className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={`w-4 h-4 ${statusInfo.textColor}`} />
                          <Badge
                            variant="outline"
                            className={`${statusInfo.color} text-white border-none`}
                          >
                            {statusInfo.label}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">₩{formatCurrency(transaction.amount)}</p>
                          <p className="text-xs text-slate-400">{formatDateTime(transaction.created_at)}</p>
                        </div>
                      </div>
                      
                      <div className="text-sm text-slate-400 space-y-1">
                        <p>{transaction.bank_name} {transaction.bank_account}</p>
                        <p>예금주: {transaction.bank_holder}</p>
                        {transaction.memo && (
                          <p className="text-slate-500">{transaction.memo}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}