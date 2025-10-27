import { useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { getInfo, getAllAccountBalances } from '../../lib/investApi';
import { getAdminOpcode, isMultipleOpcode } from '../../lib/opcodeHelper';
import { Partner } from '../../types';

interface BalanceSyncManagerProps {
  user: Partner;
}

/**
 * ✅ 보유금 자동 동기화 매니저
 * 
 * 권한 레벨에 따라 다른 API를 호출하여 보유금을 동기화합니다:
 * - level 1 (시스템관리자), level 2 (본사): GET /api/info 호출
 * - level 2 user, level 3-7: PATCH /api/account/balance 호출하여 users/partners 테이블 동기화
 * 
 * 30초마다 자동 실행됩니다.
 */
export function BalanceSyncManager({ user }: BalanceSyncManagerProps) {
  const isSyncingRef = useRef(false);

  const syncAllBalances = async () => {
    if (isSyncingRef.current) {
      console.log('⏸️ [BalanceSync] 이미 동기화 중...');
      return;
    }

    try {
      isSyncingRef.current = true;

      console.log('🔄 [BalanceSync] 자동 동기화 시작:', {
        partner_id: user.id,
        username: user.username,
        level: user.level
      });

      // opcode 정보 조회
      const opcodeInfo = await getAdminOpcode(user);
      
      let opcode: string;
      let secretKey: string;
      let partnerId: string;

      if (isMultipleOpcode(opcodeInfo)) {
        if (opcodeInfo.opcodes.length === 0) {
          console.error('❌ [BalanceSync] 사용 가능한 OPCODE 없음');
          return;
        }
        opcode = opcodeInfo.opcodes[0].opcode;
        secretKey = opcodeInfo.opcodes[0].secretKey;
        partnerId = opcodeInfo.opcodes[0].partnerId;
      } else {
        opcode = opcodeInfo.opcode;
        secretKey = opcodeInfo.secretKey;
        partnerId = opcodeInfo.partnerId;
      }

      // ✅ 권한 레벨에 따라 다른 API 호출
      const shouldUseInfoAPI = user.level === 1 || user.level === 2;

      if (shouldUseInfoAPI) {
        // ========================================
        // 시스템관리자/본사: GET /api/info
        // ========================================
        console.log('📡 [BalanceSync] GET /api/info 호출 (level 1-2)');
        
        const apiResult = await getInfo(opcode, secretKey);

        if (apiResult.error) {
          console.error('❌ [BalanceSync] API 호출 실패:', apiResult.error);
          return;
        }

        const apiData = apiResult.data;
        let newBalance = 0;

        if (apiData) {
          if (typeof apiData === 'object' && !apiData.is_text) {
            if (apiData.RESULT === true && apiData.DATA) {
              newBalance = parseFloat(apiData.DATA.balance || 0);
            } else if (apiData.balance !== undefined) {
              newBalance = parseFloat(apiData.balance || 0);
            }
          } else if (apiData.is_text && apiData.text_response) {
            const balanceMatch = apiData.text_response.match(/balance["'\s:]+(\\d+\\.?\\d*)/i);
            if (balanceMatch) {
              newBalance = parseFloat(balanceMatch[1]);
            }
          }
        }

        // DB 업데이트
        await supabase
          .from('partners')
          .update({
            balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', partnerId);

        console.log('✅ [BalanceSync] 보유금 동기화 완료:', {
          partner_id: partnerId,
          new_balance: newBalance
        });

      } else {
        // ========================================
        // level 2 user, level 3-7: PATCH /api/account/balance
        // ========================================
        console.log('📡 [BalanceSync] PATCH /api/account/balance 호출 (level 2 user ~ 7)');
        
        const apiResult = await getAllAccountBalances(opcode, secretKey);

        if (apiResult.error) {
          console.error('❌ [BalanceSync] API 호출 실패:', apiResult.error);
          return;
        }

        const apiData = apiResult.data;

        // API 응답 파싱
        let balanceRecords: any[] = [];
        if (apiData) {
          if (typeof apiData === 'object' && !apiData.is_text) {
            if (apiData.RESULT === true && apiData.DATA && Array.isArray(apiData.DATA)) {
              balanceRecords = apiData.DATA;
            } else if (Array.isArray(apiData)) {
              balanceRecords = apiData;
            }
          }
        }

        if (balanceRecords.length === 0) {
          console.log('ℹ️ [BalanceSync] 업데이트할 잔고 데이터 없음');
          return;
        }

        console.log(`📊 [BalanceSync] ${balanceRecords.length}건의 잔고 정보 수신`);

        // ✅ username 매핑하여 users와 partners 테이블 동기화
        // ⚠️ 중요: username이 있는 데이터만 업데이트, 없는 username은 무시 (0으로 업데이트 절대 안함)
        let userUpdateCount = 0;
        let partnerUpdateCount = 0;
        let skippedCount = 0;

        for (const record of balanceRecords) {
          const username = record.username || record.user_id || record.id;
          const balance = parseFloat(record.balance || record.amount || 0);

          // username이 없는 경우 건너뜀 (무시)
          if (!username || username === '') {
            skippedCount++;
            continue;
          }

          // 1. users 테이블 업데이트 (username이 존재하는 경우만)
          const { data: userData, error: userError } = await supabase
            .from('users')
            .update({
              balance: balance,
              updated_at: new Date().toISOString()
            })
            .eq('username', username)
            .select('id');

          // 실제로 업데이트된 레코드만 카운트 (없는 username은 무시)
          if (!userError && userData && userData.length > 0) {
            userUpdateCount++;
          }

          // 2. partners 테이블 업데이트 (username이 존재하는 경우만)
          const { data: partnerData, error: partnerError } = await supabase
            .from('partners')
            .update({
              balance: balance,
              updated_at: new Date().toISOString()
            })
            .eq('username', username)
            .select('id');

          // 실제로 업데이트된 레코드만 카운트 (없는 username은 무시)
          if (!partnerError && partnerData && partnerData.length > 0) {
            partnerUpdateCount++;
          }
        }

        console.log('✅ [BalanceSync] 잔고 동기화 완료:', {
          total_records: balanceRecords.length,
          users_updated: userUpdateCount,
          partners_updated: partnerUpdateCount,
          skipped_no_username: skippedCount,
          note: '없는 username은 무시됨 (0으로 업데이트 안함)'
        });
      }

    } catch (error) {
      console.error('❌ [BalanceSync] 동기화 오류:', error);
    } finally {
      isSyncingRef.current = false;
    }
  };

  // 30초마다 자동 동기화
  useEffect(() => {
    console.log('🎯 [BalanceSync] 자동 동기화 시작 (30초 간격)');

    // 즉시 1회 실행
    syncAllBalances();

    // 30초마다 실행
    const interval = setInterval(() => {
      syncAllBalances();
    }, 30000);

    return () => {
      console.log('🛑 [BalanceSync] 자동 동기화 중지');
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
