import React, { useState } from 'react';
import { Bell, BellRing, Check, Clock, Eye, MessageSquare, Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../../lib/utils';
import { useMessageQueue } from './MessageQueueProvider';

interface NotificationCenterProps {
  className?: string;
}

export function NotificationCenter({ className }: NotificationCenterProps) {
  const { 
    notifications, 
    unreadCount, 
    markAsRead, 
    clearAllNotifications,
    isProcessing 
  } = useMessageQueue();
  
  const [isOpen, setIsOpen] = useState(false);

  // 알림 타입별 아이콘
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'deposit_request':
      case 'withdrawal_request':
        return <BellRing className="h-4 w-4 text-orange-400" />;
      case 'transaction_approved':
        return <Check className="h-4 w-4 text-green-400" />;
      case 'transaction_rejected':
        return <X className="h-4 w-4 text-red-400" />;
      case 'bet_result':
        return <MessageSquare className="h-4 w-4 text-blue-400" />;
      default:
        return <Bell className="h-4 w-4 text-slate-400" />;
    }
  };

  // 알림 타입별 색상
  const getNotificationColor = (type: string, isRead: boolean) => {
    if (isRead) return 'border-slate-600 bg-slate-800/30';
    
    switch (type) {
      case 'deposit_request':
      case 'withdrawal_request':
        return 'border-orange-500 bg-orange-500/10';
      case 'transaction_approved':
        return 'border-green-500 bg-green-500/10';
      case 'transaction_rejected':
        return 'border-red-500 bg-red-500/10';
      case 'bet_result':
        return 'border-blue-500 bg-blue-500/10';
      default:
        return 'border-slate-500 bg-slate-500/10';
    }
  };

  // 시간 포맷팅
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return date.toLocaleDateString('ko-KR');
  };

  // 알림 클릭 처리
  const handleNotificationClick = async (notification: any) => {
    if (notification.status !== 'read') {
      await markAsRead(notification.id);
    }
    
    // 액션 URL이 있으면 이동
    if (notification.action_url) {
      // 실제 구현에서는 라우터를 사용하여 페이지 이동
      console.log('Navigate to:', notification.action_url);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "relative",
            className
          )}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent 
        className="w-96 p-0 bg-slate-800 border-slate-700" 
        align="end"
        side="bottom"
      >
        <Card className="border-0 bg-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg text-white">알림</CardTitle>
              <div className="flex items-center gap-2">
                {isProcessing && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                )}
                <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                  {unreadCount}개 안읽음
                </Badge>
              </div>
            </div>
            {unreadCount > 0 && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllNotifications}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  <Check className="h-3 w-3 mr-1" />
                  모두 읽음
                </Button>
              </div>
            )}
          </CardHeader>
          
          <Separator className="bg-slate-700" />
          
          <CardContent className="p-0">
            <ScrollArea className="h-96">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Bell className="h-8 w-8 mb-2" />
                  <p className="text-sm">알림이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  {notifications.map((notification) => {
                    const isRead = notification.status === 'read';
                    
                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          "p-3 rounded-lg border cursor-pointer transition-all hover:bg-slate-700/50",
                          getNotificationColor(notification.notification_type, isRead)
                        )}
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            {getNotificationIcon(notification.notification_type)}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className={cn(
                                "text-sm font-medium truncate",
                                isRead ? "text-slate-300" : "text-white"
                              )}>
                                {notification.title}
                              </h4>
                              {!isRead && (
                                <div className="w-2 h-2 bg-blue-400 rounded-full flex-shrink-0" />
                              )}
                            </div>
                            
                            <p className={cn(
                              "text-xs line-clamp-2",
                              isRead ? "text-slate-400" : "text-slate-300"
                            )}>
                              {notification.content}
                            </p>
                            
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-slate-500">
                                {formatTime(notification.created_at)}
                              </span>
                              
                              {notification.action_url && (
                                <span className="text-xs text-blue-400">
                                  클릭하여 확인
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </PopoverContent>
    </Popover>
  );
}

// 관리자용 메시지 큐 모니터
export function MessageQueueMonitor() {
  const { 
    pendingMessages, 
    processMessages, 
    isProcessing, 
    lastProcessed 
  } = useMessageQueue();

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              메시지 큐 상태
            </CardTitle>
            <CardDescription className="text-slate-400">
              대기 중인 메시지 처리 현황
            </CardDescription>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge 
              variant={pendingMessages.length > 0 ? "destructive" : "secondary"}
              className="bg-slate-700"
            >
              대기: {pendingMessages.length}개
            </Badge>
            
            <Button
              size="sm"
              onClick={processMessages}
              disabled={isProcessing || pendingMessages.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                  처리 중
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 mr-2" />
                  수동 처리
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        {lastProcessed && (
          <div className="text-sm text-slate-400 mb-4">
            마지막 처리: {lastProcessed.toLocaleString('ko-KR')}
          </div>
        )}
        
        {pendingMessages.length > 0 ? (
          <div className="space-y-2">
            {pendingMessages.slice(0, 5).map((message) => (
              <div
                key={message.id}
                className="flex items-center justify-between p-2 bg-slate-700/30 rounded"
              >
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-400" />
                  <span className="text-sm text-white">
                    {message.subject}
                  </span>
                </div>
                
                <Badge variant="outline" className="text-xs">
                  우선순위 {message.priority}
                </Badge>
              </div>
            ))}
            
            {pendingMessages.length > 5 && (
              <p className="text-xs text-slate-400 text-center">
                +{pendingMessages.length - 5}개 더
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-slate-400">
            <Check className="h-8 w-8 mx-auto mb-2 text-green-400" />
            <p className="text-sm">모든 메시지가 처리되었습니다</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}