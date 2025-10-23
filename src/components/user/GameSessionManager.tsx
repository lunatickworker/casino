import { useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { investApi } from '../../lib/investApi';
import { useWebSocketContext } from '../../contexts/WebSocketContext';
import { toast } from 'sonner@2.0.3';

interface GameSessionManagerProps {
  user: any;
  onBalanceUpdate?: (newBalance: number) => void;
}

interface GameSession {
  id: string;
  user_id: string;
  game_id: number;
  opcode: string;
  launch_url: string;
  session_token: string;
  balance_before: number;
  launched_at: string;
  status: 'active' | 'ended' | 'error';
}

export function GameSessionManager({ user, onBalanceUpdate }: GameSessionManagerProps) {
  const { connected, sendMessage } = useWebSocketContext();
  const currentSessionRef = useRef<GameSession | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);

  // 게임 런치 시 세션 생성
  const createGameSession = async (gameId: number, gameUrl: string, opcode: string, balance: number): Promise<string | null> => {
    try {
      const sessionToken = crypto.randomUUID();
      
      const { data, error } = await supabase
        .rpc('create_game_launch_session', {
          p_user_id: user.id,
          p_game_id: gameId,
          p_opcode: opcode,
          p_launch_url: gameUrl,
          p_session_token: sessionToken,
          p_balance_before: balance
        });

      if (error) {
        console.error('❌ 게임 세션 생성 실패:', error);
        return null;
      }

      const session: GameSession = {
        id: data[0].session_id,
        user_id: user.id,
        game_id: gameId,
        opcode: opcode,
        launch_url: gameUrl,
        session_token: sessionToken,
        balance_before: balance,
        launched_at: new Date().toISOString(),
        status: 'active'
      };

      currentSessionRef.current = session;

      // WebSocket으로 관리자에게 게임 시작 알림
      if (connected) {
        sendMessage({
          type: 'game_session_start',
          data: {
            session_id: session.id,
            user_id: user.id,
            username: user.username,
            game_id: gameId,
            balance_before: balance,
            timestamp: new Date().toISOString()
          }
        });
      }

      console.log('🎮 게임 세션 생성 완료:', session.id);
      return session.id;

    } catch (error) {
      console.error('❌ 게임 세션 생성 오류:', error);
      return null;
    }
  };

  // 게임 세션 종료
  const endGameSession = async (sessionId: string, balanceAfter?: number): Promise<boolean> => {
    try {
      const { error } = await supabase
        .rpc('end_game_launch_session', {
          p_session_id: sessionId,
          p_balance_after: balanceAfter || null
        });

      if (error) {
        console.error('❌ 게임 세션 종료 실패:', error);
        return false;
      }

      // WebSocket으로 관리자에게 게임 종료 알림
      if (connected && currentSessionRef.current) {
        sendMessage({
          type: 'game_session_end',
          data: {
            session_id: sessionId,
            user_id: user.id,
            username: user.username,
            balance_after: balanceAfter,
            timestamp: new Date().toISOString()
          }
        });
      }

      currentSessionRef.current = null;
      console.log('🎮 게임 세션 종료 완료:', sessionId);
      return true;

    } catch (error) {
      console.error('❌ 게임 세션 종료 오류:', error);
      return false;
    }
  };

  // 게임 종료 후 잔고 동기화
  const syncBalanceAfterGame = async (sessionId: string, forceSync = false) => {
    try {
      console.log('💰 게임 종료 후 잔고 동기화 시작:', { sessionId, forceSync });

      // 30초 지연 (API 권장사항)
      if (!forceSync) {
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      // 사용자 OPCODE 조회
      const { data: opcodeData, error: opcodeError } = await supabase
        .rpc('get_user_opcode_info', { p_user_id: user.id });

      if (opcodeError || !opcodeData?.length) {
        console.error('❌ OPCODE 정보 조회 실패:', opcodeError);
        return;
      }

      const { opcode, secret_key, token } = opcodeData[0];

      // Invest API를 통한 전체 잔고 조회
      const balanceResult = await investApi.getAllAccountBalances(opcode, secret_key);
      
      if (balanceResult.error) {
        console.error('❌ API 잔고 조회 실패:', balanceResult.error);
        return;
      }

      // API 응답에서 사용자 잔고 추출
      const newBalance = investApi.extractBalanceFromResponse(balanceResult.data, user.username);

      if (newBalance >= 0) {
        // 내부 DB 잔고 업데이트
        const { error: updateError } = await supabase
          .from('users')
          .update({ 
            balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);

        if (updateError) {
          console.error('❌ 내부 잔고 업데이트 실패:', updateError);
          return;
        }

        // 세션 종료 처리
        await endGameSession(sessionId, newBalance);

        // 잔고 변경 알림
        if (onBalanceUpdate) {
          onBalanceUpdate(newBalance);
        }

        // WebSocket으로 실시간 업데이트
        if (connected) {
          sendMessage({
            type: 'balance_update',
            data: {
              user_id: user.id,
              username: user.username,
              old_balance: currentSessionRef.current?.balance_before || 0,
              new_balance: newBalance,
              session_id: sessionId,
              timestamp: new Date().toISOString()
            }
          });
        }

        toast.success(`🎮 게임 종료 - 현재 잔고: ₩${newBalance.toLocaleString()}`);
        console.log('✅ 게임 종료 후 잔고 동기화 완료:', { newBalance });

      } else {
        console.warn('⚠️ 유효하지 않은 잔고 정보:', newBalance);
      }

    } catch (error) {
      console.error('❌ 게임 종료 후 잔고 동기화 오류:', error);
    }
  };

  // 페이지 가시성 변경 감지 (게임 복귀 감지)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentSessionRef.current) {
        // 게임에서 복귀한 경우
        const session = currentSessionRef.current;
        const timeSinceStart = Date.now() - new Date(session.launched_at).getTime();
        
        // 30초 이상 지났고 세션이 활성화된 상태인 경우
        if (timeSinceStart > 30000 && session.status === 'active') {
          console.log('🎮 게임 복귀 감지 - 잔고 동기화 예약:', session.id);
          
          // 기존 타이머 제거
          if (syncTimeoutRef.current) {
            clearTimeout(syncTimeoutRef.current);
          }
          
          // 3초 후 동기화 실행 (사용자 경험 개선)
          syncTimeoutRef.current = window.setTimeout(() => {
            syncBalanceAfterGame(session.id);
          }, 3000);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user.id]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // 전역 함수로 노출 (다른 컴포넌트에서 사용)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).createGameSession = createGameSession;
      (window as any).endGameSession = endGameSession;
      (window as any).syncBalanceAfterGame = (sessionId: string) => syncBalanceAfterGame(sessionId, true);
    }
  }, [user]);

  // UI 없는 로직 컴포넌트
  return null;
}