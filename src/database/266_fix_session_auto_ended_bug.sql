-- ============================================================================
-- 266. 세션 시작하자마자 ended 되는 버그 수정
-- ============================================================================
-- 작성일: 2025-01-18
-- 목적: save_game_launch_session 함수가 세션을 active로 생성했는데도
--       즉시 ended가 되는 버그를 수정
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '266. 세션 자동 종료 버그 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 함수 완전 제거
-- ============================================

DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 save_game_launch_session 함수 제거 완료';
END $$;

-- ============================================
-- 2단계: 새로운 save_game_launch_session 함수 생성
-- ============================================
-- 중요: 세션을 생성하거나 재활성화할 때 status는 무조건 'active'
--       ended_at는 무조건 NULL로 설정
-- ============================================

CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id BIGINT,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token VARCHAR(255) DEFAULT NULL,
    p_balance_before DECIMAL(15,2) DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_session_id BIGINT;
    v_partner_id UUID;
    v_random_session_id TEXT;
    v_existing_session RECORD;
BEGIN
    -- 사용자의 partner_id 조회
    SELECT referrer_id INTO v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    IF v_partner_id IS NULL THEN
        RAISE WARNING '⚠️ 사용자 %의 referrer_id가 NULL입니다', p_user_id;
    END IF;
    
    -- 30분 이내 같은 user_id + game_id의 ended 세션 찾기
    SELECT id, session_id INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND status = 'ended'
    AND (ended_at > NOW() - INTERVAL '30 minutes' OR launched_at > NOW() - INTERVAL '30 minutes')
    ORDER BY COALESCE(ended_at, launched_at) DESC
    LIMIT 1;
    
    -- 기존 세션이 있으면 재활성화
    IF v_existing_session.id IS NOT NULL THEN
        UPDATE game_launch_sessions
        SET 
            status = 'active',              -- 무조건 active
            ended_at = NULL,                -- 무조건 NULL
            last_activity_at = NOW(),
            launch_url = p_launch_url,
            session_token = p_session_token,
            launched_at = NOW()             -- 재활성화 시 launched_at도 갱신
        WHERE id = v_existing_session.id;
        
        -- 타이머 생성 (4분 후 종료 예정)
        INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
        VALUES (v_existing_session.id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes')
        ON CONFLICT (session_id) DO UPDATE SET
            last_betting_at = NOW(),
            scheduled_end_at = NOW() + INTERVAL '4 minutes',
            is_cancelled = FALSE,
            updated_at = NOW();
        
        RAISE NOTICE '🔄 세션 재활성화: db_id=%, session_id=%, status=active, ended_at=NULL', 
            v_existing_session.id, v_existing_session.session_id;
        
        RETURN v_existing_session.id;
    END IF;
    
    -- 기존 세션이 없으면 새로 생성
    v_random_session_id := substring(md5(random()::text || clock_timestamp()::text) from 1 for 16);
    
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        balance_before,
        launched_at,
        ended_at,                       -- 무조건 NULL
        status,                         -- 무조건 'active'
        last_activity_at,
        partner_id,
        session_id
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        COALESCE(p_balance_before, 0),
        NOW(),
        NULL,                           -- ended_at는 NULL
        'active',                       -- status는 active
        NOW(),
        v_partner_id,
        v_random_session_id
    ) RETURNING id INTO v_session_id;
    
    -- 타이머 생성 (4분 후 종료 예정)
    INSERT INTO session_timers (session_id, user_id, game_id, last_betting_at, scheduled_end_at)
    VALUES (v_session_id, p_user_id, p_game_id, NOW(), NOW() + INTERVAL '4 minutes');
    
    RAISE NOTICE '✅ 새 세션 생성: db_id=%, session_id=%, status=active, ended_at=NULL', 
        v_session_id, v_random_session_id;
    
    RETURN v_session_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ save_game_launch_session 오류: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE '✅ save_game_launch_session 함수 재생성 완료';
END $$;

-- ============================================
-- 3단계: 혹시 모를 트리거 확인 및 제거
-- ============================================

-- game_launch_sessions 테이블의 INSERT/UPDATE 트리거 중
-- 자동으로 ended로 바꾸는 트리거가 있는지 확인

DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE '📋 game_launch_sessions 테이블의 트리거 목록:';
    
    FOR r IN 
        SELECT tgname, pg_get_triggerdef(oid) as definition
        FROM pg_trigger
        WHERE tgrelid = 'game_launch_sessions'::regclass
        AND tgname NOT LIKE 'pg_%'
    LOOP
        RAISE NOTICE '  - %: %', r.tgname, r.definition;
    END LOOP;
END $$;

-- ============================================
-- 4단계: 검증
-- ============================================

DO $$
DECLARE
    v_function_exists BOOLEAN;
    v_definition TEXT;
BEGIN
    -- 함수 존재 확인
    SELECT EXISTS (
        SELECT 1 
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.proname = 'save_game_launch_session'
    ) INTO v_function_exists;
    
    IF v_function_exists THEN
        RAISE NOTICE '✅ save_game_launch_session 함수 존재 확인';
    ELSE
        RAISE WARNING '❌ save_game_launch_session 함수가 존재하지 않습니다!';
    END IF;
    
    -- 함수 정의 확인
    SELECT pg_get_functiondef(p.oid) INTO v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'save_game_launch_session';
    
    IF v_definition LIKE '%status = ''active''%' AND v_definition LIKE '%ended_at = NULL%' THEN
        RAISE NOTICE '✅ 함수 정의 검증 완료: status=active, ended_at=NULL 확인';
    ELSE
        RAISE WARNING '❌ 함수 정의가 예상과 다릅니다!';
    END IF;
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 266. 세션 자동 종료 버그 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '수정 사항:';
    RAISE NOTICE '1. ✅ save_game_launch_session 함수 완전 재생성';
    RAISE NOTICE '2. ✅ 세션 생성/재활성화 시 status=active, ended_at=NULL 보장';
    RAISE NOTICE '3. ✅ 트리거 목록 확인 완료';
    RAISE NOTICE '';
    RAISE NOTICE '📌 테스트 방법:';
    RAISE NOTICE '  - 게임 실행 시 세션이 active 상태로 생성되는지 확인';
    RAISE NOTICE '  - ended_at이 NULL인지 확인';
    RAISE NOTICE '  - 세션이 즉시 ended로 바뀌지 않는지 확인';
    RAISE NOTICE '============================================';
END $$;
