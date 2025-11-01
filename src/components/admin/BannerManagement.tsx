import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle } from "./AdminDialog";
import { 
  Image, Save, Plus, Edit, Trash2, Eye, FileText, Calendar, Users, Upload, X, Info
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";
import { MetricCard } from "./MetricCard";

interface Banner {
  id: string;
  partner_id: string;
  title: string;
  content: string;
  image_url?: string;
  banner_type: 'popup' | 'banner';
  target_audience: 'all' | 'users' | 'partners';
  target_level?: number;
  status: 'active' | 'inactive';
  display_order: number;
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
}

interface BannerManagementProps {
  user: Partner;
}

export function BannerManagement({ user }: BannerManagementProps) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingBanner, setEditingBanner] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const [bannerForm, setBannerForm] = useState<Partial<Banner>>({
    title: '',
    content: '',
    image_url: '',
    banner_type: 'popup',
    target_audience: 'users',
    status: 'active',
    display_order: 0,
  });

  useEffect(() => {
    loadBanners();
  }, [user.id]);

  const loadBanners = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('banners')
        .select('*')
        .order('display_order', { ascending: true });

      // 시스템관리자가 아닌 경우 자신의 배너만 조회
      if (user.level > 1) {
        query = query.eq('partner_id', user.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setBanners(data || []);
    } catch (error) {
      console.error('배너 로드 실패:', error);
      toast.error('배너 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 이미지 파일 선택 처리
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 크기 체크 (2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('이미지 파일 크기는 2MB 이하여야 합니다.');
      return;
    }

    // 파일 형식 체크
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('JPG, PNG, GIF, WebP 형식의 이미지만 업로드 가능합니다.');
      return;
    }

    setSelectedImageFile(file);

    // 미리보기 생성
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 이미지 제거
  const handleImageRemove = () => {
    setSelectedImageFile(null);
    setImagePreview(null);
    setBannerForm(prev => ({ ...prev, image_url: '' }));
  };

  // 이미지 업로드
  const uploadImage = async (): Promise<string | null> => {
    if (!selectedImageFile) return bannerForm.image_url || null;

    setUploadingImage(true);
    try {
      const fileExt = selectedImageFile.name.split('.').pop();
      const fileName = `${user.id}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Supabase Storage에 업로드
      const { error: uploadError } = await supabase.storage
        .from('banner-images')
        .upload(filePath, selectedImageFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('이미지 업로드 에러:', uploadError);
        throw uploadError;
      }

      // Public URL 가져오기
      const { data: { publicUrl } } = supabase.storage
        .from('banner-images')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('이미지 업로드 실패:', error);
      toast.error('이미지 업로드에 실패했습니다.');
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const saveBanner = async () => {
    if (!bannerForm.title?.trim()) {
      toast.error('배너 제목을 입력하세요.');
      return;
    }

    if (!bannerForm.content?.trim()) {
      toast.error('배너 내용을 입력하세요.');
      return;
    }

    setSaving(true);
    try {
      // 이미지 업로드 (새 이미지가 선택된 경우)
      let imageUrl = bannerForm.image_url;
      if (selectedImageFile) {
        const uploadedUrl = await uploadImage();
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
        } else {
          setSaving(false);
          return;
        }
      }

      const bannerData = {
        ...bannerForm,
        image_url: imageUrl,
        partner_id: user.id,
        updated_at: new Date().toISOString(),
      };

      if (editingBanner) {
        const { error } = await supabase
          .from('banners')
          .update(bannerData)
          .eq('id', editingBanner);

        if (error) throw error;
        toast.success('배너가 성공적으로 수정되었습니다.');
      } else {
        const { error } = await supabase
          .from('banners')
          .insert({
            ...bannerData,
            created_at: new Date().toISOString(),
          });

        if (error) throw error;
        toast.success('배너가 성공적으로 생성되었습니다.');
      }

      resetForm();
      await loadBanners();
    } catch (error) {
      console.error('배너 저장 실패:', error);
      toast.error('배너 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const deleteBanner = async (bannerId: string) => {
    if (!confirm('이 배너를 삭제하시겠습니까?')) return;

    try {
      const { error } = await supabase
        .from('banners')
        .delete()
        .eq('id', bannerId);

      if (error) throw error;
      toast.success('배너가 성공적으로 삭제되었습니다.');
      await loadBanners();
    } catch (error) {
      console.error('배너 삭제 실패:', error);
      toast.error('배너 삭제에 실패했습니다.');
    }
  };

  const editBanner = (banner: Banner) => {
    setBannerForm({
      title: banner.title,
      content: banner.content,
      image_url: banner.image_url,
      banner_type: banner.banner_type,
      target_audience: banner.target_audience,
      target_level: banner.target_level,
      status: banner.status,
      display_order: banner.display_order,
      start_date: banner.start_date,
      end_date: banner.end_date,
    });
    setEditingBanner(banner.id);
    setSelectedImageFile(null);
    setImagePreview(banner.image_url || null);
    setShowForm(true);
  };

  const resetForm = () => {
    setBannerForm({
      title: '',
      content: '',
      image_url: '',
      banner_type: 'popup',
      target_audience: 'users',
      status: 'active',
      display_order: 0,
    });
    setEditingBanner(null);
    setSelectedImageFile(null);
    setImagePreview(null);
    setShowForm(false);
  };

  const previewBanner = (banner: Banner) => {
    const previewWindow = window.open('', '_blank', 'width=600,height=400');
    if (previewWindow) {
      previewWindow.document.write(`
        <html>
          <head>
            <title>배너 미리보기 - ${banner.title}</title>
            <style>
              body { margin: 0; padding: 20px; font-family: sans-serif; background: #1e293b; }
              .banner-preview { 
                border: 2px solid #f97316; 
                padding: 20px; 
                max-width: 500px; 
                margin: 0 auto; 
                background: #0f172a; 
                color: #fff; 
                border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3);
              }
              .banner-title { 
                margin: 0 0 15px 0; 
                color: #f97316; 
                font-size: 18px;
                font-weight: bold;
                text-align: center;
              }
              .banner-content { 
                line-height: 1.6; 
                color: #e2e8f0;
              }
              .banner-image { 
                max-width: 100%; 
                height: auto; 
                margin: 10px 0; 
                border-radius: 4px;
              }
            </style>
          </head>
          <body>
            <div class="banner-preview">
              <h3 class="banner-title">★★★ ${banner.title} ★★★</h3>
              ${banner.image_url ? `<img src="${banner.image_url}" class="banner-image" />` : ''}
              <div class="banner-content">${banner.content}</div>
            </div>
          </body>
        </html>
      `);
    }
  };

  const bannerColumns = [
    {
      key: "title",
      title: "제목",
      sortable: true,
      cell: (banner: Banner) => (
        <div className="max-w-xs">
          <p className="font-medium truncate">{banner.title}</p>
          {banner.image_url && (
            <p className="text-xs text-muted-foreground">이미지 포함</p>
          )}
        </div>
      ),
    },
    {
      key: "banner_type",
      title: "타입",
      cell: (banner: Banner) => (
        <Badge variant={banner.banner_type === 'popup' ? 'default' : 'secondary'}>
          {banner.banner_type === 'popup' ? '팝업' : '배너'}
        </Badge>
      ),
    },
    {
      key: "target_audience",
      title: "대상",
      cell: (banner: Banner) => (
        <div className="space-y-1">
          <Badge variant="outline">
            {banner.target_audience === 'all' ? '전체' : 
             banner.target_audience === 'users' ? '사용자' : '파트너'}
          </Badge>
          {banner.target_level && (
            <p className="text-xs text-muted-foreground">Level {banner.target_level}</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      title: "상태",
      cell: (banner: Banner) => (
        <Badge variant={banner.status === 'active' ? 'default' : 'secondary'}>
          {banner.status === 'active' ? '활성' : '비활성'}
        </Badge>
      ),
    },
    {
      key: "display_order",
      title: "순서",
      sortable: true,
    },
    {
      key: "actions",
      title: "작업",
      cell: (banner: Banner) => (
        <div className="flex gap-2">
          <Button
            onClick={() => previewBanner(banner)}
            variant="outline"
            size="sm"
            title="미리보기"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => editBanner(banner)}
            variant="outline"
            size="sm"
            title="수정"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => deleteBanner(banner.id)}
            variant="outline"
            size="sm"
            title="삭제"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const activeBanners = banners.filter(b => b.status === 'active').length;
  const popupBanners = banners.filter(b => b.banner_type === 'popup').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">배너 관리</h1>
          <p className="text-sm text-slate-400">
            사용자 페이지에 표시되는 배너를 관리합니다. ({user.level <= 5 ? '총판 이상' : '접근 제한'})
          </p>
        </div>
        {user.level <= 5 && (
          <Button 
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            새 배너 만들기
          </Button>
        )}
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <MetricCard
          title="전체 배너"
          value={banners.length.toLocaleString()}
          subtitle="등록된 배너"
          icon={Image}
          color="blue"
        />

        <MetricCard
          title="활성 배너"
          value={activeBanners.toLocaleString()}
          subtitle="노출 중"
          icon={Eye}
          color="green"
        />

        <MetricCard
          title="팝업 배너"
          value={popupBanners.toLocaleString()}
          subtitle="팝업 형식"
          icon={Users}
          color="purple"
        />

        <MetricCard
          title="일반 배너"
          value={(banners.length - popupBanners).toLocaleString()}
          subtitle="배너 형식"
          icon={Calendar}
          color="orange"
        />
      </div>

      {/* 배너 생성/수정 모달 - 16:9 비율 최적화 */}
      <Dialog open={showForm && user.level <= 5} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="!max-w-[min(1600px,95vw)] w-[95vw] max-h-[85vh] overflow-y-auto glass-card p-0">
          {/* 헤더 - 강조된 디자인 */}
          <DialogHeader className="pb-5 border-b border-slate-700/50 bg-gradient-to-r from-blue-500/10 to-purple-500/10 px-8 pt-6 rounded-t-lg sticky top-0 z-10">
            <DialogTitle className="flex items-center gap-3 text-2xl text-slate-50">
              <div className="p-2.5 bg-blue-500/20 rounded-lg">
                <Image className="h-7 w-7 text-blue-400" />
              </div>
              {editingBanner ? '배너 수정' : '새 배너 만들기'}
            </DialogTitle>
            <DialogDescription className="text-slate-300 mt-2 text-base">
              16:9 비율로 최적화된 배너를 생성하여 사용자에게 효과적으로 공지사항을 전달하세요.
            </DialogDescription>
          </DialogHeader>

          {/* 메인 컨텐츠 - 가로 3컬럼 레이아웃 */}
          <div className="grid grid-cols-12 gap-6 px-8 py-6">
            {/* 왼쪽 - 기본 정보 (4컬럼) */}
            <div className="col-span-4 space-y-4">
              <div className="space-y-4 p-5 border border-slate-700/50 rounded-xl bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-8 bg-blue-500 rounded-full"></div>
                  <h4 className="font-semibold text-slate-100">기본 정보</h4>
                </div>
                
                <div className="space-y-3">
                  <Label htmlFor="banner_title" className="text-slate-200 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-blue-400" />
                    배너 제목 *
                  </Label>
                  <Input
                    id="banner_title"
                    value={bannerForm.title || ''}
                    onChange={(e) => setBannerForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="눈에 띄는 제목을 입력하세요"
                    className="input-premium h-11 text-base border-slate-600 focus:border-blue-500 bg-slate-800/50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-3">
                    <Label className="text-slate-200">배너 타입</Label>
                    <Select
                      value={bannerForm.banner_type}
                      onValueChange={(value: 'popup' | 'banner') => 
                        setBannerForm(prev => ({ ...prev, banner_type: value }))
                      }
                    >
                      <SelectTrigger className="h-11 bg-slate-800/50 border-slate-600 hover:border-blue-500 transition-colors">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="popup">🔔 팝업</SelectItem>
                        <SelectItem value="banner">📌 배너</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-slate-200">상태</Label>
                    <Select
                      value={bannerForm.status}
                      onValueChange={(value: 'active' | 'inactive') => 
                        setBannerForm(prev => ({ ...prev, status: value }))
                      }
                    >
                      <SelectTrigger className="h-11 bg-slate-800/50 border-slate-600 hover:border-blue-500 transition-colors">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="active">✅ 활성</SelectItem>
                        <SelectItem value="inactive">⏸️ 비활성</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-3">
                    <Label className="text-slate-200">대상</Label>
                    <Select
                      value={bannerForm.target_audience}
                      onValueChange={(value: 'all' | 'users' | 'partners') => 
                        setBannerForm(prev => ({ ...prev, target_audience: value }))
                      }
                    >
                      <SelectTrigger className="h-11 bg-slate-800/50 border-slate-600 hover:border-blue-500 transition-colors">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="all">👥 전체</SelectItem>
                        <SelectItem value="users">👤 사용자</SelectItem>
                        <SelectItem value="partners">🤝 파트너</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-slate-200">표시 순서</Label>
                    <Input
                      id="display_order"
                      type="number"
                      value={bannerForm.display_order || 0}
                      onChange={(e) => setBannerForm(prev => ({ ...prev, display_order: parseInt(e.target.value) }))}
                      placeholder="0"
                      className="input-premium h-11 bg-slate-800/50 border-slate-600 focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* 날짜 설정 */}
                <div className="space-y-3 pt-3 border-t border-slate-700/30">
                  <Label className="text-slate-200 flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-blue-400" />
                    노출 기간
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="start_date" className="text-xs text-slate-400">시작</Label>
                      <Input
                        id="start_date"
                        type="datetime-local"
                        value={bannerForm.start_date || ''}
                        onChange={(e) => setBannerForm(prev => ({ ...prev, start_date: e.target.value }))}
                        className="h-10 bg-slate-800/50 border-slate-600 text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="end_date" className="text-xs text-slate-400">종료</Label>
                      <Input
                        id="end_date"
                        type="datetime-local"
                        value={bannerForm.end_date || ''}
                        onChange={(e) => setBannerForm(prev => ({ ...prev, end_date: e.target.value }))}
                        className="h-10 bg-slate-800/50 border-slate-600 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 중앙 - 이미지 업로드 (4컬럼) */}
            <div className="col-span-4 space-y-4">
              <div className="space-y-4 p-5 border border-slate-700/50 rounded-xl bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg h-full">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-8 bg-purple-500 rounded-full"></div>
                    <h4 className="font-semibold text-slate-100">배너 이미지</h4>
                  </div>
                  {imagePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleImageRemove}
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
                      권장 비율: 16:9 (예: 1920x1080px)
                    </p>
                  </div>

                  {!imagePreview ? (
                    <Label 
                      htmlFor="banner_image_upload" 
                      className="flex flex-col items-center justify-center w-full h-[280px] border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-all bg-slate-800/30 group"
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-4 bg-slate-700/50 rounded-full group-hover:bg-blue-500/20 transition-colors">
                          <Upload className="h-10 w-10 text-slate-400 group-hover:text-blue-400 transition-colors" />
                        </div>
                        <div className="text-center">
                          <p className="text-slate-200 mb-1">
                            <span className="font-semibold">클릭하여 이미지 업로드</span>
                          </p>
                          <p className="text-xs text-slate-400">
                            또는 드래그 앤 드롭
                          </p>
                        </div>
                        <div className="px-4 py-2 bg-slate-700/30 rounded-full">
                          <p className="text-xs text-slate-300">
                            JPG, PNG, GIF, WebP · 최대 2MB
                          </p>
                        </div>
                      </div>
                      <Input
                        id="banner_image_upload"
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </Label>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative border-2 border-slate-600 rounded-xl overflow-hidden bg-slate-900 shadow-xl">
                        <div className="aspect-video flex items-center justify-center">
                          <img 
                            src={imagePreview} 
                            alt="배너 미리보기"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div className="absolute top-2 right-2">
                          <Badge variant="secondary" className="bg-green-500/90 text-white">
                            미리보기
                          </Badge>
                        </div>
                      </div>
                      {selectedImageFile && (
                        <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                          <div className="flex items-center gap-2 text-slate-300">
                            <FileText className="h-4 w-4 text-blue-400" />
                            <span className="text-sm truncate max-w-[180px]">{selectedImageFile.name}</span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {(selectedImageFile.size / 1024).toFixed(0)} KB
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 오른쪽 - 배너 내용 (4컬럼) */}
            <div className="col-span-4 space-y-4">
              <div className="space-y-4 p-5 border border-slate-700/50 rounded-xl bg-gradient-to-br from-slate-900/50 to-slate-800/30 shadow-lg h-full flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-8 bg-green-500 rounded-full"></div>
                  <h4 className="font-semibold text-slate-100">배너 내용</h4>
                </div>
                
                <div className="space-y-3 flex-1 flex flex-col">
                  <Label htmlFor="banner_content" className="text-slate-200 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-green-400" />
                    내용 *
                  </Label>
                  <Textarea
                    id="banner_content"
                    value={bannerForm.content || ''}
                    onChange={(e) => setBannerForm(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="배너에 표시될 내용을 입력하세요.&#10;&#10;• HTML 태그를 사용할 수 있습니다&#10;• 줄바꿈은 <br> 태그를 사용하세요&#10;• 강조는 <strong> 태그를 사용하세요"
                    className="flex-1 min-h-[320px] bg-slate-800/50 border-slate-600 focus:border-green-500 resize-none text-base leading-relaxed"
                  />
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      💡 <strong className="text-slate-300">사용 가능한 태그:</strong>
                      <br />
                      &lt;p&gt; &lt;br&gt; &lt;strong&gt; &lt;em&gt; &lt;span&gt; &lt;div&gt; &lt;a&gt; &lt;ul&gt; &lt;li&gt;
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* 하단 액션 버튼 - 강조된 디자인 */}
          <div className="flex gap-4 pt-6 border-t border-slate-700/50 px-8 pb-6 bg-slate-900/30 sticky bottom-0 z-10">
            <Button 
              onClick={saveBanner}
              disabled={saving || uploadingImage}
              className="btn-premium-primary flex items-center gap-3 flex-1 h-12 text-base shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all"
            >
              <Save className="h-5 w-5" />
              {uploadingImage 
                ? '이미지 업로드 중...' 
                : editingBanner 
                  ? (saving ? '수정 중...' : '배너 수정') 
                  : (saving ? '생성 중...' : '배너 생성')
              }
            </Button>
            <Button 
              onClick={resetForm}
              variant="outline"
              disabled={saving || uploadingImage}
              className="border-slate-600 hover:bg-slate-700/50 h-12 px-8 text-base"
            >
              취소
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 배너 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>배너 목록</CardTitle>
          <CardDescription>
            생성된 배너 목록을 확인하고 관리하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={banners}
            columns={bannerColumns}
            loading={loading}
            searchPlaceholder="배너를 검색하세요..."
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default BannerManagement;