-- =====================================================
-- 사용자 페이지를 위한 추가 함수들
-- =====================================================

-- 기존 함수 삭제 (반환 타입 충돌 방지)
DROP FUNCTION IF EXISTS get_user_opcode(uuid);

-- 사용자의 OPCODE 정보 조회 함수
CREATE OR REPLACE FUNCTION get_user_opcode(user_id UUID)
RETURNS TABLE (
    opcode VARCHAR(100),
    secret_key VARCHAR(255),
    api_token VARCHAR(255)
) AS $function$
BEGIN
    RETURN QUERY
    WITH RECURSIVE user_hierarchy AS (
        -- 사용자의 직속 파트너부터 시작
        SELECT p.id, p.parent_id, p.level, p.opcode, p.secret_key, p.api_token
        FROM partners p
        JOIN users u ON u.referrer_id = p.id
        WHERE u.id = user_id
        
        UNION ALL
        
        -- 상위 파트너들을 재귀적으로 조회
        SELECT p.id, p.parent_id, p.level, p.opcode, p.secret_key, p.api_token
        FROM partners p
        JOIN user_hierarchy uh ON p.id = uh.parent_id
    )
    SELECT uh.opcode, uh.secret_key, uh.api_token
    FROM user_hierarchy uh
    WHERE uh.opcode IS NOT NULL 
    AND uh.secret_key IS NOT NULL 
    AND uh.api_token IS NOT NULL
    ORDER BY uh.level ASC
    LIMIT 1;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 함수 삭제 (반환 타입 충돌 방지)
DROP FUNCTION IF EXISTS get_user_visible_games(uuid, text);

-- 사용자가 볼 수 있는 게임 목록 조회 함수
CREATE OR REPLACE FUNCTION get_user_visible_games(user_id UUID, game_type TEXT DEFAULT NULL)
RETURNS TABLE (
    id INTEGER,
    name VARCHAR(200),
    provider_id INTEGER,
    provider_name VARCHAR(100),
    type VARCHAR(20),
    status VARCHAR(20),
    image_url TEXT,
    demo_available BOOLEAN
) AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        g.id,
        g.name,
        g.provider_id,
        gp.name as provider_name,
        g.type,
        g.status,
        g.image_url,
        g.demo_available
    FROM games g
    JOIN game_providers gp ON g.provider_id = gp.id
    WHERE g.status = 'visible'
    AND gp.status = 'active'
    AND (game_type IS NULL OR g.type = game_type)
    ORDER BY g.name;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 함수 삭제 (반환 타입 충돌 방지)
DROP FUNCTION IF EXISTS get_user_statistics(uuid);

-- 사용자 통계 조회 함수
CREATE OR REPLACE FUNCTION get_user_statistics(user_id UUID)
RETURNS TABLE (
    total_deposits DECIMAL(15,2),
    total_withdrawals DECIMAL(15,2),  
    total_bets DECIMAL(15,2),
    total_wins DECIMAL(15,2),
    game_count BIGINT,
    win_rate DECIMAL(5,2)
) AS $function$
DECLARE
    deposit_sum DECIMAL(15,2) := 0;
    withdrawal_sum DECIMAL(15,2) := 0;
    bet_sum DECIMAL(15,2) := 0;
    win_sum DECIMAL(15,2) := 0;
    games_played BIGINT := 0;
    winning_games BIGINT := 0;
    calculated_win_rate DECIMAL(5,2) := 0;
BEGIN
    -- 입금 총액 계산
    SELECT COALESCE(SUM(amount), 0) INTO deposit_sum
    FROM transactions 
    WHERE user_id = get_user_statistics.user_id 
    AND transaction_type = 'deposit' 
    AND status = 'completed';
    
    -- 출금 총액 계산
    SELECT COALESCE(SUM(amount), 0) INTO withdrawal_sum
    FROM transactions 
    WHERE user_id = get_user_statistics.user_id 
    AND transaction_type = 'withdrawal' 
    AND status = 'completed';
    
    -- 베팅 총액 및 당첨 총액 계산
    SELECT 
        COALESCE(SUM(bet_amount), 0),
        COALESCE(SUM(win_amount), 0),
        COUNT(*)
    INTO bet_sum, win_sum, games_played
    FROM game_records 
    WHERE user_id = get_user_statistics.user_id;
    
    -- 승리한 게임 수 계산
    SELECT COUNT(*) INTO winning_games
    FROM game_records 
    WHERE user_id = get_user_statistics.user_id 
    AND win_amount > bet_amount;
    
    -- 승률 계산
    IF games_played > 0 THEN
        calculated_win_rate := (winning_games::DECIMAL / games_played::DECIMAL) * 100;
    END IF;
    
    RETURN QUERY SELECT 
        deposit_sum,
        withdrawal_sum,
        bet_sum,
        win_sum,
        games_played,
        calculated_win_rate;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 포인트 전환 함수 DROP (파라미터 이름 변경을 위해)
DROP FUNCTION IF EXISTS convert_points_to_balance(uuid, numeric);

-- 포인트를 잔고로 전환하는 함수 재생성
CREATE OR REPLACE FUNCTION convert_points_to_balance(
    user_id UUID,
    points_amount DECIMAL(15,2)
)
RETURNS BOOLEAN AS $function$
DECLARE
    current_points DECIMAL(15,2);
    current_balance DECIMAL(15,2);
BEGIN
    -- 사용자의 현재 포인트와 잔고 조회
    SELECT points, balance INTO current_points, current_balance
    FROM users 
    WHERE id = user_id;
    
    -- 포인트 부족 체크
    IF current_points < points_amount THEN
        RAISE EXCEPTION '보유 포인트가 부족합니다.';
    END IF;
    
    -- 사용자 포인트 차감 및 잔고 증가
    UPDATE users 
    SET 
        points = points - points_amount,
        balance = balance + points_amount,
        updated_at = NOW()
    WHERE id = user_id;
    
    -- 포인트 거래 기록
    INSERT INTO point_transactions (
        user_id,
        transaction_type,
        amount,
        points_before,
        points_after,
        memo
    ) VALUES (
        user_id,
        'convert_to_balance',
        points_amount,
        current_points,
        current_points - points_amount,
        '포인트를 잔고로 전환'
    );
    
    -- 잔고 거래 기록
    INSERT INTO transactions (
        user_id,
        transaction_type,
        amount,
        status,
        balance_before,
        balance_after,
        memo
    ) VALUES (
        user_id,
        'point_conversion',
        points_amount,
        'completed',
        current_balance,
        current_balance + points_amount,
        '포인트 전환'
    );
    
    RETURN TRUE;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;