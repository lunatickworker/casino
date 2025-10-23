import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle, AdminDialogTrigger as DialogTrigger } from "./AdminDialog";
import { Label } from "../ui/label";
import { HelpCircle, MessageSquare, Send, Search, Clock, CheckCircle, AlertTriangle, User } from "lucide-react";
import { toast } from "sonner@2.0.3";
import { supabase } from "../../lib/supabase";

interface User {
  id: string;
  level: number;
  username?: string;
}

interface CustomerSupportProps {
  user: User;
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
  sender_username?: string;
  replies?: Message[];
}

export function CustomerSupport({ user }: CustomerSupportProps) {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [responseText, setResponseText] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Realtime 구독 - 새 문의 알림
  useEffect(() => {
    const channel = supabase
      .channel('customer-messages-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('🔔 새 문의 도착:', payload);
          
          // 새 문의인지 확인 (사용자가 보낸 것)
          if (payload.new.sender_type === 'user' && !payload.new.parent_id) {
            // sender 정보 조회
            const { data: senderData } = await supabase
              .from('users')
              .select('username')
              .eq('id', payload.new.sender_id)
              .single();

            const username = senderData?.username || '사용자';
            const subject = payload.new.subject.replace(/^\[.+?\]\s*/, '');

            toast.info(`새로운 문의가 도착했습니다`, {
              description: `${username}: ${subject}`,
              duration: 5000
            });
          }
          
          fetchMessages();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          console.log('🔔 메시지 업데이트:', payload);
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  // 메시지 목록 조회
  const fetchMessages = async () => {
    try {
      setLoading(true);

      // 현재 관리자가 receiver인 메시지 조회 (사용자가 보낸 문의)
      let query = supabase
        .from('messages')
        .select('*')
        .eq('receiver_type', 'partner')
        .eq('receiver_id', user.id)
        .eq('sender_type', 'user')
        .is('parent_id', null); // 최상위 메시지만

      // 상태 필터
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      // 검색
      if (searchTerm) {
        query = query.or(`subject.ilike.%${searchTerm}%,content.ilike.%${searchTerm}%`);
      }

      const { data: messagesData, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // 각 메시지의 답글 조회 및 sender 정보 가져오기
      const messagesWithDetails = await Promise.all(
        (messagesData || []).map(async (msg) => {
          // 답글 조회
          const { data: replies } = await supabase
            .from('messages')
            .select('*')
            .eq('parent_id', msg.id)
            .order('created_at', { ascending: true });

          // sender 정보 조회
          const { data: senderData } = await supabase
            .from('users')
            .select('username')
            .eq('id', msg.sender_id)
            .single();

          return {
            ...msg,
            sender_username: senderData?.username || '알 수 없음',
            replies: replies || []
          };
        })
      );

      setMessages(messagesWithDetails);
    } catch (error) {
      console.error('메시지 조회 오류:', error);
      toast.error('문의 내역을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 메시지 읽음 처리
  const markAsRead = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .update({
          status: 'read',
          read_at: new Date().toISOString()
        })
        .eq('id', messageId);

      if (error) throw error;
    } catch (error) {
      console.error('읽음 처리 오류:', error);
    }
  };

  // 답변 작성
  const handleReply = async () => {
    if (!selectedMessage || !responseText.trim()) {
      toast.error('답변 내용을 입력해주세요.');
      return;
    }

    try {
      // 답글 메시지 생성
      const { error: replyError } = await supabase
        .from('messages')
        .insert([{
          sender_type: 'partner',
          sender_id: user.id,
          receiver_type: 'user',
          receiver_id: selectedMessage.sender_id,
          subject: `Re: ${selectedMessage.subject}`,
          content: responseText.trim(),
          message_type: 'normal',
          status: 'unread',
          parent_id: selectedMessage.id
        }]);

      if (replyError) throw replyError;

      // 원본 메시지 상태 업데이트
      const { error: updateError } = await supabase
        .from('messages')
        .update({ status: 'replied' })
        .eq('id', selectedMessage.id);

      if (updateError) throw updateError;

      toast.success('답변이 등록되었습니다.');
      setIsDialogOpen(false);
      setResponseText('');
      setSelectedMessage(null);
      fetchMessages();
    } catch (error) {
      console.error('답변 등록 오류:', error);
      toast.error('답변 등록에 실패했습니다.');
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [statusFilter]);

  // 디바운스 검색
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm !== undefined) {
        fetchMessages();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const getStatusBadge = (status: string) => {
    const config = {
      'unread': { label: '미확인', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
      'read': { label: '확인', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      'replied': { label: '답변완료', color: 'bg-green-500/20 text-green-400 border-green-500/30' }
    }[status] || { label: status, color: '' };

    return (
      <Badge variant="outline" className={config.color}>
        {config.label}
      </Badge>
    );
  };

  const extractCategory = (subject: string) => {
    const match = subject.match(/^\[(.+?)\]/);
    return match ? match[1] : '일반';
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-slate-100">고객센터</h1>
          <p className="text-sm text-slate-400">
            사용자 문의를 확인하고 답변합니다.
          </p>
        </div>
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-slate-100 flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-400" />
              고객 문의 관리
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              총 {messages.length}건의 문의
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* 필터 */}
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
                <Input
                  placeholder="제목, 내용으로 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 input-premium"
                />
              </div>
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="unread">미확인</SelectItem>
                <SelectItem value="read">확인</SelectItem>
                <SelectItem value="replied">답변완료</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 메시지 목록 */}
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>문의 내역이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <Card key={message.id} className="bg-slate-800/50 border-slate-700 hover:bg-slate-800/70 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">
                            {extractCategory(message.subject)}
                          </Badge>
                          {getStatusBadge(message.status)}
                          <span className="text-xs text-slate-500">
                            {new Date(message.created_at).toLocaleString('ko-KR')}
                          </span>
                        </div>
                        
                        <h3 className="text-slate-100">
                          {message.subject.replace(/^\[.+?\]\s*/, '')}
                        </h3>
                        
                        <p className="text-sm text-slate-400 line-clamp-2">
                          {message.content}
                        </p>

                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <User className="h-3 w-3" />
                          <span>{message.sender_username}</span>
                          {message.replies && message.replies.length > 0 && (
                            <>
                              <span className="mx-1">•</span>
                              <MessageSquare className="h-3 w-3" />
                              <span>답변 {message.replies.length}개</span>
                            </>
                          )}
                        </div>
                      </div>

                      <Dialog 
                        open={isDialogOpen && selectedMessage?.id === message.id} 
                        onOpenChange={(open) => {
                          setIsDialogOpen(open);
                          if (open) {
                            setSelectedMessage(message);
                            setResponseText('');
                            if (message.status === 'unread') {
                              markAsRead(message.id);
                            }
                          } else {
                            setSelectedMessage(null);
                            setResponseText('');
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                          >
                            <MessageSquare className="h-4 w-4 mr-2" />
                            {message.replies && message.replies.length > 0 ? '답변보기' : '답변하기'}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>문의 상세 및 답변</DialogTitle>
                            <DialogDescription>
                              문의 내용을 확인하고 답변을 작성할 수 있습니다.
                            </DialogDescription>
                          </DialogHeader>
                          
                          <div className="space-y-4">
                            {/* 문의 정보 */}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <Label className="text-slate-400">작성자</Label>
                                <p className="text-slate-100">{message.sender_username}</p>
                              </div>
                              <div>
                                <Label className="text-slate-400">작성일시</Label>
                                <p className="text-slate-100">{new Date(message.created_at).toLocaleString('ko-KR')}</p>
                              </div>
                              <div>
                                <Label className="text-slate-400">분류</Label>
                                <p className="text-slate-100">{extractCategory(message.subject)}</p>
                              </div>
                              <div>
                                <Label className="text-slate-400">상태</Label>
                                <div className="mt-1">{getStatusBadge(message.status)}</div>
                              </div>
                            </div>

                            {/* 문의 내용 */}
                            <div>
                              <Label className="text-slate-400">제목</Label>
                              <p className="text-slate-100 mt-1">{message.subject}</p>
                            </div>

                            <div>
                              <Label className="text-slate-400">문의 내용</Label>
                              <div className="p-4 bg-slate-900/50 border border-slate-700 rounded-lg mt-2">
                                <p className="text-sm text-slate-200 whitespace-pre-wrap">{message.content}</p>
                              </div>
                            </div>

                            {/* 기존 답변들 */}
                            {message.replies && message.replies.length > 0 && (
                              <div>
                                <Label className="text-slate-400">답변 내역</Label>
                                <div className="space-y-2 mt-2">
                                  {message.replies.map((reply) => (
                                    <div key={reply.id} className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                      <p className="text-sm text-slate-200 whitespace-pre-wrap">{reply.content}</p>
                                      <div className="mt-2 text-xs text-slate-500">
                                        {new Date(reply.created_at).toLocaleString('ko-KR')}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 새 답변 작성 */}
                            <div>
                              <Label htmlFor="response" className="text-slate-400">
                                {message.replies && message.replies.length > 0 ? '추가 답변' : '답변 작성'}
                              </Label>
                              <Textarea
                                id="response"
                                placeholder="답변 내용을 입력하세요..."
                                value={responseText}
                                onChange={(e) => setResponseText(e.target.value)}
                                rows={5}
                                className="mt-2"
                              />
                            </div>

                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                onClick={() => setIsDialogOpen(false)}
                              >
                                취소
                              </Button>
                              <Button
                                onClick={handleReply}
                                disabled={!responseText.trim()}
                              >
                                <Send className="h-4 w-4 mr-2" />
                                답변 등록
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CustomerSupport;
