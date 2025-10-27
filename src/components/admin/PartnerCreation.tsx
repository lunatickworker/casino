import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { 
  UserPlus, Save, Eye, EyeOff, Building2, Key, 
  Database, Shield, Trash2, Edit, RefreshCw, 
  AlertCircle, CheckCircle, Users 
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";
import { investApi } from "../../lib/investApi";
import { createAccount } from "../../lib/investApi";

interface PartnerFormData {
  username: string;
  nickname: string;
  password: string;
  partner_type: string;
  parent_id: string;
  level: number;
  opcode: string;
  secret_key: string;
  api_token: string;
  commission_rolling: number;
  commission_losing: number;
  withdrawal_fee: number;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  contact_info: string;
  selected_head_office_id?: string; // 시스템 관리자용 대본사 선택
}

interface PartnerCreationProps {
  user: Partner;
}

export function PartnerCreation({ user }: PartnerCreationProps) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [headOffices, setHeadOffices] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [apiTesting, setApiTesting] = useState<{ [key: string]: boolean }>({});
  
  const [formData, setFormData] = useState<PartnerFormData>({
    username: '',
    nickname: '',
    password: '',
    partner_type: 'head_office',
    parent_id: user.id,
    level: 2,
    opcode: '',
    secret_key: '',
    api_token: '',
    commission_rolling: 0.5,
    commission_losing: 5.0,
    withdrawal_fee: 1.0,
    bank_name: '',
    bank_account: '',
    bank_holder: '',
    contact_info: '',
  });

  const partnerTypes = [
    { value: 'head_office', label: '대본사', level: 2 },
    { value: 'main_office', label: '본사', level: 3 },
    { value: 'sub_office', label: '부본사', level: 4 },
    { value: 'distributor', label: '총판', level: 5 },
    { value: 'store', label: '매장', level: 6 },
  ];

  useEffect(() => {
    loadPartners();
    if (user.partner_type === 'system_admin') {
      loadHeadOffices();
    }
  }, []);

  const loadPartners = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('partners')
        .select('*')
        .order('created_at', { ascending: false });

      // 시스템관리자가 아니면 본인과 하위 파트너만 조회
      if (user.level > 1) {
        query = query.or(`parent_id.eq.${user.id},id.eq.${user.id}`);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPartners(data || []);
    } catch (error) {
      console.error('파트너 로드 실패:', error);
      toast.error('파트너 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadHeadOffices = async () => {
    try {
      const { data, error } = await supabase
        .from('partners')
        .select('id, username, nickname, opcode, secret_key, api_token')
        .eq('partner_type', 'head_office')
        .eq('status', 'active')
        .not('opcode', 'is', null)
        .not('secret_key', 'is', null)
        .not('api_token', 'is', null)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setHeadOffices(data || []);
    } catch (error) {
      console.error('대본사 로드 실패:', error);
    }
  };

  const handleInputChange = (field: keyof PartnerFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // 파트너 타입 변경 시 레벨 자동 설정
    if (field === 'partner_type') {
      const selectedType = partnerTypes.find(type => type.value === value);
      if (selectedType) {
        setFormData(prev => ({ ...prev, level: selectedType.level }));
      }
    }
  };

  const testApiConnection = async (opcode: string, secretKey: string) => {
    const testKey = `${opcode}_${secretKey}`;
    setApiTesting(prev => ({ ...prev, [testKey]: true }));
    
    try {
      const response = await investApi.getInfo(opcode, secretKey);
      
      if (response.data && !response.error) {
        toast.success('API 연결 테스트가 성공했습니다.');
        return true;
      } else {
        toast.error(`API 연결 실패: ${response.error || '알 수 없는 오류'}`);
        return false;
      }
    } catch (error: any) {
      console.error('API 테스트 실패:', error);
      toast.error(`API 연결 실패: ${error.message}`);
      return false;
    } finally {
      setApiTesting(prev => ({ ...prev, [testKey]: false }));
    }
  };

  const validateForm = () => {
    if (!formData.username.trim()) {
      toast.error('아이디를 입력해주세요.');
      return false;
    }
    if (!formData.nickname.trim()) {
      toast.error('닉네임을 입력해주세요.');
      return false;
    }
    if (!formData.password.trim() || formData.password.length < 6) {
      toast.error('비밀번호는 6자 이상 입력해주세요.');
      return false;
    }
    if (formData.partner_type === 'head_office' && (!formData.opcode.trim() || !formData.secret_key.trim())) {
      toast.error('대본사는 OPCODE와 Secret Key가 필수입니다.');
      return false;
    }
    return true;
  };

  // 상위로 재귀하여 opcode 조회
  const getOpcodeRecursive = async (partnerId: string): Promise<{ opcode: string; secretKey: string; token: string } | null> => {
    let currentPartnerId = partnerId;
    let attempts = 0;
    const maxAttempts = 10;

    while (currentPartnerId && attempts < maxAttempts) {
      const { data: partnerData, error } = await supabase
        .from('partners')
        .select('id, partner_type, opcode, secret_key, api_token, parent_id')
        .eq('id', currentPartnerId)
        .single();

      if (error || !partnerData) break;

      if (partnerData.partner_type === 'head_office' && partnerData.opcode && partnerData.secret_key && partnerData.api_token) {
        return {
          opcode: partnerData.opcode,
          secretKey: partnerData.secret_key,
          token: partnerData.api_token
        };
      }

      currentPartnerId = partnerData.parent_id;
      attempts++;
    }

    return null;
  };

  const savePartner = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      // 대본사인 경우 API 연결 테스트
      if (formData.partner_type === 'head_office') {
        const apiTestResult = await testApiConnection(formData.opcode, formData.secret_key);
        if (!apiTestResult) {
          setSaving(false);
          return;
        }
      }

      // 실제 parent_id 결정 (시스템 관리자가 대본사 선택한 경우)
      let actualParentId = formData.parent_id;
      if (user.partner_type === 'system_admin' && formData.selected_head_office_id) {
        actualParentId = formData.selected_head_office_id;
      }

      // 비밀번호 해시화는 데이터베이스 함수에서 처리
      const partnerData = {
        username: formData.username,
        nickname: formData.nickname,
        password: formData.password,
        partner_type: formData.partner_type,
        parent_id: actualParentId,
        level: formData.level,
        opcode: formData.partner_type === 'head_office' ? formData.opcode : null,
        secret_key: formData.partner_type === 'head_office' ? formData.secret_key : null,
        api_token: formData.partner_type === 'head_office' ? formData.api_token : null,
        commission_rolling: formData.commission_rolling,
        commission_losing: formData.commission_losing,
        withdrawal_fee: formData.withdrawal_fee,
        bank_name: formData.bank_name,
        bank_account: formData.bank_account,
        bank_holder: formData.bank_holder,
        contact_info: formData.contact_info ? JSON.parse(`{"memo": "${formData.contact_info}"}`) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: newPartner, error } = await supabase
        .from('partners')
        .insert([partnerData])
        .select()
        .single();

      if (error) throw error;

      // 외부 API 계정 생성
      let opcodeInfo: { opcode: string; secretKey: string; token: string } | null = null;
      
      // 대본사를 생성하는 경우, formData의 opcode/secret_key 사용
      if (formData.partner_type === 'head_office' && formData.opcode && formData.secret_key) {
        opcodeInfo = {
          opcode: formData.opcode,
          secretKey: formData.secret_key,
          token: formData.api_token || '' // token은 선택사항
        };
        console.log('🏢 대본사 생성 - formData의 opcode 사용:', opcodeInfo.opcode);
      } else {
        // 하위 파트너를 생성하는 경우, 상위로 재귀하여 opcode 조회
        opcodeInfo = await getOpcodeRecursive(actualParentId);
        console.log('👥 하위 파트너 생성 - 상위 opcode 조회 결과:', opcodeInfo ? opcodeInfo.opcode : 'null');
      }
      
      if (opcodeInfo) {
        const apiUsername = formData.username.replace(/^btn_/, '');
        
        console.log('📡 외부 API 계정 생성 시작:', {
          opcode: opcodeInfo.opcode,
          username: apiUsername,
          originalUsername: formData.username
        });
        
        const apiResult = await createAccount(
          opcodeInfo.opcode,
          apiUsername,
          opcodeInfo.secretKey
        );

        if (apiResult.error) {
          console.warn('❌ 외부 API 계정 생성 실패:', apiResult.error);
          toast.warning(`파트너는 생성되었으나 외부 API 연동 실패: ${apiResult.error}`);
        } else {
          console.log('✅ 외부 API 계정 생성 성공:', apiResult.data);
          toast.success('파트너와 외부 API 계정이 성공적으로 생성되었습니다.');
        }
      } else {
        console.warn('⚠️ 상위 OPCODE를 찾을 수 없어 외부 API 계정 생성을 건너뜁니다.');
        toast.success('파트너가 성공적으로 생성되었습니다. (외부 API 연동 없음)');
      }
      
      // 폼 초기화
      setFormData({
        username: '',
        nickname: '',
        password: '',
        partner_type: 'head_office',
        parent_id: user.id,
        level: 2,
        opcode: '',
        secret_key: '',
        api_token: '',
        commission_rolling: 0.5,
        commission_losing: 5.0,
        withdrawal_fee: 1.0,
        bank_name: '',
        bank_account: '',
        bank_holder: '',
        contact_info: '',
        selected_head_office_id: undefined,
      });
      
      await loadPartners();
    } catch (error: any) {
      console.error('파트너 생성 실패:', error);
      toast.error(`파트너 생성 실패: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deletePartner = async (partnerId: string) => {
    if (!confirm('정말로 이 파트너를 삭제하시겠습니까?')) return;

    try {
      const { error } = await supabase
        .from('partners')
        .delete()
        .eq('id', partnerId);

      if (error) throw error;

      toast.success('파트너가 성공적으로 삭제되었습니다.');
      await loadPartners();
    } catch (error: any) {
      console.error('파트너 삭제 실패:', error);
      toast.error(`파트너 삭제 실패: ${error.message}`);
    }
  };

  const getPartnerLevelText = (level: number) => {
    const levelMap: { [key: number]: string } = {
      1: '시스템관리자',
      2: '대본사',
      3: '본사',
      4: '부본사',
      5: '총판',
      6: '매장'
    };
    return levelMap[level] || '알 수 없음';
  };

  const partnerColumns = [
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
      key: "level",
      title: "등급",
      cell: (partner: Partner) => (
        <Badge variant={partner.level === 2 ? 'default' : 'secondary'}>
          {getPartnerLevelText(partner.level)}
        </Badge>
      ),
    },
    {
      key: "opcode",
      title: "OPCODE",
      cell: (partner: Partner) => (
        <div className="font-mono text-sm">
          {partner.opcode || '-'}
        </div>
      ),
    },
    {
      key: "status",
      title: "상태",
      cell: (partner: Partner) => (
        <Badge variant={partner.status === 'active' ? 'default' : 'secondary'}>
          {partner.status === 'active' ? '활성' : '비활성'}
        </Badge>
      ),
    },
    {
      key: "balance",
      title: "보유금",
      cell: (partner: Partner) => (
        <div className="text-right font-mono">
          {new Intl.NumberFormat('ko-KR').format(partner.balance || 0)}원
        </div>
      ),
    },
    {
      key: "created_at",
      title: "생성일",
      cell: (partner: Partner) => (
        <div className="text-sm text-muted-foreground">
          {new Date(partner.created_at).toLocaleDateString('ko-KR')}
        </div>
      ),
    },
    {
      key: "actions",
      title: "관리",
      cell: (partner: Partner) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => deletePartner(partner.id)}
            className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
            disabled={partner.id === user.id}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
          >
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">대본사 생성</h1>
          <p className="text-sm text-slate-400">
            새로운 파트너를 생성하고 OPCODE를 설정하여 외부 API와 연동합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadPartners} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              새 파트너 생성
            </CardTitle>
            <CardDescription>
              파트너 정보를 입력하고 권한을 설정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">아이디</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="파트너 아이디"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nickname">닉네임</Label>
                <Input
                  id="nickname"
                  value={formData.nickname}
                  onChange={(e) => handleInputChange('nickname', e.target.value)}
                  placeholder="표시될 닉네임"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="password">비밀번호</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="비밀번호 (6자 이상)"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="partner_type">파트너 등급</Label>
                <Select value={formData.partner_type} onValueChange={(value) => handleInputChange('partner_type', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="등급 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {partnerTypes
                      .filter(type => {
                        // ✅ 시스템관리자(level 1)는 모든 파트너 등급 생성 가능
                        if (user.level === 1) return true;
                        // 다른 레벨은 자신보다 하위 레벨만 생성 가능
                        return type.level > user.level;
                      })
                      .map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label} (Level {type.level})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>레벨</Label>
                <Input
                  value={`Level ${formData.level}`}
                  readOnly
                  className="bg-muted"
                />
              </div>
            </div>

            {user.partner_type === 'system_admin' && formData.partner_type !== 'head_office' && headOffices.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="selected_head_office">소속 대본사 선택</Label>
                <Select 
                  value={formData.selected_head_office_id || ''} 
                  onValueChange={(value) => handleInputChange('selected_head_office_id', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="대본사를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {headOffices.map((ho) => (
                      <SelectItem key={ho.id} value={ho.id}>
                        {ho.nickname || ho.username} (OPCODE: {ho.opcode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.partner_type === 'head_office' && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  <span className="font-medium">외부 API 설정</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="opcode">OPCODE</Label>
                    <Input
                      id="opcode"
                      value={formData.opcode}
                      onChange={(e) => handleInputChange('opcode', e.target.value)}
                      placeholder="외부 API OPCODE"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="secret_key">Secret Key</Label>
                    <Input
                      id="secret_key"
                      value={formData.secret_key}
                      onChange={(e) => handleInputChange('secret_key', e.target.value)}
                      placeholder="외부 API Secret Key"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="api_token">API Token</Label>
                    <Input
                      id="api_token"
                      value={formData.api_token}
                      onChange={(e) => handleInputChange('api_token', e.target.value)}
                      placeholder="API Token (선택사항)"
                    />
                  </div>

                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      onClick={() => testApiConnection(formData.opcode, formData.secret_key)}
                      disabled={!formData.opcode || !formData.secret_key || apiTesting[`${formData.opcode}_${formData.secret_key}`]}
                      className="w-full"
                    >
                      {apiTesting[`${formData.opcode}_${formData.secret_key}`] ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          테스트 중...
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4 mr-2" />
                          API 연결 테스트
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span className="font-medium">커미션 설정</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="commission_rolling">롤링 커미션 (%)</Label>
                  <Input
                    id="commission_rolling"
                    type="number"
                    step="0.1"
                    value={formData.commission_rolling}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      handleInputChange('commission_rolling', isNaN(value) ? 0 : value);
                    }}
                    placeholder="0.5"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="commission_losing">루징 커미션 (%)</Label>
                  <Input
                    id="commission_losing"
                    type="number"
                    step="0.1"
                    value={formData.commission_losing}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      handleInputChange('commission_losing', isNaN(value) ? 0 : value);
                    }}
                    placeholder="5.0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="withdrawal_fee">환전 수수료 (%)</Label>
                  <Input
                    id="withdrawal_fee"
                    type="number"
                    step="0.1"
                    value={formData.withdrawal_fee}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      handleInputChange('withdrawal_fee', isNaN(value) ? 0 : value);
                    }}
                    placeholder="1.0"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span className="font-medium">은행 정보</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bank_name">은행명</Label>
                  <Input
                    id="bank_name"
                    value={formData.bank_name}
                    onChange={(e) => handleInputChange('bank_name', e.target.value)}
                    placeholder="은행명"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bank_account">계좌번호</Label>
                  <Input
                    id="bank_account"
                    value={formData.bank_account}
                    onChange={(e) => handleInputChange('bank_account', e.target.value)}
                    placeholder="계좌번호"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bank_holder">예금주</Label>
                  <Input
                    id="bank_holder"
                    value={formData.bank_holder}
                    onChange={(e) => handleInputChange('bank_holder', e.target.value)}
                    placeholder="예금주명"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_info">연락처 정보</Label>
              <Textarea
                id="contact_info"
                value={formData.contact_info}
                onChange={(e) => handleInputChange('contact_info', e.target.value)}
                placeholder="연락처, 이메일 등 추가 정보를 입력하세요"
                rows={3}
              />
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={savePartner}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? '생성 중...' : '파트너 생성'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              파트너 목록
            </CardTitle>
            <CardDescription>
              생성된 파트너 목록을 확인하고 관리합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <DataTable
                data={partners}
                columns={partnerColumns}
                loading={loading}
                searchPlaceholder="파트너를 검색하세요..."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default PartnerCreation;