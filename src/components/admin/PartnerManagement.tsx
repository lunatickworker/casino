import { useState, useEffect } from "react";
import { Plus, Search, Filter, Download, Edit, Eye, DollarSign, Users, Building2, Shield, Key, TrendingUp, Activity, CreditCard, ArrowUpDown, Trash2, ChevronRight, ChevronDown, Send, ArrowDown } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { DataTable, Column } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogFooter as DialogFooter, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle } from "./AdminDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Label } from "../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { MetricCard } from "./MetricCard";
import { PartnerTransactions } from "./PartnerTransactions";
import { ForceTransactionModal } from "./ForceTransactionModal";

interface Partner {
  id: string;
  username: string;
  nickname: string;
  partner_type: 'system_admin' | 'head_office' | 'main_office' | 'sub_office' | 'distributor' | 'store';
  parent_id?: string;
  parent_nickname?: string;
  level: number;
  status: 'active' | 'inactive' | 'blocked';
  balance: number;
  opcode?: string;
  secret_key?: string;
  api_token?: string;
  commission_rolling: number;
  commission_losing: number;
  withdrawal_fee: number;
  bank_name?: string;
  bank_account?: string;
  bank_holder?: string;
  last_login_at?: string;
  created_at: string;
  child_count?: number;
  user_count?: number;
}

const partnerTypeTexts = {
  system_admin: '시스템관리자',
  head_office: '대본사',
  main_office: '본사', 
  sub_office: '부본사',
  distributor: '총판',
  store: '매장'
};

const partnerTypeColors = {
  system_admin: 'bg-purple-500',
  head_office: 'bg-red-500',
  main_office: 'bg-orange-500',
  sub_office: 'bg-yellow-500',
  distributor: 'bg-blue-500',
  store: 'bg-green-500'
};

const statusColors = {
  active: 'bg-green-500',
  inactive: 'bg-gray-500',
  blocked: 'bg-red-500'
};

const statusTexts = {
  active: '활성',
  inactive: '비활성',
  blocked: '차단'
};

export function PartnerManagement() {
  const { authState } = useAuth();
  const { connected, sendMessage } = useWebSocketContext();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showHierarchyView, setShowHierarchyView] = useState(false);
  const [currentTab, setCurrentTab] = useState("hierarchy");
  const [dashboardData, setDashboardData] = useState({});
  const [expandedPartners, setExpandedPartners] = useState<Set<string>>(new Set());
  const [hierarchyWarning, setHierarchyWarning] = useState<string>("");
  const [systemDefaultCommission, setSystemDefaultCommission] = useState({
    rolling: 0.5,
    losing: 5.0,
    fee: 1.0
  });
  const [showForceTransactionModal, setShowForceTransactionModal] = useState(false);
  const [forceTransactionType, setForceTransactionType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [forceTransactionTarget, setForceTransactionTarget] = useState<Partner | null>(null);
  const [parentCommission, setParentCommission] = useState<{
    rolling: number;
    losing: number;
    fee: number;
    nickname?: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    username: "",
    nickname: "",
    password: "",
    partner_type: "head_office" as Partner['partner_type'],
    parent_id: "",
    opcode: "",
    secret_key: "",
    api_token: "",
    commission_rolling: 0.5,
    commission_losing: 5.0,
    withdrawal_fee: 0
  });

  // 특정 파트너의 커미션 조회
  const loadPartnerCommissionById = async (partnerId: string) => {
    try {
      // ✅ .maybeSingle() 사용 - 0개 결과도 에러 없이 null 반환 (PGRST116 방지)
      const { data, error } = await supabase
        .from('partners')
        .select('commission_rolling, commission_losing, withdrawal_fee, partner_type, nickname')
        .eq('id', partnerId)
        .maybeSingle();

      if (error) {
        console.error('파트너 커미션 조회 오류:', error);
        return null;
      }

      if (data) {
        return {
          rolling: data.commission_rolling || 100,
          losing: data.commission_losing || 100,
          fee: data.withdrawal_fee || 100,
          nickname: data.nickname
        };
      }
      return null;
    } catch (error) {
      console.error('파트너 커미션 조회 실패:', error);
      return null;
    }
  };

  // 상위 파트너 커미션 조회 (현재 로그인 사용자)
  const loadParentCommission = async () => {
    if (!authState.user?.id) return;
    const commission = await loadPartnerCommissionById(authState.user.id);
    if (commission) {
      setParentCommission(commission);
    }
  };

  // 시스템 기본 커미션 값 로드
  const loadSystemDefaultCommission = async () => {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['default_rolling_commission', 'default_losing_commission', 'default_withdrawal_fee']);

      if (error) {
        console.error('시스템 기본 커미션 로드 오류:', error);
        return;
      }

      if (data && data.length > 0) {
        const defaults = {
          rolling: 0.5,
          losing: 5.0,
          fee: 1.0
        };

        data.forEach(setting => {
          if (setting.setting_key === 'default_rolling_commission') {
            defaults.rolling = parseFloat(setting.setting_value) || 0.5;
          } else if (setting.setting_key === 'default_losing_commission') {
            defaults.losing = parseFloat(setting.setting_value) || 5.0;
          } else if (setting.setting_key === 'default_withdrawal_fee') {
            defaults.fee = parseFloat(setting.setting_value) || 1.0;
          }
        });

        setSystemDefaultCommission(defaults);
        
        // 폼 데이터에도 기본값 적용
        setFormData(prev => ({
          ...prev,
          commission_rolling: defaults.rolling,
          commission_losing: defaults.losing,
          withdrawal_fee: defaults.fee
        }));
      }
    } catch (error) {
      console.error('시스템 기본 커미션 로드 실패:', error);
    }
  };

  // ✅ 초기 로드 및 Realtime 구독
  useEffect(() => {
    if (authState.user?.id) {
      loadSystemDefaultCommission();
      loadParentCommission();
      fetchPartners();
      fetchDashboardData();
    }
  }, [authState.user?.id]);

  useEffect(() => {
    if (!authState.user?.id) return;

    console.log('✅ Realtime 구독: partners.balance 변경 감지');

    const channel = supabase
      .channel('partner_balance_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'partners',
        },
        (payload) => {
          const oldBalance = (payload.old as any).balance;
          const newBalance = (payload.new as any).balance;
          
          if (oldBalance !== newBalance) {
            console.log(`💰 보유금 변경: ${oldBalance} → ${newBalance}`);
            setPartners(prev => prev.map(p => 
              p.id === (payload.new as any).id ? { ...p, balance: newBalance } : p
            ));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authState.user?.id]);

  // 파트너 목록 조회
  const fetchPartners = async () => {
    try {
      setLoading(true);
      
      // ✅ 디버깅: 현재 로그인 사용자 정보 확인
      console.log('🔍 [파트너 조회] authState.user:', {
        id: authState.user?.id,
        username: authState.user?.username,
        level: authState.user?.level,
        partner_type: authState.user?.partner_type
      });

      // ✅ 로그인 확인
      if (!authState.user?.id) {
        console.error('❌ [파트너 조회] 로그인된 사용자가 없습니다');
        toast.error('로그인 정보가 없습니다. 다시 로그인해주세요.');
        setPartners([]);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('partners')
        .select(`
          *,
          parent:parent_id (
            nickname
          )
        `)
        .order('level', { ascending: true })
        .order('created_at', { ascending: false });

      // 권한별 필터링
      const isSystemAdmin = authState.user.level === 1;
      console.log(`🔍 [파트너 조회] 시스템 관리자 여부: ${isSystemAdmin}`);

      const { data, error } = isSystemAdmin
        ? await query  // 시스템관리자: 모든 파트너
        : await supabase.rpc('get_hierarchical_partners', { p_partner_id: authState.user.id });  // 하위 모든 파트너

      console.log('📊 [파트너 조회] 결과:', {
        데이터개수: data?.length || 0,
        에러: error?.message || 'null'
      });

      if (error) throw error;

      // 하위 파트너와 사용자 수 집계 + 보유금 실시간 표시
      const partnersWithCounts = await Promise.all(
        (data || []).map(async (partner) => {
          // 하위 파트너 수 조회
          const { count: childCount } = await supabase
            .from('partners')
            .select('*', { count: 'exact' })
            .eq('parent_id', partner.id);

          // 관리하는 사용자 수 조회
          const { count: userCount } = await supabase
            .from('users')
            .select('*', { count: 'exact' })
            .eq('referrer_id', partner.id);

          // ✅ 보유금은 DB balance 사용 (내부 시스템 계산값)
          // - 대본사: useBalanceSync가 API /info 결과로 업데이트
          // - 하위 파트너: 입출금/정산으로 업데이트
          const currentBalance = partner.balance || 0;

          return {
            ...partner,
            parent_nickname: partner.parent?.nickname || '-',
            child_count: childCount || 0,
            user_count: userCount || 0,
            balance: currentBalance
          };
        })
      );

      setPartners(partnersWithCounts);
    } catch (error) {
      console.error('파트너 목록 조회 오류:', error);
      toast.error('파트너 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 커미션 검증
  const validateCommission = (
    rolling: number,
    losing: number,
    fee: number,
    partnerType: Partner['partner_type']
  ): boolean => {
    // 대본사는 항상 100%
    if (partnerType === 'head_office') {
      if (rolling !== 100 || losing !== 100 || fee !== 100) {
        toast.error('대본사의 커미션은 100%로 고정됩니다.');
        return false;
      }
      return true;
    }

    // 하위 파트너는 상위 파트너 커미션을 초과할 수 없음
    if (parentCommission) {
      if (rolling > parentCommission.rolling) {
        toast.error(`롤링 커미션은 상위 파트너(${parentCommission.rolling}%)를 초과할 수 없습니다.`);
        return false;
      }
      if (losing > parentCommission.losing) {
        toast.error(`루징 커미션은 상위 파트너(${parentCommission.losing}%)를 초과할 수 없습니다.`);
        return false;
      }
      if (fee > parentCommission.fee) {
        toast.error(`환전 수수료는 상위 파트너(${parentCommission.fee}%)를 초과할 수 없습니다.`);
        return false;
      }
    }

    return true;
  };

  // 파트너 생성
  const createPartner = async () => {
    try {
      setLoading(true);

      // 필수 필드 검증
      if (!formData.username.trim()) {
        toast.error('아이디를 입력해주세요.');
        return;
      }
      if (!formData.nickname.trim()) {
        toast.error('닉네임을 입력해주세요.');
        return;
      }
      if (!formData.password.trim()) {
        toast.error('비밀번호를 입력해주세요.');
        return;
      }

      // 권한 검증
      if (!canCreatePartner(formData.partner_type)) {
        toast.error('해당 등급의 파트너를 생성할 권한이 없습니다.');
        return;
      }

      // 계층 구조 검증 (시스템관리자 제외)
      if (authState.user?.level !== 1) {
        const hierarchyCheck = await checkHierarchyGap(formData.partner_type);
        
        if (hierarchyCheck.hasGap) {
          toast.error(hierarchyCheck.message, { duration: 5000 });
          return;
        }

        // 직접 상위 파트너 ID가 없으면 에러
        if (!hierarchyCheck.directParentId) {
          toast.error(`${partnerTypeTexts[formData.partner_type]}의 상위 조직을 찾을 수 없습니다.`);
          return;
        }
      }

      // 대본사는 커미션 100% 강제 설정
      let rollingCommission = formData.commission_rolling;
      let losingCommission = formData.commission_losing;
      let withdrawalFee = formData.withdrawal_fee;

      if (formData.partner_type === 'head_office') {
        rollingCommission = 100;
        losingCommission = 100;
        withdrawalFee = 100;
      }

      // 커미션 검증
      if (!validateCommission(rollingCommission, losingCommission, withdrawalFee, formData.partner_type)) {
        return;
      }

      // 레벨 계산
      const level = getPartnerLevel(formData.partner_type);
      
      // parent_id 결정: 직접 상위 파트너 찾기
      let parentId = authState.user?.id || null;
      
      if (authState.user?.level !== 1) {
        const hierarchyCheck = await checkHierarchyGap(formData.partner_type);
        if (hierarchyCheck.directParentId) {
          parentId = hierarchyCheck.directParentId;
        }
      }
      
      // ✅ 비밀번호 해시 처리 (PostgreSQL crypt 함수 사용)
      // RPC 함수로 해시 생성
      const { data: hashedPassword, error: hashError } = await supabase
        .rpc('hash_password', { password: formData.password });

      if (hashError) {
        console.error('❌ 비밀번호 해시 오류:', hashError);
        toast.error('비밀번호 처리 중 오류가 발생했습니다.');
        return;
      }

      // ✅ 외부 API 호출 먼저 (POST /api/account) - 계정 생성
      let apiOpcode = '';
      let apiSecretKey = '';
      let apiToken = '';

      // 대본사 생성 시: formData에서 직접 사용
      if (formData.partner_type === 'head_office') {
        apiOpcode = formData.opcode;
        apiSecretKey = formData.secret_key;
        apiToken = formData.api_token;
        console.log('🔑 [대본사 생성] formData의 opcode/token 사용:', apiOpcode);
      } 
      // 하위 파트너 생성 시: 상위로 재귀하여 opcode/secret_key/api_token 조회
      else {
        console.log('🔍 [하위 파트너 생성] 상위 파트너에서 API 설정 조회 시작');
        
        let currentParentId = parentId;
        let depth = 0;
        const maxDepth = 10;

        while (currentParentId && depth < maxDepth) {
          const { data: parentData, error: parentError } = await supabase
            .from('partners')
            .select('opcode, secret_key, api_token, parent_id, partner_type, nickname')
            .eq('id', currentParentId)
            .single();

          if (parentError) {
            console.error('❌ 상위 파트너 조회 오류:', parentError);
            throw new Error('상위 파트너 조회 실패');
          }

          console.log(`  📊 Depth ${depth}: ${parentData.partner_type} (${parentData.nickname})`);

          if (parentData.opcode && parentData.secret_key && parentData.api_token) {
            apiOpcode = parentData.opcode;
            apiSecretKey = parentData.secret_key;
            apiToken = parentData.api_token;
            console.log(`✅ API 설정 발견: ${parentData.partner_type}에서 조회 완료 (영구 사용)`);
            break;
          }

          currentParentId = parentData.parent_id;
          depth++;
        }

        if (!apiOpcode || !apiSecretKey || !apiToken) {
          toast.error('상위 파트너에서 API 설정(opcode/secret_key/token)을 찾을 수 없습니다.');
          return;
        }
      }

      // API username: btn_ prefix 제거
      const apiUsername = formData.username.replace(/^btn_/, '');

      console.log('📡 [POST /api/account] 외부 API 계정 생성 호출:', {
        opcode: apiOpcode,
        username: apiUsername,
        partner_type: formData.partner_type
      });

      const { createAccount } = await import('../../lib/investApi');
      const apiResult = await createAccount(apiOpcode, apiUsername, apiSecretKey);

      console.log('📊 [POST /api/account] API 응답:', apiResult);

      // API 실패 시 에러 처리 (DB 생성 안 함)
      if (apiResult.error) {
        console.error('❌ 외부 API 계정 생성 실패:', apiResult.error);
        toast.error(`파트너 생성 실패: ${apiResult.error}`);
        return;
      }

      console.log('✅ 외부 API 계정 생성 성공');

      // ✅ API 성공 후 내부 DB 생성
      const insertData: any = {
        username: formData.username,
        nickname: formData.nickname,
        password_hash: hashedPassword,
        partner_type: formData.partner_type,
        level,
        parent_id: parentId,
        commission_rolling: rollingCommission,
        commission_losing: losingCommission,
        withdrawal_fee: withdrawalFee,
        status: 'active'
      };

      console.log('📝 파트너 생성 데이터:', {
        username: insertData.username,
        partner_type: insertData.partner_type,
        level: insertData.level,
        parent_id: insertData.parent_id,
        current_user: authState.user?.username,
        current_user_level: authState.user?.level
      });

      // ✅ 모든 파트너에 opcode/secret_key/api_token 저장 (영구 사용)
      // 대본사: formData에서 직접 / 하위 파트너: 상위에서 조회한 값 사용
      insertData.opcode = apiOpcode;
      insertData.secret_key = apiSecretKey;
      insertData.api_token = apiToken;

      console.log('💾 [DB 저장] API 설정 저장:', {
        has_opcode: !!apiOpcode,
        has_secret_key: !!apiSecretKey,
        has_api_token: !!apiToken,
        partner_type: formData.partner_type
      });

      const { data, error } = await supabase
        .from('partners')
        .insert([insertData])
        .select()
        .single();

      if (error) {
        console.error('❌ 파트너 생성 DB 오류:', error);
        toast.error('파트너 생성 중 데이터베이스 오류가 발생했습니다.');
        return;
      }

      console.log('✅ 파트너 생성 성공:', {
        id: data.id,
        username: data.username,
        partner_type: data.partner_type,
        level: data.level,
        parent_id: data.parent_id
      });

      toast.success('파트너가 성공적으로 생성되었습니다.');
      setShowCreateDialog(false);
      resetFormData();
      
      // 실시간 업데이트
      if (connected && sendMessage) {
        sendMessage({
          type: 'partner_created',
          data: { partner: data }
        });
      }

      fetchPartners();
    } catch (error) {
      console.error('파트너 생성 오류:', error);
      toast.error('파트너 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 파트너 수정
  const updatePartner = async () => {
    if (!selectedPartner) return;

    try {
      setLoading(true);

      // 커미션 검증
      if (!validateCommission(
        formData.commission_rolling,
        formData.commission_losing,
        formData.withdrawal_fee,
        selectedPartner.partner_type
      )) {
        return;
      }

      const updateData: any = {
        nickname: formData.nickname,
        commission_rolling: formData.commission_rolling,
        commission_losing: formData.commission_losing,
        withdrawal_fee: formData.withdrawal_fee,
        updated_at: new Date().toISOString()
      };

      // 비밀번호가 입력된 경우에만 업데이트 (실제로는 bcrypt 해시 필요)
      if (formData.password && formData.password.trim() !== '') {
        updateData.password_hash = formData.password;
      }

      // 대본사인 경우 OPCODE 정보도 업데이트
      if (selectedPartner.partner_type === 'head_office') {
        updateData.opcode = formData.opcode;
        updateData.secret_key = formData.secret_key;
        updateData.api_token = formData.api_token;
      }

      const { error } = await supabase
        .from('partners')
        .update(updateData)
        .eq('id', selectedPartner.id);

      if (error) throw error;

      toast.success('파트너 정보가 수정되었습니다.');
      setShowEditDialog(false);
      setSelectedPartner(null);
      
      // 실시간 업데이트
      if (connected && sendMessage) {
        sendMessage({
          type: 'partner_updated',
          data: { partnerId: selectedPartner.id, updates: updateData }
        });
      }

      fetchPartners();
    } catch (error) {
      console.error('파트너 수정 오류:', error);
      toast.error('파트너 수정에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 파트너 삭제
  const deletePartner = async () => {
    if (!partnerToDelete) return;
    
    // 삭제 확인 텍스트 검증
    if (deleteConfirmText !== partnerToDelete.username) {
      toast.error('삭제 확인을 위해 파트너 아이디를 정확히 입력해주세요.');
      return;
    }

    try {
      setDeleteLoading(true);

      // 1. 하위 파트너 존재 여부 확인
      const { count: childCount } = await supabase
        .from('partners')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', partnerToDelete.id);

      if (childCount && childCount > 0) {
        toast.error(`하위 파트너가 ${childCount}명 존재하여 삭제할 수 없습니다. 하위 파트너를 먼저 삭제해주세요.`);
        return;
      }

      // 2. 관리 중인 사용자 존재 여부 확인
      const { count: userCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', partnerToDelete.id);

      if (userCount && userCount > 0) {
        toast.error(`관리 중인 회원이 ${userCount}명 존재하여 삭제할 수 없습니다. 회원을 먼저 다른 파트너로 이동하거나 삭제해주세요.`);
        return;
      }

      // 3. 파트너 삭제
      const { error } = await supabase
        .from('partners')
        .delete()
        .eq('id', partnerToDelete.id);

      if (error) throw error;

      toast.success(`${partnerToDelete.nickname} 파트너가 삭제되었습니다.`, {
        duration: 3000,
        icon: '🗑️'
      });

      // 실시간 업데이트
      if (connected && sendMessage) {
        sendMessage({
          type: 'partner_deleted',
          data: { partnerId: partnerToDelete.id }
        });
      }

      // 다이얼로그 닫기 및 목록 새로고침
      setShowDeleteDialog(false);
      setPartnerToDelete(null);
      setDeleteConfirmText("");
      fetchPartners();

    } catch (error) {
      console.error('파트너 삭제 오류:', error);
      toast.error('파트너 삭제에 실패했습니다.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 강제 입출금 핸들러 (ForceTransactionModal 사용)
  const handleForceTransaction = async (data: {
    targetId: string;
    type: 'deposit' | 'withdrawal';
    amount: number;
    memo: string;
  }) => {
    if (!authState.user?.id) return;

    try {
      console.log('💰 [파트너 강제 입출금] 시작:', data);

      // 1. 대상 파트너 정보 조회
      const { data: targetPartner, error: targetError } = await supabase
        .from('partners')
        .select('*')
        .eq('id', data.targetId)
        .single();

      if (targetError || !targetPartner) {
        toast.error('파트너 정보를 찾을 수 없습니다.');
        return;
      }

      // 2. 관리자 정보 조회
      const { data: adminPartner, error: adminError } = await supabase
        .from('partners')
        .select('balance, level, nickname, partner_type')
        .eq('id', authState.user.id)
        .single();

      if (adminError || !adminPartner) {
        toast.error('관리자 정보를 찾을 수 없습니다.');
        return;
      }

      const isSystemAdmin = adminPartner.level === 1;

      // 3. 출금 시 대상 파트너 보유금 검증
      if (data.type === 'withdrawal' && targetPartner.balance < data.amount) {
        toast.error(`파트너의 보유금이 부족합니다. (현재: ${targetPartner.balance.toLocaleString()}원)`);
        return;
      }

      // 4. 입금 시 관리자 보유금 검증 (시스템관리자는 제외)
      if (data.type === 'deposit' && !isSystemAdmin && adminPartner.balance < data.amount) {
        toast.error(`관리자 보유금이 부족합니다. (현재: ${adminPartner.balance.toLocaleString()}원)`);
        return;
      }

      // 5. API 설정 조회
      const { getAdminOpcode, isMultipleOpcode } = await import('../../lib/opcodeHelper');
      
      let opcode: string;
      let secretKey: string;
      let apiToken: string;
      let apiUsername: string;

      try {
        const opcodeInfo = await getAdminOpcode(targetPartner);
        
        if (isMultipleOpcode(opcodeInfo)) {
          if (opcodeInfo.opcodes.length === 0) {
            throw new Error('사용 가능한 OPCODE가 없습니다.');
          }
          opcode = opcodeInfo.opcodes[0].opcode;
          secretKey = opcodeInfo.opcodes[0].secretKey;
          apiToken = opcodeInfo.opcodes[0].token;
          const { data: firstPartner } = await supabase
            .from('partners')
            .select('username')
            .eq('id', opcodeInfo.opcodes[0].partnerId)
            .single();
          apiUsername = firstPartner?.username?.replace(/^btn_/, '') || '';
        } else {
          opcode = opcodeInfo.opcode;
          secretKey = opcodeInfo.secretKey;
          apiToken = opcodeInfo.token;
          apiUsername = targetPartner.username.replace(/^btn_/, '');
        }
      } catch (err: any) {
        toast.error(`API 설정 조회 실패: ${err.message}`);
        return;
      }

      console.log('📡 [파트너 강제 입출금] API 호출:', {
        type: data.type,
        amount: data.amount,
        apiUsername,
        opcode
      });

      // 6. 외부 API 호출 (Guidelines 1.4, 1.5)
      const { depositToAccount, withdrawFromAccount } = await import('../../lib/investApi');
      
      let apiResult;
      try {
        if (data.type === 'deposit') {
          apiResult = await depositToAccount(opcode, apiUsername, apiToken, data.amount, secretKey);
        } else {
          apiResult = await withdrawFromAccount(opcode, apiUsername, apiToken, data.amount, secretKey);
        }
      } catch (err: any) {
        toast.error(`API 호출 실패: ${err.message}`);
        return;
      }

      console.log('📊 [파트너 강제 입출금] API 응답:', apiResult);

      // 7. API 응답 검증
      if (apiResult.error) {
        toast.error(`외부 API 오류: ${apiResult.error}`);
        return;
      }

      if (apiResult.data) {
        const responseData = apiResult.data;
        
        if (responseData.RESULT === false) {
          const errorMsg = responseData.DATA?.message || responseData.message || '외부 API 처리 실패';
          toast.error(`외부 API 오류: ${errorMsg}`);
          return;
        }

        if (responseData.is_text && responseData.text_response) {
          const text = responseData.text_response.toLowerCase();
          if (text.includes('error') || text.includes('실패') || text.includes('초과')) {
            toast.error(`외부 API 오류: ${responseData.text_response}`);
            return;
          }
        }
      }

      toast.success(`외부 계정에 ${data.amount.toLocaleString()}원을 ${data.type === 'deposit' ? '입금' : '출금'}했습니다.`);

      // 8. 내부 DB 업데이트
      let adminNewBalance = adminPartner.balance;
      let targetNewBalance = targetPartner.balance;

      if (data.type === 'deposit') {
        // 입금: 관리자 차감, 파트너 증가 (level 1도 보유금 업데이트)
        adminNewBalance = adminPartner.balance - data.amount;
        await supabase
          .from('partners')
          .update({ balance: adminNewBalance, updated_at: new Date().toISOString() })
          .eq('id', authState.user.id);

        targetNewBalance = targetPartner.balance + data.amount;
        await supabase
          .from('partners')
          .update({ balance: targetNewBalance, updated_at: new Date().toISOString() })
          .eq('id', data.targetId);

        // 로그 기록 (level 1 포함)
        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: authState.user.id,
            balance_before: adminPartner.balance,
            balance_after: adminNewBalance,
            amount: -data.amount,
            transaction_type: 'withdrawal',
            from_partner_id: authState.user.id,
            to_partner_id: data.targetId,
            processed_by: authState.user.id,
            memo: `[강제입금] ${targetPartner.nickname}에게 ${data.amount.toLocaleString()}원 입금${data.memo ? `: ${data.memo}` : ''}`
          });

        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: data.targetId,
            balance_before: targetPartner.balance,
            balance_after: targetNewBalance,
            amount: data.amount,
            transaction_type: 'deposit',
            from_partner_id: authState.user.id,
            to_partner_id: data.targetId,
            processed_by: authState.user.id,
            memo: `[강제입금] ${adminPartner.nickname}으로부터 ${data.amount.toLocaleString()}원 입금${data.memo ? `: ${data.memo}` : ''}`
          });

      } else {
        // 출금: 파트너 차감, 관리자 증가 (level 1도 보유금 업데이트)
        targetNewBalance = targetPartner.balance - data.amount;
        await supabase
          .from('partners')
          .update({ balance: targetNewBalance, updated_at: new Date().toISOString() })
          .eq('id', data.targetId);

        adminNewBalance = adminPartner.balance + data.amount;
        await supabase
          .from('partners')
          .update({ balance: adminNewBalance, updated_at: new Date().toISOString() })
          .eq('id', authState.user.id);

        // 로그 기록 (level 1 포함)
        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: data.targetId,
            balance_before: targetPartner.balance,
            balance_after: targetNewBalance,
            amount: -data.amount,
            transaction_type: 'withdrawal',
            from_partner_id: data.targetId,
            to_partner_id: authState.user.id,
            processed_by: authState.user.id,
            memo: `[강제출금] ${adminPartner.nickname}에게 ${data.amount.toLocaleString()}원 출금${data.memo ? `: ${data.memo}` : ''}`
          });

        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: authState.user.id,
            balance_before: adminPartner.balance,
            balance_after: adminNewBalance,
            amount: data.amount,
            transaction_type: 'deposit',
            from_partner_id: data.targetId,
            to_partner_id: authState.user.id,
            processed_by: authState.user.id,
            memo: `[강제출금] ${targetPartner.nickname}으로부터 ${data.amount.toLocaleString()}원 회수${data.memo ? `: ${data.memo}` : ''}`
          });
      }

      toast.success(`${targetPartner.nickname}에게 ${data.amount.toLocaleString()}원을 ${data.type === 'deposit' ? '입금' : '출금'}했습니다.`);

      // 9. 실시간 업데이트
      if (connected && sendMessage) {
        sendMessage({
          type: 'partner_balance_updated',
          data: {
            partnerId: data.targetId,
            amount: data.amount,
            type: data.type
          }
        });
      }

      // 10. 목록 새로고침
      fetchPartners();

    } catch (error: any) {
      console.error('❌ [파트너 강제 입출금] 오류:', error);
      toast.error(`${data.type === 'deposit' ? '입금' : '출금'} 처리 중 오류가 발생했습니다.`);
    }
  };

  // 하위 파트너에게 보유금 지급/회수
  const transferBalanceToPartner = async () => {
    if (!transferTargetPartner || !authState.user?.id) return;

    try {
      setTransferLoading(true);

      const amount = parseFloat(transferAmount);

      // 입력 검증
      if (!amount || amount <= 0) {
        toast.error(`${transferMode === 'deposit' ? '지급' : '회수'} 금액을 올바르게 입력해주세요.`);
        return;
      }

      // 1. 현재 관리자의 보유금 조회
      const { data: currentPartnerData, error: fetchError } = await supabase
        .from('partners')
        .select('balance, nickname, partner_type, level, opcode, secret_key, api_token')
        .eq('id', authState.user.id)
        .single();

      if (fetchError) throw fetchError;

      const isSystemAdmin = currentPartnerData.level === 1;
      const isHeadOffice = transferTargetPartner.partner_type === 'head_office';

      // 회수 모드인 경우: 대상 파트너의 보유금 검증
      if (transferMode === 'withdrawal') {
        const { data: targetBalanceData, error: targetBalanceError } = await supabase
          .from('partners')
          .select('balance')
          .eq('id', transferTargetPartner.id)
          .single();

        if (targetBalanceError) throw targetBalanceError;

        if (targetBalanceData.balance < amount) {
          toast.error(`회수 대상 파트너의 보유금이 부족합니다. (현재 보유금: ${targetBalanceData.balance.toLocaleString()}원)`);
          return;
        }
      }

      // 2. 지급 모드: 시스템관리자가 아닌 경우 보유금 검증
      if (transferMode === 'deposit' && !isSystemAdmin && currentPartnerData.balance < amount) {
        toast.error(`보유금이 부족합니다. (현재 보유금: ${currentPartnerData.balance.toLocaleString()}원)`);
        return;
      }

      // 2-1. 대본사가 본사에게 지급할 때: 하위 본사들의 보유금 합계가 대본사 보유금을 초과할 수 없음
      if (transferMode === 'deposit' && currentPartnerData.level === 2 && transferTargetPartner.partner_type === 'main_office') {
        // 현재 대본사 아래의 모든 본사(main_office) 보유금 합계 조회
        const { data: childMainOffices, error: childError } = await supabase
          .from('partners')
          .select('balance')
          .eq('parent_id', authState.user.id)
          .eq('partner_type', 'main_office');

        if (childError) {
          console.error('하위 본사 조회 오류:', childError);
          throw childError;
        }

        const currentChildBalanceSum = (childMainOffices || []).reduce((sum, office) => sum + (office.balance || 0), 0);
        const afterTransferChildBalanceSum = currentChildBalanceSum + amount;

        console.log('💰 [대본사→본사 지급 검증]', {
          대본사_보유금: currentPartnerData.balance,
          현재_하위본사_보유금합계: currentChildBalanceSum,
          지급액: amount,
          지급후_하위본사_보유금합계: afterTransferChildBalanceSum,
          초과여부: afterTransferChildBalanceSum > currentPartnerData.balance
        });

        if (afterTransferChildBalanceSum > currentPartnerData.balance) {
          toast.error(
            `하위 본사들의 보유금 합계가 대본사 보유금을 초과할 수 없습니다.\n` +
            `현재 하위 본사 보유금 합계: ${currentChildBalanceSum.toLocaleString()}원\n` +
            `지급 후 합계: ${afterTransferChildBalanceSum.toLocaleString()}원\n` +
            `대본사 보유금: ${currentPartnerData.balance.toLocaleString()}원`,
            { duration: 5000 }
          );
          return;
        }
      }

      // 3. 외부 API 호출 (수신자의 상위 대본사 opcode 사용)
      // ⚠️ API 실패 시 전체 트랜잭션 중단 (DB 업데이트 안 함)
      let apiUpdatedBalance: number | null = null;
      
      // 수신자의 상위 대본사 opcode 조회
      const { getAdminOpcode, isMultipleOpcode } = await import('../../lib/opcodeHelper');
      
      // 수신자 전체 정보 조회
      const { data: targetPartnerFull, error: targetError } = await supabase
        .from('partners')
        .select('*')
        .eq('id', transferTargetPartner.id)
        .single();

      if (targetError) {
        toast.error(`파트너 정보 조회 실패: ${targetError.message}`);
        return;
      }

      console.log('🔍 [파트너 입출금] 상위 대본사 opcode 조회 시작:', {
        partner_id: transferTargetPartner.id,
        partner_type: transferTargetPartner.partner_type,
        partner_nickname: transferTargetPartner.nickname
      });

      let opcode: string;
      let secretKey: string;
      let apiToken: string;
      let apiUsername: string;

      try {
        const opcodeInfo = await getAdminOpcode(targetPartnerFull);
        
        // 시스템 관리자인 경우 첫 번째 opcode 사용
        if (isMultipleOpcode(opcodeInfo)) {
          if (opcodeInfo.opcodes.length === 0) {
            throw new Error('사용 가능한 OPCODE가 없습니다. 시스템 관리자에게 문의하세요.');
          }
          opcode = opcodeInfo.opcodes[0].opcode;
          secretKey = opcodeInfo.opcodes[0].secretKey;
          apiToken = opcodeInfo.opcodes[0].token;
          // 시스템 관리자는 첫 번째 opcode의 username 사용
          const { data: firstPartner } = await supabase
            .from('partners')
            .select('username')
            .eq('id', opcodeInfo.opcodes[0].partnerId)
            .single();
          apiUsername = firstPartner?.username?.replace(/^btn_/, '') || '';
        } else {
          opcode = opcodeInfo.opcode;
          secretKey = opcodeInfo.secretKey;
          apiToken = opcodeInfo.token;
          // API 호출용 username (btn_ prefix 제거)
          apiUsername = targetPartnerFull.username.replace(/^btn_/, '');
        }
      } catch (err: any) {
        const errorMsg = `상위 대본사 API 설정 조회 실패: ${err.message}`;
        console.error('❌ [파트너 입출금]', errorMsg);
        toast.error(errorMsg, { 
          duration: 5000,
          description: 'API 설정을 확인하세요. DB는 업데이트되지 않았습니다.'
        });
        return;
      }

      console.log('💰 [파트너 입출금] 외부 API 호출 시작:', {
        partner_type: transferTargetPartner.partner_type,
        partner_nickname: transferTargetPartner.nickname,
        transfer_mode: transferMode,
        amount,
        opcode: opcode,
        apiUsername: apiUsername
      });

      // 외부 API 호출
      const { depositToAccount, withdrawFromAccount } = await import('../../lib/investApi');
      
      let apiResult;
      try {
        if (transferMode === 'deposit') {
          // 입금
          apiResult = await depositToAccount(
            opcode,
            apiUsername,
            apiToken,
            amount,
            secretKey
          );
        } else {
          // 출금
          apiResult = await withdrawFromAccount(
            opcode,
            apiUsername,
            apiToken,
            amount,
            secretKey
          );
        }
      } catch (err: any) {
        const errorMsg = `외부 API 호출 실패: ${err.message}`;
        console.error('❌ [파트너 입출금]', errorMsg);
        toast.error(errorMsg, {
          duration: 7000,
          description: '네트워크 오류 또는 API 서버 문제입니다. 잠시 후 다시 시도하세요. DB는 업데이트되지 않았습니다.'
        });
        return;
      }

      console.log('📡 [파트너 입출금] API 응답:', apiResult);

      // API 응답 에러 체크
      if (apiResult.error) {
        const errorMsg = `외부 API 오류: ${apiResult.error}`;
        console.error('❌ [파트너 입출금]', errorMsg);
        toast.error(errorMsg, {
          duration: 7000,
          description: 'API 서버에서 오류가 발생했습니다. 시스템 관리자에게 문의하세요. DB는 업데이트되지 않았습니다.'
        });
        return;
      }

      // data 내부의 에러 메시지 확인
      if (apiResult.data) {
        const responseData = apiResult.data;
        
        // RESULT === false인 경우
        if (responseData.RESULT === false) {
          const errorMsg = responseData.DATA?.message || responseData.message || '외부 API 처리 실패';
          console.error('❌ [파트너 입출금] API 응답 에러:', errorMsg);
          toast.error(`외부 API 오류: ${errorMsg}`, {
            duration: 7000,
            description: '외부 시스템에서 요청을 거부했습니다. 잔액 또는 계정 상태를 확인하세요. DB는 업데이트되지 않았습니다.'
          });
          return;
        }
        
        // 텍스트 응답에서 에러 확인
        if (responseData.is_text && responseData.text_response) {
          const text = responseData.text_response.toLowerCase();
          if (text.includes('error') || text.includes('실패') || text.includes('초과')) {
            console.error('❌ [파트너 입출금] API 텍스트 응답 에러:', responseData.text_response);
            toast.error(`외부 API 오류: ${responseData.text_response}`, {
              duration: 7000,
              description: 'DB는 업데이트되지 않았습니다.'
            });
            return;
          }
        }

          // API 응답��서 실제 잔고 추출
          const { extractBalanceFromResponse } = await import('../../lib/investApi');
          apiUpdatedBalance = extractBalanceFromResponse(responseData, apiUsername);
          console.log('✅ [파트너 입출금] API 성공, 새로운 잔고:', apiUpdatedBalance);
        }

      toast.success(`외부 계정에 ${amount.toLocaleString()}원을 ${transferMode === 'deposit' ? '입금' : '출금'}했습니다.`, {
        duration: 3000,
        icon: '💰'
      });

      // 4. 내부 DB 처리
      let senderNewBalance = currentPartnerData.balance;
      let receiverNewBalance = transferTargetPartner.balance;

      if (transferMode === 'deposit') {
        // 지급: 송금자 차감, 수신자 증가
        if (!isSystemAdmin) {
          senderNewBalance = currentPartnerData.balance - amount;
          const { error: deductError } = await supabase
            .from('partners')
            .update({ 
              balance: senderNewBalance,
              updated_at: new Date().toISOString()
            })
            .eq('id', authState.user.id);

          if (deductError) throw deductError;
        }

        // 수신자 보유금 증가
        // API 응답이 있으면 API 응답 값 사용, 없으면 계산값 사용
        const { data: targetPartnerData, error: targetFetchError } = await supabase
          .from('partners')
          .select('balance')
          .eq('id', transferTargetPartner.id)
          .single();

        if (targetFetchError) throw targetFetchError;
        
        if (apiUpdatedBalance !== null && !isNaN(apiUpdatedBalance)) {
          // 외부 API 응답 값 사용
          receiverNewBalance = apiUpdatedBalance;
          console.log('📊 [DB 업데이트] API 응답 잔고 사용:', receiverNewBalance);
        } else {
          // 계산 값 사용
          receiverNewBalance = targetPartnerData.balance + amount;
          console.log('📊 [DB 업데이트] 계산 잔고 사용:', receiverNewBalance);
        }

        const { error: increaseError } = await supabase
          .from('partners')
          .update({ 
            balance: receiverNewBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', transferTargetPartner.id);

        if (increaseError) throw increaseError;

        // 송금자 로그 기록
        if (!isSystemAdmin) {
          await supabase
            .from('partner_balance_logs')
            .insert({
              partner_id: authState.user.id,
              balance_before: currentPartnerData.balance,
              balance_after: senderNewBalance,
              amount: -amount,
              transaction_type: 'withdrawal',
              from_partner_id: authState.user.id,
              to_partner_id: transferTargetPartner.id,
              processed_by: authState.user.id,
              memo: `[파트너 지급] ${transferTargetPartner.nickname}에게 보유금 지급${transferMemo ? `: ${transferMemo}` : ''}`
            });
        }

        // 수신자 로그 기록
        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: transferTargetPartner.id,
            balance_before: transferTargetPartner.balance,
            balance_after: receiverNewBalance,
            amount: amount,
            transaction_type: 'deposit',
            from_partner_id: isSystemAdmin ? null : authState.user.id,
            to_partner_id: transferTargetPartner.id,
            processed_by: authState.user.id,
            memo: `[파트너 수신] ${currentPartnerData.nickname}으로부터 보유금 수신${transferMemo ? `: ${transferMemo}` : ''}`
          });

      } else {
        // 회수: 수신자 차감, 송금자 증가
        const { data: targetPartnerData, error: targetFetchError } = await supabase
          .from('partners')
          .select('balance')
          .eq('id', transferTargetPartner.id)
          .single();

        if (targetFetchError) throw targetFetchError;
        
        if (apiUpdatedBalance !== null && !isNaN(apiUpdatedBalance)) {
          // 외부 API 응답 값 사용
          receiverNewBalance = apiUpdatedBalance;
          console.log('📊 [DB 업데이트] API 응답 잔고 사용:', receiverNewBalance);
        } else {
          // 계산 값 사용
          receiverNewBalance = targetPartnerData.balance - amount;
          console.log('📊 [DB 업데이트] 계산 잔고 사용:', receiverNewBalance);
        }

        const { error: decreaseError } = await supabase
          .from('partners')
          .update({ 
            balance: receiverNewBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', transferTargetPartner.id);

        if (decreaseError) throw decreaseError;

        // 송금자 보유금 증가 (시스템관리자가 아닌 경우)
        if (!isSystemAdmin) {
          senderNewBalance = currentPartnerData.balance + amount;
          const { error: increaseError } = await supabase
            .from('partners')
            .update({ 
              balance: senderNewBalance,
              updated_at: new Date().toISOString()
            })
            .eq('id', authState.user.id);

          if (increaseError) throw increaseError;
        }

        // 대상 파트너 로그 기록
        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: transferTargetPartner.id,
            balance_before: targetPartnerData.balance,
            balance_after: receiverNewBalance,
            amount: -amount,
            transaction_type: 'withdrawal',
            from_partner_id: transferTargetPartner.id,
            to_partner_id: isSystemAdmin ? null : authState.user.id,
            processed_by: authState.user.id,
            memo: `[파트너 회수] ${currentPartnerData.nickname}에게 보유금 회수됨${transferMemo ? `: ${transferMemo}` : ''}`
          });

        // 송금자 로그 기록 (시스템관리자가 아닌 경우)
        if (!isSystemAdmin) {
          await supabase
            .from('partner_balance_logs')
            .insert({
              partner_id: authState.user.id,
              balance_before: currentPartnerData.balance,
              balance_after: senderNewBalance,
              amount: amount,
              transaction_type: 'deposit',
              from_partner_id: transferTargetPartner.id,
              to_partner_id: authState.user.id,
              processed_by: authState.user.id,
              memo: `[파트너 회수] ${transferTargetPartner.nickname}으로부터 보유금 회수${transferMemo ? `: ${transferMemo}` : ''}`
            });
        }
      }

      toast.success(`${transferTargetPartner.nickname}에게 ${amount.toLocaleString()}원을 ${transferMode === 'deposit' ? '지급' : '회수'}했습니다.`, {
        duration: 3000,
        icon: transferMode === 'deposit' ? '💰' : '📥'
      });

      // 실시간 업데이트
      if (connected && sendMessage) {
        sendMessage({
          type: 'partner_balance_transfer',
          data: { 
            from: authState.user.id,
            to: transferTargetPartner.id,
            amount,
            mode: transferMode
          }
        });
      }

      // 다이얼로그 닫기 및 초기화
      setShowTransferDialog(false);
      setTransferTargetPartner(null);
      setTransferAmount("");
      setTransferMemo("");
      setTransferMode('deposit');
      
      // 목록 새로고침
      fetchPartners();

    } catch (error: any) {
      console.error('보유금 지급/회수 오류:', error);
      
      // 오류 메시지 파싱
      if (error.message?.includes('관리자 보유금')) {
        toast.error('관리자 보유금이 부족합니다.');
      } else {
        toast.error(`보유금 ${transferMode === 'deposit' ? '지급' : '회수'}에 실패했습니다.`);
      }
    } finally {
      setTransferLoading(false);
    }
  };



  // 파트너 대시보드 데이터 조회
  const fetchDashboardData = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 오늘의 총 입출금
      const { data: todayTransactions } = await supabase
        .from('transactions')
        .select('transaction_type, amount')
        .eq('partner_id', authState.user?.id)
        .gte('created_at', today);

      // 이번달 정산 데이터
      const { data: monthlySettlement } = await supabase
        .from('settlements')
        .select('*')
        .eq('partner_id', authState.user?.id)
        .gte('period_start', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

      setDashboardData({
        todayDeposits: todayTransactions?.filter(t => t.transaction_type === 'deposit').reduce((sum, t) => sum + Number(t.amount), 0) || 0,
        todayWithdrawals: todayTransactions?.filter(t => t.transaction_type === 'withdrawal').reduce((sum, t) => sum + Number(t.amount), 0) || 0,
        monthlyCommission: monthlySettlement?.reduce((sum, s) => sum + Number(s.commission_amount), 0) || 0
      });
    } catch (error) {
      console.error('대시보드 데이터 조회 오류:', error);
    }
  };

  // 계층 구조 갭 확인 (중간 계층이 비어있는지 확인)
  const checkHierarchyGap = async (targetPartnerType: Partner['partner_type']): Promise<{
    hasGap: boolean;
    missingLevels: number[];
    directParentId: string | null;
    message: string;
  }> => {
    if (!authState.user) {
      return { hasGap: true, missingLevels: [], directParentId: null, message: '사용자 정보가 없습니다.' };
    }

    const currentLevel = authState.user.level;
    const targetLevel = getPartnerLevel(targetPartnerType);
    
    // 시스템관리자는 제약 없음
    if (currentLevel === 1) {
      return { hasGap: false, missingLevels: [], directParentId: authState.user.id, message: '' };
    }

    // 직접 하위 레벨이면 문제 없음
    if (targetLevel === currentLevel + 1) {
      return { hasGap: false, missingLevels: [], directParentId: authState.user.id, message: '' };
    }

    // 중간 레벨 확인 필요
    const missingLevels: number[] = [];
    let directParentId: string | null = null;

    // 현재 레벨부터 목표 레벨까지 중간 레벨들 확인
    for (let level = currentLevel + 1; level < targetLevel; level++) {
      const { data, error } = await supabase
        .from('partners')
        .select('id, level, partner_type, nickname')
        .eq('level', level)
        .eq('status', 'active');

      if (error) {
        console.error(`레벨 ${level} 파트너 조회 오류:`, error);
        continue;
      }

      // 재귀적으로 현재 사용자의 하위인지 확인
      const { data: hierarchical, error: hierError } = await supabase
        .rpc('get_hierarchical_partners', { p_partner_id: authState.user.id });

      if (hierError) {
        console.error('계층 파트너 조회 오류:', hierError);
        missingLevels.push(level);
        continue;
      }

      const levelPartners = (hierarchical || []).filter((p: any) => p.level === level && p.status === 'active');
      
      if (levelPartners.length === 0) {
        missingLevels.push(level);
      }
    }

    // 직접 상위 파트너 찾기 (목표 레벨 - 1)
    if (missingLevels.length === 0) {
      const parentLevel = targetLevel - 1;
      const { data: hierarchical } = await supabase
        .rpc('get_hierarchical_partners', { p_partner_id: authState.user.id });

      const parentPartners = (hierarchical || []).filter((p: any) => 
        p.level === parentLevel && p.status === 'active'
      );

      if (parentPartners.length > 0) {
        // 가장 최근에 생성된 파트너를 기본 상위로 선택
        directParentId = parentPartners.sort((a: any, b: any) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0].id;
      }
    }

    const levelNames: Record<number, string> = {
      2: '대본사',
      3: '본사',
      4: '부본사',
      5: '총판',
      6: '매장'
    };

    let message = '';
    if (missingLevels.length > 0) {
      const missingNames = missingLevels.map(l => levelNames[l] || `Level ${l}`).join(', ');
      message = `⚠️ ${partnerTypeTexts[targetPartnerType]}을(를) 생성하려면 먼저 중간 계층(${missingNames})을 생성해야 합니다.`;
    }

    return {
      hasGap: missingLevels.length > 0,
      missingLevels,
      directParentId,
      message
    };
  };

  // 파트너 생성 권한 체크
  const canCreatePartner = (partnerType: Partner['partner_type']): boolean => {
    if (!authState.user) return false;
    
    const userLevel = authState.user.level;
    const targetLevel = getPartnerLevel(partnerType);
    
    // 시스템관리자는 모든 파트너 생성 가능
    if (userLevel === 1) return true;
    
    // 대본사는 본사부터 매장까지 생성 가능 (하위 레벨만)
    if (userLevel === 2) return targetLevel > 2;
    
    // 본인보다 하위 레벨만 생성 가능
    return targetLevel > userLevel;
  };

  // 파트너 레벨 계산
  const getPartnerLevel = (partnerType: Partner['partner_type']): number => {
    const levelMap = {
      system_admin: 1,
      head_office: 2,
      main_office: 3,
      sub_office: 4,
      distributor: 5,
      store: 6
    };
    return levelMap[partnerType];
  };

  // 폼 데이터 초기화
  const resetFormData = () => {
    setFormData({
      username: "",
      nickname: "",
      password: "",
      partner_type: "head_office",
      parent_id: "",
      opcode: "",
      secret_key: "",
      api_token: "",
      commission_rolling: systemDefaultCommission.rolling,
      commission_losing: systemDefaultCommission.losing,
      withdrawal_fee: systemDefaultCommission.fee
    });
  };

  // 수정 폼 데이터 설정
  const setEditFormData = (partner: Partner) => {
    setFormData({
      username: partner.username,
      nickname: partner.nickname,
      password: "",
      partner_type: partner.partner_type,
      parent_id: partner.parent_id || "",
      opcode: partner.opcode || "",
      secret_key: partner.secret_key || "",
      api_token: partner.api_token || "",
      commission_rolling: partner.commission_rolling,
      commission_losing: partner.commission_losing,
      withdrawal_fee: partner.withdrawal_fee
    });
  };

  // 계층 구조 빌드 (트리 형태로 변환)
  const buildHierarchy = (partnerList: Partner[]): Partner[] => {
    const partnerMap = new Map<string, Partner & { children?: Partner[] }>();
    const rootPartners: Partner[] = [];

    // 모든 파트너를 맵에 저장
    partnerList.forEach(partner => {
      partnerMap.set(partner.id, { ...partner, children: [] });
    });

    // 부모-자식 관계 설정
    partnerList.forEach(partner => {
      const partnerWithChildren = partnerMap.get(partner.id);
      if (partnerWithChildren) {
        if (partner.parent_id && partnerMap.has(partner.parent_id)) {
          const parent = partnerMap.get(partner.parent_id);
          if (parent && parent.children) {
            parent.children.push(partnerWithChildren);
          }
        } else {
          rootPartners.push(partnerWithChildren);
        }
      }
    });

    return rootPartners;
  };

  // 파트너 토글
  const togglePartner = (partnerId: string) => {
    setExpandedPartners(prev => {
      const newSet = new Set(prev);
      if (newSet.has(partnerId)) {
        newSet.delete(partnerId);
      } else {
        newSet.add(partnerId);
      }
      return newSet;
    });
  };

  // 필터링된 파트너 목록
  const filteredPartners = partners.filter(partner => {
    const matchesSearch = partner.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         partner.nickname.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || partner.partner_type === typeFilter;
    const matchesStatus = statusFilter === 'all' || partner.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  // 계층 구조 데이터
  const hierarchyData = buildHierarchy(filteredPartners);

  // 트리 노드 렌더링 함수
  const renderTreeNode = (partner: any, depth: number): JSX.Element => {
    const isExpanded = expandedPartners.has(partner.id);
    const hasChildren = partner.children && partner.children.length > 0;
    const indentWidth = depth * 24; // 24px씩 들여쓰기

    return (
      <div key={partner.id}>
        {/* 파트너 행 */}
        <div 
          className="flex items-center gap-1.5 p-2.5 rounded-lg hover:bg-slate-800/50 transition-colors border border-slate-700/30 bg-slate-800/20 min-w-[1200px]"
        >
          {/* 토글 버튼 + 아이디 (동적 너비, 들여쓰기 적용) */}
          <div className="flex items-center gap-2 min-w-[130px] flex-shrink-0" style={{ paddingLeft: `${indentWidth}px` }}>
            <button
              onClick={() => hasChildren && togglePartner(partner.id)}
              className={`flex items-center justify-center w-5 h-5 rounded transition-colors flex-shrink-0 ${
                hasChildren 
                  ? 'hover:bg-slate-700 text-slate-300 cursor-pointer' 
                  : 'invisible'
              }`}
            >
              {hasChildren && (
                isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )
              )}
            </button>

            {/* 아이디 */}
            <span className="font-medium text-white text-sm truncate">{partner.username}</span>
          </div>

          {/* 나머지 컬럼들 (고정 너비로 헤더와 정렬) */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* 닉네임 */}
            <div className="min-w-[90px] flex-shrink-0">
              <span className="text-slate-300 text-sm truncate">{partner.nickname}</span>
            </div>

            {/* 파트너 등급 */}
            <div className="min-w-[85px] flex-shrink-0">
              <Badge className={`${partnerTypeColors[partner.partner_type]} text-white text-xs`}>
                {partnerTypeTexts[partner.partner_type]}
              </Badge>
            </div>

            {/* 상태 */}
            <div className="min-w-[60px] flex-shrink-0">
              <Badge className={`${statusColors[partner.status]} text-white text-xs`}>
                {statusTexts[partner.status]}
              </Badge>
            </div>

            {/* 보유금 */}
            <div className="min-w-[110px] text-right flex-shrink-0">
              <span className="font-mono text-green-400 text-sm">
                {partner.balance.toLocaleString()}원
              </span>
            </div>

            {/* 커미션 정보 */}
            <div className="min-w-[170px] flex-shrink-0">
              <div className="flex items-center gap-1 text-xs">
                <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs px-1">
                  R:{partner.commission_rolling}%
                </Badge>
                <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs px-1">
                  L:{partner.commission_losing}%
                </Badge>
                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs px-1">
                  F:{partner.withdrawal_fee}%
                </Badge>
              </div>
            </div>

            {/* 하위/회원 수 */}
            <div className="flex items-center gap-1.5 min-w-[110px] flex-shrink-0">
              <div className="flex items-center gap-1">
                <Building2 className="h-3 w-3 text-slate-400" />
                <span className="text-xs text-slate-400">{partner.child_count || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3 text-slate-400" />
                <span className="text-xs text-slate-400">{partner.user_count || 0}</span>
              </div>
            </div>

            {/* 최근 접속 */}
            <div className="min-w-[120px] flex-shrink-0">
              {partner.last_login_at ? (() => {
                const date = new Date(partner.last_login_at);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hour = String(date.getHours()).padStart(2, '0');
                const minute = String(date.getMinutes()).padStart(2, '0');
                return <span className="text-xs text-slate-400">{`${year}/${month}/${day} ${hour}:${minute}`}</span>;
              })() : (
                <span className="text-xs text-slate-600">-</span>
              )}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-1.5 w-[240px] flex-shrink-0">
            {/* 보유금 지급/회수 버튼 - 시스템관리자->대본사 또는 직접 하위 파트너 */}
            {((authState.user?.level === 1 && partner.partner_type === 'head_office') || 
              (partner.parent_id === authState.user?.id && partner.partner_type !== 'head_office')) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setForceTransactionTarget(partner);
                    setForceTransactionType('deposit');
                    setShowForceTransactionModal(true);
                  }}
                  className="bg-green-500/10 border-green-500/50 text-green-400 hover:bg-green-500/20 flex-shrink-0"
                  title={authState.user?.level === 1 && partner.partner_type === 'head_office' ? "입금" : "보유금 지급"}
                >
                  <DollarSign className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setForceTransactionTarget(partner);
                    setForceTransactionType('withdrawal');
                    setShowForceTransactionModal(true);
                  }}
                  className="bg-orange-500/10 border-orange-500/50 text-orange-400 hover:bg-orange-500/20 flex-shrink-0"
                  title={authState.user?.level === 1 && partner.partner_type === 'head_office' ? "출금" : "보유금 회수"}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedPartner(partner);
                setEditFormData(partner);
                setShowEditDialog(true);
              }}
              className="bg-blue-500/10 border-blue-500/50 text-blue-400 hover:bg-blue-500/20 flex-shrink-0"
            >
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                toast.info(`${partner.nickname} 파트너의 상세 정보를 확인합니다.`);
              }}
              className="bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700 flex-shrink-0"
            >
              <Eye className="h-3 w-3" />
            </Button>
            {partner.partner_type !== 'system_admin' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPartnerToDelete(partner);
                  setDeleteConfirmText("");
                  setShowDeleteDialog(true);
                }}
                className="bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20 flex-shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* 하위 파트너들 (재귀 렌더링) */}
        {isExpanded && hasChildren && (
          <div className="mt-1 space-y-1">
            {partner.children.map((child: any) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // 테이블 컬럼 정의
  const columns: Column<Partner>[] = [
    {
      key: "username",
      title: "아이디",
      sortable: true,
    },
    {
      key: "nickname", 
      title: "닉네임",
      sortable: true,
    },
    {
      key: "partner_type",
      title: "파트너 등급",
      render: (value: Partner['partner_type']) => (
        <Badge className={`${partnerTypeColors[value]} text-white`}>
          {partnerTypeTexts[value]}
        </Badge>
      ),
    },
    {
      key: "parent_nickname",
      title: "상위 파트너",
    },
    {
      key: "status",
      title: "상태",
      render: (value: Partner['status']) => (
        <Badge className={`${statusColors[value]} text-white`}>
          {statusTexts[value]}
        </Badge>
      ),
    },
    {
      key: "balance",
      title: "보유금액",
      sortable: true,
      render: (value: number) => (
        <span className="font-mono">
          {value.toLocaleString()}원
        </span>
      ),
    },
    {
      key: "commission_rolling",
      title: "커미션(%)",
      render: (_, row: Partner) => (
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
            R:{row.commission_rolling}
          </Badge>
          <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs">
            L:{row.commission_losing}
          </Badge>
        </div>
      ),
    },
    {
      key: "opcode",
      title: "OPCODE",
      render: (value: string, row: Partner) => (
        row.partner_type === 'head_office' && value ? (
          <Badge variant="outline" className="font-mono">
            {value}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: "last_login_at",
      title: "최근 접속",
      render: (value: string) => {
        if (!value) return <span className="text-muted-foreground">-</span>;
        const date = new Date(value);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return <span className="text-slate-500">{`${year}/${month}/${day} ${hour}:${minute}`}</span>;
      },
    },
    {
      key: "child_count",
      title: "하위 파트너",
      render: (value: number) => (
        <div className="flex items-center gap-1">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span>{value}</span>
        </div>
      ),
    },
    {
      key: "user_count",
      title: "관리 회원",
      render: (value: number) => (
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>{value}</span>
        </div>
      ),
    },
    {
      key: "created_at",
      title: "생성일",
      render: (value: string) => {
        const date = new Date(value);
        return date.toLocaleDateString('ko-KR');
      },
    },
    {
      key: "actions",
      title: "관리",
      render: (_, partner: Partner) => (
        <div className="flex items-center gap-2">
          {showHierarchyView && (partner.child_count ?? 0) > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => togglePartner(partner.id)}
              title={expandedPartners.has(partner.id) ? "접기" : "펼치기"}
            >
              {expandedPartners.has(partner.id) ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          )}
          {/* 보유금 지급/회수 버튼 - 하위 파트너에게만 표시 */}
          {partner.parent_id === authState.user?.id && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTransferTargetPartner(partner);
                  setTransferAmount("");
                  setTransferMemo("");
                  setTransferMode('deposit');
                  setShowTransferDialog(true);
                }}
                className="text-green-600 hover:bg-green-50"
                title="보유금 지급"
              >
                <Send className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTransferTargetPartner(partner);
                  setTransferAmount("");
                  setTransferMemo("");
                  setTransferMode('withdrawal');
                  setShowTransferDialog(true);
                }}
                className="text-orange-600 hover:bg-orange-50"
                title="보유금 회수"
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedPartner(partner);
              setEditFormData(partner);
              setShowEditDialog(true);
            }}
            title="수정"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              toast.info(`${partner.nickname} 파트너의 상세 정보를 확인합니다.`);
            }}
            title="상세 보기"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {partner.partner_type !== 'system_admin' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPartnerToDelete(partner);
                setDeleteConfirmText("");
                setShowDeleteDialog(true);
              }}
              className="text-red-600 hover:bg-red-50"
              title="삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  useEffect(() => {
    loadSystemDefaultCommission();
    loadParentCommission();
    fetchPartners();
    fetchDashboardData();
  }, []);

  // 탭 변경시 데이터 새로고침
  useEffect(() => {
    if (currentTab === "dashboard") {
      fetchDashboardData();
    }
  }, [currentTab]);

  if (loading && partners.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">파트너 관리</h1>
          <p className="text-sm text-slate-400">
            {authState.user?.nickname}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => setShowHierarchyView(!showHierarchyView)}
            className="border-slate-700 text-slate-300 hover:bg-slate-700/50"
          >
            <Building2 className="h-4 w-4 mr-2" />
            {showHierarchyView ? "목록 보기" : "계층 보기"}
          </Button>
          <Button className="border-slate-700 text-slate-300 hover:bg-slate-700/50">
            <Download className="h-4 w-4 mr-2" />
            내보내기
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            파트너 생성
          </Button>
        </div>
      </div>

      {/* 통계 카드 - 자신 제외, 레벨별 동적 표시 */}
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard
          title="전체 하위 파트너"
          value={partners.filter(p => p.id !== authState.user?.id).length.toLocaleString()}
          subtitle="관리 중인 파트너"
          icon={Building2}
          color="purple"
        />
        
        {/* 대본사(2): 본사 */}
        {authState.user?.level === 2 && (
          <MetricCard
            title="본사"
            value={partners.filter(p => p.id !== authState.user?.id && p.partner_type === 'main_office').length.toLocaleString()}
            subtitle="본사 파트너"
            icon={Shield}
            color="red"
          />
        )}
        
        {/* 본사(3): 부본사 */}
        {authState.user?.level === 3 && (
          <MetricCard
            title="부본사"
            value={partners.filter(p => p.id !== authState.user?.id && p.partner_type === 'sub_office').length.toLocaleString()}
            subtitle="부본사 파트너"
            icon={Shield}
            color="red"
          />
        )}
        
        {/* 부본사(4): 총판 */}
        {authState.user?.level === 4 && (
          <MetricCard
            title="총판"
            value={partners.filter(p => p.id !== authState.user?.id && p.partner_type === 'distributor').length.toLocaleString()}
            subtitle="총판 파트너"
            icon={Shield}
            color="red"
          />
        )}
        
        {/* 대본사(2): 부본사/총판/매장 */}
        {authState.user?.level === 2 && (
          <MetricCard
            title="부본사/총판/매장"
            value={partners.filter(p => p.id !== authState.user?.id && (p.partner_type === 'sub_office' || p.partner_type === 'distributor' || p.partner_type === 'store')).length.toLocaleString()}
            subtitle="하위 파트너"
            icon={Building2}
            color="orange"
          />
        )}
        
        {/* 본사(3): 총판/매장 */}
        {authState.user?.level === 3 && (
          <MetricCard
            title="총판/매장"
            value={partners.filter(p => p.id !== authState.user?.id && (p.partner_type === 'distributor' || p.partner_type === 'store')).length.toLocaleString()}
            subtitle="하위 파트너"
            icon={Building2}
            color="orange"
          />
        )}
        
        {/* 부본사(4): 매장 */}
        {authState.user?.level === 4 && (
          <MetricCard
            title="매장"
            value={partners.filter(p => p.id !== authState.user?.id && p.partner_type === 'store').length.toLocaleString()}
            subtitle="매장 파트너"
            icon={Building2}
            color="orange"
          />
        )}
        
        {/* 총판(5): 매장만 */}
        {authState.user?.level === 5 && (
          <>
            <MetricCard
              title="매장"
              value={partners.filter(p => p.id !== authState.user?.id && p.partner_type === 'store').length.toLocaleString()}
              subtitle="매장 파트너"
              icon={Shield}
              color="red"
            />
            <MetricCard
              title="-"
              value="0"
              subtitle="하위 없음"
              icon={Building2}
              color="orange"
            />
          </>
        )}
        
        {/* 시스템관리자(1) 또는 매장(6): 모든 타입 */}
        {(authState.user?.level === 1 || authState.user?.level === 6) && (
          <>
            <MetricCard
              title="대본사"
              value={partners.filter(p => p.id !== authState.user?.id && p.partner_type === 'head_office').length.toLocaleString()}
              subtitle="대본사 파트너"
              icon={Shield}
              color="red"
            />
            <MetricCard
              title="본사/부본사"
              value={partners.filter(p => p.id !== authState.user?.id && (p.partner_type === 'main_office' || p.partner_type === 'sub_office')).length.toLocaleString()}
              subtitle="중간 파트너"
              icon={Building2}
              color="orange"
            />
          </>
        )}
        
        <MetricCard
          title="활성 파트너"
          value={partners.filter(p => p.id !== authState.user?.id && p.status === 'active').length.toLocaleString()}
          subtitle="정상 운영 중"
          icon={Eye}
          color="green"
        />
      </div>

      {/* 탭 메뉴 - 현대적인 디자인 */}
      <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6">
        <div className="border-b border-slate-700/50">
          <TabsList className="bg-transparent h-auto p-0 border-0 gap-8">
            <TabsTrigger 
              value="hierarchy"
              className="bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:border-cyan-400 data-[state=active]:bg-transparent data-[state=active]:text-cyan-400 data-[state=active]:shadow-none pb-3 px-0 transition-all"
            >
              파트너 계층 관리
            </TabsTrigger>
            <TabsTrigger 
              value="dashboard"
              className="bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:border-cyan-400 data-[state=active]:bg-transparent data-[state=active]:text-cyan-400 data-[state=active]:shadow-none pb-3 px-0 transition-all"
            >
              파트너 대시보드
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 파트너 계층 관리 탭 */}
        <TabsContent value="hierarchy" className="space-y-4">
          <Card className="bg-slate-900/40 border-slate-700/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-white">파트너 계층 관리</CardTitle>
              <CardDescription className="text-slate-400">
                7단계 권한 체계의 파트너를 관리합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="아이디 또는 닉네임으로 검색..."
                      className="pl-8 bg-slate-800/50 border-slate-700 text-white"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[180px] bg-slate-800/50 border-slate-700 text-white">
                    <SelectValue placeholder="파트너 등급" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 등급</SelectItem>
                    <SelectItem value="head_office">대본사</SelectItem>
                    <SelectItem value="main_office">본사</SelectItem>
                    <SelectItem value="sub_office">부본사</SelectItem>
                    <SelectItem value="distributor">총판</SelectItem>
                    <SelectItem value="store">매장</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-slate-800/50 border-slate-700 text-white">
                    <SelectValue placeholder="상태 필터" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 상태</SelectItem>
                    <SelectItem value="active">활성</SelectItem>
                    <SelectItem value="inactive">비활성</SelectItem>
                    <SelectItem value="blocked">차단</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 컬럼 헤더 */}
              <div className="mb-3 px-3 py-2 bg-slate-800/50 rounded-lg border border-slate-700/30">
                <div className="flex items-center gap-1.5">
                  {/* 토글 + 아이디 영역 */}
                  <div className="min-w-[130px] flex-shrink-0">
                    <div className="text-xs font-medium text-slate-400">아이디</div>
                  </div>
                  {/* 나머지 컬럼들 */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="min-w-[90px] text-xs font-medium text-slate-400">닉네임</div>
                    <div className="min-w-[85px] text-xs font-medium text-slate-400">등급</div>
                    <div className="min-w-[60px] text-xs font-medium text-slate-400">상태</div>
                    <div className="min-w-[110px] text-xs font-medium text-slate-400 text-right">보유금</div>
                    <div className="min-w-[170px] text-xs font-medium text-slate-400">커미션</div>
                    <div className="min-w-[110px] text-xs font-medium text-slate-400">하위/회원</div>
                    <div className="min-w-[120px] text-xs font-medium text-slate-400">최근 접속</div>
                  </div>
                  <div className="w-[240px] text-xs font-medium text-slate-400 text-center flex-shrink-0">관리</div>
                </div>
              </div>

              {/* 트리 구조 렌더링 */}
              {loading ? (
                <LoadingSpinner />
              ) : hierarchyData.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  파트너가 없습니다.
                </div>
              ) : (
                <div className="space-y-1 overflow-x-auto">
                  {hierarchyData.map((partner: any) => renderTreeNode(partner, 0))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 파트너 입출금 관리 탭 */}
        <TabsContent value="transactions" className="space-y-4">
          <PartnerTransactions />
        </TabsContent>

        {/* 파트너 대시보드 탭 */}
        <TabsContent value="dashboard" className="space-y-4">
          <Card className="bg-slate-900/40 border-slate-700/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <TrendingUp className="h-5 w-5" />
                파트너 대시보드
              </CardTitle>
              <CardDescription className="text-slate-400">
                파트너별 성과 및 수익 현황을 확인합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">이번달 커미션</CardTitle>
                    <DollarSign className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {(dashboardData.monthlyCommission || 0).toLocaleString()}원
                    </div>
                    <p className="text-xs text-muted-foreground">
                      +12% from last month
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">총 파트너 수</CardTitle>
                    <Building2 className="h-4 w-4 text-blue-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">
                      {partners.length.toLocaleString()}개
                    </div>
                    <p className="text-xs text-muted-foreground">
                      +2 new this month
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">활성 회원 수</CardTitle>
                    <Users className="h-4 w-4 text-purple-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-purple-600">
                      {partners.reduce((sum, p) => sum + (p.user_count || 0), 0).toLocaleString()}명
                    </div>
                    <p className="text-xs text-muted-foreground">
                      +5% from last month
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">상위 성과 파트너</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {partners
                        .filter(p => p.partner_type !== 'system_admin')
                        .sort((a, b) => (b.user_count || 0) - (a.user_count || 0))
                        .slice(0, 5)
                        .map((partner, index) => (
                          <div key={partner.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Badge className={`${partnerTypeColors[partner.partner_type]} text-white`}>
                                #{index + 1}
                              </Badge>
                              <div>
                                <p className="font-medium">{partner.nickname}</p>
                                <p className="text-sm text-muted-foreground">
                                  {partnerTypeTexts[partner.partner_type]}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">{(partner.user_count || 0)}명</p>
                              <p className="text-sm text-muted-foreground">관리 회원</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">파트너 레벨별 분포</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Object.entries(partnerTypeTexts).map(([type, text]) => {
                        const count = partners.filter(p => p.partner_type === type).length;
                        const percentage = partners.length > 0 ? Math.round((count / partners.length) * 100) : 0;
                        
                        return (
                          <div key={type} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{text}</span>
                              <span className="text-sm text-muted-foreground">{count}개 ({percentage}%)</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className={`h-2 rounded-full ${partnerTypeColors[type as keyof typeof partnerTypeColors]}`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 파트너 생성 다이얼로그 */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>새 파트너 생성</DialogTitle>
            <DialogDescription>
              새로운 파트너를 시스템에 등록합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">아이디</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="파트너 아이디 입력"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nickname">닉네임</Label>
                <Input
                  id="nickname"
                  value={formData.nickname}
                  onChange={(e) => setFormData(prev => ({ ...prev, nickname: e.target.value }))}
                  placeholder="파트너 닉네임 입력"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="초기 비밀번호 입력"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="partner_type">파트너 등급</Label>
                <Select 
                  value={formData.partner_type} 
                  onValueChange={async (value: Partner['partner_type']) => {
                    setFormData(prev => ({ ...prev, partner_type: value }));
                    
                    // 계층 검증 및 상위 파트너 커미션 로드
                    if (authState.user?.level !== 1) {
                      const result = await checkHierarchyGap(value);
                      setHierarchyWarning(result.message);
                      
                      // 직접 상위 파트너의 커미션 로드
                      if (result.directParentId && !result.hasGap) {
                        const commission = await loadPartnerCommissionById(result.directParentId);
                        if (commission) {
                          setParentCommission(commission);
                          console.log(`✅ ${partnerTypeTexts[value]} 상위 파트너 커미션 로드:`, commission);
                        }
                      }
                    } else {
                      // 시스템관리자: 대본사는 100% 고정
                      if (value === 'head_office') {
                        setParentCommission({
                          rolling: 100,
                          losing: 100,
                          fee: 100,
                          nickname: '시스템'
                        });
                      }
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {authState.user?.level === 1 && (
                      <SelectItem value="head_office">대본사</SelectItem>
                    )}
                    {authState.user?.level === 2 && (
                      <SelectItem value="main_office">본사</SelectItem>
                    )}
                    {authState.user?.level === 3 && (
                      <SelectItem value="sub_office">부본사</SelectItem>
                    )}
                    {authState.user?.level === 4 && (
                      <SelectItem value="distributor">총판</SelectItem>
                    )}
                    {authState.user?.level === 5 && (
                      <SelectItem value="store">매장</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                
                {/* 계층 구조 경고 메시지 */}
                {hierarchyWarning && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-xs text-red-700 dark:text-red-300">
                      {hierarchyWarning}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 대본사인 경우 OPCODE 관련 필드 */}
            {formData.partner_type === 'head_office' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="opcode" className="flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    OPCODE
                  </Label>
                  <Input
                    id="opcode"
                    value={formData.opcode}
                    onChange={(e) => setFormData(prev => ({ ...prev, opcode: e.target.value }))}
                    placeholder="외부 API OPCODE 입력"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="secret_key">Secret Key</Label>
                    <Input
                      id="secret_key"
                      value={formData.secret_key}
                      onChange={(e) => setFormData(prev => ({ ...prev, secret_key: e.target.value }))}
                      placeholder="비밀 키 입력"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api_token">API Token</Label>
                    <Input
                      id="api_token"
                      value={formData.api_token}
                      onChange={(e) => setFormData(prev => ({ ...prev, api_token: e.target.value }))}
                      placeholder="API 토큰 입력"
                    />
                  </div>
                </div>
              </>
            )}

            {/* 커미션 설정 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  커미션 설정
                </Label>
                {formData.partner_type !== 'head_office' && parentCommission && (
                  <Badge variant="outline" className="text-xs">
                    상위 한도: {parentCommission.rolling}% / {parentCommission.losing}%
                  </Badge>
                )}
              </div>
              
              {formData.partner_type === 'head_office' ? (
                <div className="p-3 bg-purple-50 dark:bg-purple-900/10 rounded-lg border border-purple-200 dark:border-purple-800">
                  <p className="text-xs text-purple-700 dark:text-purple-300">
                    🏢 <strong>대본사</strong>는 최상위 파트너로 커미션이 자동으로 <strong>100%</strong>로 설정됩니다.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    💡 커미션은 상위 파트너의 요율을 초과할 수 없습니다. 계층 구조에 따라 하위로 갈수록 낮아집니다.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="commission_rolling">롤링 커미션 (%)</Label>
                  <Input
                    id="commission_rolling"
                    type="text"
                    step="0.1"
                    min="0"
                    max={formData.partner_type === 'head_office' ? 100 : parentCommission?.rolling || 100}
                    value={formData.partner_type === 'head_office' ? 100 : formData.commission_rolling}
                    onChange={(e) => {
                      if (formData.partner_type === 'head_office') return;
                      const value = e.target.value;
                      if (value === '') {
                        setFormData(prev => ({ ...prev, commission_rolling: 0 }));
                        return;
                      }
                      const numValue = parseFloat(value);
                      if (isNaN(numValue)) return;
                      const maxValue = parentCommission?.rolling || 100;
                      if (numValue > maxValue) {
                        toast.error(`롤링 커미션은 상위 한도(${maxValue}%)를 초과할 수 없습니다.`);
                        return;
                      }
                      setFormData(prev => ({ ...prev, commission_rolling: numValue }));
                    }}
                    disabled={formData.partner_type === 'head_office'}
                    className={formData.partner_type === 'head_office' ? 'bg-muted' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.partner_type === 'head_office' ? '대본사 고정값' : '회원 총 베팅액 × 커미션 요율'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commission_losing">루징 커미션 (%)</Label>
                  <Input
                    id="commission_losing"
                    type="text"
                    step="0.1"
                    min="0"
                    max={formData.partner_type === 'head_office' ? 100 : parentCommission?.losing || 100}
                    value={formData.partner_type === 'head_office' ? 100 : formData.commission_losing}
                    onChange={(e) => {
                      if (formData.partner_type === 'head_office') return;
                      const value = e.target.value;
                      if (value === '') {
                        setFormData(prev => ({ ...prev, commission_losing: 0 }));
                        return;
                      }
                      const numValue = parseFloat(value);
                      if (isNaN(numValue)) return;
                      const maxValue = parentCommission?.losing || 100;
                      if (numValue > maxValue) {
                        toast.error(`루징 커미션은 상위 한도(${maxValue}%)를 초과할 수 없습니다.`);
                        return;
                      }
                      setFormData(prev => ({ ...prev, commission_losing: numValue }));
                    }}
                    disabled={formData.partner_type === 'head_office'}
                    className={formData.partner_type === 'head_office' ? 'bg-muted' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.partner_type === 'head_office' ? '대본사 고정값' : '회원 순손실액 × 커미션 요율'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="withdrawal_fee">환전 수수료 (%)</Label>
                  <Input
                    id="withdrawal_fee"
                    type="text"
                    step="0.1"
                    min="0"
                    max={formData.partner_type === 'head_office' ? 100 : parentCommission?.fee || 100}
                    value={formData.partner_type === 'head_office' ? 100 : formData.withdrawal_fee}
                    onChange={(e) => {
                      if (formData.partner_type === 'head_office') return;
                      const value = e.target.value;
                      if (value === '') {
                        setFormData(prev => ({ ...prev, withdrawal_fee: 0 }));
                        return;
                      }
                      const numValue = parseFloat(value);
                      if (isNaN(numValue)) return;
                      const maxValue = parentCommission?.fee || 100;
                      if (numValue > maxValue) {
                        toast.error(`환전 수수료는 상위 한도(${maxValue}%)를 초과할 수 없습니다.`);
                        return;
                      }
                      setFormData(prev => ({ ...prev, withdrawal_fee: numValue }));
                    }}
                    disabled={formData.partner_type === 'head_office'}
                    className={formData.partner_type === 'head_office' ? 'bg-muted' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.partner_type === 'head_office' ? '대본사 고정값' : '환전 금액에 적용되는 수수료'}
                  </p>
                </div>
              </div>
            </div>


          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowCreateDialog(false);
                resetFormData();
                setHierarchyWarning("");
              }}
            >
              취소
            </Button>
            <Button 
              onClick={createPartner} 
              disabled={loading || (!!hierarchyWarning && authState.user?.level !== 1)}
            >
              {loading ? "생성 중..." : "파트너 생성"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 파트너 수정 다이얼로그 */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>파트너 정보 수정</DialogTitle>
            <DialogDescription>
              파트너의 정보를 수정합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_username">아이디</Label>
                <Input
                  id="edit_username"
                  value={formData.username}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_nickname">닉네임</Label>
                <Input
                  id="edit_nickname"
                  value={formData.nickname}
                  onChange={(e) => setFormData(prev => ({ ...prev, nickname: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_password">비밀번호 (변경시에만 입력)</Label>
              <Input
                id="edit_password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder="비밀번호를 변경하려면 입력하세요"
              />
              <p className="text-xs text-muted-foreground">
                비밀번호를 변경하지 않으려면 비워두세요
              </p>
            </div>

            {/* 대본사인 경우 OPCODE 관련 필드 */}
            {selectedPartner?.partner_type === 'head_office' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit_opcode" className="flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    OPCODE
                  </Label>
                  <Input
                    id="edit_opcode"
                    value={formData.opcode}
                    onChange={(e) => setFormData(prev => ({ ...prev, opcode: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_secret_key">Secret Key</Label>
                    <Input
                      id="edit_secret_key"
                      value={formData.secret_key}
                      onChange={(e) => setFormData(prev => ({ ...prev, secret_key: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_api_token">API Token</Label>
                    <Input
                      id="edit_api_token"
                      value={formData.api_token}
                      onChange={(e) => setFormData(prev => ({ ...prev, api_token: e.target.value }))}
                    />
                  </div>
                </div>
              </>
            )}

            {/* 커미션 설정 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  커미션 설정
                </Label>
                {selectedPartner?.partner_type !== 'head_office' && parentCommission && (
                  <Badge variant="outline" className="text-xs">
                    상위 한도: {parentCommission.rolling}% / {parentCommission.losing}% / {parentCommission.fee}%
                  </Badge>
                )}
              </div>
              
              {selectedPartner?.partner_type === 'head_office' ? (
                <div className="p-3 bg-purple-50 dark:bg-purple-900/10 rounded-lg border border-purple-200 dark:border-purple-800">
                  <p className="text-xs text-purple-700 dark:text-purple-300">
                    🏢 <strong>대본사</strong>는 최상위 파트너로 커미션이 <strong>100%</strong>로 고정됩니다.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800">
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    ⚠️ 커미션 변경 시 정산에 즉시 반영되며, 상위 파트너 요율을 초과할 수 없습니다.
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_commission_rolling">롤링 커미션 (%)</Label>
                  <Input
                    id="edit_commission_rolling"
                    type="number"
                    step="0.1"
                    min="0"
                    max={selectedPartner?.partner_type === 'head_office' ? 100 : parentCommission?.rolling || 100}
                    value={formData.commission_rolling}
                    onChange={(e) => setFormData(prev => ({ ...prev, commission_rolling: parseFloat(e.target.value) || 0 }))}
                    disabled={selectedPartner?.partner_type === 'head_office'}
                    className={selectedPartner?.partner_type === 'head_office' ? 'bg-muted' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    {selectedPartner?.partner_type === 'head_office' ? '대본사 고정값' : '회원 총 베팅액 × 커미션 요율'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_commission_losing">루징 커미션 (%)</Label>
                  <Input
                    id="edit_commission_losing"
                    type="number"
                    step="0.1"
                    min="0"
                    max={selectedPartner?.partner_type === 'head_office' ? 100 : parentCommission?.losing || 100}
                    value={formData.commission_losing}
                    onChange={(e) => setFormData(prev => ({ ...prev, commission_losing: parseFloat(e.target.value) || 0 }))}
                    disabled={selectedPartner?.partner_type === 'head_office'}
                    className={selectedPartner?.partner_type === 'head_office' ? 'bg-muted' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    {selectedPartner?.partner_type === 'head_office' ? '대본사 고정값' : '회원 순손실액 × 커미션 요율'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_withdrawal_fee">환전 수수료 (%)</Label>
                  <Input
                    id="edit_withdrawal_fee"
                    type="number"
                    step="0.1"
                    min="0"
                    max={selectedPartner?.partner_type === 'head_office' ? 100 : parentCommission?.fee || 100}
                    value={formData.withdrawal_fee}
                    onChange={(e) => setFormData(prev => ({ ...prev, withdrawal_fee: parseFloat(e.target.value) || 0 }))}
                    disabled={selectedPartner?.partner_type === 'head_office'}
                    className={selectedPartner?.partner_type === 'head_office' ? 'bg-muted' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    {selectedPartner?.partner_type === 'head_office' ? '대본사 고정값' : '환전 금액에 적용되는 수수료'}
                  </p>
                </div>
              </div>
            </div>


          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowEditDialog(false);
                setSelectedPartner(null);
              }}
            >
              취소
            </Button>
            <Button onClick={updatePartner} disabled={loading}>
              {loading ? "수정 중..." : "수정 완료"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 강제 입출금 모달 */}
      <ForceTransactionModal
        open={showForceTransactionModal}
        onOpenChange={(open) => {
          setShowForceTransactionModal(open);
          if (!open) {
            setForceTransactionTarget(null);
          }
        }}
        type={forceTransactionType}
        targetType="partner"
        selectedTarget={forceTransactionTarget ? {
          id: forceTransactionTarget.id,
          username: forceTransactionTarget.username,
          nickname: forceTransactionTarget.nickname,
          balance: forceTransactionTarget.balance || 0
        } : null}
        onSubmit={handleForceTransaction}
        onTypeChange={setForceTransactionType}
      />

      {/* 파트너 삭제 확인 다이얼로그 */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-red-600">⚠️ 파트너 삭제 확인</DialogTitle>
            <DialogDescription>
              이 작업은 되돌릴 수 없습니다. 삭제하려면 아래에 파트너 아이디를 입력해주세요.
            </DialogDescription>
          </DialogHeader>
          {partnerToDelete && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">파트너</span>
                    <span className="font-medium">{partnerToDelete.nickname} ({partnerToDelete.username})</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">등급</span>
                    <Badge className={`${partnerTypeColors[partnerToDelete.partner_type]} text-white`}>
                      {partnerTypeTexts[partnerToDelete.partner_type]}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">하위 파트너</span>
                    <span className="font-medium">{partnerToDelete.child_count || 0}명</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">관리 회원</span>
                    <span className="font-medium">{partnerToDelete.user_count || 0}명</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="delete-confirm" className="text-red-600">
                  삭제 확인: <span className="font-mono">{partnerToDelete.username}</span> 입력
                </Label>
                <Input
                  id="delete-confirm"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="파트너 아이디를 정확히 입력하세요"
                  className="border-red-300 focus:border-red-500"
                />
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>주의:</strong> 하위 파트너나 관리 회원이 있으면 삭제할 수 없습니다.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteDialog(false);
                setPartnerToDelete(null);
                setDeleteConfirmText("");
              }}
              disabled={deleteLoading}
            >
              취소
            </Button>
            <Button 
              variant="destructive"
              onClick={deletePartner}
              disabled={deleteLoading || deleteConfirmText !== partnerToDelete?.username}
            >
              {deleteLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  삭제 중...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  삭제
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PartnerManagement;