import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle, AdminDialogTrigger as DialogTrigger } from "./AdminDialog";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Bell, Plus, Edit, Trash2, Eye, Search, Calendar, Users, Upload, X, FileText, Info } from "lucide-react";
import { toast } from "sonner@2.0.3";
import { supabase } from "../../lib/supabase";
import { useWebSocketContext } from "../../contexts/WebSocketContext";

interface User {
  id: string;
  level: number;
  username?: string;
}

interface AnnouncementsProps {
  user: User;
}

interface Announcement {
  id: string;
  partner_id: string;
  partner_username: string;
  title: string;
  content: string;
  image_url?: string;
  is_popup: boolean;
  target_audience: string;
  target_level?: number;
  status: string;
  display_order: number;
  view_count: number;
  start_date: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
}

export function Announcements({ user }: AnnouncementsProps) {
  // 접근 권한 확인 (총판 등급 이상, level 5 이상)
  if (user.level > 5) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <Bell className="h-12 w-12 text-yellow-500 mx-auto" />
          <p className="text-muted-foreground">공지사항 관리는 총판 이상만 접근 가능합니다.</p>
        </div>
      </div>
    );
  }

  const [loading, setLoading] = useState(true); // 초기 로드만 true
  const [uploading, setUploading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [targetFilter, setTargetFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  
  // 폼 상태
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    image_url: '',
    is_popup: false,
    target_audience: 'users',
    target_level: '',
    status: 'active',
    display_order: 0,
    start_date: '',
    end_date: ''
  });
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const { sendMessage } = useWebSocketContext();

  // Supabase Realtime subscription (이벤트 발생시 자동 업데이트)
  useEffect(() => {
    const channel = supabase
      .channel('announcements-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements'
        },
        (payload) => {
          console.log('🔔 공지사항 테이블 변경 감지:', payload);
          fetchAnnouncements();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 이미지 업로드 함수
  const uploadImage = async (file: File) => {
    if (!file) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}_${Date.now()}.${fileExt}`;
    const filePath = `announcements/${fileName}`;

    try {
      setUploading(true);

      const { data, error } = await supabase.storage
        .from('public')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('public')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('이미지 업로드 오류:', error);
      toast.error('이미지 업로드에 실패했습니다.');
      return null;
    } finally {
      setUploading(false);
    }
  };

  // 이미지 파일 변경 핸들러
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 크기 체크 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('이미지 크기는 5MB 이하여야 합니다.');
      return;
    }

    // 이미지 파일 타입 체크
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드 가능합니다.');
      return;
    }

    const imageUrl = await uploadImage(file);
    if (imageUrl) {
      setUploadedImage(imageUrl);
      setFormData(prev => ({ ...prev, image_url: imageUrl }));
      toast.success('이미지가 업로드되었습니다.');
    }
  };

  // 이미지 제거 핸들러
  const removeImage = () => {
    setUploadedImage(null);
    setFormData(prev => ({ ...prev, image_url: '' }));
  };

  // 공지사항 목록 조회 (partner_id 기반)
  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('announcements')
        .select(`
          *,
          partners!announcements_partner_id_fkey(username)
        `);

      // 시스템관리자가 아니면 본인이 작성한 공지만 조회
      if (user.level > 1) {
        query = query.eq('partner_id', user.id);
      }

      // 필터 적용
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      
      if (targetFilter !== 'all') {
        query = query.eq('target_audience', targetFilter);
      }
      
      if (searchTerm) {
        query = query.or(`title.ilike.%${searchTerm}%,content.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query
        .order('display_order', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedAnnouncements = (data || []).map((announcement: any) => ({
        id: announcement.id,
        partner_id: announcement.partner_id,
        partner_username: announcement.partners?.username || '알 수 없음',
        title: announcement.title,
        content: announcement.content,
        image_url: announcement.image_url,
        is_popup: announcement.is_popup,
        target_audience: announcement.target_audience,
        target_level: announcement.target_level,
        status: announcement.status,
        display_order: announcement.display_order,
        view_count: announcement.view_count,
        start_date: announcement.start_date,
        end_date: announcement.end_date,
        created_at: announcement.created_at,
        updated_at: announcement.updated_at
      }));

      setAnnouncements(formattedAnnouncements);
    } catch (error) {
      console.error('공지사항 조회 오류:', error);
      toast.error('공지사항을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 공지사항 저장/수정
  const saveAnnouncement = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.error('제목과 내용을 입력해주세요.');
      return;
    }

    try {
      const announcementData = {
        ...formData,
        partner_id: user.id,
        target_level: formData.target_level ? parseInt(formData.target_level) : null,
        start_date: formData.start_date || new Date().toISOString(),
        end_date: formData.end_date || null
      };

      let result;
      if (editingAnnouncement) {
        // 수정
        result = await supabase
          .from('announcements')
          .update(announcementData)
          .eq('id', editingAnnouncement.id)
          .select();
      } else {
        // 신규 생성
        result = await supabase
          .from('announcements')
          .insert([announcementData])
          .select();
      }

      if (result.error) throw result.error;

      toast.success(editingAnnouncement ? '공지사항이 수정되었습니다.' : '공지사항이 등록되었습니다.');
      
      // WebSocket으로 실시간 알림 전송
      if (!editingAnnouncement && sendMessage) {
        sendMessage('new_announcement', {
          title: formData.title,
          target_audience: formData.target_audience,
          is_popup: formData.is_popup
        });
      }

      resetForm();
      setIsDialogOpen(false);
      fetchAnnouncements();
    } catch (error) {
      console.error('공지사항 저장 오류:', error);
      toast.error('공지사항 저장에 실패했습니다.');
    }
  };

  // 공지사항 삭제
  const deleteAnnouncement = async (announcementId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', announcementId);

      if (error) throw error;

      toast.success('공지사항이 삭제되었습니다.');
      fetchAnnouncements();
    } catch (error) {
      console.error('공지사항 삭제 오류:', error);
      toast.error('공지사항 삭제에 실패했습니다.');
    }
  };

  // 공지사항 상태 변경
  const updateAnnouncementStatus = async (announcementId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ status: newStatus })
        .eq('id', announcementId);

      if (error) throw error;

      setAnnouncements(prev => prev.map(announcement => 
        announcement.id === announcementId ? { ...announcement, status: newStatus } : announcement
      ));

      const statusLabel = {
        'active': '활성',
        'inactive': '비활성',
        'draft': '임시저장'
      }[newStatus] || newStatus;

      toast.success(`공지사항 상태가 "${statusLabel}"로 변경되었습니다.`);
    } catch (error) {
      console.error('공지사항 상태 변경 오류:', error);
      toast.error('공지사항 상태 변경에 실패했습니다.');
    }
  };

  // 폼 초기화
  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      image_url: '',
      is_popup: false,
      target_audience: 'users',
      target_level: '',
      status: 'active',
      display_order: 0,
      start_date: '',
      end_date: ''
    });
    setUploadedImage(null);
    setEditingAnnouncement(null);
  };

  // 편집 모드 설정
  const editAnnouncement = (announcement: Announcement) => {
    setFormData({
      title: announcement.title,
      content: announcement.content,
      image_url: announcement.image_url || '',
      is_popup: announcement.is_popup,
      target_audience: announcement.target_audience,
      target_level: announcement.target_level?.toString() || '',
      status: announcement.status,
      display_order: announcement.display_order,
      start_date: announcement.start_date ? announcement.start_date.split('T')[0] : '',
      end_date: announcement.end_date ? announcement.end_date.split('T')[0] : ''
    });
    setUploadedImage(announcement.image_url || null);
    setEditingAnnouncement(announcement);
    setIsDialogOpen(true);
  };

  useEffect(() => {
    fetchAnnouncements();
  }, [statusFilter, targetFilter]);

  // 디바운스 검색
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm !== undefined) {
        fetchAnnouncements();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const columns = [
    {
      key: 'title',
      title: '제목',
      render: (value: string, row: Announcement) => (
        <div>
          <div className="font-medium">{value}</div>
          <div className="flex gap-1 mt-1">
            {row.is_popup && <Badge variant="destructive" className="text-xs">팝업</Badge>}
            {row.target_audience === 'partners' && <Badge variant="secondary" className="text-xs">관리자</Badge>}
            {row.target_level && <Badge variant="outline" className="text-xs">Level {row.target_level}</Badge>}
          </div>
        </div>
      )
    },
    {
      key: 'target_audience',
      title: '대상',
      render: (value: string) => {
        const targetLabels: Record<string, string> = {
          'all': '전체',
          'users': '사용자',
          'partners': '관리자'
        };
        return <Badge variant="outline">{targetLabels[value] || value}</Badge>;
      }
    },
    {
      key: 'status',
      title: '상태',
      render: (value: string, row: Announcement) => {
        const statusConfig: Record<string, { label: string, color: string }> = {
          'active': { label: '활성', color: 'bg-green-100 text-green-800' },
          'inactive': { label: '비활성', color: 'bg-gray-100 text-gray-800' },
          'draft': { label: '임시저장', color: 'bg-yellow-100 text-yellow-800' }
        };
        
        const config = statusConfig[value] || statusConfig.draft;
        
        return (
          <Select value={value} onValueChange={(newStatus) => updateAnnouncementStatus(row.id, newStatus)}>
            <SelectTrigger className={`w-auto h-7 ${config.color}`}>
              <span>{config.label}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">활성</SelectItem>
              <SelectItem value="inactive">비활성</SelectItem>
              <SelectItem value="draft">임시저장</SelectItem>
            </SelectContent>
          </Select>
        );
      }
    },
    {
      key: 'view_count',
      title: '조회수',
      render: (value: number) => (
        <div className="flex items-center gap-1">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span>{value.toLocaleString()}</span>
        </div>
      )
    },
    {
      key: 'partner_username',
      title: '작성자',
      render: (value: string) => (
        <span className="text-sm">{value}</span>
      )
    },
    {
      key: 'created_at',
      title: '작성일',
      render: (value: string) => new Date(value).toLocaleDateString('ko-KR')
    },
    {
      key: 'actions',
      title: '관리',
      render: (value: any, row: Announcement) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => editAnnouncement(row)}
            className="h-8 px-2"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => deleteAnnouncement(row.id)}
            className="h-8 px-2 text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">공지사항</h1>
          <p className="text-sm text-slate-400">
            사용자 및 관리자 대상 공지사항을 작성하고 관리합니다.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="btn-premium-primary">
              <Plus className="h-4 w-4 mr-2" />
              공지사항 작성
            </Button>
          </DialogTrigger>
            <DialogContent className="!max-w-[min(1000px,90vw)] w-[90vw] max-h-[85vh] overflow-hidden glass-card p-0 flex flex-col">
              {/* 헤더 - 강조된 디자인 */}
              <DialogHeader className="pb-5 border-b border-slate-700/50 bg-gradient-to-r from-blue-500/10 to-purple-500/10 px-8 pt-6 rounded-t-lg bg-slate-900 backdrop-blur-xl flex-shrink-0">
                <DialogTitle className="flex items-center gap-3 text-2xl text-slate-50">
                  <div className="p-2.5 bg-blue-500/20 rounded-lg">
                    <Bell className="h-7 w-7 text-blue-400" />
                  </div>
                  {editingAnnouncement ? '공지사항 수정' : '새 공지사항 작성'}
                </DialogTitle>
                <DialogDescription className="text-slate-300 mt-2 text-base">
                  {editingAnnouncement ? '공지사항 내용을 수정합니다.' : '새로운 공지사항을 작성하고 사용자에게 전달합니다.'}
                </DialogDescription>
              </DialogHeader>

              {/* 메인 컨텐츠 */}
              <div className="px-8 py-6 space-y-6 overflow-y-auto flex-1">
                {/* 기본 정보 섹션 */}
                <div className="space-y-4 p-5 border border-slate-700/50 rounded-xl bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-1 w-8 bg-blue-500 rounded-full"></div>
                    <h4 className="font-semibold text-slate-100">기본 정보</h4>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <Label htmlFor="title" className="text-slate-200 flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-blue-400" />
                        제목 *
                      </Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="공지사항 제목을 입력하세요"
                        className="input-premium h-11 text-base border-slate-600 focus:border-blue-500 bg-slate-800/50"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-slate-200">상태</Label>
                      <Select value={formData.status} onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}>
                        <SelectTrigger className="h-11 bg-slate-800/50 border-slate-600 hover:border-blue-500 transition-colors">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-700">
                          <SelectItem value="active">✅ 활성</SelectItem>
                          <SelectItem value="inactive">⏸️ 비활성</SelectItem>
                          <SelectItem value="draft">📝 임시저장</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-3">
                      <Label className="text-slate-200">대상</Label>
                      <Select value={formData.target_audience} onValueChange={(value) => setFormData(prev => ({ ...prev, target_audience: value }))}>
                        <SelectTrigger className="h-11 bg-slate-800/50 border-slate-600 hover:border-blue-500 transition-colors">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-700">
                          <SelectItem value="all">👥 전체</SelectItem>
                          <SelectItem value="users">👤 사용자</SelectItem>
                          <SelectItem value="partners">🤝 관리자</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-slate-200">대상 레벨</Label>
                      <Input
                        type="number"
                        min="1"
                        max="6"
                        value={formData.target_level}
                        onChange={(e) => setFormData(prev => ({ ...prev, target_level: e.target.value }))}
                        placeholder="특정 레벨만 (1-6)"
                        className="input-premium h-11 bg-slate-800/50 border-slate-600 focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-slate-200">표시 순서</Label>
                      <Input
                        type="number"
                        value={formData.display_order}
                        onChange={(e) => setFormData(prev => ({ ...prev, display_order: parseInt(e.target.value) || 0 }))}
                        className="input-premium h-11 bg-slate-800/50 border-slate-600 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-700/30">
                    <div className="space-y-3">
                      <Label className="text-slate-200 flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-blue-400" />
                        시작일
                      </Label>
                      <Input
                        type="date"
                        value={formData.start_date}
                        onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                        className="input-premium h-11 bg-slate-800/50 border-slate-600 focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-slate-200">종료일</Label>
                      <Input
                        type="date"
                        value={formData.end_date}
                        onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                        placeholder="선택사항"
                        className="input-premium h-11 bg-slate-800/50 border-slate-600 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
                    <Switch
                      id="is_popup"
                      checked={formData.is_popup}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_popup: checked }))}
                    />
                    <Label htmlFor="is_popup" className="text-slate-200 cursor-pointer">
                      팝업으로 표시
                    </Label>
                  </div>
                </div>

                {/* 내용 섹션 */}
                <div className="space-y-4 p-5 border border-slate-700/50 rounded-xl bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-1 w-8 bg-green-500 rounded-full"></div>
                    <h4 className="font-semibold text-slate-100">공지사항 내용</h4>
                  </div>
                  
                  <div className="space-y-3">
                    <Label htmlFor="content" className="text-slate-200 flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-green-400" />
                      내용 *
                    </Label>
                    <Textarea
                      id="content"
                      value={formData.content}
                      onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                      placeholder="공지사항 내용을 입력하세요&#10;&#10;• 공지사항 내용을 상세히 작성하세요&#10;• 필요시 이미지를 첨부할 수 있습니다"
                      rows={8}
                      className="input-premium bg-slate-800/50 border-slate-600 focus:border-green-500 resize-none text-base leading-relaxed"
                    />
                    <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                      <p className="text-xs text-slate-400">
                        💡 <strong className="text-slate-300">작성 팁:</strong> 명확하고 간결하게 작성하세요
                      </p>
                    </div>
                  </div>
                </div>

                {/* 이미지 업로드 섹션 */}
                <div className="space-y-4 p-5 border border-slate-700/50 rounded-xl bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-8 bg-purple-500 rounded-full"></div>
                      <h4 className="font-semibold text-slate-100">이미지 첨부</h4>
                    </div>
                    {uploadedImage && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={removeImage}
                        className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <X className="h-4 w-4 mr-1" />
                        제거
                      </Button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <p className="text-xs text-blue-300 flex items-center gap-2">
                        <Info className="h-3.5 w-3.5" />
                        최대 5MB, JPG/PNG/GIF 형식
                      </p>
                    </div>

                    {uploadedImage ? (
                      <div className="space-y-3">
                        <div className="relative border-2 border-slate-600 rounded-xl overflow-hidden bg-slate-900 shadow-xl">
                          <div className="p-4 flex items-center justify-center">
                            <img 
                              src={uploadedImage} 
                              alt="업로드된 이미지" 
                              className="max-w-full max-h-60 object-contain rounded"
                            />
                          </div>
                          <div className="absolute top-2 right-2">
                            <Badge variant="secondary" className="bg-green-500/90 text-white">
                              미리보기
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Label 
                          htmlFor="image"
                          className="flex-1 flex items-center justify-center h-24 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-purple-500 hover:bg-purple-500/5 transition-all bg-slate-800/30 group"
                        >
                          <div className="flex items-center gap-3 text-slate-300">
                            <div className="p-3 bg-slate-700/50 rounded-full group-hover:bg-purple-500/20 transition-colors">
                              <Upload className="h-6 w-6 text-slate-400 group-hover:text-purple-400 transition-colors" />
                            </div>
                            <span>클릭하여 이미지 업로드</span>
                          </div>
                        </Label>
                        <Input
                          id="image"
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          disabled={uploading}
                          className="hidden"
                        />
                        {uploading && (
                          <div className="flex items-center gap-2 text-sm text-slate-400">
                            <div className="loading-premium w-4 h-4"></div>
                            업로드 중...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 하단 액션 버튼 */}
              <div className="flex gap-4 pt-6 border-t border-slate-700/50 px-8 pb-6 bg-slate-900 backdrop-blur-xl flex-shrink-0">
                <Button 
                  onClick={saveAnnouncement}
                  disabled={!formData.title.trim() || !formData.content.trim()}
                  className="btn-premium-primary flex items-center gap-3 flex-1 h-12 text-base shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all"
                >
                  <Bell className="h-5 w-5" />
                  {editingAnnouncement ? '수정' : '등록'}
                </Button>
                <Button 
                  onClick={() => setIsDialogOpen(false)}
                  variant="outline"
                  className="border-slate-600 hover:bg-slate-700/50 h-12 px-8 text-base"
                >
                  취소
                </Button>
              </div>
            </DialogContent>
          </Dialog>
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
              <Bell className="h-5 w-5 text-blue-400" />
              공지사항 목록
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              작성된 공지사항을 관리하고 대상별로 분류할 수 있습니다.
            </p>
          </div>
        </div>

        <div className="space-y-4">
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
              <SelectTrigger className="w-[120px] bg-slate-800/50 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="inactive">비활성</SelectItem>
                <SelectItem value="draft">임시저장</SelectItem>
              </SelectContent>
            </Select>
            <Select value={targetFilter} onValueChange={setTargetFilter}>
              <SelectTrigger className="w-[120px] bg-slate-800/50 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 대상</SelectItem>
                <SelectItem value="users">사용자</SelectItem>
                <SelectItem value="partners">관리자</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : (
            <DataTable
              data={announcements}
              columns={columns}
              enableSearch={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default Announcements;