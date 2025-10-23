-- ===========================
-- 완전히 새로운 심플 블랙리스트 시스템
-- users 테이블의 status만 사용
-- ===========================

-- 1. users 테이블에 블랙리스트 관련 컬럼 추가
DO $$
BEGIN
  -- blocked_reason 컬럼 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_reason') THEN
    ALTER TABLE users ADD COLUMN blocked_reason TEXT;
  END IF;

  -- blocked_at 컬럼 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_at') THEN
    ALTER TABLE users ADD COLUMN blocked_at TIMESTAMPTZ;
  END IF;

  -- blocked_by 컬럼 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_by') THEN
    ALTER TABLE users ADD COLUMN blocked_by UUID REFERENCES partners(id);
  END IF;

  -- unblocked_at 컬럼 추가
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'unblocked_at') THEN
    ALTER TABLE users ADD COLUMN unblocked_at TIMESTAMPTZ;
  END IF;
END $$;

-- 2. 심플한 블랙리스트 추가 함수
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
BEGIN
  -- 사용자 정보 조회
  SELECT * INTO v_user_row FROM users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '사용자를 찾을 수 없습니다.'
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

  RETURN json_build_object(
    'success', true,
    'message', '블랙리스트에 추가되었습니다.',
    'data', json_build_object(
      'user_id', p_user_id,
      'status', 'blocked',
      'blocked_at', now()
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 3. 심플한 블랙리스트 해제 함수
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
BEGIN
  -- 사용자 정보 조회
  SELECT * INTO v_user_row FROM users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '사용자를 찾을 수 없습니다.'
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

  RETURN json_build_object(
    'success', true,
    'message', '블랙리스트에서 해제되었습니다.',
    'data', json_build_object(
      'user_id', p_user_id,
      'status', 'active',
      'unblocked_at', now()
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 4. 블랙리스트 조회 VIEW 생성
CREATE OR REPLACE VIEW blacklist_users_view AS
SELECT 
  u.id as user_id,
  u.username,
  u.nickname,
  u.status,
  u.blocked_reason,
  u.blocked_at,
  u.blocked_by,
  u.unblocked_at,
  u.created_at,
  u.updated_at,
  p.username as admin_username,
  p.nickname as admin_nickname
FROM users u
LEFT JOIN partners p ON u.blocked_by = p.id
WHERE u.status = 'blocked'
ORDER BY u.blocked_at DESC;

-- 5. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_users_status_blocked ON users(status) WHERE status = 'blocked';
CREATE INDEX IF NOT EXISTS idx_users_blocked_at ON users(blocked_at) WHERE blocked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_blocked_by ON users(blocked_by) WHERE blocked_by IS NOT NULL;

-- 6. RLS 정책 (기존 users 테이블 정책 사용)

-- 완료 로그
DO $$
BEGIN
  RAISE NOTICE '✅ 심플 블랙리스트 시스템 구축 완료';
  RAISE NOTICE '   - users 테이블 확장 (blocked_reason, blocked_at, blocked_by, unblocked_at)';
  RAISE NOTICE '   - 함수 2개: add_user_to_blacklist_simple, remove_user_from_blacklist_simple';
  RAISE NOTICE '   - VIEW: blacklist_users_view';
  RAISE NOTICE '   - 인덱스 최적화';
END $$;