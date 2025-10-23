-- add_to_message_queue 함수 매개변수 순서 수정
-- PGRST202 오류 해결

-- 1. 기존 함수 삭제 후 올바른 매개변수 순서로 재생성
DROP FUNCTION IF EXISTS add_to_message_queue(VARCHAR, VARCHAR, UUID, VARCHAR, UUID, VARCHAR, JSONB, VARCHAR, UUID, INTEGER);
DROP FUNCTION IF EXISTS add_to_message_queue(VARCHAR, VARCHAR, UUID, VARCHAR, VARCHAR, JSONB, VARCHAR, UUID, INTEGER);

-- 2. 올바른 매개변수 순서로 함수 재생성
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
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    message_id UUID;
    scheduled_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- 매개변수 유효성 검사
    IF p_message_type IS NULL OR p_sender_type IS NULL OR p_sender_id IS NULL OR p_target_type IS NULL THEN
        RAISE EXCEPTION 'Required parameters cannot be null';
    END IF;
    
    -- 스케줄링 시간 계산 (우선순위에 따라)
    scheduled_time := NOW() + INTERVAL '1 second' * CASE 
        WHEN p_priority <= 3 THEN 0  -- 즉시
        WHEN p_priority <= 5 THEN 5  -- 5초 후
        ELSE 30                      -- 30초 후
    END;
    
    -- 메시지 큐에 추가
    INSERT INTO message_queue (
        message_type,
        priority,
        status,
        sender_type,
        sender_id,
        target_type,
        target_id,
        subject,
        message_data,
        reference_type,
        reference_id,
        scheduled_at,
        created_at
    ) VALUES (
        p_message_type,
        p_priority,
        'pending',
        p_sender_type,
        p_sender_id,
        p_target_type,
        p_target_id,
        p_subject,
        p_message_data,
        p_reference_type,
        p_reference_id,
        scheduled_time,
        NOW()
    ) RETURNING id INTO message_id;
    
    RETURN message_id;
END;
$$;

-- 3. 함수 권한 설정
GRANT EXECUTE ON FUNCTION add_to_message_queue TO authenticated;
GRANT EXECUTE ON FUNCTION add_to_message_queue TO anon;

-- 4. 함수 생성 확인
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'add_to_message_queue' 
        AND specific_schema = 'public'
    ) THEN
        RAISE NOTICE '✓ add_to_message_queue 함수 생성 완료';
    ELSE
        RAISE NOTICE '⚠ add_to_message_queue 함수 생성 실패';
    END IF;
END $$;