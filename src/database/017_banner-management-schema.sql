-- ========================================
-- 17. 배너 관리 스키마 추가
-- ========================================

-- 배너 테이블 생성
CREATE TABLE IF NOT EXISTS banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    banner_type VARCHAR(10) NOT NULL DEFAULT 'popup' CHECK (banner_type IN ('popup', 'banner')),
    target_audience VARCHAR(10) NOT NULL DEFAULT 'all' CHECK (target_audience IN ('all', 'users', 'partners')),
    target_level INTEGER CHECK (target_level BETWEEN 1 AND 6),
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    display_order INTEGER NOT NULL DEFAULT 0,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 배너 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_banners_partner_id ON banners(partner_id);
CREATE INDEX IF NOT EXISTS idx_banners_status ON banners(status);
CREATE INDEX IF NOT EXISTS idx_banners_type ON banners(banner_type);
CREATE INDEX IF NOT EXISTS idx_banners_target ON banners(target_audience);
CREATE INDEX IF NOT EXISTS idx_banners_order ON banners(display_order);
CREATE INDEX IF NOT EXISTS idx_banners_dates ON banners(start_date, end_date);

-- 배너 테이블 업데이트 트리거
CREATE OR REPLACE FUNCTION update_banner_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_banners_updated_at
    BEFORE UPDATE ON banners
    FOR EACH ROW
    EXECUTE FUNCTION update_banner_updated_at();

-- RLS 정책 설정
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- 파트너는 자신의 배너만 관리 가능
CREATE POLICY "Partners can manage own banners" ON banners
    FOR ALL USING (
        auth.uid()::text = banners.partner_id::text
    );

-- 시스템관리자는 모든 배너 관리 가능
CREATE POLICY "System admin can manage all banners" ON banners
    FOR ALL USING (
        auth.uid() IN (
            SELECT id FROM partners WHERE level = 1
        )
    );

-- 활성 배너는 모든 사용자가 조회 가능 (사용자 페이지 노출용)
CREATE POLICY "Active banners visible to all" ON banners
    FOR SELECT USING (
        status = 'active' AND
        (start_date IS NULL OR start_date <= NOW()) AND
        (end_date IS NULL OR end_date >= NOW())
    );

-- 샘플 배너 데이터 삽입 (시스템관리자용)
INSERT INTO banners (
    partner_id,
    title,
    content,
    image_url,
    banner_type,
    target_audience,
    status,
    display_order
) VALUES 
(
    (SELECT id FROM partners WHERE level = 1 LIMIT 1),
    '★★★ 환영 공지 메시지 ★★★',
    '안전과 공정성을 최우선으로 하는 저희 플랫폼에서<br>
    최고의 게임 경험을 즐기시기 바랍니다.<br><br>
    <strong>주요 안내사항:</strong><br>
    • 게임 이용 시 책임감 있는 플레이를 권장합니다<br>
    • 문의사항은 고객센터를 이용해 주세요<br>
    • 공정한 게임 환경을 위해 최선을 다하겠습니다<br><br>
    즐거운 게임 되세요!',
    NULL,
    'popup',
    'users',
    'active',
    1
),
(
    (SELECT id FROM partners WHERE level = 1 LIMIT 1),
    '★★ 카지노가 이벤트 진행중 ★★',
    '롤링 적립 혜택이 좋은 새로운 슬롯게임 출시!<br><br>
    <strong>이벤트 혜택:</strong><br>
    • 신규 슬롯 게임 100% 보너스<br>
    • 첫 베팅 시 즉시 포인트 적립<br>
    • 연속 플레이 시 추가 혜택<br><br>
    지금 바로 참여하세요!',
    NULL,
    'popup',
    'users',
    'active',
    2
);

-- 배너 관리 뷰 생성 (관리자용)
CREATE OR REPLACE VIEW banner_management_view AS
SELECT 
    b.id,
    b.partner_id,
    p.username as partner_username,
    p.nickname as partner_nickname,
    p.level as partner_level,
    b.title,
    b.content,
    b.image_url,
    b.banner_type,
    b.target_audience,
    b.target_level,
    b.status,
    b.display_order,
    b.start_date,
    b.end_date,
    b.created_at,
    b.updated_at,
    CASE 
        WHEN b.start_date IS NOT NULL AND b.start_date > NOW() THEN 'scheduled'
        WHEN b.end_date IS NOT NULL AND b.end_date < NOW() THEN 'expired'
        WHEN b.status = 'active' THEN 'active'
        ELSE 'inactive'
    END as current_status
FROM banners b
JOIN partners p ON b.partner_id = p.id
ORDER BY b.display_order, b.created_at DESC;

-- 활성 배너 조회 함수 (사용자 페이지용)
CREATE OR REPLACE FUNCTION get_active_banners(
    p_target_audience VARCHAR DEFAULT 'users',
    p_target_level INTEGER DEFAULT NULL,
    p_banner_type VARCHAR DEFAULT 'popup'
)
RETURNS TABLE (
    id UUID,
    title VARCHAR,
    content TEXT,
    image_url TEXT,
    banner_type VARCHAR,
    target_audience VARCHAR,
    target_level INTEGER,
    display_order INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.title,
        b.content,
        b.image_url,
        b.banner_type,
        b.target_audience,
        b.target_level,
        b.display_order
    FROM banners b
    WHERE 
        b.status = 'active'
        AND b.banner_type = p_banner_type
        AND (b.target_audience = 'all' OR b.target_audience = p_target_audience)
        AND (b.target_level IS NULL OR p_target_level IS NULL OR p_target_level <= b.target_level)
        AND (b.start_date IS NULL OR b.start_date <= NOW())
        AND (b.end_date IS NULL OR b.end_date >= NOW())
    ORDER BY b.display_order, b.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 배너 통계 뷰
CREATE OR REPLACE VIEW banner_stats_view AS
SELECT 
    COUNT(*) as total_banners,
    COUNT(*) FILTER (WHERE status = 'active') as active_banners,
    COUNT(*) FILTER (WHERE status = 'inactive') as inactive_banners,
    COUNT(*) FILTER (WHERE banner_type = 'popup') as popup_banners,
    COUNT(*) FILTER (WHERE banner_type = 'banner') as banner_banners,
    COUNT(*) FILTER (WHERE target_audience = 'users') as user_banners,
    COUNT(*) FILTER (WHERE target_audience = 'partners') as partner_banners,
    COUNT(*) FILTER (WHERE target_audience = 'all') as all_target_banners
FROM banners;

COMMENT ON TABLE banners IS '배너 관리 테이블 - 사용자 페이지에 표시되는 팝업 및 배너 관리';
COMMENT ON COLUMN banners.partner_id IS '배너를 생성한 파트너 ID';
COMMENT ON COLUMN banners.title IS '배너 제목';
COMMENT ON COLUMN banners.content IS '배너 내용 (HTML 지원)';
COMMENT ON COLUMN banners.image_url IS '배너 이미지 URL (선택사항)';
COMMENT ON COLUMN banners.banner_type IS '배너 타입 (popup: 팝업, banner: 배너)';
COMMENT ON COLUMN banners.target_audience IS '대상 그룹 (all: 전체, users: 사용자, partners: 파트너)';
COMMENT ON COLUMN banners.target_level IS '대상 권한 레벨 (선택사항, 1-6)';
COMMENT ON COLUMN banners.status IS '배너 상태 (active: 활성, inactive: 비활성)';
COMMENT ON COLUMN banners.display_order IS '표시 순서 (낮은 숫자 우선)';
COMMENT ON COLUMN banners.start_date IS '노출 시작 일시 (선택사항)';
COMMENT ON COLUMN banners.end_date IS '노출 종료 일시 (선택사항)';