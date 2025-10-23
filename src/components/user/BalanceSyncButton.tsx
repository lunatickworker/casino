import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { supabase } from '../../lib/supabase';
import { investApi } from '../../lib/investApi';
import { useWebSocketContext } from '../../contexts/WebSocketContext';

interface BalanceSyncButtonProps {
  user: any;
  onBalanceUpdate?: (newBalance: number) => void;
  autoSync?: boolean; // 자동 동기화 옵션
  showButton?: boolean; // 버튼 표시 여부
}

export function BalanceSyncButton({ 
  user, 
  onBalanceUpdate, 
  autoSync = false, 
  showButton = true 
}: BalanceSyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const { connected, sendMessage } = useWebSocketContext();

  // 게임 상태 감지 및 자동 동기화
  useEffect(() => {
    if (!autoSync || !user) return;

    // 게임 종료 감지 함수
    const detectGameReturn = () => {
      const gameActivityKey = `game_activity_${user.id}`;
      const lastGameActivity = localStorage.getItem(gameActivityKey);
      
      if (lastGameActivity) {
        const gameTime = parseInt(lastGameActivity);
        const timeSinceGame = Date.now() - gameTime;
        
        // 2분 이내에 게임 활동이 있었고, 현재 홈으로 돌아온 경우
        if (timeSinceGame < 120000 && timeSinceGame > 5000) { // 5초~2분 사이
          console.log('🎮 게임 복귀 감지 - 자동 잔고 동기화 실행');
          handleRefreshBalance(true);
          localStorage.removeItem(gameActivityKey); // 사용된 기록 제거
        }
      }
    };

    // 페이지 포커스 시 게임 복귀 감지
    const handleFocus = () => {
      setTimeout(detectGameReturn, 1000); // 1초 지연 후 검사
    };

    // 페이지 가시성 변경 시 감지
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setTimeout(detectGameReturn, 1000);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 초기 검사
    detectGameReturn();

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoSync, user]);

  const handleRefreshBalance = async (isAutoSync = false, useApi = false) => {
    if (!user) {
      if (!isAutoSync) toast.error('사용자 정보가 없습니다.');
      return;
    }

    // 너무 빈번한 호출 방지 (30초 쿨다운)
    const now = Date.now();
    if (now - lastSyncTime < 30000) {
      if (!isAutoSync) {
        toast.warning('잔고 새로고침은 30초마다 가능합니다.');
      }
      return;
    }

    setIsSyncing(true);
    setLastSyncTime(now);
    
    try {
      let currentBalance = 0;
      let currentPoints = 0;

      if (useApi) {
        // 🌐 외부 API를 통한 실시간 동기화
        console.log('🌐 외부 API 잔고 동기화 시작:', user.username);

        // OPCODE 정보 조회
        const { data: opcodeData, error: opcodeError } = await supabase
          .rpc('get_user_opcode_info', { p_user_id: user.id });

        if (opcodeError || !opcodeData?.length) {
          throw new Error('OPCODE 정보를 가져올 수 없습니다.');
        }

        const { opcode, secret_key } = opcodeData[0];

        // Invest API 호출
        const balanceResult = await investApi.getAllAccountBalances(opcode, secret_key);
        
        if (balanceResult.error) {
          throw new Error(`API 오류: ${balanceResult.error}`);
        }

        // API 응답에서 잔고 추출
        const apiBalance = investApi.extractBalanceFromResponse(balanceResult.data, user.username);
        
        if (apiBalance >= 0) {
          // 내부 DB 업데이트
          const { error: updateError } = await supabase
            .from('users')
            .update({ 
              balance: apiBalance,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

          if (updateError) {
            throw new Error('잔고 업데이트에 실패했습니다.');
          }

          currentBalance = apiBalance;
          
          // WebSocket으로 실시간 업데이트
          if (connected) {
            sendMessage({
              type: 'balance_sync',
              data: {
                user_id: user.id,
                username: user.username,
                balance: apiBalance,
                sync_type: 'api',
                timestamp: new Date().toISOString()
              }
            });
          }

          // 포인트는 별도 조회
          const { data: pointsData } = await supabase
            .from('users')
            .select('points')
            .eq('id', user.id)
            .single();
          
          currentPoints = parseFloat(pointsData?.points || '0');
        } else {
          throw new Error('유효하지 않은 잔고 정보를 받았습니다.');
        }
      } else {
        // 🔒 내부 DB에서만 조회
        console.log('💰 내부 DB 잔고 조회 시작:', user.username);

        const { data, error } = await supabase
          .from('users')
          .select('balance, points, updated_at')
          .eq('id', user.id)
          .single();

        if (error) {
          throw new Error('잔고 정보를 가져올 수 없습니다.');
        }

        currentBalance = parseFloat(data.balance) || 0;
        currentPoints = parseFloat(data.points) || 0;
      }

      console.log('💰 잔고 동기화 결과:', {
        username: user.username,
        balance: currentBalance,
        points: currentPoints,
        syncType: useApi ? 'API' : 'DB',
        isAutoSync
      });

      // 성공 메시지
      if (isAutoSync) {
        toast.success(`🎮 게임 복귀 감지 - 잔고 자동 업데이트: ₩${currentBalance.toLocaleString()}`);
      } else {
        const syncTypeText = useApi ? '(API 동기화)' : '(DB 조회)';
        toast.success(`잔고 새로고침 완료 ${syncTypeText}: ₩${currentBalance.toLocaleString()}`);
      }
      
      // 부모 컴포넌트에 잔고 변경 알림
      if (onBalanceUpdate) {
        onBalanceUpdate(currentBalance);
      }

    } catch (error) {
      console.error('❌ 잔고 동기화 오류:', error);
      if (!isAutoSync) {
        toast.error(error instanceof Error ? error.message : '잔고 동기화에 실패했습니다.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // 게임 실행 시 호출할 함수 (외부에서 사용)
  const markGameActivity = () => {
    const gameActivityKey = `game_activity_${user.id}`;
    localStorage.setItem(gameActivityKey, Date.now().toString());
    console.log('🎮 게임 활동 기록:', user.username);
  };

  // 컴포넌트에 게임 활동 마킹 함수 노출
  React.useImperativeHandle(React.useRef(), () => ({
    markGameActivity
  }));

  // 전역으로 함수 노출 (다른 컴포넌트에서 사용 가능)
  if (typeof window !== 'undefined') {
    (window as any).markUserGameActivity = markGameActivity;
  }

  if (!showButton) {
    // 버튼 없이 자동 동기화만 수행
    return null;
  }

  return (
    <div className="flex gap-2">
      <Button
        onClick={() => handleRefreshBalance(false, false)}
        disabled={isSyncing}
        variant="outline"
        size="sm"
        className="h-8 px-3"
      >
        <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
        {isSyncing ? '새로고침 중...' : '잔고 새로고침'}
      </Button>
      
      <Button
        onClick={() => handleRefreshBalance(false, true)}
        disabled={isSyncing}
        variant="default"
        size="sm"
        className="h-8 px-3 bg-blue-600 hover:bg-blue-700"
      >
        <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
        {isSyncing ? 'API 동기화 중...' : 'API 동기화'}
      </Button>
    </div>
  );
}