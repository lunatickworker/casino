// WebSocket 컨텍스트를 사용하는 간단한 훅
import { useWebSocketContext } from '../contexts/WebSocketContext';

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

export function useWebSocket() {
  const context = useWebSocketContext();
  
  return {
    connected: context.connected,
    messages: context.messages,
    sendMessage: context.sendMessage,
    connect: context.connect,
    disconnect: context.disconnect,
    lastMessage: context.lastMessage,
    connectionState: context.connectionState,
  };
}