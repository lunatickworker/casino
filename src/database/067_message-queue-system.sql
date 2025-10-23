-- 메시지 큐 시스템 스키마 추가
-- 실시간 알림과 트랜잭션 처리를 위한 큐 시스템

-- 메시지 큐 테이블
CREATE TABLE IF NOT EXISTS message_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_type VARCHAR(50) NOT NULL, -- 'deposit_request', 'withdrawal_request', 'bet_placed', 'admin_action', etc.
    priority INTEGER DEFAULT 5, -- 1(highest) ~ 10(lowest)
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    
    -- 발송자 정보
    sender_type VARCHAR(20), -- 'user', 'admin', 'system'
    sender_id UUID,
    
    -- 수신자 정보
    target_type VARCHAR(20), -- 'user', 'admin', 'all_admins', 'system'
    target_id UUID, -- NULL for 'all_admins', 'system'
    
    -- 메시지 내용
    subject VARCHAR(200),
    message_data JSONB NOT NULL,
    
    -- 관련 레코드 참조
    reference_type VARCHAR(50), -- 'transaction', 'bet', 'game_session', etc.
    reference_id UUID,
    
    -- 처리 정보
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    
    -- 메타데이터
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_message_queue_status_priority ON message_queue(status, priority, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_type_target ON message_queue(message_type, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_reference ON message_queue(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_created_at ON message_queue(created_at);

-- 알림 설정 테이블
CREATE TABLE IF NOT EXISTS notification_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
    
    -- 알림 타입별 설정
    deposit_request BOOLEAN DEFAULT true,
    withdrawal_request BOOLEAN DEFAULT true,
    transaction_completed BOOLEAN DEFAULT true,
    transaction_rejected BOOLEAN DEFAULT true,
    admin_messages BOOLEAN DEFAULT true,
    system_alerts BOOLEAN DEFAULT true,
    
    -- 알림 방식
    realtime_enabled BOOLEAN DEFAULT true,
    email_enabled BOOLEAN DEFAULT false,
    sms_enabled BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT check_user_or_partner CHECK (
        (user_id IS NOT NULL AND partner_id IS NULL) OR 
        (user_id IS NULL AND partner_id IS NOT NULL)
    )
);

-- 실시간 알림 로그 테이블
DROP TABLE IF EXISTS realtime_notifications CASCADE;
CREATE TABLE realtime_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_queue_id UUID REFERENCES message_queue(id) ON DELETE CASCADE,
    
    recipient_type VARCHAR(20) NOT NULL, -- 'user', 'admin'
    recipient_id UUID NOT NULL,
    
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(200),
    content TEXT,
    action_url VARCHAR(500),
    
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'read', 'failed'
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_realtime_notifications_recipient ON realtime_notifications(recipient_type, recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_realtime_notifications_created_at ON realtime_notifications(created_at);

-- 메시지 큐 처리 함수
CREATE OR REPLACE FUNCTION process_message_queue()
RETURNS TABLE(processed_count INTEGER) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    msg_record RECORD;
    processed INTEGER := 0;
    error_msg TEXT;
BEGIN
    -- 처리 대기 중인 메시지들을 우선순위와 생성 시간 순으로 처리
    FOR msg_record IN 
        SELECT * FROM message_queue 
        WHERE status = 'pending' 
        AND scheduled_at <= NOW()
        AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY priority ASC, created_at ASC
        LIMIT 100
    LOOP
        BEGIN
            -- 메시지 상태를 처리 중으로 변경
            UPDATE message_queue 
            SET status = 'processing', 
                attempts = attempts + 1,
                updated_at = NOW()
            WHERE id = msg_record.id;
            
            -- 메시지 타입별 처리
            CASE msg_record.message_type
                WHEN 'deposit_request' THEN
                    -- 입금 요청 알림 생성
                    PERFORM create_realtime_notification(
                        msg_record.id,
                        'admin',
                        NULL, -- 모든 관리자에게
                        'deposit_request',
                        '새로운 입금 요청',
                        format('회원 %s님이 %s원 입금을 신청했습니다.', 
                               msg_record.message_data->>'username',
                               msg_record.message_data->>'amount'),
                        '/admin/transactions'
                    );
                    
                WHEN 'withdrawal_request' THEN
                    -- 출금 요청 알림 생성
                    PERFORM create_realtime_notification(
                        msg_record.id,
                        'admin',
                        NULL, -- 모든 관리자에게
                        'withdrawal_request',
                        '새로운 출금 요청',
                        format('회원 %s님이 %s원 출금을 신청했습니다.', 
                               msg_record.message_data->>'username',
                               msg_record.message_data->>'amount'),
                        '/admin/transactions'
                    );
                    
                WHEN 'transaction_approved' THEN
                    -- 거래 승인 알림 생성 (사용자에게)
                    PERFORM create_realtime_notification(
                        msg_record.id,
                        'user',
                        msg_record.target_id,
                        'transaction_approved',
                        '거래 승인 완료',
                        format('%s 신청이 승인되었습니다. 금액: %s원', 
                               CASE WHEN msg_record.message_data->>'type' = 'deposit' THEN '입금' ELSE '출금' END,
                               msg_record.message_data->>'amount'),
                        '/user/profile'
                    );
                    
                WHEN 'transaction_rejected' THEN
                    -- 거래 거절 알림 생성 (사용자에게)
                    PERFORM create_realtime_notification(
                        msg_record.id,
                        'user',
                        msg_record.target_id,
                        'transaction_rejected',
                        '거래 신청 거절',
                        format('%s 신청이 거절되었습니다. 사유: %s', 
                               CASE WHEN msg_record.message_data->>'type' = 'deposit' THEN '입금' ELSE '출금' END,
                               COALESCE(msg_record.message_data->>'reason', '관리자 검토 결과')),
                        '/user/profile'
                    );
                    
                WHEN 'bet_result' THEN
                    -- 베팅 결과 알림 생성
                    PERFORM create_realtime_notification(
                        msg_record.id,
                        'user',
                        msg_record.target_id,
                        'bet_result',
                        '베팅 결과',
                        format('베팅이 완료되었습니다. 결과: %s', 
                               msg_record.message_data->>'result'),
                        '/user/profile'
                    );
                    
                ELSE
                    -- 기본 처리
                    RAISE LOG 'Unknown message type: %', msg_record.message_type;
            END CASE;
            
            -- 처리 완료로 상태 변경
            UPDATE message_queue 
            SET status = 'completed',
                processed_at = NOW(),
                updated_at = NOW()
            WHERE id = msg_record.id;
            
            processed := processed + 1;
            
        EXCEPTION WHEN OTHERS THEN
            error_msg := SQLERRM;
            
            -- 실패 처리
            UPDATE message_queue 
            SET status = CASE 
                    WHEN attempts >= max_attempts THEN 'failed'
                    ELSE 'pending'
                END,
                failed_at = CASE 
                    WHEN attempts >= max_attempts THEN NOW()
                    ELSE NULL
                END,
                error_message = error_msg,
                scheduled_at = CASE 
                    WHEN attempts < max_attempts THEN NOW() + INTERVAL '5 minutes'
                    ELSE scheduled_at
                END,
                updated_at = NOW()
            WHERE id = msg_record.id;
            
            RAISE LOG 'Message processing failed: % - Error: %', msg_record.id, error_msg;
        END;
    END LOOP;
    
    processed_count := processed;
    RETURN NEXT;
END;
$$;

-- 실시간 알림 생성 함수
CREATE OR REPLACE FUNCTION create_realtime_notification(
    p_message_queue_id UUID,
    p_recipient_type VARCHAR(20),
    p_recipient_id UUID, -- NULL for all admins
    p_notification_type VARCHAR(50),
    p_title VARCHAR(200),
    p_content TEXT,
    p_action_url VARCHAR(500) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    notification_id UUID;
    admin_record RECORD;
BEGIN
    IF p_recipient_type = 'admin' AND p_recipient_id IS NULL THEN
        -- 모든 관리자에게 알림 전송
        FOR admin_record IN 
            SELECT id FROM partners 
            WHERE status = 'active' 
            AND level <= 7 -- 관리자 레벨만
        LOOP
            INSERT INTO realtime_notifications (
                message_queue_id, recipient_type, recipient_id,
                notification_type, title, content, action_url
            ) VALUES (
                p_message_queue_id, 'admin', admin_record.id,
                p_notification_type, p_title, p_content, p_action_url
            ) RETURNING id INTO notification_id;
        END LOOP;
    ELSE
        -- 특정 수신자에게 알림 전송
        INSERT INTO realtime_notifications (
            message_queue_id, recipient_type, recipient_id,
            notification_type, title, content, action_url
        ) VALUES (
            p_message_queue_id, p_recipient_type, p_recipient_id,
            p_notification_type, p_title, p_content, p_action_url
        ) RETURNING id INTO notification_id;
    END IF;
    
    RETURN notification_id;
END;
$$;

-- 메시지 큐에 메시지 추가 함수
CREATE OR REPLACE FUNCTION add_to_message_queue(
    p_message_type VARCHAR(50),
    p_sender_type VARCHAR(20),
    p_sender_id UUID,
    p_target_type VARCHAR(20),
    p_target_id UUID,
    p_subject VARCHAR(200),
    p_message_data JSONB,
    p_reference_type VARCHAR(50) DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_priority INTEGER DEFAULT 5
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    queue_id UUID;
BEGIN
    INSERT INTO message_queue (
        message_type, sender_type, sender_id,
        target_type, target_id, subject, message_data,
        reference_type, reference_id, priority
    ) VALUES (
        p_message_type, p_sender_type, p_sender_id,
        p_target_type, p_target_id, p_subject, p_message_data,
        p_reference_type, p_reference_id, p_priority
    ) RETURNING id INTO queue_id;
    
    RETURN queue_id;
END;
$$;

-- 사용자별 읽지 않은 알림 수 조회 함수
CREATE OR REPLACE FUNCTION get_unread_notifications_count(
    p_recipient_type VARCHAR(20),
    p_recipient_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    unread_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO unread_count
    FROM realtime_notifications
    WHERE recipient_type = p_recipient_type
    AND recipient_id = p_recipient_id
    AND status IN ('pending', 'sent', 'delivered')
    AND created_at > NOW() - INTERVAL '7 days'; -- 최근 7일간
    
    RETURN COALESCE(unread_count, 0);
END;
$$;

-- 알림 읽음 처리 함수
DROP FUNCTION IF EXISTS mark_notification_as_read(uuid,uuid);
CREATE OR REPLACE FUNCTION mark_notification_as_read(
    p_notification_id UUID,
    p_recipient_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE realtime_notifications
    SET status = 'read',
        read_at = NOW(),
        updated_at = NOW()
    WHERE id = p_notification_id
    AND recipient_id = p_recipient_id
    AND status != 'read';
    
    RETURN FOUND;
END;
$$;

-- 메시지 큐 정리 함수 (오래된 메시지 삭제)
CREATE OR REPLACE FUNCTION cleanup_message_queue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- 30일 이상 된 완료/실패 메시지 삭제
    WITH deleted AS (
        DELETE FROM message_queue
        WHERE (status IN ('completed', 'failed') AND created_at < NOW() - INTERVAL '30 days')
        OR (expires_at IS NOT NULL AND expires_at < NOW())
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;
    
    -- 7일 이상 된 읽은 알림 삭제
    DELETE FROM realtime_notifications
    WHERE status = 'read' 
    AND read_at < NOW() - INTERVAL '7 days';
    
    RETURN deleted_count;
END;
$$;

-- 트리거: transactions 테이블에 새 레코드 삽입 시 메시지 큐에 알림 추가
CREATE OR REPLACE FUNCTION trigger_transaction_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_data RECORD;
    message_data JSONB;
BEGIN
    -- 사용자 정보 조회
    SELECT username, nickname INTO user_data
    FROM users WHERE id = NEW.user_id;
    
    -- 메시지 데이터 구성
    message_data := jsonb_build_object(
        'transaction_id', NEW.id,
        'user_id', NEW.user_id,
        'username', user_data.username,
        'nickname', user_data.nickname,
        'type', NEW.transaction_type,
        'amount', NEW.amount,
        'status', NEW.status,
        'bank_name', NEW.bank_name,
        'bank_account', NEW.bank_account,
        'bank_holder', NEW.bank_holder
    );
    
    -- 새로운 입출금 요청인 경우
    IF NEW.status = 'pending' AND OLD IS NULL THEN
        PERFORM add_to_message_queue(
            NEW.transaction_type || '_request',
            'user',
            NEW.user_id,
            'admin',
            NULL, -- 모든 관리자에게
            format('새로운 %s 요청', CASE WHEN NEW.transaction_type = 'deposit' THEN '입금' ELSE '출금' END),
            message_data,
            'transaction',
            NEW.id,
            3 -- 높은 우선순위
        );
    END IF;
    
    -- 상태 변경 알림 (승인/거절)
    IF OLD IS NOT NULL AND OLD.status = 'pending' AND NEW.status IN ('completed', 'rejected') THEN
        message_data := message_data || jsonb_build_object(
            'previous_status', OLD.status,
            'reason', NEW.memo
        );
        
        PERFORM add_to_message_queue(
            'transaction_' || NEW.status,
            'admin',
            NEW.processed_by,
            'user',
            NEW.user_id,
            format('%s %s', 
                   CASE WHEN NEW.transaction_type = 'deposit' THEN '입금' ELSE '출금' END,
                   CASE WHEN NEW.status = 'completed' THEN '승인' ELSE '거절' END),
            message_data,
            'transaction',
            NEW.id,
            2 -- 매우 높은 우선순위
        );
    END IF;
    
    RETURN NEW;
END;
$$;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_transaction_notification ON transactions;
CREATE TRIGGER trigger_transaction_notification
    AFTER INSERT OR UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_transaction_notification();

-- RLS 정책 설정
ALTER TABLE message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_notifications ENABLE ROW LEVEL SECURITY;

-- message_queue RLS 정책
CREATE POLICY "message_queue_admin_access" ON message_queue
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM partners 
            WHERE id = auth.uid() 
            AND status = 'active'
            AND level <= 7
        )
    );

-- notification_settings RLS 정책  
CREATE POLICY "notification_settings_owner_access" ON notification_settings
    FOR ALL USING (
        user_id = auth.uid() OR 
        partner_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM partners 
            WHERE id = auth.uid() 
            AND status = 'active'
            AND level <= 7
        )
    );

-- realtime_notifications RLS 정책
CREATE POLICY "realtime_notifications_recipient_access" ON realtime_notifications
    FOR ALL USING (
        recipient_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM partners 
            WHERE id = auth.uid() 
            AND status = 'active'
            AND level <= 7
        )
    );

-- 메시지 큐 자동 처리를 위한 pg_cron 설정 (선택사항, 확장이 설치된 경우에만)
-- SELECT cron.schedule('process-message-queue', '*/1 * * * *', 'SELECT process_message_queue();');
-- SELECT cron.schedule('cleanup-message-queue', '0 2 * * *', 'SELECT cleanup_message_queue();');

COMMENT ON TABLE message_queue IS '메시지 큐 시스템 - 실시간 알림 및 트랜잭션 처리';
COMMENT ON TABLE notification_settings IS '사용자별 알림 설정';
COMMENT ON TABLE realtime_notifications IS '실시간 알림 로그';