-- =====================================================
-- 잔고 필드 파싱 강화 및 사용자 잔고 동기화
-- =====================================================

-- 1. save_betting_records_batch 함수 수정 (잔고 필드 파싱 강화)
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
    -- 배열로 전달된 각 레코드 처리
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            -- 필드 추출 (동적 파싱)
            v_txid := COALESCE(
                (v_record->>'txid')::BIGINT,
                (v_record->>'id')::BIGINT,
                (v_record->>'transaction_id')::BIGINT,
                (v_record->>'external_txid')::BIGINT,
                (v_record->>'ID')::BIGINT
            );
            
            v_username := COALESCE(
                v_record->>'username',
                v_record->>'user_id',
                v_record->>'userId',
                v_record->>'USERNAME'
            );
            
            v_game_id := COALESCE(
                (v_record->>'game_id')::INTEGER,
                (v_record->>'gameId')::INTEGER,
                (v_record->>'game')::INTEGER,
                (v_record->>'GAME_ID')::INTEGER
            );
            
            v_provider_id := COALESCE(
                (v_record->>'provider_id')::INTEGER,
                (v_record->>'providerId')::INTEGER,
                (v_record->>'PROVIDER_ID')::INTEGER,
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
                (v_record->>'BET_AMOUNT')::DECIMAL(15,2),
                0
            );
            
            v_win_amount := COALESCE(
                (v_record->>'win_amount')::DECIMAL(15,2),
                (v_record->>'winAmount')::DECIMAL(15,2),
                (v_record->>'payout')::DECIMAL(15,2),
                (v_record->>'win')::DECIMAL(15,2),
                (v_record->>'WIN_AMOUNT')::DECIMAL(15,2),
                0
            );
            
            -- 잔고 필드 파싱 강화 (더 많은 필드명 지원)
            v_balance_before := COALESCE(
                (v_record->>'balance_before')::DECIMAL(15,2),
                (v_record->>'balanceBefore')::DECIMAL(15,2),
                (v_record->>'prev_balance')::DECIMAL(15,2),
                (v_record->>'previous_balance')::DECIMAL(15,2),
                (v_record->>'BALANCE_BEFORE')::DECIMAL(15,2),
                (v_record->>'balance')::DECIMAL(15,2), -- 단순 balance 필드
                0
            );
            
            v_balance_after := COALESCE(
                (v_record->>'balance_after')::DECIMAL(15,2),
                (v_record->>'balanceAfter')::DECIMAL(15,2),
                (v_record->>'new_balance')::DECIMAL(15,2),
                (v_record->>'current_balance')::DECIMAL(15,2),
                (v_record->>'final_balance')::DECIMAL(15,2),
                (v_record->>'BALANCE_AFTER')::DECIMAL(15,2),
                -- balance_before + win_amount - bet_amount로 계산
                v_balance_before + v_win_amount - v_bet_amount
            );
            
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
                (v_record->>'create_at')::TIMESTAMPTZ, -- 오타 대응
                (v_record->>'PLAYED_AT')::TIMESTAMPTZ,
                NOW()
            );
            
            -- 필수 필드 검증
            IF v_txid IS NULL OR v_username IS NULL OR v_bet_amount <= 0 THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', format('Missing required fields: txid=%s, username=%s, bet_amount=%s', 
                                   v_txid, v_username, v_bet_amount)
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- username으로 user UUID 및 partner_id 조회
            SELECT u.id, u.referrer_id INTO v_user_uuid, v_partner_id
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
            
            -- 게임 ID가 없으면 자동 생성 (외래키 제약 조건 우회)
            IF v_game_id IS NOT NULL THEN
                -- games 테이블에 게임이 있는지 확인
                IF NOT EXISTS (SELECT 1 FROM games WHERE id = v_game_id) THEN
                    -- 게임이 없으면 자동으로 생성
                    BEGIN
                        -- provider도 없으면 생성
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
                        
                        -- 게임 자동 생성
                        INSERT INTO games (id, provider_id, name, type, status, created_at, updated_at)
                        VALUES (
                            v_game_id,
                            v_provider_id,
                            'Game ' || v_game_id,
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
                balance_before = EXCLUDED.balance_before,
                balance_after = EXCLUDED.balance_after,
                external_data = EXCLUDED.external_data,
                sync_status = 'synced',
                updated_at = NOW();
            
            -- 사용자 최신 잔고 업데이트
            IF v_balance_after > 0 THEN
                UPDATE users 
                SET 
                    balance = v_balance_after,
                    updated_at = NOW()
                WHERE id = v_user_uuid 
                AND (balance IS NULL OR balance != v_balance_after);
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
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 권한 설정
GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated;

COMMENT ON FUNCTION save_betting_records_batch IS '베팅 내역 저장 시 사용자 잔고도 함께 업데이트합니다. 잔고 필드 파싱을 강화했습니다.';