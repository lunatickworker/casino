-- 16. 커뮤니케이션 기능 추가 스키마 (안전한 마이그레이션)
-- 기존 테이블이 있을 경우를 대비한 안전한 컬럼 추가

-- 고객센터 문의 테이블
CREATE TABLE IF NOT EXISTS customer_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- customer_inquiries 컬럼 추가
DO $$
BEGIN
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general';
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS admin_response TEXT;
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES partners(id);
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE customer_inquiries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
END $$;

-- 제약 조건 추가 (이미 있으면 무시)
DO $$
BEGIN
    ALTER TABLE customer_inquiries DROP CONSTRAINT IF EXISTS customer_inquiries_category_check;
    ALTER TABLE customer_inquiries ADD CONSTRAINT customer_inquiries_category_check 
        CHECK (category IN ('general', 'deposit', 'withdrawal', 'game', 'technical', 'account'));
    
    ALTER TABLE customer_inquiries DROP CONSTRAINT IF EXISTS customer_inquiries_status_check;
    ALTER TABLE customer_inquiries ADD CONSTRAINT customer_inquiries_status_check 
        CHECK (status IN ('pending', 'processing', 'completed', 'closed'));
    
    ALTER TABLE customer_inquiries DROP CONSTRAINT IF EXISTS customer_inquiries_priority_check;
    ALTER TABLE customer_inquiries ADD CONSTRAINT customer_inquiries_priority_check 
        CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 공지사항 테이블
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- announcements 컬럼 추가
DO $$
BEGIN
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_popup BOOLEAN DEFAULT FALSE;
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT 'users';
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_level INTEGER;
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE;
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
END $$;

-- announcements 제약 조건 추가
DO $$
BEGIN
    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_target_audience_check;
    ALTER TABLE announcements ADD CONSTRAINT announcements_target_audience_check 
        CHECK (target_audience IN ('all', 'users', 'partners'));
    
    ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_status_check;
    ALTER TABLE announcements ADD CONSTRAINT announcements_status_check 
        CHECK (status IN ('active', 'inactive', 'draft'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 공지사항 읽음 상태 테이블
CREATE TABLE IF NOT EXISTS announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- announcement_reads 컬럼 추가
DO $$
BEGIN
    ALTER TABLE announcement_reads ADD COLUMN IF NOT EXISTS announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE;
    ALTER TABLE announcement_reads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
END $$;

-- announcement_reads 유니크 제약 조건
DO $$
BEGIN
    ALTER TABLE announcement_reads DROP CONSTRAINT IF EXISTS announcement_reads_announcement_id_user_id_key;
    ALTER TABLE announcement_reads ADD CONSTRAINT announcement_reads_announcement_id_user_id_key 
        UNIQUE(announcement_id, user_id);
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 메시지 센터 테이블
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- messages 컬럼 추가
DO $$
BEGIN
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20) NOT NULL DEFAULT 'user';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(20) NOT NULL DEFAULT 'user';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_id UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS title VARCHAR(200);
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'normal';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id);
END $$;

-- messages 제약 조건 추가
DO $$
BEGIN
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_sender_type_check 
        CHECK (sender_type IN ('user', 'partner'));
    
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_recipient_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_recipient_type_check 
        CHECK (recipient_type IN ('user', 'partner'));
    
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_message_type_check 
        CHECK (message_type IN ('normal', 'system', 'urgent'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 알림 테이블
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- notifications 컬럼 추가
DO $$
BEGIN
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(20) NOT NULL DEFAULT 'user';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type VARCHAR(50) NOT NULL DEFAULT 'general';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS content TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
END $$;

-- notifications 제약 조건 추가
DO $$
BEGIN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_recipient_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_recipient_type_check 
        CHECK (recipient_type IN ('user', 'partner'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 인덱스 생성 (안전하게)
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_user_id ON customer_inquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_partner_id ON customer_inquiries(partner_id);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_status ON customer_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_created_at ON customer_inquiries(created_at);

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_target_audience ON announcements(target_audience);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_id ON announcement_reads(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user_id ON announcement_reads(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_type, sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 업데이트 트리거 생성
DROP TRIGGER IF EXISTS update_customer_inquiries_updated_at ON customer_inquiries;
CREATE TRIGGER update_customer_inquiries_updated_at
    BEFORE UPDATE ON customer_inquiries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_announcements_updated_at ON announcements;
CREATE TRIGGER update_announcements_updated_at
    BEFORE UPDATE ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- WebSocket 알림을 위한 트리거 함수들
CREATE OR REPLACE FUNCTION notify_new_inquiry()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'new_inquiry',
        json_build_object(
            'id', NEW.id,
            'user_id', NEW.user_id,
            'partner_id', NEW.partner_id,
            'title', NEW.title,
            'category', NEW.category,
            'priority', NEW.priority,
            'created_at', NEW.created_at
        )::TEXT
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'new_message',
        json_build_object(
            'id', NEW.id,
            'sender_type', NEW.sender_type,
            'sender_id', NEW.sender_id,
            'recipient_type', NEW.recipient_type,
            'recipient_id', NEW.recipient_id,
            'title', NEW.title,
            'content', NEW.content,
            'created_at', NEW.created_at
        )::TEXT
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_new_announcement()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'new_announcement',
        json_build_object(
            'id', NEW.id,
            'title', NEW.title,
            'target_audience', COALESCE(NEW.target_audience, 'users'),
            'is_popup', NEW.is_popup,
            'created_at', NEW.created_at
        )::TEXT
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS new_inquiry_notify ON customer_inquiries;
CREATE TRIGGER new_inquiry_notify
    AFTER INSERT ON customer_inquiries
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_inquiry();

DROP TRIGGER IF EXISTS new_message_notify ON messages;
CREATE TRIGGER new_message_notify
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_message();

DROP TRIGGER IF EXISTS new_announcement_notify ON announcements;
CREATE TRIGGER new_announcement_notify
    AFTER INSERT ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_announcement();

-- RLS (Row Level Security) 정책 설정
ALTER TABLE customer_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 (중복 방지)
DROP POLICY IF EXISTS "customer_inquiries_select_policy" ON customer_inquiries;
DROP POLICY IF EXISTS "announcements_select_policy" ON announcements;
DROP POLICY IF EXISTS "announcement_reads_select_policy" ON announcement_reads;
DROP POLICY IF EXISTS "messages_select_policy" ON messages;
DROP POLICY IF EXISTS "notifications_select_policy" ON notifications;

DROP POLICY IF EXISTS "customer_inquiries_insert_policy" ON customer_inquiries;
DROP POLICY IF EXISTS "announcements_insert_policy" ON announcements;
DROP POLICY IF EXISTS "announcement_reads_insert_policy" ON announcement_reads;
DROP POLICY IF EXISTS "messages_insert_policy" ON messages;
DROP POLICY IF EXISTS "notifications_insert_policy" ON notifications;

DROP POLICY IF EXISTS "customer_inquiries_update_policy" ON customer_inquiries;
DROP POLICY IF EXISTS "announcements_update_policy" ON announcements;
DROP POLICY IF EXISTS "messages_update_policy" ON messages;
DROP POLICY IF EXISTS "notifications_update_policy" ON notifications;

-- 조회 정책
CREATE POLICY "customer_inquiries_select_policy" ON customer_inquiries
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "announcements_select_policy" ON announcements
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "announcement_reads_select_policy" ON announcement_reads
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "messages_select_policy" ON messages
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "notifications_select_policy" ON notifications
    FOR SELECT USING (auth.role() = 'authenticated');

-- 삽입 정책
CREATE POLICY "customer_inquiries_insert_policy" ON customer_inquiries
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "announcements_insert_policy" ON announcements
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "announcement_reads_insert_policy" ON announcement_reads
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "messages_insert_policy" ON messages
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "notifications_insert_policy" ON notifications
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 업데이트 정책
CREATE POLICY "customer_inquiries_update_policy" ON customer_inquiries
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "announcements_update_policy" ON announcements
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "messages_update_policy" ON messages
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "notifications_update_policy" ON notifications
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 추가 유틸리티 함수들
CREATE OR REPLACE FUNCTION increment_announcement_view_count(announcement_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE announcements 
    SET view_count = view_count + 1 
    WHERE id = announcement_id;
END;
$$ LANGUAGE plpgsql;

-- 읽지 않은 메시지 수 조회 함수
CREATE OR REPLACE FUNCTION get_unread_message_count(
    user_type TEXT,
    user_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    unread_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO unread_count
    FROM messages
    WHERE recipient_type = user_type
      AND recipient_id = user_id
      AND is_read = FALSE;
      
    RETURN COALESCE(unread_count, 0);
END;
$$ LANGUAGE plpgsql;

-- 읽지 않은 알림 수 조회 함수
CREATE OR REPLACE FUNCTION get_unread_notification_count(
    user_type TEXT,
    user_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    unread_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO unread_count
    FROM notifications
    WHERE recipient_type = user_type
      AND recipient_id = user_id
      AND is_read = FALSE;
      
    RETURN COALESCE(unread_count, 0);
END;
$$ LANGUAGE plpgsql;

-- 고객 문의 통계 조회 함수
CREATE OR REPLACE FUNCTION get_customer_inquiry_stats()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', COUNT(*),
        'pending', COUNT(*) FILTER (WHERE status = 'pending'),
        'processing', COUNT(*) FILTER (WHERE status = 'processing'),
        'completed', COUNT(*) FILTER (WHERE status = 'completed'),
        'closed', COUNT(*) FILTER (WHERE status = 'closed'),
        'today', COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE)
    )
    INTO result
    FROM customer_inquiries;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 활성 공지사항 조회 함수 (사용자 페이지용)
CREATE OR REPLACE FUNCTION get_active_announcements_for_user(
    target_user_type TEXT DEFAULT 'users',
    target_user_level INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    title VARCHAR(200),
    content TEXT,
    image_url TEXT,
    is_popup BOOLEAN,
    display_order INTEGER,
    view_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.title,
        a.content,
        a.image_url,
        a.is_popup,
        a.display_order,
        a.view_count,
        a.created_at
    FROM announcements a
    WHERE a.status = 'active'
      AND (a.target_audience = 'all' OR a.target_audience = target_user_type)
      AND (a.target_level IS NULL OR a.target_level = target_user_level)
      AND (a.start_date IS NULL OR a.start_date <= NOW())
      AND (a.end_date IS NULL OR a.end_date >= NOW())
    ORDER BY a.display_order DESC, a.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 메시지 스레드 조회 함수 (답글 포함)
CREATE OR REPLACE FUNCTION get_message_thread(thread_root_id UUID)
RETURNS TABLE (
    id UUID,
    sender_type VARCHAR(20),
    sender_id UUID,
    recipient_type VARCHAR(20),
    recipient_id UUID,
    title VARCHAR(200),
    content TEXT,
    message_type VARCHAR(20),
    is_read BOOLEAN,
    read_at TIMESTAMP WITH TIME ZONE,
    parent_message_id UUID,
    created_at TIMESTAMP WITH TIME ZONE,
    level INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE message_tree AS (
        SELECT 
            m.id,
            m.sender_type,
            m.sender_id,
            m.recipient_type,
            m.recipient_id,
            m.title,
            m.content,
            m.message_type,
            m.is_read,
            m.read_at,
            m.parent_message_id,
            m.created_at,
            0 as level
        FROM messages m
        WHERE m.id = thread_root_id
        
        UNION ALL
        
        SELECT 
            m.id,
            m.sender_type,
            m.sender_id,
            m.recipient_type,
            m.recipient_id,
            m.title,
            m.content,
            m.message_type,
            m.is_read,
            m.read_at,
            m.parent_message_id,
            m.created_at,
            mt.level + 1
        FROM messages m
        INNER JOIN message_tree mt ON m.parent_message_id = mt.id
    )
    SELECT * FROM message_tree
    ORDER BY level, created_at;
END;
$$ LANGUAGE plpgsql;
