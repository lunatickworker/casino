import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { 
  Search, 
  Bell, 
  Eye,
  Calendar,
  Pin,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { supabase } from "../../lib/supabase";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";

interface UserNoticeProps {
  user: any;
  onRouteChange: (route: string) => void;
}

interface Notice {
  id: string;
  title: string;
  content: string;
  is_popup: boolean;
  is_pinned: boolean;
  view_count: number;
  created_at: string;
  partner_id: string;
  partners?: {
    nickname: string;
  };
  is_read?: boolean;
}

interface PopupNotice {
  id: string;
  title: string;
  content: string;
  created_at: string;
  hide_today?: boolean;
}

export function UserNotice({ user, onRouteChange }: UserNoticeProps) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [filteredNotices, setFilteredNotices] = useState<Notice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null);
  const [showNoticeDialog, setShowNoticeDialog] = useState(false);
  const [expandedNotices, setExpandedNotices] = useState<string[]>([]);
  const [popupNotices, setPopupNotices] = useState<PopupNotice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;

  // 공지사항 목록 조회
  const fetchNotices = async (page = 1) => {
    try {
      setIsLoading(true);
      
      const offset = (page - 1) * itemsPerPage;
      
      const { data, error, count } = await supabase
        .from('announcements')
        .select(`
          *,
          partners (
            nickname
          )
        `, { count: 'exact' })
        .eq('status', 'active')
        .in('target_type', ['users', 'all'])
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + itemsPerPage - 1);

      if (error) throw error;

      // 읽음 상태 확인
      const noticeIds = data?.map(notice => notice.id) || [];
      const { data: readData } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', user.id)
        .in('announcement_id', noticeIds);

      const readNoticeIds = readData?.map(read => read.announcement_id) || [];

      const noticesWithReadStatus = data?.map(notice => ({
        ...notice,
        is_read: readNoticeIds.includes(notice.id)
      })) || [];

      setNotices(noticesWithReadStatus);
      setFilteredNotices(noticesWithReadStatus);
      setTotalPages(Math.ceil((count || 0) / itemsPerPage));
      setCurrentPage(page);
    } catch (error) {
      console.error('공지사항 조회 오류:', error);
      toast.error('공지사항을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 팝업 공지사항 조회
  const fetchPopupNotices = async () => {
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, content, created_at')
        .eq('status', 'active')
        .eq('is_popup', true)
        .in('target_type', ['users', 'all'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // 오늘 숨기기 설정 확인
      const hiddenToday = JSON.parse(localStorage.getItem('hidden_popups_today') || '[]');
      const today = new Date().toDateString();
      const hiddenTodayIds = hiddenToday
        .filter((item: any) => item.date === today)
        .map((item: any) => item.id);

      const visiblePopups = (data || [])
        .filter(notice => !hiddenTodayIds.includes(notice.id))
        .map(notice => ({
          ...notice,
          hide_today: false
        }));

      setPopupNotices(visiblePopups);
    } catch (error) {
      console.error('팝업 공지사항 조회 오류:', error);
    }
  };

  // 공지사항 검색
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setFilteredNotices(notices);
      return;
    }

    const filtered = notices.filter(notice =>
      notice.title.toLowerCase().includes(query.toLowerCase()) ||
      notice.content.toLowerCase().includes(query.toLowerCase())
    );
    setFilteredNotices(filtered);
  };

  // 공지사항 상세보기
  const handleNoticeClick = async (notice: Notice) => {
    setSelectedNotice(notice);
    setShowNoticeDialog(true);

    // 읽음 처리
    if (!notice.is_read) {
      try {
        // 읽음 기록 추가
        await supabase
          .from('announcement_reads')
          .insert([{
            announcement_id: notice.id,
            user_id: user.id
          }]);

        // 조회수 증가
        await supabase
          .from('announcements')
          .update({ view_count: notice.view_count + 1 })
          .eq('id', notice.id);

        // 로컬 상태 업데이트
        setNotices(prev => prev.map(n => 
          n.id === notice.id 
            ? { ...n, is_read: true, view_count: n.view_count + 1 }
            : n
        ));
        setFilteredNotices(prev => prev.map(n => 
          n.id === notice.id 
            ? { ...n, is_read: true, view_count: n.view_count + 1 }
            : n
        ));
      } catch (error) {
        console.error('읽음 처리 오류:', error);
      }
    }
  };

  // 공지사항 확장/축소
  const toggleNoticeExpansion = (noticeId: string) => {
    setExpandedNotices(prev => 
      prev.includes(noticeId)
        ? prev.filter(id => id !== noticeId)
        : [...prev, noticeId]
    );
  };

  // 팝업 닫기
  const closePopup = (noticeId: string, hideToday = false) => {
    setPopupNotices(prev => prev.filter(notice => notice.id !== noticeId));
    
    if (hideToday) {
      const hiddenToday = JSON.parse(localStorage.getItem('hidden_popups_today') || '[]');
      const today = new Date().toDateString();
      const newHidden = [...hiddenToday, { id: noticeId, date: today }];
      localStorage.setItem('hidden_popups_today', JSON.stringify(newHidden));
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  const formatRelativeTime = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return '방금 전';
    if (diffInHours < 24) return `${diffInHours}시간 전`;
    return `${Math.floor(diffInHours / 24)}일 전`;
  };

  const truncateContent = (content: string, maxLength = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  useEffect(() => {
    fetchNotices();
    fetchPopupNotices();

    // 실시간 공지사항 업데이트 구독
    const subscription = supabase
      .channel('announcement_updates')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'announcements'
      }, () => {
        fetchNotices(currentPage);
        fetchPopupNotices();
      })
      .subscribe();

    return () => subscription.unsubscribe();
  }, [user.id]);

  return (
    <div className="space-y-6">
      {/* 팝업 공지사항 */}
      {popupNotices.map((popup) => (
        <div key={popup.id} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <Card className="w-full max-w-md lg:max-w-lg bg-slate-800 border-slate-700 relative">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-white pr-8">{popup.title}</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => closePopup(popup.id)}
                  className="absolute top-2 right-2 w-8 h-8 p-0 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div 
                className="text-slate-300 text-sm max-h-60 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: popup.content }}
              />
              <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                <span className="text-xs text-slate-500">
                  {formatDateTime(popup.created_at)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => closePopup(popup.id, true)}
                  >
                    오늘 하루 보지 않기
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => closePopup(popup.id)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    확인
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}

      {/* 헤더 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">공지사항</h1>
          <p className="text-slate-400">중요한 안내사항을 확인하세요</p>
        </div>
      </div>

      {/* 검색 */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="공지사항 제목이나 내용으로 검색..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10 bg-slate-700/50 border-slate-600 text-white"
            />
          </div>
        </CardContent>
      </Card>

      {/* 공지사항 목록 */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center text-white">
            <Bell className="w-5 h-5 mr-2 text-blue-400" />
            공지사항 ({filteredNotices.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : filteredNotices.length > 0 ? (
            <div className="space-y-4">
              {filteredNotices.map((notice) => {
                const isExpanded = expandedNotices.includes(notice.id);
                return (
                  <div 
                    key={notice.id} 
                    className="p-4 bg-slate-700/30 rounded-lg hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* 읽음 상태 표시 */}
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                        notice.is_read ? 'bg-slate-500' : 'bg-blue-400'
                      }`} />
                      
                      <div className="flex-1 min-w-0">
                        {/* 헤더 */}
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {notice.is_pinned && (
                                <Badge className="bg-red-500 text-white text-xs">
                                  <Pin className="w-3 h-3 mr-1" />
                                  고정
                                </Badge>
                              )}
                              {notice.is_popup && (
                                <Badge className="bg-purple-500 text-white text-xs">
                                  팝업
                                </Badge>
                              )}
                            </div>
                            <h3 
                              className={`font-medium cursor-pointer hover:text-blue-400 transition-colors ${
                                notice.is_read ? 'text-slate-300' : 'text-white'
                              }`}
                              onClick={() => handleNoticeClick(notice)}
                            >
                              {notice.title}
                            </h3>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleNoticeExpansion(notice.id)}
                            className="flex-shrink-0 w-8 h-8 p-0"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </Button>
                        </div>

                        {/* 메타 정보 */}
                        <div className="flex items-center gap-4 text-xs text-slate-500 mb-2">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatRelativeTime(notice.created_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {notice.view_count.toLocaleString()}
                          </span>
                          {notice.partners?.nickname && (
                            <span>관리자: {notice.partners.nickname}</span>
                          )}
                        </div>

                        {/* 내용 미리보기 */}
                        <Collapsible open={isExpanded} onOpenChange={() => toggleNoticeExpansion(notice.id)}>
                          <CollapsibleContent>
                            <div 
                              className="text-slate-300 text-sm mt-3 p-3 bg-slate-600/30 rounded border-l-4 border-blue-500"
                              dangerouslySetInnerHTML={{ __html: notice.content }}
                            />
                          </CollapsibleContent>
                        </Collapsible>

                        {!isExpanded && (
                          <p className="text-slate-400 text-sm">
                            {truncateContent(notice.content.replace(/<[^>]*>/g, ''))}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="flex justify-center gap-2 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchNotices(currentPage - 1)}
                    disabled={currentPage <= 1}
                  >
                    이전
                  </Button>
                  <span className="flex items-center px-3 text-slate-300">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchNotices(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                  >
                    다음
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <Bell className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-white mb-2">
                {searchQuery ? '검색 결과가 없습니다' : '공지사항이 없습니다'}
              </h3>
              <p className="text-slate-400 mb-4">
                {searchQuery 
                  ? '다른 검색어로 시도해보세요.' 
                  : '새로운 공지사항이 등록되면 알려드리겠습니다.'
                }
              </p>
              {searchQuery && (
                <Button
                  variant="outline"
                  onClick={() => handleSearch('')}
                >
                  전체 공지사항 보기
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 공지사항 상세 다이얼로그 */}
      <Dialog open={showNoticeDialog} onOpenChange={setShowNoticeDialog}>
        <DialogContent className="max-w-2xl bg-slate-800 border-slate-700 text-white max-h-[80vh] overflow-y-auto">
          {selectedNotice && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{selectedNotice.title}</DialogTitle>
                <DialogDescription className="text-slate-400">
                  공지사항 내용을 확인하실 수 있습니다.
                </DialogDescription>
                <div className="flex items-center gap-4 text-sm text-slate-400 pt-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {formatDateTime(selectedNotice.created_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    조회 {selectedNotice.view_count.toLocaleString()}
                  </span>
                  {selectedNotice.partners?.nickname && (
                    <span>작성자: {selectedNotice.partners.nickname}</span>
                  )}
                </div>
              </DialogHeader>
              <div className="pt-4">
                <div 
                  className="prose prose-invert max-w-none text-slate-300"
                  dangerouslySetInnerHTML={{ __html: selectedNotice.content }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}