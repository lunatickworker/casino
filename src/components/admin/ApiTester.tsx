import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { 
  TestTube, Send, Copy, RefreshCw, CheckCircle, XCircle, 
  AlertCircle, Info, Play, Database, Zap, Search, User, 
  AlertTriangle, CheckCircle2
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { 
  investApi, 
  generateSignature,
  callInvestApi,
  GAME_PROVIDERS
} from "../../lib/investApi";
import { supabase } from "../../lib/supabase";
import { DataTable } from "../common/DataTable";

interface ApiTest {
  id: string;
  name: string;
  endpoint: string;
  method: string;
  description: string;
  requiredParams: string[];
  testFunction: (params: any) => Promise<any>;
}

export function ApiTester() {
  const [activeTest, setActiveTest] = useState<string>("info");
  const [testParams, setTestParams] = useState<Record<string, any>>({
    opcode: 'eeo2211', // 기본값 (수동 입력 필요)
    secretKey: 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj', // 기본값 (수동 입력 필요)
    token: '153b28230ef1c40c11ff526e9da93e2b', // 기본값 (수동 입력 필요)
    username: 'smcdev11', // 기본값 (수동 입력 필요)
    amount: 10000,
    provider_id: 300, // 프라그마틱 플레이
    game_id: 300001,
    year: new Date().getFullYear().toString(),
    month: (new Date().getMonth() + 1).toString()
  });
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('https://vi8282.com/proxy');
  
  // 사용자 동기화 관련 상태
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [syncProgress, setSyncProgress] = useState<any>(null);
  const [consistencyCheck, setConsistencyCheck] = useState<any>(null);

  // API 테스트 정의
  const apiTests: ApiTest[] = [
    {
      id: "info",
      name: "기본 정보 조회",
      endpoint: "/api/info",
      method: "GET",
      description: "OPCODE 기본 정보 및 잔고 조회",
      requiredParams: ["opcode", "secretKey"],
      testFunction: async (params) => {
        return await investApi.getInfo(params.opcode, params.secretKey);
      }
    },
    {
      id: "create-account",
      name: "계정 생성",
      endpoint: "/api/account",
      method: "POST", 
      description: "새 사용자 계정 생성 및 토큰 발급",
      requiredParams: ["opcode", "username", "secretKey"],
      testFunction: async (params) => {
        return await investApi.createAccount(params.opcode, params.username, params.secretKey);
      }
    },
    {
      id: "balance-all",
      name: "전체 잔고 조회",
      endpoint: "/api/account/balance",
      method: "PATCH",
      description: "모든 계정의 잔고 일괄 조회",
      requiredParams: ["opcode", "secretKey"],
      testFunction: async (params) => {
        return await investApi.getAllAccountBalances(params.opcode, params.secretKey);
      }
    },
    {
      id: "deposit",
      name: "계정 입금",
      endpoint: "/api/account/balance",
      method: "POST",
      description: "특정 계정에 금액 입금",
      requiredParams: ["opcode", "username", "token", "amount", "secretKey"],
      testFunction: async (params) => {
        return await investApi.depositToAccount(
          params.opcode, 
          params.username, 
          params.token, 
          params.amount, 
          params.secretKey
        );
      }
    },
    {
      id: "game-list",
      name: "게임 목록 조회",
      endpoint: "/api/game/lists",
      method: "GET",
      description: "특정 제공사의 게임 목록 조회",
      requiredParams: ["opcode", "provider_id", "secretKey"],
      testFunction: async (params) => {
        return await investApi.getGameList(params.opcode, params.provider_id, params.secretKey);
      }
    },
    {
      id: "game-launch",
      name: "게임 실행",
      endpoint: "/api/game/launch",
      method: "POST",
      description: "게임 실행 URL 요청",
      requiredParams: ["opcode", "username", "token", "game_id", "secretKey"],
      testFunction: async (params) => {
        return await investApi.launchGame(
          params.opcode, 
          params.username, 
          params.token, 
          params.game_id, 
          params.secretKey
        );
      }
    }
  ];

  const testProxyConnection = async () => {
    setLoading(true);
    try {
      console.log('🔗 Proxy 연결 테스트 시작:', proxyUrl);
      
      const testPayload = {
        url: "https://api.invest-ho.com/api/info",
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        body: {
          opcode: testParams.opcode,
          signature: generateSignature([testParams.opcode], testParams.secretKey)
        }
      };

      console.log('📤 Proxy 요청 데이터:', testPayload);

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testPayload)
      });

      console.log('📥 Proxy 응답 상태:', response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`Proxy 서버 오류: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📥 Proxy 응답 데이터:', result);

      setTestResult({
        success: true,
        status: response.status,
        data: result,
        timestamp: new Date().toISOString(),
        proxy_url: proxyUrl,
        request: testPayload
      });

      toast.success('Proxy 서버 연결 성공!');
    } catch (error: any) {
      console.error('❌ Proxy 연결 실패:', error);
      setTestResult({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        proxy_url: proxyUrl
      });
      toast.error(`Proxy 연결 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const runApiTest = async (test: ApiTest) => {
    setLoading(true);
    try {
      console.log(`🧪 API 테스트 시작: ${test.name}`);
      console.log('📤 테스트 파라미터:', testParams);

      const result = await test.testFunction(testParams);
      
      console.log(`📥 API 테스트 결과 (${test.name}):`, result);

      setTestResult({
        test: test.name,
        endpoint: test.endpoint,
        method: test.method,
        success: !result.error,
        data: result.data,
        error: result.error,
        status: result.status,
        timestamp: new Date().toISOString(),
        params: { ...testParams, secretKey: '***숨김***' }
      });

      if (result.error) {
        toast.error(`${test.name} 실패: ${result.error}`);
      } else {
        toast.success(`${test.name} 성공!`);
      }
    } catch (error: any) {
      console.error(`❌ API 테스트 실패 (${test.name}):`, error);
      setTestResult({
        test: test.name,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      toast.error(`${test.name} 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('클립보드에 복사되었습니다.');
  };

  // 사용자 검색
  const searchUsers = async () => {
    if (!userSearch.trim()) {
      toast.error('검색어를 입력하세요');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('search_users_for_sync', {
        p_search_term: userSearch,
        p_limit: 20
      });

      if (error) throw error;

      setSearchResults(data || []);
      toast.success(`${data?.length || 0}명의 사용자를 찾았습니다`);
    } catch (error: any) {
      console.error('사용자 검색 오류:', error);
      toast.error(`검색 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 사용자 선택
  const selectUser = async (user: any) => {
    setSelectedUser(user);
    setConsistencyCheck(null);
    
    // 자동으로 일관성 체크 실행
    await checkDataConsistency(user.user_id);
  };

  // 데이터 일관성 체크
  const checkDataConsistency = async (userId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('verify_user_data_consistency', {
        p_user_id: userId
      });

      if (error) throw error;

      // API에서 실제 잔고 조회
      const { data: user } = await supabase
        .from('users')
        .select('username, api_token, referrer_id')
        .eq('id', userId)
        .single();

      if (user) {
        const { data: partner } = await supabase
          .from('partners')
          .select('opcode, secret_key')
          .eq('id', user.referrer_id)
          .single();

        if (partner) {
          // Invest API 잔고 조회
          const balanceResult = await investApi.getAllAccountBalances(
            partner.opcode,
            partner.secret_key
          );

          if (balanceResult.data) {
            let apiUserBalance = null;
            
            // 🔧 안전한 API 응답 파싱
            if (Array.isArray(balanceResult.data)) {
              apiUserBalance = balanceResult.data.find(
                (u: any) => u.username === user.username || u.user_id === user.username
              );
            } else if (typeof balanceResult.data === 'object') {
              // 단일 객체인 경우
              if (balanceResult.data.username === user.username || balanceResult.data.user_id === user.username) {
                apiUserBalance = balanceResult.data;
              }
            }

            // API 값 추가
            const enrichedData = data.map((check: any) => {
              if (check.check_type === 'balance_check' && apiUserBalance) {
                return {
                  ...check,
                  api_value: parseFloat(apiUserBalance.balance || 0),
                  difference: check.gms_value - parseFloat(apiUserBalance.balance || 0)
                };
              }
              return check;
            });

            setConsistencyCheck(enrichedData);
          } else {
            setConsistencyCheck(data);
          }
        }
      }

      toast.success('데이터 일관성 체크 완료');
    } catch (error: any) {
      console.error('일관성 체크 오류:', error);
      toast.error(`체크 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 사용자 전체 동기화
  const syncUserAllData = async () => {
    if (!selectedUser) {
      toast.error('사용자를 먼저 선택하세요');
      return;
    }

    setLoading(true);
    setSyncProgress({ status: 'running', step: 'preparing' });

    try {
      const userId = selectedUser.user_id;
      
      // 1. 사용자 정보 조회
      const { data: user } = await supabase
        .from('users')
        .select('username, api_token, referrer_id')
        .eq('id', userId)
        .single();

      if (!user) throw new Error('사용자 정보를 찾을 수 없습니다');

      // 2. 파트너 정보 조회 (OPCODE, Secret Key)
      const { data: partner } = await supabase
        .from('partners')
        .select('opcode, secret_key')
        .eq('id', user.referrer_id)
        .single();

      if (!partner) throw new Error('파트너 정보를 찾을 수 없습니다');

      let totalSynced = 0;
      const errors: any[] = [];

      // 3. 잔고 동기화
      setSyncProgress({ status: 'running', step: 'balance' });
      try {
        const balanceResult = await investApi.getAllAccountBalances(
          partner.opcode,
          partner.secret_key
        );

        if (balanceResult.data) {
          let apiUser = null;
          
          // 🔧 안전한 API 응답 파싱
          if (Array.isArray(balanceResult.data)) {
            apiUser = balanceResult.data.find(
              (u: any) => u.username === user.username || u.user_id === user.username
            );
          } else if (typeof balanceResult.data === 'object') {
            // 단일 객체인 경우
            if (balanceResult.data.username === user.username || balanceResult.data.user_id === user.username) {
              apiUser = balanceResult.data;
            }
          }

          if (apiUser) {
            // GMS 잔고와 API 잔고 비교 후 업데이트는 수동 확인 필요
            console.log('API 잔고:', apiUser.balance, 'GMS 잔고:', selectedUser.balance);
          }
        }
      } catch (error: any) {
        errors.push({ type: 'balance', error: error.message });
      }

      // 4. 입출금 내역 동기화 (최근 30일)
      setSyncProgress({ status: 'running', step: 'transactions' });
      try {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 30);
        const dateTo = new Date();

        const transactionResult = await callInvestApi('/api/account/balance', 'VIEW', {
          opcode: partner.opcode,
          username: user.username,
          date_from: dateFrom.toISOString().split('T')[0],
          date_to: dateTo.toISOString().split('T')[0],
          signature: generateSignature([
            partner.opcode,
            user.username,
            dateFrom.toISOString().split('T')[0],
            dateTo.toISOString().split('T')[0]
          ], partner.secret_key)
        });

        if (transactionResult.data) {
          console.log('입출금 내역:', transactionResult.data);
          // DB에 저장 로직 필요
        }
      } catch (error: any) {
        errors.push({ type: 'transactions', error: error.message });
      }

      // 5. 베팅 내역 동기화 (최근 3개월)
      setSyncProgress({ status: 'running', step: 'betting' });
      try {
        const now = new Date();
        const months = [];
        for (let i = 0; i < 3; i++) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            year: date.getFullYear().toString(),
            month: (date.getMonth() + 1).toString()
          });
        }

        for (const { year, month } of months) {
          const historyResult = await investApi.getGameHistory(
            partner.opcode,
            year,
            month,
            0,
            1000,
            partner.secret_key
          );

          if (historyResult.data) {
            let bettingData = [];
            if (Array.isArray(historyResult.data)) {
              bettingData = historyResult.data;
            } else if (historyResult.data.DATA && Array.isArray(historyResult.data.DATA)) {
              bettingData = historyResult.data.DATA;
            }

            // 해당 사용자의 베팅만 필터링
            const userBetting = bettingData.filter((bet: any) => {
              const betUsername = bet.username || bet.user_id || bet.userId;
              return betUsername === user.username;
            });

            if (userBetting.length > 0) {
              // DB에 저장
              const { data: batchResult } = await supabase.rpc('save_betting_records_batch', {
                p_records: userBetting
              });

              if (batchResult && batchResult.length > 0) {
                totalSynced += batchResult[0].success_count || 0;
              }
            }
          }
        }
      } catch (error: any) {
        errors.push({ type: 'betting', error: error.message });
      }

      setSyncProgress({
        status: 'completed',
        totalSynced,
        errors,
        timestamp: new Date().toISOString()
      });

      if (errors.length === 0) {
        toast.success(`동기화 완료! ${totalSynced}건 처리됨`);
      } else {
        toast.warning(`동기화 완료 (일부 오류): ${totalSynced}건 처리, ${errors.length}개 오류`);
      }

      // 일관성 체크 다시 실행
      await checkDataConsistency(userId);

    } catch (error: any) {
      console.error('동기화 오류:', error);
      setSyncProgress({ status: 'failed', error: error.message });
      toast.error(`동기화 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 데이터 불일치 자동 수정
  const autoFixInconsistency = async (fixType: string) => {
    if (!selectedUser) {
      toast.error('사용자를 먼저 선택하세요');
      return;
    }

    if (!confirm(`${selectedUser.username}의 데이터를 "${fixType}" 방식으로 수정하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('auto_fix_data_inconsistency', {
        p_user_id: selectedUser.user_id,
        p_fix_type: fixType,
        p_confirmed: true
      });

      if (error) throw error;

      if (data && data.length > 0 && data[0].success) {
        toast.success(`수정 완료: ${data[0].fix_applied}`);
        
        // 일관성 체크 다시 실행
        await checkDataConsistency(selectedUser.user_id);
        
        // 사용자 목록 새로고침
        await searchUsers();
      } else {
        toast.error('수정 실패');
      }
    } catch (error: any) {
      console.error('자동 수정 오류:', error);
      toast.error(`수정 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const currentTest = apiTests.find(test => test.id === activeTest);

  return (
    <div className="space-y-6">
      {/* Proxy 서버 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Proxy 서버 설정
          </CardTitle>
          <CardDescription>
            외부 API 호출을 위한 Proxy 서버 주소를 설정하고 연결을 테스트합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="proxy-url">Proxy 서버 URL</Label>
              <Input
                id="proxy-url"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="https://vi8282.com/proxy"
              />
            </div>
            <div className="flex items-end">
              <Button 
                onClick={testProxyConnection}
                disabled={loading}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                연결 테스트
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API 테스트 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            API 기능 테스트
          </CardTitle>
          <CardDescription>
            각 API 엔드포인트를 개별적으로 테스트하고 응답을 확인합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTest} onValueChange={setActiveTest}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="info">기본 정보</TabsTrigger>
              <TabsTrigger value="create-account">계정 관리</TabsTrigger>
              <TabsTrigger value="game-list">게임 관리</TabsTrigger>
              <TabsTrigger value="user-sync">사용자 동기화</TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {apiTests.slice(0, 3).map((test) => (
                  <Card key={test.id} className="cursor-pointer hover:bg-muted/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{test.name}</CardTitle>
                        <Badge variant="outline">{test.method}</Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {test.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Button 
                        onClick={() => runApiTest(test)}
                        disabled={loading}
                        size="sm"
                        className="w-full"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        테스트 실행
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="create-account" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {apiTests.slice(3, 5).map((test) => (
                  <Card key={test.id} className="cursor-pointer hover:bg-muted/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{test.name}</CardTitle>
                        <Badge variant="outline">{test.method}</Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {test.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Button 
                        onClick={() => runApiTest(test)}
                        disabled={loading}
                        size="sm"
                        className="w-full"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        테스트 실행
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="game-list" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {apiTests.slice(5).map((test) => (
                  <Card key={test.id} className="cursor-pointer hover:bg-muted/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{test.name}</CardTitle>
                        <Badge variant="outline">{test.method}</Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {test.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Button 
                        onClick={() => runApiTest(test)}
                        disabled={loading}
                        size="sm"
                        className="w-full"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        테스트 실행
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* 사용자 동기화 탭 */}
            <TabsContent value="user-sync" className="space-y-4">
              {/* 사용자 검색 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5" />
                    사용자 검색
                  </CardTitle>
                  <CardDescription>
                    동기화할 사용자를 검색하세요 (사용자명 또는 닉네임)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="사용자명 또는 닉네임 입력..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && searchUsers()}
                    />
                    <Button onClick={searchUsers} disabled={loading}>
                      <Search className="h-4 w-4 mr-2" />
                      검색
                    </Button>
                  </div>

                  {/* 검색 결과 */}
                  {searchResults.length > 0 && (
                    <div className="space-y-2">
                      <Label>검색 결과 ({searchResults.length}명)</Label>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {searchResults.map((user) => (
                          <Card 
                            key={user.user_id}
                            className={`cursor-pointer hover:bg-muted/50 ${selectedUser?.user_id === user.user_id ? 'border-primary' : ''}`}
                            onClick={() => selectUser(user)}
                          >
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    <span className="font-mono">{user.username}</span>
                                    <Badge variant="outline">{user.nickname}</Badge>
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    파트너: {user.partner_name} ({user.opcode})
                                  </div>
                                </div>
                                <div className="text-right space-y-1">
                                  <div className="font-mono">₩{Number(user.balance || 0).toLocaleString()}</div>
                                  <div className="text-xs text-muted-foreground">
                                    베팅 {user.total_bets}건
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 선택된 사용자 정보 및 동기화 */}
              {selectedUser && (
                <>
                  {/* 사용자 정보 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <User className="h-5 w-5" />
                          선택된 사용자
                        </span>
                        <Badge variant="outline">{selectedUser.status}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">사용자명</Label>
                          <div className="font-mono">{selectedUser.username}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">닉네임</Label>
                          <div>{selectedUser.nickname}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">현재 잔고</Label>
                          <div className="font-mono">₩{Number(selectedUser.balance || 0).toLocaleString()}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">총 베팅</Label>
                          <div>{selectedUser.total_bets}건</div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button 
                          onClick={syncUserAllData} 
                          disabled={loading}
                          className="flex-1"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                          전체 데이터 동기화
                        </Button>
                        <Button 
                          onClick={() => checkDataConsistency(selectedUser.user_id)} 
                          disabled={loading}
                          variant="outline"
                        >
                          <Database className="h-4 w-4 mr-2" />
                          일관성 체크
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 동기화 진행 상태 */}
                  {syncProgress && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {syncProgress.status === 'completed' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : syncProgress.status === 'failed' ? (
                            <XCircle className="h-5 w-5 text-red-500" />
                          ) : (
                            <RefreshCw className="h-5 w-5 animate-spin" />
                          )}
                          동기화 진행 상태
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span>상태:</span>
                            <Badge variant={
                              syncProgress.status === 'completed' ? 'default' :
                              syncProgress.status === 'failed' ? 'destructive' : 'secondary'
                            }>
                              {syncProgress.status}
                            </Badge>
                          </div>
                          {syncProgress.step && (
                            <div className="flex justify-between items-center">
                              <span>현재 단계:</span>
                              <span className="font-mono">{syncProgress.step}</span>
                            </div>
                          )}
                          {syncProgress.totalSynced !== undefined && (
                            <div className="flex justify-between items-center">
                              <span>동기화된 기록:</span>
                              <span className="font-mono">{syncProgress.totalSynced}건</span>
                            </div>
                          )}
                          {syncProgress.errors && syncProgress.errors.length > 0 && (
                            <div className="mt-4">
                              <Label className="text-red-500">오류 목록</Label>
                              <div className="mt-2 space-y-1">
                                {syncProgress.errors.map((err: any, idx: number) => (
                                  <div key={idx} className="text-sm text-red-500 bg-red-50 p-2 rounded">
                                    {err.type}: {err.error}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* 데이터 일관성 체크 결과 */}
                  {consistencyCheck && consistencyCheck.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Database className="h-5 w-5" />
                          데이터 일관성 체크 결과
                        </CardTitle>
                        <CardDescription>
                          GMS 내부 데이터와 외부 API 데이터 비교
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {consistencyCheck.map((check: any, idx: number) => (
                            <Card key={idx} className={
                              check.status === 'warning' ? 'border-yellow-500' :
                              check.status === 'error' ? 'border-red-500' :
                              'border-green-500'
                            }>
                              <CardContent className="p-4">
                                <div className="flex justify-between items-start mb-2">
                                  <div className="flex items-center gap-2">
                                    {check.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                    {check.status === 'warning' && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                                    {check.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                                    <span className="font-medium">
                                      {check.check_type.replace(/_/g, ' ').toUpperCase()}
                                    </span>
                                  </div>
                                  <Badge variant={
                                    check.status === 'success' ? 'default' :
                                    check.status === 'warning' ? 'secondary' : 'destructive'
                                  }>
                                    {check.status}
                                  </Badge>
                                </div>

                                <div className="grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <Label className="text-xs text-muted-foreground">GMS 값</Label>
                                    <div className="font-mono">
                                      {check.gms_value !== null ? `₩${Number(check.gms_value).toLocaleString()}` : 'N/A'}
                                    </div>
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground">API 값</Label>
                                    <div className="font-mono">
                                      {check.api_value !== null ? `₩${Number(check.api_value).toLocaleString()}` : 'N/A'}
                                    </div>
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground">차이</Label>
                                    <div className={`font-mono ${Math.abs(check.difference || 0) > 0.01 ? 'text-red-500' : 'text-green-500'}`}>
                                      {check.difference !== null ? `₩${Number(check.difference).toLocaleString()}` : 'N/A'}
                                    </div>
                                  </div>
                                </div>

                                {check.details && (
                                  <div className="mt-2 p-2 bg-muted rounded text-xs">
                                    <pre className="whitespace-pre-wrap">
                                      {JSON.stringify(check.details, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}

                          {/* 자동 수정 버튼 */}
                          <div className="flex gap-2 pt-4 border-t">
                            <Button 
                              onClick={() => autoFixInconsistency('recalculate_balance')}
                              variant="outline"
                              size="sm"
                              disabled={loading}
                            >
                              잔고 재계산
                            </Button>
                            <Button 
                              onClick={() => autoFixInconsistency('reset_counters')}
                              variant="outline"
                              size="sm"
                              disabled={loading}
                            >
                              카운터 초기화
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 테스트 파라미터 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            테스트 파라미터 설정
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="opcode">OPCODE</Label>
              <Input
                id="opcode"
                value={testParams.opcode}
                onChange={(e) => setTestParams(prev => ({ ...prev, opcode: e.target.value }))}
                placeholder="eeo2211"
              />
            </div>
            <div>
              <Label htmlFor="username">사용자명</Label>
              <Input
                id="username"
                value={testParams.username}
                onChange={(e) => setTestParams(prev => ({ ...prev, username: e.target.value }))}
                placeholder="test_user"
              />
            </div>
            <div>
              <Label htmlFor="token">Token</Label>
              <Input
                id="token"
                value={testParams.token}
                onChange={(e) => setTestParams(prev => ({ ...prev, token: e.target.value }))}
                placeholder="user token"
              />
            </div>
            <div>
              <Label htmlFor="amount">금액</Label>
              <Input
                id="amount"
                type="number"
                value={testParams.amount}
                onChange={(e) => setTestParams(prev => ({ ...prev, amount: parseInt(e.target.value) }))}
                placeholder="10000"
              />
            </div>
            <div>
              <Label htmlFor="provider_id">게임 제공사 ID</Label>
              <Select
                value={testParams.provider_id.toString()}
                onValueChange={(value) => setTestParams(prev => ({ ...prev, provider_id: parseInt(value) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GAME_PROVIDERS.SLOT).map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name} ({id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="game_id">게임 ID</Label>
              <Input
                id="game_id"
                type="number"
                value={testParams.game_id}
                onChange={(e) => setTestParams(prev => ({ ...prev, game_id: parseInt(e.target.value) }))}
                placeholder="300001"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 테스트 결과 */}
      {testResult && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                테스트 결과
                {testResult.test && <Badge variant="outline">{testResult.test}</Badge>}
              </CardTitle>
              <Button
                onClick={() => copyToClipboard(JSON.stringify(testResult, null, 2))}
                variant="outline"
                size="sm"
              >
                <Copy className="h-4 w-4 mr-2" />
                복사
              </Button>
            </div>
            <CardDescription>
              {testResult.timestamp && new Date(testResult.timestamp).toLocaleString('ko-KR')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted rounded-md p-4">
              <pre className="text-sm whitespace-pre-wrap overflow-auto max-h-96">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}