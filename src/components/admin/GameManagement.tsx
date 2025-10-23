import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { DataTable } from "../common/DataTable";
import { RefreshCw, Search, Eye, EyeOff, Settings, Play, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { investApi } from "../../lib/investApi";
import { gameApi } from "../../lib/gameApi";

interface Game {
  id: number;
  provider_id: number;
  name: string;
  type: string;
  status: string;
  image_url?: string;
  demo_available: boolean;
  created_at: string;
  updated_at: string;
  provider_name?: string;
}

interface GameProvider {
  id: number;
  name: string;
  type: string;
  status: string;
  logo_url?: string;
  created_at: string;
}

interface GameManagementProps {
  user: Partner;
}

export function GameManagement({ user }: GameManagementProps) {
  // 상태 관리
  const [activeTab, setActiveTab] = useState("casino");
  const [games, setGames] = useState<Game[]>([]);
  const [providers, setProviders] = useState<GameProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [syncingProviders, setSyncingProviders] = useState<Set<number>>(new Set());

  // 컴포넌트 마운트 시 초기 데이터 로드
  useEffect(() => {
    initializeData();
  }, []);

  // 초기 데이터 로드
  const initializeData = async () => {
    try {
      setLoading(true);
      
      // 제공사 데이터 로드
      const providersData = await gameApi.getProviders();
      setProviders(providersData);
      
      // 카지노 로비 게임 초기화 (필요시 자동 생성)
      await gameApi.initializeCasinoLobbyGames();
      
      // 초기 게임 데이터 로드 (카지노부터 시작)
      await loadGames("casino");
      
    } catch (error) {
      console.error('초기 데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 게임 목록 로드
  const loadGames = async (gameType?: string) => {
    try {
      setLoading(true);
      
      const type = gameType || activeTab;
      const params: any = { type: type === "casino" ? "casino" : "slot" };
      
      // 필터 적용
      if (selectedProvider !== "all") {
        params.provider_id = parseInt(selectedProvider);
      }
      if (selectedStatus !== "all") {
        params.status = selectedStatus;
      }
      if (searchTerm.trim()) {
        params.search = searchTerm.trim();
      }
      
      const data = await gameApi.getGames(params);
      setGames(data);
      
    } catch (error) {
      console.error('게임 데이터 로드 실패:', error);
      toast.error('게임 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 탭 변경 처리
  const handleTabChange = async (newTab: string) => {
    console.log(`🔄 탭 변경: ${activeTab} -> ${newTab}`);
    setActiveTab(newTab);
    setSelectedProvider("all");
    setSelectedStatus("all");
    setSearchTerm("");
    
    // 탭 변경 후 즉시 해당 타입의 게임 로드
    try {
      setLoading(true);
      
      // 카지노 탭으로 변경시 카지노 로비 게임 초기화
      if (newTab === "casino") {
        await gameApi.initializeCasinoLobbyGames();
      }
      
      const type = newTab === "casino" ? "casino" : "slot";
      const data = await gameApi.getGames({ type });
      setGames(data);
      console.log(`✅ ${newTab} 탭 게임 로드 완료: ${data.length}개`);
      
      if (data.length === 0 && newTab === "casino") {
        console.warn('⚠️ 카지노 게임이 없습니다. 제공사 설정을 확인해주세요.');
      }
      
    } catch (error) {
      console.error(`${newTab} 탭 게임 로드 실패:`, error);
      toast.error(`${newTab === "casino" ? "카지노" : "슬롯"} 게임을 불러오는데 실패했습니다.`);
      setGames([]); // 실패 시 빈 배열로 설정
    } finally {
      setLoading(false);
    }
  };

  // 검색어와 상태 필터 변경 시 디바운스 처리
  useEffect(() => {
    const timer = setTimeout(() => {
      if (providers.length > 0 && syncingProviders.size === 0) {
        console.log('🔍 디바운스 검색 실행:', { searchTerm, selectedStatus, activeTab });
        loadGames();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, selectedStatus]);

  // 제공사 필터 변경 시 즉시 게임 로드 (동기화 중이 아닐 때만)
  useEffect(() => {
    if (providers.length > 0 && syncingProviders.size === 0) {
      console.log('🎯 제공사 필터 변경으로 게임 로드:', { selectedProvider, activeTab });
      loadGames();
    }
  }, [selectedProvider]);

  // 제공사별 게임 동기화 (최적화된 버전)
  const syncProviderGames = async (providerId: number) => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) {
      toast.error('제공사를 찾을 수 없습니다.');
      return;
    }

    if (provider.type === 'casino') {
      toast.info('카지노는 로비 진입 방식으로 게임 목록이 없습니다.');
      return;
    }

    if (syncingProviders.has(providerId)) {
      toast.warning('이미 동기화가 진행 중입니다.');
      return;
    }

    // 동기화 시작
    setSyncingProviders(prev => new Set([...prev, providerId]));
    const startTime = Date.now();
    
    try {
      const systemConfig = investApi.INVEST_CONFIGS.system_admin;
      
      // 타임아웃 설정으로 API 호출 최적화 (4초 이내 목표)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5초 타임아웃
      
      let response;
      try {
        // API 호출
        response = await Promise.race([
          investApi.getGameList(systemConfig.opcode, providerId, systemConfig.secretKey),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('API 호출 시간 초과 (3.5초)')), 3500)
          )
        ]);
        clearTimeout(timeoutId);
      } catch (timeoutError) {
        clearTimeout(timeoutId);
        throw new Error('API 응답 시간이 초과되었습니다. 네트워크 연결을 확인해주세요.');
      }
      
      if (response.error) {
        throw new Error(`API 오류: ${response.error}`);
      }
      
      // 게임 목록 추출 (성능 최적화)
      let gamesList: any[] = [];
      const data = response.data;
      
      if (Array.isArray(data)) {
        gamesList = data;
      } else if (data?.DATA && Array.isArray(data.DATA)) {
        gamesList = data.DATA;
      } else if (data?.data && Array.isArray(data.data)) {
        gamesList = data.data;
      } else if (data?.games && Array.isArray(data.games)) {
        gamesList = data.games;
      } else if (data?.list && Array.isArray(data.list)) {
        gamesList = data.list;
      } else {
        console.error(`❌ ${provider.name} 알 수 없는 응답 구조:`, data);
        throw new Error('게임 데이터를 찾을 수 없습니다.');
      }
      
      if (gamesList.length === 0) {
        toast.warning(`${provider.name}에서 게임 데이터를 찾을 수 없습니다.`);
        return;
      }
      
      console.log(`🚀 ${provider.name} 게임 ${gamesList.length}개 동기화 시작`);
      
      // DB에 동기화 (배치 처리로 최적화)
      const result = await gameApi.syncGamesFromAPI(providerId, gamesList);
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(1);
      
      console.log(`✅ ${provider.name} 동기화 완료 (${duration}초):`, result);
      toast.success(`${provider.name}: 신규 ${result.newGames}개, 업데이트 ${result.updatedGames}개 (${duration}초)`);
      
      // 동기화 완료 후 즉시 해당 제공사로 필터링하여 게임 로드
      setSelectedProvider(providerId.toString());
      
      // 동기화 완료 후 해당 제공사 게임만 빠르게 로드
      const params: any = { 
        type: "slot", // 슬롯 게임만 동기화하므로 slot으로 고정
        provider_id: providerId 
      };
      if (selectedStatus !== "all") {
        params.status = selectedStatus;
      }
      if (searchTerm.trim()) {
        params.search = searchTerm.trim();
      }
      
      const syncedGames = await gameApi.getGames(params);
      setGames(syncedGames);
      console.log(`🔄 ${provider.name} 동기화 완료 - ${syncedGames.length}개 게임 로드됨`);
      
    } catch (error: any) {
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(1);
      console.error(`${provider.name} 동기화 실패 (${duration}초):`, error);
      toast.error(`${provider.name} 동기화 실패: ${error.message}`);
    } finally {
      // 동기화 완료
      setSyncingProviders(prev => {
        const newSet = new Set(prev);
        newSet.delete(providerId);
        return newSet;
      });
    }
  };

  // 게임 상태 변경
  const updateGameStatus = async (gameId: number, newStatus: string) => {
    try {
      await gameApi.updateGameStatus(gameId, newStatus);
      
      // 로컬 상태 업데이트
      setGames(prev => prev.map(game => 
        game.id === gameId ? { ...game, status: newStatus } : game
      ));
      
      const statusLabel = newStatus === 'visible' ? '노출' : 
                         newStatus === 'hidden' ? '비노출' : '점검중';
      toast.success(`게임 상태가 "${statusLabel}"로 변경되었습니다.`);
    } catch (error) {
      console.error('게임 상태 변경 실패:', error);
      toast.error('게임 상태 변경에 실패했습니다.');
    }
  };

  // 게임 실행 (슬롯/카지노 모두 지원)
  const handleLaunchGame = async (game: Game) => {
    try {
      console.log(`🎮 게임 실행 시도:`, {
        gameId: game.id,
        gameName: game.name,
        gameType: game.type,
        providerId: game.provider_id
      });

      const systemConfig = investApi.INVEST_CONFIGS.system_admin;
      
      // 카지노 게임의 경우 로비 게임 ID 사용
      let gameIdToLaunch = game.id;
      if (game.type === 'casino') {
        // 카지노 로비 게임 ID 매핑
        const casinoLobbies: Record<number, number> = {
          410: 410000, // 에볼루션
          77: 77060,   // 마이크로게이밍
          2: 2029,     // Vivo 게이밍
          30: 30000,   // 아시아 게이밍
          78: 78001,   // 프라그마틱플레이
          86: 86001,   // 섹시게이밍
          11: 11000,   // 비비아이엔
          28: 28000,   // 드림게임
          89: 89000,   // 오리엔탈게임
          91: 91000,   // 보타
          44: 44006,   // 이주기
          85: 85036,   // 플레이텍 라이브
          0: 0         // 제네럴 카지노
        };
        
        const providerId = game.provider_id;
        if (casinoLobbies[providerId]) {
          gameIdToLaunch = casinoLobbies[providerId];
          console.log(`🎰 카지노 로비 게임 ID 변환: ${game.id} -> ${gameIdToLaunch}`);
        }
      }
      
      const response = await investApi.launchGame(
        systemConfig.opcode,
        systemConfig.username,
        systemConfig.token,
        gameIdToLaunch,
        systemConfig.secretKey
      );
      
      console.log(`🎮 게임 실행 API 응답:`, response);
      
      // 다양한 응답 구조 처리
      let gameUrl = null;
      let isSuccess = false;
      
      if (response.data) {
        // 방법 1: response.data.RESULT === true이고 url이 있는 경우
        if (response.data.RESULT === true && response.data.DATA?.url) {
          gameUrl = response.data.DATA.url;
          isSuccess = true;
        }
        // 방법 2: response.data.url이 직접 있는 경우
        else if (response.data.url) {
          gameUrl = response.data.url;
          isSuccess = true;
        }
        // 방법 3: response.data.data?.url이 있는 경우
        else if (response.data.data?.url) {
          gameUrl = response.data.data.url;
          isSuccess = true;
        }
        // 방법 4: success 플래그가 있는 경우
        else if (response.data.success && response.data.game_url) {
          gameUrl = response.data.game_url;
          isSuccess = true;
        }
      }
      
      if (isSuccess && gameUrl) {
        // 게임 창 열기
        const gameWindow = window.open(
          gameUrl, 
          '_blank', 
          'width=1200,height=800,scrollbars=yes,resizable=yes'
        );
        
        if (gameWindow) {
          toast.success(`게임 "${game.name}"이 실행되었습니다.`);
          console.log(`✅ 게임 실행 성공: ${gameUrl}`);
        } else {
          toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        }
      } else {
        // 오류 메시지 추출
        let errorMessage = '게임 실행에 실패했습니다.';
        
        if (response.data?.DATA?.message) {
          errorMessage = response.data.DATA.message;
        } else if (response.data?.message) {
          errorMessage = response.data.message;
        } else if (response.data?.error) {
          errorMessage = response.data.error;
        } else if (response.error) {
          errorMessage = response.error;
        }
        
        console.error(`❌ 게임 실행 실패:`, {
          response: response,
          errorMessage: errorMessage
        });
        
        toast.error(errorMessage);
      }
    } catch (error: any) {
      console.error('게임 실행 오류:', error);
      toast.error(`게임 실행 실패: ${error.message}`);
    }
  };

  // 현재 탭에 맞는 제공사 필터링
  const currentProviders = providers.filter(p => p.type === (activeTab === "casino" ? "casino" : "slot"));

  // 테이블 컬럼 정의
  const gameColumns = [
    {
      key: "id",
      title: "게임 ID",
      sortable: true,
    },
    {
      key: "name",
      title: "게임명",
      sortable: true,
      cell: (game: Game) => (
        <div className="flex items-center gap-3">
          {game.image_url && (
            <img src={game.image_url} alt={game.name} className="w-10 h-10 rounded object-cover" />
          )}
          <div>
            <div className="font-medium">{game.name}</div>
            <div className="text-sm text-muted-foreground">ID: {game.id}</div>
          </div>
        </div>
      ),
    },
    {
      key: "provider_name",
      title: "제공사",
      sortable: true,
    },
    {
      key: "type",
      title: "타입",
      cell: (game: Game) => (
        <Badge variant={game.type === 'slot' ? 'default' : 'secondary'}>
          {game.type === 'slot' ? '슬롯' : '카지노'}
        </Badge>
      ),
    },
    {
      key: "status",
      title: "상태",
      cell: (game: Game) => {
        const statusConfig = {
          visible: { label: '노출', color: 'bg-green-100 text-green-800 hover:bg-green-200' },
          hidden: { label: '비노출', color: 'bg-gray-100 text-gray-800 hover:bg-gray-200' },
          maintenance: { label: '점검중', color: 'bg-red-100 text-red-800 hover:bg-red-200' }
        };
        const config = statusConfig[game.status as keyof typeof statusConfig] || statusConfig.hidden;
        
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={`h-7 ${config.color}`}>
                {config.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem 
                onClick={() => updateGameStatus(game.id, 'visible')}
                disabled={game.status === 'visible'}
              >
                <Eye className="h-4 w-4 mr-2" />
                노출
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => updateGameStatus(game.id, 'hidden')}
                disabled={game.status === 'hidden'}
              >
                <EyeOff className="h-4 w-4 mr-2" />
                비노출
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => updateGameStatus(game.id, 'maintenance')}
                disabled={game.status === 'maintenance'}
              >
                <Settings className="h-4 w-4 mr-2" />
                점검중
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      key: "actions",
      title: "관리",
      cell: (game: Game) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleLaunchGame(game)}
          className="h-8 px-3 flex items-center gap-1"
        >
          <Play className="h-4 w-4" />
          실행
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">게임 관리</h1>
          <p className="text-muted-foreground">
            카지노 로비 및 슬롯 게임 리스트를 관리하고 노출 상태를 설정합니다.
          </p>
        </div>
        <Button 
          onClick={() => loadGames()} 
          disabled={loading} 
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>게임 리스트 관리 시스템</CardTitle>
          <CardDescription>
            각 제공사별 게임 데이터를 관리하고 게임별 노출 상태를 설정합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
            <TabsList className={`grid w-full ${user.level === 1 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <TabsTrigger value="casino">
                라이브 카지노 ({providers.filter(p => p.type === 'casino').length}개)
              </TabsTrigger>
              <TabsTrigger value="slot">
                슬롯 게임 ({providers.filter(p => p.type === 'slot').length}개)
              </TabsTrigger>

            </TabsList>

            <TabsContent value="casino" className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="카지노명으로 검색..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="상태 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 상태</SelectItem>
                    <SelectItem value="visible">노출</SelectItem>
                    <SelectItem value="hidden">비노출</SelectItem>
                    <SelectItem value="maintenance">점검중</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DataTable
                data={games}
                columns={gameColumns}
                loading={loading}
                emptyMessage="카지노 게임이 없습니다."
              />
            </TabsContent>

            <TabsContent value="slot" className="space-y-4">
              <div>
                <h3 className="font-medium mb-3">슬롯 제공사별 게임 동기화</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  클릭하여 외부 API에서 게임 목록을 가져옵니다. {syncingProviders.size > 0 && <span className="text-orange-600">동기화 진행 중...</span>}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {currentProviders.map((provider) => (
                    <Button
                      key={provider.id}
                      size="sm"
                      variant={selectedProvider === provider.id.toString() ? "default" : "outline"}
                      onClick={() => syncProviderGames(provider.id)}
                      disabled={syncingProviders.size > 0} // 아무 동기화가 진행 중이면 모든 버튼 비활성화
                      className="flex items-center justify-center gap-2"
                    >
                      <Download className={`h-3 w-3 ${syncingProviders.has(provider.id) ? 'animate-bounce' : ''}`} />
                      <span className="truncate">{provider.name}</span>
                      {syncingProviders.has(provider.id) && (
                        <span className="text-xs">동기화중...</span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="게임명으로 검색..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="제공사 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 제공사</SelectItem>
                    {currentProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id.toString()}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="상태 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 상태</SelectItem>
                    <SelectItem value="visible">노출</SelectItem>
                    <SelectItem value="hidden">비노출</SelectItem>
                    <SelectItem value="maintenance">점검중</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DataTable
                data={games}
                columns={gameColumns}
                loading={loading}
                emptyMessage="슬롯 게임이 없습니다. 상단의 제공사 동기화 버튼을 눌러 게임을 가져오세요."
              />
            </TabsContent>


          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}