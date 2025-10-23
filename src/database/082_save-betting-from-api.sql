-- =====================================================
-- 베팅 내역 API 동기화 함수
-- API에서 받은 베팅 데이터를 DB에 저장하는 함수
-- =====================================================

-- 베팅 내역 배치 저장 함수
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
    -- 배열로 전달된 각 레코드 처리
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            -- 필드 추출 (동적 파싱)
            v_txid := COALESCE(
                (v_record->>'txid')::BIGINT,
                (v_record->>'id')::BIGINT,
                (v_record->>'transaction_id')::BIGINT,
                (v_record->>'external_txid')::BIGINT
            );
            
            v_username := COALESCE(
                v_record->>'username',
                v_record->>'user_id',
                v_record->>'userId'
            );
            
            v_game_id := COALESCE(
                (v_record->>'game_id')::INTEGER,
                (v_record->>'gameId')::INTEGER,
                (v_record->>'game')::INTEGER
            );
            
            v_provider_id := COALESCE(
                (v_record->>'provider_id')::INTEGER,
                (v_record->>'providerId')::INTEGER,
                CASE 
                    WHEN v_game_id IS NOT NULL THEN FLOOR(v_game_id / 1000)::INTEGER
                    ELSE NULL
                END
            );
            
            v_bet_amount := COALESCE(
                (v_record->>'bet_amount')::DECIMAL(15,2),
                (v_record->>'betAmount')::DECIMAL(15,2),
                (v_record->>'stake')::DECIMAL(15,2),
                (v_record->>'bet')::DECIMAL(15,2),
                0
            );
            
            v_win_amount := COALESCE(
                (v_record->>'win_amount')::DECIMAL(15,2),
                (v_record->>'winAmount')::DECIMAL(15,2),
                (v_record->>'payout')::DECIMAL(15,2),
                (v_record->>'win')::DECIMAL(15,2),
                0
            );
            
            v_balance_before := COALESCE(
                (v_record->>'balance_before')::DECIMAL(15,2),
                (v_record->>'balanceBefore')::DECIMAL(15,2),
                (v_record->>'prev_balance')::DECIMAL(15,2),
                0
            );
            
            v_balance_after := COALESCE(
                (v_record->>'balance_after')::DECIMAL(15,2),
                (v_record->>'balanceAfter')::DECIMAL(15,2),
                (v_record->>'new_balance')::DECIMAL(15,2),
                0
            );
            
            v_round_id := COALESCE(
                v_record->>'round_id',
                v_record->>'roundId',
                v_record->>'game_round_id'
            );
            
            v_played_at := COALESCE(
                (v_record->>'played_at')::TIMESTAMPTZ,
                (v_record->>'playedAt')::TIMESTAMPTZ,
                (v_record->>'bet_time')::TIMESTAMPTZ,
                (v_record->>'betTime')::TIMESTAMPTZ,
                (v_record->>'created_at')::TIMESTAMPTZ,
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
            
            -- username으로 user UUID 조회
            SELECT id INTO v_user_uuid
            FROM users
            WHERE username = v_username
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
            
            -- game_records에 저장 (upsert로 중복 방지)
            INSERT INTO game_records (
                external_txid,
                user_id,
                game_id,
                provider_id,
                bet_amount,
                win_amount,
                balance_before,
                balance_after,
                game_round_id,
                external_data,
                played_at,
                created_at
            ) VALUES (
                v_txid,
                v_user_uuid,
                v_game_id,
                v_provider_id,
                v_bet_amount,
                v_win_amount,
                v_balance_before,
                v_balance_after,
                v_round_id,
                v_record,
                v_played_at,
                NOW()
            )
            ON CONFLICT (external_txid, user_id, played_at) 
            DO UPDATE SET
                bet_amount = EXCLUDED.bet_amount,
                win_amount = EXCLUDED.win_amount,
                balance_after = EXCLUDED.balance_after,
                external_data = EXCLUDED.external_data,
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
    
    -- 결과 반환
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated;

COMMENT ON FUNCTION save_betting_records_batch IS 'API에서 받은 베팅 내역을 배치로 저장합니다. username을 UUID로 변환하여 저장합니다.';
