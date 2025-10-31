-- =====================================================
-- 320. 세션 종료 시 보유금 자동 동기화 트리거
-- =====================================================
-- 작성일: 2025-01-29
-- 목적: 
--   세션이 종료될 때 (ended/force_ended/auto_ended)
--   해당 사용자의 보유금을 API로 동기화하여 정확성 보장
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '320. 세션 종료 시 보유금 동기화 트리거';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 1단계: 세션 종료 시 보유금 동기화 함수
-- ============================================

CREATE OR REPLACE FUNCTION sync_balance_on_session_end()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    v_username TEXT;
    v_opcode TEXT;
    v_api_config RECORD;
    v_signature TEXT;
    v_api_url TEXT;
    v_proxy_url TEXT := 'https://vi8282.com/proxy';
    v_response JSONB;
    v_balance NUMERIC;
BEGIN
    -- 세션이 종료되는 경우만 처리 (active → ended/force_ended/auto_ended)
    IF OLD.status = 'active' AND NEW.status IN ('ended', 'force_ended', 'auto_ended') THEN
        RAISE NOTICE '💰 [세션 종료 감지] session_id=%, status=% → %', 
            NEW.id, OLD.status, NEW.status;

        -- 사용자 정보 조회 (users + partners JOIN)
        SELECT 
            u.username,
            p.opcode
        INTO v_username, v_opcode
        FROM users u
        LEFT JOIN partners p ON u.referrer_id = p.id
        WHERE u.id = NEW.user_id;

        IF v_username IS NULL THEN
            RAISE WARNING '⚠️ [보유금 동기화 스킵] username 없음';
            RETURN NEW;
        END IF;

        IF v_opcode IS NULL THEN
            RAISE WARNING '⚠️ [보유금 동기화 스킵] opcode 없음 (referrer_id 또는 partner 설정 확인 필요)';
            RETURN NEW;
        END IF;

        -- API 설정 조회 (partners 테이블에서)
        SELECT 
            api_token as token,
            secret_key
        INTO v_api_config
        FROM partners
        WHERE opcode = v_opcode
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE WARNING '⚠️ [보유금 동기화 스킵] API 설정 없음: opcode=%', v_opcode;
            RETURN NEW;
        END IF;

        IF v_api_config.token IS NULL OR v_api_config.secret_key IS NULL THEN
            RAISE WARNING '⚠️ [보유금 동기화 스킵] API 설정 불완전: opcode=%', v_opcode;
            RETURN NEW;
        END IF;

        -- Signature 생성: md5(opcode + username + token + secret_key)
        v_signature := md5(v_opcode || v_username || v_api_config.token || v_api_config.secret_key);

        RAISE NOTICE '📡 [API 호출] username=%, opcode=%', v_username, v_opcode;

        -- API 호출 (Proxy 경유)
        BEGIN
            SELECT content INTO v_response
            FROM http((
                'POST',
                v_proxy_url,
                ARRAY[
                    http_header('Content-Type', 'application/json')
                ],
                'application/json',
                jsonb_build_object(
                    'url', 'https://api.invest-ho.com/api/account/balance',
                    'method', 'GET',
                    'headers', jsonb_build_object(
                        'Content-Type', 'application/json'
                    ),
                    'body', jsonb_build_object(
                        'opcode', v_opcode,
                        'username', v_username,
                        'token', v_api_config.token,
                        'signature', v_signature
                    )
                )::text
            )::http_request);

            -- 응답에서 balance 추출
            IF v_response ? 'balance' THEN
                v_balance := (v_response->>'balance')::NUMERIC;

                -- DB 업데이트
                UPDATE users
                SET 
                    balance = v_balance,
                    last_synced_at = NOW()
                WHERE id = NEW.user_id;

                RAISE NOTICE '✅ [보유금 동기화 완료] username=%, balance=%', v_username, v_balance;
            ELSE
                RAISE WARNING '⚠️ [API 응답 오류] balance 필드 없음: %', v_response;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '❌ [API 호출 오류] %: %', SQLERRM, SQLSTATE;
        END;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sync_balance_on_session_end() IS
'세션이 종료될 때 (active → ended/force_ended/auto_ended) 사용자 보유금을 API로 동기화.
중복 호출 방지를 위해 OLD.status = active 조건 확인.';

DO $$
BEGIN
    RAISE NOTICE '✅ sync_balance_on_session_end() 함수 생성 완료';
END $$;

-- ============================================
-- 2단계: 트리거 생성
-- ============================================

DROP TRIGGER IF EXISTS trigger_sync_balance_on_session_end ON game_launch_sessions;

CREATE TRIGGER trigger_sync_balance_on_session_end
    AFTER UPDATE ON game_launch_sessions
    FOR EACH ROW
    WHEN (OLD.status = 'active' AND NEW.status IN ('ended', 'force_ended', 'auto_ended'))
    EXECUTE FUNCTION sync_balance_on_session_end();

DO $$
BEGIN
    RAISE NOTICE '✅ trigger_sync_balance_on_session_end 트리거 생성 완료';
END $$;

-- ============================================
-- 3단계: http extension 확인
-- ============================================

DO $$
BEGIN
    -- http extension이 설치되어 있는지 확인
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'http') THEN
        RAISE EXCEPTION '❌ http extension이 설치되지 않았습니다. Supabase Dashboard에서 활성화하세요.';
    ELSE
        RAISE NOTICE '✅ http extension 확인 완료';
    END IF;
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 320. 세션 종료 시 보유금 동기화 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📊 구현 내용:';
    RAISE NOTICE '  1. ✅ sync_balance_on_session_end() 함수 생성';
    RAISE NOTICE '  2. ✅ trigger_sync_balance_on_session_end 트리거 생성';
    RAISE NOTICE '  3. ✅ http extension 확인';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 동작 방식:';
    RAISE NOTICE '  • 세션 status: active → ended/force_ended/auto_ended';
    RAISE NOTICE '  • API 호출: GET /api/account/balance';
    RAISE NOTICE '  • Proxy 경유: https://vi8282.com/proxy';
    RAISE NOTICE '  • DB 업데이트: users.balance, last_synced_at';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ 주의사항:';
    RAISE NOTICE '  • http extension이 활성화되어 있어야 합니다';
    RAISE NOTICE '  • partners 테이블에 API 설정(opcode, api_token, secret_key)이 있어야 합니다';
    RAISE NOTICE '  • username과 opcode가 필수입니다';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 테스트 방법:';
    RAISE NOTICE '  UPDATE game_launch_sessions';
    RAISE NOTICE '  SET status = ''ended'', ended_at = NOW()';
    RAISE NOTICE '  WHERE id = (세션ID) AND status = ''active'';';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
