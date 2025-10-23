-- =====================================================
-- 시스템 관리자 API 설정 확인 및 업데이트
-- 리소스 재사용: 기존 시스템 관리자 레코드 활용
-- =====================================================

-- 1. 시스템 관리자 확인 및 API 설정 업데이트
DO $$
DECLARE
    v_sadmin_id UUID;
    v_sadmin_exists BOOLEAN;
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE '🔧 시스템 관리자 API 설정 확인';
    RAISE NOTICE '==================================================';
    
    -- 시스템 관리자 존재 확인
    SELECT EXISTS(
        SELECT 1 FROM partners 
        WHERE username = 'sadmin' AND level = 1
    ) INTO v_sadmin_exists;
    
    IF NOT v_sadmin_exists THEN
        RAISE NOTICE '❌ 시스템 관리자(sadmin)가 존재하지 않습니다. 생성합니다.';
        
        -- 시스템 관리자 생성
        INSERT INTO partners (
            username, 
            nickname, 
            password_hash, 
            partner_type, 
            level, 
            status,
            opcode,
            secret_key,
            api_token,
            balance,
            commission_rolling,
            commission_losing,
            withdrawal_fee
        ) VALUES (
            'sadmin',
            '시스템관리자',
            'sadmin123!',
            'system_admin',
            1,
            'active',
            'eeo2211',
            'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj',
            '153b28230ef1c40c11ff526e9da93e2b',
            0,
            0,
            0,
            0
        ) RETURNING id INTO v_sadmin_id;
        
        RAISE NOTICE '✅ 시스템 관리자 생성 완료: %', v_sadmin_id;
    ELSE
        -- 기존 시스템 관리자 업데이트
        UPDATE partners
        SET 
            opcode = COALESCE(opcode, 'eeo2211'),
            secret_key = COALESCE(secret_key, 'CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj'),
            api_token = COALESCE(api_token, '153b28230ef1c40c11ff526e9da93e2b'),
            updated_at = NOW()
        WHERE username = 'sadmin' AND level = 1
        RETURNING id INTO v_sadmin_id;
        
        RAISE NOTICE '✅ 시스템 관리자 API 설정 업데이트 완료: %', v_sadmin_id;
    END IF;
    
    -- 업데이트된 정보 표시
    DECLARE
        v_admin_info RECORD;
    BEGIN
        SELECT 
            id,
            username,
            nickname,
            level,
            opcode,
            secret_key,
            api_token,
            status
        INTO v_admin_info
        FROM partners
        WHERE id = v_sadmin_id;
        
        RAISE NOTICE '';
        RAISE NOTICE '📋 시스템 관리자 정보:';
        RAISE NOTICE '  - ID: %', v_admin_info.id;
        RAISE NOTICE '  - Username: %', v_admin_info.username;
        RAISE NOTICE '  - Nickname: %', v_admin_info.nickname;
        RAISE NOTICE '  - Level: %', v_admin_info.level;
        RAISE NOTICE '  - OPCODE: %', v_admin_info.opcode;
        RAISE NOTICE '  - Secret Key: %', LEFT(v_admin_info.secret_key, 10) || '...';
        RAISE NOTICE '  - API Token: %', LEFT(v_admin_info.api_token, 10) || '...';
        RAISE NOTICE '  - Status: %', v_admin_info.status;
    END;
    
    RAISE NOTICE '==================================================';
END $$;

-- 2. 베팅 데이터 확인
DO $$
DECLARE
    v_total_records INTEGER;
    v_today_records INTEGER;
    v_week_records INTEGER;
    v_month_records INTEGER;
    v_latest_bet_date TIMESTAMP WITH TIME ZONE;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📊 베팅 데이터 현황';
    RAISE NOTICE '--------------------------------------------------';
    
    -- 전체 베팅 레코드 수
    SELECT COUNT(*) INTO v_total_records FROM game_records;
    RAISE NOTICE '전체 베팅 레코드: %건', v_total_records;
    
    IF v_total_records > 0 THEN
        -- 오늘 베팅
        SELECT COUNT(*) INTO v_today_records 
        FROM game_records 
        WHERE played_at >= DATE_TRUNC('day', NOW());
        RAISE NOTICE '오늘 베팅: %건', v_today_records;
        
        -- 최근 7일 베팅
        SELECT COUNT(*) INTO v_week_records 
        FROM game_records 
        WHERE played_at >= NOW() - INTERVAL '7 days';
        RAISE NOTICE '최근 7일: %건', v_week_records;
        
        -- 최근 30일 베팅
        SELECT COUNT(*) INTO v_month_records 
        FROM game_records 
        WHERE played_at >= NOW() - INTERVAL '30 days';
        RAISE NOTICE '최근 30일: %건', v_month_records;
        
        -- 가장 최근 베팅 날짜
        SELECT MAX(played_at) INTO v_latest_bet_date FROM game_records;
        RAISE NOTICE '가장 최근 베팅: %', v_latest_bet_date;
        
        IF v_latest_bet_date < NOW() - INTERVAL '1 day' THEN
            RAISE NOTICE '';
            RAISE NOTICE '⚠️ 최근 24시간 이내 베팅이 없습니다.';
            RAISE NOTICE '→ 관리자 페이지에서 "API 동기화" 버튼을 클릭하세요.';
        END IF;
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '❌ 베팅 데이터가 없습니다.';
        RAISE NOTICE '→ 관리자 페이지 > 게임 관리 > 베팅내역 > "API 동기화" 클릭';
        RAISE NOTICE '→ 외부 API에서 베팅 데이터를 가져옵니다.';
    END IF;
    
    RAISE NOTICE '--------------------------------------------------';
END $$;

-- 3. RPC 함수 테스트
DO $$
DECLARE
    v_sadmin_id UUID;
    v_rpc_count INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🧪 RPC 함수 테스트';
    RAISE NOTICE '--------------------------------------------------';
    
    -- 시스템 관리자 ID 가져오기
    SELECT id INTO v_sadmin_id 
    FROM partners 
    WHERE username = 'sadmin' AND level = 1 
    LIMIT 1;
    
    IF v_sadmin_id IS NULL THEN
        RAISE NOTICE '❌ 시스템 관리자를 찾을 수 없습니다.';
    ELSE
        BEGIN
            -- get_betting_records_with_details 테스트
            SELECT COUNT(*) INTO v_rpc_count
            FROM get_betting_records_with_details(v_sadmin_id, 'month', 10);
            
            RAISE NOTICE '✅ get_betting_records_with_details 함수 작동';
            RAISE NOTICE '   - Partner ID: %', v_sadmin_id;
            RAISE NOTICE '   - 결과 레코드: %건', v_rpc_count;
            
            IF v_rpc_count = 0 THEN
                RAISE NOTICE '';
                RAISE NOTICE '⚠️ RPC 함수가 데이터를 반환하지 않습니다.';
                RAISE NOTICE '→ 최근 30일 이내 베팅 데이터가 없을 수 있습니다.';
                RAISE NOTICE '→ "API 동기화"를 실행하여 데이터를 가져오세요.';
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '❌ RPC 함수 오류: %', SQLERRM;
            RAISE NOTICE '→ 136_fix-betting-records-display.sql을 실행하세요.';
        END;
    END IF;
    
    RAISE NOTICE '--------------------------------------------------';
END $$;

-- 4. 프론트엔드 연동 가이드
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🔌 프론트엔드 연동 확인';
    RAISE NOTICE '==================================================';
    RAISE NOTICE '1. 관리자 로그인:';
    RAISE NOTICE '   - Username: sadmin';
    RAISE NOTICE '   - Password: sadmin123!';
    RAISE NOTICE '';
    RAISE NOTICE '2. 베팅 내역 조회:';
    RAISE NOTICE '   - 메뉴: 게임 관리 > 베팅내역';
    RAISE NOTICE '   - 데이터가 없으면 "API 동기화" 클릭';
    RAISE NOTICE '';
    RAISE NOTICE '3. API 동기화 방법:';
    RAISE NOTICE '   - "API 동기화" 버튼 클릭';
    RAISE NOTICE '   - 외부 API(https://api.invest-ho.com)에서 데이터 가져옴';
    RAISE NOTICE '   - 최근 3개월 베팅 내역 자동 수집';
    RAISE NOTICE '';
    RAISE NOTICE '4. 문제 해결:';
    RAISE NOTICE '   - 콘솔에서 에러 확인 (F12 > Console)';
    RAISE NOTICE '   - user.id가 올바른 파트너 ID인지 확인';
    RAISE NOTICE '   - RPC 함수 파라미터 확인';
    RAISE NOTICE '==================================================';
END $$;
