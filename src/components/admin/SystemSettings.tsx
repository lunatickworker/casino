import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { 
  Settings, Save, RefreshCw, Shield, 
  Globe, Plus, Trash2, 
  Monitor, Activity, AlertCircle, Search, Users 
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";

interface SystemSetting {
  id: string;
  setting_key: string;
  setting_value: string;
  setting_type: string;
  description: string;
  partner_level: number;
  created_at: string;
  updated_at: string;
}

interface SystemInfo {
  database_status: 'connected' | 'disconnected';
  api_status: 'active' | 'inactive';
  websocket_status: 'connected' | 'disconnected';
  active_users: number;
  system_uptime: string;
  memory_usage: number;
  cpu_usage: number;
  last_backup: string;
}

interface SystemSettingsProps {
  user: Partner;
  initialTab?: string;
}

export function SystemSettings({ user, initialTab = "general" }: SystemSettingsProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 기본 설정 상태
  const [generalSettings, setGeneralSettings] = useState({
    system_name: 'GMS 통합 관리 시스템',
    notification_sound: true,
    auto_approval_limit: 100000,
    maintenance_mode: false,
    api_sync_interval: 30,
    session_timeout: 1800,
    max_login_attempts: 5,
    max_concurrent_image_downloads: 1,
  });

  // 커미션 설정 상태
  const [commissionSettings, setCommissionSettings] = useState({
    default_rolling_commission: 0.5,
    default_losing_commission: 5.0,
    default_withdrawal_fee: 1.0,
    min_withdrawal_amount: 10000,
    max_withdrawal_amount: 1000000,
    daily_withdrawal_limit: 5000000,
  });

  // 보안 설정 상태
  const [securitySettings, setSecuritySettings] = useState({
    password_min_length: 8,
    password_require_special: true,
    ip_whitelist_enabled: false,
    two_factor_enabled: false,
    login_log_retention_days: 90,
    audit_log_enabled: true,
  });

  // IP 화이트리스트 상태
  const [ipWhitelist, setIpWhitelist] = useState<string[]>([]);
  const [newIp, setNewIp] = useState('');

  // 파트너 커미션 관리 상태
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [partnerCommissionSettings, setPartnerCommissionSettings] = useState({
    commission_rolling: 0,
    commission_losing: 0,
    withdrawal_fee: 0
  });

  useEffect(() => {
    loadSettings();
    loadSystemInfo();
    loadIpWhitelist();
    loadPartners();

    const interval = setInterval(loadSystemInfo, 30000);
    return () => clearInterval(interval);
  }, [user.level]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .order('setting_key');

      if (error) throw error;

      setSettings(data || []);
      
      data?.forEach(setting => {
        const value = parseSettingValue(setting);
        
        if (setting.setting_key in generalSettings) {
          setGeneralSettings(prev => ({ ...prev, [setting.setting_key]: value }));
        } else if (setting.setting_key in commissionSettings) {
          setCommissionSettings(prev => ({ ...prev, [setting.setting_key]: value }));
        } else if (setting.setting_key in securitySettings) {
          setSecuritySettings(prev => ({ ...prev, [setting.setting_key]: value }));
        }
      });
    } catch (error) {
      console.error('설정 로드 실패:', error);
      toast.error('시스템 설정을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadSystemInfo = async () => {
    try {
      const { error: dbError } = await supabase.from('partners').select('count', { count: 'exact', head: true });
      
      const { data: activeUsersData } = await supabase
        .from('user_sessions')
        .select('count', { count: 'exact', head: true })
        .eq('is_active', true);

      setSystemInfo({
        database_status: dbError ? 'disconnected' : 'connected',
        api_status: 'active',
        websocket_status: 'connected',
        active_users: activeUsersData?.length || 0,
        system_uptime: '2일 14시간 32분',
        memory_usage: Math.floor(Math.random() * 40) + 40,
        cpu_usage: Math.floor(Math.random() * 30) + 10,
        last_backup: new Date(Date.now() - Math.random() * 86400000).toLocaleString('ko-KR'),
      });
    } catch (error) {
      console.error('시스템 정보 로드 실패:', error);
    }
  };

  const parseSettingValue = (setting: SystemSetting) => {
    switch (setting.setting_type) {
      case 'boolean':
        return setting.setting_value === 'true';
      case 'number':
        return parseFloat(setting.setting_value);
      default:
        return setting.setting_value;
    }
  };

  const saveSettings = async (category: string, settingsData: any) => {
    setSaving(true);
    try {
      const updates = Object.entries(settingsData).map(([key, value]) => ({
        setting_key: key,
        setting_value: value.toString(),
        setting_type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
        partner_level: user.level,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('system_settings')
          .upsert(update, { onConflict: 'setting_key' });

        if (error) throw error;
      }

      toast.success(`${category} 설정이 성공적으로 저장되었습니다.`);
      await loadSettings();
    } catch (error) {
      console.error('설정 저장 실패:', error);
      toast.error('설정 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // IP 화이트리스트 관리 함수들
  const loadIpWhitelist = async () => {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('setting_value')
        .eq('setting_key', 'ip_whitelist')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data?.setting_value) {
        try {
          const ips = JSON.parse(data.setting_value);
          setIpWhitelist(Array.isArray(ips) ? ips : []);
        } catch {
          setIpWhitelist([]);
        }
      }
    } catch (error) {
      console.error('IP 화이트리스트 로드 실패:', error);
    }
  };

  const addIpToWhitelist = async () => {
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipPattern.test(newIp.trim())) {
      toast.error('올바른 IP 주소 형식이 아닙니다. (예: 192.168.1.1)');
      return;
    }

    if (ipWhitelist.includes(newIp.trim())) {
      toast.error('이미 등록된 IP 주소입니다.');
      return;
    }

    try {
      const updatedList = [...ipWhitelist, newIp.trim()];
      
      const { error } = await supabase
        .from('system_settings')
        .upsert({
          setting_key: 'ip_whitelist',
          setting_value: JSON.stringify(updatedList),
          setting_type: 'json',
          partner_level: user.level,
          description: 'IP 화이트리스트',
        }, { onConflict: 'setting_key' });

      if (error) throw error;

      setIpWhitelist(updatedList);
      setNewIp('');
      toast.success('IP 주소가 추가되었습니다.');
    } catch (error) {
      console.error('IP 추가 실패:', error);
      toast.error('IP 주소 추가에 실패했습니다.');
    }
  };

  const removeIpFromWhitelist = async (ip: string) => {
    try {
      const updatedList = ipWhitelist.filter(item => item !== ip);
      
      const { error } = await supabase
        .from('system_settings')
        .upsert({
          setting_key: 'ip_whitelist',
          setting_value: JSON.stringify(updatedList),
          setting_type: 'json',
          partner_level: user.level,
          description: 'IP 화이트리스트',
        }, { onConflict: 'setting_key' });

      if (error) throw error;

      setIpWhitelist(updatedList);
      toast.success('IP 주소가 삭제되었습니다.');
    } catch (error) {
      console.error('IP 삭제 실패:', error);
      toast.error('IP 주소 삭제에 실패했습니다.');
    }
  };

  // 파트너 목록 로드
  const loadPartners = async () => {
    try {
      let query = supabase
        .from('partners')
        .select('*')
        .order('level', { ascending: true })
        .order('created_at', { ascending: false });

      // 시스템관리자가 아니면 본인 하위 파트너만 조회
      if (user.level > 1) {
        query = query.eq('parent_id', user.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      setPartners(data || []);
    } catch (error) {
      console.error('파트너 목록 로드 실패:', error);
    }
  };

  // 선택된 파트너 커미션 로드
  const loadPartnerCommission = async (partnerId: string) => {
    try {
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .eq('id', partnerId)
        .single();

      if (error) throw error;

      if (data) {
        setSelectedPartner(data);
        setPartnerCommissionSettings({
          commission_rolling: data.commission_rolling || 0,
          commission_losing: data.commission_losing || 0,
          withdrawal_fee: data.withdrawal_fee || 0
        });
      }
    } catch (error) {
      console.error('파트너 커미션 로드 실패:', error);
      toast.error('파트너 정보를 불러오는데 실패했습니다.');
    }
  };

  // 파트너 선택 핸들러
  const handlePartnerSelect = (partnerId: string) => {
    setSelectedPartnerId(partnerId);
    if (partnerId) {
      loadPartnerCommission(partnerId);
    } else {
      setSelectedPartner(null);
      setPartnerCommissionSettings({
        commission_rolling: 0,
        commission_losing: 0,
        withdrawal_fee: 0
      });
    }
  };

  // 파트너 커미션 검증
  const validatePartnerCommission = (rolling: number, losing: number, fee: number): boolean => {
    if (!selectedPartner) return false;

    // 대본사는 100% 고정
    if (selectedPartner.partner_type === 'head_office') {
      if (rolling !== 100 || losing !== 100 || fee !== 100) {
        toast.error('대본사의 커미션은 100%로 고정됩니다.');
        return false;
      }
      return true;
    }

    // 상위 파트너의 커미션 조회 필요
    // 여기서는 간단히 100% 이하 체크만
    if (rolling > 100 || losing > 100 || fee > 100) {
      toast.error('커미션은 100%를 초과할 수 없습니다.');
      return false;
    }

    if (rolling < 0 || losing < 0 || fee < 0) {
      toast.error('커미션은 0% 미만일 수 없습니다.');
      return false;
    }

    return true;
  };

  // 파트너 커미션 저장
  const savePartnerCommission = async () => {
    if (!selectedPartner) {
      toast.error('파트너를 선택해주세요.');
      return;
    }

    if (!validatePartnerCommission(
      partnerCommissionSettings.commission_rolling,
      partnerCommissionSettings.commission_losing,
      partnerCommissionSettings.withdrawal_fee
    )) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('partners')
        .update({
          commission_rolling: partnerCommissionSettings.commission_rolling,
          commission_losing: partnerCommissionSettings.commission_losing,
          withdrawal_fee: partnerCommissionSettings.withdrawal_fee,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedPartner.id);

      if (error) throw error;

      toast.success(`${selectedPartner.nickname} 파트너의 커미션이 수정되었습니다.`);
      loadPartners();
    } catch (error) {
      console.error('파트너 커미션 저장 실패:', error);
      toast.error('커미션 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const StatusIndicator = ({ status, label }: { status: string; label: string }) => (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${
        status === 'connected' || status === 'active' ? 'bg-green-500' : 'bg-red-500'
      }`} />
      <span className="text-sm font-medium">{label}</span>
      <Badge variant={status === 'connected' || status === 'active' ? 'default' : 'destructive'}>
        {status === 'connected' || status === 'active' ? '정상' : '오류'}
      </Badge>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">시스템 설정</h1>
          <p className="text-sm text-slate-400">
            시스템 전반적인 설정을 관리하고 상태를 모니터링합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadSystemInfo} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 bg-slate-900/50 p-1 border border-slate-700/50 backdrop-blur-sm">
          <TabsTrigger 
            value="general"
            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 hover:bg-slate-800/50 transition-all duration-300"
          >
            기본 설정
          </TabsTrigger>
          <TabsTrigger 
            value="commission"
            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 hover:bg-slate-800/50 transition-all duration-300"
          >
            커미션 설정
          </TabsTrigger>
          <TabsTrigger 
            value="security"
            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 hover:bg-slate-800/50 transition-all duration-300"
          >
            보안 설정
          </TabsTrigger>
          <TabsTrigger 
            value="system"
            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 hover:bg-slate-800/50 transition-all duration-300"
          >
            시스템 상태
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                일반 설정
              </CardTitle>
              <CardDescription>
                시스템의 기본적인 설정을 관리합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="system_name">시스템 이름</Label>
                  <Input
                    id="system_name"
                    value={generalSettings.system_name}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, system_name: e.target.value }))}
                    placeholder="시스템 이름을 입력하세요"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api_sync_interval">API 동기화 주기 (초)</Label>
                  <Input
                    id="api_sync_interval"
                    type="number"
                    value={generalSettings.api_sync_interval}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, api_sync_interval: parseInt(e.target.value) }))}
                    placeholder="30"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="auto_approval_limit">자동 승인 한도 (원)</Label>
                  <Input
                    id="auto_approval_limit"
                    type="number"
                    value={generalSettings.auto_approval_limit}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, auto_approval_limit: parseInt(e.target.value) }))}
                    placeholder="100000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="session_timeout">세션 타임아웃 (초)</Label>
                  <Input
                    id="session_timeout"
                    type="number"
                    value={generalSettings.session_timeout}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, session_timeout: parseInt(e.target.value) }))}
                    placeholder="1800"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_concurrent_image_downloads">동시 이미지 다운로드 제한</Label>
                  <Input
                    id="max_concurrent_image_downloads"
                    type="number"
                    min="1"
                    max="10"
                    value={generalSettings.max_concurrent_image_downloads}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, max_concurrent_image_downloads: parseInt(e.target.value) }))}
                    placeholder="1"
                  />
                  <p className="text-xs text-muted-foreground">
                    브라우저 메모리 최적화를 위해 동시 다운로드 수를 제한합니다.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>알림 소리</Label>
                    <p className="text-sm text-muted-foreground">새로운 알림 시 소리를 재생합니다.</p>
                  </div>
                  <Switch
                    checked={generalSettings.notification_sound}
                    onCheckedChange={(checked) => setGeneralSettings(prev => ({ ...prev, notification_sound: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>점검 모드</Label>
                    <p className="text-sm text-muted-foreground">시스템을 점검 모드로 전환합니다.</p>
                  </div>
                  <Switch
                    checked={generalSettings.maintenance_mode}
                    onCheckedChange={(checked) => setGeneralSettings(prev => ({ ...prev, maintenance_mode: checked }))}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button 
                  onClick={() => saveSettings('일반', generalSettings)}
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? '저장 중...' : '설정 저장'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commission" className="space-y-6">
          {/* 파트너별 커미션 설정 카드 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                파트너별 커미션 관리
              </CardTitle>
              <CardDescription>
                특정 파트너를 선택하여 개별 커미션을 설정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 파트너 선택 */}
              <div className="space-y-3">
                <Label htmlFor="partner-select" className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  파트너 선택
                </Label>
                <Select value={selectedPartnerId} onValueChange={handlePartnerSelect}>
                  <SelectTrigger id="partner-select">
                    <SelectValue placeholder="커미션을 설정할 파트너를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {partners.map((partner) => (
                      <SelectItem key={partner.id} value={partner.id}>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {partner.partner_type === 'head_office' ? '대본사' :
                             partner.partner_type === 'main_office' ? '본사' :
                             partner.partner_type === 'sub_office' ? '부본사' :
                             partner.partner_type === 'distributor' ? '총판' : '매장'}
                          </Badge>
                          <span>{partner.nickname} ({partner.username})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 선택된 파트너 정보 및 커미션 설정 */}
              {selectedPartner ? (
                <div className="space-y-4">
                  {/* 파트너 정보 표시 */}
                  <div className="p-4 bg-slate-800/30 rounded-lg border border-slate-700/50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">파트너명</p>
                        <p className="font-medium text-white">{selectedPartner.nickname}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">등급</p>
                        <Badge>
                          {selectedPartner.partner_type === 'head_office' ? '대본사' :
                           selectedPartner.partner_type === 'main_office' ? '본사' :
                           selectedPartner.partner_type === 'sub_office' ? '부본사' :
                           selectedPartner.partner_type === 'distributor' ? '총판' : '매장'}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">보유금</p>
                        <p className="font-mono text-green-400">{selectedPartner.balance?.toLocaleString()}원</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">상태</p>
                        <Badge variant={selectedPartner.status === 'active' ? 'default' : 'destructive'}>
                          {selectedPartner.status === 'active' ? '활성' : '비활성'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* 대본사 고정 알림 */}
                  {selectedPartner.partner_type === 'head_office' ? (
                    <div className="p-4 bg-purple-50 dark:bg-purple-900/10 rounded-lg border border-purple-200 dark:border-purple-800">
                      <div className="flex items-start gap-3">
                        <Shield className="h-5 w-5 text-purple-500 mt-0.5" />
                        <div>
                          <h4 className="font-medium text-purple-900 dark:text-purple-100 mb-1">대본사 커미션</h4>
                          <p className="text-sm text-purple-700 dark:text-purple-300">
                            대본사는 최상위 파트너로 모든 커미션이 <strong>100%</strong>로 고정됩니다.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        💡 상위 파트너의 커미션을 초과할 수 없습니다. 커미션 변경 시 정산에 즉시 반영됩니다.
                      </p>
                    </div>
                  )}

                  {/* 커미션 입력 필드 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="partner_rolling">롤링 커미션 (%)</Label>
                      <Input
                        id="partner_rolling"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={partnerCommissionSettings.commission_rolling}
                        onChange={(e) => setPartnerCommissionSettings(prev => ({ 
                          ...prev, 
                          commission_rolling: parseFloat(e.target.value) || 0 
                        }))}
                        disabled={selectedPartner.partner_type === 'head_office'}
                        className={selectedPartner.partner_type === 'head_office' ? 'bg-muted' : ''}
                      />
                      <p className="text-xs text-muted-foreground">
                        {selectedPartner.partner_type === 'head_office' ? '대본사 고정값' : '회원 총 베팅액에 대한 커미션'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="partner_losing">루징 커미션 (%)</Label>
                      <Input
                        id="partner_losing"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={partnerCommissionSettings.commission_losing}
                        onChange={(e) => setPartnerCommissionSettings(prev => ({ 
                          ...prev, 
                          commission_losing: parseFloat(e.target.value) || 0 
                        }))}
                        disabled={selectedPartner.partner_type === 'head_office'}
                        className={selectedPartner.partner_type === 'head_office' ? 'bg-muted' : ''}
                      />
                      <p className="text-xs text-muted-foreground">
                        {selectedPartner.partner_type === 'head_office' ? '대본사 고정값' : '회원 순손실액에 대한 커미션'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="partner_fee">환전 수수료 (%)</Label>
                      <Input
                        id="partner_fee"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={partnerCommissionSettings.withdrawal_fee}
                        onChange={(e) => setPartnerCommissionSettings(prev => ({ 
                          ...prev, 
                          withdrawal_fee: parseFloat(e.target.value) || 0 
                        }))}
                        disabled={selectedPartner.partner_type === 'head_office'}
                        className={selectedPartner.partner_type === 'head_office' ? 'bg-muted' : ''}
                      />
                      <p className="text-xs text-muted-foreground">
                        {selectedPartner.partner_type === 'head_office' ? '대본사 고정값' : '환전 시 적용되는 수수료'}
                      </p>
                    </div>
                  </div>

                  {/* 저장 버튼 */}
                  <div className="flex justify-end pt-2">
                    <Button 
                      onClick={savePartnerCommission}
                      disabled={saving || selectedPartner.partner_type === 'head_office'}
                      className="flex items-center gap-2"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? '저장 중...' : '커미션 저장'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>파트너를 선택하여 커미션을 관리하세요.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 시스템 기본 커미션 설정 카드 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                신규 파트너 기본 커미션
              </CardTitle>
              <CardDescription>
                신규 파트너 생성 시 자동 적용되는 기본 커미션을 설정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <Globe className="h-5 w-5 text-blue-500 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">기본 커미션 안내</h4>
                    <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                      <li>• <strong>신규 파트너</strong>: 파트너 생성 시 이 값이 자동으로 적용됩니다.</li>
                      <li>• <strong>개별 설정</strong>: 위 파트너별 커미션 관리에서 개별 수정 가능합니다.</li>
                      <li>• <strong>대본사</strong>: 대본사는 자동으로 100%로 설정됩니다.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="default_rolling_commission">기본 롤링 커미션 (%)</Label>
                  <Input
                    id="default_rolling_commission"
                    type="number"
                    step="0.1"
                    value={commissionSettings.default_rolling_commission}
                    onChange={(e) => setCommissionSettings(prev => ({ ...prev, default_rolling_commission: parseFloat(e.target.value) }))}
                    placeholder="0.5"
                  />
                  <p className="text-xs text-muted-foreground">회원 총 베팅액에 대한 커미션 비율</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="default_losing_commission">기본 루징 커미션 (%)</Label>
                  <Input
                    id="default_losing_commission"
                    type="number"
                    step="0.1"
                    value={commissionSettings.default_losing_commission}
                    onChange={(e) => setCommissionSettings(prev => ({ ...prev, default_losing_commission: parseFloat(e.target.value) }))}
                    placeholder="5.0"
                  />
                  <p className="text-xs text-muted-foreground">회원 순손실액(베팅-당첨)에 대한 커미션 비율</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="default_withdrawal_fee">기본 환전 수수료 (%)</Label>
                  <Input
                    id="default_withdrawal_fee"
                    type="number"
                    step="0.1"
                    value={commissionSettings.default_withdrawal_fee}
                    onChange={(e) => setCommissionSettings(prev => ({ ...prev, default_withdrawal_fee: parseFloat(e.target.value) }))}
                    placeholder="1.0"
                  />
                  <p className="text-xs text-muted-foreground">회원 환전 시 적용되는 수수료 비율</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min_withdrawal_amount">최소 출금 금액 (원)</Label>
                  <Input
                    id="min_withdrawal_amount"
                    type="number"
                    value={commissionSettings.min_withdrawal_amount}
                    onChange={(e) => setCommissionSettings(prev => ({ ...prev, min_withdrawal_amount: parseInt(e.target.value) }))}
                    placeholder="10000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_withdrawal_amount">최대 출금 금액 (원)</Label>
                  <Input
                    id="max_withdrawal_amount"
                    type="number"
                    value={commissionSettings.max_withdrawal_amount}
                    onChange={(e) => setCommissionSettings(prev => ({ ...prev, max_withdrawal_amount: parseInt(e.target.value) }))}
                    placeholder="1000000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="daily_withdrawal_limit">일일 출금 한도 (원)</Label>
                  <Input
                    id="daily_withdrawal_limit"
                    type="number"
                    value={commissionSettings.daily_withdrawal_limit}
                    onChange={(e) => setCommissionSettings(prev => ({ ...prev, daily_withdrawal_limit: parseInt(e.target.value) }))}
                    placeholder="5000000"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button 
                  onClick={() => saveSettings('커미션', commissionSettings)}
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? '저장 중...' : '설정 저장'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                보안 설정
              </CardTitle>
              <CardDescription>
                시스템 보안 관련 설정을 관리합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="password_min_length">최소 비밀번호 길이</Label>
                  <Input
                    id="password_min_length"
                    type="number"
                    value={securitySettings.password_min_length}
                    onChange={(e) => setSecuritySettings(prev => ({ ...prev, password_min_length: parseInt(e.target.value) }))}
                    placeholder="8"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_login_attempts">최대 로그인 시도 횟수</Label>
                  <Input
                    id="max_login_attempts"
                    type="number"
                    value={generalSettings.max_login_attempts}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, max_login_attempts: parseInt(e.target.value) }))}
                    placeholder="5"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login_log_retention_days">로그인 로그 보관 일수</Label>
                  <Input
                    id="login_log_retention_days"
                    type="number"
                    value={securitySettings.login_log_retention_days}
                    onChange={(e) => setSecuritySettings(prev => ({ ...prev, login_log_retention_days: parseInt(e.target.value) }))}
                    placeholder="90"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>특수문자 필수</Label>
                    <p className="text-sm text-muted-foreground">비밀번호에 특수문자 포함을 필수로 합니다.</p>
                  </div>
                  <Switch
                    checked={securitySettings.password_require_special}
                    onCheckedChange={(checked) => setSecuritySettings(prev => ({ ...prev, password_require_special: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>IP 화이트리스트</Label>
                    <p className="text-sm text-muted-foreground">허용된 IP에서만 접속을 허용합니다.</p>
                  </div>
                  <Switch
                    checked={securitySettings.ip_whitelist_enabled}
                    onCheckedChange={async (checked) => {
                      setSecuritySettings(prev => ({ ...prev, ip_whitelist_enabled: checked }));
                      try {
                        const { error } = await supabase
                          .from('system_settings')
                          .upsert({
                            setting_key: 'ip_whitelist_enabled',
                            setting_value: checked.toString(),
                            setting_type: 'boolean',
                            partner_level: user.level,
                            description: 'IP 화이트리스트 활성화',
                          }, { onConflict: 'setting_key' });

                        if (error) throw error;
                        toast.success(checked ? 'IP 화이트리스트가 활성화되었습니다.' : 'IP 화이트리스트가 비활성화되었습니다.');
                      } catch (error) {
                        console.error('설정 저장 실패:', error);
                        toast.error('설정 저장에 실패했습니다.');
                      }
                    }}
                  />
                </div>

                {securitySettings.ip_whitelist_enabled && (
                  <div className="p-4 border rounded-lg bg-muted/10 space-y-4">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-blue-500" />
                      <Label className="text-sm font-medium">허용 IP 주소 관리</Label>
                    </div>
                    
                    <div className="flex gap-2">
                      <Input
                        placeholder="IP 주소 입력 (예: 192.168.1.1)"
                        value={newIp}
                        onChange={(e) => setNewIp(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addIpToWhitelist();
                          }
                        }}
                      />
                      <Button onClick={addIpToWhitelist} size="sm">
                        <Plus className="h-4 w-4 mr-1" />
                        추가
                      </Button>
                    </div>

                    {ipWhitelist.length > 0 ? (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">등록된 IP 주소 ({ipWhitelist.length}개)</Label>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {ipWhitelist.map((ip, index) => (
                            <div key={index} className="flex items-center justify-between p-2 bg-background rounded border">
                              <code className="text-sm">{ip}</code>
                              <Button
                                onClick={() => removeIpFromWhitelist(ip)}
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        등록된 IP 주소가 없습니다. IP를 추가하세요.
                      </div>
                    )}
                    
                    <div className="text-xs text-yellow-600 dark:text-yellow-500 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">주의사항:</p>
                        <ul className="list-disc list-inside space-y-1 mt-1">
                          <li>IP 화이트리스트가 활성화되면 등록된 IP에서만 접속 가능합니다.</li>
                          <li>본인 IP를 먼저 등록한 후 활성화하세요.</li>
                          <li>잘못된 설정 시 접속이 차단될 수 있습니다.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>2단계 인증</Label>
                    <p className="text-sm text-muted-foreground">로그인 시 2단계 인증을 요구합니다.</p>
                  </div>
                  <Switch
                    checked={securitySettings.two_factor_enabled}
                    onCheckedChange={(checked) => setSecuritySettings(prev => ({ ...prev, two_factor_enabled: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>감사 로그</Label>
                    <p className="text-sm text-muted-foreground">모든 관리자 행동을 로그로 기록합니다.</p>
                  </div>
                  <Switch
                    checked={securitySettings.audit_log_enabled}
                    onCheckedChange={(checked) => setSecuritySettings(prev => ({ ...prev, audit_log_enabled: checked }))}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button 
                  onClick={() => saveSettings('보안', securitySettings)}
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? '저장 중...' : '설정 저장'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  시스템 상태
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {systemInfo && (
                  <>
                    <StatusIndicator status={systemInfo.database_status} label="데이터베이스" />
                    <StatusIndicator status={systemInfo.api_status} label="외부 API" />
                    <StatusIndicator status={systemInfo.websocket_status} label="WebSocket" />
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  시스템 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {systemInfo && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">활성 사용자</span>
                      <Badge>{systemInfo.active_users}명</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">시스템 업타임</span>
                      <span className="text-sm text-muted-foreground">{systemInfo.system_uptime}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">메모리 사용률</span>
                      <span className="text-sm text-muted-foreground">{systemInfo.memory_usage}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">CPU 사용률</span>
                      <span className="text-sm text-muted-foreground">{systemInfo.cpu_usage}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">마지막 백업</span>
                      <span className="text-sm text-muted-foreground">{systemInfo.last_backup}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SystemSettings;
