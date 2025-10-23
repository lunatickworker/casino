-- =====================================================
-- 291. balance_before 계산 오류 수정
-- =====================================================
-- 작성일: 2025-10-19
-- 목적: 
--   - balance_before가 0으로 저장되는 문제 해결
--   - API 응답에 balance_before가 없을 경우 역산하여 계산
--   - balance_before = balance_after - (win_amount - bet_amount)
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '291. balance_before 계산 오류 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: 기존 함수 삭제
-- ============================================

DROP FUNCTION IF EXISTS save_betting_records_batch(JSONB);

DO $
BEGIN
    RAISE NOTICE '✅ 기존 save_betting_records_batch 함수 삭제 완료';
END $;

-- ============================================
-- 2단계: save_betting_records_batch 함수 수정
-- ============================================

CREATE OR REPLACE FUNCTION save_betting_records_batch(
    p_records JSONB
)
RETURNS TABLE (
    success_count INTEGER,
    error_count INTEGER,
    errors JSONB
) AS $$
DECLARE
    v_record JSONB;
    v_success_count INTEGER := 0;
    v_error_count INTEGER := 0;
    v_errors JSONB := '[]'::JSONB;
    v_user_uuid UUID;
    v_partner_id UUID;
    v_username TEXT;
    v_txid BIGINT;
    v_game_id INTEGER;
    v_provider_id INTEGER;
    v_bet_amount DECIMAL(15,2);
    v_win_amount DECIMAL(15,2);
    v_balance_before DECIMAL(15,2);
    v_balance_after DECIMAL(15,2);
    v_round_id TEXT;
    v_played_at TIMESTAMPTZ;
BEGIN
    -- p_records가 배열인지 확인
    IF jsonb_typeof(p_records) != 'array' THEN
        RAISE EXCEPTION 'p_records must be a JSON array';
    END IF;
    
    -- 각 레코드 처리
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            -- 필수 필드 추출
            v_txid := COALESCE(
                (v_record->>'txid')::BIGINT,
                (v_record->>'id')::BIGINT,
                (v_record->>'transaction_id')::BIGINT,
                (v_record->>'TXID')::BIGINT
            );
            
            v_username := COALESCE(
                v_record->>'username',
                v_record->>'user_name',
                v_record->>'USERNAME'
            );
            
            v_game_id := COALESCE(
                (v_record->>'game_id')::INTEGER,
                (v_record->>'gameId')::INTEGER,
                (v_record->>'GAME_ID')::INTEGER
            );
            
            v_provider_id := COALESCE(
                (v_record->>'provider_id')::INTEGER,
                (v_record->>'providerId')::INTEGER,
                (v_record->>'PROVIDER_ID')::INTEGER,
                (v_game_id / 1000)::INTEGER
            );
            
            v_bet_amount := COALESCE(
                (v_record->>'bet_amount')::DECIMAL(15,2),
                (v_record->>'betAmount')::DECIMAL(15,2),
                (v_record->>'bet')::DECIMAL(15,2),
                (v_record->>'BET_AMOUNT')::DECIMAL(15,2),
                0
            );
            
            v_win_amount := COALESCE(
                (v_record->>'win_amount')::DECIMAL(15,2),
                (v_record->>'winAmount')::DECIMAL(15,2),
                (v_record->>'win')::DECIMAL(15,2),
                (v_record->>'WIN_AMOUNT')::DECIMAL(15,2),
                0
            );
            
            -- balance_after는 필수값
            v_balance_after := COALESCE(
                (v_record->>'balance_after')::DECIMAL(15,2),
                (v_record->>'balanceAfter')::DECIMAL(15,2),
                (v_record->>'new_balance')::DECIMAL(15,2),
                (v_record->>'BALANCE_AFTER')::DECIMAL(15,2),
                0
            );
            
            -- ✅ balance_before 계산 로직 개선
            -- 1. API 응답에 balance_before가 있으면 사용
            v_balance_before := COALESCE(
                (v_record->>'balance_before')::DECIMAL(15,2),
                (v_record->>'balanceBefore')::DECIMAL(15,2),
                (v_record->>'prev_balance')::DECIMAL(15,2),
                (v_record->>'BALANCE_BEFORE')::DECIMAL(15,2)
            );
            
            -- 2. balance_before가 없거나 0이면 역산으로 계산
            -- balance_before = balance_after - (win_amount - bet_amount)
            IF v_balance_before IS NULL OR v_balance_before = 0 THEN
                IF v_balance_after > 0 THEN
                    v_balance_before := v_balance_after - (v_win_amount - v_bet_amount);
                    RAISE NOTICE '✅ balance_before 역산: balance_after(%) - (win(%) - bet(%)) = %', 
                        v_balance_after, v_win_amount, v_bet_amount, v_balance_before;
                ELSE
                    -- balance_after도 0이면 사용자 현재 잔고 조회
                    SELECT balance INTO v_balance_before
                    FROM users
                    WHERE username = v_username;
                    
                    IF v_balance_before IS NULL THEN
                        v_balance_before := 0;
                    END IF;
                    
                    RAISE NOTICE '⚠️ balance_after가 0, 사용자 현재 잔고 사용: %', v_balance_before;
                END IF;
            END IF;
            
            v_round_id := COALESCE(
                v_record->>'round_id',
                v_record->>'roundId',
                v_record->>'game_round_id',
                v_record->>'ROUND_ID'
            );
            
            v_played_at := COALESCE(
                (v_record->>'played_at')::TIMESTAMPTZ,
                (v_record->>'playedAt')::TIMESTAMPTZ,
                (v_record->>'bet_time')::TIMESTAMPTZ,
                (v_record->>'betTime')::TIMESTAMPTZ,
                (v_record->>'created_at')::TIMESTAMPTZ,
                (v_record->>'PLAYED_AT')::TIMESTAMPTZ,
                NOW()
            );
            
            -- 필수 필드 검증
            IF v_txid IS NULL OR v_username IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', 'Missing required fields: txid or username'
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- username으로 user UUID 및 partner_id 조회
            SELECT u.id, u.referrer_id INTO v_user_uuid, v_partner_id
            FROM users u
            WHERE u.username = v_username;
            
            IF v_user_uuid IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', format('User not found: %s', v_username)
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- game_id 검증 및 자동 생성
            IF v_game_id IS NOT NULL THEN
                IF NOT EXISTS (SELECT 1 FROM games WHERE id = v_game_id) THEN
                    -- 게임이 없으면 자동 생성
                    BEGIN
                        INSERT INTO games (
                            id, 
                            provider_id, 
                            name, 
                            type, 
                            status,
                            created_at,
                            updated_at
                        ) VALUES (
                            v_game_id, 
                            v_provider_id, 
                            format('Game %s', v_game_id), 
                            CASE WHEN v_provider_id >= 400 THEN 'casino' ELSE 'slot' END,
                            'visible',
                            NOW(),
                            NOW()
                        )
                        ON CONFLICT (id) DO NOTHING;
                    EXCEPTION WHEN OTHERS THEN
                        RAISE NOTICE '게임 자동 생성 실패 (game_id: %): %', v_game_id, SQLERRM;
                    END;
                END IF;
            END IF;
            
            -- game_records에 저장 (upsert로 중복 방지)
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
                v_balance_before,
                v_balance_after,
                v_round_id,
                v_record,
                v_played_at,
                'synced',
                NOW(),
                NOW()
            )
            ON CONFLICT (external_txid, user_id, played_at) 
            DO UPDATE SET
                bet_amount = EXCLUDED.bet_amount,
                win_amount = EXCLUDED.win_amount,
                balance_before = EXCLUDED.balance_before,  -- ✅ balance_before 업데이트 추가
                balance_after = EXCLUDED.balance_after,
                external_data = EXCLUDED.external_data,
                sync_status = 'synced',
                updated_at = NOW();
            
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'record', v_record,
                'error', SQLERRM
            );
            v_error_count := v_error_count + 1;
        END;
    END LOOP;
    
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated, anon;

DO $$
BEGIN
    RAISE NOTICE '✅ save_betting_records_batch 함수 수정 완료';
END $$;

-- ============================================
-- 2단계: 기존 데이터의 balance_before 재계산
-- ============================================

DO $$
DECLARE
    v_updated_count INTEGER := 0;
    v_record RECORD;
BEGIN
    RAISE NOTICE '🔄 기존 베팅 기록의 balance_before 재계산 시작...';
    
    -- balance_before가 0인 레코드만 업데이트
    FOR v_record IN 
        SELECT 
            id,
            balance_after,
            win_amount,
            bet_amount,
            user_id
        FROM game_records
        WHERE balance_before = 0
        AND balance_after > 0
        ORDER BY played_at DESC
        LIMIT 10000  -- 성능 고려하여 제한
    LOOP
        -- balance_before = balance_after - (win_amount - bet_amount)
        UPDATE game_records
        SET 
            balance_before = v_record.balance_after - (v_record.win_amount - v_record.bet_amount),
            updated_at = NOW()
        WHERE id = v_record.id;
        
        v_updated_count := v_updated_count + 1;
        
        -- 1000건마다 로그 출력
        IF v_updated_count % 1000 = 0 THEN
            RAISE NOTICE '  처리 중: %건 완료', v_updated_count;
        END IF;
    END LOOP;
    
    RAISE NOTICE '✅ balance_before 재계산 완료: %건 업데이트', v_updated_count;
END $$;

-- ============================================
-- 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 291. balance_before 계산 오류 수정 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '수정된 항목:';
    RAISE NOTICE '1. ✅ save_betting_records_batch() 함수 - balance_before 역산 로직 추가';
    RAISE NOTICE '2. ✅ ON CONFLICT DO UPDATE - balance_before 업데이트 추가';
    RAISE NOTICE '3. ✅ 기존 데이터의 balance_before 재계산';
    RAISE NOTICE '';
    RAISE NOTICE '📌 계산 로직:';
    RAISE NOTICE '  • API에 balance_before 있음 → 그대로 사용';
    RAISE NOTICE '  • API에 없거나 0 → balance_after - (win_amount - bet_amount)';
    RAISE NOTICE '  • balance_after도 0 → 사용자 현재 잔고 사용';
    RAISE NOTICE '';
    RAISE NOTICE '📊 재계산 결과:';
    RAISE NOTICE '  • 최근 10,000건의 balance_before=0 레코드 재계산 완료';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
