-- ============================================================================
-- 347. game_records 외래 키 제약조건 수정 (존재하지 않는 game_id 허용)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '347. game_records 외래 키 수정';
    RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 1단계: game_code 컬럼 추가 (외부 API game_id 저장용)
-- ============================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_records' AND column_name = 'game_code'
    ) THEN
        ALTER TABLE game_records ADD COLUMN game_code TEXT;
        CREATE INDEX IF NOT EXISTS idx_game_records_game_code ON game_records(game_code);
        RAISE NOTICE '✅ game_code 컬럼 추가';
    ELSE
        RAISE NOTICE 'ℹ️ game_code 컬럼 이미 존재';
    END IF;
END $$;

-- ============================================
-- 2단계: game_id 외래 키 제약조건 삭제 및 nullable로 변경
-- ============================================

DO $$
BEGIN
    -- 외래 키 제약조건 삭제
    ALTER TABLE game_records DROP CONSTRAINT IF EXISTS game_records_game_id_fkey;
    RAISE NOTICE '✅ game_id 외래 키 제약조건 삭제';
    
    -- game_id를 nullable로 변경
    ALTER TABLE game_records ALTER COLUMN game_id DROP NOT NULL;
    RAISE NOTICE '✅ game_id nullable로 변경';
    
    -- 새로운 외래 키 추가 (ON DELETE SET NULL)
    ALTER TABLE game_records 
        ADD CONSTRAINT game_records_game_id_fkey 
        FOREIGN KEY (game_id) 
        REFERENCES games(id) 
        ON DELETE SET NULL;
    RAISE NOTICE '✅ game_id 외래 키 재생성 (ON DELETE SET NULL)';
END $$;

-- ============================================
-- 3단계: 베팅 저장 함수들 수정 - game_id가 없으면 NULL 처리
-- ============================================

-- 3.1 save_betting_records_batch 함수 재생성
CREATE OR REPLACE FUNCTION save_betting_records_batch(p_records JSONB)
RETURNS JSONB AS $$
DECLARE
    v_record JSONB;
    v_txid BIGINT;
    v_username TEXT;
    v_user_uuid UUID;
    v_partner_id UUID;
    v_game_id INTEGER;
    v_game_exists BOOLEAN;
    v_provider_id INTEGER;
    v_bet_amount DECIMAL;
    v_win_amount DECIMAL;
    v_balance_before DECIMAL;
    v_balance_after DECIMAL;
    v_round_id TEXT;
    v_played_at TIMESTAMP WITH TIME ZONE;
    v_success_count INTEGER := 0;
    v_error_count INTEGER := 0;
    v_errors JSONB := '[]'::JSONB;
BEGIN
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        BEGIN
            v_txid := (v_record->>'txid')::BIGINT;
            v_username := v_record->>'username';
            v_game_id := (v_record->>'game_id')::INTEGER;
            v_provider_id := (v_record->>'provider_id')::INTEGER;
            v_bet_amount := (v_record->>'bet_amount')::DECIMAL;
            v_win_amount := (v_record->>'win_amount')::DECIMAL;
            v_balance_before := (v_record->>'balance_before')::DECIMAL;
            v_balance_after := (v_record->>'balance_after')::DECIMAL;
            v_round_id := v_record->>'round_id';
            v_played_at := (v_record->>'played_at')::TIMESTAMP WITH TIME ZONE;
            
            SELECT id, referrer_id INTO v_user_uuid, v_partner_id
            FROM users
            WHERE username = v_username
            LIMIT 1;
            
            IF v_user_uuid IS NULL THEN
                v_errors := v_errors || jsonb_build_object(
                    'txid', v_txid,
                    'error', '사용자를 찾을 수 없음: ' || v_username
                );
                v_error_count := v_error_count + 1;
                CONTINUE;
            END IF;
            
            -- games 테이블에 game_id 존재 여부 확인
            SELECT EXISTS(SELECT 1 FROM games WHERE id = v_game_id) INTO v_game_exists;
            
            IF NOT v_game_exists THEN
                -- game_id가 없으면 NULL로 처리
                v_game_id := NULL;
            END IF;
            
            INSERT INTO game_records (
                external_txid,
                user_id,
                partner_id,
                game_id,
                game_code,
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
                (v_record->>'game_id')::TEXT,
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
                game_id = EXCLUDED.game_id,
                game_code = EXCLUDED.game_code,
                external_data = EXCLUDED.external_data,
                sync_status = 'synced',
                updated_at = NOW();
            
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'txid', v_txid,
                'error', SQLERRM
            );
            v_error_count := v_error_count + 1;
        END;
    END LOOP;
    
    RETURN jsonb_build_object(
        'success', v_success_count,
        'errors', v_error_count,
        'error_details', v_errors
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    RAISE NOTICE '✅ save_betting_records_batch 함수 재생성';
END $$;

-- ============================================
-- 4단계: 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 347 완료';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '변경 사항:';
    RAISE NOTICE '  1. game_code 컬럼 추가 (외부 API game_id 저장)';
    RAISE NOTICE '  2. game_id nullable로 변경';
    RAISE NOTICE '  3. game_id 외래 키 ON DELETE SET NULL로 재생성';
    RAISE NOTICE '  4. save_betting_records_batch 함수 수정';
    RAISE NOTICE '';
    RAISE NOTICE '결과:';
    RAISE NOTICE '  • games 테이블에 없는 game_id도 저장 가능';
    RAISE NOTICE '  • game_code에 원본 game_id 저장';
    RAISE NOTICE '  • game_id는 games 테이블 참조용 (있으면 저장, 없으면 NULL)';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
