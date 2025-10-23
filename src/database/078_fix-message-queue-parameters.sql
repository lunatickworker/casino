-- add_to_message_queue 함수 매개변수 완전 수정
-- 기존 함수 완전 삭제 후 재생성으로 PGRST202 오류 해결

DO $$
BEGIN
    -- 1. 기존 함수 모든 오버로드 삭제
    DROP FUNCTION IF EXISTS add_to_message_queue CASCADE;
    RAISE NOTICE '✓ 기존 add_to_message_queue 함수 완전 삭제';
END $$;

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
    IF p_message_type IS NULL OR LENGTH(TRIM(p_message_type)) = 0 THEN
        RAISE EXCEPTION 'message_type cannot be null or empty';
    END IF;
    
    IF p_sender_type IS NULL OR LENGTH(TRIM(p_sender_type)) = 0 THEN
        RAISE EXCEPTION 'sender_type cannot be null or empty';
    END IF;
    
    IF p_sender_id IS NULL THEN
        RAISE EXCEPTION 'sender_id cannot be null';
    END IF;
    
    IF p_target_type IS NULL OR LENGTH(TRIM(p_target_type)) = 0 THEN
        RAISE EXCEPTION 'target_type cannot be null or empty';
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
        COALESCE(p_subject, p_message_type || ' 메시지'),
        COALESCE(p_message_data, '{}'::jsonb),
        p_reference_type,
        p_reference_id,
        scheduled_time,
        NOW()
    ) RETURNING id INTO message_id;
    
    RAISE NOTICE 'Message queue entry created: % (priority: %)', message_id, p_priority;
    
    RETURN message_id;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to add message to queue: %', SQLERRM;
END;
$$;

-- 3. 함수 권한 설정
GRANT EXECUTE ON FUNCTION add_to_message_queue TO authenticated;
GRANT EXECUTE ON FUNCTION add_to_message_queue TO anon;

-- 4. 함수 테스트
DO $$
DECLARE
    test_result UUID;
BEGIN
    -- 테스트 메시지 생성
    SELECT add_to_message_queue(
        'test_message',           -- p_message_type
        'admin',                  -- p_sender_type
        '11111111-1111-1111-1111-111111111111'::UUID,  -- p_sender_id
        'user',                   -- p_target_type
        '22222222-2222-2222-2222-222222222222'::UUID,  -- p_target_id
        'Test Subject',           -- p_subject
        '{"test": "data"}'::JSONB, -- p_message_data
        'test',                   -- p_reference_type
        '33333333-3333-3333-3333-333333333333'::UUID,  -- p_reference_id
        5                         -- p_priority
    ) INTO test_result;
    
    IF test_result IS NOT NULL THEN
        RAISE NOTICE '✓ 함수 테스트 성공: %', test_result;
        
        -- 테스트 데이터 삭제
        DELETE FROM message_queue WHERE id = test_result;
        RAISE NOTICE '✓ 테스트 데이터 삭제 완료';
    ELSE
        RAISE NOTICE '⚠ 함수 테스트 실패';
    END IF;
END $$;

-- 5. 함수 시그니처 확인
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'add_to_message_queue' 
        AND specific_schema = 'public'
        AND routine_type = 'FUNCTION'
    ) THEN
        RAISE NOTICE '✓ add_to_message_queue 함수 생성 및 등록 완료';
        RAISE NOTICE '함수 매개변수 순서: p_message_type, p_sender_type, p_sender_id, p_target_type, p_target_id, p_subject, p_message_data, p_reference_type, p_reference_id, p_priority';
    ELSE
        RAISE NOTICE '⚠ add_to_message_queue 함수 생성 실패';
    END IF;
END $$;