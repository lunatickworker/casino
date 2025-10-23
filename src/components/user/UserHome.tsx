import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { 
  Sparkles, 
  Trophy, 
  Star, 
  Zap,
  TrendingUp,
  Gift,
  Crown,
  Flame,
  Users,
  Target,
  Play
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { User } from "../../types";
import { supabase } from "../../lib/supabase";
import { gameApi } from "../../lib/gameApi";

interface UserHomeProps {
  user: User;
  onRouteChange: (route: string) => void;
}

interface Banner {
  id: string;
  title: string;
  image_url: string;
  content?: string;
  display_order: number;
  status: string;
  banner_type: string;
}

interface PopularGame {
  game_id: number;
  name: string;
  provider_name: string;
  image_url?: string;
  play_count: number;
}

export function UserHome({ user, onRouteChange }: UserHomeProps) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [popularGames, setPopularGames] = useState<PopularGame[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // 배너 데이터 가져오기
  useEffect(() => {
    const fetchBanners = async () => {
      try {
        const { data, error } = await supabase
          .from('banners')
          .select('*')
          .eq('status', 'active')
          .eq('banner_type', 'banner')
          .order('display_order', { ascending: true });

        if (error) throw error;
        setBanners(data || []);
      } catch (error) {
        console.error('배너 조회 오류:', error);
      }
    };

    fetchBanners();
  }, []);

  // 인기 게임 데이터 가져오기
  useEffect(() => {
    const fetchPopularGames = async () => {
      try {
        setLoading(true);
        
        // 게임 플레이 횟수 기반 인기 게임 조회
        const { data, error } = await supabase
          .from('game_launch_sessions')
          .select(`
            game_id,
            games:game_id (
              id,
              name,
              image_url,
              game_providers:provider_id (
                name
              )
            )
          `)
          .gte('launched_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // 최근 7일
          .limit(100);

        if (error) throw error;

        // 게임별 플레이 횟수 집계
        const gamePlayCounts = new Map<number, { game: any; count: number }>();
        
        data?.forEach((session: any) => {
          if (session.games) {
            const gameId = session.game_id;
            const existing = gamePlayCounts.get(gameId);
            if (existing) {
              existing.count++;
            } else {
              gamePlayCounts.set(gameId, { game: session.games, count: 1 });
            }
          }
        });

        // 상위 8개 게임 추출
        const topGames = Array.from(gamePlayCounts.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
          .map(({ game, count }) => ({
            game_id: game.id,
            name: game.name,
            provider_name: game.game_providers?.name || 'Unknown',
            image_url: game.image_url,
            play_count: count
          }));

        setPopularGames(topGames);
      } catch (error) {
        console.error('인기 게임 조회 오류:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPopularGames();
  }, []);

  // 배너 자동 슬라이드
  useEffect(() => {
    if (banners.length > 1) {
      const interval = setInterval(() => {
        setCurrentBannerIndex((prev) => (prev + 1) % banners.length);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [banners.length]);

  // 게임 실행
  const handlePlayGame = async (gameId: number, gameName: string) => {
    try {
      toast.info(`${gameName} 게임을 시작합니다...`);
      
      const result = await gameApi.launchGame(user.id, gameId);
      
      if (result.success && result.launchUrl) {
        // 새 창에서 게임 실행
        window.open(result.launchUrl, '_blank', 'width=1200,height=800');
        toast.success('게임이 시작되었습니다!');
      } else {
        throw new Error(result.error || '게임 실행에 실패했습니다.');
      }
    } catch (error) {
      console.error('게임 실행 오류:', error);
      toast.error(error instanceof Error ? error.message : '게임 실행 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="space-y-6">
      {/* 환영 메시지 */}
      <div className="luxury-card p-6 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold gold-text flex items-center gap-2">
              <Crown className="h-8 w-8" />
              환영합니다, {user.nickname}님!
            </h1>
            <p className="text-slate-300 mt-2">
              최고의 게임 경험을 즐겨보세요
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-slate-400">보유 잔고</p>
              <p className="text-2xl font-bold text-yellow-400">
                {typeof user.balance === 'number' ? user.balance.toLocaleString() : '0'}원
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 배너 슬라이더 */}
      {banners.length > 0 && (
        <div className="relative rounded-xl overflow-hidden luxury-card">
          <div className="relative h-64 md:h-80">
            {banners.map((banner, index) => (
              <div
                key={banner.id}
                className={`absolute inset-0 transition-opacity duration-500 ${
                  index === currentBannerIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <ImageWithFallback
                  src={banner.image_url}
                  alt={banner.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                  <h3 className="text-2xl font-bold text-white">{banner.title}</h3>
                </div>
              </div>
            ))}
          </div>
          
          {/* 배너 인디케이터 */}
          {banners.length > 1 && (
            <div className="absolute bottom-4 right-4 flex gap-2">
              {banners.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentBannerIndex(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === currentBannerIndex 
                      ? 'bg-yellow-400 w-8' 
                      : 'bg-white/50'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 빠른 메뉴 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          onClick={() => onRouteChange('/user/casino')}
          className="luxury-card p-6 rounded-xl hover:scale-105 transition-all text-center group"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-full bg-gradient-to-br from-yellow-500/20 to-red-500/20 group-hover:from-yellow-500/30 group-hover:to-red-500/30 transition-all">
              <Sparkles className="h-8 w-8 text-yellow-400" />
            </div>
            <div>
              <p className="font-bold text-white text-lg">카지노</p>
              <p className="text-xs text-slate-400 mt-1">실시간 라이브</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => onRouteChange('/user/slot')}
          className="luxury-card p-6 rounded-xl hover:scale-105 transition-all text-center group"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 group-hover:from-purple-500/30 group-hover:to-pink-500/30 transition-all">
              <Target className="h-8 w-8 text-purple-400" />
            </div>
            <div>
              <p className="font-bold text-white text-lg">슬롯</p>
              <p className="text-xs text-slate-400 mt-1">다양한 게임</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => onRouteChange('/user/deposit')}
          className="luxury-card p-6 rounded-xl hover:scale-105 transition-all text-center group"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 group-hover:from-green-500/30 group-hover:to-emerald-500/30 transition-all">
              <TrendingUp className="h-8 w-8 text-green-400" />
            </div>
            <div>
              <p className="font-bold text-white text-lg">입금</p>
              <p className="text-xs text-slate-400 mt-1">빠른 충전</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => onRouteChange('/user/withdraw')}
          className="luxury-card p-6 rounded-xl hover:scale-105 transition-all text-center group"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 group-hover:from-blue-500/30 group-hover:to-cyan-500/30 transition-all">
              <Gift className="h-8 w-8 text-blue-400" />
            </div>
            <div>
              <p className="font-bold text-white text-lg">출금</p>
              <p className="text-xs text-slate-400 mt-1">안전한 출금</p>
            </div>
          </div>
        </button>
      </div>

      {/* 인기 게임 */}
      <div className="luxury-card p-6 rounded-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Flame className="h-6 w-6 text-orange-400" />
            인기 게임
          </h2>
          <Badge className="bg-gradient-to-r from-orange-500 to-red-500">
            <Star className="h-3 w-3 mr-1" />
            HOT
          </Badge>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-[3/4] bg-slate-700/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : popularGames.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {popularGames.map((game) => (
              <div
                key={game.game_id}
                className="group relative rounded-lg overflow-hidden game-card-hover bg-slate-800/50 border border-slate-700/50"
              >
                <div className="aspect-[3/4] relative">
                  <ImageWithFallback
                    src={game.image_url || ''}
                    alt={game.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button
                      onClick={() => handlePlayGame(game.game_id, game.name)}
                      className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      플레이
                    </Button>
                  </div>
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-red-500/90">
                      <Users className="h-3 w-3 mr-1" />
                      {game.play_count}
                    </Badge>
                  </div>
                </div>
                <div className="p-3">
                  <p className="font-bold text-white text-sm truncate">{game.name}</p>
                  <p className="text-xs text-slate-400 truncate">{game.provider_name}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400">
            인기 게임 정보가 없습니다.
          </div>
        )}
      </div>

      {/* VIP 혜택 안내 */}
      <div className="luxury-card p-6 rounded-xl bg-gradient-to-br from-yellow-900/20 to-orange-900/20">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-full bg-yellow-500/20">
            <Trophy className="h-8 w-8 text-yellow-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-yellow-400 mb-2">VIP 회원 혜택</h3>
            <p className="text-slate-300 mb-4">
              더 많은 게임을 즐기고 VIP 레벨을 올려 특별한 혜택을 받아보세요!
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-300">
                <Zap className="h-4 w-4 text-yellow-400" />
                빠른 입출금
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Gift className="h-4 w-4 text-yellow-400" />
                특별 보너스
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Crown className="h-4 w-4 text-yellow-400" />
                전용 고객지원
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UserHome;
