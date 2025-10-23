-- ===========================
-- 블랙리스트 시스템 오류 수정
-- UserManagement.tsx와 데이터베이스 스키마 동기화
-- ===========================

-- 1. 기존 blacklist 테이블이 있다면 삭제 (충돌 방지)
DROP TABLE IF EXISTS blacklist CASCADE;

-- 2. users 테이블의 블랙리스트 관련 컬럼들 확인 및 생성
DO $$
BEGIN
  -- blocked_reason 컬럼 확인 및 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_reason') THEN
    ALTER TABLE users ADD COLUMN blocked_reason TEXT;
    RAISE NOTICE '✅ users.blocked_reason 컬럼 추가됨';
  END IF;

  -- blocked_at 컬럼 확인 및 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_at') THEN
    ALTER TABLE users ADD COLUMN blocked_at TIMESTAMPTZ;
    RAISE NOTICE '✅ users.blocked_at 컬럼 추가됨';
  END IF;

  -- blocked_by 컬럼 확인 및 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_by') THEN
    ALTER TABLE users ADD COLUMN blocked_by UUID REFERENCES partners(id);
    RAISE NOTICE '✅ users.blocked_by 컬럼 추가됨';
  END IF;

  -- unblocked_at 컬럼 확인 및 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'unblocked_at') THEN
    ALTER TABLE users ADD COLUMN unblocked_at TIMESTAMPTZ;
    RAISE NOTICE '✅ users.unblocked_at 컬럼 추가됨';
  END IF;
END $$;

-- 3. 블랙리스트 관련 함수 재생성 (덮어쓰기)
CREATE OR REPLACE FUNCTION add_user_to_blacklist_simple(
  p_user_id UUID,
  p_admin_id UUID,
  p_reason TEXT DEFAULT '관리자에 의한 블랙리스트 추가'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_row users%ROWTYPE;
  v_admin_row partners%ROWTYPE;
BEGIN
  -- 사용자 정보 조회
  SELECT * INTO v_user_row FROM users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '사용자를 찾을 수 없습니다.'
    );
  END IF;

  -- 관리자 정보 조회
  SELECT * INTO v_admin_row FROM partners WHERE id = p_admin_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '관리자 정보를 찾을 수 없습니다.'
    );
  END IF;

  -- 이미 블랙리스트인지 확인
  IF v_user_row.status = 'blocked' THEN
    RETURN json_build_object(
      'success', false,
      'error', '이미 블랙리스트에 등록된 회원입니다.'
    );
  END IF;

  -- 블랙리스트로 변경
  UPDATE users 
  SET 
    status = 'blocked',
    blocked_reason = p_reason,
    blocked_at = now(),
    blocked_by = p_admin_id,
    unblocked_at = NULL,
    updated_at = now()
  WHERE id = p_user_id;

  RAISE NOTICE '🚨 블랙리스트 추가: % (관리자: %)', v_user_row.username, v_admin_row.username;

  RETURN json_build_object(
    'success', true,
    'message', '블랙리스트에 추가되었습니다.',
    'data', json_build_object(
      'user_id', p_user_id,
      'username', v_user_row.username,
      'status', 'blocked',
      'blocked_at', now(),
      'blocked_by', p_admin_id,
      'admin_username', v_admin_row.username
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '블랙리스트 추가 오류: %', SQLERRM;
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 4. 블랙리스트 해제 함수 재생성
CREATE OR REPLACE FUNCTION remove_user_from_blacklist_simple(
  p_user_id UUID,
  p_admin_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_row users%ROWTYPE;
  v_admin_row partners%ROWTYPE;
BEGIN
  -- 사용자 정보 조회
  SELECT * INTO v_user_row FROM users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '사용자를 찾을 수 없습니다.'
    );
  END IF;

  -- 관리자 정보 조회
  SELECT * INTO v_admin_row FROM partners WHERE id = p_admin_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '관리자 정보를 찾을 수 없습니다.'
    );
  END IF;

  -- 블랙리스트가 아닌 경우
  IF v_user_row.status != 'blocked' THEN
    RETURN json_build_object(
      'success', false,
      'error', '블랙리스트에 등록된 회원이 아닙니다.'
    );
  END IF;

  -- 블랙리스트 해제
  UPDATE users 
  SET 
    status = 'active',
    unblocked_at = now(),
    updated_at = now()
  WHERE id = p_user_id;

  RAISE NOTICE '✅ 블랙리스트 해제: % (관리자: %)', v_user_row.username, v_admin_row.username;

  RETURN json_build_object(
    'success', true,
    'message', '블랙리스트에서 해제되었습니다.',
    'data', json_build_object(
      'user_id', p_user_id,
      'username', v_user_row.username,
      'status', 'active',
      'unblocked_at', now(),
      'admin_username', v_admin_row.username
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '블랙리스트 해제 오류: %', SQLERRM;
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 5. 블랙리스트 조회 VIEW 재생성
DROP VIEW IF EXISTS blacklist_users_view;

CREATE OR REPLACE VIEW blacklist_users_view AS
SELECT 
  u.id as user_id,
  u.username,
  u.nickname,
  u.email,
  u.phone,
  u.status,
  u.balance,
  u.points,
  u.blocked_reason,
  u.blocked_at,
  u.blocked_by,
  u.unblocked_at,
  u.created_at,
  u.updated_at,
  p.username as admin_username,
  p.nickname as admin_nickname,
  p.level as admin_level
FROM users u
LEFT JOIN partners p ON u.blocked_by = p.id
WHERE u.status = 'blocked'
ORDER BY u.blocked_at DESC;

-- 6. 블랙리스트 관련 인덱스 최적화
DROP INDEX IF EXISTS idx_users_status_blocked;
DROP INDEX IF EXISTS idx_users_blocked_at;
DROP INDEX IF EXISTS idx_users_blocked_by;

CREATE INDEX idx_users_status_blocked ON users(status) WHERE status = 'blocked';
CREATE INDEX idx_users_blocked_at ON users(blocked_at) WHERE blocked_at IS NOT NULL;
CREATE INDEX idx_users_blocked_by ON users(blocked_by) WHERE blocked_by IS NOT NULL;
CREATE INDEX idx_users_status_active ON users(status) WHERE status = 'active';

-- 7. 블랙리스트 통계 함수
CREATE OR REPLACE FUNCTION get_blacklist_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_blocked INTEGER;
  v_today_blocked INTEGER;
  v_week_blocked INTEGER;
  v_month_blocked INTEGER;
BEGIN
  -- 전체 블랙리스트 수
  SELECT COUNT(*) INTO v_total_blocked
  FROM users 
  WHERE status = 'blocked';

  -- 오늘 블랙리스트 추가된 수
  SELECT COUNT(*) INTO v_today_blocked
  FROM users 
  WHERE status = 'blocked' 
    AND blocked_at >= CURRENT_DATE;

  -- 이번 주 블랙리스트 추가된 수
  SELECT COUNT(*) INTO v_week_blocked
  FROM users 
  WHERE status = 'blocked' 
    AND blocked_at >= date_trunc('week', CURRENT_DATE);

  -- 이번 달 블랙리스트 추가된 수
  SELECT COUNT(*) INTO v_month_blocked
  FROM users 
  WHERE status = 'blocked' 
    AND blocked_at >= date_trunc('month', CURRENT_DATE);

  RETURN json_build_object(
    'total_blocked', v_total_blocked,
    'today_blocked', v_today_blocked,
    'week_blocked', v_week_blocked,
    'month_blocked', v_month_blocked,
    'generated_at', now()
  );
END;
$$;

-- 8. RLS 정책 확인 (users 테이블의 기존 정책 사용)
-- users 테이블은 이미 RLS가 설정되어 있으므로 추가 설정 불필요

-- 9. 함수 권한 설정
GRANT EXECUTE ON FUNCTION add_user_to_blacklist_simple TO authenticated;
GRANT EXECUTE ON FUNCTION remove_user_from_blacklist_simple TO authenticated;
GRANT EXECUTE ON FUNCTION get_blacklist_stats TO authenticated;

-- 10. VIEW 권한 설정
GRANT SELECT ON blacklist_users_view TO authenticated;

-- 완료 로그
DO $$
BEGIN
  RAISE NOTICE '🎉 블랙리스트 시스템 오류 수정 완료!';
  RAISE NOTICE '   ✅ 기존 blacklist 테이블 제거';
  RAISE NOTICE '   ✅ users 테이블 블랙리스트 컬럼 확인';
  RAISE NOTICE '   ✅ 블랙리스트 함수 재생성';
  RAISE NOTICE '   ✅ blacklist_users_view 재생성';
  RAISE NOTICE '   ✅ 인덱스 최적화';
  RAISE NOTICE '   ✅ 통계 함수 추가';
  RAISE NOTICE '   ✅ 권한 설정 완료';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 사용 가능한 함수:';
  RAISE NOTICE '   - add_user_to_blacklist_simple(user_id, admin_id, reason)';
  RAISE NOTICE '   - remove_user_from_blacklist_simple(user_id, admin_id)';
  RAISE NOTICE '   - get_blacklist_stats()';
  RAISE NOTICE '';
  RAISE NOTICE '📊 사용 가능한 VIEW:';
  RAISE NOTICE '   - blacklist_users_view';
END $$;