import { useState, useEffect, useCallback } from "react";
import { 
  CreditCard, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, 
  AlertTriangle, Banknote, Users, Plus, Search, Trash2, RefreshCw
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle, AdminDialogFooter as DialogFooter } from "./AdminDialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";
import { Partner, Transaction, User } from "../../types";
import { supabase } from "../../lib/supabase";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { cn } from "../../lib/utils";
import { MetricCard } from "./MetricCard";
import { depositBalance, withdrawBalance, extractBalanceFromResponse } from "../../lib/investApi";
import { getAdminOpcode, isMultipleOpcode } from "../../lib/opcodeHelper";

interface TransactionManagementProps {
  user: Partner;
}

export function TransactionManagement({ user }: TransactionManagementProps) {
  const { lastMessage, sendMessage } = useWebSocketContext();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // URL 해시에서 탭 정보 읽기
  const getInitialTab = () => {
    const hash = window.location.hash.substring(1);
    if (hash === 'deposit-request' || hash === 'withdrawal-request' || hash === 'deposit-history' || hash === 'withdrawal-history') {
      return hash;
    }
    return "deposit-request";
  };
  
  const [activeTab, setActiveTab] = useState(getInitialTab());
  
  // 데이터 상태
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  
  // 필터 상태
  const [periodFilter, setPeriodFilter] = useState("today");
  const [searchTerm, setSearchTerm] = useState("");
  
  // 데이터 리로드 트리거 (Realtime 이벤트용)
  const [reloadTrigger, setReloadTrigger] = useState(0);
  
  // 통계 데이터
  const [stats, setStats] = useState({
    totalDeposit: 0,
    totalWithdrawal: 0,
    pendingDepositCount: 0,
    pendingWithdrawalCount: 0
  });

  // 승인/거절 Dialog 상태
  const [actionDialog, setActionDialog] = useState({
    open: false,
    transaction: null as Transaction | null,
    action: 'approve' as 'approve' | 'reject',
    memo: ''
  });

  // 강제 입출금 Dialog 상태
  const [forceDialog, setForceDialog] = useState({
    open: false,
    type: 'deposit' as 'deposit' | 'withdrawal',
    userId: '',
    amount: '',
    memo: ''
  });

  // 회원 검색 Popover 상태
  const [userSearchOpen, setUserSearchOpen] = useState(false);

  // 금액 단축 버튼 값들
  const amountShortcuts = [
    { label: '1천', value: 1000 },
    { label: '3천', value: 3000 },
    { label: '5천', value: 5000 },
    { label: '1만', value: 10000 },
    { label: '3만', value: 30000 },
    { label: '5만', value: 50000 },
    { label: '100만', value: 1000000 },
    { label: '300만', value: 3000000 },
    { label: '500만', value: 5000000 },
    { label: '1000만', value: 10000000 }
  ];

  // URL 해시 변경 감지하여 탭 업데이트
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.substring(1);
      if (hash === 'deposit-request' || hash === 'withdrawal-request' || hash === 'deposit-history' || hash === 'withdrawal-history') {
        setActiveTab(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 데이터 로드 (깜박임 없이)
  const loadData = async (isInitial = false) => {
    try {
      if (isInitial) {
        setInitialLoading(true);
      } else {
        setRefreshing(true);
      }
      
      console.log('🔄 데이터 로드 시작:', { isInitial, periodFilter, userLevel: user.level });
      
      const dateRange = getDateRange(periodFilter);
      
      // 거래 데이터 로드
      let query = supabase
        .from('transactions')
        .select(`
          *,
          user:users(id, nickname, username, balance, bank_name, bank_account, bank_holder),
          processed_partner:partners!transactions_processed_by_fkey(nickname, level)
        `)
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end);

      // 시스템관리자가 아니면 하위 회원만 조회
      if (user.level > 1) {
        const { data: userList } = await supabase
          .from('users')
          .select('id')
          .eq('referrer_id', user.id);
        
        const userIds = userList?.map(u => u.id) || [];
        
        if (userIds.length > 0) {
          query = query.in('user_id', userIds);
        } else {
          setTransactions([]);
          setStats({
            totalDeposit: 0,
            totalWithdrawal: 0,
            pendingDepositCount: 0,
            pendingWithdrawalCount: 0
          });
          if (isInitial) setInitialLoading(false);
          return;
        }
      }

      const { data: transactionsData, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      console.log('✅ 거래 데이터 로드 완료:', transactionsData?.length || 0, '건');
      setTransactions(transactionsData || []);

      // 사용자 목록 로드 (강제 입출금용)
      let userQuery = supabase
        .from('users')
        .select('id, nickname, username, balance, bank_name, bank_account, bank_holder')
        .eq('status', 'active');

      if (user.level > 1) {
        userQuery = userQuery.eq('referrer_id', user.id);
      }

      const { data: usersData } = await userQuery.order('nickname');
      setUsers(usersData || []);

      // 통계 계산 - 모든 입출금 타입 포함 (deposit, admin_deposit, withdrawal, admin_withdrawal)
      if (transactionsData) {
        // 입금: deposit + admin_deposit (completed만)
        const depositSum = transactionsData
          .filter(t => 
            (t.transaction_type === 'deposit' || t.transaction_type === 'admin_deposit') && 
            t.status === 'completed'
          )
          .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
        
        // 출금: withdrawal + admin_withdrawal (completed만)
        const withdrawalSum = transactionsData
          .filter(t => 
            (t.transaction_type === 'withdrawal' || t.transaction_type === 'admin_withdrawal') && 
            t.status === 'completed'
          )
          .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
        
        // 대기 중인 입금 신청 (사용자 요청만)
        const pendingDeposits = transactionsData.filter(t => 
          t.transaction_type === 'deposit' && t.status === 'pending'
        );
        
        // 대기 중인 출금 신청 (사용자 요청만)
        const pendingWithdrawals = transactionsData.filter(t => 
          t.transaction_type === 'withdrawal' && t.status === 'pending'
        );

        console.log('📊 통계 계산:', {
          depositSum,
          withdrawalSum,
          depositCount: transactionsData.filter(t => 
            (t.transaction_type === 'deposit' || t.transaction_type === 'admin_deposit') && 
            t.status === 'completed'
          ).length,
          withdrawalCount: transactionsData.filter(t => 
            (t.transaction_type === 'withdrawal' || t.transaction_type === 'admin_withdrawal') && 
            t.status === 'completed'
          ).length
        });

        setStats({
          totalDeposit: depositSum,
          totalWithdrawal: withdrawalSum,
          pendingDepositCount: pendingDeposits.length,
          pendingWithdrawalCount: pendingWithdrawals.length
        });
      }
    } catch (error) {
      console.error('❌ 데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      if (isInitial) {
        setInitialLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  // 날짜 범위 계산
  const getDateRange = (filter: string) => {
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

  // ✅ 페이지 진입 시 자동으로 데이터 로드
  useEffect(() => {
    loadData(true);
  }, []);

  // 필터 변경 시 데이터 재로드
  useEffect(() => {
    if (!initialLoading) {
      loadData(false);
    }
  }, [periodFilter, reloadTrigger]);

  // Realtime 구독: transactions 테이블 변경 감지
  useEffect(() => {
    const channel = supabase
      .channel('transactions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        (payload) => {
          console.log('💰 transactions 테이블 변경 감지:', payload);
          setReloadTrigger(prev => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // WebSocket 메시지 수신 처리
  useEffect(() => {
    if (lastMessage) {
      // 입출금 관련 메시지 수신 시 데이터 재로드
      if (['deposit_approved', 'withdrawal_approved', 'deposit_rejected', 'withdrawal_rejected'].includes(lastMessage.type)) {
        console.log('💬 WebSocket 입출금 알림:', lastMessage);
        setReloadTrigger(prev => prev + 1);
      }
    }
  }, [lastMessage]);

  // 승인/거절 Dialog 열기
  const openActionDialog = (transaction: Transaction, action: 'approve' | 'reject') => {
    setActionDialog({
      open: true,
      transaction,
      action,
      memo: ''
    });
  };

  // 승인/거절 처리
  const handleTransactionAction = async () => {
    if (!actionDialog.transaction) return;

    try {
      setRefreshing(true);
      const { action, transaction, memo } = actionDialog;

      // 승인인 경우 Invest API를 통한 실제 입출금 처리
      if (action === 'approve') {
        // OPCODE 정보 조회
        const opcodeInfo = await getAdminOpcode(user);
        
        // 시스템관리자면 첫 번째 OPCODE 사용
        const config = isMultipleOpcode(opcodeInfo) 
          ? opcodeInfo.opcodes[0] 
          : opcodeInfo;

        // 사용자 username 조회
        if (!transaction.user?.username) {
          throw new Error('사용자 정보를 찾을 수 없습니다.');
        }

        // amount를 정수로 변환 (Guidelines: 입금액/출금액은 숫자만)
        const amount = Math.floor(parseFloat(transaction.amount.toString()));
        
        console.log('💰 거래 승인 처리 시작:', {
          transaction_type: transaction.transaction_type,
          username: transaction.user.username,
          amount,
          opcode: config.opcode
        });

        let apiResult;

        // Invest API 호출 (입금 또는 출금)
        if (transaction.transaction_type === 'deposit') {
          console.log('📥 입금 API 호출 중...');
          apiResult = await depositBalance(
            transaction.user.username,
            amount,
            config.opcode,
            config.token,
            config.secretKey
          );
        } else if (transaction.transaction_type === 'withdrawal') {
          console.log('📤 출금 API 호출 중...');
          apiResult = await withdrawBalance(
            transaction.user.username,
            amount,
            config.opcode,
            config.token,
            config.secretKey
          );
        }

        // API 호출 실패 시
        if (apiResult && !apiResult.success) {
          console.error('❌ Invest API 호출 실패:', apiResult);
          throw new Error(apiResult.error || 'Invest API 호출 실패');
        }

        console.log('✅ Invest API 처리 완료:', apiResult);
      }

      // DB 상태 업데이트
      const { error } = await supabase
        .from('transactions')
        .update({
          status: action === 'approve' ? 'completed' : 'rejected',
          processed_by: user.id,
          processed_at: new Date().toISOString(),
          memo: action === 'reject' ? memo : transaction.memo
        })
        .eq('id', transaction.id);

      if (error) throw error;

      toast.success(`거래가 ${action === 'approve' ? '승인' : '거절'}되었습니다.`);
      
      // WebSocket으로 실시간 알림
      sendMessage({
        type: 'transaction_processed',
        data: { 
          transactionId: transaction.id, 
          action, 
          processedBy: user.nickname,
          userId: transaction.user_id
        }
      });
      
      setActionDialog({ open: false, transaction: null, action: 'approve', memo: '' });
      // loadData 호출 제거 - Realtime subscription이 자동으로 처리
    } catch (error) {
      console.error('거래 처리 실패:', error);
      toast.error(error instanceof Error ? error.message : '거래 처리에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  // 강제 입출금 처리 (UserManagement와 동일한 로직)
  const handleForceTransaction = async () => {
    try {
      setRefreshing(true);
      const { type, userId, amount, memo } = forceDialog;

      if (!userId || !amount) {
        toast.error('회원과 금액을 입력해주세요.');
        return;
      }

      const selectedUser = users.find(u => u.id === userId);
      if (!selectedUser) {
        toast.error('회원을 찾을 수 없습니다.');
        return;
      }

      if (!selectedUser.username) {
        toast.error('회원 username을 찾을 수 없습니다.');
        return;
      }

      // amount를 정수로 변환 (Guidelines: 입금액/출금액은 숫자만)
      const amountNum = Math.floor(parseFloat(amount));
      const balanceBefore = parseFloat(selectedUser.balance?.toString() || '0');

      console.log('💰 강제 입출금 처리 시작:', {
        type,
        username: selectedUser.username,
        amount: amountNum,
        balanceBefore
      });

      // 출금 시 보유금 검증
      if (type === 'withdrawal' && amountNum > balanceBefore) {
        toast.error(`출금 금액이 보유금(₩${balanceBefore.toLocaleString()})을 초과할 수 없습니다.`);
        setRefreshing(false);
        return;
      }
      
      // OPCODE 정보 조회
      const opcodeInfo = await getAdminOpcode(user);
      
      // 시스템관리자면 첫 번째 OPCODE 사용
      const config = isMultipleOpcode(opcodeInfo) 
        ? opcodeInfo.opcodes[0] 
        : opcodeInfo;

      console.log('🔑 OPCODE 설정:', {
        opcode: config.opcode,
        token: '***' + config.token.slice(-4),
        secretKey: '***' + config.secretKey.slice(-4)
      });

      // Invest API를 통한 실제 입출금 처리
      let apiResult;
      if (type === 'deposit') {
        console.log('📥 입금 API 호출 중...');
        apiResult = await depositBalance(
          selectedUser.username,
          amountNum,
          config.opcode,
          config.token,
          config.secretKey
        );
      } else {
        console.log('📤 출금 API 호출 중...');
        apiResult = await withdrawBalance(
          selectedUser.username,
          amountNum,
          config.opcode,
          config.token,
          config.secretKey
        );
      }

      // API 호출 실패 시
      if (!apiResult.success || apiResult.error) {
        throw new Error(apiResult.error || 'Invest API 호출 실패');
      }

      console.log('✅ Invest API 강제 입출금 완료:', apiResult);

      // API 응답에서 balance_after 파싱 (리소스 재사용: extractBalanceFromResponse 사용)
      const balanceAfter = extractBalanceFromResponse(apiResult.data, selectedUser.username);
      console.log('💰 실제 잔고:', balanceAfter);

      // 거래 기록 생성 (관리자 강제 입출금 타입 사용)
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          partner_id: user.id,
          transaction_type: type === 'deposit' ? 'admin_deposit' : 'admin_withdrawal',
          amount: amountNum,
          status: 'completed',
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          memo: `[관리자 강제 ${type === 'deposit' ? '입금' : '출금'}] ${memo}`,
          processed_by: user.id,
          processed_at: new Date().toISOString(),
          external_response: apiResult.data
        });

      if (transactionError) throw transactionError;

      // ✅ 트리거가 자동으로 users.balance 업데이트 (251번 SQL)
      // ✅ Realtime 이벤트 자동 발생 → UserHeader 즉시 업데이트
      console.log('✅ transactions INSERT 완료 → 트리거가 users.balance 자동 업데이트');

      toast.success(`강제 ${type === 'deposit' ? '입금' : '출금'}이 완료되었습니다. (잔액: ₩${balanceAfter.toLocaleString()})`);
      
      // WebSocket으로 실시간 알림
      sendMessage({
        type: 'admin_force_transaction',
        data: { 
          userId, 
          type, 
          amount: amountNum,
          balanceAfter,
          processedBy: user.nickname
        }
      });

      setForceDialog({ open: false, type: 'deposit', userId: '', amount: '', memo: '' });
      // loadData 호출 제거 - Realtime subscription이 자동으로 처리
    } catch (error) {
      console.error('강제 입출금 실패:', error);
      toast.error(error instanceof Error ? error.message : '강제 입출금에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  // 초기 로드
  useEffect(() => {
    loadData(true);
  }, []);

  // reloadTrigger 변경 시 데이터 로드 (Realtime 이벤트 처리)
  useEffect(() => {
    if (reloadTrigger > 0 && !initialLoading) {
      console.log('🔄 Realtime 트리거 데이터 로드:', reloadTrigger);
      loadData(false);
    }
  }, [reloadTrigger]);

  // 필터 변경 시 자동 새로고침 (깜박임 없이)
  useEffect(() => {
    if (!initialLoading) {
      console.log('📅 기간 필터 변경:', periodFilter);
      loadData(false);
    }
  }, [periodFilter]);

  // Realtime subscription for transactions table (즉시 업데이트)
  useEffect(() => {
    console.log('🔌 Realtime subscription 설정 중...');
    
    const transactionsChannel = supabase
      .channel('transactions-realtime-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        (payload) => {
          console.log('💳 transactions 테이블 변경 감지:', payload.eventType, payload.new);
          // reloadTrigger 증가로 데이터 리로드 트리거
          setReloadTrigger(prev => prev + 1);
        }
      )
      .subscribe((status) => {
        console.log('💳 transactions 채널 구독 상태:', status);
      });

    // users 테이블 변경 감지 (보유금 업데이트 감지)
    const usersChannel = supabase
      .channel('users-realtime-balance-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('👤 users 테이블 변경 감지:', payload.new);
          // reloadTrigger 증가로 데이터 리로드 트리거
          setReloadTrigger(prev => prev + 1);
        }
      )
      .subscribe((status) => {
        console.log('👤 users 채널 구독 상태:', status);
      });

    return () => {
      console.log('🔌 Realtime subscription 정리 중...');
      supabase.removeChannel(transactionsChannel);
      supabase.removeChannel(usersChannel);
    };
  }, []);

  // WebSocket 메시지 처리
  useEffect(() => {
    if (lastMessage?.type === 'transaction_update' || 
        lastMessage?.type === 'deposit_request' || 
        lastMessage?.type === 'withdrawal_request' ||
        lastMessage?.type === 'admin_force_transaction' ||
        lastMessage?.type === 'transaction_processed') {
      console.log('📨 WebSocket 메시지 수신:', lastMessage.type);
      setReloadTrigger(prev => prev + 1);
    }
  }, [lastMessage]);

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  // 탭별 데이터 필터링
  const filterBySearch = (t: Transaction) => 
    searchTerm === '' || t.user?.nickname?.toLowerCase().includes(searchTerm.toLowerCase());

  const depositRequests = transactions.filter(t => 
    t.transaction_type === 'deposit' && 
    t.status === 'pending' &&
    filterBySearch(t)
  );

  const withdrawalRequests = transactions.filter(t => 
    t.transaction_type === 'withdrawal' && 
    t.status === 'pending' &&
    filterBySearch(t)
  );

  // 입출금내역: 사용자가 요청한 입출금만 (deposit, withdrawal)
  const completedTransactions = transactions.filter(t => 
    (t.transaction_type === 'deposit' || t.transaction_type === 'withdrawal') &&
    t.status === 'completed' &&
    filterBySearch(t)
  );

  // 관리자 입출금내역: 관리자가 강제 처리한 입출금만 (admin_deposit, admin_withdrawal, admin_adjustment)
  const adminTransactions = transactions.filter(t => 
    (t.transaction_type === 'admin_deposit' || 
     t.transaction_type === 'admin_withdrawal' || 
     t.transaction_type === 'admin_adjustment') &&
    t.status === 'completed' &&
    filterBySearch(t)
  );

  // 거래 테이블 컬럼
  const getColumns = (showActions = false) => [
    {
      header: "거래 일시",
      cell: (row: Transaction) => (
        <span className="text-sm text-slate-300">
          {new Date(row.created_at).toLocaleString('ko-KR')}
        </span>
      )
    },
    {
      header: "회원",
      cell: (row: Transaction) => (
        <div>
          <p className="font-medium text-slate-200">{row.user?.nickname}</p>
          <p className="text-sm text-slate-500">{row.user?.username}</p>
        </div>
      )
    },
    {
      header: "거래 유형",
      cell: (row: Transaction) => {
        const typeMap: any = {
          deposit: { text: '입금', color: 'bg-green-500' },
          withdrawal: { text: '출금', color: 'bg-red-500' },
          admin_deposit: { text: '입금', color: 'bg-green-600' },
          admin_withdrawal: { text: '출금', color: 'bg-red-600' },
          admin_adjustment: { 
            text: row.memo?.includes('강제 출금') ? '출금' : '입금', 
            color: row.memo?.includes('강제 출금') ? 'bg-red-600' : 'bg-green-600'
          }
        };
        const type = typeMap[row.transaction_type] || { text: row.transaction_type, color: 'bg-gray-500' };
        return <Badge className={`${type.color} text-white`}>{type.text}</Badge>;
      }
    },
    {
      header: "금액",
      cell: (row: Transaction) => {
        // withdrawal 계열은 마이너스, deposit 계열은 플러스
        const isWithdrawal = row.transaction_type === 'withdrawal' || 
                             row.transaction_type === 'admin_withdrawal' ||
                             (row.transaction_type === 'admin_adjustment' && row.memo?.includes('강제 출금'));
        return (
          <span className={cn(
            "font-mono font-semibold",
            isWithdrawal ? 'text-red-400' : 'text-green-400'
          )}>
            {isWithdrawal ? '-' : '+'}
            ₩{parseFloat(row.amount.toString()).toLocaleString()}
          </span>
        );
      }
    },
    {
      header: "변경 후 보유금",
      cell: (row: Transaction) => (
        <span className="font-mono text-cyan-400">
          ₩{parseFloat(row.balance_after?.toString() || '0').toLocaleString()}
        </span>
      )
    },
    {
      header: "상태",
      cell: (row: Transaction) => {
        const statusMap: any = {
          pending: { text: '대기', color: 'bg-yellow-500' },
          completed: { text: '완료', color: 'bg-green-500' },
          rejected: { text: '거절', color: 'bg-red-500' }
        };
        const status = statusMap[row.status] || { text: row.status, color: 'bg-gray-500' };
        return <Badge className={`${status.color} text-white`}>{status.text}</Badge>;
      }
    },
    {
      header: "메모",
      cell: (row: Transaction) => (
        <div className="max-w-xs">
          <span className="text-sm text-slate-400 block truncate" title={row.memo || ''}>
            {row.memo || '-'}
          </span>
        </div>
      )
    },
    {
      header: "처리자",
      cell: (row: Transaction) => (
        <span className="text-sm text-slate-400">
          {row.processed_partner?.nickname || '-'}
        </span>
      )
    },
    ...(showActions ? [{
      header: "작업",
      cell: (row: Transaction) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => openActionDialog(row, 'approve')}
            disabled={refreshing}
            className="h-8 px-3 bg-green-600 hover:bg-green-700"
          >
            승인
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openActionDialog(row, 'reject')}
            disabled={refreshing}
            className="h-8 px-3 border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
          >
            거절
          </Button>
        </div>
      )
    }] : [])
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">입출금 관리</h1>
          <p className="text-sm text-slate-400">회원 입출금 신청 및 처리 관리</p>
        </div>
        <Button onClick={() => setForceDialog({ ...forceDialog, open: true })} className="btn-premium-primary">
          <Plus className="h-4 w-4 mr-2" />
          강제 입출금
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <MetricCard
          title="총 입금"
          value={`₩${stats.totalDeposit.toLocaleString()}`}
          subtitle="누적 입금"
          icon={TrendingUp}
          color="green"
        />
        
        <MetricCard
          title="총 출금"
          value={`₩${stats.totalWithdrawal.toLocaleString()}`}
          subtitle="누적 출금"
          icon={TrendingDown}
          color="red"
        />
        
        <MetricCard
          title="입금 신청"
          value={`${stats.pendingDepositCount}건`}
          subtitle="처리 대기"
          icon={Clock}
          color="amber"
        />
        
        <MetricCard
          title="출금 신청"
          value={`${stats.pendingWithdrawalCount}건`}
          subtitle="처리 대기"
          icon={AlertTriangle}
          color="orange"
        />
      </div>

      {/* 탭 컨텐츠 */}
      <div className="glass-card rounded-xl p-6">
        {/* 탭 리스트 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 p-1 rounded-lg">
            <TabsTrigger value="deposit-request" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white">
              입금 신청
            </TabsTrigger>
            <TabsTrigger value="withdrawal-request" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white">
              출금 신청
            </TabsTrigger>
            <TabsTrigger value="completed-history" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white">
              입출금 내역
            </TabsTrigger>
            <TabsTrigger value="admin-history" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white">
              관리자 입출금 내역
            </TabsTrigger>
          </TabsList>

          {/* 헤더 및 필터 */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-slate-400" />
              <h3 className="font-semibold text-slate-100">
                {activeTab === 'deposit-request' && '입금 신청'}
                {activeTab === 'withdrawal-request' && '출금 신청'}
                {activeTab === 'completed-history' && '입출금 내역'}
                {activeTab === 'admin-history' && '관리자 입출금 내역'}
              </h3>
            </div>
          </div>

          {/* 필터 영역 */}
          <div className="flex items-center gap-3">
            {/* 기간 정렬 */}
            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="w-[140px] input-premium">
                <SelectValue placeholder="기간" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="today">오늘</SelectItem>
                <SelectItem value="week">최근 7일</SelectItem>
                <SelectItem value="month">최근 30일</SelectItem>
              </SelectContent>
            </Select>

            {/* 검색 */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="회원 검색..."
                className="pl-10 input-premium"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* 새로고침 */}
            <Button
              onClick={() => {
                console.log('🔄 수동 새로고침');
                loadData(false);
              }}
              disabled={refreshing}
              variant="outline"
              className="btn-premium-primary"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
              새로고침
            </Button>
          </div>

          {/* 입금 신청 탭 */}
          <TabsContent value="deposit-request">
            <DataTable
              searchable={false}
              columns={getColumns(true)}
              data={depositRequests}
              loading={initialLoading}
              emptyMessage="입금 신청이 없습니다."
            />
          </TabsContent>

          {/* 출금 신청 탭 */}
          <TabsContent value="withdrawal-request">
            <DataTable
              searchable={false}
              columns={getColumns(true)}
              data={withdrawalRequests}
              loading={initialLoading}
              emptyMessage="출금 신청이 없습니다."
            />
          </TabsContent>

          {/* 입출금 내역 탭 (승인된 모든 거래) */}
          <TabsContent value="completed-history">
            <DataTable
              searchable={false}
              columns={getColumns(false)}
              data={completedTransactions}
              loading={initialLoading}
              emptyMessage="입출금 내역이 없습니다."
            />
          </TabsContent>

          {/* 관리자 입출금 내역 탭 */}
          <TabsContent value="admin-history">
            <DataTable
              searchable={false}
              columns={getColumns(false)}
              data={adminTransactions}
              loading={initialLoading}
              emptyMessage="관리자 입출금 내역이 없습니다."
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* 승인/거절 확인 Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => setActionDialog({ ...actionDialog, open })}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">
              {actionDialog.action === 'approve' ? '거래 승인' : '거래 거절'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {actionDialog.action === 'approve' 
                ? '이 거래를 승인하시겠습니까?' 
                : '거절 사유를 입력해주세요.'}
            </DialogDescription>
          </DialogHeader>
          
          {actionDialog.transaction && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-800/50 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">회원:</span>
                  <span className="text-white">{actionDialog.transaction.user?.nickname}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">거래 유형:</span>
                  <span className="text-white">
                    {actionDialog.transaction.transaction_type === 'deposit' ? '입금' : '출금'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">금액:</span>
                  <span className="text-green-400 font-mono">
                    ₩{parseFloat(actionDialog.transaction.amount.toString()).toLocaleString()}
                  </span>
                </div>
              </div>

              {actionDialog.action === 'reject' && (
                <div className="space-y-2">
                  <Label className="text-slate-300">거절 사유</Label>
                  <Textarea
                    value={actionDialog.memo}
                    onChange={(e) => setActionDialog({ ...actionDialog, memo: e.target.value })}
                    placeholder="거절 사유를 입력해주세요..."
                    className="bg-slate-800 border-slate-700 text-white"
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setActionDialog({ ...actionDialog, open: false })}
              disabled={refreshing}
            >
              취소
            </Button>
            <Button 
              onClick={handleTransactionAction}
              disabled={refreshing || (actionDialog.action === 'reject' && !actionDialog.memo)}
              className={actionDialog.action === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {actionDialog.action === 'approve' ? '승인' : '거절'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 강제 입출금 Dialog */}
      <Dialog open={forceDialog.open} onOpenChange={(open) => setForceDialog({ ...forceDialog, open })}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">관리자 강제 입출금</DialogTitle>
            <DialogDescription className="text-slate-400">
              회원의 잔액을 직접 조정합니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">거래 유형</Label>
              <Select value={forceDialog.type} onValueChange={(value: 'deposit' | 'withdrawal') => setForceDialog({ ...forceDialog, type: value })}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">입금</SelectItem>
                  <SelectItem value="withdrawal">출금</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">회원 선택</Label>
              <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={userSearchOpen}
                    className="w-full justify-between bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  >
                    {forceDialog.userId
                      ? users.find(u => u.id === forceDialog.userId)?.nickname + 
                        ` (${users.find(u => u.id === forceDialog.userId)?.username})`
                      : "회원을 선택하세요"}
                    <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[500px] p-0 bg-slate-800 border-slate-700">
                  <Command className="bg-slate-800">
                    <CommandInput 
                      placeholder="회원 검색..." 
                      className="text-white"
                    />
                    <CommandList>
                      <CommandEmpty className="text-slate-400 py-6 text-center">회원을 찾을 수 없습니다.</CommandEmpty>
                      <CommandGroup>
                        {users.map(u => (
                          <CommandItem
                            key={u.id}
                            value={`${u.nickname} ${u.username} ${u.id}`}
                            onSelect={() => {
                              setForceDialog({ ...forceDialog, userId: u.id });
                              setUserSearchOpen(false);
                            }}
                            className="text-white hover:bg-slate-700 cursor-pointer"
                          >
                            <div className="flex flex-col w-full">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{u.nickname}</span>
                                <span className="text-sm text-slate-400">({u.username})</span>
                              </div>
                              <div className="text-sm text-cyan-400 mt-1">
                                잔액: ₩{parseFloat(u.balance?.toString() || '0').toLocaleString()}
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* 선택된 회원 정보 표시 */}
            {forceDialog.userId && (() => {
              const selectedUser = users.find(u => u.id === forceDialog.userId);
              return selectedUser ? (
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-400">선택된 회원</span>
                    <Badge className="bg-cyan-600 text-white">{selectedUser.nickname}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">현재 보유금</span>
                    <span className="text-lg font-mono text-cyan-400">
                      ₩{parseFloat(selectedUser.balance?.toString() || '0').toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : null;
            })()}

            <div className="space-y-2">
              <Label className="text-slate-300">금액</Label>
              <Input
                type="number"
                value={forceDialog.amount}
                onChange={(e) => {
                  const inputAmount = parseFloat(e.target.value || '0');
                  
                  // 출금 타입이고 회원이 선택된 경우 보유금 검증
                  if (forceDialog.type === 'withdrawal' && forceDialog.userId) {
                    const selectedUser = users.find(u => u.id === forceDialog.userId);
                    if (selectedUser) {
                      const userBalance = parseFloat(selectedUser.balance?.toString() || '0');
                      if (inputAmount > userBalance) {
                        toast.error(`출금 금액이 보유금(₩${userBalance.toLocaleString()})을 초과할 수 없습니다.`);
                        setForceDialog({ ...forceDialog, amount: userBalance.toString() });
                        return;
                      }
                    }
                  }
                  
                  setForceDialog({ ...forceDialog, amount: e.target.value });
                }}
                placeholder="금액을 입력하세요"
                className="bg-slate-800 border-slate-700 text-white"
              />
              
              {/* 금액 단축 버튼 */}
              <div className="grid grid-cols-5 gap-2 pt-2">
                {amountShortcuts.map((shortcut) => (
                  <Button
                    key={shortcut.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const currentAmount = parseFloat(forceDialog.amount || '0');
                      const newAmount = currentAmount + shortcut.value;
                      
                      // 출금 타입이고 회원이 선택된 경우 보유금 검증
                      if (forceDialog.type === 'withdrawal' && forceDialog.userId) {
                        const selectedUser = users.find(u => u.id === forceDialog.userId);
                        if (selectedUser) {
                          const userBalance = parseFloat(selectedUser.balance?.toString() || '0');
                          if (newAmount > userBalance) {
                            toast.error(`출금 금액이 보유금(₩${userBalance.toLocaleString()})을 초과할 수 없습니다.`);
                            setForceDialog({ ...forceDialog, amount: userBalance.toString() });
                            return;
                          }
                        }
                      }
                      
                      setForceDialog({ 
                        ...forceDialog, 
                        amount: newAmount.toString() 
                      });
                    }}
                    className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600 text-xs"
                  >
                    {shortcut.label}
                  </Button>
                ))}
              </div>

              {/* 전체삭제 / 전체출금 버튼 */}
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForceDialog({ ...forceDialog, amount: '0' })}
                  className="flex-1 bg-red-900/20 border-red-500 text-red-400 hover:bg-red-900/40"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  전체삭제
                </Button>
                {forceDialog.type === 'withdrawal' && forceDialog.userId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const selectedUser = users.find(u => u.id === forceDialog.userId);
                      if (selectedUser) {
                        const balance = parseFloat(selectedUser.balance?.toString() || '0');
                        setForceDialog({ ...forceDialog, amount: balance.toString() });
                      }
                    }}
                    className="flex-1 bg-orange-900/20 border-orange-500 text-orange-400 hover:bg-orange-900/40"
                  >
                    <TrendingDown className="h-4 w-4 mr-2" />
                    전체출금
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">메모</Label>
              <Textarea
                value={forceDialog.memo}
                onChange={(e) => setForceDialog({ ...forceDialog, memo: e.target.value })}
                placeholder="메모를 입력하세요 (선택사항)"
                className="bg-slate-800 border-slate-700 text-white"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setForceDialog({ open: false, type: 'deposit', userId: '', amount: '', memo: '' });
                setUserSearchOpen(false);
              }}
              disabled={refreshing}
            >
              취소
            </Button>
            <Button 
              onClick={handleForceTransaction}
              disabled={refreshing || !forceDialog.userId || !forceDialog.amount}
              className="bg-purple-600 hover:bg-purple-700"
            >
              실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TransactionManagement;
