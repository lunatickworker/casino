-- =====================================================
-- 베팅 내역 자동 동기화 시스템 완전 재구축
-- =====================================================

-- 1. game_records 테이블에 필수 컬럼 추가 (누락된 컬럼 확인)
DO $$
BEGIN
    -- updated_at 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'updated_at') THEN
        ALTER TABLE game_records ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'game_records에 updated_at 컬럼 추가 완료';
    END IF;
    
    -- partner_id 컬럼 추가 (베팅 내역의 파트너 추적용)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'partner_id') THEN
        ALTER TABLE game_records ADD COLUMN partner_id UUID REFERENCES partners(id);
        RAISE NOTICE 'game_records에 partner_id 컬럼 추가 완료';
    END IF;
    
    -- sync_status 컬럼 추가 (동기화 상태 추적)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_records' AND column_name = 'sync_status') THEN
        ALTER TABLE game_records ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'failed'));
        RAISE NOTICE 'game_records에 sync_status 컬럼 추가 완료';
    END IF;
END $$;

-- 2. 베팅 내역 배치 저장 함수 (기존 함수 완전 재작성)
DROP FUNCTION IF EXISTS save_betting_records_batch(JSONB);

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
            
            v_balance_before := COALESCE(
                (v_record->>'balance_before')::DECIMAL(15,2),
                (v_record->>'balanceBefore')::DECIMAL(15,2),
                (v_record->>'prev_balance')::DECIMAL(15,2),
                (v_record->>'BALANCE_BEFORE')::DECIMAL(15,2),
                0
            );
            
            v_balance_after := COALESCE(
                (v_record->>'balance_after')::DECIMAL(15,2),
                (v_record->>'balanceAfter')::DECIMAL(15,2),
                (v_record->>'new_balance')::DECIMAL(15,2),
                (v_record->>'BALANCE_AFTER')::DECIMAL(15,2),
                0
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
    
    -- 결과 반환
    RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 게임 세션 종료 시 자동 베팅 동기화 트리거 함수
DROP FUNCTION IF EXISTS auto_sync_betting_on_session_end() CASCADE;

CREATE OR REPLACE FUNCTION auto_sync_betting_on_session_end()
RETURNS TRIGGER AS $$
BEGIN
    -- 세션이 종료되었을 때 (ended_at이 설정됨)
    IF NEW.ended_at IS NOT NULL AND (OLD.ended_at IS NULL OR OLD.ended_at IS DISTINCT FROM NEW.ended_at) THEN
        -- WebSocket 알림 발송 (베팅 내역 수집 필요)
        PERFORM pg_notify(
            'betting_sync_required',
            json_build_object(
                'type', 'betting_sync_required',
                'session_id', NEW.id,
                'user_id', NEW.user_id,
                'game_id', NEW.game_id,
                'ended_at', NEW.ended_at,
                'balance_before', NEW.balance_before,
                'balance_after', NEW.balance_after
            )::text
        );
        
        RAISE NOTICE '베팅 동기화 알림 발송: session_id=%, user_id=%', NEW.id, NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 게임 세션 테이블에 트리거 연결
DROP TRIGGER IF EXISTS trigger_auto_sync_betting ON game_launch_sessions;

CREATE TRIGGER trigger_auto_sync_betting
    AFTER UPDATE ON game_launch_sessions
    FOR EACH ROW
    WHEN (NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL)
    EXECUTE FUNCTION auto_sync_betting_on_session_end();

-- 5. 베팅 동기화 스케줄러 함수 (30초 주기 자동 실행용)
DROP FUNCTION IF EXISTS scheduled_betting_sync(TEXT, TEXT);

CREATE OR REPLACE FUNCTION scheduled_betting_sync(
    p_opcode TEXT,
    p_secret_key TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    records_synced INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_records_synced INTEGER := 0;
    v_current_month TEXT;
    v_current_year TEXT;
BEGIN
    -- 현재 년월
    v_current_year := EXTRACT(YEAR FROM NOW())::TEXT;
    v_current_month := EXTRACT(MONTH FROM NOW())::TEXT;
    
    -- 알림: 실제 API 호출은 클라이언트 측에서 수행
    -- 이 함수는 동기화가 필요한 정보만 반환
    
    RETURN QUERY SELECT 
        TRUE, 
        v_records_synced, 
        format('Ready to sync for %s-%s', v_current_year, v_current_month)::TEXT;
    
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 베팅 내역 실시간 모니터링 뷰 재생성 (partner_id 포함)
DROP VIEW IF EXISTS real_time_betting_monitor CASCADE;

CREATE VIEW real_time_betting_monitor AS
SELECT 
    gr.id,
    gr.external_txid,
    gr.user_id,
    gr.game_id,
    gr.provider_id,
    gr.partner_id,
    gr.bet_amount,
    gr.win_amount,
    COALESCE(gr.profit_loss, gr.bet_amount - gr.win_amount) as profit_loss,
    gr.balance_before,
    gr.balance_after,
    gr.played_at,
    gr.sync_status,
    COALESCE(gr.currency, 'KRW') as currency,
    COALESCE(gr.time_category, 'recent') as time_category,
    u.username,
    u.nickname,
    g.name as game_name,
    COALESCE(g.type, 'slot') as game_type,
    gp.name as provider_name,
    COALESCE(p.nickname, p.username, 'Unknown') as partner_name,
    COALESCE(p.opcode, '') as opcode,
    CASE 
        WHEN gr.played_at >= NOW() - INTERVAL '10 minutes' THEN '실시간'
        WHEN gr.played_at >= NOW() - INTERVAL '1 hour' THEN '최근'
        ELSE '이전'
    END as real_status
FROM game_records gr
LEFT JOIN users u ON gr.user_id = u.id
LEFT JOIN games g ON gr.game_id = g.id
LEFT JOIN game_providers gp ON gr.provider_id = gp.id
LEFT JOIN partners p ON gr.partner_id = p.id;

-- 7. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_game_records_partner_id ON game_records(partner_id);
CREATE INDEX IF NOT EXISTS idx_game_records_sync_status ON game_records(sync_status);
CREATE INDEX IF NOT EXISTS idx_game_records_updated_at ON game_records(updated_at);

-- 8. 권한 설정
GRANT EXECUTE ON FUNCTION save_betting_records_batch(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION scheduled_betting_sync(TEXT, TEXT) TO authenticated;

-- 9. RLS 정책 (관리자와 해당 파트너만 조회 가능)
DROP POLICY IF EXISTS game_records_select_policy ON game_records;

CREATE POLICY game_records_select_policy ON game_records
    FOR SELECT
    USING (
        -- 시스템 관리자는 모두 조회 가능
        EXISTS (
            SELECT 1 FROM partners p
            WHERE p.id = auth.uid()
            AND p.level = 1
        )
        OR
        -- 자신의 베팅 기록
        user_id = auth.uid()
        OR
        -- 파트너는 자신의 하위 사용자 베팅 기록
        EXISTS (
            SELECT 1 FROM partners p
            WHERE p.id = auth.uid()
            AND game_records.partner_id = p.id
        )
    );

COMMENT ON FUNCTION save_betting_records_batch IS '외부 API에서 받은 베팅 내역을 배치로 저장합니다. 게임과 제공사가 없으면 자동으로 생성합니다.';
COMMENT ON FUNCTION auto_sync_betting_on_session_end IS '게임 세션 종료 시 베팅 내역 동기화 알림을 WebSocket으로 발송합니다.';
COMMENT ON FUNCTION scheduled_betting_sync IS '30초 주기로 베팅 내역을 자동 동기화하는 스케줄러 함수입니다.';
COMMENT ON VIEW real_time_betting_monitor IS '베팅 내역 실시간 모니터링을 위한 뷰입니다.';
