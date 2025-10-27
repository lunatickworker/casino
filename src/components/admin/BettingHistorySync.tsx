import { useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import * as investApi from '../../lib/investApi';
import * as opcodeHelper from '../../lib/opcodeHelper';
import { Partner } from '../../types';

interface BettingHistorySyncProps {
  user: Partner;
}

/**
 * ✅ 4분 이상 베팅이 없는 active 세션을 ended로 변경
 */
const checkAndEndInactiveSessions = async () => {
  try {
    console.log('🔍 [SESSION-CHECK] 무활동 세션 확인 시작');

    // 1. 모든 active 세션의 마지막 베팅 시간 확인
    const { data: activeSessions, error: sessionError } = await supabase
      .from('game_launch_sessions')
      .select(`
        id,
        user_id,
        game_id,
        launched_at,
        users!inner (
          username
        )
      `)
      .eq('status', 'active');

    if (sessionError) {
      console.error('❌ [SESSION-CHECK] 세션 조회 오류:', sessionError);
      return;
    }

    if (!activeSessions || activeSessions.length === 0) {
      console.log('ℹ️ [SESSION-CHECK] active 세션 없음');
      return;
    }

    console.log(`📊 [SESSION-CHECK] active 세션 ${activeSessions.length}개 확인`);

    // 2. 각 세션의 마지막 베팅 시간 확인
    const now = new Date();
    const fourMinutesAgo = new Date(now.getTime() - 4 * 60 * 1000);
    let endedCount = 0;

    for (const session of activeSessions) {
      try {
        // 해당 세션의 마지막 베팅 기록 조회
        const { data: lastBetting, error: bettingError } = await supabase
          .from('game_records')
          .select('played_at')
          .eq('user_id', session.user_id)
          .eq('game_id', session.game_id)
          .order('played_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (bettingError) {
          console.error(`❌ [SESSION-CHECK] 베팅 기록 조회 오류 (세션 ${session.id}):`, bettingError);
          continue;
        }

        // 3. 마지막 베팅이 4분 이상 전이면 세션 종료
        if (lastBetting) {
          const lastBettingTime = new Date(lastBetting.played_at);
          
          if (lastBettingTime < fourMinutesAgo) {
            // 세션 종료
            const { error: updateError } = await supabase
              .from('game_launch_sessions')
              .update({
                status: 'ended',
                ended_at: now.toISOString()
              })
              .eq('id', session.id);

            if (updateError) {
              console.error(`❌ [SESSION-CHECK] 세션 종료 오류 (세션 ${session.id}):`, updateError);
            } else {
              endedCount++;
              console.log(`🔚 [SESSION-CHECK] 세션 종료: user=${session.users.username}, 마지막 베팅=${lastBettingTime.toISOString()}`);
            }
          }
        } else {
          // 베팅 기록이 없으면 launched_at 기준으로 확인
          const launchedAt = new Date(session.launched_at);
          
          if (launchedAt < fourMinutesAgo) {
            const { error: updateError } = await supabase
              .from('game_launch_sessions')
              .update({
                status: 'ended',
                ended_at: now.toISOString()
              })
              .eq('id', session.id);

            if (updateError) {
              console.error(`❌ [SESSION-CHECK] 세션 종료 오류 (세션 ${session.id}):`, updateError);
            } else {
              endedCount++;
              console.log(`🔚 [SESSION-CHECK] 세션 종료 (베팅 없음): user=${session.users.username}, launched=${launchedAt.toISOString()}`);
            }
          }
        }
      } catch (err) {
        console.error(`❌ [SESSION-CHECK] 세션 처리 오류 (세션 ${session.id}):`, err);
      }
    }

    if (endedCount > 0) {
      console.log(`✅ [SESSION-CHECK] ${endedCount}개 세션 종료 완료`);
    } else {
      console.log(`ℹ️ [SESSION-CHECK] 종료할 세션 없음 (모든 세션이 4분 이내 활동 중)`);
    }

  } catch (error) {
    console.error('❌ [SESSION-CHECK] 무활동 세션 확인 오류:', error);
  }
};

// ✅ processSingleOpcode를 모듈 레벨로 이동하여 forceSyncBettingHistory에서도 사용 가능
const processSingleOpcode = async (
  opcode: string,
  secretKey: string,
  partnerId: string,
  year: string,
  month: string
) => {
  try {
    console.log(`📡 [BETTING-SYNC] OPCODE ${opcode} 처리 시작`);

    // 1. DB에서 해당 파트너의 가장 큰 external_txid (= API의 id) 조회하여 index로 사용
    const { data: lastRecord } = await supabase
      .from('game_records')
      .select('external_txid')
      .eq('partner_id', partnerId)
      .order('external_txid', { ascending: false })
      .limit(1)
      .single();

    const lastIndex = lastRecord?.external_txid || 0;
    console.log(`📍 [BETTING-SYNC] OPCODE ${opcode} 마지막 id (index): ${lastIndex}`);

    // 2. API 호출 (마지막 index 이후부터, limit 최대값 사용)
    const result = await investApi.getGameHistory(opcode, year, month, lastIndex, 4000, secretKey);

    if (result.error || !result.data) {
      console.log(`⚠️ [BETTING-SYNC] OPCODE ${opcode} API 실패`);
      return;
    }

    // 3. 데이터 추출
    let bettingRecords: any[] = [];
    if (result.data.DATA && Array.isArray(result.data.DATA)) {
      bettingRecords = result.data.DATA;
    } else if (Array.isArray(result.data)) {
      bettingRecords = result.data;
    }

    if (bettingRecords.length === 0) {
      console.log(`ℹ️ [BETTING-SYNC] OPCODE ${opcode} 새로운 데이터 없음`);
      return;
    }

    console.log(`📊 [BETTING-SYNC] OPCODE ${opcode}: ${bettingRecords.length}건 (id ${lastIndex} 이후)`);
    
    // 최신/최초 id 로그 (unique 값)
    if (bettingRecords.length > 0) {
      const ids = bettingRecords.map(r => typeof r.id === 'number' ? r.id : parseInt(r.id || '0', 10));
      const maxId = Math.max(...ids);
      const minId = Math.min(...ids);
      console.log(`   📍 id 범위: ${minId} ~ ${maxId} (unique 값)`);
    }

    // 3. 사용자 정보 조회 (제한 없이 모든 회원 조회하여 매칭)
    const { data: allUsers } = await supabase
      .from('users')
      .select('id, username, referrer_id');

    const userMap = new Map<string, { id: string; referrer_id: string }>();
    if (allUsers) {
      allUsers.forEach((u: any) => {
        userMap.set(u.username, { id: u.id, referrer_id: u.referrer_id });
      });
    }
    
    console.log(`   👥 전체 회원 수: ${userMap.size}명`);

    // 4. 개별 INSERT (가장 간단하고 확실한 방법)
    let successCount = 0;
    let skipCount = 0;

    // ⚠️ 최신 데이터 우선 처리를 위해 id 기준 역순 정렬 (id가 unique 값)
    const sortedRecords = [...bettingRecords].sort((a, b) => {
      const aId = typeof a.id === 'number' ? a.id : parseInt(a.id || '0', 10);
      const bId = typeof b.id === 'number' ? b.id : parseInt(b.id || '0', 10);
      return bId - aId; // 내림차순 (최신 id 먼저)
    });

    let noUsernameCount = 0;
    let noUserDataCount = 0;
    let noIdCount = 0;

    for (const record of sortedRecords) {
      try {
        const username = record.username;
        if (!username) {
          noUsernameCount++;
          continue;
        }

        const userData = userMap.get(username);
        if (!userData) {
          noUserDataCount++;
          continue;
        }

        // ✅ 중요: external_txid는 API의 id 값을 사용 (unique 값)
        const externalTxidRaw = record.id;
        if (!externalTxidRaw) {
          noIdCount++;
          continue;
        }

        const externalTxidNum = typeof externalTxidRaw === 'number'
          ? externalTxidRaw
          : parseInt(externalTxidRaw.toString(), 10);

        if (isNaN(externalTxidNum)) {
          noIdCount++;
          continue;
        }

        const betAmount = parseFloat(record.bet || record.bet_amount || '0');
        const winAmount = parseFloat(record.win || record.win_amount || '0');
        const balanceAfter = parseFloat(record.balance || record.balance_after || '0');
        const balanceBefore = balanceAfter - (winAmount - betAmount);
        const playedAt = record.create_at || record.played_at || record.created_at || new Date().toISOString();

        // ✅ 개별 INSERT (에러는 조용히 무시)
        const { error } = await supabase
          .from('game_records')
          .insert({
            partner_id: partnerId,
            external_txid: externalTxidNum,
            username: username,
            user_id: userData.id,
            game_id: record.game_id || record.game,
            provider_id: record.provider_id || Math.floor((record.game_id || record.game || 410000) / 1000),
            game_title: record.game_title || null,
            provider_name: record.provider_name || null,
            bet_amount: betAmount,
            win_amount: winAmount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            played_at: playedAt
          });

        if (error) {
          // 23505 = 중복 (정상)
          if (error.code === '23505') {
            skipCount++;
          } else {
            // 다른 에러는 로그 출력
            console.error(`   ❌ INSERT 실패 (external_txid: ${externalTxidNum}):`, error);
          }
        } else {
          successCount++;
        }

      } catch (err) {
        // INSERT 외부 에러도 로그 출력
        console.error(`   ❌ 레코드 처리 오류:`, err);
      }
    }

    if (noUsernameCount > 0 || noUserDataCount > 0 || noIdCount > 0) {
      console.log(`   ⚠️ 건너뛴 데이터: username 없음 ${noUsernameCount}건, user 매칭 실패 ${noUserDataCount}건, id 없음 ${noIdCount}건`);
    }

    console.log(`✅ [BETTING-SYNC] OPCODE ${opcode} 완료: 성공 ${successCount}건, 중복 ${skipCount}건`);
    
    if (successCount > 0) {
      console.log(`   💾 신규 베팅 ${successCount}건이 DB에 저장되었습니다.`);
      
      // 🔍 저장 직후 DB 확인
      const { data: verifyData, error: verifyError } = await supabase
        .from('game_records')
        .select('id, external_txid, username, partner_id')
        .eq('partner_id', partnerId)
        .order('external_txid', { ascending: false })
        .limit(3);
      
      if (!verifyError && verifyData && verifyData.length > 0) {
        console.log(`   🔍 DB 확인: 최근 저장된 ${verifyData.length}건`, verifyData);
      } else if (verifyError) {
        console.error(`   ❌ DB 확인 오류:`, verifyError);
      } else {
        console.warn(`   ⚠️ DB에서 데이터를 찾을 수 없습니다! partner_id: ${partnerId}`);
      }
      
      // ✅ 베팅 기록 저장 후 세션 상태 확인 및 업데이트
      await checkAndEndInactiveSessions();
    }

  } catch (error) {
    console.error(`❌ [BETTING-SYNC] OPCODE ${opcode} 오류:`, error);
  }
};

/**
 * ✅ 강제 동기화 함수 (export) - 세션 체크 없이 무조건 API 호출
 * 새로고침 버튼 클릭 시 사용
 */
export async function forceSyncBettingHistory(user: Partner) {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString();

  console.log('🔄 [BETTING-FORCE-SYNC] 강제 동기화 시작', { year, month });

  try {
    const opcodeInfo = await opcodeHelper.getAdminOpcode(user);
    
    if (opcodeHelper.isMultipleOpcode(opcodeInfo)) {
      // 시스템관리자: 여러 opcode 처리
      const uniqueOpcodes = new Map<string, typeof opcodeInfo.opcodes[0]>();
      for (const info of opcodeInfo.opcodes) {
        if (!uniqueOpcodes.has(info.opcode)) {
          uniqueOpcodes.set(info.opcode, info);
        }
      }

      for (const [, info] of uniqueOpcodes) {
        await processSingleOpcode(info.opcode, info.secretKey, info.partnerId, year, month);
      }
    } else {
      // 일반 관리자: 단일 opcode
      await processSingleOpcode(opcodeInfo.opcode, opcodeInfo.secretKey, opcodeInfo.partnerId, year, month);
    }

    console.log('✅ [BETTING-FORCE-SYNC] 강제 동기화 완료');
  } catch (error) {
    console.error('❌ [BETTING-FORCE-SYNC] 오류:', error);
    throw error;
  }
}

/**
 * 베팅 기록 자동 동기화 컴포넌트 (SIMPLIFIED VERSION)
 * - 30초마다 historyindex API 호출
 * - 개별 INSERT만 사용 (배치 포기)
 * - 중복 에러는 조용히 무시
 * - 베팅 기록 저장 후 4분 무활동 세션 자동 종료
 */
export function BettingHistorySync({ user }: BettingHistorySyncProps) {
  const isProcessingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const syncBettingHistory = async () => {
    if (isProcessingRef.current) {
      return;
    }

    try {
      isProcessingRef.current = true;

      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString();

      console.log('🎲 [BETTING-SYNC] 시작', { year, month });

      const opcodeInfo = await opcodeHelper.getAdminOpcode(user);
      
      if (opcodeHelper.isMultipleOpcode(opcodeInfo)) {
        // 시스템관리자: 여러 opcode 처리
        const uniqueOpcodes = new Map<string, typeof opcodeInfo.opcodes[0]>();
        for (const info of opcodeInfo.opcodes) {
          if (!uniqueOpcodes.has(info.opcode)) {
            uniqueOpcodes.set(info.opcode, info);
          }
        }

        for (const [, info] of uniqueOpcodes) {
          await processSingleOpcode(info.opcode, info.secretKey, info.partnerId, year, month);
        }
      } else {
        // 일반 관리자: 단일 opcode
        await processSingleOpcode(opcodeInfo.opcode, opcodeInfo.secretKey, opcodeInfo.partnerId, year, month);
      }

      console.log('✅ [BETTING-SYNC] 완료');

    } catch (error) {
      console.error('❌ [BETTING-SYNC] 오류:', error);
    } finally {
      isProcessingRef.current = false;
    }
  };

  // 30초마다 자동 동기화 (단 한 번만 설정)
  useEffect(() => {
    console.log('🎯 [BETTING-SYNC] 자동 동기화 시작');

    // 기존 interval이 있으면 제거
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // 즉시 1회 실행
    syncBettingHistory();

    // 30초마다 실행
    intervalRef.current = setInterval(() => {
      console.log('⏰ [BETTING-SYNC] 30초 타이머 실행:', new Date().toISOString());
      syncBettingHistory();
    }, 30000);

    return () => {
      console.log('🛑 [BETTING-SYNC] 자동 동기화 중지');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // ✅ 빈 배열로 변경하여 한 번만 실행

  return null;
}