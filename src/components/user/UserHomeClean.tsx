import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { 
  TrendingUp, 
  Gamepad2, 
  Coins, 
  Trophy,
  Star,
  ArrowRight,
  Zap,
  Clock,
  Users,
  Gift,
  CreditCard,
  ArrowUpDown
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useWebSocket } from "../../hooks/useWebSocket";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";

interface UserHomeProps {
  user: any;
  onRouteChange: (route: string) => void;
}

interface PopularGame {
  id: number;
  name: string;
  provider_name: string;
  image_url: string;
  type: 'slot' | 'casino';
  is_hot: boolean;
  play_count: number;
}

interface RecentAnnouncement {
  id: string;
  title: string;
  created_at: string;
  is_popup: boolean;
  view_count: number;
}

interface JackpotInfo {
  provider: string;
  amount: number;
  last_winner: string;
}

export function UserHome({ user, onRouteChange }: UserHomeProps) {
  const [popularGames, setPopularGames] = useState<PopularGame[]>([]);
  const [recentAnnouncements, setRecentAnnouncements] = useState<RecentAnnouncement[]>([]);
  const [jackpotInfo, setJackpotInfo] = useState<JackpotInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [todayStats, setTodayStats] = useState({
    totalPlayers: 0,
    totalBets: 0,
    bigWins: 0
  });
  const [jackpotCounter, setJackpotCounter] = useState(88888888);
  const { isConnected } = useWebSocket();

  const fetchPopularGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          id,
          name,
          image_url,
          type,
          game_providers (
            name
          )
        `)
        .eq('status', 'visible')
        .limit(8);

      if (error) throw error;

      const gamesWithProviders = data?.map(game => ({
        id: game.id,
        name: game.name,
        provider_name: game.game_providers?.name || 'Unknown',
        image_url: game.image_url || '/placeholder-game.png',
        type: game.type as 'slot' | 'casino',
        is_hot: Math.random() > 0.7,
        play_count: Math.floor(Math.random() * 1000) + 100
      })) || [];

      setPopularGames(gamesWithProviders);
    } catch (error) {
      console.error('인기 게임 조회 오류:', error);
    }
  };

  const fetchRecentAnnouncements = async () => {
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, created_at, is_popup, view_count')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentAnnouncements(data || []);
    } catch (error) {
      console.error('공지사항 조회 오류:', error);
    }
  };

  const fetchJackpotInfo = async () => {
    const mockJackpots: JackpotInfo[] = [
      { provider: '프라그마틱', amount: 123456789, last_winner: '김**' },
      { provider: '에볼루션', amount: 987654321, last_winner: '이**' },
      { provider: 'PG소프트', amount: 567891234, last_winner: '박**' }
    ];
    setJackpotInfo(mockJackpots);
  };

  const fetchTodayStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { count: onlineCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('online_status', true);

      const { count: betCount } = await supabase
        .from('game_records')
        .select('*', { count: 'exact', head: true })
        .gte('played_at', `${today}T00:00:00.000Z`)
        .lt('played_at', `${today}T23:59:59.999Z`);

      setTodayStats({
        totalPlayers: onlineCount || 0,
        totalBets: betCount || 0,
        bigWins: Math.floor(Math.random() * 50) + 10
      });
    } catch (error) {
      console.error('통계 조회 오류:', error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchPopularGames(),
        fetchRecentAnnouncements(),
        fetchJackpotInfo(),
        fetchTodayStats()
      ]);
      setIsLoading(false);
    };

    loadData();

    const jackpotInterval = setInterval(() => {
      setJackpotCounter(prev => prev + Math.floor(Math.random() * 1000) + 100);
    }, 2000);

    const subscription = supabase
      .channel('home_updates')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'announcements'
      }, () => {
        fetchRecentAnnouncements();
      })
      .subscribe();

    return () => {
      clearInterval(jackpotInterval);
      subscription.unsubscribe();
    };
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(amount);
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return '방금 전';
    if (diffInHours < 24) return `${diffInHours}시간 전`;
    return `${Math.floor(diffInHours / 24)}일 전`;
  };

  const handleGameClick = (game: PopularGame) => {
    if (game.type === 'slot') {
      onRouteChange('/user/slot');
    } else {
      onRouteChange('/user/casino');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8 w-full overflow-x-hidden">
      {/* VIP 웰컴 섹션 */}
      <div className="relative overflow-hidden rounded-3xl luxury-card border-2 border-yellow-600/40">
        {/* 배경 애니메이션 */}
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-900/20 via-red-900/30 to-black/50" />
        <div className="absolute inset-0 opacity-30" style={{
          background: `url('https://images.unsplash.com/photo-1680191741548-1a9321688cc3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxsdXh1cnklMjB2aXAlMjBjYXNpbm8lMjBiYWNrZ3JvdW5kfGVufDF8fHx8MTc1OTcxODU3Mnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }} />
        
        <div className="relative z-10 p-4 sm:p-6 lg:p-8 xl:p-12">
          <div className="max-w-full lg:max-w-4xl">
            {/* VIP 환영 메시지 */}
            <div className="flex items-center gap-3 mb-4">
              <Trophy className="w-10 h-10 text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
              <h1 className="text-4xl lg:text-5xl font-bold gold-text neon-glow">
                VIP 환영합니다!
              </h1>
            </div>
            
            <p className="text-2xl text-yellow-100 mb-2">
              {user.nickname}님의 럭셔리 게이밍
            </p>
            <p className="text-yellow-300/80 text-lg mb-8 tracking-wide">
              최고의 VIP 경험을 제공합니다 💎✨
            </p>

            {/* VIP 빠른 액션 버튼 */}
            <div className="flex flex-wrap gap-2 sm:gap-3 lg:gap-4">
              <Button 
                onClick={() => onRouteChange('/user/slot')}
                className="deposit-button text-white font-semibold px-3 sm:px-4 lg:px-6 py-3 sm:py-4 lg:py-6 text-sm sm:text-base hover:scale-105 transition-transform border border-green-400/30 flex-shrink-0"
              >
                <Coins className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2 drop-shadow-lg" />
                <span className="hidden sm:inline">VIP 슬롯 게임</span>
                <span className="sm:hidden">슬롯</span>
              </Button>
              <Button 
                onClick={() => onRouteChange('/user/casino')}
                className="withdraw-button text-white font-semibold px-3 sm:px-4 lg:px-6 py-3 sm:py-4 lg:py-6 text-sm sm:text-base hover:scale-105 transition-transform border border-red-400/30 flex-shrink-0"
              >
                <Gamepad2 className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2 drop-shadow-lg" />
                <span className="hidden sm:inline">VIP 라이브 카지노</span>
                <span className="sm:hidden">카지노</span>
              </Button>
              <Button 
                onClick={() => onRouteChange('/user/deposit')}
                className="bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-bold px-3 sm:px-4 lg:px-6 py-3 sm:py-4 lg:py-6 text-sm sm:text-base shadow-lg shadow-yellow-500/40 hover:shadow-yellow-500/60 hover:scale-105 transition-all border border-yellow-300 flex-shrink-0"
              >
                <Gift className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                <span className="hidden lg:inline">입금하고 VIP 보너스</span>
                <span className="lg:hidden hidden sm:inline">VIP 입금</span>
                <span className="sm:hidden">입금</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* VIP 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="luxury-card border-2 border-emerald-600/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-300/70 text-sm mb-1 tracking-wide">VIP 멤버</p>
                <p className="text-3xl font-bold text-emerald-400 drop-shadow-lg">
                  {todayStats.totalPlayers.toLocaleString()}
                </p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30 flex items-center justify-center">
                <Users className="w-7 h-7 text-white drop-shadow-lg" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="luxury-card border-2 border-blue-600/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-300/70 text-sm mb-1 tracking-wide">VIP 베팅 수</p>
                <p className="text-3xl font-bold text-blue-400 drop-shadow-lg">
                  {todayStats.totalBets.toLocaleString()}
                </p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/30 flex items-center justify-center">
                <TrendingUp className="w-7 h-7 text-white drop-shadow-lg" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="luxury-card border-2 border-yellow-600/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-300/70 text-sm mb-1 tracking-wide">VIP 빅윈</p>
                <p className="text-3xl font-bold text-yellow-400 drop-shadow-lg neon-glow">
                  {todayStats.bigWins}
                </p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-yellow-500 to-amber-600 shadow-lg shadow-yellow-500/40 flex items-center justify-center">
                <Trophy className="w-7 h-7 text-white drop-shadow-lg" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 잭팟 정보 */}
      <Card className="bg-gradient-to-br from-yellow-900/20 to-orange-900/20 border-yellow-600/30">
        <CardHeader className="border-b border-yellow-600/20">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3 text-2xl">
              <Trophy className="w-6 h-6 text-yellow-400" />
              <span className="text-yellow-400">실시간 잭팟</span>
            </CardTitle>
            <Zap className="w-6 h-6 text-yellow-400" />
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="text-center mb-8 p-6 rounded-xl bg-slate-900/50 border border-yellow-600/20">
            <p className="text-slate-400 text-sm mb-2">총 누적 상금</p>
            <p className="text-4xl lg:text-5xl font-bold text-yellow-400">
              ₩{jackpotCounter.toLocaleString()}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {jackpotInfo.map((jackpot, index) => (
              <div key={index} className="text-center p-4 bg-slate-800/50 rounded-lg border border-yellow-600/10 hover:border-yellow-600/30 transition-colors">
                <p className="text-slate-300 font-medium mb-2">{jackpot.provider}</p>
                <p className="text-xl font-bold text-yellow-400 mb-1">
                  ₩{formatCurrency(jackpot.amount)}
                </p>
                <p className="text-xs text-slate-500">최근 당첨: {jackpot.last_winner}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* VIP 인기 게임 */}
        <div className="lg:col-span-2">
          <Card className="luxury-card border-2 border-yellow-600/20">
            <CardHeader className="border-b border-yellow-600/20">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-400 drop-shadow-lg" />
                  <span className="text-yellow-100 neon-glow">VIP 인기 게임</span>
                </CardTitle>
                <Button 
                  variant="ghost" 
                  onClick={() => onRouteChange('/user/slot')}
                  className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/20"
                >
                  전체보기 <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {popularGames.map((game) => (
                  <div 
                    key={game.id}
                    onClick={() => handleGameClick(game)}
                    className="relative group cursor-pointer luxury-card rounded-xl overflow-hidden border border-yellow-600/20 hover:border-yellow-500/60 transition-all game-card-hover"
                  >
                    <div className="aspect-square bg-gradient-to-br from-slate-700 to-slate-800 relative overflow-hidden">
                      {game.image_url ? (
                        <img 
                          src={game.image_url} 
                          alt={game.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Gamepad2 className="w-8 h-8 text-yellow-400 drop-shadow-lg" />
                        </div>
                      )}
                      {game.is_hot && (
                        <Badge className="absolute top-2 right-2 vip-badge text-white border-0 animate-pulse">
                          <Zap className="w-3 h-3 mr-1" />
                          VIP
                        </Badge>
                      )}
                    </div>
                    <div className="p-3 bg-gradient-to-b from-black/80 to-black/90 backdrop-blur-sm">
                      <h3 className="font-medium text-yellow-100 text-sm truncate">{game.name}</h3>
                      <p className="text-yellow-300/70 text-xs truncate">{game.provider_name}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-yellow-400/80 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {game.play_count}
                        </span>
                        <Badge variant="outline" className="text-xs border-yellow-600/30 text-yellow-300">
                          {game.type === 'slot' ? 'VIP 슬롯' : 'VIP 카지노'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* VIP 공지사항 */}
        <div>
          <Card className="luxury-card border-2 border-blue-600/20">
            <CardHeader className="border-b border-blue-600/20">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Gift className="w-5 h-5 text-blue-400 drop-shadow-lg" />
                  <span className="text-blue-300 neon-glow">VIP 공지사항</span>
                </CardTitle>
                <Button 
                  variant="ghost"
                  onClick={() => onRouteChange('/user/notice')}
                  className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                >
                  전체보기 <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                {recentAnnouncements.length > 0 ? (
                  recentAnnouncements.map((announcement) => (
                    <div 
                      key={announcement.id}
                      onClick={() => onRouteChange('/user/notice')}
                      className="p-3 bg-gradient-to-r from-slate-800/50 to-blue-900/20 rounded-lg border border-blue-600/20 hover:border-blue-500/60 cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-500/20"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          {announcement.is_popup && (
                            <Badge className="vip-badge text-white text-xs mb-2 border-0 animate-pulse">
                              VIP 중요
                            </Badge>
                          )}
                          <h4 className="text-blue-100 text-sm font-medium truncate mb-2">
                            {announcement.title}
                          </h4>
                          <div className="flex items-center justify-between text-xs text-blue-300/70">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimeAgo(announcement.created_at)}
                            </span>
                            <span>조회 {announcement.view_count}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-blue-300/50">
                    <Gift className="w-8 h-8 mx-auto mb-2 opacity-50 text-blue-400" />
                    <p className="text-sm">새로운 VIP 공지사항이 없습니다</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}
