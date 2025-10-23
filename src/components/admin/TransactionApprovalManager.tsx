import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { CheckCircle, XCircle, Clock, DollarSign, RefreshCw, Eye, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useWebSocketContext } from '../../contexts/WebSocketContext';
import { useMessageQueue } from '../common/MessageQueueProvider';
import { investApi } from '../../lib/investApi';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { toast } from 'sonner@2.0.3';

interface Transaction {
  id: string;
  user_id: string;
  username: string;
  nickname: string;
  transaction_type: 'deposit' | 'withdrawal';
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
  request_time: string;
  processed_at?: string;
  processed_by?: string;
  processing_note?: string;
  external_transaction_id?: string;
  current_balance: number;
  bank_info?: {
    bank_name: string;
    bank_account: string;
    bank_holder: string;
  };
  users?: {
    username: string;
    nickname: string;
    balance: number;
    bank_name: string;
    bank_account: string;
    bank_holder: string;
    referrer_id: string;
    partners?: {
      opcode: string;
      secret_key: string;
      token: string;
    };
  };
}

interface TransactionApprovalManagerProps {
  user: any;
}

export function TransactionApprovalManager({ user }: TransactionApprovalManagerProps) {
  const { connected, sendMessage: sendWebSocketMessage } = useWebSocketContext();
  const { sendMessage } = useMessageQueue();
  
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showProcessDialog, setShowProcessDialog] = useState(false);
  const [processingNote, setProcessingNote] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 거래 요청 목록 조회
  const fetchTransactionRequests = useCallback(async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('transactions')
        .select(`
          *,
          users:user_id (
            username,
            nickname,
            balance,
            bank_name,
            bank_account,
            bank_holder,
            referrer_id,
            partners:referrer_id (
              opcode,
              secret_key,
              token
            )
          )
        `)
        .order('request_time', { ascending: false });

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query.limit(100);

      if (error) throw error;

      const formattedTransactions = data?.map(tx => ({
        ...tx,
        user_id: tx.user_id, // 🔑 명시적으로 user_id 보존
        username: tx.users?.username || '알 수 없음',
        nickname: tx.users?.nickname || '알 수 없음',
        current_balance: tx.users?.balance || 0,
        bank_info: {
          bank_name: tx.users?.bank_name || '',
          bank_account: tx.users?.bank_account || '',
          bank_holder: tx.users?.bank_holder || ''
        }
      })) || [];

      setTransactions(formattedTransactions);
      
      console.log(`💰 [거래승인] ${filterStatus} 상태 거래 ${formattedTransactions.length}건 조회`);
      
      // 🔍 디버깅: 첫 번째 거래의 user_id 확인
      if (formattedTransactions.length > 0) {
        console.log('📊 [거래 샘플]:', {
          transaction_id: formattedTransactions[0].id,
          user_id: formattedTransactions[0].user_id,
          username: formattedTransactions[0].username,
          has_user_id: !!formattedTransactions[0].user_id
        });
      }
      
    } catch (error) {
      console.error('거래 요청 조회 실패:', error);
      toast.error('거래 요청을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  // 거래 처리 (승인/거절)
  const processTransaction = async (action: 'approve' | 'reject') => {
    if (!selectedTransaction) return;

    try {
      setProcessing(selectedTransaction.id);
      
      console.log(`🔄 [거래처리] ${selectedTransaction.transaction_type} ${action} 시작:`, {
        transactionId: selectedTransaction.id,
        username: selectedTransaction.username,
        amount: selectedTransaction.amount,
        currentBalance: selectedTransaction.current_balance
      });

      let apiResult = null;
      let newBalance = selectedTransaction.current_balance;

      // 승인인 경우 외부 API 호출
      if (action === 'approve') {
        let opcode = selectedTransaction.users?.partners?.opcode || '';
        let token = selectedTransaction.users?.partners?.token || '';
        let secretKey = selectedTransaction.users?.partners?.secret_key || '';

        // 🔍 파트너 정보 확인
        console.log('🔐 [파트너 정보]:', {
          has_partners: !!selectedTransaction.users?.partners,
          has_opcode: !!opcode,
          has_token: !!token,
          has_secretKey: !!secretKey,
          opcode_preview: opcode ? `${opcode.substring(0, 3)}...` : 'NONE'
        });

        if (!opcode || !token || !secretKey) {
          console.error('❌ [파트너 정보 누락]:', {
            opcode: !!opcode,
            token: !!token,
            secretKey: !!secretKey,
            referrer_id: selectedTransaction.users?.referrer_id
          });
          toast.error('파트너 API 설정이 없습니다. 소속 파트너 설정을 확인하세요.');
          return;
        }

        try {
          if (selectedTransaction.transaction_type === 'deposit') {
            console.log('💰 [API 입금] 외부 API 입금 처리 시작');
            apiResult = await investApi.depositBalance(
              selectedTransaction.username,
              selectedTransaction.amount,
              opcode,
              token,
              secretKey
            );
          } else {
            console.log('💸 [API 출금] 외부 API 출금 처리 시작');
            apiResult = await investApi.withdrawBalance(
              selectedTransaction.username,
              selectedTransaction.amount,
              opcode,
              token,
              secretKey
            );
          }

          console.log('📡 [API 응답]:', apiResult);

          // API 응답에서 실제 잔고 추출 (UserManagement.tsx와 동일한 방식)
          if (apiResult.data && !apiResult.error) {
            newBalance = investApi.extractBalanceFromResponse(apiResult.data, selectedTransaction.username);
            console.log(`✅ [API 성공] 새로운 잔고: ${newBalance}`);
            
            // 🔍 잔고 추출 검증
            if (newBalance === 0 || isNaN(newBalance)) {
              console.warn('⚠️ [잔고 추출 경고] 잔고가 0이거나 유효하지 않습니다:', {
                newBalance,
                apiData: apiResult.data
              });
            }
          } else {
            throw new Error(apiResult.error || 'API 호출 실패');
          }

        } catch (apiError) {
          console.error('❌ [API 실패]:', apiError);
          toast.error(`외부 API ${selectedTransaction.transaction_type === 'deposit' ? '입금' : '출금'} 처리 실패: ${apiError instanceof Error ? apiError.message : '알 수 없는 오류'}`);
          return;
        }
      }

      // DB 업데이트 - transactions 테이블 상태 변경
      const newStatus = action === 'approve' ? 'completed' : 'rejected';
      
      // 승인인 경우 balance_after도 업데이트
      const transactionUpdateData: any = {
        status: newStatus,
        processed_at: new Date().toISOString(),
        processed_by: user?.username || 'system',
        processing_note: processingNote || null,
        external_transaction_id: apiResult?.data?.transaction_id || apiResult?.data?.id || null,
        updated_at: new Date().toISOString()
      };
      
      // 승인인 경우에만 balance_after 업데이트
      if (action === 'approve') {
        transactionUpdateData.balance_after = newBalance;
      }
      
      const { error: txUpdateError } = await supabase
        .from('transactions')
        .update(transactionUpdateData)
        .eq('id', selectedTransaction.id)
        .eq('status', 'pending');

      if (txUpdateError) {
        console.error('❌ [거래 업데이트 실패]:', txUpdateError);
        throw txUpdateError;
      }

      console.log(`✅ [거래 업데이트 완료] ${selectedTransaction.id} -> ${newStatus}`);

      // 승인인 경우 users 테이블 balance 업데이트
      if (action === 'approve') {
        // 🔍 디버깅: 업데이트 전 확인
        console.log('💰 [잔고 업데이트 준비]:', {
          user_id: selectedTransaction.user_id,
          username: selectedTransaction.username,
          old_balance: selectedTransaction.current_balance,
          new_balance: newBalance,
          has_user_id: !!selectedTransaction.user_id
        });

        if (!selectedTransaction.user_id) {
          console.error('❌ [치명적 오류] user_id가 없습니다!', selectedTransaction);
          throw new Error('user_id가 없어 잔고를 업데이트할 수 없습니다.');
        }

        const { error: balanceUpdateError } = await supabase
          .from('users')
          .update({
            balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedTransaction.user_id);

        if (balanceUpdateError) {
          console.error('❌ [잔고 업데이트 실패]:', balanceUpdateError);
          throw balanceUpdateError;
        }

        console.log(`✅ [잔고 업데이트 완료] ${selectedTransaction.username}: ${selectedTransaction.current_balance} -> ${newBalance}`);
      }

      // 실시간 알림 전송
      await sendMessage('transaction_processed', {
        transaction_id: selectedTransaction.id,
        username: selectedTransaction.username,
        transaction_type: selectedTransaction.transaction_type,
        amount: selectedTransaction.amount,
        action: action,
        newBalance: newBalance,
        processedBy: user?.username || 'system',
        note: processingNote || null,
        target_user_id: selectedTransaction.user_id
      }, 1); // 높은 우선순위

      // WebSocket 실시간 전송
      if (connected && sendWebSocketMessage) {
        sendWebSocketMessage('transaction_processed', {
          transaction_id: selectedTransaction.id,
          username: selectedTransaction.username,
          user_id: selectedTransaction.user_id,
          transaction_type: selectedTransaction.transaction_type,
          amount: selectedTransaction.amount,
          action: action,
          newBalance: newBalance,
          processedBy: user?.username || 'system',
          note: processingNote || null,
          timestamp: new Date().toISOString()
        });
      }

      const actionText = action === 'approve' ? '승인' : '거절';
      const typeText = selectedTransaction.transaction_type === 'deposit' ? '입금' : '출금';
      toast.success(`${selectedTransaction.username}님의 ${typeText} 요청이 ${actionText}되었습니다.`);

      // 상태 초기화 및 새로고침
      setShowProcessDialog(false);
      setSelectedTransaction(null);
      setProcessingNote('');
      await fetchTransactionRequests();

    } catch (error) {
      console.error(`거래 ${action} 처리 실패:`, error);
      
      // ⭐ 관리자 보유금 부족 에러 처리
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('관리자 보유금') || errorMessage.includes('보유금이 부족')) {
        toast.error('❌ 관리자 보유금이 부족하여 처리할 수 없습니다.', {
          description: '상위 관리자에게 보유금을 요청하세요.',
          duration: 6000
        });
      } else if (errorMessage.includes('보유금 검증')) {
        toast.error('❌ 보유금 검증 실패', {
          description: errorMessage,
          duration: 6000
        });
      } else {
        toast.error(`거래 처리 중 오류가 발생했습니다: ${errorMessage}`);
      }
    } finally {
      setProcessing(null);
    }
  };

  // 자동 새로고침
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      console.log('🔄 [자동새로고침] 거래 요청 목록 갱신');
      fetchTransactionRequests();
    }, 30000); // 30초마다

    return () => clearInterval(interval);
  }, [autoRefresh, fetchTransactionRequests]);

  // 초기 데이터 로드
  useEffect(() => {
    fetchTransactionRequests();
  }, [fetchTransactionRequests]);

  // 상태별 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500';
      case 'processing': return 'bg-blue-500';
      case 'approved': return 'bg-green-500';
      case 'completed': return 'bg-green-600';
      case 'rejected': return 'bg-red-500';
      case 'failed': return 'bg-red-600';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '대기';
      case 'processing': return '처리중';
      case 'approved': return '승인';
      case 'completed': return '완료';
      case 'rejected': return '거절';
      case 'failed': return '실패';
      default: return status;
    }
  };

  const pendingCount = transactions.filter(tx => tx.status === 'pending').length;
  const processingCount = transactions.filter(tx => tx.status === 'processing').length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">입출금 승인 관리</h1>
          <p className="text-sm text-slate-400">
            실시간 입출금 요청을 승인하거나 거절할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-50 border-green-200' : ''}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            자동새로고침 {autoRefresh ? 'ON' : 'OFF'}
          </Button>
          <Button onClick={fetchTransactionRequests} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
        </div>
      </div>

      {/* 상태 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-yellow-700">대기 중</p>
                <p className="text-2xl font-bold text-yellow-800">{pendingCount}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-700">처리 중</p>
                <p className="text-2xl font-bold text-blue-800">{processingCount}</p>
              </div>
              <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-700">총 거래</p>
                <p className="text-2xl font-bold text-green-800">{transactions.length}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700">연결 상태</p>
                <p className="text-sm font-semibold text-gray-800">
                  {connected ? '🟢 연결됨' : '🔴 연결끊김'}
                </p>
              </div>
              <div className={`h-4 w-4 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 필터 및 거래 목록 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>거래 요청 목록</CardTitle>
            <Tabs value={filterStatus} onValueChange={setFilterStatus}>
              <TabsList>
                <TabsTrigger value="pending">대기중</TabsTrigger>
                <TabsTrigger value="processing">처리중</TabsTrigger>
                <TabsTrigger value="approved">승인됨</TabsTrigger>
                <TabsTrigger value="rejected">거절됨</TabsTrigger>
                <TabsTrigger value="all">전체</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner />
              <span className="ml-2">거래 요청을 불러오는 중...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {transactions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>거래 요청이 없습니다.</p>
                </div>
              ) : (
                transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`h-3 w-3 rounded-full ${getStatusColor(transaction.status)}`}></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{transaction.nickname}</span>
                            <Badge variant="outline" className="text-xs">
                              {transaction.username}
                            </Badge>
                            <Badge variant={transaction.transaction_type === 'deposit' ? 'default' : 'destructive'}>
                              {transaction.transaction_type === 'deposit' ? '💰 입금' : '💸 출금'}
                            </Badge>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {new Date(transaction.request_time).toLocaleString('ko-KR')} · 
                            현재잔고: {transaction.current_balance.toLocaleString()}원
                          </div>
                          {transaction.bank_info?.bank_name && (
                            <div className="text-xs text-gray-500 mt-1">
                              {transaction.bank_info.bank_name} {transaction.bank_info.bank_account} ({transaction.bank_info.bank_holder})
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className={`text-lg font-bold ${
                            transaction.transaction_type === 'deposit' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {transaction.transaction_type === 'deposit' ? '+' : '-'}
                            {transaction.amount.toLocaleString()}원
                          </div>
                          <div className="text-sm text-gray-500">
                            {getStatusText(transaction.status)}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedTransaction(transaction);
                              setShowProcessDialog(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          
                          {transaction.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedTransaction(transaction);
                                  processTransaction('approve');
                                }}
                                disabled={processing === transaction.id}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                승인
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setSelectedTransaction(transaction);
                                  processTransaction('reject');
                                }}
                                disabled={processing === transaction.id}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                거절
                              </Button>
                            </>
                          )}
                          
                          {processing === transaction.id && (
                            <div className="flex items-center gap-2">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              <span className="text-sm">처리중...</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 거래 처리 Dialog */}
      <Dialog open={showProcessDialog} onOpenChange={setShowProcessDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>거래 요청 처리</DialogTitle>
            <DialogDescription>
              선택한 거래 요청을 승인하거나 거절할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="space-y-4">
              {/* 거래 정보 */}
              <div className="p-4 bg-gray-50 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">요청자:</span>
                  <span>{selectedTransaction.nickname} ({selectedTransaction.username})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">거래 유형:</span>
                  <Badge variant={selectedTransaction.transaction_type === 'deposit' ? 'default' : 'destructive'}>
                    {selectedTransaction.transaction_type === 'deposit' ? '입금' : '출금'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">요청 금액:</span>
                  <span className={`font-bold ${
                    selectedTransaction.transaction_type === 'deposit' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {selectedTransaction.transaction_type === 'deposit' ? '+' : '-'}
                    {selectedTransaction.amount.toLocaleString()}원
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">현재 잔고:</span>
                  <span className="font-mono">{selectedTransaction.current_balance.toLocaleString()}원</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">요청 시간:</span>
                  <span>{new Date(selectedTransaction.request_time).toLocaleString('ko-KR')}</span>
                </div>
                {selectedTransaction.bank_info?.bank_name && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">은행 정보:</span>
                    <span className="text-sm">
                      {selectedTransaction.bank_info.bank_name} {selectedTransaction.bank_info.bank_account}
                      <br />
                      ({selectedTransaction.bank_info.bank_holder})
                    </span>
                  </div>
                )}
              </div>

              {/* 처리 메모 */}
              <div className="space-y-2">
                <Label htmlFor="processing-note">처리 메모 (선택사항)</Label>
                <Input
                  id="processing-note"
                  value={processingNote}
                  onChange={(e) => setProcessingNote(e.target.value)}
                  placeholder="처리 사유나 메모를 입력하세요"
                />
              </div>

              {/* 주의사항 */}
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium">처리 주의사항:</p>
                  <ul className="mt-1 space-y-1">
                    <li>• 승인 시 외부 Invest API가 호출되어 실제 잔고가 변경됩니다.</li>
                    <li>• 출금 승인 시 충분한 잔고가 있는지 확인해주세요.</li>
                    <li>• 처리 후에는 취소할 수 없습니다.</li>
                    <li>• 사용자에게 실시간 알림이 전송됩니다.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProcessDialog(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => processTransaction('reject')}
              disabled={processing === selectedTransaction?.id}
            >
              <XCircle className="h-4 w-4 mr-2" />
              거절
            </Button>
            <Button
              onClick={() => processTransaction('approve')}
              disabled={processing === selectedTransaction?.id}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              승인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TransactionApprovalManager;