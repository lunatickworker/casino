import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { 
  Image, Save, RefreshCw, AlertCircle, CheckCircle, 
  Download, Upload, Monitor 
} from "lucide-react";
import { toast } from "sonner@2.0.3";
import { supabase } from "../../lib/supabase";

interface ImageOptimizationSettingsProps {
  onSettingsChange?: (settings: any) => void;
}

export function ImageOptimizationSettings({ onSettingsChange }: ImageOptimizationSettingsProps) {
  const [settings, setSettings] = useState({
    max_concurrent_downloads: 1, // 이미지 다운로드 5를 1로 변경
    image_cache_enabled: true,
    auto_compression: true,
    max_image_size: 2048, // KB
    thumbnail_generation: true,
    lazy_loading: true,
    preload_critical_images: false,
    compression_quality: 85, // %
  });
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cacheStats, setCacheStats] = useState({
    total_images: 0,
    cached_images: 0,
    cache_size: 0, // MB
    hit_rate: 0, // %
  });

  useEffect(() => {
    loadSettings();
    loadCacheStats();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .like('setting_key', '%image%');

      if (error) throw error;

      // 설정값을 상태에 반영
      data?.forEach(setting => {
        const value = setting.setting_type === 'boolean' 
          ? setting.setting_value === 'true'
          : setting.setting_type === 'number'
          ? parseFloat(setting.setting_value)
          : setting.setting_value;
          
        if (setting.setting_key in settings) {
          setSettings(prev => ({ 
            ...prev, 
            [setting.setting_key]: value 
          }));
        }
      });
    } catch (error) {
      console.error('이미지 설정 로드 실패:', error);
      toast.error('이미지 설정을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadCacheStats = async () => {
    try {
      // 실제 환경에서는 이미지 캐시 통계를 조회
      // 현재는 모의 데이터 사용
      setCacheStats({
        total_images: 1247,
        cached_images: 892,
        cache_size: 156.7,
        hit_rate: 87.2,
      });
    } catch (error) {
      console.error('캐시 통계 로드 실패:', error);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const updates = Object.entries(settings).map(([key, value]) => ({
        setting_key: key,
        setting_value: value.toString(),
        setting_type: typeof value === 'boolean' ? 'boolean' : 'number',
        description: getSettingDescription(key),
        partner_level: 1, // 시스템관리자 전용
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('system_settings')
          .upsert(update, { onConflict: 'setting_key' });

        if (error) throw error;
      }

      toast.success('이미지 최적화 설정이 저장되었습니다.');
      onSettingsChange?.(settings);
    } catch (error) {
      console.error('설정 저장 실패:', error);
      toast.error('설정 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const getSettingDescription = (key: string): string => {
    const descriptions: Record<string, string> = {
      max_concurrent_downloads: '동시 이미지 다운로드 제한',
      image_cache_enabled: '이미지 캐시 활성화',
      auto_compression: '자동 이미지 압축',
      max_image_size: '최대 이미지 크기 (KB)',
      thumbnail_generation: '썸네일 자동 생성',
      lazy_loading: '지연 로딩 활성화',
      preload_critical_images: '중요 이미지 미리 로드',
      compression_quality: '압축 품질 (%)',
    };
    return descriptions[key] || key;
  };

  const clearCache = async () => {
    try {
      toast.info('이미지 캐시를 삭제하고 있습니다...');
      
      // 실제 환경에서는 캐시 삭제 API 호출
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setCacheStats(prev => ({ 
        ...prev, 
        cached_images: 0, 
        cache_size: 0, 
        hit_rate: 0 
      }));
      
      toast.success('이미지 캐시가 삭제되었습니다.');
    } catch (error) {
      console.error('캐시 삭제 실패:', error);
      toast.error('캐시 삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="space-y-6">
      {/* 이미지 최적화 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            이미지 최적화 설정
          </CardTitle>
          <CardDescription>
            메모리 사용량을 최적화하기 위한 이미지 처리 설정을 관리합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="max_concurrent_downloads">동시 이미지 다운로드 제한</Label>
              <Input
                id="max_concurrent_downloads"
                type="number"
                min="1"
                max="10"
                value={settings.max_concurrent_downloads}
                onChange={(e) => setSettings(prev => ({ 
                  ...prev, 
                  max_concurrent_downloads: parseInt(e.target.value) 
                }))}
                placeholder="1"
              />
              <p className="text-xs text-muted-foreground">
                브라우저 메모리 최적화를 위해 동시 다운로드 수를 제한합니다.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max_image_size">최대 이미지 크기 (KB)</Label>
              <Input
                id="max_image_size"
                type="number"
                min="100"
                max="10240"
                value={settings.max_image_size}
                onChange={(e) => setSettings(prev => ({ 
                  ...prev, 
                  max_image_size: parseInt(e.target.value) 
                }))}
                placeholder="2048"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="compression_quality">압축 품질 (%)</Label>
              <Input
                id="compression_quality"
                type="number"
                min="10"
                max="100"
                value={settings.compression_quality}
                onChange={(e) => setSettings(prev => ({ 
                  ...prev, 
                  compression_quality: parseInt(e.target.value) 
                }))}
                placeholder="85"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>이미지 캐시</Label>
                <p className="text-sm text-muted-foreground">이미지를 메모리에 캐시하여 성능을 향상시킵니다.</p>
              </div>
              <Switch
                checked={settings.image_cache_enabled}
                onCheckedChange={(checked) => setSettings(prev => ({ 
                  ...prev, 
                  image_cache_enabled: checked 
                }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>자동 압축</Label>
                <p className="text-sm text-muted-foreground">업로드된 이미지를 자동으로 압축합니다.</p>
              </div>
              <Switch
                checked={settings.auto_compression}
                onCheckedChange={(checked) => setSettings(prev => ({ 
                  ...prev, 
                  auto_compression: checked 
                }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>썸네일 생성</Label>
                <p className="text-sm text-muted-foreground">이미지의 썸네일을 자동으로 생성합니다.</p>
              </div>
              <Switch
                checked={settings.thumbnail_generation}
                onCheckedChange={(checked) => setSettings(prev => ({ 
                  ...prev, 
                  thumbnail_generation: checked 
                }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>지연 로딩</Label>
                <p className="text-sm text-muted-foreground">화면에 보이는 이미지만 로드합니다.</p>
              </div>
              <Switch
                checked={settings.lazy_loading}
                onCheckedChange={(checked) => setSettings(prev => ({ 
                  ...prev, 
                  lazy_loading: checked 
                }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>중요 이미지 미리 로드</Label>
                <p className="text-sm text-muted-foreground">중요한 이미지를 미리 로드합니다.</p>
              </div>
              <Switch
                checked={settings.preload_critical_images}
                onCheckedChange={(checked) => setSettings(prev => ({ 
                  ...prev, 
                  preload_critical_images: checked 
                }))}
              />
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button 
              onClick={saveSettings}
              disabled={saving}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {saving ? '저장 중...' : '설정 저장'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 캐시 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              캐시 통계
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm font-medium">전체 이미지</span>
              <Badge variant="outline">{cacheStats.total_images.toLocaleString()}개</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium">캐시된 이미지</span>
              <Badge variant="default">{cacheStats.cached_images.toLocaleString()}개</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium">캐시 크기</span>
              <Badge variant="secondary">{cacheStats.cache_size.toFixed(1)} MB</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium">캐시 적중률</span>
              <Badge variant={cacheStats.hit_rate > 80 ? "default" : "destructive"}>
                {cacheStats.hit_rate.toFixed(1)}%
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              캐시 관리
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                이미지 캐시를 관리하여 메모리 사용량을 최적화합니다.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={loadCacheStats} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                통계 새로고침
              </Button>
              <Button onClick={clearCache} variant="destructive" size="sm">
                <AlertCircle className="h-4 w-4 mr-2" />
                캐시 삭제
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}