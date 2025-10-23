import { useState, useEffect } from "react";
import { Shield, Search, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { MetricCard } from "./MetricCard";

interface BlacklistedUser {
  user_id: string;
  username: string;
  nickname: string;
  status: string;
  blocked_reason: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
  unblocked_at: string | null;
  admin_username?: string;
  admin_nickname?: string;
}

export function BlacklistManagement() {
  const { authState } = useAuth();
  const [blacklistedUsers, setBlacklistedUsers] = useState<BlacklistedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoreLoading, setRestoreLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // 블랙리스트 사용자 조회
  const fetchBlacklistedUsers = async () => {
    try {
      setLoading(true);
      console.log('📋 블랙리스트 사용자 조회 시작');

      // 새로운 VIEW를 사용해서 조회
      const { data, error } = await supabase
        .from('blacklist_users_view')
        .select('*')
        .order('blocked_at', { ascending: false });

      if (error) {
        console.error('❌ 블랙리스트 조회 오류:', error);
        throw error;
      }

      console.log('📊 블랙리스트 데이터:', data);
      console.log(`📈 블랙리스트 사용자 수: ${data?.length || 0}명`);
      
      setBlacklistedUsers(data || []);

    } catch (error: any) {
      console.error('❌ 블랙리스트 조회 실패:', error);
      toast.error('블랙리스트를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 블랙리스트 해제 (복원)
  const handleRestoreUser = async (user: BlacklistedUser) => {
    if (!authState.user?.id) {
      toast.error('관리자 인증 정보가 없습니다.');
      return;
    }

    try {
      setRestoreLoading(user.user_id);
      console.log('🔓 블랙리스트 해제 시작:', user.user_id);

      // 새로운 심플한 해제 함수 호출
      const { data, error } = await supabase.rpc('remove_user_from_blacklist_simple', {
        p_user_id: user.user_id,
        p_admin_id: authState.user.id
      });

      if (error) {
        console.error('❌ 블랙리스트 해제 오류:', error);
        throw error;
      }

      console.log('✅ RPC 응답:', data);

      if (!data.success) {
        throw new Error(data.error || '블랙리스트 해제 실패');
      }

      toast.success(`${user.username}님이 회원관리로 복원되었습니다.`);
      
      // 목록에서 해당 사용자 제거
      setBlacklistedUsers(prev => prev.filter(u => u.user_id !== user.user_id));

    } catch (error: any) {
      console.error('❌ 블랙리스트 해제 실패:', error);
      toast.error(error.message || '블랙리스트 해제 중 오류가 발생했습니다.');
    } finally {
      setRestoreLoading(null);
    }
  };

  // 검색 필터링
  const filteredUsers = blacklistedUsers.filter(user =>
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.nickname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.blocked_reason?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 초기 로드 및 실시간 구독
  useEffect(() => {
    fetchBlacklistedUsers();

    // users 테이블 변경 구독
    const channel = supabase
      .channel('blacklist-users-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'users' },
        (payload) => {
          console.log('🔔 사용자 테이블 변경 감지:', payload);
          // status가 blocked로 변경되거나 blocked에서 active로 변경될 때
          if (payload.new?.status === 'blocked' || payload.old?.status === 'blocked') {
            fetchBlacklistedUsers();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading && blacklistedUsers.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Shield className="h-6 w-6 text-rose-400" />
            블랙리스트 관리
          </h1>
          <p className="text-muted-foreground mt-2">
            차단된 회원들을 관리하고 복원할 수 있습니다.
          </p>
        </div>
        <Button 
          onClick={fetchBlacklistedUsers} 
          variant="outline"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid gap-5 md:grid-cols-2">
        <MetricCard
          title="블랙리스트 회원"
          value={blacklistedUsers.length.toLocaleString()}
          subtitle="차단된 회원 수"
          icon={Shield}
          color="red"
        />
        
        <MetricCard
          title="검색 결과"
          value={filteredUsers.length.toLocaleString()}
          subtitle="필터링된 결과"
          icon={Search}
          color="blue"
        />
      </div>

      {/* 블랙리스트 목록 */}
      <div className="glass-card rounded-xl p-6">
        {/* 헤더 및 통합 필터 */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
          <div>
            <h3 className="font-semibold text-slate-100 mb-1">블랙리스트 목록</h3>
            <p className="text-sm text-slate-400">
              총 {filteredUsers.length.toLocaleString()}명의 차단된 사용자
            </p>
          </div>
          
          {/* 통합 검색 */}
          <div className="relative w-96">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="아이디, 닉네임, 차단 사유 검색"
              className="pl-10 input-premium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        
        <div className="space-y-4">

          {/* 데이터 테이블 */}
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">
                {blacklistedUsers.length === 0 
                  ? '등록된 블랙리스트가 없습니다.' 
                  : '검색 조건에 맞는 블랙리스트가 없습니다.'
                }
              </p>
              {blacklistedUsers.length === 0 && (
                <p className="text-sm text-gray-400 mt-2">
                  회원관리에서 블랙 버튼을 클릭하면 여기에 표시됩니다.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">아이디</th>
                    <th className="text-left p-3">닉네임</th>
                    <th className="text-left p-3">차단 사유</th>
                    <th className="text-left p-3">처리자</th>
                    <th className="text-left p-3">차단일시</th>
                    <th className="text-left p-3">상태</th>
                    <th className="text-left p-3">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.user_id} className="border-b hover:bg-muted/50">
                      <td className="p-3 font-medium">{user.username}</td>
                      <td className="p-3">{user.nickname}</td>
                      <td className="p-3">
                        <div className="max-w-[200px] truncate" title={user.blocked_reason || ''}>
                          {user.blocked_reason || '사유 없음'}
                        </div>
                      </td>
                      <td className="p-3">{user.admin_nickname || '시스템'}</td>
                      <td className="p-3">
                        {user.blocked_at 
                          ? new Date(user.blocked_at).toLocaleString('ko-KR')
                          : '-'
                        }
                      </td>
                      <td className="p-3">
                        <Badge variant="destructive">
                          차단중
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestoreUser(user)}
                          disabled={restoreLoading === user.user_id}
                          className="text-green-600 hover:bg-green-50"
                        >
                          {restoreLoading === user.user_id ? (
                            <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          )}
                          복원
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BlacklistManagement;