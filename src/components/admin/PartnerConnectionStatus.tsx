import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { Partner } from "../../types";
import { DataTable } from "../common/DataTable";
import { MetricCard } from "./MetricCard";
import { Badge } from "../ui/badge";
import { Wifi, CreditCard, Users, Wallet } from "lucide-react";

interface PartnerConnection {
  id: string;
  username: string;
  nickname: string;
  level: number;
  partner_type: string;
  balance: number;
  last_login_at: string | null;
  status: string;
  parent_nickname: string;
}

interface PartnerStats {
  totalUsers: number;
  totalUserBalance: number;
}

interface PartnerConnectionStatusProps {
  user: Partner;
}

export function PartnerConnectionStatus({ user }: PartnerConnectionStatusProps) {
  const [partners, setPartners] = useState<PartnerConnection[]>([]);
  const [stats, setStats] = useState<PartnerStats>({ totalUsers: 0, totalUserBalance: 0 });
  const [loading, setLoading] = useState(true);
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [allPartnerIds, setAllPartnerIds] = useState<string[]>([]);

  // 모든 하위 파트너 ID를 재귀적으로 가져오기
  const getAllChildPartnerIds = async (partnerId: string): Promise<string[]> => {
    const partnerIds: string[] = [];
    const queue: string[] = [partnerId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      // 직속 하위 파트너 조회
      const { data, error } = await supabase
        .from('partners')
        .select('id')
        .eq('parent_id', currentId);

      if (!error && data) {
        for (const partner of data) {
          partnerIds.push(partner.id);
          queue.push(partner.id);
        }
      }
    }

    return partnerIds;
  };

  // 파트너 접속 현황 로드
  const loadPartnerConnections = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);

      // 자신 이하 모든 파트너 ID 가져오기
      let childPartnerIds: string[] = [];
      if (user.level !== 1) {
        childPartnerIds = await getAllChildPartnerIds(user.id);
      }

      // 파트너 목록 조회
      let query = supabase
        .from('partners')
        .select(`
          id,
          username,
          nickname,
          level,
          partner_type,
          balance,
          last_login_at,
          status,
          parent_id
        `)
        .order('last_login_at', { ascending: false, nullsFirst: false });

      // 시스템관리자(level 1)가 아닌 경우 자신의 하위 파트너만 필터링
      if (user.level !== 1 && childPartnerIds.length > 0) {
        query = query.in('id', childPartnerIds);
      } else if (user.level !== 1 && childPartnerIds.length === 0) {
        // 하위 파트너가 없으면 빈 배열
        setPartners([]);
        setAllPartnerIds([]);
        if (isInitial) setLoading(false);
        return;
      }

      const { data, error } = await query;

      if (error) throw error;

      // parent nickname을 가져오기 위해 parent_id 목록 조회
      const parentIds = [...new Set((data || []).map((p: any) => p.parent_id).filter(Boolean))];
      let parentMap: Record<string, string> = {};
      
      if (parentIds.length > 0) {
        const { data: parentData } = await supabase
          .from('partners')
          .select('id, nickname')
          .in('id', parentIds);
        
        if (parentData) {
          parentMap = parentData.reduce((acc, p) => {
            acc[p.id] = p.nickname;
            return acc;
          }, {} as Record<string, string>);
        }
      }

      // 데이터 포맷팅
      const formattedPartners: PartnerConnection[] = (data || []).map((partner: any) => ({
        id: partner.id,
        username: partner.username,
        nickname: partner.nickname,
        level: partner.level,
        partner_type: partner.partner_type,
        balance: partner.balance || 0,
        last_login_at: partner.last_login_at,
        status: partner.status,
        parent_nickname: partner.parent_id ? (parentMap[partner.parent_id] || '-') : '-'
      }));

      setPartners(formattedPartners);
      
      // 모든 파트너 ID 저장 (자신 포함)
      const partnerIdsForUsers = user.level === 1 
        ? formattedPartners.map(p => p.id)
        : [user.id, ...childPartnerIds];
      setAllPartnerIds(partnerIdsForUsers);

      // 사용자 통계 조회
      await loadUserStats(partnerIdsForUsers);

    } catch (error: any) {
      console.error("파트너 접속 현황 로드 오류:", error);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  // 사용자 통계 로드
  const loadUserStats = async (partnerIds: string[]) => {
    try {
      if (partnerIds.length === 0) {
        setStats({ totalUsers: 0, totalUserBalance: 0 });
        return;
      }

      // users 테이블에서 해당 파트너들의 사용자 조회
      const { data, error } = await supabase
        .from('users')
        .select('id, balance')
        .in('referrer_id', partnerIds);

      if (error) throw error;

      const totalUsers = data?.length || 0;
      const totalUserBalance = data?.reduce((sum, user) => sum + (user.balance || 0), 0) || 0;

      setStats({ totalUsers, totalUserBalance });
    } catch (error: any) {
      console.error("사용자 통계 로드 오류:", error);
    }
  };

  // 초기 로드
  useEffect(() => {
    loadPartnerConnections(true);
  }, [user.id]);

  // Realtime 구독: partners, users 테이블 변경 감지
  useEffect(() => {
    console.log('🔔 Realtime 구독 시작: partners, users');

    const channel = supabase
      .channel('partner-connections-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'partners'
        },
        (payload) => {
          console.log('🔔 partners 변경 감지:', payload);
          
          // Debounce: 500ms 후에 재로드
          if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current);
          }
          reloadTimeoutRef.current = setTimeout(() => {
            loadPartnerConnections();
          }, 500);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('🔔 users 변경 감지:', payload);
          
          // 사용자 통계만 재로드
          if (allPartnerIds.length > 0) {
            if (reloadTimeoutRef.current) {
              clearTimeout(reloadTimeoutRef.current);
            }
            reloadTimeoutRef.current = setTimeout(() => {
              loadUserStats(allPartnerIds);
            }, 500);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, [user.id, allPartnerIds]);

  // 파트너 타입 한글 변환
  const getPartnerTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      'system_admin': '시스템관리자',
      'head_office': '대본사',
      'main_office': '본사',
      'sub_office': '부본사',
      'distributor': '총판',
      'store': '매장'
    };
    return typeMap[type] || type;
  };

  // 세션 시간 계산
  const getSessionTime = (lastLoginAt: string | null) => {
    if (!lastLoginAt) return '-';
    
    const loginTime = new Date(lastLoginAt).getTime();
    const now = Date.now();
    const diffMinutes = Math.floor((now - loginTime) / 1000 / 60);
    
    if (diffMinutes < 60) {
      return `${diffMinutes}분`;
    }
    
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return `${hours}시간 ${minutes}분`;
  };

  // 온라인 파트너 (최근 30분 이내 접속)
  const onlinePartners = partners.filter(p => {
    if (!p.last_login_at) return false;
    const diffMinutes = Math.floor((Date.now() - new Date(p.last_login_at).getTime()) / 1000 / 60);
    return diffMinutes <= 30 && p.status === 'active';
  });

  // 총 파트너 보유금
  const totalPartnerBalance = partners.reduce((sum, p) => sum + p.balance, 0);

  const columns = [
    {
      header: "파트너",
      cell: (partner: PartnerConnection) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span>{partner.username}</span>
            <Badge variant="outline" className="text-xs">
              {partner.nickname}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            상위: {partner.parent_nickname}
          </span>
        </div>
      ),
    },
    {
      header: "등급",
      cell: (partner: PartnerConnection) => (
        <div className="flex flex-col gap-1">
          <Badge variant="secondary">
            LV.{partner.level}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {getPartnerTypeText(partner.partner_type)}
          </span>
        </div>
      ),
    },
    {
      header: "보유금",
      cell: (partner: PartnerConnection) => (
        <span className={partner.balance < 0 ? "text-red-500" : ""}>
          ₩{partner.balance.toLocaleString()}
        </span>
      ),
    },
    {
      header: "상태",
      cell: (partner: PartnerConnection) => {
        const isOnline = partner.last_login_at && 
          (Date.now() - new Date(partner.last_login_at).getTime()) / 1000 / 60 <= 30 &&
          partner.status === 'active';
        
        return (
          <Badge variant={isOnline ? "default" : "outline"}>
            {isOnline ? '온라인' : '오프라인'}
          </Badge>
        );
      },
    },
    {
      header: "접속 일시",
      cell: (partner: PartnerConnection) => (
        <div className="text-xs">
          {partner.last_login_at 
            ? new Date(partner.last_login_at).toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })
            : '접속 기록 없음'
          }
        </div>
      ),
    },
    {
      header: "세션 시간",
      cell: (partner: PartnerConnection) => (
        <div className="text-xs">
          {getSessionTime(partner.last_login_at)}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl">파트너 접속현황</h2>
          <p className="text-sm text-muted-foreground mt-1">
            하위 파트너들의 실시간 접속 현황 및 보유금 정보
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="온라인 파트너"
          value={`${onlinePartners.length}명`}
          subtitle="최근 30분 이내 접속"
          icon={Wifi}
          color="purple"
        />
        <MetricCard
          title="총 파트너 보유금"
          value={`₩${totalPartnerBalance.toLocaleString()}`}
          subtitle="하위 파트너 보유금 합계"
          icon={CreditCard}
          color="pink"
        />
        <MetricCard
          title="관리 사용자"
          value={`${stats.totalUsers.toLocaleString()}명`}
          subtitle="하위 파트너 사용자 수"
          icon={Users}
          color="cyan"
        />
        <MetricCard
          title="총 사용자 보유금"
          value={`₩${stats.totalUserBalance.toLocaleString()}`}
          subtitle="사용자 보유금 합계"
          icon={Wallet}
          color="amber"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          </div>
        </div>
      ) : (
        <DataTable
          data={partners}
          columns={columns}
          emptyMessage="조회된 파트너가 없습니다"
          rowKey="id"
        />
      )}
    </div>
  );
}
