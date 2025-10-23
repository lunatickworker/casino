-- =====================================================
-- 베팅 내역 저장 최종 수정
-- =====================================================

-- 1. betting_stats_cache 테이블 구조 확인 및 수정
DO $$
BEGIN
    -- 테이블이 존재하는지 확인
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'betting_stats_cache') THEN
        -- user_id 컬럼이 없으면 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'betting_stats_cache' AND column_name = 'user_id'
        ) THEN
            ALTER TABLE betting_stats_cache ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
            CREATE INDEX IF NOT EXISTS idx_betting_stats_cache_user_id ON betting_stats_cache(user_id);
            RAISE NOTICE 'betting_stats_cache에 user_id 컬럼 추가 완료';
        END IF;
        
        -- partner_id 컬럼이 없으면 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'betting_stats_cache' AND column_name = 'partner_id'
        ) THEN
            ALTER TABLE betting_stats_cache ADD COLUMN partner_id UUID REFERENCES partners(id);
            CREATE INDEX IF NOT EXISTS idx_betting_stats_cache_partner_id ON betting_stats_cache(partner_id);
            RAISE NOTICE 'betting_stats_cache에 partner_id 컬럼 추가 완료';
        END IF;
    ELSE
        -- 테이블이 없으면 새로 생성
        CREATE TABLE betting_stats_cache (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            partner_id UUID REFERENCES partners(id),
            stat_date DATE NOT NULL,
            game_count INTEGER DEFAULT 0,
            total_bet DECIMAL(15,2) DEFAULT 0,
            total_win DECIMAL(15,2) DEFAULT 0,
            net_profit DECIMAL(15,2) DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, stat_date)
        );
        
        CREATE INDEX idx_betting_stats_cache_user_id ON betting_stats_cache(user_id);
        CREATE INDEX idx_betting_stats_cache_partner_id ON betting_stats_cache(partner_id);
        CREATE INDEX idx_betting_stats_cache_stat_date ON betting_stats_cache(stat_date);
        
        RAISE NOTICE 'betting_stats_cache 테이블 생성 완료';
    END IF;
END $$;

-- 2. save_betting_records_batch 함수 수정 (win 타입 레코드도 허용)
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
    v_tx_type TEXT;
BEGIN
    RAISE NOTICE '========== 배치 저장 시작 ==========';
    RAISE NOTICE '전달된 레코드 수: %', jsonb_array_length(p_records);
    
    -- 배열로 전달된 각 레코드 처리
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            RAISE NOTICE '---------- 레코드 처리 시작 ----------';
            RAISE NOTICE '원본 레코드: %', v_record::text;
            
            -- tx_type 확인 (bet / win)
            v_tx_type := COALESCE(
                v_record->>'tx_type',
                v_record->>'type',
                'bet'  -- 기본값
            );
            
            -- 필드 추출 (소문자 필드 우선 - 에러에서 확인된 실제 구조)
            v_txid := COALESCE(
                (v_record->>'txid')::BIGINT,
                (v_record->>'id')::BIGINT,
                (v_record->>'ID')::BIGINT,
                (v_record->>'transaction_id')::BIGINT,
                (v_record->>'external_txid')::BIGINT
            );
            
            v_username := COALESCE(
                v_record->>'username',
                v_record->>'USERNAME',
                v_record->>'user_id',
                v_record->>'userId'
            );
            
            v_game_id := COALESCE(
                (v_record->>'game_id')::INTEGER,
                (v_record->>'GAME_ID')::INTEGER,
                (v_record->>'gameId')::INTEGER,
                (v_record->>'game')::INTEGER
            );
            
            v_provider_id := COALESCE(
                (v_record->>'provider_id')::INTEGER,
                (v_record->>'PROVIDER_ID')::INTEGER,
                (v_record->>'providerId')::INTEGER,
                CASE 
                    WHEN v_game_id IS NOT NULL THEN FLOOR(v_game_id / 1000)::INTEGER
                    ELSE NULL
                END
            );
            
            -- bet 필드 파싱 (문자열로 올 수 있음)
            v_bet_amount := COALESCE(
                (v_record->>'bet')::DECIMAL(15,2),
                (v_record->>'bet_amount')::DECIMAL(15,2),
                (v_record->>'BET_AMOUNT')::DECIMAL(15,2),
                (v_record->>'betAmount')::DECIMAL(15,2),
                (v_record->>'stake')::DECIMAL(15,2),
                0
            );
            
            -- win 필드 파싱
            v_win_amount := COALESCE(
                (v_record->>'win')::DECIMAL(15,2),
                (v_record->>'win_amount')::DECIMAL(15,2),
                (v_record->>'WIN_AMOUNT')::DECIMAL(15,2),
                (v_record->>'winAmount')::DECIMAL(15,2),
                (v_record->>'payout')::DECIMAL(15,2),
                0
            );
            
            -- balance 필드 파싱
            v_balance_before := COALESCE(
                (v_record->>'balance_before')::DECIMAL(15,2),
                (v_record->>'BALANCE_BEFORE')::DECIMAL(15,2),
                (v_record->>'balanceBefore')::DECIMAL(15,2),
                (v_record->>'prev_balance')::DECIMAL(15,2),
                (v_record->>'previous_balance')::DECIMAL(15,2),
                0
            );
            
            v_balance_after := COALESCE(
                (v_record->>'balance')::DECIMAL(15,2),
                (v_record->>'balance_after')::DECIMAL(15,2),
                (v_record->>'BALANCE_AFTER')::DECIMAL(15,2),
                (v_record->>'balanceAfter')::DECIMAL(15,2),
                (v_record->>'new_balance')::DECIMAL(15,2),
                (v_record->>'current_balance')::DECIMAL(15,2),
                (v_record->>'final_balance')::DECIMAL(15,2),
                0
            );
            
            v_round_id := COALESCE(
                v_record->>'round_id',
                v_record->>'ROUND_ID',
                v_record->>'roundId',
                v_record->>'game_round_id'
            );
            
            -- create_at 필드 파싱
            v_played_at := COALESCE(
                (v_record->>'create_at')::TIMESTAMPTZ,
                (v_record->>'created_at')::TIMESTAMPTZ,
                (v_record->>'PLAYED_AT')::TIMESTAMPTZ,
                (v_record->>'played_at')::TIMESTAMPTZ,
                (v_record->>'playedAt')::TIMESTAMPTZ,
                (v_record->>'bet_time')::TIMESTAMPTZ,
                (v_record->>'betTime')::TIMESTAMPTZ,
                NOW()
            );
            
            RAISE NOTICE '파싱된 필드: txid=%, username=%, game_id=%, bet=%, win=%, balance=%, tx_type=%',
                v_txid, v_username, v_game_id, v_bet_amount, v_win_amount, v_balance_after, v_tx_type;
            
            -- 필수 필드 검증 (win 타입인 경우 bet_amount가 0이어도 허용)
            IF v_txid IS NULL OR v_username IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', format('Missing required fields: txid=%s, username=%s', 
                                   v_txid, v_username)
                );
                v_error_count := v_error_count + 1;
                RAISE WARNING '필수 필드 누락: txid=%, username=%', v_txid, v_username;
                CONTINUE;
            END IF;
            
            -- bet 타입인데 bet_amount가 0이면 스킵
            IF v_tx_type = 'bet' AND v_bet_amount <= 0 THEN
                RAISE WARNING 'bet 타입인데 bet_amount가 0: txid=%, username=%', v_txid, v_username;
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
                RAISE WARNING '사용자 없음: %', v_username;
                CONTINUE;
            END IF;
            
            RAISE NOTICE '사용자 찾음: username=%, uuid=%', v_username, v_user_uuid;
            
            -- 게임 ID가 있으면 게임 자동 생성
            IF v_game_id IS NOT NULL THEN
                IF NOT EXISTS (SELECT 1 FROM games WHERE id = v_game_id) THEN
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
                            RAISE NOTICE '제공사 생성: %', v_provider_id;
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
                        RAISE NOTICE '게임 생성: %', v_game_id;
                    EXCEPTION WHEN OTHERS THEN
                        RAISE WARNING '게임 자동 생성 실패 (game_id: %): %', v_game_id, SQLERRM;
                    END;
                END IF;
            END IF;
            
            -- game_records에 저장 (upsert로 중복 방지)
            -- win 타입이면 기존 bet 레코드 업데이트
            IF v_tx_type = 'win' THEN
                -- ref_txid로 원래 bet 레코드 찾아서 업데이트
                UPDATE game_records 
                SET 
                    win_amount = v_win_amount,
                    balance_after = v_balance_after,
                    external_data = external_data || jsonb_build_object('win_record', v_record),
                    sync_status = 'synced',
                    updated_at = NOW()
                WHERE user_id = v_user_uuid
                AND round_id = v_round_id
                AND played_at::DATE = v_played_at::DATE;
                
                IF FOUND THEN
                    RAISE NOTICE 'win 레코드로 기존 bet 업데이트: round_id=%', v_round_id;
                    v_success_count := v_success_count + 1;
                ELSE
                    -- bet 레코드가 없으면 새로 생성 (드문 경우)
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
                        0,  -- win 타입은 bet_amount 0
                        v_win_amount,
                        v_balance_before,
                        v_balance_after,
                        v_round_id,
                        v_record,
                        v_played_at,
                        'synced',
                        NOW(),
                        NOW()
                    );
                    RAISE NOTICE 'win 레코드 새로 저장: txid=%', v_txid;
                    v_success_count := v_success_count + 1;
                END IF;
            ELSE
                -- bet 타입은 일반 저장
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
                
                RAISE NOTICE '베팅 레코드 저장 완료: txid=%', v_txid;
                v_success_count := v_success_count + 1;
            END IF;
            
            -- 사용자 최신 잔고 업데이트
            IF v_balance_after > 0 THEN
                UPDATE users 
                SET 
                    balance = v_balance_after,
                    updated_at = NOW()
                WHERE id = v_user_uuid 
                AND (balance IS NULL OR balance != v_balance_after);
                
                IF FOUND THEN
                    RAISE NOTICE '사용자 잔고 업데이트: username=%, balance=%', v_username, v_balance_after;
                END IF;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'record', v_record,
                'error', SQLERRM
            );
            v_error_count := v_error_count + 1;
            RAISE WARNING '레코드 처리 오류: %', SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE '========== 배치 저장 완료 ==========';
    RAISE NOTICE '성공: %, 실패: %', v_success_count, v_error_count;
    
    -- 결과 반환
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 권한 설정
GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated;

COMMENT ON FUNCTION save_betting_records_batch IS '베팅 내역을 저장합니다. bet/win 타입을 모두 처리하며, win 타입은 기존 bet 레코드를 업데이트합니다.';

-- 3. game_records 테이블에 round_id 인덱스 추가 (win 레코드 매칭 속도 향상)
CREATE INDEX IF NOT EXISTS idx_game_records_round_id ON game_records(game_round_id);
CREATE INDEX IF NOT EXISTS idx_game_records_user_round ON game_records(user_id, game_round_id);

-- 완료 메시지
DO $
BEGIN
    RAISE NOTICE '베팅 내역 저장 시스템 최종 수정 완료';
END $;
