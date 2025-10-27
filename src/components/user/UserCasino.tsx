import React from 'react';
import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { GameProviderSelector } from "./GameProviderSelector";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { 
  Play, 
  Users, 
  Loader, 
  Search, 
  Crown,
  Zap,
  Star,
  Clock,
  Trophy,
  Sparkles,
  Target,
  Dice6
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { User } from "../../types";
import { gameApi } from "../../lib/gameApi";
import { useWebSocket } from "../../hooks/useWebSocket";
import { supabase } from "../../lib/supabase";

interface CasinoGame {
  game_id: number;
  provider_id: number;
  provider_name: string;
  game_name: string;
  game_type: string;
  image_url?: string;
  is_featured: boolean;
  status: string;
  priority: number;
}

interface UserCasinoProps {
  user: User;
  onRouteChange: (route: string) => void;
}

const gameCategories = [
  { id: 'all', name: '전체', icon: Crown, gradient: 'from-yellow-500 to-amber-600' },
  { id: 'evolution', name: '에볼루션', icon: Target, gradient: 'from-red-500 to-red-600' },
  { id: 'pragmatic', name: '프라그마틱', icon: Zap, gradient: 'from-blue-500 to-blue-600' },
  { id: 'baccarat', name: '바카라', icon: Sparkles, gradient: 'from-purple-500 to-purple-600' },
  { id: 'blackjack', name: '블랙잭', icon: Dice6, gradient: 'from-green-500 to-green-600' },
  { id: 'roulette', name: '룰렛', icon: Trophy, gradient: 'from-orange-500 to-orange-600' }
];

export function UserCasino({ user, onRouteChange }: UserCasinoProps) {
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [games, setGames] = useState<CasinoGame[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [launchingGameId, setLaunchingGameId] = useState<number | null>(null);

  // WebSocket 연결
  const { sendMessage, isConnected } = useWebSocket();

  useEffect(() => {
    initializeData();
  }, []);

  useEffect(() => {
    if (isConnected) {
      // 카지노 게임 상태 변경 실시간 수신
      sendMessage({
        type: 'subscribe',
        channel: 'casino_status_updates',
        userId: user.id
      });
    }
  }, [isConnected, user.id]);

  useEffect(() => {
    loadCasinoGames();
  }, [selectedProvider, selectedCategory]);



  const initializeData = async () => {
    try {
      setLoading(true);
      
      // 제공사 목록 로드
      const providersData = await gameApi.getProviders();
      let casinoProviders = providersData.filter(p => p.type === 'casino');
      
      // 제공사가 부족한 경우 하드코딩된 데이터 사용
      if (casinoProviders.length < 10) {
        casinoProviders = [
          { id: 410, name: '에볼루션 게이밍', type: 'casino', status: 'active' },
          { id: 77, name: '마이크로 게이밍', type: 'casino', status: 'active' },
          { id: 2, name: 'Vivo 게이밍', type: 'casino', status: 'active' },
          { id: 30, name: '아시아 게이밍', type: 'casino', status: 'active' },
          { id: 78, name: '프라그마틱플레이', type: 'casino', status: 'active' },
          { id: 86, name: '섹시게이밍', type: 'casino', status: 'active' },
          { id: 11, name: '비비아이엔', type: 'casino', status: 'active' },
          { id: 28, name: '드림게임', type: 'casino', status: 'active' },
          { id: 89, name: '오리엔탈게임', type: 'casino', status: 'active' },
          { id: 91, name: '보타', type: 'casino', status: 'active' },
          { id: 44, name: '이주기', type: 'casino', status: 'active' },
          { id: 85, name: '플레이텍 라이브', type: 'casino', status: 'active' },
          { id: 0, name: '제네럴 카지노', type: 'casino', status: 'active' }
        ];
      }
      
      setProviders(casinoProviders);
      
      // 초기 카지노 게임 목록 로드
      await loadCasinoGames();
      
    } catch (error) {
      toast.error('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadCasinoGames = async () => {
    try {
      setLoading(true);

      // 직접 게임 조회 방식으로 변경 (fallback)
      let gamesData;
      try {
        gamesData = await gameApi.getUserVisibleGames(
          user.id,
          'casino',
          selectedProvider !== 'all' ? parseInt(selectedProvider) : undefined,
          undefined,
          100, // 일반적인 게임 로드
          0
        );
      } catch (rpcError) {
        console.error('RPC 함수 호출 실패, 직접 조회로 fallback:', rpcError);
        
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
          .eq('type', 'casino')
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
          priority: game.priority || 0
        })) || [];
      }

      // 카지노 게임은 우선순위와 추천 순으로 정렬
      const sortedGames = gamesData.sort((a, b) => {
        if (a.is_featured && !b.is_featured) return -1;
        if (!a.is_featured && b.is_featured) return 1;
        return b.priority - a.priority;
      });

      setGames(sortedGames);
      
    } catch (error) {
      console.error('❌ 카지노 게임 로드 실패:', error);
      toast.error('카지노 게���을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleGameClick = async (game: CasinoGame) => {
    if (launchingGameId === game.game_id) {
      return; // 이미 실행 중
    }

    setLaunchingGameId(game.game_id);
    
    try {
      console.log('🎮 카지노 게임 실행 시작:', {
        userId: user.id,
        gameId: game.game_id,
        gameName: game.game_name
      });
      
      const result = await gameApi.generateGameLaunchUrl(user.id, game.game_id);
      
      console.log('🎮 카지노 게임 실행 결과:', result);
      
      if (result.success && result.launchUrl) {
        const sessionId = result.sessionId; // 반환된 sessionId 사용
        
        // 카지노는 풀스크린으로 실행
        const gameWindow = window.open(
          result.launchUrl,
          '_blank',
          'width=1920,height=1080,scrollbars=yes,resizable=yes,fullscreen=yes'
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
          toast.success(`${game.game_name} VIP 카지노에 입장했습니다.`);
          
          // 카지노 입장 통계 업데이트
          sendMessage({
            type: 'casino_entered',
            userId: user.id,
            gameId: game.game_id,
            providerName: game.provider_name,
            sessionId: sessionId,
            timestamp: new Date().toISOString()
          });

          // 게임 창 종료 감지 (주기적 체크)
          if (sessionId) {
            // 게임 창이 열린 후 10초 대기 (즉시 종료 문제 방지)
            setTimeout(() => {
              const checkGameWindow = setInterval(() => {
                if (gameWindow.closed) {
                  clearInterval(checkGameWindow);
                  console.log('🎮 카지노 게임 창 종료 감지');
                  // 3초 후 잔고 동기화 실행
                  setTimeout(() => {
                    (window as any).syncBalanceAfterGame?.(sessionId);
                  }, 3000);
                }
              }, 2000);
            }, 10000); // 10초 후부터 체크 시작
          }
        }
      } else {
        // 로딩 toast 닫기
        toast.dismiss(`game-loading-${game.game_id}`);
        console.error('❌ 카지노 게임 실행 실패:', result.error);
        toast.error(`카지노 입장 실패: ${result.error || '알 수 없는 오류가 발생했습니다.'}`);
      }
    } catch (error) {
      // 로딩 toast 닫기
      toast.dismiss(`game-loading-${game.game_id}`);
      console.error('❌ 카지노 실행 예외 발생:', error);
      toast.error(`카지노 입장 중 오류: ${error instanceof Error ? error.message : '시스템 오류가 발생했습니다.'}`);
    } finally {
      setLaunchingGameId(null);
    }
  };

  const getGameImage = (game: CasinoGame) => {
    // DB에 저장된 image_url 직접 사용
    if (game.image_url && game.image_url.trim() && game.image_url !== 'null') {
      return game.image_url;
    }
    // 이미지가 없는 경우 ImageWithFallback이 자동으로 플레이스홀더 처리
    return null;
  };

  const filteredGames = games.filter(game => {
    const matchesSearch = searchQuery === '' || 
                         game.game_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         game.provider_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesCategory = true;
    if (selectedCategory !== 'all') {
      const gameName = game.game_name.toLowerCase();
      const providerName = game.provider_name.toLowerCase();
      
      switch (selectedCategory) {
        case 'evolution':
          matchesCategory = providerName.includes('evolution') || 
                           providerName.includes('에볼루션');
          break;
        case 'pragmatic':
          matchesCategory = providerName.includes('pragmatic') || 
                           providerName.includes('프라그마틱');
          break;
        case 'baccarat':
          matchesCategory = gameName.includes('baccarat') || 
                           gameName.includes('바카라');
          break;
        case 'blackjack':
          matchesCategory = gameName.includes('blackjack') || 
                           gameName.includes('블랙잭') ||
                           gameName.includes('black jack');
          break;
        case 'roulette':
          matchesCategory = gameName.includes('roulette') || 
                           gameName.includes('룰렛');
          break;
        default:
          matchesCategory = true;
      }
    }
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* VIP 카지노 배경 */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.8)), url('https://images.unsplash.com/photo-1680191741548-1a9321688cc3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxsdXh1cnklMjBjYXNpbm8lMjBpbnRlcmlvciUyMGJhY2tncm91bmR8ZW58MXx8fHwxNzU5NzIwMzYzfDA&ixlib=rb-4.1.0&q80&w=1080&utm_source=figma&utm_medium=referral')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      />
      
      <div className="relative z-10 space-y-8 p-4 sm:p-6 lg:p-8">
        {/* VIP 헤더 */}
        <div className="text-center space-y-6">
          <div className="flex items-center justify-center gap-4 mb-6">
            <Crown className="w-16 h-16 text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
            <h1 className="text-6xl lg:text-7xl font-bold gold-text neon-glow">
              VIP 라이브 카지노
            </h1>
            <Crown className="w-16 h-16 text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
          </div>
          <p className="text-3xl text-yellow-100 tracking-wide">
            세계 최고의 딜러와 함께하는 프리미엄 게임 경험
          </p>
          <div className="flex items-center justify-center gap-6 text-yellow-300/80 text-lg">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span>실시간 라이브</span>
            </div>
            <div className="w-px h-6 bg-yellow-600/50" />
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <span>24시간 운영</span>
            </div>
            <div className="w-px h-6 bg-yellow-600/50" />
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              <span>VIP 전용</span>
            </div>
          </div>
        </div>

        {/* 검색 및 필터 */}
        <div className="flex flex-col lg:flex-row gap-5 items-center justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-6 h-6 text-yellow-400" />
            <Input
              type="text"
              placeholder="게임 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-14 text-lg bg-black/50 border-yellow-600/30 text-white placeholder:text-yellow-200/50 focus:border-yellow-500"
            />
          </div>
          
          {/* 카테고리 선택 */}
          <div className="flex flex-wrap gap-3">
            {gameCategories.map((category) => {
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
        </div>

        {/* 제공사 선택 */}
        <div className="luxury-card rounded-3xl p-8 border-2 border-yellow-600/20">
          <GameProviderSelector
            selectedProvider={selectedProvider}
            onProviderChange={setSelectedProvider}
            gameType="casino"
            providers={providers}
          />
        </div>

        {/* 카지노 게임 목록 */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="luxury-card animate-pulse border-yellow-600/20">
                <div className="aspect-[4/3] bg-gradient-to-br from-slate-700 to-slate-800 rounded-t-xl" />
                <CardContent className="p-4 space-y-3">
                  <div className="h-5 bg-gradient-to-r from-yellow-600/20 to-yellow-400/20 rounded" />
                  <div className="h-4 bg-gradient-to-r from-yellow-600/20 to-yellow-400/20 rounded w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredGames.map((game) => (
              <Card 
                key={game.game_id} 
                className={`luxury-card group cursor-pointer border-2 border-yellow-600/20 hover:border-yellow-500/60 transition-all game-card-hover overflow-hidden ${
                  launchingGameId === game.game_id ? 'opacity-50' : ''
                }`}
                onClick={() => handleGameClick(game)}
              >
                <div className="aspect-[4/3] relative overflow-hidden">
                  <ImageWithFallback
                    src={getGameImage(game)}
                    alt={game.game_name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  
                  {/* 그라데이션 오버레이 */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  
                  {/* 라이브 배지 */}
                  <div className="absolute top-3 left-3">
                    <Badge className="bg-red-500 text-white border-0 animate-pulse shadow-lg">
                      <div className="w-2 h-2 bg-white rounded-full mr-1" />
                      LIVE
                    </Badge>
                  </div>

                  {/* 추천 배지 */}
                  {game.is_featured && (
                    <div className="absolute top-3 right-3">
                      <Badge className="vip-badge text-white border-0">
                        <Star className="w-3 h-3 mr-1" />
                        VIP
                      </Badge>
                    </div>
                  )}

                  {/* 호버 오버레이 */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                    {launchingGameId === game.game_id ? (
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader className="w-8 h-8 animate-spin" />
                        <span className="text-sm font-semibold">입장 중...</span>
                      </div>
                    ) : (
                      <Button 
                        size="lg" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 text-black font-bold shadow-lg shadow-yellow-500/40"
                        disabled={launchingGameId === game.game_id}
                      >
                        <Play className="w-5 h-5 mr-2" />
                        VIP 입장
                      </Button>
                    )}
                  </div>

                  {/* 하단 정보 */}
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
                </div>
              </Card>
            ))}
          </div>
        )}

        {filteredGames.length === 0 && !loading && (
          <div className="text-center py-16 luxury-card rounded-2xl border-2 border-yellow-600/20">
            <div className="mx-auto w-24 h-24 bg-gradient-to-br from-yellow-500/20 to-amber-600/20 rounded-full flex items-center justify-center mb-6">
              <Crown className="w-12 h-12 text-yellow-400" />
            </div>
            <h3 className="text-2xl font-bold gold-text mb-2">
              게임을 찾을 수 없습니다
            </h3>
            <p className="text-yellow-200/80 text-lg mb-4">
              {searchQuery ? `"${searchQuery}"에 대한 검색 결과가 없습니다.` : 
               selectedCategory !== 'all' ? '선택한 카테고리의 게임이 없습니다.' : 
               selectedProvider !== 'all' ? '선택한 제공사의 게임이 없습니다.' :
               '사용 가능한 카지노 게임이 없습니다.'}
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setSelectedProvider('all');
                }}
                className="border-yellow-600/30 text-yellow-300 hover:bg-yellow-900/20"
              >
                전체 게임 보기
              </Button>
              <Button
                variant="outline"
                onClick={() => loadCasinoGames()}
                className="border-yellow-600/30 text-yellow-300 hover:bg-yellow-900/20"
              >
                새로고침
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}