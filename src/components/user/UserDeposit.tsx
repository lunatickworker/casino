import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { 
  CreditCard, 
  Wallet,
  Clock,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  RefreshCw,
  AlertCircle,
  Info,
  Plus,
  Bell
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { supabase } from "../../lib/supabase";
import { investApi } from "../../lib/investApi";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";
import { useMessageQueue } from "../common/MessageQueueProvider";

interface UserDepositProps {
  user: any;
  onRouteChange: (route: string) => void;
}

interface DepositHistory {
  id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  bank_name: string;
  bank_account: string;
  memo?: string;
  created_at: string;
  processed_at?: string;
}

export function UserDeposit({ user, onRouteChange }: UserDepositProps) {
  const { sendMessage } = useMessageQueue();
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [depositHistory, setDepositHistory] = useState<DepositHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [quickAmounts] = useState([1000, 3000, 5000, 10000, 30000, 50000, 100000, 300000, 500000, 1000000]);
  const [currentBalance, setCurrentBalance] = useState(0);

  // 입금 내역 조회
  const fetchDepositHistory = async () => {
    try {
      setIsLoadingHistory(true);
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq('transaction_type', 'deposit')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setDepositHistory(data || []);
    } catch (error) {
      console.error('입금 내역 조회 오류:', error);
      toast.error('입금 내역을 불러오는데 실패했습니다.');
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

  // 입금 신청
  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!amount) {
      toast.error('모든 필수 항목을 입력해주세요.');
      return;
    }

    const depositAmount = parseFloat(amount);
    if (depositAmount < 10000) {
      toast.error('최소 입금 금액은 10,000원입니다.');
      return;
    }

    if (depositAmount > 10000000) {
      toast.error('최대 입금 금액은 10,000,000원입니다.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 현재 잔고 재조회
      await fetchCurrentBalance();

      // 입금 신청 데이터 생성
      const depositData = {
        user_id: user.id,
        partner_id: user.referrer_id || null, // 사용자의 소속 파트너 (없으면 NULL)
        transaction_type: 'deposit',
        amount: depositAmount,
        status: 'pending',
        balance_before: currentBalance,
        balance_after: currentBalance, // 승인 전에는 잔고 변동 없음
        bank_name: '국민은행',
        bank_account: '123456-78-901234', // 실제 계좌번호는 사용자가 선택한 은행 계좌로 설정
        bank_holder: 'GMS카지노',
        memo: memo.trim() || null,
        // processed_by는 명시하지 않음 - 기본값 NULL 사용
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 디버깅용 로그
      console.log('💰 입금 신청 데이터:', {
        ...depositData,
        user_info: {
          id: user.id,
          username: user.username,
          referrer_id: user.referrer_id
        }
      });

      // 데이터베이스에 입금 신청 기록
      const { data: insertedData, error } = await supabase
        .from('transactions')
        .insert([depositData])
        .select()
        .single();

      if (error) throw error;

      // 메시지 큐를 통한 실시간 알림 전송
      const success = await sendMessage('deposit_request', {
        transaction_id: insertedData.id,
        user_id: user.id,
        username: user.username,
        nickname: user.nickname,
        amount: depositAmount,
        bank_name: '국민은행',
        bank_account: '123456-78-901234', // 실제 계좌번호는 사용자가 선택한 은행 계좌로 설정
        depositor_name: 'GMS카지노',
        memo: memo.trim() || null,
        subject: `${user.nickname}님의 입금 신청`,
        reference_type: 'transaction',
        reference_id: insertedData.id
      }, 3); // 높은 우선순위

      if (success) {
        console.log('✅ 입금 요청 알림이 관리자에게 전송되었습니다.');
      }

      // 활동 로그 기록
      await supabase
        .from('activity_logs')
        .insert([{
          actor_type: 'user',
          actor_id: user.id,
          action: 'deposit_request',
          target_type: 'transaction',
          target_id: insertedData.id,
          details: {
            amount: depositAmount,
            bank_name: '국민은행',
            depositor_name: 'GMS카지노'
          }
        }]);

      // 폼 초기화
      setAmount('');
      setMemo('');

      // 즉시 내역 새로고침
      await fetchDepositHistory();

      toast.success('입금 신청이 완료되었습니다.\n관리자 승인 후 잔고에 반영됩니다.', {
        duration: 4000,
      });

    } catch (error: any) {
      console.error('❌ 입금 신청 오류:', error);
      toast.error(error.message || '입금 신청 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 빠른 금액 선택 (누적)
  const handleQuickAmount = (value: number) => {
    const currentAmount = parseInt(amount) || 0;
    setAmount((currentAmount + value).toString());
  };

  // 상태별 색상 및 아이콘
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
          color: 'bg-slate-500', 
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

  useEffect(() => {
    fetchDepositHistory();
    fetchCurrentBalance();

    // 실시간 입금 상태 업데이트 구독
    const subscription = supabase
      .channel(`deposit_updates_${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        console.log('🔄 입금 상태 업데이트 수신:', payload);
        
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const newTransaction = payload.new as any;
          
          if (newTransaction.transaction_type === 'deposit') {
            // 즉시 데이터 새로고침
            fetchDepositHistory();
            
            if (newTransaction.status === 'completed') {
              fetchCurrentBalance();
              toast.success(`입금이 완료되었습니다!\n금액: ₩${formatCurrency(newTransaction.amount)}`, {
                duration: 5000,
              });
            } else if (newTransaction.status === 'rejected') {
              toast.error(`입금 신청이 거절되었습니다.\n금액: ₩${formatCurrency(newTransaction.amount)}`, {
                duration: 5000,
              });
            } else if (newTransaction.status === 'approved') {
              toast.info(`입금이 승인되었습니다. 처리 중입니다.\n금액: ₩${formatCurrency(newTransaction.amount)}`, {
                duration: 4000,
              });
            }
          }
        }
      })
      .subscribe();

    return () => subscription.unsubscribe();
  }, [user.id]);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">입금 신청</h1>
          <p className="text-slate-400">안전하고 빠른 입금 서비스를 이용하세요</p>
        </div>
        <div className="flex items-center gap-4 bg-slate-800/50 rounded-lg px-4 py-2">
          <Wallet className="w-5 h-5 text-green-400" />
          <div>
            <div className="text-sm text-slate-300">현재 보유금</div>
            <div className="text-lg font-bold text-green-400">
              ₩{formatCurrency(currentBalance)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 입금 신청 폼 */}
        <div className="lg:col-span-2">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center text-white">
                <CreditCard className="w-5 h-5 mr-2 text-green-400" />
                입금 신청
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDepositSubmit} className="space-y-6">
                {/* 입금 금액 */}
                <div className="space-y-2">
                  <Label htmlFor="amount" className="text-slate-300">입금 금액 *</Label>
                  <Input
                    id="amount"
                    type="text"
                    placeholder="금액을 입력하세요"
                    value={amount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, '');
                      setAmount(value);
                    }}
                    className="bg-slate-700/50 border-slate-600 text-white text-lg"
                  />
                </div>

                {/* 빠른 금액 선택 */}
                <div className="space-y-2">
                  <Label className="text-slate-300">빠른 선택</Label>
                  <div className="flex flex-wrap gap-2">
                    {quickAmounts.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickAmount(value)}
                        className="whitespace-nowrap"
                      >
                        +{formatCurrency(value)}원
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAmount('')}
                      className="whitespace-nowrap border-red-600 text-red-400 hover:bg-red-900/20"
                    >
                      삭제
                    </Button>
                  </div>
                </div>

                {/* 메모 */}
                <div className="space-y-2">
                  <Label htmlFor="memo" className="text-slate-300">메모 (선택)</Label>
                  <Textarea
                    id="memo"
                    placeholder="추가 요청사항이 있으시면 입력하세요"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="bg-slate-700/50 border-slate-600 text-white"
                    rows={3}
                  />
                </div>

                {/* 주의사항 */}
                <Alert className="border-yellow-600 bg-yellow-900/20">
                  <Info className="h-4 w-4 text-yellow-400" />
                  <AlertDescription className="text-yellow-300">
                    <div className="space-y-1">
                      <p>• 최소 입금액: 10,000원 | 최대 입금액: 10,000,000원</p>
                      <p>• 입금자명과 계좌 소유자명이 일치해야 합니다</p>
                      <p>• 승인까지 평균 5-10분 소요됩니다</p>
                      <p>• 문의사항은 고객센터를 이용해주세요</p>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* 제출 버튼 */}
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-3"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      신청 처리 중...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      입금 신청하기
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* 입금 내역 */}
        <div>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center text-white">
                <ArrowUpRight className="w-5 h-5 mr-2 text-blue-400" />
                최근 입금 내역
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : depositHistory.length > 0 ? (
                <div className="space-y-4">
                  {depositHistory.map((deposit) => {
                    const statusInfo = getStatusInfo(deposit.status);
                    const StatusIcon = statusInfo.icon;
                    
                    return (
                      <div key={deposit.id} className="p-4 bg-slate-700/30 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <StatusIcon className={`w-4 h-4 ${statusInfo.textColor}`} />
                            <Badge className={`${statusInfo.color} text-white`}>
                              {statusInfo.label}
                            </Badge>
                          </div>
                          <span className="text-lg font-bold text-white">
                            ₩{formatCurrency(deposit.amount)}
                          </span>
                        </div>
                        <div className="space-y-1 text-sm text-slate-400">
                          <p>{deposit.bank_name} {deposit.bank_account}</p>
                          <p>{formatDateTime(deposit.created_at)}</p>
                          {deposit.memo && (
                            <p className="text-slate-300">메모: {deposit.memo}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <Button
                    variant="outline"
                    onClick={() => onRouteChange('/user/profile')}
                    className="w-full"
                  >
                    전체 내역 보기
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <CreditCard className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">입금 내역이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}