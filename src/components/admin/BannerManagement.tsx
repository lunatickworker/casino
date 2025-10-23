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
  Image, Save, Plus, Edit, Trash2, Eye, FileText, Calendar, Users, Upload, X
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

      {/* 배너 생성/수정 모달 */}
      <Dialog open={showForm && user.level <= 5} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-hidden glass-card">
          <DialogHeader className="pb-3">
            <DialogTitle className="flex items-center gap-2 text-lg text-slate-100">
              <Image className="h-5 w-5 text-blue-400" />
              {editingBanner ? '배너 수정' : '새 배너 만들기'}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-400">
              직사각형 팝업 형태의 배너를 생성하여 사용자에게 공지사항을 전달하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {/* 왼쪽 컬럼 - 기본 정보 및 이미지 */}
            <div className="space-y-3">
              {/* 기본 정보 */}
              <div className="space-y-3 p-3 border border-slate-700/50 rounded-lg bg-slate-900/30">
                <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" />
                  기본 정보
                </h4>
                
                <div className="space-y-2">
                  <Label htmlFor="banner_title" className="text-xs text-slate-300">배너 제목 *</Label>
                  <Input
                    id="banner_title"
                    value={bannerForm.title || ''}
                    onChange={(e) => setBannerForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="배너 제목을 입력하세요"
                    className="input-premium h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="banner_type" className="text-xs text-slate-300">배너 타입</Label>
                    <Select
                      value={bannerForm.banner_type}
                      onValueChange={(value: 'popup' | 'banner') => 
                        setBannerForm(prev => ({ ...prev, banner_type: value }))
                      }
                    >
                      <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="popup">팝업</SelectItem>
                        <SelectItem value="banner">배너</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="banner_status" className="text-xs text-slate-300">상태</Label>
                    <Select
                      value={bannerForm.status}
                      onValueChange={(value: 'active' | 'inactive') => 
                        setBannerForm(prev => ({ ...prev, status: value }))
                      }
                    >
                      <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="active">활성</SelectItem>
                        <SelectItem value="inactive">비활성</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="target_audience" className="text-xs text-slate-300">대상</Label>
                    <Select
                      value={bannerForm.target_audience}
                      onValueChange={(value: 'all' | 'users' | 'partners') => 
                        setBannerForm(prev => ({ ...prev, target_audience: value }))
                      }
                    >
                      <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="users">사용자</SelectItem>
                        <SelectItem value="partners">파트너</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="display_order" className="text-xs text-slate-300">순서</Label>
                    <Input
                      id="display_order"
                      type="number"
                      value={bannerForm.display_order || 0}
                      onChange={(e) => setBannerForm(prev => ({ ...prev, display_order: parseInt(e.target.value) }))}
                      placeholder="0"
                      className="input-premium h-9 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 이미지 업로드 */}
              <div className="space-y-2 p-3 border border-slate-700/50 rounded-lg bg-slate-900/30">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Image className="h-4 w-4 text-blue-400" />
                    배너 이미지
                  </h4>
                  {imagePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleImageRemove}
                      className="h-7 text-xs text-red-400 hover:text-red-300"
                    >
                      <X className="h-3 w-3 mr-1" />
                      제거
                    </Button>
                  )}
                </div>

                {!imagePreview ? (
                  <Label 
                    htmlFor="banner_image_upload" 
                    className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-blue-500 transition-colors bg-slate-800/50"
                  >
                    <Upload className="h-8 w-8 mb-2 text-slate-400" />
                    <p className="text-xs text-slate-300 mb-1">
                      <span className="font-semibold">클릭하여 업로드</span>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      JPG, PNG, GIF, WebP (최대 2MB)
                    </p>
                    <Input
                      id="banner_image_upload"
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </Label>
                ) : (
                  <div className="space-y-1">
                    <div className="border border-slate-600 rounded-lg p-2 bg-slate-800">
                      <img 
                        src={imagePreview} 
                        alt="배너 미리보기"
                        className="max-w-full h-auto max-h-32 rounded mx-auto"
                      />
                    </div>
                    {selectedImageFile && (
                      <p className="text-[10px] text-slate-400 text-center">
                        {selectedImageFile.name} ({(selectedImageFile.size / 1024).toFixed(0)}KB)
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 오른쪽 컬럼 - 배너 내용 */}
            <div className="space-y-3">
              {/* 배너 내용 */}
              <div className="space-y-2 p-3 border border-slate-700/50 rounded-lg bg-slate-900/30 h-full">
                <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" />
                  배너 내용
                </h4>
                
                <div className="space-y-2">
                  <Label htmlFor="banner_content" className="text-xs text-slate-300">내용 *</Label>
                  <Textarea
                    id="banner_content"
                    rows={14}
                    value={bannerForm.content || ''}
                    onChange={(e) => setBannerForm(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="배너에 표시될 내용을 입력하세요. HTML 태그 사용 가능합니다."
                    className="min-h-[280px] bg-slate-800 border-slate-700 text-sm resize-none"
                  />
                  <p className="text-[10px] text-slate-400">
                    사용 가능: &lt;p&gt;, &lt;br&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;span&gt;, &lt;div&gt;, &lt;a&gt;
                  </p>
                </div>

                {/* 날짜 설정 */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="space-y-1">
                    <Label htmlFor="start_date" className="text-xs text-slate-300">시작 일시</Label>
                    <Input
                      id="start_date"
                      type="datetime-local"
                      value={bannerForm.start_date || ''}
                      onChange={(e) => setBannerForm(prev => ({ ...prev, start_date: e.target.value }))}
                      className="h-8 text-xs bg-slate-800 border-slate-700"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="end_date" className="text-xs text-slate-300">종료 일시</Label>
                    <Input
                      id="end_date"
                      type="datetime-local"
                      value={bannerForm.end_date || ''}
                      onChange={(e) => setBannerForm(prev => ({ ...prev, end_date: e.target.value }))}
                      className="h-8 text-xs bg-slate-800 border-slate-700"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>
          
          {/* 버튼 - 모달 하단 */}
          <div className="flex gap-3 pt-3 border-t border-slate-700/50 mt-3">
            <Button 
              onClick={saveBanner}
              disabled={saving || uploadingImage}
              className="btn-premium-primary flex items-center gap-2 flex-1"
            >
              <Save className="h-4 w-4" />
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
              className="border-slate-600 hover:bg-slate-700/50"
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