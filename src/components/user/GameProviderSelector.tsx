import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Gamepad2, Coins, CheckCircle } from "lucide-react";

interface GameProvider {
  id: number;
  name: string;
  logo_url?: string;
  status: 'active' | 'inactive' | 'maintenance';
  type: string;
  game_count?: number;
}

interface GameProviderSelectorProps {
  selectedProvider: string;
  onProviderChange: (providerId: string) => void;
  gameType: 'slot' | 'casino';
  providers?: GameProvider[];
}

export function GameProviderSelector({ 
  selectedProvider, 
  onProviderChange, 
  gameType, 
  providers = [] 
}: GameProviderSelectorProps) {
  const [displayProviders, setDisplayProviders] = useState<GameProvider[]>([]);

  useEffect(() => {
    // 게임 타입에 맞는 제공사만 필터링
    const filteredProviders = providers.filter(p => 
      p.type === gameType && p.status === 'active'
    );
    
    // 만약 필터링된 제공사가 없다면 기본 제공사 사용
    if (filteredProviders.length === 0 && providers.length > 0) {
      
      if (gameType === 'slot') {
        const defaultSlotProviders = [
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
        setDisplayProviders(defaultSlotProviders);
      } else if (gameType === 'casino') {
        const defaultCasinoProviders = [
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
        setDisplayProviders(defaultCasinoProviders);
      }
    } else {
      setDisplayProviders(filteredProviders);
    }
  }, [providers, gameType]);

  const getProviderIcon = (gameType: string) => {
    switch (gameType) {
      case 'slot':
        return <Coins className="w-4 h-4" />;
      case 'casino':
        return <Gamepad2 className="w-4 h-4" />;
      default:
        return <Gamepad2 className="w-4 h-4" />;
    }
  };

  const getGameTypeLabel = (gameType: string) => {
    switch (gameType) {
      case 'slot':
        return '슬롯';
      case 'casino':
        return '카지노';
      default:
        return gameType;
    }
  };

  return (
    <div className="space-y-6">
      {/* VIP 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center shadow-lg">
          {getProviderIcon(gameType)}
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold gold-text neon-glow">
            {gameType === 'slot' ? 'VIP 슬롯' : 'VIP 카지노'} 제공사
          </h3>
          <p className="text-yellow-300/70 text-sm">
            프리미엄 게임 파트너와 함께하세요
          </p>
        </div>
        <Badge className="vip-badge text-white px-3 py-1">
          {displayProviders.length}개 파트너
        </Badge>
      </div>

      {/* VIP 제공사 선택 */}
      <ScrollArea className="w-full">
        <div className="flex gap-3 pb-4">
          {/* 전체 선택 버튼 */}
          <Button
            variant="ghost"
            onClick={() => onProviderChange("all")}
            className={`
              flex-shrink-0 gap-2 px-6 py-3 rounded-xl font-semibold transition-all duration-300
              ${selectedProvider === "all" 
                ? 'bg-gradient-to-r from-yellow-600 to-amber-600 text-black shadow-lg shadow-yellow-500/50' 
                : 'text-yellow-200/80 hover:text-yellow-100 hover:bg-yellow-900/20 border border-yellow-600/30'
              }
            `}
          >
            {selectedProvider === "all" && <CheckCircle className="w-4 h-4" />}
            전체 게임
          </Button>

          {/* 개별 제공사 버튼들 */}
          {displayProviders.map((provider) => {
            const isSelected = selectedProvider === provider.id.toString();
            return (
              <Button
                key={provider.id}
                variant="ghost"
                onClick={() => onProviderChange(provider.id.toString())}
                className={`
                  flex-shrink-0 gap-2 min-w-32 px-4 py-3 rounded-xl font-semibold transition-all duration-300
                  ${isSelected 
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/50' 
                    : 'text-yellow-200/80 hover:text-yellow-100 hover:bg-yellow-900/20 border border-yellow-600/30'
                  }
                `}
              >
                {isSelected && <CheckCircle className="w-4 h-4" />}
                <span className="truncate">{provider.name}</span>
              </Button>
            );
          })}
        </div>
      </ScrollArea>

      {/* 선택된 제공사 정보 */}
      {selectedProvider !== "all" && (
        <div className="text-sm text-yellow-300/80 bg-black/30 rounded-lg p-3 border border-yellow-600/20">
          {(() => {
            const selected = displayProviders.find(p => p.id.toString() === selectedProvider);
            return selected ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                <span>
                  <span className="font-semibold text-yellow-200">{selected.name}</span> 제공사의 VIP {getGameTypeLabel(gameType)} 게임
                </span>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {displayProviders.length === 0 && (
        <div className="text-center py-12 luxury-card rounded-xl border-2 border-yellow-600/20">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-yellow-500/20 to-amber-600/20 rounded-full flex items-center justify-center mb-4">
            {getProviderIcon(gameType)}
          </div>
          <h3 className="text-lg font-bold gold-text mb-2">
            제공사를 찾을 수 없습니다
          </h3>
          <p className="text-yellow-200/80">
            사용 가능한 VIP {getGameTypeLabel(gameType)} 제공사가 없습니다.
          </p>
        </div>
      )}
    </div>
  );
}