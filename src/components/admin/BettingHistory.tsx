import { useState, useEffect, useMemo } from "react";
import { CreditCard, Download, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";
import { MetricCard } from "./MetricCard";
import { forceSyncBettingHistory } from "./BettingHistorySync";

interface BettingHistoryProps {
  user: Partner;
}

interface BettingRecord {
  id: string;
  external_txid: string | number;
  username: string;
  user_id: string | null;
  game_id: number;
  provider_id: number;
  game_title?: string;
  provider_name?: string;
  bet_amount: number;
  win_amount: number;
  balance_before: number;
  balance_after: number;
  played_at: string;
}

export function BettingHistory({ user }: BettingHistoryProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bettingRecords, setBettingRecords] = useState<BettingRecord[]>([]);
  const [dateFilter, setDateFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // 날짜 포맷 (이미지와 동일: 2025년10월24일 08:19:52)
  const formatKoreanDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}년${month}월${day}일 ${hours}:${minutes}:${seconds}`;
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
        return null;
    }
  };

  // ✅ 강제 새로고침 - API 호출 후 DB 조회
  const handleForceRefresh = async () => {
    try {
      console.log('🔄 강제 새로고침 시작');
      setRefreshing(true);
      
      // 1. API 호출하여 최신 데이터 동기화
      await forceSyncBettingHistory(user);
      
      // 2. 1초 대기 (DB INSERT 완료 대기)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 3. DB에서 데이터 로드
      await loadBettingData();
      
      toast.success('베팅 내역이 갱신되었습니다.');
    } catch (error) {
      console.error('❌ 강제 새로고침 오류:', error);
      toast.error('새로고침에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  // ✅ 데이터 로드 - 조회만 담당 (내부용)
  const loadBettingData = async () => {
    try {
      console.log('🔄 베팅 데이터 로드 시작');
      
      const dateRange = getDateRange(dateFilter);

      // ✅ 권한별 하위 파트너 ID 목록 조회
      let allowedPartnerIds: string[] = [];
      
      if (user.level === 1) {
        // 시스템관리자: 모든 파트너
        const { data: allPartners } = await supabase
          .from('partners')
          .select('id');
        allowedPartnerIds = allPartners?.map(p => p.id) || [];
      } else {
        // 하위 파트너만 (자신 포함)
        allowedPartnerIds = [user.id];
        
        // 1단계 하위
        const { data: level1 } = await supabase
          .from('partners')
          .select('id')
          .eq('parent_id', user.id);
        
        const level1Ids = level1?.map(p => p.id) || [];
        allowedPartnerIds.push(...level1Ids);
        
        if (level1Ids.length > 0) {
          // 2단계 하위
          const { data: level2 } = await supabase
            .from('partners')
            .select('id')
            .in('parent_id', level1Ids);
          
          const level2Ids = level2?.map(p => p.id) || [];
          allowedPartnerIds.push(...level2Ids);
          
          if (level2Ids.length > 0) {
            // 3단계 하위
            const { data: level3 } = await supabase
              .from('partners')
              .select('id')
              .in('parent_id', level2Ids);
            
            const level3Ids = level3?.map(p => p.id) || [];
            allowedPartnerIds.push(...level3Ids);
            
            if (level3Ids.length > 0) {
              // 4단계 하위
              const { data: level4 } = await supabase
                .from('partners')
                .select('id')
                .in('parent_id', level3Ids);
              
              const level4Ids = level4?.map(p => p.id) || [];
              allowedPartnerIds.push(...level4Ids);
              
              if (level4Ids.length > 0) {
                // 5단계 하위
                const { data: level5 } = await supabase
                  .from('partners')
                  .select('id')
                  .in('parent_id', level4Ids);
                
                const level5Ids = level5?.map(p => p.id) || [];
                allowedPartnerIds.push(...level5Ids);
              }
            }
          }
        }
      }
      
      console.log('👥 하위 파트너 ID 개수:', allowedPartnerIds.length);

      // ✅ 데이터 조회 (레벨에 따라 필터링)
      let query = supabase
        .from('game_records')
        .select('*');

      if (user.level === 1) {
        // 시스템관리자: 모든 데이터 조회 가능
        if (allowedPartnerIds.length > 0) {
          query = query.in('partner_id', allowedPartnerIds);
        }
        console.log('🔍 시스템관리자: 모든 파트너 데이터 조회');
      } else {
        // 일반 관리자: 하위 회원 ID로 필터링
        const { data: usersData } = await supabase
          .from('users')
          .select('id')
          .in('referrer_id', allowedPartnerIds);
        
        const userIds = usersData?.map(u => u.id) || [];
        console.log('👤 하위 회원 ID 개수:', userIds.length);
        
        if (userIds.length > 0) {
          query = query.in('user_id', userIds);
        } else {
          // 하위 회원이 없으면 빈 결과 반환
          console.log('⚠️ 하위 회원이 없습니다.');
          setBettingRecords([]);
          return;
        }
      }
      
      // 날짜 필터가 있을 때만 적용
      if (dateRange) {
        query = query
          .gte('played_at', dateRange.start)
          .lte('played_at', dateRange.end);
      }
      
      // 정렬 및 제한 (최신순으로 정렬하여 최근 데이터 우선)
      query = query
        .order('played_at', { ascending: false })
        .order('external_txid', { ascending: false })
        .limit(1000);

      const { data, error } = await query;

      if (error) {
        console.error('❌ 베팅 데이터 로드 실패:', error);
        throw error;
      }

      console.log('✅ 베팅 데이터 로드 성공:', data?.length || 0, '건');
      
      // 🔍 디버깅: 첫 번째 레코드 출력
      if (data && data.length > 0) {
        console.log('📋 첫 번째 레코드:', data[0]);
      }
      
      // 데이터 상태 업데이트
      setBettingRecords(data || []);
    } catch (error) {
      console.error('❌ 베팅 데이터 로드 오류:', error);
      toast.error('베팅 데이터를 불러오는데 실패했습니다.');
    }
  };

  // CSV 다운로드
  const downloadExcel = () => {
    try {
      const csvContent = [
        ['TX ID', '사용자', '게임명', '제공사', '베팅액', '당첨액', '베팅전금액', '베팅후금액', '손익', '플레이 시간'].join(','),
        ...filteredRecords.map(record => {
          const profitLoss = parseFloat(record.win_amount?.toString() || '0') - parseFloat(record.bet_amount?.toString() || '0');
          return [
            record.external_txid,
            record.username,
            record.game_title || `Game ${record.game_id}`,
            record.provider_name || `Provider ${record.provider_id}`,
            record.bet_amount,
            record.win_amount,
            record.balance_before,
            record.balance_after,
            profitLoss,
            formatKoreanDate(record.played_at)
          ].join(',');
        })
      ].join('\n');

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `betting_history_${dateFilter}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success('베팅 내역 다운로드 완료');
    } catch (error) {
      console.error('다운로드 오류:', error);
      toast.error('다운로드 실패');
    }
  };

  // 초기 로드
  useEffect(() => {
    setLoading(true);
    loadBettingData().finally(() => setLoading(false));
  }, [dateFilter]);

  // ✅ Realtime 구독 - 자동 업데이트 (한번만 설정)
  useEffect(() => {
    console.log('🔌 Realtime 구독 시작');
    
    const channel = supabase
      .channel('betting-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_records'
        },
        (payload) => {
          console.log('🎲 신규 베팅 데이터 감지:', payload);
          // 즉시 데이터 재로드
          loadBettingData();
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime 구독 상태:', status);
      });

    return () => {
      console.log('🔌 Realtime 구독 해제');
      supabase.removeChannel(channel);
    };
  }, []); // ⚠️ 의존성 배열 비움 - 한번만 구독

  // ✅ 검색 필터링 (useMemo로 메모이제이션)
  const filteredRecords = useMemo(() => {
    return bettingRecords.filter(record => {
      // 검색 필터
      if (!searchTerm) return true;
      
      const searchLower = searchTerm.toLowerCase();
      return (
        record.username?.toLowerCase().includes(searchLower) ||
        record.game_title?.toLowerCase().includes(searchLower) ||
        record.provider_name?.toLowerCase().includes(searchLower) ||
        record.external_txid?.toString().includes(searchLower)
      );
    });
  }, [bettingRecords, searchTerm]);

  // ✅ 검색된 데이터 기준으로 통계 계산 (useMemo로 메모이제이션)
  const stats = useMemo(() => {
    if (filteredRecords.length > 0) {
      const totalBetAmount = filteredRecords.reduce((sum, r) => sum + parseFloat(r.bet_amount?.toString() || '0'), 0);
      const totalWinAmount = filteredRecords.reduce((sum, r) => sum + parseFloat(r.win_amount?.toString() || '0'), 0);

      return {
        totalBets: filteredRecords.length,
        totalBetAmount,
        totalWinAmount,
        netProfit: totalWinAmount - totalBetAmount
      };
    } else {
      return {
        totalBets: 0,
        totalBetAmount: 0,
        totalWinAmount: 0,
        netProfit: 0
      };
    }
  }, [filteredRecords]);

  // 테이블 컬럼 정의 (가독성 향상을 위한 명확한 컬러링)
  const columns = [
    {
      key: 'username',
      header: '사용자',
      render: (_: any, record: BettingRecord) => (
        <span className="text-blue-300 font-medium">{record?.username}</span>
      )
    },
    {
      key: 'game_title',
      header: '게임명',
      render: (_: any, record: BettingRecord) => (
        <span className="text-slate-200">{record?.game_title || `Korean Speed Baccarat A`}</span>
      )
    },
    {
      key: 'provider',
      header: '게임사',
      render: (_: any, record: BettingRecord) => (
        <Badge variant="secondary" className="bg-indigo-500/20 text-indigo-300 border-indigo-400/30">
          {record?.provider_name || 'Evolution'}
        </Badge>
      )
    },
    {
      key: 'bet_amount',
      header: '베팅액',
      render: (_: any, record: BettingRecord) => {
        const amount = Number(record?.bet_amount || 0);
        if (amount === 0) {
          return <span className="text-slate-500">배팅중</span>;
        }
        return <span className="text-orange-400 font-semibold">₩{amount.toLocaleString()}</span>;
      }
    },
    {
      key: 'win_amount',
      header: '당첨액',
      render: (_: any, record: BettingRecord) => {
        const amount = Number(record?.win_amount || 0);
        if (amount === 0) {
          return <span className="text-slate-500">배팅중</span>;
        }
        return <span className="text-emerald-400 font-semibold">₩{amount.toLocaleString()}</span>;
      }
    },
    {
      key: 'balance_before',
      header: '베팅전잔액',
      render: (_: any, record: BettingRecord) => (
        <span className="text-slate-300">₩{Number(record?.balance_before || 0).toLocaleString()}</span>
      )
    },
    {
      key: 'balance_after',
      header: '베팅후금액',
      render: (_: any, record: BettingRecord) => (
        <span className="text-slate-300">₩{Number(record?.balance_after || 0).toLocaleString()}</span>
      )
    },
    {
      key: 'profit',
      header: '손익',
      render: (_: any, record: BettingRecord) => {
        if (!record) return <span>-</span>;
        const profit = Number(record.win_amount || 0) - Number(record.bet_amount || 0);
        const profitColor = profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-400' : 'text-slate-400';
        const profitBg = profit > 0 ? 'bg-green-500/10' : profit < 0 ? 'bg-red-500/10' : '';
        return (
          <span className={`${profitColor} ${profitBg} px-2 py-1 rounded font-bold`}>
            {profit > 0 ? '+' : ''}₩{profit.toLocaleString()}
          </span>
        );
      }
    },
    {
      key: 'played_at',
      header: '프로바이더 시간',
      render: (_: any, record: BettingRecord) => (
        <span className="text-xs text-slate-400">{formatKoreanDate(record?.played_at)}</span>
      )
    }
  ];

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="총 베팅 수"
          value={stats.totalBets.toLocaleString()}
          icon={CreditCard}
          color="purple"
        />
        <MetricCard
          title="총 베팅액"
          value={`₩${stats.totalBetAmount.toLocaleString()}`}
          icon={CreditCard}
          color="red"
        />
        <MetricCard
          title="총 당첨액"
          value={`₩${stats.totalWinAmount.toLocaleString()}`}
          icon={CreditCard}
          color="green"
        />
        <MetricCard
          title="순손익"
          value={`₩${stats.netProfit.toLocaleString()}`}
          icon={CreditCard}
          color={stats.netProfit >= 0 ? "green" : "red"}
        />
      </div>

      {/* 필터 및 액션 */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2 items-center w-full md:w-auto flex-wrap">
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="기간 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="today">오늘</SelectItem>
              <SelectItem value="week">최근 7일</SelectItem>
              <SelectItem value="month">최근 30일</SelectItem>
            </SelectContent>
          </Select>
          
          <Input
            placeholder="사용자명, 게임명 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full md:w-[250px]"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleForceRefresh} variant="outline" size="sm" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '새로고침 중...' : '새로고침'}
          </Button>
          <Button onClick={downloadExcel} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            CSV 다운로드
          </Button>
        </div>
      </div>

      {/* 데이터 테이블 */}
      <DataTable
        data={filteredRecords}
        columns={columns}
        emptyMessage="베팅 기록이 없습니다."
        enableSearch={false}
        pageSize={20}
      />
    </div>
  );
}
