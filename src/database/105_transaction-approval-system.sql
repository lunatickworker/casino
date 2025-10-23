-- 입출금 승인 시스템 강화

-- 거래 처리 함수 (승인/거절)
CREATE OR REPLACE FUNCTION process_transaction_request(
  p_transaction_id UUID,
  p_action TEXT, -- 'approve' 또는 'reject'
  p_processed_by TEXT,
  p_processing_note TEXT DEFAULT NULL,
  p_new_balance DECIMAL DEFAULT NULL,
  p_external_tx_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transaction RECORD;
  v_user_id UUID;
  v_amount DECIMAL;
  v_transaction_type TEXT;
  v_result JSON;
BEGIN
  -- 거래 정보 조회
  SELECT * INTO v_transaction
  FROM transactions
  WHERE id = p_transaction_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '처리할 수 있는 거래를 찾을 수 없습니다.'
    );
  END IF;

  v_user_id := v_transaction.user_id;
  v_amount := v_transaction.amount;
  v_transaction_type := v_transaction.transaction_type;

  -- 거래 상태 업데이트
  UPDATE transactions
  SET 
    status = CASE 
      WHEN p_action = 'approve' THEN 'approved'::transaction_status
      WHEN p_action = 'reject' THEN 'rejected'::transaction_status
      ELSE status
    END,
    processed_at = NOW(),
    processed_by = p_processed_by,
    processing_note = p_processing_note,
    external_transaction_id = p_external_tx_id,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 승인인 경우 사용자 잔고 업데이트
  IF p_action = 'approve' AND p_new_balance IS NOT NULL THEN
    UPDATE users
    SET 
      balance = p_new_balance,
      updated_at = NOW()
    WHERE id = v_user_id;

    -- 잔고 변경 로그 기록
    INSERT INTO balance_logs (
      user_id,
      transaction_id,
      balance_before,
      balance_after,
      amount,
      transaction_type,
      processed_by,
      note,
      created_at
    ) VALUES (
      v_user_id,
      p_transaction_id,
      (SELECT balance FROM users WHERE id = v_user_id) - 
        CASE WHEN v_transaction_type = 'deposit' THEN v_amount ELSE -v_amount END,
      p_new_balance,
      v_amount,
      v_transaction_type,
      p_processed_by,
      p_processing_note,
      NOW()
    );
  END IF;

  -- 알림 생성
  INSERT INTO realtime_notifications (
    recipient_type,
    recipient_id,
    notification_type,
    title,
    content,
    action_url,
    status,
    created_at
  ) VALUES (
    'user',
    v_user_id,
    'transaction_' || p_action,
    CASE 
      WHEN p_action = 'approve' THEN '거래 승인'
      ELSE '거래 거절'
    END,
    CASE v_transaction_type
      WHEN 'deposit' THEN '입금'
      ELSE '출금'
    END || ' 요청이 ' || 
    CASE 
      WHEN p_action = 'approve' THEN '승인되었습니다.'
      ELSE '거절되었습니다.'
    END || 
    CASE WHEN p_processing_note IS NOT NULL THEN ' (' || p_processing_note || ')' ELSE '' END,
    '/user/transactions',
    'unread',
    NOW()
  );

  -- 메시지 큐에 추가
  INSERT INTO message_queue (
    message_type,
    priority,
    status,
    sender_type,
    sender_id,
    target_type,
    target_id,
    subject,
    message_data,
    reference_type,
    reference_id,
    created_at,
    scheduled_at
  ) VALUES (
    'transaction_processed',
    1, -- 높은 우선순위
    'pending',
    'admin',
    (SELECT id FROM partners WHERE username = p_processed_by LIMIT 1),
    'user',
    v_user_id,
    '거래 처리 알림',
    json_build_object(
      'transaction_id', p_transaction_id,
      'action', p_action,
      'amount', v_amount,
      'transaction_type', v_transaction_type,
      'new_balance', p_new_balance,
      'processed_by', p_processed_by,
      'note', p_processing_note
    ),
    'transaction',
    p_transaction_id,
    NOW(),
    NOW()
  );

  RETURN json_build_object(
    'success', true,
    'action', p_action,
    'transaction_id', p_transaction_id,
    'new_balance', p_new_balance
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 잔고 변경 로그 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS balance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  balance_before DECIMAL NOT NULL DEFAULT 0,
  balance_after DECIMAL NOT NULL DEFAULT 0,
  amount DECIMAL NOT NULL,
  transaction_type TEXT NOT NULL,
  processed_by TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 잔고 로그 인덱스
CREATE INDEX IF NOT EXISTS idx_balance_logs_user_id ON balance_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_logs_created_at ON balance_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_logs_transaction_id ON balance_logs(transaction_id);

-- RLS 정책
ALTER TABLE balance_logs ENABLE ROW LEVEL SECURITY;

-- 관리자만 잔고 로그 조회 가능
CREATE POLICY "Admins can view balance logs" ON balance_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM partners
      WHERE id = auth.uid()
      AND level <= 3
    )
  );

-- 시스템만 잔고 로그 삽입 가능
CREATE POLICY "System can insert balance logs" ON balance_logs
  FOR INSERT
  WITH CHECK (true);

-- 사용자별 최근 거래 내역 조회 함수 개선
CREATE OR REPLACE FUNCTION get_user_transaction_history_enhanced(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transactions JSON;
  v_balance_logs JSON;
  v_result JSON;
BEGIN
  -- 거래 내역 조회
  SELECT json_agg(
    json_build_object(
      'id', t.id,
      'transaction_type', t.transaction_type,
      'amount', t.amount,
      'status', t.status,
      'request_time', t.request_time,
      'processed_at', t.processed_at,
      'processed_by', t.processed_by,
      'processing_note', t.processing_note,
      'external_transaction_id', t.external_transaction_id,
      'created_at', t.created_at
    ) ORDER BY t.created_at DESC
  ) INTO v_transactions
  FROM transactions t
  WHERE t.user_id = p_user_id
  LIMIT p_limit;

  -- 잔고 변경 로그 조회
  SELECT json_agg(
    json_build_object(
      'id', bl.id,
      'balance_before', bl.balance_before,
      'balance_after', bl.balance_after,
      'amount', bl.amount,
      'transaction_type', bl.transaction_type,
      'processed_by', bl.processed_by,
      'note', bl.note,
      'created_at', bl.created_at
    ) ORDER BY bl.created_at DESC
  ) INTO v_balance_logs
  FROM balance_logs bl
  WHERE bl.user_id = p_user_id
  LIMIT p_limit;

  RETURN json_build_object(
    'success', true,
    'transactions', COALESCE(v_transactions, '[]'::json),
    'balance_logs', COALESCE(v_balance_logs, '[]'::json)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- 실시간 거래 통계 함수
CREATE OR REPLACE FUNCTION get_transaction_statistics(
  p_date_from DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  v_stats JSON;
BEGIN
  SELECT json_build_object(
    'total_transactions', COUNT(*),
    'pending_count', COUNT(*) FILTER (WHERE status = 'pending'),
    'approved_count', COUNT(*) FILTER (WHERE status = 'approved'),
    'rejected_count', COUNT(*) FILTER (WHERE status = 'rejected'),
    'completed_count', COUNT(*) FILTER (WHERE status = 'completed'),
    'total_deposit_amount', COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'deposit' AND status IN ('approved', 'completed')), 0),
    'total_withdrawal_amount', COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'withdrawal' AND status IN ('approved', 'completed')), 0),
    'pending_deposit_amount', COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'deposit' AND status = 'pending'), 0),
    'pending_withdrawal_amount', COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'pending'), 0),
    'avg_processing_time_minutes', COALESCE(EXTRACT(EPOCH FROM AVG(processed_at - created_at) FILTER (WHERE processed_at IS NOT NULL)) / 60, 0)
  ) INTO v_stats
  FROM transactions
  WHERE DATE(created_at) BETWEEN p_date_from AND p_date_to;

  RETURN json_build_object(
    'success', true,
    'data', v_stats,
    'period', json_build_object(
      'from', p_date_from,
      'to', p_date_to
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$;

-- 함수 실행 권한 부여
GRANT EXECUTE ON FUNCTION process_transaction_request TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_transaction_history_enhanced TO authenticated;
GRANT EXECUTE ON FUNCTION get_transaction_statistics TO authenticated;

-- 트리거: 거래 상태 변경 시 자동 알림
CREATE OR REPLACE FUNCTION notify_transaction_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- 상태가 변경된 경우에만 처리
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- WebSocket 알림 (pg_notify 사용)
    PERFORM pg_notify(
      'transaction_status_changed',
      json_build_object(
        'transaction_id', NEW.id,
        'user_id', NEW.user_id,
        'old_status', OLD.status,
        'new_status', NEW.status,
        'transaction_type', NEW.transaction_type,
        'amount', NEW.amount,
        'processed_by', NEW.processed_by,
        'timestamp', NOW()
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 트리거 생성
DROP TRIGGER IF EXISTS transaction_status_change_notify ON transactions;
CREATE TRIGGER transaction_status_change_notify
  AFTER UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_transaction_status_change();

-- 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_transactions_status_pending ON transactions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_transactions_user_status ON transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_processed_at ON transactions(processed_at) WHERE processed_at IS NOT NULL;

COMMENT ON FUNCTION process_transaction_request IS '입출금 거래 승인/거절 처리 함수 - 실시간 알림 및 메시지 큐 연동';
COMMENT ON FUNCTION get_user_transaction_history_enhanced IS '사용자별 상세 거래 내역 조회 함수';
COMMENT ON FUNCTION get_transaction_statistics IS '거래 통계 조회 함수';
COMMENT ON TABLE balance_logs IS '사용자 잔고 변경 로그 테이블';