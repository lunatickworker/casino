-- =====================================================
-- stat_date ambiguous 오류 수정
-- =====================================================
-- game_stats_cache 트리거 함수 수정
-- 문제: ON CONFLICT절에서 stat_date 컬럼 참조가 모호함
-- 해결: 테이블 별칭을 명확히 지정
-- =====================================================

-- 1. 기존 트리거 함수 수정 (테이블 별칭 명확화)
DROP FUNCTION IF EXISTS update_game_stats_cache() CASCADE;

CREATE OR REPLACE FUNCTION update_game_stats_cache()
RETURNS TRIGGER AS $$
BEGIN
    -- game_stats_cache 테이블이 존재하는지 확인
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_stats_cache') THEN
        -- 게임 기록이 추가될 때마다 통계 캐시 업데이트
        INSERT INTO game_stats_cache (
            provider_id, 
            game_id, 
            stat_date, 
            total_bets, 
            total_bet_amount, 
            total_win_amount, 
            unique_players, 
            updated_at
        )
        VALUES (
            NEW.provider_id,
            NEW.game_id,
            NEW.played_at::date,
            1,
            COALESCE(NEW.bet_amount, 0),
            COALESCE(NEW.win_amount, 0),
            1,
            NOW()
        )
        ON CONFLICT (provider_id, game_id, stat_date)
        DO UPDATE SET
            total_bets = game_stats_cache.total_bets + 1,
            total_bet_amount = game_stats_cache.total_bet_amount + COALESCE(EXCLUDED.total_bet_amount, 0),
            total_win_amount = game_stats_cache.total_win_amount + COALESCE(EXCLUDED.total_win_amount, 0),
            updated_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. update_game_stats 함수도 수정 (파트너/사용자 통계용)
DROP FUNCTION IF EXISTS update_game_stats() CASCADE;

CREATE OR REPLACE FUNCTION update_game_stats()
RETURNS TRIGGER AS $$
DECLARE
    partner_rec RECORD;
    v_stat_date DATE := CURRENT_DATE;
BEGIN
    -- 사용자의 파트너 정보 조회
    SELECT p.* INTO partner_rec
    FROM partners p
    JOIN users u ON u.referrer_id = p.id
    WHERE u.id = NEW.user_id;
    
    -- 파트너가 있으면 파트너 통계 업데이트
    IF FOUND AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'partner_daily_stats') THEN
        -- 파트너 통계 업데이트
        INSERT INTO partner_daily_stats (
            partner_id, 
            stat_date, 
            total_bets, 
            total_wins
        )
        VALUES (
            partner_rec.id, 
            v_stat_date, 
            COALESCE(NEW.bet_amount, 0), 
            COALESCE(NEW.win_amount, 0)
        )
        ON CONFLICT (partner_id, stat_date) 
        DO UPDATE SET
            total_bets = partner_daily_stats.total_bets + COALESCE(EXCLUDED.total_bets, 0),
            total_wins = partner_daily_stats.total_wins + COALESCE(EXCLUDED.total_wins, 0),
            updated_at = NOW();
    END IF;
    
    -- 사용자 통계 업데이트
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_daily_stats') THEN
        INSERT INTO user_daily_stats (
            user_id, 
            stat_date, 
            games_played, 
            total_bet, 
            total_win, 
            profit_loss
        )
        VALUES (
            NEW.user_id, 
            v_stat_date, 
            1, 
            COALESCE(NEW.bet_amount, 0), 
            COALESCE(NEW.win_amount, 0), 
            COALESCE(NEW.win_amount, 0) - COALESCE(NEW.bet_amount, 0)
        )
        ON CONFLICT (user_id, stat_date) 
        DO UPDATE SET
            games_played = user_daily_stats.games_played + 1,
            total_bet = user_daily_stats.total_bet + COALESCE(EXCLUDED.total_bet, 0),
            total_win = user_daily_stats.total_win + COALESCE(EXCLUDED.total_win, 0),
            profit_loss = user_daily_stats.profit_loss + COALESCE(EXCLUDED.profit_loss, 0),
            updated_at = NOW();
    END IF;
    
    -- 게임 플레이 카운트 업데이트
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'games' AND NEW.game_id IS NOT NULL) THEN
        UPDATE games 
        SET 
            play_count = COALESCE(play_count, 0) + 1,
            last_played_at = NOW()
        WHERE id = NEW.game_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. 트리거 재생성 (기존 트리거가 있으면 삭제 후 생성)
DROP TRIGGER IF EXISTS update_game_stats_cache_trigger ON game_records;
CREATE TRIGGER update_game_stats_cache_trigger
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION update_game_stats_cache();

DROP TRIGGER IF EXISTS trigger_update_game_stats ON game_records;
CREATE TRIGGER trigger_update_game_stats
    AFTER INSERT ON game_records
    FOR EACH ROW
    EXECUTE FUNCTION update_game_stats();

-- 4. 권한 설정
GRANT EXECUTE ON FUNCTION update_game_stats_cache() TO authenticated;
GRANT EXECUTE ON FUNCTION update_game_stats() TO authenticated;

COMMENT ON FUNCTION update_game_stats_cache IS '게임 통계 캐시를 업데이트합니다. stat_date ambiguous 오류를 수정했습니다.';
COMMENT ON FUNCTION update_game_stats IS '게임 플레이 시 파트너/사용자 통계를 업데이트합니다.';
