-- 정산 및 거래 기능을 위한 스키마 업데이트
-- database-schema.sql에 추가할 컬럼들

-- 1. transactions 테이블에 외부 API 응답 저장 컬럼 추가 (이미 존재함)
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_response JSONB;

-- 2. 파트너 테이블에 실시간 동기화 관련 컬럼 추가
ALTER TABLE partners ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'error'));

-- 3. 거래 테이블에 실시간 알림 상태 컬럼 추가
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS auto_processed BOOLEAN DEFAULT FALSE;

-- 4. 정산 테이블에 자동 정산 관련 컬럼 추가
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS auto_calculated BOOLEAN DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS calculation_details JSONB;

-- 5. API 동기화 로그 테이블에 알림 관련 컬럼 추가
ALTER TABLE api_sync_logs ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE;

-- 6. 실시간 알림을 위한 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_transactions_notification ON transactions(notification_sent, status, created_at);
CREATE INDEX IF NOT EXISTS idx_partners_sync_status ON partners(sync_status, last_sync_at);
CREATE INDEX IF NOT EXISTS idx_settlements_auto_calc ON settlements(auto_calculated, status);

-- 7. 거래 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW transaction_stats AS
SELECT 
    DATE(created_at) as transaction_date,
    transaction_type,
    status,
    COUNT(*) as transaction_count,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount
FROM transactions 
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at), transaction_type, status
ORDER BY transaction_date DESC, transaction_type;

-- 8. 파트너별 정산 통계 뷰 생성
CREATE OR REPLACE VIEW partner_settlement_stats AS
SELECT 
    p.id as partner_id,
    p.nickname as partner_name,
    p.level as partner_level,
    DATE(s.created_at) as settlement_date,
    s.settlement_type,
    SUM(s.total_bet_amount) as total_bet,
    SUM(s.total_win_amount) as total_win,
    SUM(s.commission_amount) as total_commission
FROM partners p
LEFT JOIN settlements s ON p.id = s.partner_id
WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY p.id, p.nickname, p.level, DATE(s.created_at), s.settlement_type
ORDER BY settlement_date DESC, partner_level;

-- 9. 실시간 대시보드를 위한 함수 생성
CREATE OR REPLACE FUNCTION get_realtime_settlement_stats(partner_level_param INTEGER DEFAULT 6)
RETURNS TABLE (
    pending_transactions INTEGER,
    today_deposits DECIMAL(15,2),
    today_withdrawals DECIMAL(15,2),
    total_commission DECIMAL(15,2),
    pending_settlements INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*)::INTEGER FROM transactions WHERE status = 'pending')::INTEGER,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions 
         WHERE transaction_type = 'deposit' 
         AND status = 'completed' 
         AND DATE(created_at) = CURRENT_DATE)::DECIMAL(15,2),
        (SELECT COALESCE(SUM(amount), 0) FROM transactions 
         WHERE transaction_type = 'withdrawal' 
         AND status = 'completed' 
         AND DATE(created_at) = CURRENT_DATE)::DECIMAL(15,2),
        (SELECT COALESCE(SUM(commission_amount), 0) FROM settlements 
         WHERE status = 'completed' 
         AND DATE(created_at) = CURRENT_DATE)::DECIMAL(15,2),
        (SELECT COUNT(*)::INTEGER FROM settlements WHERE status = 'pending')::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- 10. 자동 정산 처리를 위한 함수
CREATE OR REPLACE FUNCTION auto_calculate_settlements()
RETURNS INTEGER AS $$
DECLARE 
    settlement_count INTEGER := 0;
    partner_record RECORD;
    rolling_amount DECIMAL(15,2);
    losing_amount DECIMAL(15,2);
BEGIN
    -- 어제 날짜의 모든 파트너에 대해 정산 계산
    FOR partner_record IN 
        SELECT p.id, p.commission_rolling, p.commission_losing
        FROM partners p 
        WHERE p.level > 1 AND p.status = 'active'
    LOOP
        -- 롤링 정산 계산
        SELECT COALESCE(SUM(gr.bet_amount), 0) * partner_record.commission_rolling / 100
        INTO rolling_amount
        FROM game_records gr
        JOIN users u ON gr.user_id = u.id
        WHERE u.referrer_id = partner_record.id
        AND DATE(gr.played_at) = CURRENT_DATE - INTERVAL '1 day';
        
        -- 루징 정산 계산
        SELECT COALESCE(SUM(gr.bet_amount - gr.win_amount), 0) * partner_record.commission_losing / 100
        INTO losing_amount
        FROM game_records gr
        JOIN users u ON gr.user_id = u.id
        WHERE u.referrer_id = partner_record.id
        AND DATE(gr.played_at) = CURRENT_DATE - INTERVAL '1 day'
        AND gr.bet_amount > gr.win_amount;
        
        -- 롤링 정산 레코드 생성
        IF rolling_amount > 0 THEN
            INSERT INTO settlements (
                partner_id, settlement_type, period_start, period_end,
                total_bet_amount, commission_rate, commission_amount,
                auto_calculated, status
            ) VALUES (
                partner_record.id, 'rolling', 
                CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE - INTERVAL '1 day',
                rolling_amount * 100 / partner_record.commission_rolling,
                partner_record.commission_rolling, rolling_amount,
                TRUE, 'completed'
            );
            settlement_count := settlement_count + 1;
        END IF;
        
        -- 루징 정산 레코드 생성
        IF losing_amount > 0 THEN
            INSERT INTO settlements (
                partner_id, settlement_type, period_start, period_end,
                total_bet_amount, total_win_amount, commission_rate, commission_amount,
                auto_calculated, status
            ) VALUES (
                partner_record.id, 'losing',
                CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE - INTERVAL '1 day',
                0, 0, partner_record.commission_losing, losing_amount,
                TRUE, 'completed'
            );
            settlement_count := settlement_count + 1;
        END IF;
    END LOOP;
    
    RETURN settlement_count;
END;
$$ LANGUAGE plpgsql;