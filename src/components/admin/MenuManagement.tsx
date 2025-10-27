import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { 
  Settings, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle, 
  Shield, 
  Menu as MenuIcon,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Building2
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";
import { getPartnerLevelText } from "../../lib/utils";

interface MenuPermission {
  id: string;
  menu_name: string;
  menu_path: string;
  partner_level: number;
  is_visible: boolean;
  display_order: number;
  parent_menu?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

interface PartnerMenuPermission {
  id: string;
  partner_id: string;
  menu_permission_id: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  menu_permission?: MenuPermission;
}

interface MenuManagementProps {
  user: Partner;
}

interface GroupedMenus {
  [key: string]: PartnerMenuPermission[];
}

export function MenuManagement({ user }: MenuManagementProps) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [menuPermissions, setMenuPermissions] = useState<MenuPermission[]>([]);
  const [partnerMenuPermissions, setPartnerMenuPermissions] = useState<PartnerMenuPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuLoading, setMenuLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 파트너 목록 로드 (계층 구조 고려)
  const loadPartners = async () => {
    try {
      setLoading(true);
      
      // 시스템관리자는 모든 파트너 조회
      if (user.level === 1) {
        const { data, error } = await supabase
          .from('partners')
          .select('id, username, nickname, level, status')
          .eq('status', 'active')
          .order('level', { ascending: true })
          .order('nickname', { ascending: true });

        if (error) throw error;
        
        setPartners(data || []);
        
        if (!data || data.length === 0) {
          toast.warning('활성화된 파트너가 없습니다.');
        }
      } else {
        // 대본사 등: 모든 하위 파트너 재귀 조회 (자기 자신 제외)
        const { data, error } = await supabase
          .rpc('get_hierarchical_partners', { p_partner_id: user.id });

        if (error) {
          console.error('하위 파트너 조회 실패:', error);
          // RPC 실패 시 직접 하위만 조회
          const { data: directChildren, error: directError } = await supabase
            .from('partners')
            .select('id, username, nickname, level, status')
            .eq('status', 'active')
            .eq('parent_id', user.id)
            .order('level', { ascending: true })
            .order('nickname', { ascending: true });

          if (directError) {
            console.error('직접 하위 조회도 실패:', directError);
            setPartners([]);
          } else {
            setPartners(directChildren || []);
            if (!directChildren || directChildren.length === 0) {
              toast.warning('관리할 수 있는 파트너가 없습니다.');
            }
          }
        } else {
          const activePartners = (data || []).filter((p: any) => p.status === 'active');
          setPartners(activePartners);
          
          console.log('✅ 계층 파트너 조회 완료:', {
            total: activePartners.length,
            by_level: activePartners.reduce((acc: any, p: any) => {
              acc[p.level] = (acc[p.level] || 0) + 1;
              return acc;
            }, {})
          });
          
          if (activePartners.length === 0) {
            toast.warning('관리할 수 있는 파트너가 없습니다.');
          }
        }
      }
    } catch (error) {
      console.error('파트너 목록 로드 실패:', error);
      toast.error('파트너 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 기본 메뉴 권한 목록 로드
  const loadMenuPermissions = async () => {
    try {
      // ✅ 모든 파트너가 모든 메뉴를 볼 수 있도록 변경
      const { data, error, count } = await supabase
        .from('menu_permissions')
        .select('*', { count: 'exact' })
        .eq('is_visible', true)
        .order('display_order', { ascending: true })
        .order('menu_name', { ascending: true });

      console.log('메뉴 권한 조회 결과:', { 
        success: !error, 
        count: count, 
        dataLength: data?.length,
        error: error 
      });

      if (error) {
        console.error('메뉴 권한 목록 로드 에러:', error);
        
        if (error.code === 'PGRST116' || error.message?.includes('permission')) {
          toast.error('메뉴 데이터 접근 권한이 없습니다.');
        } else {
          toast.error(`메뉴 권한 목록을 불러오는데 실패했습니다: ${error.message}`);
        }
        
        setMenuPermissions([]);
        return;
      }
      
      setMenuPermissions(data || []);
      
      if (!data || data.length === 0) {
        toast.warning('메뉴 권한 데이터가 없습니다. DB 스키마(205번)를 실행해주세요.', {
          description: 'Supabase SQL Editor에서 database/205_menu-management-schema.sql 파일을 실행하세요.'
        });
      } else {
        console.log(`✅ 메뉴 권한 ${data.length}개 로드 성공`);
      }
    } catch (error: any) {
      console.error('메뉴 권한 목록 로드 실패:', error);
      toast.error('메뉴 권한 목록을 불러오는데 실패했습니다.');
      setMenuPermissions([]);
    }
  };

  // 선택된 파트너의 메뉴 권한 로드
  const loadPartnerMenuPermissions = async (partnerId: string) => {
    if (!partnerId) {
      setPartnerMenuPermissions([]);
      setSelectedPartner(null);
      return;
    }

    try {
      setMenuLoading(true);
      
      // 선택된 파트너 정보 설정
      const partner = partners.find(p => p.id === partnerId);
      setSelectedPartner(partner || null);

      if (!partner) {
        toast.error('선택된 파트너 정보를 찾을 수 없습니다.');
        return;
      }

      // ✅ 하위 조직의 경우 상위 파트너가 활성화한 메뉴만 표시
      let availableMenus = menuPermissions;
      
      // 시스템관리자(level 1)가 아닌 하위 파트너를 관리하는 경우
      if (user.level !== 1 && partner.parent_id) {
        // 상위 파트너의 활성화된 메뉴만 조회
        const { data: parentMenus, error: parentError } = await supabase
          .from('partner_menu_permissions')
          .select(`
            menu_permission_id,
            is_enabled,
            menu_permission:menu_permissions(*)
          `)
          .eq('partner_id', partner.parent_id)
          .eq('is_enabled', true);

        if (parentError) {
          console.error('상위 파트너 메뉴 조회 오류:', parentError);
        } else if (parentMenus && parentMenus.length > 0) {
          // 상위 파트너가 활성화한 메뉴만 필터링
          const parentMenuIds = new Set(parentMenus.map(pm => pm.menu_permission_id));
          availableMenus = menuPermissions.filter(menu => parentMenuIds.has(menu.id));
        }
      }
      
      // 기존 파트너별 메뉴 권한 조회
      const { data: existingPermissions, error: permError } = await supabase
        .from('partner_menu_permissions')
        .select(`
          *,
          menu_permission:menu_permissions(*)
        `)
        .eq('partner_id', partnerId);

      if (permError) throw permError;

      // 기존 권한이 없는 메뉴들에 대해 기본 권한 생성
      const missingMenus = availableMenus.filter(menu => 
        !existingPermissions?.some(pmp => pmp.menu_permission_id === menu.id)
      );

      if (missingMenus.length > 0) {
        // ✅ 레벨별로 메뉴 기본 활성화 여부 결정
        // 파트너의 level이 menu의 partner_level 이하면 기본 활성화
        const newPermissions = missingMenus.map(menu => ({
          partner_id: partnerId,
          menu_permission_id: menu.id,
          is_enabled: partner.level <= menu.partner_level  // 레벨별 기본 활성화
        }));

        const { error: insertError } = await supabase
          .from('partner_menu_permissions')
          .insert(newPermissions);

        if (insertError) {
          console.error('기본 메뉴 권한 생성 실패:', insertError);
        }
      }

      // 다시 조회하여 최신 데이터 가져오기
      const { data: updatedPermissions, error: updatedError } = await supabase
        .from('partner_menu_permissions')
        .select(`
          *,
          menu_permission:menu_permissions(*)
        `)
        .eq('partner_id', partnerId);

      if (updatedError) throw updatedError;

      const formattedPermissions = (updatedPermissions || []).map(pmp => ({
        ...pmp,
        menu_permission: Array.isArray(pmp.menu_permission) 
          ? pmp.menu_permission[0] 
          : pmp.menu_permission
      }));

      // ✅ 상위 파트너가 활성화한 메뉴만 표시 (availableMenus 기준으로 필터링)
      const availableMenuIds = new Set(availableMenus.map(m => m.id));
      const filteredPermissions = formattedPermissions.filter(pmp => 
        availableMenuIds.has(pmp.menu_permission_id)
      );

      setPartnerMenuPermissions(filteredPermissions);
      
      // 모든 그룹 기본적으로 펼치기
      const groups = new Set(filteredPermissions
        .map(pmp => pmp.menu_permission?.parent_menu || '기본 메뉴')
        .filter(Boolean));
      setExpandedGroups(groups);

    } catch (error) {
      console.error('파트너 메뉴 권한 로드 실패:', error);
      toast.error('파트너 메뉴 권한을 불러오는데 실패했습니다.');
      setPartnerMenuPermissions([]);
    } finally {
      setMenuLoading(false);
    }
  };

  // 파트너 메뉴 권한 업데이트
  const updatePartnerMenuPermission = async (permission: PartnerMenuPermission, enabled: boolean) => {
    try {
      setSaving(true);

      const menuName = permission.menu_permission?.menu_name || '메뉴';
      
      // ✅ 디버깅 로그 추가
      console.log('🔧 메뉴 권한 업데이트 시작:', {
        menu_name: menuName,
        pmp_id: permission.id,
        menu_permission_id: permission.menu_permission_id,
        current_enabled: permission.is_enabled,
        new_enabled: enabled,
        has_menu_permission: !!permission.menu_permission
      });

      // ✅ ID 유효성 검증
      if (!permission.id) {
        console.error('❌ PMP ID가 없습니다:', permission);
        toast.error(`${menuName}: ID가 없어 업데이트할 수 없습니다.`);
        return;
      }

      if (!permission.menu_permission_id) {
        console.error('❌ menu_permission_id가 없습니다:', permission);
        toast.error(`${menuName}: menu_permission_id가 없어 업데이트할 수 없습니다.`);
        return;
      }

      const { error } = await supabase
        .from('partner_menu_permissions')
        .update({ 
          is_enabled: enabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', permission.id);

      if (error) {
        console.error('❌ DB 업데이트 실패:', {
          menu_name: menuName,
          error_code: error.code,
          error_message: error.message,
          error_details: error.details
        });
        throw error;
      }

      console.log('✅ DB 업데이트 성공:', {
        menu_name: menuName,
        new_enabled: enabled
      });

      // 로컬 상태 업데이트
      setPartnerMenuPermissions(prev => 
        prev.map(pmp => 
          pmp.id === permission.id 
            ? { ...pmp, is_enabled: enabled }
            : pmp
        )
      );

      toast.success(
        `${menuName} ${enabled ? '활성화' : '비활성화'} 완료`,
        {
          description: `메뉴 권한이 성공적으로 ${enabled ? '활성화' : '비활성화'}되었습니다.`
        }
      );

    } catch (error: any) {
      const menuName = permission.menu_permission?.menu_name || '메뉴';
      console.error('❌ 메뉴 권한 업데이트 실패:', error);
      toast.error(`${menuName} 업데이트 실패: ${error.message || '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  // 그룹 토글
  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  };

  // 모든 그룹 펼치기/접기
  const toggleAllGroups = (expand: boolean) => {
    if (expand) {
      const allGroups = new Set(partnerMenuPermissions
        .map(pmp => pmp.menu_permission?.parent_menu || '기본 메뉴')
        .filter(Boolean));
      setExpandedGroups(allGroups);
    } else {
      setExpandedGroups(new Set());
    }
  };

  // 초기 데이터 로드
  useEffect(() => {
    // 메뉴 관리 페이지에 접근 가능한 모든 사용자가 사용 가능
    loadPartners();
    loadMenuPermissions();
  }, [user.id]);

  // 선택된 파트너 변경 시 메뉴 권한 로드
  useEffect(() => {
    if (selectedPartnerId && menuPermissions.length > 0) {
      // 선택된 파트너 정보 저장
      const partner = partners.find(p => p.id === selectedPartnerId);
      setSelectedPartner(partner || null);
      
      loadPartnerMenuPermissions(selectedPartnerId);
    }
  }, [selectedPartnerId, menuPermissions, partners]);

  // 메뉴를 그룹별로 정리
  const groupedMenus: GroupedMenus = partnerMenuPermissions.reduce((acc, pmp) => {
    const groupName = pmp.menu_permission?.parent_menu || '기본 메뉴';
    if (!acc[groupName]) {
      acc[groupName] = [];
    }
    acc[groupName].push(pmp);
    return acc;
  }, {} as GroupedMenus);

  // 레벨별 색상
  const getLevelColor = (level: number) => {
    switch (level) {
      case 1: return 'metric-gradient-ruby';
      case 2: return 'metric-gradient-sapphire';
      case 3: return 'metric-gradient-emerald';
      case 4: return 'metric-gradient-cyan';
      case 5: return 'metric-gradient-purple';
      case 6: return 'metric-gradient-amber';
      default: return 'metric-gradient-platinum';
    }
  };

  const getLevelBadgeColor = (level: number) => {
    switch (level) {
      case 1: return 'badge-premium-danger';
      case 2: return 'badge-premium-primary';
      case 3: return 'badge-premium-success';
      default: return 'badge-premium-warning';
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 space-y-3">
      {/* 헤더 - 최소화 */}
      <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-slate-900/50 border border-blue-500/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-400/30">
            <Settings className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-slate-100">메뉴 관리</h1>
            <p className="text-xs text-slate-400">{user.nickname}</p>
          </div>
        </div>
      </div>

      {/* 파트너 선택 - 컴팩트 */}
      <div className="glass-card p-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-400" />
            <span className="text-sm text-slate-200">
              {user.level === 1 ? '대본사 선택' : '파트너 선택'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {loading && <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />}
            <Badge variant="outline" className="border-blue-400/30 text-blue-300 text-xs h-5">
              <Layers className="h-3 w-3 mr-1" />
              {partners.length}개
            </Badge>
          </div>
        </div>
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-4 border border-slate-700/50 rounded-lg bg-slate-900/30">
              <RefreshCw className="h-4 w-4 animate-spin mr-2 text-blue-400" />
              <span className="text-sm text-slate-300">로딩 중...</span>
            </div>
          ) : partners.length === 0 ? (
            <div className="text-center py-6 border border-slate-700/50 rounded-lg bg-slate-900/30">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-slate-500" />
              <p className="text-sm text-slate-300 mb-2">활성화된 조직이 없습니다</p>
              <Button onClick={loadPartners} variant="outline" size="sm">
                <RefreshCw className="h-3 w-3 mr-1" />
                다시 시도
              </Button>
            </div>
          ) : (
            <Select
              value={selectedPartnerId}
              onValueChange={setSelectedPartnerId}
              disabled={loading}
            >
              <SelectTrigger className="w-full input-premium h-9 text-sm">
                <SelectValue placeholder={
                  user.level === 1 
                    ? "메뉴를 관리할 대본사를 선택하세요" 
                    : "메뉴를 관리할 파트너를 선택하세요"
                } />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                {partners
                  .sort((a, b) => {
                    // 레벨로 먼저 정렬, 같은 레벨이면 닉네임으로 정렬
                    if (a.level !== b.level) return a.level - b.level;
                    return a.nickname.localeCompare(b.nickname);
                  })
                  .map((partner) => {
                    // 레벨에 따른 들여쓰기 (시스템관리자는 제외)
                    const indentLevel = Math.max(0, partner.level - 2);
                    const indent = indentLevel > 0 ? `${indentLevel * 1.5}rem` : '0';
                    
                    return (
                      <SelectItem 
                        key={partner.id} 
                        value={partner.id}
                        className="text-slate-200 focus:bg-slate-800 py-1"
                        style={{ paddingLeft: `calc(0.5rem + ${indent})` }}
                      >
                        <div className="flex items-center gap-2">
                          {indentLevel > 0 && (
                            <span className="text-slate-600 text-xs">
                              {'└─'.repeat(1)}
                            </span>
                          )}
                          <Badge className={`${getLevelBadgeColor(partner.level)} text-xs h-4`}>
                            L{partner.level}
                          </Badge>
                          <span className="text-sm">{partner.nickname}</span>
                          <span className="text-slate-400 text-xs">({partner.username})</span>
                        </div>
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* 메뉴 권한 관리 - 스크롤 가능 영역 */}
      {selectedPartnerId && (
        <div className="glass-card flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-slate-700/50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <MenuIcon className="h-4 w-4 text-emerald-400" />
              <div>
                <h3 className="text-sm text-slate-200">
                  {selectedPartner?.nickname} 메뉴 노출 설정
                </h3>
                <p className="text-xs text-slate-400">
                  활성화된 메뉴만 사이드바에 표시
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-400/30 text-emerald-300 text-xs h-5">
                <CheckCircle className="h-3 w-3 mr-1" />
                {partnerMenuPermissions.filter(pmp => pmp.is_enabled).length}/{partnerMenuPermissions.length}
              </Badge>
              <Button
                onClick={() => loadPartnerMenuPermissions(selectedPartnerId)}
                variant="outline"
                size="sm"
                disabled={menuLoading}
                className="border-blue-400/30 hover:bg-blue-500/10 h-7 text-xs px-2"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${menuLoading ? 'animate-spin' : ''}`} />
                새로고침
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {menuLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="loading-premium mb-4"></div>
                <span className="text-sm text-slate-300">메뉴 권한을 불러오는 중...</span>
              </div>
            ) : partnerMenuPermissions.length === 0 ? (
              <div className="text-center py-8 border border-slate-700/50 rounded-lg bg-slate-900/30">
                <AlertCircle className="h-12 w-12 mx-auto mb-3 text-slate-500" />
                <p className="text-sm text-slate-300 mb-2">메뉴 데이터가 없습니다</p>
                <p className="text-xs text-slate-400 mb-3">
                  {menuPermissions.length === 0 
                    ? 'menu_permissions 테이블에 기본 메뉴 데이터가 없습니다.' 
                    : '해당 파트너에게 할당 가능한 메뉴가 없거나 데이터를 불러올 수 ���습니다.'}
                </p>
                <div className="space-y-2 mb-4">
                  <div className="text-xs text-slate-500">
                    <p>• 기본 메뉴: {menuPermissions.length}개</p>
                    <p>• 파트너 메뉴: {partnerMenuPermissions.length}개</p>
                  </div>
                  {menuPermissions.length === 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-left">
                      <p className="text-xs text-amber-300 mb-1">⚠️ 조치 필요</p>
                      <p className="text-xs text-slate-400">
                        205_menu-management-schema.sql 실행 필요
                      </p>
                    </div>
                  )}
                </div>
                <Button 
                  onClick={() => {
                    loadMenuPermissions();
                    loadPartnerMenuPermissions(selectedPartnerId);
                  }}
                  variant="outline"
                  size="sm"
                  className="btn-premium-primary"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  다시 시도
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(groupedMenus).map(([groupName, menus]) => {
                  const enabledCount = menus.filter(m => m.is_enabled).length;
                  
                  return (
                    <div key={groupName} className="glass-card border-slate-700/50">
                      {/* 그룹 헤더 - 컴팩트 */}
                      <div className="px-3 py-1.5 bg-slate-800/50 border-b border-slate-700/50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="h-3 w-3 text-blue-400" />
                          <h4 className="text-xs text-slate-200">{groupName}</h4>
                          <Badge variant="outline" className="border-slate-600/50 text-slate-400 text-[10px] h-4 px-1">
                            {menus.length}개
                          </Badge>
                        </div>
                        <Badge 
                          className={`text-[10px] h-4 px-1 ${
                            enabledCount === menus.length 
                              ? 'badge-premium-success' 
                              : enabledCount > 0 
                                ? 'badge-premium-warning'
                                : 'badge-premium-danger'
                          }`}
                        >
                          {enabledCount} / {menus.length} 활성
                        </Badge>
                      </div>

                      {/* 메뉴 리스트 - 2-3단 그리드 */}
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 p-2">
                        {menus
                          .sort((a, b) => {
                            const orderA = a.menu_permission?.display_order ?? 999;
                            const orderB = b.menu_permission?.display_order ?? 999;
                            return orderA - orderB;
                          })
                          .map((pmp) => {
                            const menu = pmp.menu_permission;
                            if (!menu) return null;
                          
                          return (
                            <div
                              key={pmp.id}
                              className={`
                                px-2 py-1.5 rounded-lg border transition-all
                                ${pmp.is_enabled 
                                  ? 'bg-emerald-500/5 border-emerald-500/30 hover:bg-emerald-500/10' 
                                  : 'bg-slate-800/20 border-slate-700/30 hover:bg-slate-800/40'
                                }
                              `}
                            >
                              {/* 메뉴 정보 */}
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  {pmp.is_enabled ? (
                                    <Eye className="h-3 w-3 text-emerald-400 flex-shrink-0 mt-0.5" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 text-slate-500 flex-shrink-0 mt-0.5" />
                                  )}
                                  
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1 mb-0.5">
                                      <span className="text-xs text-slate-200 truncate">
                                        {menu.menu_name}
                                      </span>
                                      <Badge className={`text-[8px] px-1 py-0 h-3 flex-shrink-0 ${getLevelBadgeColor(menu.partner_level)}`}>
                                        L{menu.partner_level}
                                      </Badge>
                                    </div>
                                    <p className="text-[9px] text-slate-400 truncate">
                                      {menu.menu_path}
                                    </p>
                                  </div>
                                </div>

                                {/* 스위치 */}
                                <Switch
                                  checked={pmp.is_enabled}
                                  disabled={saving}
                                  onCheckedChange={(enabled) =>
                                    updatePartnerMenuPermission(pmp, enabled)
                                  }
                                  className="flex-shrink-0 scale-75"
                                />
                              </div>

                              {/* 상태 표시 */}
                              {pmp.is_enabled && (
                                <div className="flex items-center justify-end">
                                  <Badge className="badge-premium-success text-[9px] h-3.5 px-1">
                                    활성
                                  </Badge>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 선택 안내 - 컴팩트 */}
      {!selectedPartnerId && (
        <div className="glass-card flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4 space-y-3">
            <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-400/20 inline-block">
              <Settings className="h-12 w-12 text-blue-400" />
            </div>
            <h3 className="text-lg text-slate-200">
              {user.level === 1 ? '대본사를 선택하세요' : '파트너를 선택하세요'}
            </h3>
            <p className="text-xs text-slate-400">
              위에서 {user.level === 1 ? '대본사' : '파트너'}를 선택하면 해당 조직의 메뉴 노출 설정을 관리할 수 있습니다.
            </p>
              <div className="pt-4 space-y-2 text-left">
                <div className="flex items-start gap-3 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>활성화된 메뉴만 표시</span>
                </div>
                <div className="flex items-start gap-3 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>메뉴별 활성화/비활성화 설정</span>
                </div>
                <div className="flex items-start gap-3 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>레벨에 맞는 메뉴만 선택 가능</span>
                </div>
                <div className="flex items-start gap-3 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>실시간 사이드바 반영</span>
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}