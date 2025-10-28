import { useState, useEffect } from "react";
import { Plus, Search, Filter, Download, Upload, Edit, Trash2, Eye, DollarSign, UserX, UserCheck, X, Check, Clock, Bell, Users, Activity } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogFooter as DialogFooter, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle, AdminDialogTrigger as DialogTrigger } from "./AdminDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Label } from "../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { getAdminOpcode, isMultipleOpcode } from "../../lib/opcodeHelper";
import { UserDetailModal } from "./UserDetailModal";
import { MetricCard } from "./MetricCard";
import { ForceTransactionModal } from "./ForceTransactionModal";
import { 
  useHierarchyAuth, 
  useHierarchicalData, 
  PermissionGate, 
  HierarchyBadge,
  HierarchyLevel 
} from "../common/HierarchyManager";

// 게임 제공사 이름 매핑 헬퍼 함수
const getProviderName = (providerId: number | string): string => {
  const id = typeof providerId === 'string' ? parseInt(providerId) : providerId;
  
  const providerMap: { [key: number]: string } = {
    1: '마이크로게이밍',
    17: '플레이앤고',
    20: 'CQ9 게이밍',
    21: '제네시스 게이밍',
    22: '하바네로',
    23: '게임아트',
    27: '플레이텍',
    38: '블루프린트',
    39: '부운고',
    40: '드라군소프트',
    41: '엘크 스튜디오',
    47: '드림테크',
    51: '칼람바 게임즈',
    52: '모빌롯',
    53: '노리밋 시티',
    55: 'OMI 게이밍',
    56: '원터치',
    59: '플레이슨',
    60: '푸쉬 게이밍',
    61: '퀵스핀',
    62: 'RTG 슬롯',
    63: '리볼버 게이밍',
    65: '슬롯밀',
    66: '스피어헤드',
    70: '썬더킥',
    72: '우후 게임즈',
    74: '릴렉스 게이밍',
    75: '넷엔트',
    76: '레드타이거',
    87: 'PG소프트',
    88: '플레이스타',
    90: '빅타임게이밍',
    300: '프라그마틱 플레이',
    // 카지노 제공사
    410: '에볼루션 게이밍',
    77: '마이크로 게이밍',
    2: 'Vivo 게이밍',
    30: '아시아 게이밍',
    78: '프라그마틱플레이',
    86: '섹시게이밍',
    11: '비비아이엔',
    28: '드림게임',
    89: '오리엔탈게임',
    91: '보타',
    44: '이주기',
    85: '플레이텍 라이브',
    0: '제네럴 카지노'
  };
  
  return providerMap[id] || `제공사 ${id}`;
};

// 은행 목록
const BANK_LIST = [
  'KB국민은행', '신한은행', '우리은행', '하나은행', '농협은행',
  'IBK기업은행', '부산은행', '대구은행', '광주은행', '전북은행',
  '경남은행', '제주은행', 'SC제일은행', 'HSBC은행', 'KDB산업은행',
  'NH농협은행', '신협중앙회', '우체국예금보험', '새마을금고',
  '카카오뱅크', '케이뱅크', '토스뱅크'
];

export function UserManagement() {
  const { authState } = useAuth();
  const { lastMessage, connected, sendMessage } = useWebSocketContext();
  const { userLevel, isSystemAdmin, getLevelName } = useHierarchyAuth();
  
  // 사용자 데이터 (직접 조회)
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showForceTransactionModal, setShowForceTransactionModal] = useState(false);
  const [forceTransactionType, setForceTransactionType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [forceTransactionTarget, setForceTransactionTarget] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [detailUser, setDetailUser] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    nickname: '',
    password: '',
    bank_name: '',
    bank_account: '',
    memo: ''
  });

  // 사용자 목록 조회 (하위 파트너 포함)
  const fetchUsers = async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      let allowedReferrerIds: string[] = [];

      if (authState.user?.level === 1) {
        // 시스템관리자: 모든 사용자
        const { data, error } = await supabase
          .from('users')
          .select(`
            *,
            referrer:partners!referrer_id(
              id,
              username,
              level,
              opcode,
              secret_key,
              api_token
            )
          `)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setUsers(data || []);
        return;
      } else {
        // 일반 파트너: 자신 + 하위 파트너들의 사용자
        const { data: hierarchicalPartners } = await supabase
          .rpc('get_hierarchical_partners', { p_partner_id: authState.user?.id });
        
        allowedReferrerIds = [authState.user?.id || '', ...(hierarchicalPartners?.map((p: any) => p.id) || [])];
      }

      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          referrer:partners!referrer_id(
            id,
            username,
            level,
            opcode,
            secret_key,
            api_token
          )
        `)
        .in('referrer_id', allowedReferrerIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('❌ 회원 목록 조회 실패:', error);
      if (!silent) toast.error('회원 목록을 불러오는데 실패했습니다.');
      setUsers([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 초기 로드
  useEffect(() => {
    fetchUsers();
  }, [authState.user?.id, authState.user?.level]);

  // Realtime subscription for users table
  useEffect(() => {
    // users 테이블 변경 감지 - 깜박임 없는 업데이트
    const channel = supabase
      .channel('users-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('👥 users 테이블 변경 감지:', payload);
          // silent 모드로 데이터 새로고침 (깜박임 없음)
          fetchUsers(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // WebSocket 메시지 처리 - 깜박임 없는 업데이트
  useEffect(() => {
    if (lastMessage?.type === 'user_balance_updated' || lastMessage?.type === 'user_updated') {
      console.log('🔔 사용자 업데이트 알림 수신:', lastMessage);
      // silent 모드로 데이터 새로고침 (깜박임 없음)
      fetchUsers(true);
    }
  }, [lastMessage]);

  // 회원 생성
  const createUser = async () => {
    if (!formData.username || !formData.password) {
      toast.error('아이디와 비밀번호는 필수입니다.');
      return;
    }

    try {
      console.log('👤 새 회원 생성 시작:', formData.username);

      // 1. 외부 API에 계정 생성 먼저 시도
      if (!authState.user?.opcode || !authState.user?.secret_key) {
        toast.error('OPCODE 정보가 없습니다. 상위 파트너에게 문의하세요.');
        return;
      }

      console.log('🌐 외부 API 계정 생성 요청:', {
        opcode: authState.user.opcode,
        username: formData.username
      });

      const apiResult = await investApi.createAccount(
        authState.user.opcode,
        formData.username,
        authState.user.secret_key
      );

      if (apiResult.error) {
        console.error('❌ 외부 API 계정 생성 실패:', apiResult.error);
        toast.error(`외부 API 계정 생성 실패: ${apiResult.error}`);
        return;
      }

      console.log('✅ 외부 API 계정 생성 성공:', apiResult.data);

      // 2. DB에 사용자 생성
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          username: formData.username,
          nickname: formData.nickname || formData.username,
          password_hash: formData.password,
          bank_name: formData.bank_name || null,
          bank_account: formData.bank_account || null,
          memo: formData.memo || null,
          referrer_id: authState.user?.id,
          status: 'active',
          balance: 0,
          points: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error('❌ 회원 생성 DB 오류:', insertError);
        toast.error(`DB 저장 실패: ${insertError.message}`);
        return;
      }

      console.log('✅ DB 회원 생성 완료:', newUser);
      toast.success(`회원 ${formData.username}이 성공적으로 생성되었습니다.`);
      
      setShowCreateDialog(false);
      setFormData({
        username: '',
        nickname: '',
        password: '',
        bank_name: '',
        bank_account: '',
        memo: ''
      });
      
      await fetchUsers();
    } catch (error: any) {
      console.error('❌ 회원 생성 전체 오류:', error);
      toast.error(error.message || '회원 생성에 실패했습니다.');
    }
  };

  // 회원 승인
  const approveUser = async (userId: string, username: string) => {
    // 사용자 정보 조회 (referrer 정보 포함)
    const user = users.find(u => u.id === userId);
    if (!user) {
      toast.error('사용자 정보를 찾을 수 없습니다.');
      return;
    }

    // Optimistic Update
    setUsers(prevUsers => 
      prevUsers.map(u => 
        u.id === userId 
          ? { ...u, status: 'active', updated_at: new Date().toISOString() }
          : u
      )
    );

    try {
      setProcessingUserId(userId);
      console.log('✅ 회원 승인 처리 시작:', username);

      // 1. 외부 API 서버에 계정 생성 (동기화)
      const opcode = user.referrer?.opcode || '';
      const secretKey = user.referrer?.secret_key || '';

      if (!opcode || !secretKey) {
        console.warn('⚠️ 파트너 API 설정이 없어 외부 API 동기화 스킵');
      } else {
        console.log('🌐 외부 API 서버에 계정 생성 요청:', { opcode, username });
        
        const apiResult = await investApi.createAccount(opcode, username, secretKey);
        
        if (apiResult.error) {
          // API 오류 발생 시 롤백
          setUsers(prevUsers => 
            prevUsers.map(u => 
              u.id === userId 
                ? { ...u, status: 'pending' }
                : u
            )
          );
          toast.error(`외부 API 동기화 실패: ${apiResult.error}`);
          console.error('❌ 외부 API 계정 생성 실패:', apiResult.error);
          return;
        }

        console.log('✅ 외부 API 계정 생성 성공:', apiResult.data);
      }

      // 2. DB에 승인 상태 업데이트
      const { error } = await supabase
        .from('users')
        .update({ 
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        // 에러 발생 시 롤백
        setUsers(prevUsers => 
          prevUsers.map(u => 
            u.id === userId 
              ? { ...u, status: 'pending' }
              : u
          )
        );
        console.error('❌ 회원 승인 DB 오류:', error);
        throw error;
      }

      toast.success(`회원 ${username}이 승인되었습니다. (외부 API 동기화 완료)`);
      // fetchUsers() 제거 - Realtime subscription이 자동으로 처리
    } catch (error: any) {
      console.error('회원 승인 실패:', error);
      toast.error(error.message || '회원 승인에 실패했습니다.');
    } finally {
      setProcessingUserId(null);
    }
  };

  // 회원 거절
  const rejectUser = async (userId: string, username: string) => {
    const user = users.find(u => u.id === userId);
    
    // Optimistic Update - 거절된 회원은 blocked 상태이므로 리스트에서 제거됨
    setUsers(prevUsers => prevUsers.filter(u => u.id !== userId));

    try {
      setProcessingUserId(userId);
      console.log('❌ 회원 가입 거절:', username);

      const { error } = await supabase
        .from('users')
        .update({ 
          status: 'blocked',
          memo: (user?.memo || '') + ' [가입 거절됨]',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        // 에러 발생 시 롤백
        if (user) {
          setUsers(prevUsers => [...prevUsers, user]);
        }
        console.error('❌ 회원 거절 오류:', error);
        throw error;
      }

      toast.success(`회원 ${username}의 가입이 거절되었습니다.`);
      // fetchUsers() 제거 - Realtime subscription이 자동으로 처리
    } catch (error: any) {
      console.error('회원 거절 실패:', error);
      toast.error(error.message || '회원 거절에 실패했습니다.');
    } finally {
      setProcessingUserId(null);
    }
  };

  // 회원 삭제
  const handleDeleteUser = async () => {
    if (!deleteUser) return;

    const userToDelete = deleteUser;
    
    // Optimistic Update - 즉시 리스트에서 제거
    setUsers(prevUsers => prevUsers.filter(u => u.id !== deleteUser.id));
    setShowDeleteDialog(false);

    try {
      setDeleteLoading(true);
      console.log('🗑️ 회원 삭제 처리:', deleteUser.username);

      // 1. 관련 데이터 정리 (외래키 제약조건 순서에 따라 삭제)
      
      // 1-1. 게임 세션 삭제 (user_sessions 테이블 사용)
      const { error: sessionError } = await supabase
        .from('user_sessions')
        .delete()
        .eq('user_id', deleteUser.id);

      if (sessionError) {
        console.warn('⚠️ 게임 세션 삭제 중 오류:', sessionError);
      }

      // 1-2. 메시지 큐 삭제 (sender_id 또는 target_id로 삭제)
      const { error: messageSenderError } = await supabase
        .from('message_queue')
        .delete()
        .eq('sender_id', deleteUser.id);

      if (messageSenderError) {
        console.warn('⚠️ 메시지 큐 (발송자) 삭제 중 오류:', messageSenderError);
      }

      const { error: messageTargetError } = await supabase
        .from('message_queue')
        .delete()
        .eq('target_id', deleteUser.id);

      if (messageTargetError) {
        console.warn('⚠️ 메시지 큐 (수신자) 삭제 중 오류:', messageTargetError);
      }

      // 1-3. 알림 삭제 (recipient_id 사용)
      const { error: notificationError } = await supabase
        .from('notifications')
        .delete()
        .eq('recipient_id', deleteUser.id);

      if (notificationError) {
        console.warn('⚠️ 알림 삭제 중 오류:', notificationError);
      }

      // 1-4. realtime_notifications 삭제
      const { error: realtimeNotifError } = await supabase
        .from('realtime_notifications')
        .delete()
        .eq('recipient_id', deleteUser.id);

      if (realtimeNotifError) {
        console.warn('⚠️ 실시간 알림 삭제 중 오류:', realtimeNotifError);
      }

      // 1-5. 트랜잭션 삭제 (외래키 제약조건 해결)
      const { error: transactionError } = await supabase
        .from('transactions')
        .delete()
        .eq('user_id', deleteUser.id);

      if (transactionError) {
        console.error('❌ 트랜잭션 삭제 중 오류:', transactionError);
        // 트랜잭션 삭제 실패 시 롤백
        setUsers(prevUsers => [...prevUsers, userToDelete]);
        toast.error('회원의 거래 내역 삭제에 실패했습니다.');
        setShowDeleteDialog(true);
        return;
      }

      // 1-6. 게임 기록 삭제
      const { error: gameRecordError } = await supabase
        .from('game_records')
        .delete()
        .eq('user_id', deleteUser.id);

      if (gameRecordError) {
        console.warn('⚠️ 게임 기록 삭제 중 오류:', gameRecordError);
      }

      // 2. 사용자 계정 삭제
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', deleteUser.id);

      if (error) {
        // 에러 발생 시 롤백
        setUsers(prevUsers => [...prevUsers, userToDelete]);
        console.error('❌ 회원 삭제 오류:', error);
        throw error;
      }

      console.log('✅ 회원 삭제 완료:', deleteUser.username);
      toast.success(`회원 ${deleteUser.username}이 삭제되었습니다.`);
      setDeleteUser(null);
      // fetchUsers() 제거 - Realtime subscription이 자동으로 처리
    } catch (error: any) {
      console.error('회원 삭제 실패:', error);
      toast.error(error.message || '회원 삭제에 실패했습니다.');
      setShowDeleteDialog(true); // 에러 발생 시 다시 다이얼로그 표시
    } finally {
      setDeleteLoading(false);
    }
  };

  // 강제 입출금 처리
  const handleForceTransaction = async (data: {
    targetId: string;
    type: 'deposit' | 'withdrawal';
    amount: number;
    memo: string;
  }) => {
    try {
      setProcessingUserId(data.targetId);
      const user = users.find(u => u.id === data.targetId);
      if (!user) {
        toast.error('사용자를 찾을 수 없습니다.');
        return;
      }

      console.log(`💰 강제 ${data.type === 'deposit' ? '입금' : '출금'} 처리 시작:`, user.username, data.amount);

      // 0. 현재 관리자의 opcode 정보 조회
      if (!authState.user) {
        toast.error('로그인 정보가 없습니다.');
        return;
      }

      // 관리자 정보 조회 (보유금 검증용)
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

      // 입금 시 관리자 보유금 검증 (시스템관리자는 제외)
      if (data.type === 'deposit' && !isSystemAdmin && adminPartner.balance < data.amount) {
        toast.error(`관리자 보유금이 부족합니다. (현재: ${adminPartner.balance.toLocaleString()}원)`);
        return;
      }

      const opcodeConfigResult = await getAdminOpcode(authState.user);
      if (!opcodeConfigResult) {
        toast.error('관리자 API 설정을 찾을 수 없습니다.');
        console.error('❌ opcodeConfig가 없습니다. partners 테이블에 opcode, api_token, secret_key를 설정하세요.');
        return;
      }

      // isMultipleOpcode인 경우 첫 번째 opcode 사용
      const opcodeConfig = isMultipleOpcode(opcodeConfigResult) 
        ? opcodeConfigResult.opcodes[0] 
        : opcodeConfigResult;

      if (!opcodeConfig) {
        toast.error('사용 가능한 OPCODE가 없습니다.');
        return;
      }

      // 1. 외부 API 호출
      const apiResult = data.type === 'deposit'
        ? await investApi.depositBalance(
            user.username,
            data.amount,
            opcodeConfig.opcode,
            opcodeConfig.token,
            opcodeConfig.secretKey
          )
        : await investApi.withdrawBalance(
            user.username,
            data.amount,
            opcodeConfig.opcode,
            opcodeConfig.token,
            opcodeConfig.secretKey
          );

      if (!apiResult.success || apiResult.error) {
        toast.error(`API ${data.type === 'deposit' ? '입금' : '출금'} 실패: ${apiResult.error || '알 수 없는 오류'}`);
        console.error(`API ${data.type === 'deposit' ? '입금' : '출금'} 실패:`, apiResult.error);
        return;
      }

      console.log(`✅ API ${data.type === 'deposit' ? '입금' : '출금'} 성공:`, apiResult.data);

      // 2. API 응답에서 실제 잔고 추출
      const actualBalance = investApi.extractBalanceFromResponse(apiResult.data, user.username);
      console.log('💰 실제 잔고:', actualBalance);

      // 3. DB에 트랜잭션 기록
      const { error } = await supabase
        .from('transactions')
        .insert({
          user_id: user.id,
          partner_id: authState.user?.id,
          transaction_type: data.type === 'deposit' ? 'admin_deposit' : 'admin_withdrawal',
          amount: data.amount,
          status: 'completed',
          processed_by: authState.user?.id,
          memo: data.memo || `[관리자 강제 ${data.type === 'deposit' ? '입금' : '출금'}] ${authState.user?.username}`,
          balance_before: user.balance || 0,
          balance_after: actualBalance,
          external_response: apiResult.data
        });

      if (error) throw error;

      // 4. 사용자 잔고를 API 실제 값으로 동기화
      const { error: balanceError } = await supabase
        .from('users')
        .update({ 
          balance: actualBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (balanceError) throw balanceError;

      // 5. 관리자 보유금 업데이트 및 로그 기록 (level 1 포함)
      let adminNewBalance = adminPartner.balance;

      if (data.type === 'deposit') {
        // 입금: 관리자 보유금 차감 (level 1 포함)
        adminNewBalance = adminPartner.balance - data.amount;
        await supabase
          .from('partners')
          .update({ balance: adminNewBalance, updated_at: new Date().toISOString() })
          .eq('id', authState.user.id);

        // 관리자 보유금 로그 기록
        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: authState.user.id,
            balance_before: adminPartner.balance,
            balance_after: adminNewBalance,
            amount: -data.amount,
            transaction_type: 'withdrawal',
            from_partner_id: authState.user.id,
            to_partner_id: null,
            processed_by: authState.user.id,
            memo: `[회원 강제입금] ${user.username}에게 ${data.amount.toLocaleString()}원 입금${data.memo ? `: ${data.memo}` : ''}`
          });

        console.log(`💸 관리자 보유금 차감: ${adminPartner.balance.toLocaleString()}원 → ${adminNewBalance.toLocaleString()}원`);

      } else {
        // 출금: 관리자 보유금 증가 (level 1 포함)
        adminNewBalance = adminPartner.balance + data.amount;
        await supabase
          .from('partners')
          .update({ balance: adminNewBalance, updated_at: new Date().toISOString() })
          .eq('id', authState.user.id);

        // 관리자 보유금 로그 기록
        await supabase
          .from('partner_balance_logs')
          .insert({
            partner_id: authState.user.id,
            balance_before: adminPartner.balance,
            balance_after: adminNewBalance,
            amount: data.amount,
            transaction_type: 'deposit',
            from_partner_id: null,
            to_partner_id: authState.user.id,
            processed_by: authState.user.id,
            memo: `[회원 강제출금] ${user.username}으로부터 ${data.amount.toLocaleString()}원 회수${data.memo ? `: ${data.memo}` : ''}`
          });

        console.log(`💰 관리자 보유금 증가: ${adminPartner.balance.toLocaleString()}원 → ${adminNewBalance.toLocaleString()}원`);
      }

      // 6. 실시간 업데이트 웹소켓 메시지
      if (connected && sendMessage) {
        sendMessage({
          type: 'user_balance_updated',
          data: {
            userId: user.id,
            amount: data.amount,
            type: data.type
          }
        });

        sendMessage({
          type: 'partner_balance_updated',
          data: {
            partnerId: authState.user.id,
            amount: data.type === 'deposit' ? -data.amount : data.amount,
            type: data.type === 'deposit' ? 'withdrawal' : 'deposit'
          }
        });
      }

      toast.success(`${user.username}님에게서 ${data.amount.toLocaleString()}원이 ${data.type === 'deposit' ? '입금' : '출금'}되었습니다.`);
      await fetchUsers();
    } catch (error: any) {
      console.error('강제 입출금 처리 실패:', error);
      toast.error(error.message || '강제 입출금 처리에 실패했습니다.');
      throw error;
    } finally {
      setProcessingUserId(null);
    }
  };

  // 강제 입출금 버튼 클릭
  const handleDepositClick = (user: any) => {
    setForceTransactionTarget(user);
    setForceTransactionType('deposit');
    setShowForceTransactionModal(true);
  };

  const handleWithdrawClick = (user: any) => {
    setForceTransactionTarget(user);
    setForceTransactionType('withdrawal');
    setShowForceTransactionModal(true);
  };

  // 회원 차단/해제 (팝업 없이 바로 실행) - suspended 상태 사용
  const handleToggleSuspend = async (user: any) => {
    if (!user) return;

    const isSuspended = user.status === 'suspended';
    const newStatus = isSuspended ? 'active' : 'suspended';

    // Optimistic Update: UI를 즉시 업데이트
    const newMemo = isSuspended 
      ? (user.memo || '').replace(/\s*\[차단됨.*?\]/g, '')
      : (user.memo || '') + ` [차단됨: 관리자 조치]`;
    
    setUsers(prevUsers => 
      prevUsers.map(u => 
        u.id === user.id 
          ? { ...u, status: newStatus, memo: newMemo, updated_at: new Date().toISOString() }
          : u
      )
    );

    try {
      setProcessingUserId(user.id);
      console.log('🚫 회원 차단/해제:', user.username, newStatus);

      const { error } = await supabase
        .from('users')
        .update({ 
          status: newStatus,
          memo: newMemo,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        // 에러 발생 시 롤백
        setUsers(prevUsers => 
          prevUsers.map(u => 
            u.id === user.id 
              ? { ...u, status: user.status, memo: user.memo }
              : u
          )
        );
        throw error;
      }

      toast.success(`${user.username}님이 ${isSuspended ? '차단 해제' : '차단'}되었습니다.`);
      // fetchUsers() 제거 - Realtime subscription이 자동으로 처리
    } catch (error: any) {
      console.error('회원 차단/해제 실패:', error);
      toast.error(error.message || '회원 차단/해제에 실패했습니다.');
    } finally {
      setProcessingUserId(null);
    }
  };

  // 블랙리스트 추가/제거 (팝업 없이 바로 실행)
  const handleToggleBlacklist = async (user: any) => {
    if (!user) return;

    const isCurrentlyBlocked = user.status === 'blocked';

    // Optimistic Update: 블랙리스트 추가 시 즉시 리스트에서 제거
    if (!isCurrentlyBlocked) {
      setUsers(prevUsers => prevUsers.filter(u => u.id !== user.id));
    }

    try {
      setProcessingUserId(user.id);
      console.log('🚨 블랙리스트 처리:', user.username);

      if (isCurrentlyBlocked) {
        // 블랙리스트에서 해제
        const { data, error } = await supabase
          .rpc('remove_user_from_blacklist_simple', {
            p_user_id: user.id,
            p_admin_id: authState.user?.id
          });

        if (error) throw error;
        
        const result = Array.isArray(data) ? data[0] : data;
        if (!result.success) {
          throw new Error(result.error);
        }

        toast.success(`${user.username}님이 블랙리스트에서 해제되었습니다.`);
      } else {
        // 블랙리스트에 추가
        const { data, error } = await supabase
          .rpc('add_user_to_blacklist_simple', {
            p_user_id: user.id,
            p_admin_id: authState.user?.id,
            p_reason: '관리자 조치'
          });

        if (error) {
          // 에러 발생 시 롤백 - 다시 리스트에 추가
          setUsers(prevUsers => [...prevUsers, user]);
          throw error;
        }
        
        const result = Array.isArray(data) ? data[0] : data;
        if (!result.success) {
          // 에러 발생 시 롤백
          setUsers(prevUsers => [...prevUsers, user]);
          throw new Error(result.error);
        }

        toast.success(`${user.username}님이 블랙리스트에 추가되었습니다.`);
      }

      // fetchUsers() 제거 - Realtime subscription이 자동으로 처리
    } catch (error: any) {
      console.error('블랙리스트 처리 실패:', error);
      toast.error(error.message || '블랙리스트 처리에 실패했습니다.');
    } finally {
      setProcessingUserId(null);
    }
  };

  // useHierarchicalData가 자동으로 데이터를 로드함

  // WebSocket 메시지 처리
  useEffect(() => {
    if (lastMessage?.type === 'user_registered') {
      console.log('🔔 새 회원 가입 알림 수신');
      fetchUsers();
      toast.info('새로운 회원 가입 신청이 있습니다.');
    }
  }, [lastMessage, fetchUsers]);

  // 필터링된 사용자 목록 (블랙리스트만 제외, 차단은 포함)
  const filteredUsers = users.filter(user => {
    // 블랙리스트(blocked 상태)만 회원 관리 리스트에서 제외
    // 차단(suspended)은 표시됨
    if (user.status === 'blocked') {
      return false;
    }

    const matchesSearch = searchTerm === '' || 
      user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.nickname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.phone?.includes(searchTerm) ||
      user.bank_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.bank_account?.includes(searchTerm) ||
      user.balance?.toString().includes(searchTerm) ||
      user.points?.toString().includes(searchTerm) ||
      user.memo?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // 승인 대기 중인 사용자들
  const pendingUsers = users.filter(user => user.status === 'pending').slice(0, 5);

  // 테이블 컬럼 정의
  const columns = [
    {
      key: "username",
      header: "아이디",
    },
    {
      key: "nickname", 
      header: "닉네임",
    },
    {
      key: "referrer_info",
      header: "소속",
      cell: (row: any) => (
        <span className="text-sm text-slate-300">
          {row.referrer ? row.referrer.username : '미지정'}
        </span>
      )
    },
    {
      key: "status",
      header: "상태",
      cell: (row: any) => {
        if (row.status === 'active') {
          return (
            <Badge className="px-3 py-1 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-400 border border-emerald-500/50 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]">
              ● 승인됨
            </Badge>
          );
        } else if (row.status === 'pending') {
          return (
            <Badge className="px-3 py-1 bg-gradient-to-r from-orange-500/20 to-amber-500/20 text-orange-400 border border-orange-500/50 rounded-full shadow-[0_0_10px_rgba(251,146,60,0.5)]">
              ● 대기중
            </Badge>
          );
        } else if (row.status === 'suspended') {
          return (
            <Badge className="px-3 py-1 bg-gradient-to-r from-slate-500/20 to-gray-500/20 text-slate-400 border border-slate-500/50 rounded-full shadow-[0_0_10px_rgba(100,116,139,0.5)]">
              ● 차단됨
            </Badge>
          );
        } else {
          // blocked 상태는 표시되지 않음 (블랙리스트로 이동)
          return null;
        }
      }
    },
    {
      key: "balance",
      header: "보유금",
      cell: (row: any) => (
        <span className="font-mono font-semibold text-cyan-400">
          {(row.balance || 0).toLocaleString()}원
        </span>
      )
    },
    {
      key: "points",
      header: "포인트",
      cell: (row: any) => (
        <span className="font-mono font-semibold text-purple-400">
          {(row.points || 0).toLocaleString()}P
        </span>
      )
    },
    {
      key: "vip_level",
      header: "레벨",
      cell: (row: any) => {
        const level = row.vip_level || 0;
        
        if (level === 0) {
          return (
            <Badge className="px-3 py-1 bg-slate-700/50 text-slate-300 border border-slate-600/50 rounded-full">
              ○ Silver
            </Badge>
          );
        } else if (level === 1) {
          return (
            <Badge className="px-3 py-1 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 text-yellow-400 border border-yellow-500/50 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.5)]">
              ⚡ Gold
            </Badge>
          );
        } else if (level === 2) {
          return (
            <Badge className="px-3 py-1 bg-gradient-to-r from-orange-500/20 to-red-500/20 text-orange-400 border border-orange-500/50 rounded-full shadow-[0_0_10px_rgba(251,146,60,0.5)]">
              ⚡ Bronze
            </Badge>
          );
        } else {
          return (
            <Badge className="px-3 py-1 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border border-purple-500/50 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)]">
              ⚡ VIP
            </Badge>
          );
        }
      }
    },
    {
      key: "created_at",
      header: "가입일",
      cell: (row: any) => {
        const date = new Date(row.created_at);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return (
          <span className="text-slate-400 text-sm">
            {year}. {month}. {day}.
          </span>
        );
      }
    },
    {
      key: "last_login_at",
      header: "최근접속",
      cell: (row: any) => {
        if (!row.last_login_at) {
          return <span className="text-slate-500 text-sm">미접속</span>;
        }
        const date = new Date(row.last_login_at);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return (
          <span className="text-slate-400 text-sm">
            {year}. {month}. {day}.
          </span>
        );
      }
    },
    {
      key: "is_online",
      header: "접속",
      cell: (row: any) => {
        if (row.is_online) {
          return (
            <Badge className="bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0 animate-pulse">
              ● 온라인
            </Badge>
          );
        } else {
          return (
            <Badge className="bg-slate-600 text-slate-300 border-0">
              ○ 오프라인
            </Badge>
          );
        }
      }
    },
    {
      key: "created_at_old",
      header: "가입일",
      cell: (row: any) => new Date(row.created_at).toLocaleDateString('ko-KR')
    },
    {
      key: "actions",
      header: "관리",
      cell: (row: any) => {
        // 승인 대기 중인 사용자: 승인/거절 버튼만 표시
        if (row.status === 'pending') {
          return (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                onClick={() => approveUser(row.id, row.username)}
                disabled={processingUserId === row.id}
                className="btn-premium-success"
              >
                {processingUserId === row.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    승인
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={() => rejectUser(row.id, row.username)}
                disabled={processingUserId === row.id}
                className="btn-premium-danger"
              >
                {processingUserId === row.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <>
                    <X className="h-4 w-4 mr-1" />
                    거절
                  </>
                )}
              </Button>
            </div>
          );
        }

        // 승인된 사용자: 기존 관리 버튼들 표시
        return (
          <div className="flex items-center gap-1">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => {
                setDetailUser(row);
                setShowDetailModal(true);
              }}
              title="상세 정보"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => handleDepositClick(row)}
              className="text-green-600 hover:text-green-700"
              title="입금"
            >
              <DollarSign className="h-4 w-4" />
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => handleWithdrawClick(row)}
              className="text-red-600 hover:text-red-700"
              title="출금"
            >
              <DollarSign className="h-4 w-4" />
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => handleToggleSuspend(row)}
              disabled={processingUserId === row.id}
              className={row.status === 'suspended' ? 'text-blue-600 hover:text-blue-700' : 'text-orange-600 hover:text-orange-700'}
              title={row.status === 'suspended' ? '차단 해제' : '차단'}
            >
              {processingUserId === row.id ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : row.status === 'suspended' ? (
                <UserCheck className="h-4 w-4" />
              ) : (
                <UserX className="h-4 w-4" />
              )}
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => handleToggleBlacklist(row)}
              disabled={processingUserId === row.id}
              className="text-red-800 hover:text-red-900"
              title="블랙리스트 추가"
            >
              {processingUserId === row.id ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : (
                <UserX className="h-4 w-4" />
              )}
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => {
                setDeleteUser(row);
                setShowDeleteDialog(true);
              }}
              className="text-red-600 hover:text-red-700"
              title="회원 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      }
    }
  ];

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">회원 관리</h1>
          <p className="text-sm text-slate-400">
            시스템에 등록된 회원들을 관리합니다.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="btn-premium-primary">
          <Plus className="h-4 w-4 mr-2" />
          새 회원 생성
        </Button>
      </div>



      {/* 통계 카드 */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="전체 회원"
          value={users.length.toLocaleString()}
          subtitle="↑ 등록 회원 수"
          icon={Users}
          color="purple"
        />
        
        <MetricCard
          title="승인대기"
          value={pendingUsers.length.toLocaleString()}
          subtitle="대기 중인 회원"
          icon={Clock}
          color="amber"
        />
        
        <MetricCard
          title="활성 회원"
          value={users.filter(u => u.status === 'active').length.toLocaleString()}
          subtitle="정상 활동 회원"
          icon={UserCheck}
          color="green"
        />
        
        <MetricCard
          title="온라인"
          value={users.filter(u => u.is_online).length.toLocaleString()}
          subtitle="실시간 접속자"
          icon={Activity}
          color="cyan"
        />
      </div>

      {/* 회원 목록 */}
      <div className="glass-card rounded-xl p-6">
        {/* 헤더 및 통합 필터 */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
          <div>
            <h3 className="font-semibold text-slate-100 mb-1">회원 목록</h3>
            <p className="text-sm text-slate-400">
              총 {filteredUsers.length.toLocaleString()}명의 회원을 관리하고 있습니다
            </p>
          </div>
          
          {/* 통합 검색 및 필터 */}
          <div className="flex items-center gap-3">
            <div className="relative w-96">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="아이디, 닉네임, 이메일, 전화번호, 은행정보, 잔고, 포인트, 메모 검색"
                className="pl-10 input-premium"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] input-premium">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="상태 필터" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-slate-500"></div>
                    전체
                  </div>
                </SelectItem>
                <SelectItem value="pending">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    승인대기
                  </div>
                </SelectItem>
                <SelectItem value="active">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    활성
                  </div>
                </SelectItem>
                <SelectItem value="suspended">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-slate-500"></div>
                    차단
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* 테이블 (내부 검색 비활성화) */}
        <DataTable
          columns={columns}
          data={filteredUsers}
          searchable={false}
          emptyMessage={searchTerm ? "검색 결과가 없습니다." : "등록된 회원이 없습니다."}
        />
      </div>

      {/* 회원 생성 다이얼로그 - 유리모피즘 효과 적용 */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[500px] bg-slate-900/90 backdrop-blur-md border-slate-700/60 shadow-2xl shadow-blue-500/20">
          <DialogHeader>
            <DialogTitle className="text-xl text-slate-100 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">새 회원 생성</DialogTitle>
            <DialogDescription className="text-slate-400">
              새로운 회원을 시스템에 등록합니다. 외부 API와 연동됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="username" className="text-right text-slate-300">
                아이디
              </Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                className="col-span-3 input-premium focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
                placeholder="회원 아이디 입력"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="nickname" className="text-right text-slate-300">
                닉네임
              </Label>
              <Input
                id="nickname"
                value={formData.nickname}
                onChange={(e) => setFormData(prev => ({ ...prev, nickname: e.target.value }))}
                className="col-span-3 input-premium focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
                placeholder="회원 닉네임 입력"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="password" className="text-right text-slate-300">
                비밀번호
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                className="col-span-3 input-premium focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
                placeholder="초기 비밀번호 입력"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-300">
                은행명
              </Label>
              <Select 
                value={formData.bank_name || undefined} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, bank_name: value }))}
              >
                <SelectTrigger className="col-span-3 input-premium focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20">
                  <SelectValue placeholder="은행 선택" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {BANK_LIST.map(bank => (
                    <SelectItem key={bank} value={bank} className="text-slate-200 focus:bg-slate-700 focus:text-slate-100">{bank}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bank_account" className="text-right text-slate-300">
                계좌번호
              </Label>
              <Input
                id="bank_account"
                value={formData.bank_account}
                onChange={(e) => setFormData(prev => ({ ...prev, bank_account: e.target.value }))}
                className="col-span-3 input-premium focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
                placeholder="계좌번호 입력"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="memo" className="text-right text-slate-300">
                메모
              </Label>
              <Input
                id="memo"
                value={formData.memo}
                onChange={(e) => setFormData(prev => ({ ...prev, memo: e.target.value }))}
                className="col-span-3 input-premium focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
                placeholder="관리자 메모"
              />
            </div>
          </div>
          <DialogFooter className="gap-3">
            <Button 
              type="button" 
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
            >
              취소
            </Button>
            <Button 
              type="submit" 
              onClick={createUser}
              className="btn-premium-primary"
            >
              회원 생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 회원 삭제 확인 다이얼로그 */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[425px] bg-slate-900/90 backdrop-blur-md border-slate-700/60 shadow-2xl shadow-red-500/20">
          <DialogHeader>
            <DialogTitle className="text-xl text-slate-100">회원 삭제 확인</DialogTitle>
            <DialogDescription className="text-slate-400">
              정말로 회원 "{deleteUser?.username}"을(를) 삭제하시겠습니까?
              이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteLoading}
              className="bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
            >
              취소
            </Button>
            <Button
              onClick={handleDeleteUser}
              disabled={deleteLoading}
              className="btn-premium-danger"
            >
              {deleteLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  삭제 중...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  영구 삭제
                </>
              )}
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
        targetType="user"
        selectedTarget={forceTransactionTarget ? {
          id: forceTransactionTarget.id,
          username: forceTransactionTarget.username,
          nickname: forceTransactionTarget.nickname,
          balance: forceTransactionTarget.balance || 0
        } : null}
        onSubmit={handleForceTransaction}
        onTypeChange={setForceTransactionType}
      />

      {/* 사용자 상세 분석 모달 */}
      <UserDetailModal
        user={detailUser}
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setDetailUser(null);
        }}
      />
    </div>
  );
}

export default UserManagement;