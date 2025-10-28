-- =====================================================
-- 파일명: 311_consolidate_session_management.sql
-- 작성일: 2025-01-XX
-- 작성자: GMS 개발팀
-- 목적: session_timers 테이블 제거 및 game_launch_sessions로 통합
-- 설명:
--   1. session_timers 테이블 완전 삭제
--   2. game_launch_sessions만 사용하는 간소화된 세션 관리
--   3. launched_at: 게임 실행 시간
--   4. last_activity_at: 베팅/재활성화 시간
--   5. ended_at: 세션 종료 시간
--   6. 스케줄러가 last_activity_at 기준으로 4분 경과 세션 자동 종료
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '🔄 세션 관리 시스템 통합 시작';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 1단계: session_timers 관련 트리거 삭제 (안전하게)
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 1단계: 트리거 삭제 중...';
    
    -- session_timers 테이블이 존재하는 경우에만 트리거 삭제
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'session_timers') THEN
        EXECUTE 'DROP TRIGGER IF EXISTS update_session_timers_updated_at ON session_timers';
        RAISE NOTICE '  → 트리거 삭제 시도 완료';
    ELSE
        RAISE NOTICE '  → session_timers 테이블이 이미 없음, 트리거 삭제 스킵';
    END IF;
    
    RAISE NOTICE '✅ 트리거 삭제 완료';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️ 트리거 삭제 중 무시된 오류: %', SQLERRM;
END $$;

-- ============================================
-- 2단계: session_timers RLS 정책 삭제 (안전하게)
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 2단계: RLS 정책 삭제 중...';
    
    -- session_timers 테이블이 존재하는 경우에만 정책 삭제
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'session_timers') THEN
        EXECUTE 'DROP POLICY IF EXISTS "session_timers_select_policy" ON session_timers';
        EXECUTE 'DROP POLICY IF EXISTS "session_timers_insert_policy" ON session_timers';
        EXECUTE 'DROP POLICY IF EXISTS "session_timers_update_policy" ON session_timers';
        EXECUTE 'DROP POLICY IF EXISTS "session_timers_delete_policy" ON session_timers';
        RAISE NOTICE '  → RLS 정책 삭제 시도 완료';
    ELSE
        RAISE NOTICE '  → session_timers 테이블이 이미 없음, RLS 정책 삭제 스킵';
    END IF;
    
    RAISE NOTICE '✅ RLS 정책 삭제 완료';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️ RLS 정책 삭제 중 무시된 오류: %', SQLERRM;
END $$;

-- ============================================
-- 3단계: session_timers 테이블 삭제
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 3단계: session_timers 테이블 삭제 중...';
END $$;

DROP TABLE IF EXISTS session_timers CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ session_timers 테이블 삭제 완료';
END $$;

-- ============================================
-- 4단계: 간소화된 자동 세션 종료 함수
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 4단계: 자동 세션 종료 함수 재작성 중...';
END $$;

-- 기존 함수 삭제 (반환 타입 변경을 위해)
DROP FUNCTION IF EXISTS execute_scheduled_session_ends();

CREATE OR REPLACE FUNCTION execute_scheduled_session_ends()
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    v_ended_count INTEGER := 0;
    v_session_record RECORD;
BEGIN
    -- 4분간 활동이 없는 active 세션 종료
    FOR v_session_record IN
        SELECT 
            id,
            user_id,
            game_id,
            last_activity_at,
            launched_at
        FROM game_launch_sessions
        WHERE status = 'active'
          AND last_activity_at < NOW() - INTERVAL '4 minutes'
        ORDER BY last_activity_at
        LIMIT 100  -- 한 번에 최대 100개씩 처리
    LOOP
        -- 세션 종료
        UPDATE game_launch_sessions
        SET 
            status = 'ended',
            ended_at = NOW(),
            updated_at = NOW()
        WHERE id = v_session_record.id;
        
        v_ended_count := v_ended_count + 1;
        
        RAISE NOTICE '✅ 세션 종료: session_id=%, user_id=%, 마지막활동=% (% 전)', 
            v_session_record.id,
            v_session_record.user_id,
            v_session_record.last_activity_at,
            AGE(NOW(), v_session_record.last_activity_at);
    END LOOP;
    
    IF v_ended_count > 0 THEN
        RAISE NOTICE '📊 총 % 개 세션 자동 종료됨', v_ended_count;
    END IF;
END;
$$;

COMMENT ON FUNCTION execute_scheduled_session_ends() IS 
'4분간 활동이 없는 active 세션을 자동으로 ended 상태로 변경.
last_activity_at 기준으로 판단하며, 베팅이 계속 들어오면 세션 유지됨.
cron으로 1분마다 실행 권장.';

DO $$
BEGIN
    RAISE NOTICE '✅ 자동 세션 종료 함수 생성 완료';
END $$;

-- ============================================
-- 5단계: save_game_launch_session 함수 업데이트
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 5단계: save_game_launch_session() 함수 업데이트 중...';
END $$;

-- 기존 save_game_launch_session 함수 모든 버전 삭제
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT, VARCHAR, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, BIGINT, VARCHAR, TEXT) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, INTEGER, TEXT, TEXT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, INTEGER, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS save_game_launch_session(UUID, INTEGER, VARCHAR, TEXT, TEXT, NUMERIC) CASCADE;

CREATE OR REPLACE FUNCTION save_game_launch_session(
    p_user_id UUID,
    p_game_id INTEGER,
    p_opcode VARCHAR(50),
    p_launch_url TEXT,
    p_session_token TEXT DEFAULT NULL,
    p_balance_before NUMERIC DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_id BIGINT;
    v_existing_session RECORD;
    v_current_balance NUMERIC;
    v_partner_id UUID;
    v_random_session_id TEXT;
BEGIN
    -- 사용자 현재 보유금 및 partner_id 조회
    SELECT balance, referrer_id INTO v_current_balance, v_partner_id
    FROM users
    WHERE id = p_user_id;
    
    IF v_current_balance IS NULL THEN
        v_current_balance := 0;
    END IF;
    
    -- balance_before가 없으면 현재 보유금 사용
    IF p_balance_before IS NULL THEN
        p_balance_before := v_current_balance;
    END IF;
    
    RAISE NOTICE '💾 [세션 저장] user_id=%, game_id=%, opcode=%, token=%', 
        p_user_id, p_game_id, p_opcode, LEFT(COALESCE(p_session_token, 'NULL'), 20);
    
    -- 동일한 게임의 active 세션 확인
    SELECT * INTO v_existing_session
    FROM game_launch_sessions
    WHERE user_id = p_user_id
      AND game_id = p_game_id
      AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    -- active 세션이 있으면 재활성화
    IF FOUND THEN
        RAISE NOTICE '🔄 [세션 재활성화] 기존 active 세션 발견: session_id=%', v_existing_session.id;
        
        UPDATE game_launch_sessions
        SET 
            session_token = COALESCE(p_session_token, session_token),
            launch_url = p_launch_url,
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE id = v_existing_session.id;
        
        RAISE NOTICE '✅ [세션 재활성화] 완료 - last_activity_at 갱신';
        
        RETURN jsonb_build_object(
            'success', true,
            'session_id', v_existing_session.id,
            'action', 'reactivated'
        );
    END IF;
    
    -- 새 세션 ID 생성
    v_random_session_id := substring(md5(random()::text || clock_timestamp()::text) from 1 for 16);
    
    -- 새 세션 생성
    INSERT INTO game_launch_sessions (
        user_id,
        game_id,
        opcode,
        launch_url,
        session_token,
        status,
        balance_before,
        launched_at,
        last_activity_at,
        partner_id,
        session_id
    ) VALUES (
        p_user_id,
        p_game_id,
        p_opcode,
        p_launch_url,
        p_session_token,
        'active',
        p_balance_before,
        NOW(),
        NOW(),
        v_partner_id,
        v_random_session_id
    )
    RETURNING id INTO v_session_id;
    
    RAISE NOTICE '✅ [세션 생성] 신규 세션 생성 완료: session_id=%', v_session_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'session_id', v_session_id,
        'action', 'created'
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '❌ [세션 저장 오류] %: %', SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION save_game_launch_session(UUID, INTEGER, VARCHAR, TEXT, TEXT, NUMERIC) IS
'게임 실행 시 세션 생성 또는 재활성화.
파라미터: user_id, game_id, opcode, launch_url, session_token(옵션), balance_before(옵션)
- active 세션 있음 → last_activity_at 갱신
- active 세션 없음 → 새 세션 생성 (opcode, partner_id, session_id 포함)
- session_timers 테이블 사용 안함 (통합됨)';

DO $$
BEGIN
    RAISE NOTICE '✅ save_game_launch_session() 함수 업데이트 완료';
END $$;

-- ============================================
-- 6단계: reactivate_session_on_betting 함수 업데이트
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '📌 6단계: reactivate_session_on_betting() 함수 업데이트 중...';
END $$;

-- 기존 reactivate_session_on_betting 함수 모든 버전 삭제
DROP FUNCTION IF EXISTS reactivate_session_on_betting() CASCADE;
DROP FUNCTION IF EXISTS reactivate_session_on_betting(UUID, BIGINT) CASCADE;

CREATE OR REPLACE FUNCTION reactivate_session_on_betting()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id INTEGER;
    v_active_session_id BIGINT;
    v_ended_session_id BIGINT;
    v_ended_session_time TIMESTAMPTZ;
BEGIN
    -- 베팅이 INSERT될 때만 실행
    IF TG_OP != 'INSERT' THEN
        RETURN NEW;
    END IF;
    
    -- provider_id로부터 game_id 계산 (provider_id * 1000)
    v_game_id := NEW.provider_id * 1000;
    
    RAISE NOTICE '🎲 [베팅 감지] user_id=%, provider_id=%, game_id=%', 
        NEW.user_id, NEW.provider_id, v_game_id;
    
    -- 1. active 세션이 있는지 확인
    SELECT id INTO v_active_session_id
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
      AND game_id = v_game_id
      AND status = 'active'
    ORDER BY launched_at DESC
    LIMIT 1;
    
    -- active 세션이 있으면 last_activity_at 갱신
    IF FOUND THEN
        UPDATE game_launch_sessions
        SET 
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE id = v_active_session_id;
        
        RAISE NOTICE '🔄 [베팅→세션 갱신] active 세션 last_activity_at 갱신: session_id=%', 
            v_active_session_id;
        
        RETURN NEW;
    END IF;
    
    -- 2. active 세션이 없으면 ended 세션 확인 (30분 이내)
    SELECT id, ended_at INTO v_ended_session_id, v_ended_session_time
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
      AND game_id = v_game_id
      AND status = 'ended'
      AND ended_at > NOW() - INTERVAL '30 minutes'
    ORDER BY ended_at DESC
    LIMIT 1;
    
    -- ended 세션이 있으면 재활성화
    IF FOUND THEN
        UPDATE game_launch_sessions
        SET 
            status = 'active',
            ended_at = NULL,
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE id = v_ended_session_id;
        
        RAISE NOTICE '♻️ [베팅→세션 재활성화] ended 세션을 active로 전환: session_id=%, 종료시간=%', 
            v_ended_session_id, v_ended_session_time;
    ELSE
        RAISE NOTICE '⚠️ [베팅→세션 없음] 베팅이 있지만 활성 세션 없음 (게임 URL 미발급?)';
    END IF;
    
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    RAISE NOTICE '✅ reactivate_session_on_betting() 함수 업데이트 완료';
END $$;

-- 트리거 재생성
DROP TRIGGER IF EXISTS trigger_reactivate_session_on_betting ON game_records;

CREATE TRIGGER trigger_reactivate_session_on_betting
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION reactivate_session_on_betting();

DO $$
BEGIN
    RAISE NOTICE '✅ 베팅 감지 트리거 재생성 완료';
END $$;

-- ============================================
-- 7단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 세션 관리 시스템 통합 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📊 변경 사항:';
    RAISE NOTICE '  1. ✅ session_timers 테이블 완전 삭제';
    RAISE NOTICE '  2. ✅ execute_scheduled_session_ends() 함수 간소화';
    RAISE NOTICE '  3. ✅ save_game_launch_session() 통합 업데이트';
    RAISE NOTICE '  4. ✅ reactivate_session_on_betting() 통합 업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '📌 새로운 세션 관리 방식:';
    RAISE NOTICE '  • launched_at: 게임 실행 시간';
    RAISE NOTICE '  • last_activity_at: 마지막 활동 시간 (베팅/재실행)';
    RAISE NOTICE '  • ended_at: 세션 종료 시간';
    RAISE NOTICE '  • 스케줄러: last_activity_at < NOW() - 4분 → 자동 종료';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 동작 흐름:';
    RAISE NOTICE '  1. 게임 실행 → save_game_launch_session()';
    RAISE NOTICE '     → last_activity_at = NOW()';
    RAISE NOTICE '  2. 베팅 발생 → reactivate_session_on_betting()';
    RAISE NOTICE '     → last_activity_at = NOW() (갱신)';
    RAISE NOTICE '  3. 4분 경과 → execute_scheduled_session_ends()';
    RAISE NOTICE '     → status = ended, ended_at = NOW()';
    RAISE NOTICE '';
    RAISE NOTICE '⚙️ Cron 설정 (Supabase Dashboard):';
    RAISE NOTICE '  SELECT cron.schedule(';
    RAISE NOTICE '    ''auto-end-inactive-sessions'',';
    RAISE NOTICE '    ''*/1 * * * *'',  -- 1분마다';
    RAISE NOTICE '    $BODY$SELECT execute_scheduled_session_ends()$BODY$';
    RAISE NOTICE '  );';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
