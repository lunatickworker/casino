import { useState, useEffect } from "react";
import { X, MessageSquare } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";

interface UserMessagePopupProps {
  userId: string;
}

interface Message {
  id: string;
  sender_type: 'user' | 'partner';
  sender_id: string;
  receiver_type: 'user' | 'partner';
  receiver_id: string;
  subject: string;
  content: string;
  message_type: 'normal' | 'system' | 'urgent';
  status: 'unread' | 'read' | 'replied';
  created_at: string;
  read_at?: string;
  parent_id?: string;
}

export function UserMessagePopup({ userId }: UserMessagePopupProps) {
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // 새 메시지 확인 및 표시
  const checkNewMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('receiver_type', 'user')
        .eq('receiver_id', userId)
        .eq('sender_type', 'partner')
        .eq('status', 'unread')
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('메시지 조회 오류:', error);
        return;
      }

      if (data) {
        setCurrentMessage(data);
        setIsVisible(true);
      }
    } catch (error) {
      console.error('메시지 확인 오류:', error);
    }
  };

  // 실시간 메시지 구독
  useEffect(() => {
    console.log('🔔 사용자 메시지 팝업 실시간 구독 시작:', userId);

    // 초기 메시지 확인
    checkNewMessages();

    // Realtime 구독
    const messagesChannel = supabase
      .channel('user_message_popup')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${userId}`
        },
        (payload) => {
          console.log('📨 새 메시지 도착:', payload);
          const newMsg = payload.new as Message;
          
          // 파트너가 사용자에게 보낸 메시지만 팝업 표시
          if (newMsg.sender_type === 'partner' && 
              newMsg.receiver_type === 'user' && 
              !newMsg.parent_id) {
            setCurrentMessage(newMsg);
            setIsVisible(true);
          }
        }
      )
      .subscribe();

    return () => {
      console.log('🔕 사용자 메시지 팝업 구독 해제');
      supabase.removeChannel(messagesChannel);
    };
  }, [userId]);

  // 메시지 읽음 처리 및 닫기
  const handleConfirm = async () => {
    if (!currentMessage) return;

    try {
      // 읽음 처리
      const { error } = await supabase
        .from('messages')
        .update({
          status: 'read',
          read_at: new Date().toISOString()
        })
        .eq('id', currentMessage.id);

      if (error) throw error;

      toast.success('메시지를 확인했습니다.');
      setIsVisible(false);
      setCurrentMessage(null);

      // 다음 메시지 확인
      setTimeout(() => {
        checkNewMessages();
      }, 500);
    } catch (error) {
      console.error('메시지 읽음 처리 오류:', error);
      toast.error('메시지 처리 중 오류가 발생했습니다.');
    }
  };

  if (!isVisible || !currentMessage) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
      <Card className="w-full max-w-lg mx-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-yellow-500/50 shadow-2xl shadow-yellow-500/20">
        <CardHeader className="border-b border-yellow-500/30 bg-gradient-to-r from-yellow-600/20 to-red-600/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-yellow-500 to-amber-600 shadow-lg">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-xl text-white font-bold">
                  📢 관리자 메시지
                </CardTitle>
                <p className="text-xs text-yellow-300 mt-1">
                  {new Date(currentMessage.created_at).toLocaleString('ko-KR')}
                </p>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6 pb-6">
          {/* 제목 */}
          <div className="mb-4">
            <div className="text-sm text-yellow-400 font-medium mb-2">제목</div>
            <div className="text-lg text-white font-semibold bg-slate-800/50 p-3 rounded-lg border border-slate-700">
              {currentMessage.subject}
            </div>
          </div>

          {/* 내용 */}
          <div className="mb-6">
            <div className="text-sm text-yellow-400 font-medium mb-2">내용</div>
            <div className="text-base text-slate-200 bg-slate-800/50 p-4 rounded-lg border border-slate-700 min-h-[120px] whitespace-pre-wrap">
              {currentMessage.content}
            </div>
          </div>

          {/* 확인 버튼 */}
          <div className="flex justify-end">
            <Button
              onClick={handleConfirm}
              className="bg-gradient-to-r from-yellow-600 to-red-600 hover:from-yellow-700 hover:to-red-700 text-white font-bold px-8 py-6 text-lg shadow-lg shadow-yellow-500/30 border border-yellow-400/50"
            >
              확인
            </Button>
          </div>

          {/* 안내 메시지 */}
          <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-xs text-blue-300 text-center">
              💡 메시지를 확인하시려면 '확인' 버튼을 눌러주세요.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
