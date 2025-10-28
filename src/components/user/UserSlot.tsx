import React from 'react';
import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { GameProviderSelector } from "./GameProviderSelector";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { 
  Search, 
  Play, 
  Star, 
  Filter, 
  Grid, 
  List, 
  Loader, 
  TrendingUp, 
  Clock,
  Crown,
  Zap,
  Sparkles,
  Trophy,
  Target,
  Gem,
  DollarSign,
  Coins
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { User } from "../../types";
import { gameApi } from "../../lib/gameApi";
import { useWebSocket } from "../../hooks/useWebSocket";
import { supabase } from "../../lib/supabase";

interface Game {
  game_id: number;
  provider_id: number;
  provider_name: string;
  game_name: string;
  game_type: string;
  image_url?: string;
  is_featured: boolean;
  rtp?: number;
  status: string;
  priority: number;
}

interface UserSlotProps {
  user: User;
  onRouteChange: (route: string) => void;
}

const slotCategories = [
  { id: 'all', name: '전체', icon: Crown, gradient: 'from-yellow-500 to-amber-600' },
  { id: 'featured', name: '인기', icon: Star, gradient: 'from-red-500 to-pink-600' },
  { id: 'new', name: '신규', icon: Sparkles, gradient: 'from-blue-500 to-cyan-600' },
  { id: 'jackpot', name: '잭팟', icon: Trophy, gradient: 'from-purple-500 to-purple-600' },
  { id: 'bonus', name: '보너스', icon: Gem, gradient: 'from-green-500 to-emerald-600' },
  { id: 'high-rtp', name: '고수익', icon: Target, gradient: 'from-orange-500 to-red-600' }
];

export function UserSlot({ user, onRouteChange }: UserSlotProps) {
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState('featured');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [launchingGameId, setLaunchingGameId] = useState<number | null>(null);

  // WebSocket 연결
  const { sendMessage, isConnected } = useWebSocket();

  useEffect(() => {
    initializeData();
  }, []);

  useEffect(() => {
    if (isConnected) {
      // 슬롯 게임 상태 변경 실시간 수신
      sendMessage({
        type: 'subscribe',
        channel: 'slot_status_updates',
        userId: user.id
      });
    }
  }, [isConnected, user.id]);

  useEffect(() => {
    loadSlotGames();
  }, [selectedProvider, selectedCategory, sortBy]);



  const initializeData = async () => {
    try {
      setLoading(true);
      
      // 제공사 목록 로드
      const providersData = await gameApi.getProviders();
      let slotProviders = providersData.filter(p => p.type === 'slot');
      
      // 제공사가 부족한 경우 하드코딩된 데이터 사용
      if (slotProviders.length < 20) {
        slotProviders = [
          { id: 1, name: '마이크로게이밍', type: 'slot', status: 'active' },
          { id: 17, name: '플레이앤고', type: 'slot', status: 'active' },
          { id: 20, name: 'CQ9 게이밍', type: 'slot', status: 'active' },
          { id: 21, name: '제네시스 게이밍', type: 'slot', status: 'active' },
          { id: 22, name: '하바네로', type: 'slot', status: 'active' },
          { id: 23, name: '게임아트', type: 'slot', status: 'active' },
          { id: 27, name: '플레이텍', type: 'slot', status: 'active' },
          { id: 38, name: '블루프린트', type: 'slot', status: 'active' },
          { id: 39, name: '부운고', type: 'slot', status: 'active' },
          { id: 40, name: '드라군소프트', type: 'slot', status: 'active' },
          { id: 41, name: '엘크 스튜디오', type: 'slot', status: 'active' },
          { id: 47, name: '드림테크', type: 'slot', status: 'active' },
          { id: 51, name: '칼람바 게임즈', type: 'slot', status: 'active' },
          { id: 52, name: '모빌롯', type: 'slot', status: 'active' },
          { id: 53, name: '노리밋 시티', type: 'slot', status: 'active' },
          { id: 55, name: 'OMI 게이밍', type: 'slot', status: 'active' },
          { id: 56, name: '원터치', type: 'slot', status: 'active' },
          { id: 59, name: '플레이슨', type: 'slot', status: 'active' },
          { id: 60, name: '푸쉬 게이밍', type: 'slot', status: 'active' },
          { id: 61, name: '퀵스핀', type: 'slot', status: 'active' },
          { id: 62, name: 'RTG 슬롯', type: 'slot', status: 'active' },
          { id: 63, name: '리볼버 게이밍', type: 'slot', status: 'active' },
          { id: 65, name: '슬롯밀', type: 'slot', status: 'active' },
          { id: 66, name: '스피어헤드', type: 'slot', status: 'active' },
          { id: 70, name: '썬더킥', type: 'slot', status: 'active' },
          { id: 72, name: '우후 게임즈', type: 'slot', status: 'active' },
          { id: 74, name: '릴렉스 게이밍', type: 'slot', status: 'active' },
          { id: 75, name: '넷엔트', type: 'slot', status: 'active' },
          { id: 76, name: '레드타이거', type: 'slot', status: 'active' },
          { id: 87, name: 'PG소프트', type: 'slot', status: 'active' },
          { id: 88, name: '플레이스타', type: 'slot', status: 'active' },
          { id: 90, name: '빅타임게이밍', type: 'slot', status: 'active' },
          { id: 300, name: '프라그마틱 플레이', type: 'slot', status: 'active' }
        ];
      }
      
      setProviders(slotProviders);
      
      // 초기 슬롯 게임 목록 로드
      await loadSlotGames();
      
    } catch (error) {
      console.error('초기 데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadSlotGames = async () => {
    try {
      setLoading(true);
      setPage(0);
      setHasMore(true);

      // 직접 게임 조회 방식으로 변경 (fallback)
      let gamesData;
      try {
        gamesData = await gameApi.getUserVisibleGames(
          user.id,
          'slot',
          selectedProvider !== 'all' ? parseInt(selectedProvider) : undefined,
          undefined,
          100, // 일반적인 게임 로드
          0
        );
      } catch (rpcError) {
        
        // Fallback: 직접 게임 테이블 조회
        let query = supabase
          .from('games')
          .select(`
            id,
            provider_id,
            name,
            type,
            status,
            image_url,
            demo_available,
            is_featured,
            priority,
            rtp,
            play_count,
            created_at,
            updated_at,
            game_providers!inner(
              id,
              name,
              type
            )
          `)
          .eq('type', 'slot')
          .eq('status', 'visible')
          .eq('game_providers.status', 'active');

        // 제공사 필터 적용
        if (selectedProvider !== 'all') {
          query = query.eq('provider_id', parseInt(selectedProvider));
        }

        const { data: directGamesData, error: directError } = await query
          .order('priority', { ascending: false })
          .limit(100);

        if (directError) {
          throw directError;
        }

        gamesData = directGamesData?.map(game => ({
          game_id: game.id,
          provider_id: game.provider_id,
          provider_name: game.game_providers.name,
          game_name: game.name,
          game_type: game.type,
          image_url: game.image_url,
          is_featured: game.is_featured,
          status: game.status,
          priority: game.priority || 0,
          rtp: game.rtp
        })) || [];
      }

      // 정렬 및 필터링
      let sortedGames = [...gamesData];
      
      if (selectedCategory === 'featured') {
        sortedGames = sortedGames.filter(g => g.is_featured);
      } else if (selectedCategory === 'new') {
        // 최근 게임 (game_id가 높을수록 최신)
        sortedGames = sortedGames.sort((a, b) => b.game_id - a.game_id).slice(0, 50);
      } else if (selectedCategory === 'jackpot') {
        const jackpotKeywords = ['jackpot', 'mega', 'major', 'grand', '잭팟', '메가'];
        sortedGames = sortedGames.filter(g => 
          jackpotKeywords.some(keyword => 
            g.game_name.toLowerCase().includes(keyword)
          )
        );
      } else if (selectedCategory === 'bonus') {
        const bonusKeywords = ['bonus', 'free', 'spin', '보너스', '프리'];
        sortedGames = sortedGames.filter(g => 
          bonusKeywords.some(keyword => 
            g.game_name.toLowerCase().includes(keyword)
          )
        );
      } else if (selectedCategory === 'high-rtp') {
        sortedGames = sortedGames.filter(g => g.rtp && g.rtp >= 96);
      }

      // 최종 정렬
      if (sortBy === 'featured') {
        sortedGames.sort((a, b) => {
          if (a.is_featured && !b.is_featured) return -1;
          if (!a.is_featured && b.is_featured) return 1;
          return b.priority - a.priority;
        });
      } else if (sortBy === 'name') {
        sortedGames.sort((a, b) => a.game_name.localeCompare(b.game_name));
      } else if (sortBy === 'rtp') {
        sortedGames.sort((a, b) => (b.rtp || 0) - (a.rtp || 0));
      }

      setGames(sortedGames);
      
    } catch (error) {
      console.error('슬롯 게임 로드 실패:', error);
      toast.error('슬롯 게임을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleGameClick = async (game: Game) => {
    if (launchingGameId === game.game_id) {
      return; // 이미 실행 중
    }

    setLaunchingGameId(game.game_id);
    
    try {
      console.log('🎰 슬롯 게임 실행 시작:', {
        userId: user.id,
        gameId: game.game_id,
        gameName: game.game_name
      });
      
      const result = await gameApi.generateGameLaunchUrl(user.id, game.game_id);
      
      console.log('🎰 슬롯 게임 실행 결과:', result);
      
      if (result.success && result.launchUrl) {
        const sessionId = result.sessionId; // 반환된 sessionId 사용
        console.log('🎰 슬롯 게임 sessionId 확인:', { sessionId, result });
        
        // 슬롯은 일반 창으로 실행
        const gameWindow = window.open(
          result.launchUrl,
          '_blank',
          'width=1400,height=900,scrollbars=yes,resizable=yes'
        );

        if (!gameWindow) {
          toast.error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
          // 세션 생성했지만 게임 실행 실패 시 세션 종료
          if (sessionId && typeof sessionId === 'number') {
            (window as any).endGameSession?.(sessionId);
          } else {
            console.warn('⚠️ 게임 실행 실패, 하지만 sessionId가 없음:', sessionId);
          }
        } else {
          toast.success(`${game.game_name} 슬롯을 시작했습니다!`);
          
          // 게임창 참조 등록 (강제 종료용)
          if (sessionId && typeof sessionId === 'number') {
            if (!(window as any).gameWindows) {
              (window as any).gameWindows = new Map();
            }
            (window as any).gameWindows.set(sessionId, gameWindow);
            console.log('📝 슬롯 게임창 등록:', sessionId);
          }
          
          // 슬롯 시작 통계 업데이트
          sendMessage({
            type: 'slot_started',
            userId: user.id,
            gameId: game.game_id,
            providerName: game.provider_name,
            sessionId: sessionId,
            timestamp: new Date().toISOString()
          });

          // 게임 창 종료 감지 (즉시 체크 시작)
          if (sessionId) {
            // 게임 창이 열린 후 3초 대기 (팝업 완전히 로드될 때까지)
            setTimeout(() => {
              const checkGameWindow = setInterval(() => {
                if (gameWindow.closed) {
                  clearInterval(checkGameWindow);
                  console.log('🎰 슬롯 게임 창 종료 감지');
                  
                  // 게임창 참조 삭제
                  if (typeof sessionId === 'number') {
                    (window as any).gameWindows?.delete(sessionId);
                    console.log('🧹 슬롯 게임창 참조 삭제:', sessionId);
                  }
                  
                  // 즉시 세션 종료 및 잔고 동기화 실행
                  if (sessionId && typeof sessionId === 'number') {
                    (window as any).syncBalanceAfterGame?.(sessionId);
                  } else {
                    console.warn('⚠️ 잔고 동기화 실패, sessionId가 유효하지 않음:', sessionId);
                  }
                }
              }, 1000); // 1초마다 체크
            }, 3000); // 3초 후부터 체크 시작
          }
        }
      } else {
        // 로딩 toast 닫기
        toast.dismiss(`game-loading-${game.game_id}`);
        console.error('❌ 슬롯 게임 실행 실패:', result.error);
        toast.error(`슬롯 시작 실패: ${result.error || '알 수 없는 오류가 발생했습니다.'}`);
      }
    } catch (error) {
      // 로딩 toast 닫기
      toast.dismiss(`game-loading-${game.game_id}`);
      console.error('❌ 슬롯 실행 예외 발생:', error);
      toast.error(`슬롯 시작 중 오류: ${error instanceof Error ? error.message : '시스템 오류가 발생했습니다.'}`);
    } finally {
      setLaunchingGameId(null);
    }
  };

  const getGameImage = (game: Game) => {
    // DB에 저장된 image_url 직접 사용
    if (game.image_url && game.image_url.trim() && game.image_url !== 'null') {
      return game.image_url;
    }
    // 이미지가 없는 경우 ImageWithFallback이 자동으로 플레이스홀더 처리
    return null;
  };

  const filteredGames = games.filter(game =>
    game.game_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    game.provider_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* VIP 슬롯 배경 */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.85)), url('https://images.unsplash.com/photo-1701374930170-47ea6a246c0b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzbG90JTIwbWFjaGluZSUyMGNhc2lubyUyMG5lb258ZW58MXx8fHwxNzU5NzIwMzcyfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      />
      
      <div className="relative z-10 space-y-8 p-4 sm:p-6 lg:p-8">
        {/* VIP 헤더 */}
        <div className="text-center space-y-6">
          <div className="flex items-center justify-center gap-4 mb-6">
            <Coins className="w-16 h-16 text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
            <h1 className="text-6xl lg:text-7xl font-bold gold-text neon-glow">
              VIP 슬롯 머신
            </h1>
            <Coins className="w-16 h-16 text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
          </div>
          <p className="text-3xl text-yellow-100 tracking-wide">
            최고 수익률과 메가 잭팟이 기다리는 프리미엄 슬롯
          </p>
          <div className="flex items-center justify-center gap-6 text-yellow-300/80 text-lg">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              <span>높은 RTP</span>
            </div>
            <div className="w-px h-6 bg-yellow-600/50" />
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              <span>메가 잭팟</span>
            </div>
            <div className="w-px h-6 bg-yellow-600/50" />
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <span>즉시 시작</span>
            </div>
          </div>
        </div>

        {/* 검색 및 필터 */}
        <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
          <div className="flex gap-2 sm:gap-3 items-center w-full lg:flex-1">
            {/* 검색 */}
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 sm:w-6 sm:h-6 text-yellow-400 drop-shadow-lg" />
              <Input
                type="text"
                placeholder="슬롯 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 sm:pl-12 h-14 text-base sm:text-lg bg-gradient-to-r from-black/60 via-black/50 to-black/60 border-2 border-yellow-600/40 text-white placeholder:text-yellow-200/50 focus:border-yellow-500 rounded-lg shadow-lg shadow-yellow-900/10 focus:shadow-yellow-600/20 transition-all duration-300"
              />
            </div>
            
            {/* 제공사 드롭다운 - VIP 럭셔리 스타일 */}
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger className="relative w-40 sm:w-48 h-14 text-base sm:text-lg bg-gradient-to-r from-black/80 via-black/70 to-black/80 border-2 border-yellow-600/50 text-yellow-100 hover:border-yellow-500 transition-all duration-300 shadow-lg shadow-yellow-900/20 hover:shadow-yellow-600/30 rounded-lg">
                <div className="absolute inset-0 bg-gradient-to-r from-yellow-600/10 via-transparent to-yellow-600/10 pointer-events-none rounded-lg" />
                <div className="flex items-center gap-2 relative z-10">
                  <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400 drop-shadow-lg" />
                  <SelectValue placeholder="제공사" className="truncate" />
                </div>
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 border-2 border-yellow-600/50 shadow-2xl shadow-yellow-900/50 max-h-[400px] backdrop-blur-md rounded-xl">
                <SelectItem 
                  value="all" 
                  className="text-yellow-100 hover:text-yellow-400 hover:bg-yellow-900/30 cursor-pointer transition-all duration-200 border-b border-yellow-600/20 text-base sm:text-lg py-3"
                >
                  <div className="flex items-center gap-2 py-1">
                    <Crown className="w-5 h-5 text-yellow-400 drop-shadow-lg" />
                    <span className="tracking-wide">전체 제공사</span>
                  </div>
                </SelectItem>
                {providers.map((provider) => (
                  <SelectItem 
                    key={provider.id} 
                    value={provider.id.toString()} 
                    className="text-yellow-100 hover:text-yellow-400 hover:bg-yellow-900/20 cursor-pointer transition-all duration-200 text-base sm:text-lg py-3"
                  >
                    <div className="flex items-center gap-2 py-1">
                      <Sparkles className="w-4 h-4 text-yellow-400/60" />
                      <span>{provider.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-4 items-center">
            {/* 정렬 드롭다운 - VIP 럭셔리 스타일 */}
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="relative w-40 h-14 text-lg bg-gradient-to-r from-black/80 via-black/70 to-black/80 border-2 border-yellow-600/50 text-yellow-100 hover:border-yellow-500 transition-all duration-300 shadow-lg shadow-yellow-900/20 hover:shadow-yellow-600/30">
                <div className="absolute inset-0 bg-gradient-to-r from-yellow-600/10 via-transparent to-yellow-600/10 pointer-events-none" />
                <div className="relative z-10">
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 border-2 border-yellow-600/50 shadow-2xl shadow-yellow-900/50 backdrop-blur-md">
                <SelectItem value="featured" className="text-yellow-100 hover:text-yellow-400 hover:bg-yellow-900/30 cursor-pointer transition-all duration-200">
                  <div className="flex items-center gap-2 py-1">
                    <Star className="w-4 h-4 text-yellow-400" />
                    <span>추천순</span>
                  </div>
                </SelectItem>
                <SelectItem value="name" className="text-yellow-100 hover:text-yellow-400 hover:bg-yellow-900/30 cursor-pointer transition-all duration-200">
                  <div className="flex items-center gap-2 py-1">
                    <Target className="w-4 h-4 text-yellow-400/60" />
                    <span>이름순</span>
                  </div>
                </SelectItem>
                <SelectItem value="rtp" className="text-yellow-100 hover:text-yellow-400 hover:bg-yellow-900/30 cursor-pointer transition-all duration-200">
                  <div className="flex items-center gap-2 py-1">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    <span>수익률순</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            
            {/* 뷰 모드 토글 - VIP 럭셔리 스타일 */}
            <div className="hidden lg:flex gap-2 bg-gradient-to-r from-black/80 via-black/70 to-black/80 border-2 border-yellow-600/50 rounded-lg p-2 shadow-lg shadow-yellow-900/20">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className={`w-12 h-12 transition-all duration-300 ${
                  viewMode === 'grid' 
                    ? 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-black shadow-lg shadow-yellow-600/50 hover:from-yellow-500 hover:to-yellow-400' 
                    : 'text-yellow-300 hover:text-yellow-100 hover:bg-yellow-900/20'
                }`}
              >
                <Grid className="w-6 h-6" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className={`w-12 h-12 transition-all duration-300 ${
                  viewMode === 'list' 
                    ? 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-black shadow-lg shadow-yellow-600/50 hover:from-yellow-500 hover:to-yellow-400' 
                    : 'text-yellow-300 hover:text-yellow-100 hover:bg-yellow-900/20'
                }`}
              >
                <List className="w-6 h-6" />
              </Button>
            </div>
          </div>
        </div>

        {/* 카테고리 선택 */}
        <div className="flex flex-wrap gap-3 justify-center">
          {slotCategories.map((category) => {
            const Icon = category.icon;
            const isActive = selectedCategory === category.id;
            return (
              <Button
                key={category.id}
                variant="ghost"
                onClick={() => setSelectedCategory(category.id)}
                className={`
                  relative px-6 py-4 text-lg font-bold transition-all duration-300
                  ${isActive 
                    ? `bg-gradient-to-r ${category.gradient} text-white shadow-lg shadow-yellow-500/50 scale-105` 
                    : 'text-yellow-200/80 hover:text-yellow-100 hover:bg-yellow-900/20 border border-transparent hover:border-yellow-600/30'
                  }
                `}
              >
                <Icon className="w-5 h-5 mr-2" />
                {category.name}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-yellow-300 to-transparent" />
                )}
              </Button>
            );
          })}
        </div>

        {/* 제공사 선택 - 모바일에서는 숨김 */}
        <div className="hidden lg:block luxury-card rounded-3xl p-8 border-2 border-yellow-600/20">
          <GameProviderSelector
            selectedProvider={selectedProvider}
            onProviderChange={setSelectedProvider}
            gameType="slot"
            providers={providers}
          />
        </div>

        {/* 슬롯 게임 목록 */}
        {loading ? (
          <div className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'}`}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="luxury-card animate-pulse border-yellow-600/20">
                <div className={`${viewMode === 'grid' ? 'aspect-[4/3]' : 'aspect-[16/9]'} bg-gradient-to-br from-slate-700 to-slate-800 rounded-t-xl`} />
                <CardContent className="p-4 space-y-3">
                  <div className="h-5 bg-gradient-to-r from-yellow-600/20 to-yellow-400/20 rounded" />
                  <div className="h-4 bg-gradient-to-r from-yellow-600/20 to-yellow-400/20 rounded w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'}`}>
            {filteredGames.map((game) => (
              <Card 
                key={game.game_id} 
                className={`luxury-card group cursor-pointer border-2 border-yellow-600/20 hover:border-yellow-500/60 transition-all game-card-hover overflow-hidden ${
                  launchingGameId === game.game_id ? 'opacity-50' : ''
                } ${viewMode === 'list' ? 'flex flex-row' : ''}`}
                onClick={() => handleGameClick(game)}
              >
                <div className={`relative overflow-hidden ${viewMode === 'grid' ? 'aspect-[4/3]' : 'w-48 aspect-[4/3] flex-shrink-0'}`}>
                  <ImageWithFallback
                    src={getGameImage(game)}
                    alt={game.game_name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  
                  {/* 그라데이션 오버레이 */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  
                  {/* 추천 배지 */}
                  {game.is_featured && (
                    <div className="absolute top-3 right-3">
                      <Badge className="vip-badge text-white border-0">
                        <Star className="w-3 h-3 mr-1" />
                        HOT
                      </Badge>
                    </div>
                  )}

                  {/* RTP 표시 */}
                  {game.rtp && (
                    <div className="absolute top-3 left-3">
                      <Badge className="bg-green-600 text-white border-0">
                        RTP {game.rtp}%
                      </Badge>
                    </div>
                  )}

                  {/* 호버 오버레이 */}
                  {viewMode === 'grid' && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                      {launchingGameId === game.game_id ? (
                        <div className="flex flex-col items-center gap-2 text-white">
                          <Loader className="w-8 h-8 animate-spin" />
                          <span className="text-sm font-semibold">시작 중...</span>
                        </div>
                      ) : (
                        <Button 
                          size="lg" 
                          className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 text-black font-bold shadow-lg shadow-yellow-500/40"
                          disabled={launchingGameId === game.game_id}
                        >
                          <Play className="w-5 h-5 mr-2" />
                          플레이
                        </Button>
                      )}
                    </div>
                  )}

                  {/* 그리드 뷰 하단 정보 */}
                  {viewMode === 'grid' && (
                    <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                      <h3 className="font-bold text-lg mb-1 truncate neon-glow">
                        {game.game_name}
                      </h3>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-yellow-300 truncate">
                          {game.provider_name}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-green-400">
                          <Clock className="w-3 h-3" />
                          <span>24H</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 리스트 뷰 정보 */}
                {viewMode === 'list' && (
                  <div className="flex-1 p-6 flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-yellow-100 mb-2 neon-glow">
                        {game.game_name}
                      </h3>
                      <p className="text-yellow-300 mb-3">{game.provider_name}</p>
                      <div className="flex gap-2">
                        {game.is_featured && (
                          <Badge className="vip-badge text-white">
                            <Star className="w-3 h-3 mr-1" />
                            인기
                          </Badge>
                        )}
                        {game.rtp && (
                          <Badge className="bg-green-600 text-white">
                            RTP {game.rtp}%
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {launchingGameId === game.game_id ? (
                        <div className="flex items-center gap-2 text-yellow-400">
                          <Loader className="w-6 h-6 animate-spin" />
                          <span>시작 중...</span>
                        </div>
                      ) : (
                        <Button 
                          size="lg" 
                          className="bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 text-black font-bold shadow-lg"
                          disabled={launchingGameId === game.game_id}
                        >
                          <Play className="w-5 h-5 mr-2" />
                          플레이
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {filteredGames.length === 0 && !loading && (
          <div className="text-center py-16 luxury-card rounded-2xl border-2 border-yellow-600/20">
            <div className="mx-auto w-24 h-24 bg-gradient-to-br from-yellow-500/20 to-amber-600/20 rounded-full flex items-center justify-center mb-6">
              <Coins className="w-12 h-12 text-yellow-400" />
            </div>
            <h3 className="text-2xl font-bold gold-text mb-2">
              슬롯을 찾을 수 없습니다
            </h3>
            <p className="text-yellow-200/80 text-lg mb-4">
              {searchTerm ? `"${searchTerm}"에 대한 검색 결과가 없습니다.` : 
               selectedCategory !== 'all' ? '선택한 카테고리의 슬롯이 없습니다.' : 
               '사용 가능한 슬롯 게임이 없습니다.'}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('all');
              }}
              className="border-yellow-600/30 text-yellow-300 hover:bg-yellow-900/20"
            >
              전체 슬롯 보기
            </Button>
          </div>
        )}

        {/* 더 보기 버튼 */}
        {hasMore && filteredGames.length > 0 && filteredGames.length >= 100 && (
          <div className="text-center">
            <Button
              variant="outline"
              size="lg"
              onClick={async () => {
                const nextPage = page + 1;
                setPage(nextPage);
                
                try {
                  setLoading(true);
                  const moreGames = await gameApi.getUserVisibleGames(
                    user.id,
                    'slot',
                    selectedProvider !== 'all' ? parseInt(selectedProvider) : undefined,
                    undefined,
                    100,
                    nextPage * 100
                  );
                  
                  if (moreGames.length < 100) {
                    setHasMore(false);
                  }
                  
                  setGames(prev => [...prev, ...moreGames]);
                } catch (error) {
                  console.error('추가 게임 로드 실패:', error);
                  toast.error('더 많은 게임을 불러오는데 실패했습니다.');
                } finally {
                  setLoading(false);
                }
              }}
              className="border-yellow-600/30 text-yellow-300 hover:bg-yellow-900/20 px-8 py-3"
            >
              더 많은 슬롯 보기
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}