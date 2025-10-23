import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { 
  LogOut, Bell,
  TrendingUp, TrendingDown, Users, Wallet
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useAuth } from "../../hooks/useAuth";
import { useBalance } from "../../contexts/BalanceContext";
import { Partner, DashboardStats } from "../../types";
import { formatCurrency, formatNumber } from "../../lib/utils";
import { toast } from "sonner@2.0.3";
import { supabase } from "../../lib/supabase";

interface AdminHeaderProps {
  user: Partner;
  wsConnected: boolean;
  onToggleSidebar: () => void;
  onRouteChange?: (route: string) => void;
  currentRoute?: string;
}

export function AdminHeader({ user, wsConnected, onToggleSidebar, onRouteChange, currentRoute }: AdminHeaderProps) {
  const { logout } = useAuth();
  const { balance, loading: balanceLoading, error: balanceError, lastSyncTime } = useBalance();

  // 사용자 정보가 없으면 기본 헤더 표시
  if (!user) {
    return (
      <div className="w-full px-6 py-3.5 h-[72px] flex items-center border-b border-slate-200 bg-white/95">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">로딩 중...</span>
          </div>
        </div>
      </div>
    );
  }

  const [stats, setStats] = useState<DashboardStats>({
    total_users: 0,
    total_balance: 0,
    daily_deposit: 0,
    daily_withdrawal: 0,
    daily_net_deposit: 0,
    casino_betting: 0,
    slot_betting: 0,
    total_betting: 0,
    online_users: 0,
    pending_approvals: 0,
    pending_messages: 0,
    pending_deposits: 0,
    pending_withdrawals: 0,
  });
  
  const [totalUsers, setTotalUsers] = useState(0);

  // ✅ 실제 데이터 로드 (사용자 + 관리자 입출금 포함) - 계층 구조 필터링
  useEffect(() => {
    const fetchHeaderStats = async () => {
      try {
        console.log('📊 헤더 통계 조회 시작 (계층 필터링):', { id: user.id, level: user.level });
        
        // 오늘 날짜 (KST 기준)
        const now = new Date();
        const kstOffset = 9 * 60 * 60 * 1000;
        const kstDate = new Date(now.getTime() + kstOffset);
        const todayStart = new Date(kstDate.getFullYear(), kstDate.getMonth(), kstDate.getDate());
        const todayStartISO = new Date(todayStart.getTime() - kstOffset).toISOString();
        
        // 🔍 계층 구조 필터링: 자기 자신 + 하위 파트너의 소속 사용자만
        let allowedUserIds: string[] = [];
        
        if (user.level === 1) {
          // 시스템관리자: 모든 사용자
          const { data: allUsers } = await supabase
            .from('users')
            .select('id');
          allowedUserIds = allUsers?.map(u => u.id) || [];
          console.log('🔑 [시스템관리자] 전체 사용자 조회:', allowedUserIds.length);
        } else {
          // 일반 파트너: 자기 하위 파트너 + 자신에게 속한 사용자만
          const { data: hierarchicalPartners, error: hierarchyError } = await supabase
            .rpc('get_hierarchical_partners', { p_partner_id: user.id });
          
          if (hierarchyError) {
            console.error('❌ 하위 파트너 조회 실패:', hierarchyError);
          }
          
          const partnerIds = [user.id, ...(hierarchicalPartners?.map((p: any) => p.id) || [])];
          console.log('🔑 [조회 대상 파트너] 총', partnerIds.length, '개:', {
            자신: user.id,
            하위파트너수: hierarchicalPartners?.length || 0
          });
          
          // 해당 파트너들을 referrer_id로 가진 사용자만
          const { data: partnerUsers, error: usersError } = await supabase
            .from('users')
            .select('id, username, referrer_id')
            .in('referrer_id', partnerIds);
          
          if (usersError) {
            console.error('❌ 소속 사용자 조회 실패:', usersError);
          }
          
          allowedUserIds = partnerUsers?.map(u => u.id) || [];
          console.log('🔑 [소속 사용자] 총', allowedUserIds.length, '명', 
            allowedUserIds.length === 0 ? '(정상: 아직 사용자가 없음)' : '');
          
          // 디버깅: referrer_id별 사용자 수
          if (partnerUsers && partnerUsers.length > 0) {
            const usersByReferrer = partnerUsers.reduce((acc: any, u: any) => {
              acc[u.referrer_id] = (acc[u.referrer_id] || 0) + 1;
              return acc;
            }, {});
            console.log('📊 [파트너별 사용자 분포]:', usersByReferrer);
          }
        }

        // 사용자가 없으면 빈 통계 반환 (정상 상황)
        if (allowedUserIds.length === 0) {
          console.log('ℹ️ 소속된 사용자가 없습니다. 0으로 통계를 초기화합니다.');
          setStats(prev => ({
            ...prev,
            daily_deposit: 0,
            daily_withdrawal: 0,
            daily_net_deposit: 0,
            online_users: 0,
            pending_approvals: 0,
            pending_messages: 0,
            pending_deposits: 0,
            pending_withdrawals: 0,
          }));
          setTotalUsers(0);
          return;
        }

        // 1️⃣ 입금 합계 (deposit + admin_deposit) - 소속 사용자만
        const { data: depositData, error: depositError } = await supabase
          .from('transactions')
          .select('amount')
          .in('transaction_type', ['deposit', 'admin_deposit'])
          .eq('status', 'completed')
          .gte('created_at', todayStartISO)
          .in('user_id', allowedUserIds);

        if (depositError) {
          console.error('❌ 입금 조회 실패:', depositError);
        }

        const dailyDeposit = depositData?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;

        // 2️⃣ 출금 합계 (withdrawal + admin_withdrawal) - 소속 사용자만
        const { data: withdrawalData, error: withdrawalError } = await supabase
          .from('transactions')
          .select('amount')
          .in('transaction_type', ['withdrawal', 'admin_withdrawal'])
          .eq('status', 'completed')
          .gte('created_at', todayStartISO)
          .in('user_id', allowedUserIds);

        if (withdrawalError) {
          console.error('❌ 출금 조회 실패:', withdrawalError);
        }

        const dailyWithdrawal = withdrawalData?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;

        // 3️⃣ 온라인 사용자 수 - 소속 사용자만
        const { count: onlineCount } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('is_online', true)
          .in('id', allowedUserIds);

        // 4️⃣ 전체 회원 수 - 소속 사용자만
        const totalUserCount = allowedUserIds.length;

        // 🔔 5️⃣ 가입승인 대기 수 - 소속 사용자만
        const { count: pendingApprovalsCount } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .in('id', allowedUserIds);

        // 🔔 6️⃣ 고객문의 대기 수 (messages 테이블에서 status='unread' 또는 'read' - 답변 전 상태)
        const { count: pendingMessagesCount } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .in('status', ['unread', 'read'])
          .eq('message_type', 'normal')
          .eq('receiver_type', 'partner')
          .is('parent_id', null);

        // 🔔 7️⃣ 입금요청 대기 수 - 소속 사용자만
        const { count: pendingDepositsCount } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('transaction_type', 'deposit')
          .eq('status', 'pending')
          .in('user_id', allowedUserIds);

        // 🔔 8️⃣ 출금요청 대기 수 - 소속 사용자만
        const { count: pendingWithdrawalsCount } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('transaction_type', 'withdrawal')
          .eq('status', 'pending')
          .in('user_id', allowedUserIds);

        // 💰 9️⃣ 총 잔고 (소속 사용자들의 balance 합계)
        const { data: usersBalanceData } = await supabase
          .from('users')
          .select('balance')
          .in('id', allowedUserIds);
        
        const totalBalance = usersBalanceData?.reduce((sum, u) => sum + Number(u.balance || 0), 0) || 0;

        console.log('💰 헤더 입출금 (계층 필터링):', { 
          총잔고: totalBalance,
          입금: dailyDeposit, 
          출금: dailyWithdrawal,
          순입출금: dailyDeposit - dailyWithdrawal,
          온라인: onlineCount || 0,
          전체회원: totalUserCount || 0,
          소속사용자수: allowedUserIds.length
        });

        console.log('🔔 헤더 실시간 알림 (직접 계산):', {
          가입승인: pendingApprovalsCount || 0,
          고객문의: pendingMessagesCount || 0,
          입금요청: pendingDepositsCount || 0,
          출금요청: pendingWithdrawalsCount || 0,
        });
        
        setStats(prev => ({
          ...prev,
          total_balance: totalBalance,
          daily_deposit: dailyDeposit,
          daily_withdrawal: dailyWithdrawal,
          daily_net_deposit: dailyDeposit - dailyWithdrawal,
          online_users: onlineCount || 0,
          pending_approvals: pendingApprovalsCount || 0,
          pending_messages: pendingMessagesCount || 0,
          pending_deposits: pendingDepositsCount || 0,
          pending_withdrawals: pendingWithdrawalsCount || 0,
        }));
        
        setTotalUsers(totalUserCount || 0);
        
        console.log('✅ 헤더 통계 업데이트 완료 (계층 필터링 적용)');
      } catch (error) {
        console.error('❌ 헤더 통계 로드 실패:', error);
      }
    };
    
    fetchHeaderStats();
    
    console.log('🔔 헤더 Realtime 구독 시작:', user.id);
    
    // ✅ Realtime 구독 1: transactions 변경 시 즉시 업데이트
    const transactionChannel = supabase
      .channel('header_transactions')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        (payload) => {
          console.log('💰 [헤더 알림] transactions 변경 감지:', payload.eventType);
          fetchHeaderStats(); // 즉시 갱신
          
          // 새 입금/출금 요청 시 토스트 알림
          if (payload.eventType === 'INSERT' && payload.new) {
            const transaction = payload.new as any;
            
            if (transaction.status === 'pending') {
              if (transaction.transaction_type === 'deposit') {
                toast.info('새로운 입금 요청이 있습니다.', {
                  description: `금액: ₩${Number(transaction.amount).toLocaleString()} | 회원: ${transaction.user_id}`,
                  duration: 10000,
                  action: {
                    label: '확인',
                    onClick: () => {
                      if (onRouteChange) {
                        onRouteChange('/admin/transactions#deposit-request');
                      }
                    }
                  }
                });
              } else if (transaction.transaction_type === 'withdrawal') {
                toast.warning('새로운 출금 요청이 있습니다.', {
                  description: `금액: ₩${Number(transaction.amount).toLocaleString()} | 회원: ${transaction.user_id}`,
                  duration: 10000,
                  action: {
                    label: '확인',
                    onClick: () => {
                      if (onRouteChange) {
                        onRouteChange('/admin/transactions#withdrawal-request');
                      }
                    }
                  }
                });
              }
            }
          }
        }
      )
      .subscribe();

    // ✅ Realtime 구독 2: users 변경 시 즉시 업데이트 (가입승인, 잔고 변경)
    const usersChannel = supabase
      .channel('header_users')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('🔔 [헤더 알림] users 변경 감지 (가입승인):', payload.eventType);
          fetchHeaderStats(); // 즉시 갱신
          
          // 새 가입 요청 시 토스트 알림
          if (payload.eventType === 'INSERT' && payload.new && (payload.new as any).status === 'pending') {
            toast.info('새로운 가입 신청이 있습니다.', {
              description: `회원 아이디: ${(payload.new as any).username}`,
              duration: 8000,
            });
          }
        }
      )
      .subscribe();

    // ✅ Realtime 구독 3: messages 변경 시 즉시 업데이트 (고객문의)
    const messagesChannel = supabase
      .channel('header_messages')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          console.log('🔔 [헤더 알림] messages 변경 감지 (고객문의):', payload.eventType);
          fetchHeaderStats(); // 즉시 갱신
          
          // 새 고객 문의 시 토스트 알림 (사용자가 파트너에게 보낸 메시지)
          if (payload.eventType === 'INSERT' && payload.new) {
            const newMsg = payload.new as any;
            if (newMsg.message_type === 'normal' && 
                newMsg.sender_type === 'user' && 
                newMsg.receiver_type === 'partner' &&
                !newMsg.parent_id) {
              toast.info('새로운 고객 문의가 있습니다.', {
                description: `제목: ${newMsg.subject || '문의'}`,
                duration: 8000,
                action: {
                  label: '확인',
                  onClick: () => {
                    if (onRouteChange) {
                      onRouteChange('/admin/customer-service');
                    }
                  }
                }
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      console.log('🔕 헤더 Realtime 구독 해제');
      supabase.removeChannel(transactionChannel);
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [user.id]);

  // 베팅 알림 상태
  const [bettingAlerts, setBettingAlerts] = useState({
    all_betting: 0,
    large_betting: 0,
    high_win: 0,
    suspicious: 0,
  });

  // 실시간 통계 업데이트
  useEffect(() => {
    // Supabase Realtime으로 베팅 내역 모니터링
    const bettingChannel = supabase
      .channel('betting_alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_records'
        },
        (payload) => {
          const record = payload.new as any;
          
          // 모든 베팅 알림
          setBettingAlerts(prev => ({
            ...prev,
            all_betting: prev.all_betting + 1
          }));

          // 대량 베팅 알림 (10만원 이상)
          if (record.bet_amount && parseFloat(record.bet_amount) >= 100000) {
            setBettingAlerts(prev => ({
              ...prev,
              large_betting: prev.large_betting + 1
            }));
            toast.warning(`대량 베팅 발생: ${formatCurrency(parseFloat(record.bet_amount))}`, {
              duration: 5000,
              action: {
                label: '확인',
                onClick: () => {
                  if (onRouteChange) {
                    onRouteChange('/admin/online-users');
                  }
                }
              }
            });
          }

          // 고액 당첨 알림 (50만원 이상)
          if (record.win_amount && parseFloat(record.win_amount) >= 500000) {
            setBettingAlerts(prev => ({
              ...prev,
              high_win: prev.high_win + 1
            }));
            toast.info(`고액 당첨 발생: ${formatCurrency(parseFloat(record.win_amount))}`, {
              duration: 5000,
              action: {
                label: '확인',
                onClick: () => {
                  if (onRouteChange) {
                    onRouteChange('/admin/online-users');
                  }
                }
              }
            });
          }

          // 의심 패턴 감지 (승률이 너무 높거나 연속 당첨)
          const winRate = record.win_amount && record.bet_amount 
            ? parseFloat(record.win_amount) / parseFloat(record.bet_amount) 
            : 0;
          
          if (winRate > 10) {
            setBettingAlerts(prev => ({
              ...prev,
              suspicious: prev.suspicious + 1
            }));
            toast.error(`의심 패턴 감지: 승률 ${(winRate * 100).toFixed(0)}%`, {
              duration: 5000,
              action: {
                label: '확인',
                onClick: () => {
                  if (onRouteChange) {
                    onRouteChange('/admin/online-users');
                  }
                }
              }
            });
          }
        }
      )
      .subscribe();



    return () => {
      supabase.removeChannel(bettingChannel);
    };
  }, [onRouteChange]);

  const handleLogout = () => {
    logout();
    toast.success("로그아웃되었습니다.");
  };

  const handleMessageClick = () => {
    if (onRouteChange) {
      onRouteChange('/admin/customer-service');
      toast.info('고객 지원 페이지로 이동합니다.');
    }
  };

  const handleDepositClick = () => {
    if (onRouteChange) {
      onRouteChange('/admin/transactions#deposit-request');
      toast.info('입금 관리 페이지로 이동합니다.');
    }
  };

  const handleWithdrawalClick = () => {
    if (onRouteChange) {
      onRouteChange('/admin/transactions#withdrawal-request');
      toast.info('출금 관리 페이지로 이동합니다.');
    }
  };

  const handleApprovalClick = () => {
    if (onRouteChange) {
      onRouteChange('/admin/users');
      toast.info('가입 승인 관리 페이지로 이동합니다.');
    }
  };

  const handleBettingAlertClick = () => {
    if (onRouteChange) {
      onRouteChange('/admin/online-users');
      // 알림 카운트 초기화
      setBettingAlerts({
        all_betting: 0,
        large_betting: 0,
        high_win: 0,
        suspicious: 0,
      });
      toast.info('온라인 사용자 현황 페이지로 이동합니다.');
    }
  };

  return (
    <div className="w-full border-b border-slate-800/50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between">
          {/* 왼쪽: 5개 통계 카드 */}
          <div className="flex items-center gap-3">
            {/* 보유금 (전역 상태 사용) */}
            <div className={`px-3 py-1.5 rounded-lg bg-gradient-to-br from-purple-500/20 to-violet-500/20 border border-purple-500/30 hover:scale-102 transition-all ${balanceLoading ? 'animate-pulse' : ''}`}>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-purple-400" />
                <div>
                  <div className="text-[9px] text-purple-300 font-medium">보유금</div>
                  <div className="text-sm font-bold text-white">
                    {balanceLoading ? '...' : formatCurrency(balance || 0)}
                  </div>
                </div>
              </div>
            </div>

            {/* 총 입금 */}
            <div className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 hover:scale-102 transition-all cursor-pointer">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <div>
                  <div className="text-[9px] text-cyan-300 font-medium">총 입금</div>
                  <div className="text-sm font-bold text-white">{formatCurrency(stats.daily_deposit)}</div>
                </div>
              </div>
            </div>

            {/* 총 출금 */}
            <div className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 hover:scale-102 transition-all cursor-pointer">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-orange-400" />
                <div>
                  <div className="text-[9px] text-orange-300 font-medium">총 출금</div>
                  <div className="text-sm font-bold text-white">{formatCurrency(stats.daily_withdrawal)}</div>
                </div>
              </div>
            </div>

            {/* 총 회원 */}
            <div className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-slate-500/20 to-gray-500/20 border border-slate-500/30 hover:scale-102 transition-all cursor-pointer">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <div>
                  <div className="text-[9px] text-slate-300 font-medium">총 회원</div>
                  <div className="text-sm font-bold text-white">{formatNumber(totalUsers)}</div>
                </div>
              </div>
            </div>

            {/* 온라인 */}
            <div className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 hover:scale-102 transition-all cursor-pointer">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-400" />
                <div>
                  <div className="text-[9px] text-emerald-300 font-medium">온라인</div>
                  <div className="text-sm font-bold text-white">{formatNumber(stats.online_users)}명</div>
                </div>
              </div>
            </div>
          </div>

          {/* 오른쪽: 4개 실시간 알림 + 종 아이콘 + 프로필 */}
          <div className="flex items-center gap-2">
            {/* 가입승인 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="px-2 py-1.5 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 hover:scale-105 transition-all cursor-pointer min-w-[60px]"
                    onClick={() => onRouteChange?.('/admin/users')}
                  >
                    <div className="text-[9px] text-cyan-300 font-medium text-center">가입승인</div>
                    <div className="text-base font-bold text-white text-center">{stats.pending_approvals}</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>가입승인 대기 중</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 고객문의 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="px-2 py-1.5 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 hover:scale-105 transition-all cursor-pointer min-w-[60px]"
                    onClick={() => onRouteChange?.('/admin/customer-service')}
                  >
                    <div className="text-[9px] text-purple-300 font-medium text-center">고객문의</div>
                    <div className="text-base font-bold text-white text-center">{stats.pending_messages}</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>고객문의 대기 중</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 입금요청 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="px-2 py-1.5 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 hover:scale-105 transition-all cursor-pointer min-w-[60px]"
                    onClick={() => onRouteChange?.('/admin/transactions#deposit-request')}
                  >
                    <div className="text-[9px] text-emerald-300 font-medium text-center">입금요청</div>
                    <div className="text-base font-bold text-white text-center">{stats.pending_deposits}</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>입금요청 대기 중</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 출금요청 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="px-2 py-1.5 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 hover:scale-105 transition-all cursor-pointer min-w-[60px]"
                    onClick={() => onRouteChange?.('/admin/transactions#withdrawal-request')}
                  >
                    <div className="text-[9px] text-orange-300 font-medium text-center">출금요청</div>
                    <div className="text-base font-bold text-white text-center">{stats.pending_withdrawals}</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>출금요청 대기 중</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="w-px h-8 bg-slate-700"></div>

            {/* 종 아이콘 (고배팅/고당첨 알림) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="relative h-9 w-9 p-0 hover:bg-slate-700"
                    onClick={handleBettingAlertClick}
                  >
                    <Bell className="h-5 w-5 text-slate-300" />
                    {(bettingAlerts.large_betting + bettingAlerts.high_win + bettingAlerts.suspicious) > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full text-[10px] bg-rose-500 hover:bg-rose-600 animate-pulse border-0">
                        {(bettingAlerts.large_betting + bettingAlerts.high_win + bettingAlerts.suspicious) > 99 
                          ? '99+' 
                          : (bettingAlerts.large_betting + bettingAlerts.high_win + bettingAlerts.suspicious)}
                      </Badge>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    <p>고배팅: {bettingAlerts.large_betting}건</p>
                    <p>고당첨: {bettingAlerts.high_win}건</p>
                    <p>의심패턴: {bettingAlerts.suspicious}건</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="w-px h-8 bg-slate-700"></div>

            {/* 사용자 메뉴 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-full hover:bg-slate-700">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white font-semibold text-sm">
                    {user.nickname.charAt(0).toUpperCase()}
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-slate-800 border-slate-700">
                <div className="px-2 py-2 border-b border-slate-700">
                  <p className="text-sm font-semibold text-slate-100">{user.nickname}</p>
                  <p className="text-xs text-slate-400">{user.username}</p>
                  <p className="text-xs text-slate-500 mt-0.5">관리자 계정</p>
                </div>
                <DropdownMenuItem onClick={handleLogout} className="text-rose-400 cursor-pointer hover:bg-slate-700">
                  <LogOut className="h-4 w-4 mr-2" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
