import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { getInfo } from '../lib/investApi';
import { Partner } from '../types';
import { toast } from 'sonner@2.0.3';

interface BalanceContextType {
  balance: number;
  loading: boolean;
  error: string | null;
  lastSyncTime: Date | null;
  syncBalance: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextType | null>(null);

export function useBalance() {
  const context = useContext(BalanceContext);
  if (!context) {
    throw new Error('useBalance must be used within BalanceProvider');
  }
  return context;
}

interface BalanceProviderProps {
  user: Partner | null;
  children: ReactNode;
}

export function BalanceProvider({ user, children }: BalanceProviderProps) {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const isSyncingRef = useRef<boolean>(false);

  // =====================================================
  // 1. DB에서 초기 보유금 로드 (한 번만)
  // =====================================================
  
  const loadBalanceFromDB = useCallback(async () => {
    if (!user?.id) return;

    console.log('💾 [Balance] DB에서 초기 보유금 로드:', {
      partner_id: user.id,
      nickname: user.nickname,
      level: user.level
    });

    try {
      const { data, error: dbError } = await supabase
        .from('partners')
        .select('balance')
        .eq('id', user.id)
        .single();

      if (dbError) {
        console.error('❌ [Balance] DB 조회 실패:', dbError);
        setError(dbError.message);
        return;
      }

      const currentBalance = data?.balance || 0;
      console.log('✅ [Balance] DB 로드 완료:', currentBalance);

      setBalance(currentBalance);
      setLastSyncTime(new Date());
      setError(null);
    } catch (err: any) {
      console.error('❌ [Balance] DB 조회 오류:', err);
      setError(err.message || 'DB 조회 오류');
    }
  }, [user]);

  // =====================================================
  // 2. API 동기화 (opcode가 있는 경우만, 수동 호출)
  // =====================================================
  
  const syncBalanceFromAPI = useCallback(async () => {
    if (!user?.id) return;

    // ✅ 상위 대본사의 opcode 조회 (opcodeHelper 사용)
    let opcode: string;
    let secretKey: string;
    let apiToken: string;

    try {
      const { getAdminOpcode, isMultipleOpcode } = await import('../lib/opcodeHelper');
      
      console.log('🔍 [Balance] 상위 대본사 opcode 조회 시작');
      const opcodeInfo = await getAdminOpcode(user);
      
      // 시스템 관리자인 경우 첫 번째 opcode 사용
      if (isMultipleOpcode(opcodeInfo)) {
        if (opcodeInfo.opcodes.length === 0) {
          const errorMsg = '사용 가능한 OPCODE가 없습니다. 시스템 관리자에게 문의하세요.';
          throw new Error(errorMsg);
        }
        opcode = opcodeInfo.opcodes[0].opcode;
        secretKey = opcodeInfo.opcodes[0].secretKey;
        apiToken = opcodeInfo.opcodes[0].token;
        console.log('✅ [Balance] 시스템관리자 - 첫 번째 opcode 사용:', opcode);
      } else {
        opcode = opcodeInfo.opcode;
        secretKey = opcodeInfo.secretKey;
        apiToken = opcodeInfo.token;
        console.log('✅ [Balance] 상위 대본사 opcode 조회 성공:', opcode);
      }
    } catch (err: any) {
      console.error('❌ [Balance] opcode 조회 실패:', err);
      const errorMsg = `상위 대본사 API 설정 조회 실패: ${err.message}`;
      setError(errorMsg);
      toast.error(errorMsg, { duration: 5000 });
      return;
    }

    if (isSyncingRef.current) {
      console.log('⏳ [Balance] 이미 동기화 중...');
      return;
    }

    isSyncingRef.current = true;
    setLoading(true);
    console.log('📡 [Balance] API /info 호출 시작:', {
      partner_id: user.id,
      opcode: opcode
    });

    try {
      const apiStartTime = Date.now();
      const apiResult = await getInfo(opcode, secretKey);
      const apiDuration = Date.now() - apiStartTime;

      // API 호출 로그 기록
      await supabase.from('api_sync_logs').insert({
        opcode: opcode,
        api_endpoint: '/api/info',
        sync_type: 'manual_balance_sync',
        status: apiResult.error ? 'failed' : 'success',
        request_data: {
          opcode: opcode,
          partner_id: user.id,
          partner_nickname: user.nickname
        },
        response_data: apiResult.error ? { error: apiResult.error } : apiResult.data,
        duration_ms: apiDuration,
        error_message: apiResult.error || null
      });

      if (apiResult.error) {
        console.error('❌ [Balance] API 호출 실패:', apiResult.error);
        setError(apiResult.error);
        toast.error(`API 동기화 실패: ${apiResult.error}`);
        return;
      }

      // API 응답 파싱
      const apiData = apiResult.data;
      let newBalance = 0;

      console.log('📊 [Balance] API 응답:', JSON.stringify(apiData, null, 2));

      if (apiData) {
        // JSON 응답: { RESULT: true, DATA: { balance: 105000, ... } }
        if (typeof apiData === 'object' && !apiData.is_text) {
          if (apiData.RESULT === true && apiData.DATA) {
            newBalance = parseFloat(apiData.DATA.balance || 0);
          } else if (apiData.balance !== undefined) {
            newBalance = parseFloat(apiData.balance || 0);
          }
        }
        // 텍스트 응답 파싱
        else if (apiData.is_text && apiData.text_response) {
          const balanceMatch = apiData.text_response.match(/balance["'\s:]+(\\d+\\.?\\d*)/i);
          if (balanceMatch) {
            newBalance = parseFloat(balanceMatch[1]);
          }
        }
      }

      console.log('💰 [Balance] 파싱된 보유금:', newBalance);

      // DB 업데이트 (Realtime 이벤트 발생!)
      const { error: updateError } = await supabase
        .from('partners')
        .update({
          balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('❌ [Balance] DB 업데이트 실패:', updateError);
        setError(updateError.message);
        toast.error('보유금 업데이트 실패');
      } else {
        console.log('✅ [Balance] DB 업데이트 완료');

        // 보유금 변경 로그 기록
        const oldBalance = balance;
        if (oldBalance !== newBalance) {
          await supabase.from('partner_balance_logs').insert({
            partner_id: user.id,
            balance_before: oldBalance,
            balance_after: newBalance,
            amount: newBalance - oldBalance,
            transaction_type: 'admin_adjustment',
            processed_by: user.id,
            memo: 'API /info 동기화'
          });
        }

        // 즉시 State 업데이트 (Realtime은 이중 보장용)
        setBalance(newBalance);
        setLastSyncTime(new Date());
        setError(null);
        
        console.log('✅ [Balance] 화면 업데이트 완료:', newBalance);
        toast.success(`보유금 동기화 완료: ₩${newBalance.toLocaleString()}`);
      }
    } catch (err: any) {
      console.error('❌ [Balance] API 동기화 오류:', err);
      setError(err.message || 'API 동기화 오류');
      toast.error(`동기화 오류: ${err.message}`);
    } finally {
      isSyncingRef.current = false;
      setLoading(false);
    }
  }, [user]);

  // =====================================================
  // 3. 통합 동기화 함수 (외부에서 호출)
  // =====================================================
  
  const syncBalance = useCallback(async () => {
    if (!user?.id) return;

    // ✅ 항상 API 동기화 시도 (내부에서 DB 재조회함)
    await syncBalanceFromAPI();
  }, [user, syncBalanceFromAPI]);

  // =====================================================
  // 4. 초기 로드 (컴포넌트 마운트 시 한 번만)
  // =====================================================
  
  useEffect(() => {
    if (!user?.id) return;

    console.log('🔄 [Balance] 초기화:', {
      partner_id: user.id,
      nickname: user.nickname,
      level: user.level,
      has_opcode: !!user.opcode,
      has_secret_key: !!user.secret_key
    });

    // ✅ 로그인 시 자동 동기화: 모든 파트너 실행 (상위 대본사의 opcode 사용)
    console.log('📡 [Balance] 로그인 시 자동 동기화 시작 (상위 대본사 opcode 사용)');
    syncBalanceFromAPI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // =====================================================
  // 5. Realtime 구독: partners 테이블 변경 감지
  // =====================================================
  
  useEffect(() => {
    if (!user?.id) return;

    console.log('🔔 [Balance] Realtime 구독 시작:', user.id);

    const channel = supabase
      .channel(`partner_balance_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'partners',
          filter: `id=eq.${user.id}`
        },
        (payload) => {
          const newBalance = parseFloat(payload.new?.balance) || 0;
          const oldBalance = parseFloat(payload.old?.balance) || 0;

          console.log('💰 [Balance] Realtime 업데이트 감지:', {
            old: oldBalance,
            new: newBalance,
            change: newBalance - oldBalance
          });

          // Realtime 이벤트로 state 업데이트 (이중 보장)
          setBalance(newBalance);
          setLastSyncTime(new Date());
          setError(null);
          
          // Toast 알림 (변화가 있을 때만, API 동기화 제외)
          if (oldBalance !== 0 && Math.abs(newBalance - oldBalance) > 0.01) {
            const changeAmount = newBalance - oldBalance;
            const changeText = changeAmount > 0 ? `+₩${changeAmount.toLocaleString()}` : `-₩${Math.abs(changeAmount).toLocaleString()}`;
            toast.info(`보유금 변경: ${changeText} (현재: ₩${newBalance.toLocaleString()})`);
          }
        }
      )
      .subscribe();

    return () => {
      console.log('🔕 [Balance] Realtime 구독 해제:', user.id);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return (
    <BalanceContext.Provider value={{ balance, loading, error, lastSyncTime, syncBalance }}>
      {children}
    </BalanceContext.Provider>
  );
}
