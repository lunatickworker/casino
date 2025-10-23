-- ================================
-- 106. 회원 안전 삭제 시스템
-- ================================

-- 회원 안전 삭제 함수
CREATE OR REPLACE FUNCTION delete_user_safe(
  user_id_param UUID,
  admin_id_param UUID,
  confirm_username_param TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_record RECORD;
  result JSON;
BEGIN
  -- 1. 사용자 존재 확인
  SELECT * INTO user_record
  FROM users 
  WHERE id = user_id_param;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '사용자를 찾을 수 없습니다.'
    );
  END IF;
  
  -- 2. 사용자명 확인 (안전장치)
  IF user_record.username != confirm_username_param THEN
    RETURN json_build_object(
      'success', false,
      'error', '사용자명이 일치하지 않습니다.'
    );
  END IF;
  
  -- 3. 관리자 권한 확인
  IF NOT EXISTS (
    SELECT 1 FROM partners 
    WHERE id = admin_id_param 
    AND level IN (1, 2, 3, 4, 5) -- 매장(6) 및 사용자(7) 제외
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', '삭제 권한이 없습니다.'
    );
  END IF;
  
  BEGIN
    -- 4. 삭제 로그 기록 (삭제 전)
    INSERT INTO activity_logs (
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      details,
      ip_address,
      created_at
    ) VALUES (
      'partner',
      admin_id_param,
      'user_deletion_attempt',
      'user',
      user_id_param,
      json_build_object(
        'username', user_record.username,
        'nickname', user_record.nickname,
        'balance', user_record.balance,
        'status', user_record.status,
        'deletion_reason', 'admin_manual_deletion'
      ),
      '127.0.0.1',
      NOW()
    );
    
    -- 5. 관련 데이터 백업 및 정리
    -- 포인트 내역은 유지 (감사 목적)
    UPDATE point_transactions 
    SET memo = COALESCE(memo, '') || ' [사용자 삭제됨: ' || NOW()::TEXT || ']'
    WHERE user_id = user_id_param;
    
    -- 게임 세션 정리
    DELETE FROM game_sessions WHERE user_id = user_id_param;
    
    -- 메시지 큐 정리
    DELETE FROM message_queue WHERE user_id = user_id_param;
    
    -- 알림 정리
    DELETE FROM notifications WHERE user_id = user_id_param;
    
    -- 6. 사용자 계정 삭제
    DELETE FROM users WHERE id = user_id_param;
    
    -- 7. 성공 로그 기록
    INSERT INTO activity_logs (
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      details,
      ip_address,
      created_at
    ) VALUES (
      'partner',
      admin_id_param,
      'user_deleted_success',
      'user',
      user_id_param,
      json_build_object(
        'username', user_record.username,
        'nickname', user_record.nickname,
        'final_balance', user_record.balance,
        'deletion_completed_at', NOW()
      ),
      '127.0.0.1',
      NOW()
    );
    
    RETURN json_build_object(
      'success', true,
      'message', '회원이 성공적으로 삭제되었습니다.',
      'data', json_build_object(
        'deleted_user', json_build_object(
          'id', user_record.id,
          'username', user_record.username,
          'nickname', user_record.nickname
        ),
        'deleted_at', NOW()
      )
    );
    
  EXCEPTION WHEN OTHERS THEN
    -- 에러 로그 기록
    INSERT INTO activity_logs (
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      details,
      ip_address,
      created_at
    ) VALUES (
      'partner',
      admin_id_param,
      'user_deletion_failed',
      'user',
      user_id_param,
      json_build_object(
        'username', user_record.username,
        'error', SQLERRM,
        'error_state', SQLSTATE
      ),
      '127.0.0.1',
      NOW()
    );
    
    RETURN json_build_object(
      'success', false,
      'error', '삭제 중 오류가 발생했습니다: ' || SQLERRM
    );
  END;
END;
$$;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION delete_user_safe(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_user_safe(UUID, UUID, TEXT) TO service_role;

-- RLS 정책 확인 및 수정 (필요시)
-- activity_logs 테이블의 INSERT 권한 확인
DO $$
BEGIN
  -- activity_logs 테이블이 없으면 생성
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs') THEN
    CREATE TABLE activity_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_type TEXT NOT NULL,
      actor_id UUID,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id UUID,
      details JSONB,
      ip_address TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- RLS 활성화
    ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
    
    -- 기본 정책 생성
    CREATE POLICY "authenticated_can_insert_activity_logs" ON activity_logs
      FOR INSERT TO authenticated WITH CHECK (true);
      
    CREATE POLICY "authenticated_can_select_own_activity_logs" ON activity_logs
      FOR SELECT TO authenticated USING (
        actor_id = auth.uid() OR 
        EXISTS (
          SELECT 1 FROM partners 
          WHERE id = auth.uid() 
          AND level <= 3
        )
      );
  END IF;
END $$;

-- 회원 삭제 관련 통계 뷰 생성
CREATE OR REPLACE VIEW user_deletion_stats AS
SELECT 
  DATE_TRUNC('day', created_at) as deletion_date,
  COUNT(*) as total_deletions,
  COUNT(CASE WHEN (details->>'final_balance')::NUMERIC > 0 THEN 1 END) as deletions_with_balance,
  SUM((details->>'final_balance')::NUMERIC) as total_deleted_balance,
  STRING_AGG(DISTINCT details->>'username', ', ') as deleted_usernames
FROM activity_logs 
WHERE action = 'user_deleted_success'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY deletion_date DESC;

-- 뷰 권한 설정
GRANT SELECT ON user_deletion_stats TO authenticated;

COMMENT ON FUNCTION delete_user_safe(UUID, UUID, TEXT) IS '회원 안전 삭제 함수 - 확인 절차와 로깅을 포함한 완전한 사용자 삭제';
COMMENT ON VIEW user_deletion_stats IS '회원 삭제 통계 - 일별 삭제 현황과 잔고 정보';