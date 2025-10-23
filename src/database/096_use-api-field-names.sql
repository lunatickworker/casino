-- =====================================================
-- API 응답 필드명 그대로 사용 (round_id)
-- =====================================================

-- 0. betting_stats_cache 테이블 재생성 (stat_date 컬럼 포함)
DROP TABLE IF EXISTS betting_stats_cache CASCADE;

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

-- RLS 비활성화
ALTER TABLE betting_stats_cache DISABLE ROW LEVEL SECURITY;

-- 1. game_records 테이블에 round_id 컬럼 추가/변경
DO $$
BEGIN
    -- game_round_id 컬럼이 있으면 데이터 마이그레이션
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'game_round_id'
    ) THEN
        -- round_id 컬럼 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_records' AND column_name = 'round_id'
        ) THEN
            ALTER TABLE game_records ADD COLUMN round_id TEXT;
            RAISE NOTICE 'round_id 컬럼 추가 완료';
        END IF;
        
        -- 데이터 복사
        UPDATE game_records SET round_id = game_round_id WHERE round_id IS NULL;
        
        -- 기존 컬럼 삭제
        ALTER TABLE game_records DROP COLUMN IF EXISTS game_round_id;
        RAISE NOTICE 'game_round_id -> round_id 마이그레이션 완료';
    ELSE
        -- round_id 컬럼만 추가
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'game_records' AND column_name = 'round_id'
        ) THEN
            ALTER TABLE game_records ADD COLUMN round_id TEXT;
            RAISE NOTICE 'round_id 컬럼 추가 완료';
        END IF;
    END IF;
END $$;

-- 2. round_id 인덱스 재생성
DROP INDEX IF EXISTS idx_game_records_round_id;
DROP INDEX IF EXISTS idx_game_records_user_round;
DROP INDEX IF EXISTS idx_game_records_game_round_id;
DROP INDEX IF EXISTS idx_game_records_user_round_id;

CREATE INDEX idx_game_records_round_id ON game_records(round_id);
CREATE INDEX idx_game_records_user_round ON game_records(user_id, round_id);

-- 3. save_betting_records_batch 함수 수정 (API 필드명 그대로 사용)
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
            
            -- ===== API 응답 필드 그대로 추출 (이미지에서 확인된 필드명) =====
            v_tx_type := v_record->>'tx_type';  -- bet / win
            v_txid := (v_record->>'txid')::BIGINT;
            v_username := v_record->>'username';
            v_game_id := (v_record->>'game_id')::INTEGER;
            v_provider_id := (v_record->>'provider_id')::INTEGER;
            v_bet_amount := (v_record->>'bet')::DECIMAL(15,2);
            v_win_amount := (v_record->>'win')::DECIMAL(15,2);
            v_balance_after := (v_record->>'balance')::DECIMAL(15,2);
            v_round_id := v_record->>'round_id';
            
            -- create_at 파싱 (문자열 -> TIMESTAMPTZ)
            BEGIN
                v_played_at := (v_record->>'create_at')::TIMESTAMPTZ;
            EXCEPTION WHEN OTHERS THEN
                v_played_at := NOW();
            END;
            
            -- balance_before 계산 (balance - win + bet for win type, balance + bet for bet type)
            IF v_tx_type = 'win' THEN
                v_balance_before := v_balance_after - v_win_amount + v_bet_amount;
            ELSE
                v_balance_before := v_balance_after + v_bet_amount;
            END IF;
            
            RAISE NOTICE '파싱 완료: txid=%, username=%, game_id=%, bet=%, win=%, balance=%, tx_type=%, round_id=%',
                v_txid, v_username, v_game_id, v_bet_amount, v_win_amount, v_balance_after, v_tx_type, v_round_id;
            
            -- 필수 필드 검증
            IF v_txid IS NULL OR v_username IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', format('필수 필드 누락: txid=%s, username=%s', v_txid, v_username)
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- bet 타입인데 bet_amount가 0이면 스킵
            IF v_tx_type = 'bet' AND (v_bet_amount IS NULL OR v_bet_amount <= 0) THEN
                RAISE WARNING 'bet 타입인데 bet_amount가 0 또는 NULL: txid=%', v_txid;
                CONTINUE;
            END IF;
            
            -- username으로 user UUID 및 partner_id 조회
            SELECT u.id, u.referrer_id INTO v_user_uuid, v_partner_id
            FROM users u
            WHERE u.username = v_username
            LIMIT 1;
            
            IF v_user_uuid IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'record', v_record,
                    'error', '사용자 없음: ' || v_username
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- 게임 및 제공사 자동 생성
            IF v_provider_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM game_providers WHERE id = v_provider_id) THEN
                INSERT INTO game_providers (id, name, type, status, created_at, updated_at)
                VALUES (
                    v_provider_id, 
                    v_record->>'provider_name',
                    CASE WHEN v_provider_id >= 400 THEN 'casino' ELSE 'slot' END,
                    'active',
                    NOW(),
                    NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = COALESCE(EXCLUDED.name, game_providers.name),
                    updated_at = NOW();
            END IF;
            
            IF v_game_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM games WHERE id = v_game_id) THEN
                INSERT INTO games (id, provider_id, name, type, status, created_at, updated_at)
                VALUES (
                    v_game_id,
                    v_provider_id,
                    v_record->>'game_title',
                    CASE WHEN v_provider_id >= 400 THEN 'casino' ELSE 'slot' END,
                    'visible',
                    NOW(),
                    NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = COALESCE(EXCLUDED.name, games.name),
                    updated_at = NOW();
            END IF;
            
            -- game_records에 저장
            IF v_tx_type = 'win' THEN
                -- win 레코드: round_id로 기존 bet 레코드 업데이트
                UPDATE game_records 
                SET 
                    win_amount = v_win_amount,
                    balance_after = v_balance_after,
                    external_data = external_data || jsonb_build_object('win_txid', v_txid, 'win_record', v_record),
                    sync_status = 'synced',
                    updated_at = NOW()
                WHERE user_id = v_user_uuid
                AND round_id = v_round_id
                AND played_at::DATE = v_played_at::DATE;
                
                IF FOUND THEN
                    RAISE NOTICE 'win 레코드로 기존 bet 업데이트: round_id=%', v_round_id;
                    v_success_count := v_success_count + 1;
                ELSE
                    -- bet 레코드가 없으면 win만 저장
                    INSERT INTO game_records (
                        external_txid, user_id, partner_id, game_id, provider_id,
                        bet_amount, win_amount, balance_before, balance_after,
                        round_id, external_data, played_at, sync_status, created_at, updated_at
                    ) VALUES (
                        v_txid, v_user_uuid, v_partner_id, v_game_id, v_provider_id,
                        0, v_win_amount, v_balance_before, v_balance_after,
                        v_round_id, v_record, v_played_at, 'synced', NOW(), NOW()
                    );
                    RAISE NOTICE 'win 레코드 단독 저장: txid=%', v_txid;
                    v_success_count := v_success_count + 1;
                END IF;
            ELSE
                -- bet 레코드: 신규 저장
                INSERT INTO game_records (
                    external_txid, user_id, partner_id, game_id, provider_id,
                    bet_amount, win_amount, balance_before, balance_after,
                    round_id, external_data, played_at, sync_status, created_at, updated_at
                ) VALUES (
                    v_txid, v_user_uuid, v_partner_id, v_game_id, v_provider_id,
                    v_bet_amount, 0, v_balance_before, v_balance_after,
                    v_round_id, v_record, v_played_at, 'synced', NOW(), NOW()
                )
                ON CONFLICT (external_txid, user_id, played_at) 
                DO UPDATE SET
                    bet_amount = EXCLUDED.bet_amount,
                    balance_after = EXCLUDED.balance_after,
                    external_data = EXCLUDED.external_data,
                    sync_status = 'synced',
                    updated_at = NOW();
                
                RAISE NOTICE 'bet 레코드 저장: txid=%', v_txid;
                v_success_count := v_success_count + 1;
            END IF;
            
            -- 사용자 잔고 업데이트
            IF v_balance_after > 0 THEN
                UPDATE users 
                SET balance = v_balance_after, updated_at = NOW()
                WHERE id = v_user_uuid 
                AND (balance IS NULL OR balance != v_balance_after);
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
    
    RAISE NOTICE '========== 배치 저장 완료: 성공=%, 실패=% ==========', v_success_count, v_error_count;
    
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated;

COMMENT ON FUNCTION save_betting_records_batch IS 'API 응답 필드명(txid, username, bet, win, balance, round_id, create_at)을 그대로 사용하여 베팅 내역을 저장합니다.';

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ API 필드명 그대로 사용하도록 수정 완료: round_id 컬럼 사용';
END $$;
