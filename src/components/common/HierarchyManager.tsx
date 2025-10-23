import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner@2.0.3';

// 7단계 권한 레벨 정의
export enum HierarchyLevel {
  SYSTEM_ADMIN = 1,    // 시스템관리자
  HEADQUARTERS = 2,    // 대본사
  MAIN_OFFICE = 3,     // 본사
  SUB_OFFICE = 4,      // 부본사
  DISTRIBUTOR = 5,     // 총판
  STORE = 6,           // 매장
  USER = 7             // 사용자 (users 테이블)
}

// 레벨별 한국어 이름
export const HIERARCHY_NAMES = {
  [HierarchyLevel.SYSTEM_ADMIN]: '시스템관리자',
  [HierarchyLevel.HEADQUARTERS]: '대본사',
  [HierarchyLevel.MAIN_OFFICE]: '본사',
  [HierarchyLevel.SUB_OFFICE]: '부본사',
  [HierarchyLevel.DISTRIBUTOR]: '총판',
  [HierarchyLevel.STORE]: '매장',
  [HierarchyLevel.USER]: '사용자'
};

// 사용자 권한 확인 훅
export function useHierarchyAuth() {
  const { authState } = useAuth();
  const [userLevel, setUserLevel] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkUserLevel = async () => {
      if (!authState.user?.id) {
        setLoading(false);
        return;
      }

      try {
        // 파트너 테이블에서 레벨 확인
        const { data, error } = await supabase
          .from('partners')
          .select('level')
          .eq('id', authState.user.id)
          .maybeSingle(); // single() 대신 maybeSingle() 사용

        if (error) {
          console.error('사용자 레벨 확인 오류:', error);
          setUserLevel(null);
        } else if (data) {
          setUserLevel(data.level || null);
        } else {
          // 파트너 테이블에 없으면 users 테이블 확인 (일반 사용자)
          console.log('파트너가 아닙니다. 일반 사용자로 판단합니다.');
          setUserLevel(HierarchyLevel.USER); // 7: 사용자 레벨
        }
      } catch (error) {
        console.error('사용자 레벨 확인 실패:', error);
        setUserLevel(null);
      } finally {
        setLoading(false);
      }
    };

    checkUserLevel();
  }, [authState.user?.id]);

  return {
    userLevel,
    loading,
    isSystemAdmin: userLevel === HierarchyLevel.SYSTEM_ADMIN,
    canManageUsers: userLevel && userLevel <= HierarchyLevel.STORE,
    getLevelName: (level: number) => HIERARCHY_NAMES[level as HierarchyLevel] || '알 수 없음'
  };
}

// 계층구조 기반 데이터 조회 훅
export function useHierarchicalData<T>(
  fetchFunction: string,
  dependencies: any[] = []
) {
  const { authState } = useAuth();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!authState.user?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: result, error: fetchError } = await supabase
        .rpc(fetchFunction, {
          p_partner_id: authState.user.id
        });

      if (fetchError) {
        console.error(`${fetchFunction} 조회 오류:`, fetchError);
        setError(fetchError.message);
        throw fetchError;
      }

      setData(result || []);
    } catch (err) {
      console.error(`${fetchFunction} 조회 실패:`, err);
      setError(err instanceof Error ? err.message : '데이터 조회에 실패했습니다.');
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [authState.user?.id, ...dependencies]);

  return {
    data,
    loading,
    error,
    refetch: fetchData
  };
}

// 권한 검증 컴포넌트
interface PermissionGateProps {
  requiredLevel?: HierarchyLevel;
  maxLevel?: HierarchyLevel;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ 
  requiredLevel, 
  maxLevel, 
  children, 
  fallback 
}: PermissionGateProps) {
  const { userLevel, loading } = useHierarchyAuth();

  if (loading) {
    return <div className="animate-pulse bg-muted h-8 rounded"></div>;
  }

  if (!userLevel) {
    return fallback || <div className="text-muted-foreground">권한 없음</div>;
  }

  // 최소 권한 레벨 체크
  if (requiredLevel && userLevel > requiredLevel) {
    return fallback || <div className="text-muted-foreground">권한 부족</div>;
  }

  // 최대 권한 레벨 체크
  if (maxLevel && userLevel < maxLevel) {
    return fallback || <div className="text-muted-foreground">권한 초과</div>;
  }

  return <>{children}</>;
}

// 계층구조 표시 컴포넌트
interface HierarchyBadgeProps {
  level: number;
  username?: string;
  className?: string;
}

export function HierarchyBadge({ level, username, className = '' }: HierarchyBadgeProps) {
  const levelName = HIERARCHY_NAMES[level as HierarchyLevel] || '알 수 없음';
  
  const getColorClass = (level: number) => {
    switch (level) {
      case HierarchyLevel.SYSTEM_ADMIN:
        return 'bg-red-100 text-red-800 border-red-200';
      case HierarchyLevel.HEADQUARTERS:
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case HierarchyLevel.MAIN_OFFICE:
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case HierarchyLevel.SUB_OFFICE:
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case HierarchyLevel.DISTRIBUTOR:
        return 'bg-green-100 text-green-800 border-green-200';
      case HierarchyLevel.STORE:
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium ${getColorClass(level)} ${className}`}>
      <span>{levelName}</span>
      {username && (
        <>
          <span className="text-muted-foreground">•</span>
          <span>{username}</span>
        </>
      )}
    </div>
  );
}

// 계층구조 검증 함수
export const validateHierarchy = async (parentId: string, childLevel: number) => {
  try {
    const { data, error } = await supabase
      .from('partners')
      .select('level')
      .eq('id', parentId)
      .single();

    if (error) {
      throw new Error('부모 파트너 정보를 찾을 수 없습니다.');
    }

    const parentLevel = data.level;
    
    // 자식 레벨은 부모 레벨보다 1 높아야 함
    if (childLevel !== parentLevel + 1) {
      throw new Error(`${HIERARCHY_NAMES[parentLevel as HierarchyLevel]}는 ${HIERARCHY_NAMES[childLevel as HierarchyLevel]}을 직접 관리할 수 없습니다.`);
    }

    return true;
  } catch (error) {
    throw error;
  }
};

// 계층구조 경로 표시 컴포넌트
interface HierarchyPathProps {
  partnerId: string;
  className?: string;
}

export function HierarchyPath({ partnerId, className = '' }: HierarchyPathProps) {
  const [path, setPath] = useState<Array<{ id: string; username: string; level: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPath = async () => {
      try {
        const { data, error } = await supabase
          .rpc('get_hierarchy_path', { partner_id: partnerId });

        if (error) throw error;
        setPath(data || []);
      } catch (error) {
        console.error('계층구조 경로 조회 오류:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPath();
  }, [partnerId]);

  if (loading) {
    return <div className="animate-pulse bg-muted h-6 rounded w-32"></div>;
  }

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      {path.map((item, index) => (
        <div key={item.id} className="flex items-center gap-2">
          <HierarchyBadge level={item.level} username={item.username} />
          {index < path.length - 1 && (
            <span className="text-muted-foreground">→</span>
          )}
        </div>
      ))}
    </div>
  );
}