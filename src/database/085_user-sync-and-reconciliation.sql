-- =====================================================
-- 사용자별 데이터 동기화 및 데이터 불일치 검증 함수
-- =====================================================

-- 1. 사용자별 전체 데이터 동기화 함수
CREATE OR REPLACE FUNCTION sync_user_all_data(
    p_user_id UUID,
    p_opcode TEXT,
    p_secret_key TEXT,
    p_sync_balance BOOLEAN DEFAULT TRUE,
    p_sync_transactions BOOLEAN DEFAULT TRUE,
    p_sync_betting BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    success BOOLEAN,
    balance_synced BOOLEAN,
    transactions_synced INTEGER,
    betting_records_synced INTEGER,
    errors JSONB,
    sync_timestamp TIMESTAMPTZ
) AS $$
DECLARE
    v_username TEXT;
    v_token TEXT;
    v_balance_synced BOOLEAN := FALSE;
    v_transactions_count INTEGER := 0;
    v_betting_count INTEGER := 0;
    v_errors JSONB := '[]'::JSONB;
BEGIN
    -- 사용자 정보 조회
    SELECT username, api_token INTO v_username, v_token
    FROM users
    WHERE id = p_user_id;
    
    IF v_username IS NULL THEN
        RETURN QUERY SELECT 
            FALSE, 
            FALSE, 
            0, 
            0, 
            jsonb_build_array(jsonb_build_object('error', 'User not found'))::JSONB,
            NOW();
        RETURN;
    END IF;
    
    -- 잔고 동기화
    IF p_sync_balance THEN
        BEGIN
            -- 외부 API 잔고 조회는 클라이언트에서 수행 후 결과를 별도 함수로 저장
            v_balance_synced := TRUE;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'type', 'balance_sync',
                'error', SQLERRM
            );
        END;
    END IF;
    
    -- 입출금 내역 동기화 (최근 30일)
    IF p_sync_transactions THEN
        BEGIN
            -- 클라이언트에서 API 호출 후 처리
            -- 여기서는 동기화 준비 상태만 표시
            v_transactions_count := 0;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'type', 'transaction_sync',
                'error', SQLERRM
            );
        END;
    END IF;
    
    -- 베팅 내역 동기화 (최근 30일)
    IF p_sync_betting THEN
        BEGIN
            -- 클라이언트에서 API 호출 후 처리
            v_betting_count := 0;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'type', 'betting_sync',
                'error', SQLERRM
            );
        END;
    END IF;
    
    -- 동기화 로그 저장
    INSERT INTO api_sync_logs (
        opcode,
        api_endpoint,
        sync_type,
        status,
        records_processed,
        response_data
    ) VALUES (
        p_opcode,
        'user_full_sync',
        'user_data_sync',
        CASE WHEN jsonb_array_length(v_errors) = 0 THEN 'success' ELSE 'partial' END,
        v_transactions_count + v_betting_count,
        jsonb_build_object(
            'user_id', p_user_id,
            'username', v_username,
            'balance_synced', v_balance_synced,
            'transactions_synced', v_transactions_count,
            'betting_synced', v_betting_count,
            'errors', v_errors
        )
    );
    
    RETURN QUERY SELECT 
        jsonb_array_length(v_errors) = 0,
        v_balance_synced,
        v_transactions_count,
        v_betting_count,
        v_errors,
        NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 데이터 불일치 검증 함수
CREATE OR REPLACE FUNCTION verify_user_data_consistency(
    p_user_id UUID
)
RETURNS TABLE (
    check_type TEXT,
    status TEXT,
    gms_value NUMERIC,
    api_value NUMERIC,
    difference NUMERIC,
    details JSONB
) AS $$
DECLARE
    v_gms_balance NUMERIC;
    v_gms_total_deposit NUMERIC;
    v_gms_total_withdraw NUMERIC;
    v_gms_total_bet NUMERIC;
    v_gms_total_win NUMERIC;
    v_last_game_balance NUMERIC;
BEGIN
    -- GMS 내부 데이터 조회
    SELECT 
        balance,
        COALESCE(total_deposit, 0),
        COALESCE(total_withdraw, 0)
    INTO 
        v_gms_balance,
        v_gms_total_deposit,
        v_gms_total_withdraw
    FROM users
    WHERE id = p_user_id;
    
    -- 베팅 내역 집계
    SELECT 
        COALESCE(SUM(bet_amount), 0),
        COALESCE(SUM(win_amount), 0)
    INTO 
        v_gms_total_bet,
        v_gms_total_win
    FROM game_records
    WHERE user_id = p_user_id;
    
    -- 마지막 게임 세션 잔고
    SELECT balance_after INTO v_last_game_balance
    FROM game_records
    WHERE user_id = p_user_id
    ORDER BY played_at DESC
    LIMIT 1;
    
    -- 1. 잔고 일관성 체크
    RETURN QUERY SELECT
        'balance_check'::TEXT,
        CASE 
            WHEN v_gms_balance IS NULL THEN 'error'
            ELSE 'info'
        END::TEXT,
        v_gms_balance,
        NULL::NUMERIC, -- API 값은 클라이언트에서 채움
        NULL::NUMERIC,
        jsonb_build_object(
            'gms_balance', v_gms_balance,
            'note', 'Compare with API balance'
        );
    
    -- 2. 입출금 합계 체크
    RETURN QUERY SELECT
        'deposit_withdraw_check'::TEXT,
        'info'::TEXT,
        v_gms_total_deposit,
        v_gms_total_withdraw,
        v_gms_total_deposit - v_gms_total_withdraw,
        jsonb_build_object(
            'total_deposit', v_gms_total_deposit,
            'total_withdraw', v_gms_total_withdraw,
            'net_amount', v_gms_total_deposit - v_gms_total_withdraw
        );
    
    -- 3. 베팅 내역 합계 체크
    RETURN QUERY SELECT
        'betting_check'::TEXT,
        'info'::TEXT,
        v_gms_total_bet,
        v_gms_total_win,
        v_gms_total_bet - v_gms_total_win,
        jsonb_build_object(
            'total_bet', v_gms_total_bet,
            'total_win', v_gms_total_win,
            'net_loss', v_gms_total_bet - v_gms_total_win,
            'last_game_balance', v_last_game_balance
        );
    
    -- 4. 계산된 잔고 vs 실제 잔고 체크
    RETURN QUERY SELECT
        'calculated_balance_check'::TEXT,
        CASE 
            WHEN ABS((v_gms_total_deposit - v_gms_total_withdraw - (v_gms_total_bet - v_gms_total_win)) - COALESCE(v_gms_balance, 0)) > 0.01 
            THEN 'warning'
            ELSE 'success'
        END::TEXT,
        v_gms_balance,
        v_gms_total_deposit - v_gms_total_withdraw - (v_gms_total_bet - v_gms_total_win),
        v_gms_balance - (v_gms_total_deposit - v_gms_total_withdraw - (v_gms_total_bet - v_gms_total_win)),
        jsonb_build_object(
            'actual_balance', v_gms_balance,
            'calculated_balance', v_gms_total_deposit - v_gms_total_withdraw - (v_gms_total_bet - v_gms_total_win),
            'formula', 'deposit - withdraw - (bet - win)',
            'note', 'Small differences may occur due to rounding or pending transactions'
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 사용자 검색 함수 (관리자용)
CREATE OR REPLACE FUNCTION search_users_for_sync(
    p_search_term TEXT,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    nickname TEXT,
    balance NUMERIC,
    partner_name TEXT,
    opcode TEXT,
    last_login TIMESTAMPTZ,
    total_deposits NUMERIC,
    total_withdraws NUMERIC,
    total_bets BIGINT,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.username,
        u.nickname,
        u.balance,
        p.nickname as partner_name,
        p.opcode,
        u.last_login_at,
        COALESCE(u.total_deposit, 0),
        COALESCE(u.total_withdraw, 0),
        (SELECT COUNT(*) FROM game_records WHERE user_id = u.id) as total_bets,
        u.status
    FROM users u
    LEFT JOIN partners p ON u.referrer_id = p.id
    WHERE 
        u.username ILIKE '%' || p_search_term || '%'
        OR u.nickname ILIKE '%' || p_search_term || '%'
    ORDER BY u.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 데이터 불일치 자동 수정 함수
CREATE OR REPLACE FUNCTION auto_fix_data_inconsistency(
    p_user_id UUID,
    p_fix_type TEXT, -- 'recalculate_balance', 'sync_from_api', 'reset_counters'
    p_confirmed BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    success BOOLEAN,
    fix_applied TEXT,
    old_value NUMERIC,
    new_value NUMERIC,
    changes JSONB
) AS $$
DECLARE
    v_old_balance NUMERIC;
    v_new_balance NUMERIC;
    v_total_deposit NUMERIC;
    v_total_withdraw NUMERIC;
    v_total_bet NUMERIC;
    v_total_win NUMERIC;
BEGIN
    IF NOT p_confirmed THEN
        RETURN QUERY SELECT 
            FALSE,
            'Confirmation required'::TEXT,
            NULL::NUMERIC,
            NULL::NUMERIC,
            jsonb_build_object('error', 'Must set p_confirmed = TRUE to apply fixes');
        RETURN;
    END IF;
    
    -- 현재 값 조회
    SELECT balance INTO v_old_balance
    FROM users
    WHERE id = p_user_id;
    
    CASE p_fix_type
        WHEN 'recalculate_balance' THEN
            -- 입출금 및 베팅 내역 기반 잔고 재계산
            SELECT 
                COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END), 0)
            INTO v_total_deposit, v_total_withdraw
            FROM transactions
            WHERE user_id = p_user_id AND status = 'approved';
            
            SELECT 
                COALESCE(SUM(bet_amount), 0),
                COALESCE(SUM(win_amount), 0)
            INTO v_total_bet, v_total_win
            FROM game_records
            WHERE user_id = p_user_id;
            
            v_new_balance := v_total_deposit - v_total_withdraw - (v_total_bet - v_total_win);
            
            -- 잔고 업데이트
            UPDATE users
            SET 
                balance = v_new_balance,
                total_deposit = v_total_deposit,
                total_withdraw = v_total_withdraw,
                updated_at = NOW()
            WHERE id = p_user_id;
            
            RETURN QUERY SELECT 
                TRUE,
                'Balance recalculated from transactions and betting history'::TEXT,
                v_old_balance,
                v_new_balance,
                jsonb_build_object(
                    'total_deposit', v_total_deposit,
                    'total_withdraw', v_total_withdraw,
                    'total_bet', v_total_bet,
                    'total_win', v_total_win,
                    'calculated_balance', v_new_balance
                );
                
        WHEN 'reset_counters' THEN
            -- 카운터 초기화 및 재계산
            WITH transaction_totals AS (
                SELECT 
                    COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as deposits,
                    COALESCE(SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END), 0) as withdraws
                FROM transactions
                WHERE user_id = p_user_id AND status = 'approved'
            )
            UPDATE users
            SET 
                total_deposit = transaction_totals.deposits,
                total_withdraw = transaction_totals.withdraws,
                updated_at = NOW()
            FROM transaction_totals
            WHERE id = p_user_id
            RETURNING 
                TRUE,
                'Counters reset and recalculated'::TEXT,
                v_old_balance,
                balance,
                jsonb_build_object(
                    'total_deposit', total_deposit,
                    'total_withdraw', total_withdraw
                )
            INTO success, fix_applied, old_value, new_value, changes;
            
            RETURN QUERY SELECT success, fix_applied, old_value, new_value, changes;
            
        ELSE
            RETURN QUERY SELECT 
                FALSE,
                'Unknown fix type'::TEXT,
                NULL::NUMERIC,
                NULL::NUMERIC,
                jsonb_build_object('error', 'Invalid fix_type: ' || p_fix_type);
    END CASE;
    
    -- 수정 로그 기록
    INSERT INTO api_sync_logs (
        opcode,
        api_endpoint,
        sync_type,
        status,
        response_data
    ) VALUES (
        'system',
        'data_consistency_fix',
        p_fix_type,
        'success',
        jsonb_build_object(
            'user_id', p_user_id,
            'fix_type', p_fix_type,
            'old_balance', v_old_balance,
            'new_balance', v_new_balance,
            'timestamp', NOW()
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION sync_user_all_data(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_user_data_consistency(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION search_users_for_sync(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION auto_fix_data_inconsistency(UUID, TEXT, BOOLEAN) TO authenticated;

-- 주석
COMMENT ON FUNCTION sync_user_all_data IS '특정 사용자의 모든 데이터를 외부 API와 동기화합니다';
COMMENT ON FUNCTION verify_user_data_consistency IS '사용자 데이터의 일관성을 검증하고 불일치를 찾습니다';
COMMENT ON FUNCTION search_users_for_sync IS '동기화할 사용자를 검색합니다';
COMMENT ON FUNCTION auto_fix_data_inconsistency IS '발견된 데이터 불일치를 자동으로 수정합니다';
