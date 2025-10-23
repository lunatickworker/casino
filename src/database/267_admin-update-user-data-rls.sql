-- ============================================================================
-- 267. 관리자 권한으로 사용자 데이터 업데이트 RLS 정책 추가
-- ============================================================================
-- 작성일: 2025-10-18
-- 목적: 관리자가 입출금 승인 시 사용자 balance 및 transactions 업데이트 가능하도록 정책 추가
-- 문제: 현재 RLS가 비활성화되어 있지만, 보안을 위해 적절한 정책 추가 필요
-- 해결: 7단계 권한 체계를 고려한 계층적 업데이트 정책 구현
-- ============================================================================

-- ============================================
-- 1단계: users 테이블 RLS 정책 설정
-- ============================================

-- users 테이블 RLS 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "users_select_policy" ON users;
DROP POLICY IF EXISTS "users_insert_policy" ON users;
DROP POLICY IF EXISTS "users_update_own_data" ON users;
DROP POLICY IF EXISTS "users_update_by_admin" ON users;
DROP POLICY IF EXISTS "users_delete_policy" ON users;

-- 1.1 SELECT 정책: 인증된 사용자는 모두 조회 가능
CREATE POLICY "users_select_policy" ON users
FOR SELECT
USING (
  -- 인증된 사용자는 모두 조회 가능
  auth.uid() IS NOT NULL
);

-- 1.2 INSERT 정책: 인증된 사용자는 모두 삽입 가능 (회원가입용)
CREATE POLICY "users_insert_policy" ON users
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
);

-- 1.3 UPDATE 정책 1: 사용자는 본인 데이터만 업데이트 가능
CREATE POLICY "users_update_own_data" ON users
FOR UPDATE
USING (
  -- 본인의 데이터만 업데이트
  id = auth.uid()
)
WITH CHECK (
  id = auth.uid()
);

-- 1.4 UPDATE 정책 2: 관리자는 하위 조직의 사용자 데이터 업데이트 가능
CREATE POLICY "users_update_by_admin" ON users
FOR UPDATE
USING (
  -- 관리자가 하위 조직의 사용자를 업데이트하는 경우
  auth.uid() IS NOT NULL
  AND (
    -- 시스템 관리자는 모든 사용자 업데이트 가능
    EXISTS (
      SELECT 1 FROM partners 
      WHERE id = auth.uid() 
      AND level = 1
    )
    OR
    -- 또는 해당 사용자의 상위 파트너인 경우 업데이트 가능
    EXISTS (
      SELECT 1 FROM partners p1
      INNER JOIN users u ON u.referrer_id = p1.id
      WHERE u.id = users.id
      AND (
        p1.id = auth.uid()
        OR p1.parent_id = auth.uid()
        OR EXISTS (
          -- 재귀적으로 상위 파트너 확인
          WITH RECURSIVE parent_chain AS (
            SELECT id, parent_id, level
            FROM partners
            WHERE id = p1.id
            
            UNION ALL
            
            SELECT p.id, p.parent_id, p.level
            FROM partners p
            INNER JOIN parent_chain pc ON p.id = pc.parent_id
          )
          SELECT 1 FROM parent_chain
          WHERE id = auth.uid()
        )
      )
    )
  )
)
WITH CHECK (
  -- 동일한 조건으로 체크
  auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE id = auth.uid() 
      AND level = 1
    )
    OR
    EXISTS (
      SELECT 1 FROM partners p1
      INNER JOIN users u ON u.referrer_id = p1.id
      WHERE u.id = users.id
      AND (
        p1.id = auth.uid()
        OR p1.parent_id = auth.uid()
        OR EXISTS (
          WITH RECURSIVE parent_chain AS (
            SELECT id, parent_id, level
            FROM partners
            WHERE id = p1.id
            
            UNION ALL
            
            SELECT p.id, p.parent_id, p.level
            FROM partners p
            INNER JOIN parent_chain pc ON p.id = pc.parent_id
          )
          SELECT 1 FROM parent_chain
          WHERE id = auth.uid()
        )
      )
    )
  )
);

-- 1.5 DELETE 정책: 시스템 관리자만 삭제 가능
CREATE POLICY "users_delete_policy" ON users
FOR DELETE
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM partners 
    WHERE id = auth.uid() 
    AND level = 1
  )
);

-- ============================================
-- 2단계: transactions 테이블 RLS 정책 설정
-- ============================================

-- transactions 테이블 RLS 활성화
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "transactions_select_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_policy" ON transactions;
DROP POLICY IF EXISTS "transactions_update_own" ON transactions;
DROP POLICY IF EXISTS "transactions_update_by_admin" ON transactions;
DROP POLICY IF EXISTS "transactions_delete_policy" ON transactions;

-- 2.1 SELECT 정책: 인증된 사용자는 모두 조회 가능
CREATE POLICY "transactions_select_policy" ON transactions
FOR SELECT
USING (
  auth.uid() IS NOT NULL
);

-- 2.2 INSERT 정책: 인증된 사용자는 모두 삽입 가능
CREATE POLICY "transactions_insert_policy" ON transactions
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
);

-- 2.3 UPDATE 정책 1: 사용자는 본인의 pending 상태 거래만 취소 가능
CREATE POLICY "transactions_update_own" ON transactions
FOR UPDATE
USING (
  user_id = auth.uid()
  AND status = 'pending'
)
WITH CHECK (
  user_id = auth.uid()
  AND status IN ('pending', 'cancelled')
);

-- 2.4 UPDATE 정책 2: 관리자는 하위 조직의 거래 승인/거부 가능
CREATE POLICY "transactions_update_by_admin" ON transactions
FOR UPDATE
USING (
  -- 관리자가 하위 조직의 거래를 승인/거부하는 경우
  auth.uid() IS NOT NULL
  AND (
    -- 시스템 관리자는 모든 거래 처리 가능
    EXISTS (
      SELECT 1 FROM partners 
      WHERE id = auth.uid() 
      AND level = 1
    )
    OR
    -- 또는 해당 거래의 사용자가 속한 조직의 관리자인 경우
    EXISTS (
      SELECT 1 FROM users u
      INNER JOIN partners p ON u.referrer_id = p.id
      WHERE u.id = transactions.user_id
      AND (
        p.id = auth.uid()
        OR p.parent_id = auth.uid()
        OR EXISTS (
          -- 재귀적으로 상위 파트너 확인
          WITH RECURSIVE parent_chain AS (
            SELECT id, parent_id, level
            FROM partners
            WHERE id = p.id
            
            UNION ALL
            
            SELECT p2.id, p2.parent_id, p2.level
            FROM partners p2
            INNER JOIN parent_chain pc ON p2.id = pc.parent_id
          )
          SELECT 1 FROM parent_chain
          WHERE id = auth.uid()
        )
      )
    )
  )
)
WITH CHECK (
  -- 동일한 조건으로 체크
  auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE id = auth.uid() 
      AND level = 1
    )
    OR
    EXISTS (
      SELECT 1 FROM users u
      INNER JOIN partners p ON u.referrer_id = p.id
      WHERE u.id = transactions.user_id
      AND (
        p.id = auth.uid()
        OR p.parent_id = auth.uid()
        OR EXISTS (
          WITH RECURSIVE parent_chain AS (
            SELECT id, parent_id, level
            FROM partners
            WHERE id = p.id
            
            UNION ALL
            
            SELECT p2.id, p2.parent_id, p2.level
            FROM partners p2
            INNER JOIN parent_chain pc ON p2.id = pc.parent_id
          )
          SELECT 1 FROM parent_chain
          WHERE id = auth.uid()
        )
      )
    )
  )
);

-- 2.5 DELETE 정책: 시스템 관리자만 삭제 가능
CREATE POLICY "transactions_delete_policy" ON transactions
FOR DELETE
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM partners 
    WHERE id = auth.uid() 
    AND level = 1
  )
);

-- ============================================
-- 3단계: 정책 주석 추가
-- ============================================

-- users 테이블 정책 주석
COMMENT ON POLICY "users_select_policy" ON users IS 
'사용자 조회 정책: 인증된 모든 사용자가 조회 가능';

COMMENT ON POLICY "users_insert_policy" ON users IS 
'사용자 생성 정책: 인증된 모든 사용자가 생성 가능 (회원가입용)';

COMMENT ON POLICY "users_update_own_data" ON users IS 
'사용자 본인 데이터 수정 정책: 사용자는 본인의 데이터만 수정 가능';

COMMENT ON POLICY "users_update_by_admin" ON users IS 
'관리자 권한 사용자 데이터 수정 정책: 상위 조직의 관리자는 하위 사용자 데이터 수정 가능 (입출금 승인 등)';

COMMENT ON POLICY "users_delete_policy" ON users IS 
'사용자 삭제 정책: 시스템 관리자만 삭제 가능';

-- transactions 테이블 정책 주석
COMMENT ON POLICY "transactions_select_policy" ON transactions IS 
'거래 조회 정책: 인증된 모든 사용자가 조회 가능';

COMMENT ON POLICY "transactions_insert_policy" ON transactions IS 
'거래 생성 정책: 인증된 모든 사용자가 거래 생성 가능';

COMMENT ON POLICY "transactions_update_own" ON transactions IS 
'사용자 본인 거래 수정 정책: 사용자는 본인의 pending 상태 거래만 취소 가능';

COMMENT ON POLICY "transactions_update_by_admin" ON transactions IS 
'관리자 권한 거래 처리 정책: 상위 조직의 관리자는 하위 사용자 거래 승인/거부 가능';

COMMENT ON POLICY "transactions_delete_policy" ON transactions IS 
'거래 삭제 정책: 시스템 관리자만 삭제 가능';

-- ============================================
-- 4단계: 완료 메시지
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🎉 관리자 권한 RLS 정책 추가 완료!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '적용된 변경사항:';
    RAISE NOTICE '  ✓ users 테이블 RLS 활성화';
    RAISE NOTICE '    - 본인 데이터 수정 가능';
    RAISE NOTICE '    - 관리자는 하위 조직 사용자 데이터 수정 가능';
    RAISE NOTICE '';
    RAISE NOTICE '  ✓ transactions 테이블 RLS 활성화';
    RAISE NOTICE '    - 사용자는 본인의 pending 거래만 취소 가능';
    RAISE NOTICE '    - 관리자는 하위 조직 거래 승인/거부 가능';
    RAISE NOTICE '';
    RAISE NOTICE '이제 다음 기능이 정상 동작합니다:';
    RAISE NOTICE '  • 관리자의 입출금 승인 시 사용자 balance 업데이트';
    RAISE NOTICE '  • 관리자의 거래 상태 변경 (pending → completed/rejected)';
    RAISE NOTICE '  • 7단계 권한 체계에 따른 계층적 접근 제어';
    RAISE NOTICE '  • 사용자는 본인 데이터만 수정 가능';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
END $$;
