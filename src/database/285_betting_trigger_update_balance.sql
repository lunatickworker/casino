-- ============================================================================
-- 285. 베팅 내역 INSERT/UPDATE 시 사용자 보유금 자동 업데이트 트리거
-- ============================================================================
-- 작성일: 2025-10-19
-- 목적: 
--   - 세션에 active만 있을 때 수동으로 베팅 내역을 업데이트하면 사용자 보유금도 자동 업데이트
--   - game_records INSERT/UPDATE 모두 처리
--   - balance_after 값으로 users.balance 자동 동기화
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '285. 베팅 트리거로 사용자 보유금 자동 업데이트';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 트리거 제거
-- ============================================

DROP TRIGGER IF EXISTS trigger_update_user_balance_on_betting_insert ON game_records CASCADE;
DROP TRIGGER IF EXISTS trigger_update_user_balance_on_betting_update ON game_records CASCADE;
DROP FUNCTION IF EXISTS update_user_balance_from_betting() CASCADE;

DO $$
BEGIN
    RAISE NOTICE '✅ 기존 트리거/함수 제거 완료';
END $$;

-- ============================================
-- 2단계: 트리거 함수 생성
-- ============================================

CREATE OR REPLACE FUNCTION update_user_balance_from_betting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_username TEXT;
    v_old_balance DECIMAL(15,2);
    v_new_balance DECIMAL(15,2);
    v_active_session_count INTEGER;
BEGIN
    -- balance_after 값이 없으면 처리 안 함
    IF NEW.balance_after IS NULL OR NEW.balance_after <= 0 THEN
        RAISE NOTICE '⏭️ [베팅 트리거] balance_after 없음 또는 0 이하, 스킵';
        RETURN NEW;
    END IF;
    
    -- user_id가 없으면 처리 안 함
    IF NEW.user_id IS NULL THEN
        RAISE NOTICE '⏭️ [베팅 트리거] user_id 없음, 스킵';
        RETURN NEW;
    END IF;
    
    -- 현재 사용자의 active 세션 개수 확인
    SELECT COUNT(*) INTO v_active_session_count
    FROM game_launch_sessions
    WHERE user_id = NEW.user_id
    AND status = 'active';
    
    -- active 세션이 없으면 보유금 업데이트 안 함 (사용자가 게임 중이 아님)
    IF v_active_session_count = 0 THEN
        RAISE NOTICE '⏭️ [베팅 트리거] active 세션 없음 (사용자 게임 중 아님), 보유금 업데이트 스킵';
        RETURN NEW;
    END IF;
    
    -- 사용자 현재 잔고 조회
    SELECT username, balance INTO v_username, v_old_balance
    FROM users
    WHERE id = NEW.user_id;
    
    IF v_username IS NULL THEN
        RAISE WARNING '❌ [베팅 트리거] 사용자를 찾을 수 없음: user_id=%', NEW.user_id;
        RETURN NEW;
    END IF;
    
    v_new_balance := NEW.balance_after;
    
    -- 잔고가 변경되지 않았으면 업데이트 안 함
    IF v_old_balance = v_new_balance THEN
        RAISE NOTICE '⏭️ [베팅 트리거] 잔고 변경 없음 (% = %), 스킵', v_old_balance, v_new_balance;
        RETURN NEW;
    END IF;
    
    -- INSERT와 UPDATE 모두 동일하게 처리
    IF (TG_OP = 'INSERT') THEN
        RAISE NOTICE '📊 [베팅 트리거-INSERT] 베팅 기록 생성 감지: user=%, txid=%, balance: % → %', 
            v_username, NEW.external_txid, v_old_balance, v_new_balance;
    ELSIF (TG_OP = 'UPDATE') THEN
        RAISE NOTICE '📊 [베팅 트리거-UPDATE] 베팅 기록 업데이트 감지: user=%, txid=%, balance: % → %', 
            v_username, NEW.external_txid, v_old_balance, v_new_balance;
    END IF;
    
    -- 사용자 보유금 업데이트
    UPDATE users
    SET 
        balance = v_new_balance,
        updated_at = NOW()
    WHERE id = NEW.user_id;
    
    RAISE NOTICE '✅ [베팅 트리거] 사용자 보유금 자동 업데이트 완료: user=%, % → %', 
        v_username, v_old_balance, v_new_balance;
    
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ [베팅 트리거] 오류 발생: %', SQLERRM;
        RETURN NEW;
END;
$$;

DO $$
BEGIN
    RAISE NOTICE '✅ update_user_balance_from_betting 함수 생성 완료';
END $$;

-- ============================================
-- 3단계: 트리거 생성 (INSERT + UPDATE)
-- ============================================

-- INSERT 트리거
CREATE TRIGGER trigger_update_user_balance_on_betting_insert
    AFTER INSERT ON game_records
    FOR EACH ROW
    WHEN (NEW.balance_after IS NOT NULL AND NEW.balance_after > 0)
    EXECUTE FUNCTION update_user_balance_from_betting();

-- UPDATE 트리거
CREATE TRIGGER trigger_update_user_balance_on_betting_update
    AFTER UPDATE ON game_records
    FOR EACH ROW
    WHEN (NEW.balance_after IS NOT NULL AND NEW.balance_after > 0)
    EXECUTE FUNCTION update_user_balance_from_betting();

DO $$
BEGIN
    RAISE NOTICE '✅ 베팅 기록 트리거 생성 완료 (INSERT + UPDATE)';
END $$;

-- ============================================
-- 4단계: 권한 부여
-- ============================================

GRANT EXECUTE ON FUNCTION update_user_balance_from_betting() TO authenticated, anon;

-- ============================================
-- 5단계: 완료 메시지
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 베팅 내역 → 사용자 보유금 자동 업데이트 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📋 적용된 기능:';
    RAISE NOTICE '  ✓ game_records INSERT 시 users.balance 자동 업데이트';
    RAISE NOTICE '  ✓ game_records UPDATE 시 users.balance 자동 업데이트';
    RAISE NOTICE '  ✓ active 세션이 있을 때만 업데이트 (게임 중인 사용자만)';
    RAISE NOTICE '  ✓ balance_after 값으로 users.balance 동기화';
    RAISE NOTICE '  ✓ 잔고 변경이 있을 때만 업데이트 (성능 최적화)';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 동작 조건:';
    RAISE NOTICE '  • balance_after > 0';
    RAISE NOTICE '  • user_id 존재';
    RAISE NOTICE '  • active 세션 존재 (사용자가 게임 중)';
    RAISE NOTICE '  • 기존 잔고와 새 잔고가 다름';
    RAISE NOTICE '';
    RAISE NOTICE '📊 사용 시나리오:';
    RAISE NOTICE '  1. 베팅 내역 자동 수집 → INSERT → 보유금 자동 업데이트';
    RAISE NOTICE '  2. 수동 베팅 내역 업데이트 → UPDATE → 보유금 자동 업데이트';
    RAISE NOTICE '  3. 베팅 내역 수정 → UPDATE → 보유금 자동 동기화';
    RAISE NOTICE '';
    RAISE NOTICE '🔍 로그 확인:';
    RAISE NOTICE '  Supabase Dashboard → Logs → Postgres Logs';
    RAISE NOTICE '  검색어: "베팅 트리거"';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;
