-- ============================================================================
-- 163. game_records 테이블 컬럼명 변경: external_username → username
-- ============================================================================
-- 작성일: 2025-10-10
-- 목적: 베팅 내역 화면 표시를 위한 컬럼명 통일
-- 근거: BettingManagement.tsx에서 users 테이블과 JOIN할 때 username 필드 사용
-- ============================================================================

-- ============================================
-- 1단계: 현재 상태 확인
-- ============================================
DO $$
DECLARE
    v_has_external_username BOOLEAN;
    v_has_username BOOLEAN;
    v_record_count INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '📊 game_records 테이블 상태 점검';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- external_username 컬럼 존재 여부
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'external_username'
    ) INTO v_has_external_username;
    
    -- username 컬럼 존재 여부
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'username'
    ) INTO v_has_username;
    
    -- 레코드 개수
    SELECT COUNT(*) INTO v_record_count FROM game_records;
    
    RAISE NOTICE '컬럼 존재 여부:';
    RAISE NOTICE '  external_username: %', CASE WHEN v_has_external_username THEN '✓ 존재' ELSE '✗ 없음' END;
    RAISE NOTICE '  username: %', CASE WHEN v_has_username THEN '✓ 존재' ELSE '✗ 없음' END;
    RAISE NOTICE '';
    RAISE NOTICE '총 레코드: %건', v_record_count;
    RAISE NOTICE '';
    
    IF v_has_external_username AND NOT v_has_username THEN
        RAISE NOTICE '✅ 컬럼명 변경 가능';
    ELSIF NOT v_has_external_username AND v_has_username THEN
        RAISE NOTICE '✅ 이미 username 컬럼으로 변경됨';
    ELSIF v_has_external_username AND v_has_username THEN
        RAISE NOTICE '⚠️ 두 컬럼이 모두 존재함 (external_username 삭제 필요)';
    ELSE
        RAISE NOTICE '⚠️ 두 컬럼 모두 없음 (username 생성 필요)';
    END IF;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 2단계: external_username을 username으로 변경
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '🔧 컬럼명 변경 시작...';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- external_username이 있고 username이 없는 경우
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'external_username'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'username'
    ) THEN
        ALTER TABLE game_records RENAME COLUMN external_username TO username;
        RAISE NOTICE '   ✓ external_username → username 변경 완료';
        
    -- username이 이미 있는 경우 (external_username도 있으면 삭제)
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'username'
    ) THEN
        RAISE NOTICE '   ✓ username 컬럼 이미 존재';
        
        -- external_username이 남아있으면 삭제
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_records' AND column_name = 'external_username'
        ) THEN
            ALTER TABLE game_records DROP COLUMN external_username;
            RAISE NOTICE '   ✓ 중복 컬럼 external_username 삭제';
        END IF;
        
    -- 두 컬럼 모두 없는 경우 username 생성
    ELSE
        ALTER TABLE game_records ADD COLUMN username TEXT;
        RAISE NOTICE '   ✓ username 컬럼 생성';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ 컬럼명 변경 완료';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 3단계: username 인덱스 생성
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '⚡ 인덱스 생성...';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- username 인덱스
    CREATE INDEX IF NOT EXISTS idx_game_records_username 
    ON game_records(username) WHERE username IS NOT NULL;
    RAISE NOTICE '   ✓ idx_game_records_username';
    
    -- username + played_at 복합 인덱스
    CREATE INDEX IF NOT EXISTS idx_game_records_username_played_at 
    ON game_records(username, played_at DESC) WHERE username IS NOT NULL;
    RAISE NOTICE '   ✓ idx_game_records_username_played_at';
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ 인덱스 생성 완료';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 4단계: save_betting_records_from_api 함수 업데이트
-- ============================================
CREATE OR REPLACE FUNCTION save_betting_records_from_api(p_records JSONB)
RETURNS TABLE (
    success BOOLEAN,
    saved_count INTEGER,
    skipped_count INTEGER,
    error_count INTEGER,
    errors TEXT[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_record JSONB;
    v_saved INTEGER := 0;
    v_skipped INTEGER := 0;
    v_error INTEGER := 0;
    v_errors TEXT[] := '{}';
    v_external_txid TEXT;
    v_username TEXT;
    v_user_id UUID;
    v_partner_id UUID;
    v_error_msg TEXT;
BEGIN
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            v_external_txid := v_record->>'txid';
            v_username := v_record->>'username';  -- API에서 받은 username
            
            -- 중복 체크
            IF EXISTS (SELECT 1 FROM game_records WHERE external_txid = v_external_txid) THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;
            
            -- username으로 user_id 조회 (optional)
            v_user_id := NULL;
            v_partner_id := NULL;
            
            IF v_username IS NOT NULL THEN
                SELECT u.id, u.referrer_id 
                INTO v_user_id, v_partner_id
                FROM users u
                WHERE u.username = v_username
                LIMIT 1;
            END IF;
            
            -- 베팅 레코드 삽입 (username 필드로 저장)
            -- 실제 game_records 테이블 구조:
            -- id, external_txid, user_id, game_id, provider_id, bet_amount, win_amount,
            -- balance_before, balance_after, played_at, created_at, session_id,
            -- bonus_amount, currency, device_type, ip_address, profit_loss,
            -- time_category, game_type, partner_id, updated_at, sync_status,
            -- round_id, game_round_id, username (변경될 컬럼)
            INSERT INTO game_records (
                external_txid,
                username,          -- ✅ external_username → username으로 변경됨
                user_id,
                partner_id,
                provider_id,
                game_id,
                game_type,
                bet_amount,
                win_amount,
                profit_loss,
                balance_before,
                balance_after,
                currency,
                round_id,
                game_round_id,
                session_id,
                played_at,
                created_at,
                updated_at
            ) VALUES (
                v_external_txid,
                v_username,        -- ✅ username 저장
                v_user_id,
                v_partner_id,
                COALESCE((v_record->>'provider_id')::INTEGER, 0),
                COALESCE((v_record->>'game_id')::INTEGER, 0),
                COALESCE(v_record->>'game_type', 'slot'),
                COALESCE((v_record->>'bet_amount')::DECIMAL, 0),
                COALESCE((v_record->>'win_amount')::DECIMAL, 0),
                COALESCE((v_record->>'profit_loss')::DECIMAL, 0),
                COALESCE((v_record->>'balance_before')::DECIMAL, 0),
                COALESCE((v_record->>'balance_after')::DECIMAL, 0),
                COALESCE(v_record->>'currency', 'KRW'),
                v_record->>'round_id',
                v_record->>'game_round_id',
                v_record->>'session_id',
                CASE 
                    WHEN v_record->>'played_at' IS NOT NULL 
                    THEN (v_record->>'played_at')::TIMESTAMPTZ 
                    ELSE NOW() 
                END,
                NOW(),
                NOW()
            );
            
            v_saved := v_saved + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_error := v_error + 1;
            v_error_msg := 'TX ' || COALESCE(v_external_txid, 'NULL') || ': ' || SQLERRM;
            v_errors := array_append(v_errors, v_error_msg);
        END;
    END LOOP;
    
    RETURN QUERY SELECT TRUE, v_saved, v_skipped, v_error, v_errors;
END;
$$;

-- 권한 부여
GRANT EXECUTE ON FUNCTION save_betting_records_from_api(JSONB) TO authenticated, anon;

-- ============================================
-- 5단계: 최종 확인
-- ============================================
DO $$
DECLARE
    v_total_count INTEGER;
    v_with_username INTEGER;
    v_with_user_id INTEGER;
    v_sample RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 최종 확인';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- 전체 레코드 수
    SELECT COUNT(*) INTO v_total_count FROM game_records;
    
    -- username이 있는 레코드 수
    SELECT COUNT(*) INTO v_with_username 
    FROM game_records 
    WHERE username IS NOT NULL;
    
    -- user_id가 있는 레코드 수
    SELECT COUNT(*) INTO v_with_user_id 
    FROM game_records 
    WHERE user_id IS NOT NULL;
    
    RAISE NOTICE '통계:';
    RAISE NOTICE '  전체 레코드: %건', v_total_count;
    RAISE NOTICE '  username 있음: %건 (%.1f%%)', 
        v_with_username, 
        CASE WHEN v_total_count > 0 THEN (v_with_username::NUMERIC / v_total_count * 100) ELSE 0 END;
    RAISE NOTICE '  user_id 있음: %건 (%.1f%%)', 
        v_with_user_id,
        CASE WHEN v_total_count > 0 THEN (v_with_user_id::NUMERIC / v_total_count * 100) ELSE 0 END;
    RAISE NOTICE '';
    
    -- 샘플 데이터 확인
    IF v_total_count > 0 THEN
        SELECT 
            external_txid,
            username,
            user_id,
            game_type,
            bet_amount,
            win_amount,
            played_at
        INTO v_sample
        FROM game_records
        ORDER BY played_at DESC
        LIMIT 1;
        
        RAISE NOTICE '최근 데이터 샘플:';
        RAISE NOTICE '  txid: %', v_sample.external_txid;
        RAISE NOTICE '  username: %', COALESCE(v_sample.username, '(NULL)');
        RAISE NOTICE '  user_id: %', COALESCE(v_sample.user_id::TEXT, '(NULL)');
        RAISE NOTICE '  game_type: %', v_sample.game_type;
        RAISE NOTICE '  bet_amount: %', v_sample.bet_amount;
        RAISE NOTICE '  played_at: %', v_sample.played_at;
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🎉 컬럼명 변경 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '  ✓ external_username → username';
    RAISE NOTICE '  ✓ username 인덱스 생성';
    RAISE NOTICE '  ✓ save_betting_records_from_api 함수 업데이트';
    RAISE NOTICE '';
    RAISE NOTICE '이제 BettingManagement.tsx에서 정상 표시됩니다!';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;
