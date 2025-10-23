-- =====================================================
-- 245. 대시보드 실시간 통계 함수 (실제 데이터 기반)
-- =====================================================
-- 목적: 입금/출금/베팅 등 모든 통계를 실제 데이터로 계산
-- Guidelines 준수: Mock 데이터 사용 금지, 실제 DB 데이터 집계
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '============================================';
    RAISE NOTICE '📊 대시보드 실시간 통계 함수 생성';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
END $$;

-- ============================================
-- 1. 기존 함수 삭제 (재생성)
-- ============================================

DROP FUNCTION IF EXISTS get_dashboard_realtime_stats(UUID);
DROP FUNCTION IF EXISTS get_realtime_dashboard_stats(UUID);

-- ============================================
-- 2. 대시보드 실시간 통계 함수 (실제 데이터)
-- ============================================

CREATE OR REPLACE FUNCTION get_dashboard_realtime_stats(partner_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    partner_level INTEGER;
    partner_referrer_id UUID;
    today_start TIMESTAMP WITH TIME ZONE;
    result JSON;
    
    -- 통계 변수
    v_total_users INTEGER := 0;
    v_online_users INTEGER := 0;
    v_daily_deposit DECIMAL(15,2) := 0;
    v_daily_withdrawal DECIMAL(15,2) := 0;
    v_pending_deposits INTEGER := 0;
    v_pending_withdrawals INTEGER := 0;
    v_casino_betting DECIMAL(15,2) := 0;
    v_slot_betting DECIMAL(15,2) := 0;
    v_total_betting DECIMAL(15,2) := 0;
    v_pending_requests INTEGER := 0;
    v_unread_notifications INTEGER := 0;
BEGIN
    RAISE NOTICE '🔍 대시보드 통계 계산 시작: %', partner_id_param;
    
    -- 파트너 정보 조회
    SELECT p.level, p.referrer_id
    INTO partner_level, partner_referrer_id
    FROM partners p
    WHERE p.id = partner_id_param;
    
    IF partner_level IS NULL THEN
        RAISE WARNING '❌ 파트너를 찾을 수 없음: %', partner_id_param;
        RETURN json_build_object(
            'total_users', 0,
            'online_users', 0,
            'daily_deposits', 0,
            'daily_withdrawals', 0,
            'pending_deposits', 0,
            'pending_withdrawals', 0,
            'casino_betting', 0,
            'slot_betting', 0,
            'total_betting', 0,
            'pending_requests', 0,
            'unread_notifications', 0
        );
    END IF;
    
    -- 오늘 시작 시간 (00:00:00)
    today_start := date_trunc('day', NOW());
    
    RAISE NOTICE '📅 오늘 시작: %, 파트너 레벨: %', today_start, partner_level;
    
    -- ============================================
    -- 총 회원수 (계층별)
    -- ============================================
    IF partner_level = 1 THEN
        -- 시스템관리자: 모든 회원
        SELECT COUNT(*) INTO v_total_users FROM users;
    ELSE
        -- 일반 파트너: 자신에게 속한 회원만
        SELECT COUNT(*)
        INTO v_total_users
        FROM users
        WHERE referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '👥 총 회원수: %', v_total_users;
    
    -- ============================================
    -- 온라인 회원수 (최근 5분 이내 활동)
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COUNT(*)
        INTO v_online_users
        FROM users
        WHERE last_login >= NOW() - INTERVAL '5 minutes';
    ELSE
        SELECT COUNT(*)
        INTO v_online_users
        FROM users
        WHERE referrer_id = partner_id_param
        AND last_login >= NOW() - INTERVAL '5 minutes';
    END IF;
    
    RAISE NOTICE '🟢 온라인 회원: %', v_online_users;
    
    -- ============================================
    -- 일일 입금액 (approved/completed)
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COALESCE(SUM(t.amount), 0)
        INTO v_daily_deposit
        FROM transactions t
        WHERE t.transaction_type = 'deposit'
        AND t.status IN ('approved', 'completed')
        AND t.created_at >= today_start;
    ELSE
        SELECT COALESCE(SUM(t.amount), 0)
        INTO v_daily_deposit
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.transaction_type = 'deposit'
        AND t.status IN ('approved', 'completed')
        AND t.created_at >= today_start
        AND u.referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '💰 일일 입금액: %', v_daily_deposit;
    
    -- ============================================
    -- 일일 출금액 (approved/completed)
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COALESCE(SUM(t.amount), 0)
        INTO v_daily_withdrawal
        FROM transactions t
        WHERE t.transaction_type = 'withdrawal'
        AND t.status IN ('approved', 'completed')
        AND t.created_at >= today_start;
    ELSE
        SELECT COALESCE(SUM(t.amount), 0)
        INTO v_daily_withdrawal
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.transaction_type = 'withdrawal'
        AND t.status IN ('approved', 'completed')
        AND t.created_at >= today_start
        AND u.referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '💸 일일 출금액: %', v_daily_withdrawal;
    
    -- ============================================
    -- 대기 중인 입금 건수
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COUNT(*)
        INTO v_pending_deposits
        FROM transactions t
        WHERE t.transaction_type = 'deposit'
        AND t.status = 'pending';
    ELSE
        SELECT COUNT(*)
        INTO v_pending_deposits
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.transaction_type = 'deposit'
        AND t.status = 'pending'
        AND u.referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '⏳ 대기 입금: %건', v_pending_deposits;
    
    -- ============================================
    -- 대기 중인 출금 건수
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COUNT(*)
        INTO v_pending_withdrawals
        FROM transactions t
        WHERE t.transaction_type = 'withdrawal'
        AND t.status = 'pending';
    ELSE
        SELECT COUNT(*)
        INTO v_pending_withdrawals
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.transaction_type = 'withdrawal'
        AND t.status = 'pending'
        AND u.referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '⏳ 대기 출금: %건', v_pending_withdrawals;
    
    -- ============================================
    -- 일일 카지노 베팅액
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COALESCE(SUM(gr.bet_amount), 0)
        INTO v_casino_betting
        FROM game_records gr
        JOIN games g ON gr.game_id = g.id
        WHERE g.type = 'casino'
        AND gr.played_at >= today_start;
    ELSE
        SELECT COALESCE(SUM(gr.bet_amount), 0)
        INTO v_casino_betting
        FROM game_records gr
        JOIN games g ON gr.game_id = g.id
        JOIN users u ON gr.user_id = u.id
        WHERE g.type = 'casino'
        AND gr.played_at >= today_start
        AND u.referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '🎰 카지노 베팅: %', v_casino_betting;
    
    -- ============================================
    -- 일일 슬롯 베팅액
    -- ============================================
    IF partner_level = 1 THEN
        SELECT COALESCE(SUM(gr.bet_amount), 0)
        INTO v_slot_betting
        FROM game_records gr
        JOIN games g ON gr.game_id = g.id
        WHERE g.type = 'slot'
        AND gr.played_at >= today_start;
    ELSE
        SELECT COALESCE(SUM(gr.bet_amount), 0)
        INTO v_slot_betting
        FROM game_records gr
        JOIN games g ON gr.game_id = g.id
        JOIN users u ON gr.user_id = u.id
        WHERE g.type = 'slot'
        AND gr.played_at >= today_start
        AND u.referrer_id = partner_id_param;
    END IF;
    
    RAISE NOTICE '🎲 슬롯 베팅: %', v_slot_betting;
    
    -- 전체 베팅액
    v_total_betting := v_casino_betting + v_slot_betting;
    
    RAISE NOTICE '📊 전체 베팅: %', v_total_betting;
    
    -- ============================================
    -- 대기 중인 요청 (입금 + 출금)
    -- ============================================
    v_pending_requests := v_pending_deposits + v_pending_withdrawals;
    
    -- ============================================
    -- 읽지 않은 알림 (support_tickets)
    -- ============================================
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_tickets') THEN
        IF partner_level = 1 THEN
            SELECT COUNT(*)
            INTO v_unread_notifications
            FROM support_tickets
            WHERE status = 'open';
        ELSE
            SELECT COUNT(*)
            INTO v_unread_notifications
            FROM support_tickets st
            JOIN users u ON st.user_id = u.id
            WHERE st.status = 'open'
            AND u.referrer_id = partner_id_param;
        END IF;
    END IF;
    
    RAISE NOTICE '🔔 읽지 않은 알림: %', v_unread_notifications;
    
    -- ============================================
    -- 결과 JSON 생성
    -- ============================================
    result := json_build_object(
        'total_users', v_total_users,
        'online_users', v_online_users,
        'daily_deposits', v_daily_deposit,
        'daily_withdrawals', v_daily_withdrawal,
        'pending_deposits', v_pending_deposits,
        'pending_withdrawals', v_pending_withdrawals,
        'casino_betting', v_casino_betting,
        'slot_betting', v_slot_betting,
        'total_betting', v_total_betting,
        'pending_requests', v_pending_requests,
        'unread_notifications', v_unread_notifications
    );
    
    RAISE NOTICE '✅ 통계 계산 완료!';
    RAISE NOTICE '';
    
    RETURN result;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '❌ 대시보드 통계 오류: %', SQLERRM;
        RETURN json_build_object(
            'total_users', 0,
            'online_users', 0,
            'daily_deposits', 0,
            'daily_withdrawals', 0,
            'pending_deposits', 0,
            'pending_withdrawals', 0,
            'casino_betting', 0,
            'slot_betting', 0,
            'total_betting', 0,
            'pending_requests', 0,
            'unread_notifications', 0,
            'error', SQLERRM
        );
END;
$$;

-- ============================================
-- 3. 권한 부여
-- ============================================

GRANT EXECUTE ON FUNCTION get_dashboard_realtime_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_realtime_stats(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION get_dashboard_realtime_stats(UUID) TO service_role;

-- ============================================
-- 4. 테스트
-- ============================================

DO $$
DECLARE
    test_partner_id UUID;
    test_result JSON;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '🧪 대시보드 통계 테스트';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    
    -- 시스템관리자 찾기
    SELECT id INTO test_partner_id
    FROM partners
    WHERE partner_type = 'system_admin'
    LIMIT 1;
    
    IF test_partner_id IS NOT NULL THEN
        RAISE NOTICE '테스트 대상: % (시스템관리자)', test_partner_id;
        RAISE NOTICE '';
        
        -- 통계 조회
        SELECT get_dashboard_realtime_stats(test_partner_id)
        INTO test_result;
        
        RAISE NOTICE '📊 통계 결과:';
        RAISE NOTICE '%', test_result;
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '⚠️  시스템관리자가 없습니다.';
    END IF;
END $$;

-- ============================================
-- 5. 완료
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ 대시보드 실시간 통계 함수 생성 완료!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📋 생성된 함수:';
    RAISE NOTICE '   - get_dashboard_realtime_stats(partner_id UUID)';
    RAISE NOTICE '';
    RAISE NOTICE '📊 반환 데이터:';
    RAISE NOTICE '   - total_users: 총 회원수';
    RAISE NOTICE '   - online_users: 온라인 회원수 (5분 이내)';
    RAISE NOTICE '   - daily_deposits: 일일 입금액';
    RAISE NOTICE '   - daily_withdrawals: 일일 출금액';
    RAISE NOTICE '   - pending_deposits: 대기 입금 건수';
    RAISE NOTICE '   - pending_withdrawals: 대기 출금 건수';
    RAISE NOTICE '   - casino_betting: 일일 카지노 베팅액';
    RAISE NOTICE '   - slot_betting: 일일 슬롯 베팅액';
    RAISE NOTICE '   - total_betting: 일일 전체 베팅액';
    RAISE NOTICE '   - pending_requests: 대기 요청 (입금+출금)';
    RAISE NOTICE '   - unread_notifications: 읽지 않은 알림';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 특징:';
    RAISE NOTICE '   ✅ 실제 DB 데이터 기반 계산 (Mock 없음)';
    RAISE NOTICE '   ✅ 계층별 권한 필터링';
    RAISE NOTICE '   ✅ 오늘 00:00 기준 일일 통계';
    RAISE NOTICE '   ✅ 에러 처리 포함';
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
END $$;
