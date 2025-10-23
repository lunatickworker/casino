import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { DataTable } from "../common/DataTable";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { toast } from "sonner@2.0.3";
import { 
  RefreshCw, 
  Search, 
  Eye, 
  EyeOff, 
  Settings, 
  Play, 
  Download, 
  AlertTriangle,
  Star,
  Upload,
  MoreVertical,
  Filter,
  TrendingUp,
  Zap,
  Gamepad2
} from "lucide-react";
import { Partner } from "../../types";
import { gameApi } from "../../lib/gameApi";
import { useWebSocket } from "../../hooks/useWebSocket";
import { MetricCard } from "./MetricCard";

interface Game {
  id: number;
  provider_id: number;
  name: string;
  type: string;
  status: string;
  image_url?: string;
  demo_available: boolean;
  is_featured: boolean;
  rtp?: number;
  play_count: number;
  priority: number;
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

interface SyncResult {
  providerId: number;
  providerName: string;
  gamesAdded: number;
  gamesUpdated: number;
  error?: string;
}

interface EnhancedGameManagementProps {
  user: Partner;
}

export function EnhancedGameManagement({ user }: EnhancedGameManagementProps) {
  // 상태 관리
  const [activeTab, setActiveTab] = useState("casino");
  const [games, setGames] = useState<Game[]>([]);
  const [providers, setProviders] = useState<GameProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [syncingProviders, setSyncingProviders] = useState<Set<number>>(new Set());
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [showSyncResults, setShowSyncResults] = useState(false);

  // WebSocket 연결
  const { sendMessage, isConnected } = useWebSocket();

  // 필터링된 게임 목록 (useMemo로 최적화)
  const filteredGames = useMemo(() => {
    return games.filter(game => {
      // 탭 필터 (카지노/슬롯)
      if (game.type !== activeTab) return false;

      // 검색어 필터
      if (searchTerm && !game.name.toLowerCase().includes(searchTerm.toLowerCase()) && 
          !game.provider_name?.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // 제공사 필터
      if (selectedProvider !== "all" && game.provider_id.toString() !== selectedProvider) {
        return false;
      }

      // 상태 필터
      if (selectedStatus !== "all" && game.status !== selectedStatus) {
        return false;
      }

      return true;
    });
  }, [games, activeTab, searchTerm, selectedProvider, selectedStatus]);

  // 컴포넌트 마운트 시 초기 데이터 로드
  useEffect(() => {
    initializeData();
  }, []);

  // WebSocket 실시간 게임 상태 업데이트 수신
  useEffect(() => {
    if (isConnected) {
      // 게임 상태 변경 알림 수신 등록
      sendMessage({
        type: 'subscribe',
        channel: 'game_status_updates',
        userId: user.id
      });
    }
  }, [isConnected, user.id]);

  // 초기 데이터 로드
  const initializeData = async () => {
    try {
      setLoading(true);
      
      // 제공사 데이터 로드
      const providersData = await gameApi.getProviders();
      setProviders(providersData);
      
      // 카지노 로비 게임 초기화
      await gameApi.initializeCasinoLobbyGames();
      
      // 초기 게임 데이터 로드
      await loadGames("casino");
      
    } catch (error) {
      console.error('초기 데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 게임 목록 로드 (조직별 상태 포함)
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
      
      // 파트너 ID와 필터를 함께 전달
      const data = await gameApi.getGames(user.id, params);
      console.log(`🎮 EnhancedGameManagement - 로드된 게임:`, {
        개수: data.length,
        샘플: data.slice(0, 3).map(g => ({
          id: g.id,
          name: g.name,
          image_url: g.image_url,
          provider: g.provider_name
        }))
      });
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
    setActiveTab(newTab);
    setSelectedProvider("all");
    setSelectedStatus("all");
    setSearchTerm("");
    await loadGames(newTab);
  };

  // 검색어와 필터 변경 시 디바운스 처리
  useEffect(() => {
    const timer = setTimeout(() => {
      if (providers.length > 0 && !bulkSyncing && syncingProviders.size === 0) {
        loadGames();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, selectedStatus]);

  // 제공사 필터 변경 시 즉시 게임 로드
  useEffect(() => {
    if (providers.length > 0 && !bulkSyncing && syncingProviders.size === 0) {
      loadGames();
    }
  }, [selectedProvider]);

  // 개별 게임 상태 업데이트
  const updateGameStatus = async (gameId: number, status: string, priority?: number, isFeatured?: boolean) => {
    try {
      // 파트너 ID 사용 (사용자의 상위 조직)
      await gameApi.updateGameStatusForPartner(
        user.id, // 관리자의 파트너 ID
        gameId,
        status,
        priority,
        isFeatured
      );

      // 실시간 업데이트를 위한 WebSocket 메시지 전송
      sendMessage({
        type: 'game_status_update',
        partnerId: user.id,
        gameId,
        status,
        priority,
        isFeatured,
        updatedBy: user.id
      });

      // 로컬 상태 업데이트
      setGames(prev => prev.map(game => 
        game.id === gameId 
          ? { ...game, status, priority: priority || game.priority, is_featured: isFeatured || game.is_featured }
          : game
      ));

      toast.success('게임 상태가 업데이트되었습니다.');
      
    } catch (error) {
      console.error('게임 상태 업데이트 실패:', error);
      toast.error('게임 상태 업데이트에 실패했습니다.');
    }
  };

  // 제공사별 게임 동기화
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

    setSyncingProviders(prev => new Set([...prev, providerId]));
    
    try {
      const result = await gameApi.syncGamesFromAPI(providerId);
      
      if (result.newGames === 0 && result.updatedGames === 0 && result.totalGames === 0) {
        toast.info(
          `${provider.name}: 게임 리스트가 없거나 지원하지 않는 제공사입니다.`,
          {
            description: "카지노 제공사는 로비 진입 방식을 사용하거나, 일부 슬롯 제공사는 게임 목록을 제공하지 않을 수 있습니다."
          }
        );
      } else {
        toast.success(
          `${provider.name} 동기화 완료: 신규 ${result.newGames}개, 업데이트 ${result.updatedGames}개`,
          {
            description: `총 ${result.totalGames}개 게임 처리됨`
          }
        );
      }

      // 동기화 완료 후 게임 목록 새로고침
      await loadGames();
      
    } catch (error) {
      console.error(`${provider.name} 동기화 실패:`, error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      toast.error(`${provider.name} 동기화 실패`, {
        description: errorMessage
      });
    } finally {
      setSyncingProviders(prev => {
        const newSet = new Set(prev);
        newSet.delete(providerId);
        return newSet;
      });
    }
  };

  // 모든 제공사 게임 동기화
  const syncAllProviderGames = async () => {
    if (bulkSyncing) {
      toast.warning('이미 전체 동기화가 진행 중입니다.');
      return;
    }

    setBulkSyncing(true);
    setSyncResults([]);
    setShowSyncResults(true);
    
    try {
      const result = await gameApi.syncAllProviderGames();
      setSyncResults(result.results);
      
      const totalAdded = result.results.reduce((sum, r) => sum + r.gamesAdded, 0);
      const totalUpdated = result.results.reduce((sum, r) => sum + r.gamesUpdated, 0);
      const failedCount = result.results.filter(r => r.error).length;

      if (result.success) {
        toast.success(
          `전체 동기화 완료: 신규 ${totalAdded}개, 업데이트 ${totalUpdated}개`
        );
      } else {
        toast.warning(
          `동기화 완료 (일부 실패): 신규 ${totalAdded}개, 업데이트 ${totalUpdated}개, 실패 ${failedCount}개`
        );
      }

      // 동기화 완료 후 게임 목록 새로고침
      await loadGames();
      
    } catch (error) {
      console.error('전체 동기화 실패:', error);
      toast.error('전체 동기화에 실패했습니다.');
    } finally {
      setBulkSyncing(false);
    }
  };

  // 게임 상태별 카운트 (useMemo로 최적화)
  const statusCounts = useMemo(() => ({
    visible: games.filter(g => g.status === 'visible' && g.type === activeTab).length,
    hidden: games.filter(g => g.status === 'hidden' && g.type === activeTab).length,
    maintenance: games.filter(g => g.status === 'maintenance' && g.type === activeTab).length,
    featured: games.filter(g => g.is_featured && g.type === activeTab).length
  }), [games, activeTab]);

  // 게임 테이블 컬럼 정의
  const gameColumns = [
    {
      header: "게임 정보",
      accessor: "name",
      cell: (game: Game) => (
        <div className="flex items-center space-x-3">
          <div className="relative w-12 h-12 flex-shrink-0">
            {game.image_url ? (
              <img
                src={game.image_url}
                alt={game.name}
                className="w-full h-full rounded-lg object-cover bg-slate-100 dark:bg-slate-800"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent && !parent.querySelector('.game-image-placeholder')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'game-image-placeholder w-full h-full rounded-lg text-xs';
                    placeholder.textContent = '🎮';
                    parent.appendChild(placeholder);
                  }
                }}
              />
            ) : (
              <div className="game-image-placeholder w-full h-full rounded-lg text-xs">
                🎮
              </div>
            )}
            {game.is_featured && (
              <Star className="absolute -top-1 -right-1 w-4 h-4 text-yellow-500 fill-current" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{game.name}</div>
            <div className="text-sm text-muted-foreground truncate">
              {game.provider_name} {game.rtp && `• RTP ${game.rtp}%`}
            </div>
          </div>
        </div>
      )
    },
    {
      header: "상태",
      accessor: "status",
      cell: (game: Game) => {
        const statusConfig = {
          visible: { label: "노출", variant: "default" as const, icon: Eye },
          hidden: { label: "비노출", variant: "secondary" as const, icon: EyeOff },
          maintenance: { label: "점검중", variant: "destructive" as const, icon: AlertTriangle }
        };
        const config = statusConfig[game.status as keyof typeof statusConfig];
        const Icon = config?.icon || Eye;
        
        return (
          <Badge variant={config?.variant || "default"} className="gap-1">
            <Icon className="w-3 h-3" />
            {config?.label || game.status}
          </Badge>
        );
      }
    },
    {
      header: "우선순위",
      accessor: "priority",
      cell: (game: Game) => (
        <div className="text-center font-mono">
          {game.priority || 0}
        </div>
      )
    },
    {
      header: "플레이 수",
      accessor: "play_count",
      cell: (game: Game) => (
        <div className="text-center">
          {game.play_count?.toLocaleString() || 0}
        </div>
      )
    },
    {
      header: "액션",
      accessor: "actions",
      cell: (game: Game) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => updateGameStatus(game.id, 'visible')}>
              <Eye className="w-4 h-4 mr-2" />
              노출하기
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateGameStatus(game.id, 'hidden')}>
              <EyeOff className="w-4 h-4 mr-2" />
              숨기기
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateGameStatus(game.id, 'maintenance')}>
              <AlertTriangle className="w-4 h-4 mr-2" />
              점검중으로 설정
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => updateGameStatus(game.id, game.status, game.priority, !game.is_featured)}
            >
              <Star className="w-4 h-4 mr-2" />
              {game.is_featured ? '추천 해제' : '추천 설정'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">게임 관리</h1>
          <p className="text-sm text-slate-400">
            게임 목록 동기화 및 상태 관리
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            onClick={syncAllProviderGames}
            disabled={bulkSyncing}
            className="btn-premium-primary"
          >
            <Zap className="w-4 h-4 mr-2" />
            {bulkSyncing ? '동기화 중...' : '전체 동기화'}
          </Button>
          <Button
            onClick={() => loadGames()}
            disabled={loading}
            variant="outline"
            className="border-slate-600 hover:bg-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 통계 카드 - MetricCard 사용 */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="노출 게임"
          value={statusCounts.visible.toLocaleString()}
          subtitle="활성화된 게임"
          icon={Eye}
          color="green"
        />
        
        <MetricCard
          title="비노출 게임"
          value={statusCounts.hidden.toLocaleString()}
          subtitle="숨김 처리됨"
          icon={EyeOff}
          color="platinum"
        />
        
        <MetricCard
          title="점검중"
          value={statusCounts.maintenance.toLocaleString()}
          subtitle="점검 상태"
          icon={AlertTriangle}
          color="red"
        />
        
        <MetricCard
          title="추천 게임"
          value={statusCounts.featured.toLocaleString()}
          subtitle="추천 설정됨"
          icon={Star}
          color="amber"
        />
      </div>

      {/* 동기화 결과 모달 */}
      {showSyncResults && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>동기화 결과</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSyncResults(false)}
              >
                ✕
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {syncResults.map((result) => (
                <div
                  key={result.providerId}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    result.error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
                  }`}
                >
                  <span className="font-medium">{result.providerName}</span>
                  <div className="text-sm">
                    {result.error ? (
                      <span className="text-red-600">실패: {result.error}</span>
                    ) : (
                      <span className="text-green-600">
                        신규 {result.gamesAdded}개, 업데이트 {result.gamesUpdated}개
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 메인 컨텐츠 */}
      <div className="glass-card rounded-xl p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
              <Gamepad2 className="h-5 w-5 text-blue-400" />
              게임 목록
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              게임 제공사별 게임 목록 관리 및 상태 설정
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          {/* 탭 리스트 - 눈에 띄게 디자인 개선 */}
          <TabsList className="grid w-full grid-cols-2 bg-slate-800/50 p-1 rounded-xl mb-6 border border-slate-700/50">
            <TabsTrigger 
              value="casino"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-pink-600 data-[state=active]:text-white data-[state=active]:shadow-[0_0_20px_rgba(168,85,247,0.5)] rounded-lg transition-all duration-300 font-semibold"
            >
              🎰 카지노
            </TabsTrigger>
            <TabsTrigger 
              value="slot"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-[0_0_20px_rgba(59,130,246,0.5)] rounded-lg transition-all duration-300 font-semibold"
            >
              🎲 슬롯
            </TabsTrigger>
          </TabsList>

          <div className="mt-6 space-y-4">
            {/* 필터 및 검색 */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    placeholder="게임명 또는 제공사명으로 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 input-premium"
                  />
                </div>
              </div>
              <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                <SelectTrigger className="w-full sm:w-48 bg-slate-800/50 border-slate-600">
                  <SelectValue placeholder="제공사 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 제공사</SelectItem>
                  {providers
                    .filter(p => p.type === (activeTab === "casino" ? "casino" : "slot"))
                    .map(provider => (
                      <SelectItem key={provider.id} value={provider.id.toString()}>
                        {provider.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-full sm:w-32 bg-slate-800/50 border-slate-600">
                  <SelectValue placeholder="상태" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 상태</SelectItem>
                  <SelectItem value="visible">노출</SelectItem>
                  <SelectItem value="hidden">비노출</SelectItem>
                  <SelectItem value="maintenance">점검중</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 제공사별 동기화 버튼 */}
            {activeTab === "slot" && (
              <div className="flex flex-wrap gap-2 p-4 bg-slate-800/30 rounded-lg border border-slate-700/50">
                <div className="text-sm text-slate-400 mb-2 w-full">
                  제공사별 게임 동기화:
                </div>
                {providers
                  .filter(p => p.type === "slot")
                  .map(provider => (
                    <Button
                      key={provider.id}
                      size="sm"
                      variant="outline"
                      onClick={() => syncProviderGames(provider.id)}
                      disabled={syncingProviders.has(provider.id) || bulkSyncing}
                      className="gap-1 border-slate-600 hover:bg-slate-700"
                    >
                      <RefreshCw className={`w-3 h-3 ${syncingProviders.has(provider.id) ? 'animate-spin' : ''}`} />
                      {provider.name}
                    </Button>
                  ))}
              </div>
            )}

            {/* 게임 테이블 */}
            <DataTable
              data={filteredGames}
              columns={gameColumns}
              loading={loading}
              enableSearch={false}
              emptyMessage="게임이 없습니다"
            />
          </div>
        </Tabs>
      </div>
    </div>
  );
}

export default EnhancedGameManagement;