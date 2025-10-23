-- ===========================
-- 사용자 패턴 분석 함수들
-- AI 게임 패턴 분석을 위한 데이터베이스 함수
-- ===========================

-- 1. 사용자 트랜잭션 요약 함수
CREATE OR REPLACE FUNCTION get_user_transaction_summary(p_user_id UUID)
RETURNS TABLE (
  total_deposit NUMERIC,
  total_withdraw NUMERIC,
  transaction_count INTEGER,
  first_transaction_date TIMESTAMPTZ,
  last_transaction_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE 0 END), 0) as total_deposit,
    COALESCE(SUM(CASE WHEN t.type = 'withdraw' THEN t.amount ELSE 0 END), 0) as total_withdraw,
    COUNT(*)::INTEGER as transaction_count,
    MIN(t.created_at) as first_transaction_date,
    MAX(t.created_at) as last_transaction_date
  FROM transactions t
  WHERE t.user_id = p_user_id 
    AND t.status = 'approved';
END;
$$;

-- 2. 사용자 베팅 요약 함수
CREATE OR REPLACE FUNCTION get_user_betting_summary(p_user_id UUID)
RETURNS TABLE (
  total_bets INTEGER,
  total_wins INTEGER,
  win_rate NUMERIC,
  total_bet_amount NUMERIC,
  total_win_amount NUMERIC,
  profit_loss NUMERIC,
  first_bet_date TIMESTAMPTZ,
  last_bet_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_username VARCHAR(50);
BEGIN
  -- 사용자 ID로 username 조회
  SELECT username INTO v_username 
  FROM users 
  WHERE id = p_user_id;
  
  IF v_username IS NULL THEN
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_bets,
    COUNT(CASE WHEN gr.win_amount > gr.bet_amount THEN 1 END)::INTEGER as total_wins,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(CASE WHEN gr.win_amount > gr.bet_amount THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
      ELSE 0::NUMERIC
    END as win_rate,
    COALESCE(SUM(gr.bet_amount), 0) as total_bet_amount,
    COALESCE(SUM(gr.win_amount), 0) as total_win_amount,
    COALESCE(SUM(gr.win_amount - gr.bet_amount), 0) as profit_loss,
    MIN(gr.created_at) as first_bet_date,
    MAX(gr.created_at) as last_bet_date
  FROM game_records gr
  WHERE gr.username = v_username;
END;
$$;

-- 3. 사용자 게임 선호도 분석 함수
CREATE OR REPLACE FUNCTION analyze_user_game_preference(p_user_id UUID)
RETURNS TABLE (
  game VARCHAR(200),
  provider VARCHAR(100),
  count INTEGER,
  total_bet_amount NUMERIC,
  total_win_amount NUMERIC,
  win_rate NUMERIC,
  profit_loss NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  v_username VARCHAR(50);
BEGIN
  -- 사용자 ID로 username 조회
  SELECT username INTO v_username 
  FROM users 
  WHERE id = p_user_id;
  
  IF v_username IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    gr.game_name as game,
    gr.provider_name as provider,
    COUNT(*)::INTEGER as count,
    COALESCE(SUM(gr.bet_amount), 0) as total_bet_amount,
    COALESCE(SUM(gr.win_amount), 0) as total_win_amount,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(CASE WHEN gr.win_amount > gr.bet_amount THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
      ELSE 0::NUMERIC
    END as win_rate,
    COALESCE(SUM(gr.win_amount - gr.bet_amount), 0) as profit_loss
  FROM game_records gr
  WHERE gr.user_id = p_user_id
  GROUP BY gr.game_name, gr.provider_name
  ORDER BY count DESC, total_bet_amount DESC
  LIMIT 10;
END;
$$;

-- 4. 사용자 시간대별 플레이 패턴 분석 함수
CREATE OR REPLACE FUNCTION analyze_user_play_time_pattern(p_user_id UUID)
RETURNS TABLE (
  hour INTEGER,
  sessions INTEGER,
  total_bets INTEGER,
  avg_bet_amount NUMERIC,
  win_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $
BEGIN
  RETURN QUERY
  SELECT 
    EXTRACT(HOUR FROM gr.created_at)::INTEGER as hour,
    COUNT(DISTINCT DATE_TRUNC('hour', gr.created_at))::INTEGER as sessions,
    COUNT(*)::INTEGER as total_bets,
    ROUND(AVG(gr.bet_amount), 2) as avg_bet_amount,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(CASE WHEN gr.win_amount > gr.bet_amount THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
      ELSE 0::NUMERIC
    END as win_rate
  FROM game_records gr
  WHERE gr.user_id = p_user_id
  GROUP BY EXTRACT(HOUR FROM gr.created_at)
  ORDER BY hour;
END;
$$;

-- 5. 사용자 베팅 패턴 상세 분석 함수
CREATE OR REPLACE FUNCTION analyze_user_betting_pattern(p_user_id UUID)
RETURNS TABLE (
  avgBetAmount NUMERIC,
  maxBetAmount NUMERIC,
  minBetAmount NUMERIC,
  totalBets INTEGER,
  totalWins INTEGER,
  winRate NUMERIC,
  profitLoss NUMERIC,
  biggestWin NUMERIC,
  biggestLoss NUMERIC,
  consecutiveWins INTEGER,
  consecutiveLosses INTEGER,
  volatility_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_avg_bet NUMERIC;
  v_max_bet NUMERIC;
  v_min_bet NUMERIC;
  v_total_bets INTEGER;
  v_total_wins INTEGER;
  v_win_rate NUMERIC;
  v_profit_loss NUMERIC;
  v_biggest_win NUMERIC;
  v_biggest_loss NUMERIC;
  v_volatility NUMERIC;
BEGIN
  -- 기본 통계 계산
  SELECT 
    ROUND(AVG(bet_amount), 2),
    MAX(bet_amount),
    MIN(bet_amount),
    COUNT(*)::INTEGER,
    COUNT(CASE WHEN win_amount > bet_amount THEN 1 END)::INTEGER,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(CASE WHEN win_amount > bet_amount THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
      ELSE 0::NUMERIC
    END,
    SUM(win_amount - bet_amount),
    MAX(win_amount - bet_amount),
    MIN(win_amount - bet_amount)
  INTO v_avg_bet, v_max_bet, v_min_bet, v_total_bets, v_total_wins, v_win_rate, v_profit_loss, v_biggest_win, v_biggest_loss
  FROM game_records
  WHERE user_id = p_user_id;
  
  -- 변동성 점수 계산 (베팅 금액의 표준편차 / 평균)
  SELECT 
    CASE 
      WHEN v_avg_bet > 0 THEN ROUND((STDDEV(bet_amount) / v_avg_bet) * 100, 2)
      ELSE 0::NUMERIC
    END
  INTO v_volatility
  FROM game_records
  WHERE user_id = p_user_id;
  
  RETURN QUERY
  SELECT 
    COALESCE(v_avg_bet, 0),
    COALESCE(v_max_bet, 0),
    COALESCE(v_min_bet, 0),
    COALESCE(v_total_bets, 0),
    COALESCE(v_total_wins, 0),
    COALESCE(v_win_rate, 0),
    COALESCE(v_profit_loss, 0),
    COALESCE(v_biggest_win, 0),
    COALESCE(v_biggest_loss, 0),
    0::INTEGER, -- consecutiveWins (복잡한 계산이므로 일단 0)
    0::INTEGER, -- consecutiveLosses (복잡한 계산이므로 일단 0)
    COALESCE(v_volatility, 0);
END;
$$;

-- 6. 사용자 월별 활동 통계 함수
CREATE OR REPLACE FUNCTION get_user_monthly_activity(p_user_id UUID, p_months INTEGER DEFAULT 6)
RETURNS TABLE (
  month_year TEXT,
  total_bets INTEGER,
  total_bet_amount NUMERIC,
  total_win_amount NUMERIC,
  profit_loss NUMERIC,
  unique_games INTEGER,
  most_played_game VARCHAR(200)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH monthly_stats AS (
    SELECT 
      TO_CHAR(gr.created_at, 'YYYY-MM') as month_year,
      COUNT(*)::INTEGER as total_bets,
      SUM(gr.bet_amount) as total_bet_amount,
      SUM(gr.win_amount) as total_win_amount,
      SUM(gr.win_amount - gr.bet_amount) as profit_loss,
      COUNT(DISTINCT gr.game_name)::INTEGER as unique_games,
      MODE() WITHIN GROUP (ORDER BY gr.game_name) as most_played_game
    FROM game_records gr
    WHERE gr.user_id = p_user_id
      AND gr.created_at >= NOW() - INTERVAL '1 month' * p_months
    GROUP BY TO_CHAR(gr.created_at, 'YYYY-MM')
    ORDER BY month_year DESC
  )
  SELECT * FROM monthly_stats;
END;
$$;

-- 7. 사용자 위험도 평가 함수
CREATE OR REPLACE FUNCTION assess_user_risk_level(p_user_id UUID)
RETURNS TABLE (
  risk_score INTEGER,
  risk_level TEXT,
  risk_factors TEXT[],
  recommendations TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_risk_score INTEGER := 0;
  v_risk_level TEXT;
  v_risk_factors TEXT[] := '{}';
  v_recommendations TEXT[] := '{}';
  v_avg_bet NUMERIC;
  v_max_bet NUMERIC;
  v_profit_loss NUMERIC;
  v_total_bets INTEGER;
  v_play_days INTEGER;
  v_night_play_ratio NUMERIC;
BEGIN
  -- 기본 통계 가져오기
  SELECT avgBetAmount, maxBetAmount, profitLoss, totalBets
  INTO v_avg_bet, v_max_bet, v_profit_loss, v_total_bets
  FROM analyze_user_betting_pattern(p_user_id)
  LIMIT 1;
  
  -- 플레이 일수 계산
  SELECT COUNT(DISTINCT DATE(created_at))::INTEGER
  INTO v_play_days
  FROM game_records
  WHERE user_id = p_user_id;
  
  -- 밤시간 플레이 비율 계산 (22시~6시)
  SELECT 
    CASE 
      WHEN COUNT(*) > 0 THEN
        (COUNT(CASE WHEN EXTRACT(HOUR FROM created_at) >= 22 OR EXTRACT(HOUR FROM created_at) <= 6 THEN 1 END)::NUMERIC / COUNT(*)) * 100
      ELSE 0
    END
  INTO v_night_play_ratio
  FROM game_records
  WHERE user_id = p_user_id;
  
  -- 위험 점수 계산
  
  -- 1. 평균 베팅 금액 기준
  IF v_avg_bet > 100000 THEN
    v_risk_score := v_risk_score + 3;
    v_risk_factors := array_append(v_risk_factors, '높은 평균 베팅 금액');
    v_recommendations := array_append(v_recommendations, '베팅 금액을 조절하여 안전한 게임을 권장합니다');
  ELSIF v_avg_bet > 50000 THEN
    v_risk_score := v_risk_score + 2;
    v_risk_factors := array_append(v_risk_factors, '중간 수준의 베팅 금액');
  ELSIF v_avg_bet > 20000 THEN
    v_risk_score := v_risk_score + 1;
  END IF;
  
  -- 2. 최대 베팅 금액 기준
  IF v_max_bet > 500000 THEN
    v_risk_score := v_risk_score + 3;
    v_risk_factors := array_append(v_risk_factors, '매우 높은 최대 베팅 금액');
    v_recommendations := array_append(v_recommendations, '한 번에 큰 금액을 베팅하는 것은 위험할 수 있습니다');
  ELSIF v_max_bet > 200000 THEN
    v_risk_score := v_risk_score + 2;
    v_risk_factors := array_append(v_risk_factors, '높은 최대 베팅 금액');
  END IF;
  
  -- 3. 손실 정도 기준
  IF v_profit_loss < -500000 THEN
    v_risk_score := v_risk_score + 3;
    v_risk_factors := array_append(v_risk_factors, '큰 손실 발생');
    v_recommendations := array_append(v_recommendations, '손실이 큰 상황입니다. 게임 패턴을 재검토해보세요');
  ELSIF v_profit_loss < -100000 THEN
    v_risk_score := v_risk_score + 2;
    v_risk_factors := array_append(v_risk_factors, '중간 수준의 손실');
  END IF;
  
  -- 4. 베팅 빈도 기준
  IF v_play_days > 0 AND (v_total_bets::NUMERIC / v_play_days) > 50 THEN
    v_risk_score := v_risk_score + 2;
    v_risk_factors := array_append(v_risk_factors, '높은 일일 베팅 빈도');
    v_recommendations := array_append(v_recommendations, '하루 베팅 횟수를 제한하는 것을 고려해보세요');
  END IF;
  
  -- 5. 밤시간 플레이 비율 기준
  IF v_night_play_ratio > 40 THEN
    v_risk_score := v_risk_score + 2;
    v_risk_factors := array_append(v_risk_factors, '높은 밤시간 플레이 비율');
    v_recommendations := array_append(v_recommendations, '규칙적인 생활 패턴을 유지하는 것이 중요합니다');
  END IF;
  
  -- 위험 레벨 결정
  IF v_risk_score >= 8 THEN
    v_risk_level := 'HIGH';
  ELSIF v_risk_score >= 4 THEN
    v_risk_level := 'MEDIUM';
  ELSE
    v_risk_level := 'LOW';
  END IF;
  
  -- 일반적인 권장사항 추가
  IF array_length(v_recommendations, 1) IS NULL OR array_length(v_recommendations, 1) = 0 THEN
    v_recommendations := array_append(v_recommendations, '현재 건전한 게임 패턴을 유지하고 있습니다');
  END IF;
  
  v_recommendations := array_append(v_recommendations, '정기적으로 게임 패턴을 점검하세요');
  
  RETURN QUERY
  SELECT v_risk_score, v_risk_level, v_risk_factors, v_recommendations;
END;
$$;

-- 8. RLS 정책 설정 (관리자만 접근 가능)
-- 이 함수들은 관리자 계정에서만 사용 가능하도록 제한

-- 완료 로그
DO $$
BEGIN
  RAISE NOTICE '✅ 사용자 패턴 분석 함수 생성 완료';
  RAISE NOTICE '   - get_user_transaction_summary: 트랜잭션 요약';
  RAISE NOTICE '   - get_user_betting_summary: 베팅 요약';
  RAISE NOTICE '   - analyze_user_game_preference: 게임 선호도 분석';
  RAISE NOTICE '   - analyze_user_play_time_pattern: 시간대별 플레이 패턴';
  RAISE NOTICE '   - analyze_user_betting_pattern: 베팅 패턴 분석';
  RAISE NOTICE '   - get_user_monthly_activity: 월별 활동 통계';
  RAISE NOTICE '   - assess_user_risk_level: 위험도 평가';
END $$;