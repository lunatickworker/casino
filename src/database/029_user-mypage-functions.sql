-- =====================================================
-- 사용자 내정보 페이지를 위한 함수들 (최신 버전)
-- =====================================================
-- 변경: 257_UPDATE_029_FUNCTIONS.sql로 최신화됨
-- 주의: 조회 함수는 프론트엔드에서 직접 SELECT 사용 권장
-- =====================================================

-- 1. 사용자 프로필 업데이트 함수 (최신 버전)
CREATE OR REPLACE FUNCTION update_user_profile(
    username_param TEXT,
    nickname_param TEXT,
    bank_name_param TEXT DEFAULT NULL,
    bank_account_param TEXT DEFAULT NULL,
    bank_holder_param TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    updated_rows INTEGER;
    user_id_var UUID;
BEGIN
    -- 사용자 프로필 업데이트
    UPDATE users 
    SET 
        nickname = nickname_param,
        bank_name = COALESCE(bank_name_param, bank_name),
        bank_account = COALESCE(bank_account_param, bank_account),
        bank_holder = COALESCE(bank_holder_param, bank_holder),
        updated_at = NOW()
    WHERE username = username_param
    RETURNING id INTO user_id_var;
    
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    
    IF updated_rows = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', '사용자를 찾을 수 없습니다.'
        );
    END IF;
    
    -- 활동 로그 기록 (activity_logs 테이블 사용)
    INSERT INTO activity_logs (
        actor_type,
        actor_id,
        action,
        details
    ) VALUES (
        'user',
        user_id_var,
        'profile_updated',
        json_build_object(
            'username', username_param,
            'description', '사용자가 프로필 정보를 수정함'
        )
    );
    
    RETURN json_build_object(
        'success', true,
        'message', '프로필이 성공적으로 업데이트되었습니다.'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '프로필 업데이트 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 사용자 비밀번호 변경 함수 (최신 버전)
CREATE OR REPLACE FUNCTION change_user_password(
    username_param TEXT,
    current_password_param TEXT,
    new_password_param TEXT
)
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
    updated_rows INTEGER;
BEGIN
    -- 현재 비밀번호 확인
    SELECT * INTO user_record
    FROM users 
    WHERE username = username_param 
    AND password_hash = crypt(current_password_param, password_hash);
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', '현재 비밀번호가 올바르지 않습니다.'
        );
    END IF;
    
    -- 새 비밀번호로 업데이트
    UPDATE users 
    SET 
        password_hash = crypt(new_password_param, gen_salt('bf')),
        updated_at = NOW()
    WHERE username = username_param;
    
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    
    -- 활동 로그 기록 (activity_logs 테이블 사용)
    INSERT INTO activity_logs (
        actor_type,
        actor_id,
        action,
        details
    ) VALUES (
        'user',
        user_record.id,
        'password_changed',
        json_build_object(
            'username', username_param,
            'description', '사용자가 비밀번호를 변경함'
        )
    );
    
    RETURN json_build_object(
        'success', true,
        'message', '비밀번호가 성공적으로 변경되었습니다.'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', '비밀번호 변경 중 오류가 발생했습니다: ' || SQLERRM
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 권한 부여
GRANT EXECUTE ON FUNCTION update_user_profile(text, text, text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION change_user_password(text, text, text) TO authenticated, anon;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '✅ 사용자 내정보 페이지 함수 설치 완료 (최신 버전)';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
    RAISE NOTICE '📋 설치된 함수:';
    RAISE NOTICE '  ✅ update_user_profile(username, nickname, bank...)';
    RAISE NOTICE '  ✅ change_user_password(username, current_pwd, new_pwd)';
    RAISE NOTICE '';
    RAISE NOTICE '💡 조회 함수는 프론트엔드에서 직접 SELECT 사용:';
    RAISE NOTICE '  • 거래 내역: SELECT * FROM transactions WHERE user_id = ...';
    RAISE NOTICE '  • 포인트 내역: SELECT * FROM point_transactions WHERE user_id = ...';
    RAISE NOTICE '  • 게임 기록: SELECT * FROM game_records WHERE user_id = ...';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 메모리 최적화 - RPC 함수 최소화, 직접 쿼리 사용';
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
END $$;
