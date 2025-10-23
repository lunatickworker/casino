import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

interface WebSocketContextValue {
  connected: boolean;
  messages: WebSocketMessage[];
  sendMessage: (type: string, data: any) => boolean;
  connect: () => void;
  disconnect: () => void;
  lastMessage: WebSocketMessage | null;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}

// useWebSocket alias for backward compatibility
export const useWebSocket = useWebSocketContext;

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export const WebSocketProvider = React.memo(({ children }: WebSocketProviderProps) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const heartbeatTimeoutRef = useRef<number>();
  const connectionTimeoutRef = useRef<number>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 999; // 무제한 재연결 (한치의 누락도 없도록)
  const isConnecting = useRef(false);
  const isMounted = useRef(true);
  const messageHandlers = useRef<Set<(message: WebSocketMessage) => void>>(new Set());
  const heartbeatInterval = 30000; // 30초마다 Heartbeat (실시간 안정성 보장)
  
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  // Heartbeat 시작 (30초마다 ping 전송)
  const startHeartbeat = useCallback(() => {
    if (!isMounted.current) return;
    
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }
    
    heartbeatTimeoutRef.current = window.setTimeout(() => {
      if (!isMounted.current) return;
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          // ping 메시지 전송으로 연결 유지
          wsRef.current.send(JSON.stringify({
            type: 'ping',
            timestamp: new Date().toISOString()
          }));
          console.log('💓 Heartbeat ping 전송');
          startHeartbeat(); // 다음 Heartbeat 예약
        } catch (error) {
          console.error('❌ Heartbeat 전송 실패:', error);
          // 전송 실패 시 재연결 시도
          if (isMounted.current) {
            connect();
          }
        }
      } else {
        // 연결이 끊어진 경우 재연결 시도
        console.log('🔄 Heartbeat 체크: 연결 끊김 감지');
        if (isMounted.current) {
          connect();
        }
      }
    }, heartbeatInterval);
  }, []);

  // Heartbeat 중지
  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = undefined;
    }
  }, []);

  // WebSocket 연결 함수
  const connect = useCallback(() => {
    if (!isMounted.current) return;
    
    // 개발 환경에서는 WebSocket 연결을 비활성화
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.log('🔧 로컬 개발 환경 - WebSocket 오프라인 모드 (모든 기능 정상 작동)');
      setConnectionState('disconnected');
      setConnected(false);
      return;
    }
    
    // 이미 연결 중이거나 연결되어 있으면 리턴
    if (isConnecting.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // 최대 재연결 시도 초과 시 리턴
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.warn('WebSocket 최대 재연결 시도 초과');
      setConnectionState('disconnected');
      return;
    }

    isConnecting.current = true;
    setConnectionState('connecting');

    // 기존 타이머 정리
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    // 기존 연결 정리
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const wsUrl = 'wss://vi8282.com/ws';
      console.log('🔌 WebSocket 서버 연결 시도:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // 연결 타임아웃 설정 (5초로 단축)
      connectionTimeoutRef.current = window.setTimeout(() => {
        if (!isMounted.current) return;
        
        if (ws.readyState === WebSocket.CONNECTING) {
          console.log('⚠️ WebSocket 서버 응답 없음 - 오프라인 모드로 전환 (모든 기능 정상 작동)');
          ws.close();
          isConnecting.current = false;
          setConnectionState('disconnected');
          reconnectAttemptsRef.current = maxReconnectAttempts; // 재시도 중지
        }
      }, 5000);

      ws.onopen = () => {
        if (!isMounted.current) return;
        
        console.log('✅ WebSocket 서버에 성공적으로 연결되었습니다');
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
        }
        isConnecting.current = false;
        setConnected(true);
        setConnectionState('connected');
        reconnectAttemptsRef.current = 0;

        // Heartbeat 시작 (30초 간격)
        startHeartbeat();

        // 인증 메시지 전송
        try {
          const authMessage = {
            type: 'auth',
            data: {
              client_type: 'admin',
              timestamp: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
          };
          ws.send(JSON.stringify(authMessage));
        } catch (sendError) {
          console.error('⚠️ WebSocket 인증 메시지 전송 실패:', sendError);
        }
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data !== 'string' || !event.data.trim()) {
            return;
          }

          let message: WebSocketMessage;

          try {
            const parsed = JSON.parse(event.data);
            
            if (typeof parsed === 'object' && parsed !== null) {
              message = {
                type: parsed.type || 'unknown',
                data: parsed.data || parsed,
                timestamp: parsed.timestamp || new Date().toISOString(),
              };
              
              // 팝 메시지 처리 (하트비트 응답)
              if (parsed.type === 'pong') {
                // 하트비트 응답은 UI에 표시하지 않음
                return;
              }
            } else {
              throw new Error('Invalid JSON structure');
            }
          } catch (jsonError) {
            // 텍스트 메시지로 처리
            message = {
              type: 'text',
              data: event.data,
              timestamp: new Date().toISOString(),
            };
          }

          setMessages(prev => [...prev.slice(-49), message]);
          setLastMessage(message);

          // Heartbeat pong 응답 처리
          if (message.type === 'pong') {
            console.log('💓 Heartbeat pong 수신');
            return; // UI에 표시하지 않음
          }

          // 메시지 처리
          if (messageHandlers.current.size > 0) {
            messageHandlers.current.forEach((handler) => {
              try {
                handler(message);
              } catch (handlerError) {
                console.error('⚠️ WebSocket 메시지 핸들러 오류:', handlerError);
              }
            });
          }

          // 특정 메시지 타입 처리
          if (message.type === 'balance_update' && typeof window !== 'undefined') {
            // 전역 잔고 업데이트 함수 호출
            if ((window as any).updateUserBalance && message.data?.new_balance) {
              (window as any).updateUserBalance(message.data.new_balance);
            }
          }

          // 파트너 보유금 업데이트 메시지 처리
          if (message.type === 'partner_balance_updated') {
            console.log('💰 [WebSocket] 파트너 보유금 업데이트 감지:', message.data);
            // BalanceContext에서 lastMessage를 구독하여 처리
          }

          // 게임 모니터링 메시지 처리
          if (['game_session_start', 'game_session_end', 'balance_update'].includes(message.type)) {
            if (typeof window !== 'undefined' && (window as any).gameMonitorMessageHandler) {
              (window as any).gameMonitorMessageHandler(message);
            }
          }

          // 게임 강제 종료 메시지 처리 (사용자 페이지용)
          if (message.type === 'force_close_game') {
            if (typeof window !== 'undefined') {
              // 현재 열려있는 게임 창 강제 종료
              const gameWindows = (window as any).openGameWindows || [];
              gameWindows.forEach((gameWindow: Window) => {
                if (gameWindow && !gameWindow.closed) {
                  gameWindow.close();
                }
              });
              
              // 게임 탭 강제 종료
              if ((window as any).gameTab && !(window as any).gameTab.closed) {
                (window as any).gameTab.close();
              }

              // 사용자에게 알림
              if (message.data?.message) {
                // toast 알림 (sonner 사용)
                if (typeof window !== 'undefined' && (window as any).showToast) {
                  (window as any).showToast('error', message.data.message);
                }
              }
              
              console.log('🚫 게임 강제 종료:', message.data);
            }
          }
        } catch (error) {
          console.error('WebSocket 메시지 처리 오류:', error);
        }
      };

      ws.onclose = (event) => {
        if (!isMounted.current) return;
        
        // 개발 환경에서는 조용하게 처리
        if (reconnectAttemptsRef.current === 0) {
          console.log('WebSocket 서버에 연결할 수 없습니다 - 오프라인 모드로 전환됩니다.');
        }
        
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
        }
        stopHeartbeat();
        isConnecting.current = false;
        setConnected(false);
        setConnectionState('disconnected');

        // 비정상 종료 시 즉시 재연결 (무제한 재시도)
        if (event.code !== 1000 && event.code !== 1001 && isMounted.current) {
          // 지수 백오프: 최소 2초 ~ 최대 30초
          const baseDelay = 2000;
          const maxDelay = 30000;
          const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttemptsRef.current), maxDelay);
          
          console.log(`🔄 WebSocket 재연결 시도 (${reconnectAttemptsRef.current + 1}회) - ${Math.round(delay/1000)}초 후`);
          
          reconnectTimeoutRef.current = window.setTimeout(() => {
            if (!isMounted.current) return;
            
            reconnectAttemptsRef.current += 1;
            connect();
          }, delay);
        } else if (event.code === 1000 || event.code === 1001) {
          // 정상 종료
          console.log('✅ WebSocket 정상 종료');
          setConnectionState('disconnected');
        }
      };

      ws.onerror = (error) => {
        if (!isMounted.current) return;
        
        console.log('⚠️ WebSocket 에러 발생 - Realtime으로 백업 작동 중');
        
        isConnecting.current = false;
        setConnectionState('error');
        
        // 에러 발생해도 재연결 시도 (onclose에서 처리됨)
      };

    } catch (error) {
      console.error('❌ WebSocket 연결 실패:', error);
      isConnecting.current = false;
      setConnectionState('error');
      
      // 연결 실패 시에도 재연결 시도
      if (isMounted.current) {
        const delay = 5000;
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (!isMounted.current) return;
          reconnectAttemptsRef.current += 1;
          connect();
        }, delay);
      }
    }
  }, [startHeartbeat]);

  // WebSocket 연결 해제 함수
  const disconnect = useCallback(() => {
    stopHeartbeat();
    
    // 모든 타이머 정리
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = undefined;
    }
    
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = undefined;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    
    isConnecting.current = false;
    setConnected(false);
    setConnectionState('disconnected');
    reconnectAttemptsRef.current = 0;
  }, [stopHeartbeat]);

  // 메시지 전송 함수
  const sendMessage = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = {
        type,
        data,
        timestamp: new Date().toISOString(),
      };
      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('메시지 전송 실패:', error);
        return false;
      }
    }
    return false;
  }, []);

  // 컴포넌트 마운트 시 연결
  useEffect(() => {
    isMounted.current = true;
    connect();
    
    // 컴포넌트 언마운트 시 연결 해제
    return () => {
      isMounted.current = false;
      
      // 모든 타이머 정리
      stopHeartbeat();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      
      // WebSocket 연결 해제
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount');
        wsRef.current = null;
      }
    };
  }, [connect, stopHeartbeat]);

  // 페이지 가시성 변경 및 네트워크 상태 처리
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isMounted.current) return;
      
      if (document.visibilityState === 'visible' && !connected && !isConnecting.current) {
        console.log('📱 페이지 활성화 - WebSocket 재연결 시도');
        reconnectAttemptsRef.current = 0; // 재연결 카운터 리셋
        connect();
      }
    };

    const handleOnline = () => {
      if (!isMounted.current) return;
      
      if (!connected && !isConnecting.current) {
        console.log('🌐 네트워크 복구 - WebSocket 재연결 시도');
        reconnectAttemptsRef.current = 0; // 재연결 카운터 리셋
        connect();
      }
    };

    const handleOffline = () => {
      if (!isMounted.current) return;
      
      console.log('📡 네트워크 연결 끊김 - 오프라인 모드');
      setConnectionState('disconnected');
      if (wsRef.current) {
        wsRef.current.close();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connected, connect]);

  const value: WebSocketContextValue = React.useMemo(() => ({
    connected,
    messages,
    sendMessage,
    connect,
    disconnect,
    lastMessage,
    connectionState,
  }), [connected, messages, sendMessage, connect, disconnect, lastMessage, connectionState]);

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
});