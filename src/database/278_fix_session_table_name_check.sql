-- ============================================================================
-- 278. Session 체크 테이블 이름 수정 및 디버깅
-- ============================================================================
-- 작성일: 2025-10-18
-- 목적: game_launch_sessions 테이블 이름 확인 및 수정
-- ============================================================================

-- ============================================
-- 1단계: 현재 테이블 이름 확인
-- ============================================

DO $$
DECLARE
    v_table_exists_sessions BOOLEAN;
    v_table_exists_session BOOLEAN;
    v_correct_table_name TEXT;
BEGIN
    -- game_launch_sessions (복수형) 확인
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'game_launch_sessions'
    ) INTO v_table_exists_sessions;
    
    -- game_launch_session (단수형) 확인
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'game_launch_session'
    ) INTO v_table_exists_session;
    
    RAISE NOTICE '';
    RAISE NOTICE '======================================';
    RAISE NOTICE '📊 테이블 존재 여부 확인';
    RAISE NOTICE '======================================';
    RAISE NOTICE 'game_launch_sessions (복수형): %', 
        CASE WHEN v_table_exists_sessions THEN '✅ 존재' ELSE '❌ 없음' END;
    RAISE NOTICE 'game_launch_session (단수형): %', 
        CASE WHEN v_table_exists_session THEN '✅ 존재' ELSE '❌ 없음' END;
    RAISE NOTICE '';
    
    -- 올바른 테이블 이름 결정
    IF v_table_exists_sessions THEN
        v_correct_table_name := 'game_launch_sessions';
    ELSIF v_table_exists_session THEN
        v_correct_table_name := 'game_launch_session';
    ELSE
        RAISE EXCEPTION '❌ game_launch_session 관련 테이블을 찾을 수 없습니다!';
    END IF;
    
    RAISE NOTICE '✅ 사용할 테이블 이름: %', v_correct_table_name;
    RAISE NOTICE '';
END $$;

-- ============================================
-- 2단계: save_betting_records_batch 함수 수정
-- ============================================

DROP FUNCTION IF EXISTS save_betting_records_batch(JSONB);

CREATE OR REPLACE FUNCTION save_betting_records_batch(
    p_records JSONB
)
RETURNS TABLE (
    success_count INTEGER,
    error_count INTEGER,
    errors JSONB,
    balance_updates_count INTEGER
) AS $$
DECLARE
    v_record JSONB;
    v_success_count INTEGER := 0;
    v_error_count INTEGER := 0;
    v_balance_updates_count INTEGER := 0;
    v_errors JSONB := '[]'::JSONB;
    v_user_uuid UUID;
    v_partner_id UUID;
    v_username TEXT;
    v_txid BIGINT;
    v_game_id INTEGER;
    v_provider_id INTEGER;
    v_bet_amount DECIMAL(15,2);
    v_win_amount DECIMAL(15,2);
    v_balance DECIMAL(15,2);
    v_round_id TEXT;
    v_game_name TEXT;
    v_action_type TEXT;
    v_played_at TIMESTAMPTZ;
    v_old_balance DECIMAL(15,2);
    v_has_active_session BOOLEAN;
    v_session_table_name TEXT;
BEGIN
    -- 테이블 이름 동적 결정
    SELECT CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'game_launch_sessions'
        ) THEN 'game_launch_sessions'
        WHEN EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'game_launch_session'
        ) THEN 'game_launch_session'
        ELSE NULL
    END INTO v_session_table_name;
    
    IF v_session_table_name IS NULL THEN
        RAISE EXCEPTION '❌ game_launch_session 테이블을 찾을 수 없습니다!';
    END IF;
    
    -- 배열로 전달된 각 레코드 처리
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            -- ===== Invest API 필드 정확한 매핑 (소문자 snake_case) =====
            
            -- TX ID (id 필드)
            v_txid := COALESCE(
                (v_record->>'id')::BIGINT,
                (v_record->>'txid')::BIGINT
            );
            
            -- 사용자명 (username 필드)
            v_username := COALESCE(
                v_record->>'username',
                v_record->>'user_id'
            );
            
            -- 게임 ID (game_id 필드)
            v_game_id := COALESCE(
                (v_record->>'game_id')::INTEGER,
                (v_record->>'game')::INTEGER
            );
            
            -- 게임명 (game_title 필드) - API에서 직접 제공
            v_game_name := COALESCE(
                v_record->>'game_title',
                v_record->>'game_name'
            );
            
            -- Provider ID (provider_id 필드 또는 game_id / 1000)
            v_provider_id := COALESCE(
                (v_record->>'provider_id')::INTEGER,
                CASE 
                    WHEN v_game_id IS NOT NULL THEN FLOOR(v_game_id / 1000)::INTEGER
                    ELSE NULL
                END
            );
            
            -- 라운드 ID (round_id 필드)
            v_round_id := COALESCE(
                v_record->>'round_id',
                v_record->>'ref_txid'
            );
            
            -- 액션 타입 (tx_type 필드: bet/win)
            v_action_type := COALESCE(
                v_record->>'tx_type',
                v_record->>'type'
            );
            
            -- bet, win, balance 필드 파싱
            v_bet_amount := CASE 
                WHEN v_action_type = 'bet' THEN COALESCE(
                    (v_record->>'bet')::DECIMAL(15,2),
                    0
                )
                ELSE 0
            END;
            
            v_win_amount := CASE 
                WHEN v_action_type = 'win' THEN COALESCE(
                    (v_record->>'win')::DECIMAL(15,2),
                    0
                )
                ELSE 0
            END;
            
            -- 🔥 balance 필드 파싱 (베팅 후 잔고)
            v_balance := COALESCE(
                (v_record->>'balance')::DECIMAL(15,2),
                (v_record->>'new_balance')::DECIMAL(15,2),
                0
            );
            
            -- 생성 시간 (create_at 필드)
            v_played_at := COALESCE(
                (v_record->>'create_at')::TIMESTAMPTZ,
                NOW()
            );
            
            -- 필수 필드 검증
            IF v_txid IS NULL OR v_username IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', 'Missing required fields: id or username'
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- username으로 user UUID 및 partner_id 조회
            SELECT u.id, u.referrer_id, u.balance 
            INTO v_user_uuid, v_partner_id, v_old_balance
            FROM users u
            WHERE u.username = v_username
            LIMIT 1;
            
            -- 사용자 없으면 스킵
            IF v_user_uuid IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', 'User not found: ' || v_username
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- ⭐⭐⭐ 핵심: Active Session 체크 (동적 테이블 이름) ⭐⭐⭐
            IF v_session_table_name = 'game_launch_sessions' THEN
                SELECT EXISTS (
                    SELECT 1 
                    FROM game_launch_sessions 
                    WHERE user_id = v_user_uuid 
                      AND status = 'active'
                    LIMIT 1
                ) INTO v_has_active_session;
            ELSE
                SELECT EXISTS (
                    SELECT 1 
                    FROM game_launch_session 
                    WHERE user_id = v_user_uuid 
                      AND status = 'active'
                    LIMIT 1
                ) INTO v_has_active_session;
            END IF;
            
            -- 게임 자동 생성 (외래키 제약 조건 우회)
            IF v_game_id IS NOT NULL THEN
                -- provider 자동 생성
                IF v_provider_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM game_providers WHERE id = v_provider_id) THEN
                    INSERT INTO game_providers (id, name, type, status, created_at, updated_at)
                    VALUES (
                        v_provider_id, 
                        'Provider ' || v_provider_id, 
                        CASE WHEN v_provider_id >= 400 THEN 'casino' ELSE 'slot' END,
                        'active',
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (id) DO NOTHING;
                END IF;
                
                -- 게임 자동 생성 (API 게임명 사용)
                IF NOT EXISTS (SELECT 1 FROM games WHERE id = v_game_id) THEN
                    INSERT INTO games (id, provider_id, name, type, status, created_at, updated_at)
                    VALUES (
                        v_game_id,
                        v_provider_id,
                        COALESCE(v_game_name, 'Game ' || v_game_id), -- API 게임명 우선
                        CASE WHEN v_provider_id >= 400 THEN 'casino' ELSE 'slot' END,
                        'visible',
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (id) DO NOTHING;
                ELSE
                    -- 기존 게임이 있으면 게임명 업데이트 (API 게임명이 더 정확)
                    IF v_game_name IS NOT NULL THEN
                        UPDATE games 
                        SET name = v_game_name, updated_at = NOW()
                        WHERE id = v_game_id AND (name LIKE 'Game %' OR name IS NULL);
                    END IF;
                END IF;
            END IF;
            
            -- game_records에 저장 (라운드별 bet/win 구분)
            INSERT INTO game_records (
                external_txid,
                user_id,
                partner_id,
                game_id,
                provider_id,
                bet_amount,
                win_amount,
                balance_before,
                balance_after,
                game_round_id,
                external_data,
                played_at,
                sync_status,
                created_at,
                updated_at
            ) VALUES (
                v_txid,
                v_user_uuid,
                v_partner_id,
                v_game_id,
                v_provider_id,
                v_bet_amount,
                v_win_amount,
                CASE 
                    WHEN v_action_type = 'bet' THEN v_balance + v_bet_amount
                    ELSE v_balance - v_win_amount
                END, -- 베팅 전 잔고 역계산
                v_balance, -- 베팅 후 잔고
                v_round_id,
                v_record, -- 원본 데이터 저장
                v_played_at,
                'synced',
                NOW(),
                NOW()
            )
            ON CONFLICT (external_txid, user_id, played_at) 
            DO UPDATE SET
                bet_amount = EXCLUDED.bet_amount,
                win_amount = EXCLUDED.win_amount,
                balance_before = EXCLUDED.balance_before,
                balance_after = EXCLUDED.balance_after,
                external_data = EXCLUDED.external_data,
                sync_status = 'synced',
                updated_at = NOW();
            
            -- ⭐⭐⭐ 핵심 보안: session이 active인 사용자만 잔고 업데이트 ⭐⭐⭐
            IF v_has_active_session AND v_balance > 0 AND v_balance != v_old_balance THEN
                UPDATE users 
                SET 
                    balance = v_balance,
                    updated_at = NOW()
                WHERE id = v_user_uuid;
                
                v_balance_updates_count := v_balance_updates_count + 1;
                
                RAISE NOTICE '💰 [Active Session] 사용자 잔고 업데이트: % (% → %)', 
                    v_username, 
                    v_old_balance, 
                    v_balance;
            ELSIF NOT v_has_active_session AND v_balance != v_old_balance THEN
                -- ⛔ session이 없거나 ended인 경우 경고 로그만 출력
                RAISE WARNING '⛔ [No Active Session] 잔고 업데이트 스킵: % (session 없음 또는 ended)', v_username;
            END IF;
            
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'record', v_record,
                'error', SQLERRM
            );
            v_error_count := v_error_count + 1;
        END;
    END LOOP;
    
    -- 결과 반환
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors, v_balance_updates_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 권한 부여
GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated, anon;

-- 주석
COMMENT ON FUNCTION save_betting_records_batch IS 
'베팅 내역을 저장하고 session이 active인 사용자의 잔고만 자동 업데이트합니다. 
⭐ 보안: session이 ended 또는 없는 사용자의 보유금은 절대 업데이트하지 않습니다.
✅ 테이블 이름 자동 감지: game_launch_sessions 또는 game_launch_session';

-- ============================================
-- 3단계: 디버깅용 조회 쿼리
-- ============================================

DO $$
DECLARE
    v_session_count INTEGER;
    v_active_session_count INTEGER;
    v_ended_session_count INTEGER;
    v_table_name TEXT;
BEGIN
    -- 테이블 이름 확인
    SELECT CASE 
        WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'game_launch_sessions')
        THEN 'game_launch_sessions'
        WHEN EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'game_launch_session')
        THEN 'game_launch_session'
        ELSE NULL
    END INTO v_table_name;
    
    IF v_table_name IS NULL THEN
        RAISE NOTICE '❌ game_launch_session 테이블을 찾을 수 없습니다!';
        RETURN;
    END IF;
    
    -- 세션 통계 조회
    IF v_table_name = 'game_launch_sessions' THEN
        SELECT COUNT(*) INTO v_session_count FROM game_launch_sessions;
        SELECT COUNT(*) INTO v_active_session_count FROM game_launch_sessions WHERE status = 'active';
        SELECT COUNT(*) INTO v_ended_session_count FROM game_launch_sessions WHERE status = 'ended';
    ELSE
        SELECT COUNT(*) INTO v_session_count FROM game_launch_session;
        SELECT COUNT(*) INTO v_active_session_count FROM game_launch_session WHERE status = 'active';
        SELECT COUNT(*) INTO v_ended_session_count FROM game_launch_session WHERE status = 'ended';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '======================================';
    RAISE NOTICE '📊 세션 통계 (테이블: %)', v_table_name;
    RAISE NOTICE '======================================';
    RAISE NOTICE '전체 세션: %', v_session_count;
    RAISE NOTICE 'Active 세션: %', v_active_session_count;
    RAISE NOTICE 'Ended 세션: %', v_ended_session_count;
    RAISE NOTICE '';
END $$;

-- ============================================
-- 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '✅ Session 체크 테이블 이름 수정 완료!';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 수정 사항:';
    RAISE NOTICE '  ✅ 테이블 이름 자동 감지 (복수형/단수형)';
    RAISE NOTICE '  ✅ save_betting_records_batch 함수 업데이트';
    RAISE NOTICE '  ✅ 동적 SQL 없이 조건부 쿼리 사용';
    RAISE NOTICE '';
    RAISE NOTICE '🔒 보안 기능:';
    RAISE NOTICE '  ⭐ session status=active인 사용자만 잔고 업데이트';
    RAISE NOTICE '  ⛔ status=ended: 잔고 업데이트 스킵';
    RAISE NOTICE '  ⛔ session 없음: 잔고 업데이트 스킵';
    RAISE NOTICE '';
    RAISE NOTICE '📋 다음 단계:';
    RAISE NOTICE '  1. 위의 세션 통계 확인';
    RAISE NOTICE '  2. Active 세션이 0이면 정상 (게임 종료됨)';
    RAISE NOTICE '  3. 베팅 기록 저장 시 로그 확인:';
    RAISE NOTICE '     • \"[Active Session] 사용자 잔고 업데이트\" → 정상';
    RAISE NOTICE '     • \"[No Active Session] 잔고 업데이트 스킵\" → 보안 작동';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '';
END $$;
