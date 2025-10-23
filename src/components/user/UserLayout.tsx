import { ReactNode, useEffect, useRef } from "react";
import { UserHeader } from "./UserHeader";
import { UserMessagePopup } from "./UserMessagePopup";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { Shield } from "lucide-react";
import { Button } from "../ui/button";
import * as investApi from "../../lib/investApi";

interface UserLayoutProps {
  user: any;
  currentRoute: string;
  onRouteChange: (route: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function UserLayout({ user, currentRoute, onRouteChange, onLogout, children }: UserLayoutProps) {
  const sessionMonitorsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());
  const lastBettingUpdateRef = useRef<Map<number, number>>(new Map());
  const lastTxidRef = useRef<Map<number, number>>(new Map());
  const balanceUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // =====================================================
  // active 세션일 때 30초마다 전체 계정 잔고 동기화 (PATCH)
  // =====================================================
  useEffect(() => {
    if (!user?.id) {
      console.log('⚠️ [UserLayout] user.id 없음, 잔고 업데이트 시스템 시작 안 함');
      return;
    }

    console.log('🚀 [UserLayout] 잔고 업데이트 시스템 시작, user.id:', user.id);

    const syncUserBalance = async () => {
      // ✅ 함수 실행 확인용 토스트 (맨 처음)
      toast.info('💰 전체계정잔고 동기화 시작');
      
      try {
        console.log('💰 [BALANCE-SYNC] ========================================');
        console.log('💰 [BALANCE-SYNC] 잔고 동기화 시작');

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('username, referrer_id')
          .eq('id', user.id)
          .single();

        if (userError || !userData || !userData.referrer_id) {
          console.error('❌ [BALANCE-SYNC] 사용자 조회 실패:', userError);
          toast.error('사용자 정보 조회 실패');
          return;
        }

        const { data: partnerData, error: partnerError } = await supabase
          .from('partners')
          .select('opcode, secret_key')
          .eq('id', userData.referrer_id)
          .single();

        if (partnerError || !partnerData) {
          console.error('❌ [BALANCE-SYNC] 파트너 조회 실패:', partnerError);
          toast.error('파트너 정보 조회 실패');
          return;
        }

        const { opcode, secret_key } = partnerData;
        const { username } = userData;

        if (!opcode || !secret_key || !username) {
          console.error('❌ [BALANCE-SYNC] API 정보 부족');
          toast.error('API 설정 정보가 부족합니다');
          return;
        }

        console.log('📡 [BALANCE-SYNC] PATCH /api/account/balance 호출 시작...');
        console.log('📡 [BALANCE-SYNC] opcode:', opcode);
        console.log('📡 [BALANCE-SYNC] username:', username);

        // PATCH: 전체 계정 잔고 조회
        const balanceResult = await investApi.getAllAccountBalances(opcode, secret_key);

        if (balanceResult.error) {
          console.error('❌ [BALANCE-SYNC] API 호출 실패:', balanceResult.error);
          toast.error('전체계정잔고 동기화 실패', {
            description: balanceResult.error
          });
          return;
        }

        console.log('📦 [BALANCE-SYNC] API 응답 성공');
        console.log('📦 [BALANCE-SYNC] 응답 데이터:', JSON.stringify(balanceResult.data).substring(0, 200));

        // 응답에서 해당 사용자의 잔고 추출
        const newBalance = investApi.extractBalanceFromResponse(balanceResult.data, username);
        console.log('💰 [BALANCE-SYNC] 추출된 잔고 (username: ' + username + '):', newBalance);

        if (newBalance >= 0) {
          const { error: updateError } = await supabase
            .from('users')
            .update({ 
              balance: newBalance,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

          if (!updateError) {
            console.log('✅ [BALANCE-SYNC] 잔고 업데이트 완료:', newBalance);
            toast.success('잔고 업데이트 완료', {
              description: `₩${newBalance.toLocaleString()}`
            });
          } else {
            console.error('❌ [BALANCE-SYNC] 잔고 업데이트 실패:', updateError);
            toast.error('잔고 업데이트 실패');
          }
        } else {
          console.warn('⚠️ [BALANCE-SYNC] 잔고를 추출할 수 없음 (newBalance < 0)');
        }

        console.log('💰 [BALANCE-SYNC] ========================================');
      } catch (error) {
        console.error('❌ [BALANCE-SYNC] 오류:', error);
        toast.error('잔고 동기화 오류', {
          description: error instanceof Error ? error.message : '알 수 없는 오류'
        });
      }
    };

    const checkAndStartBalanceSync = async () => {
      try {
        console.log('🔍 [UserLayout] active 세션 확인 중... user.id:', user.id);
        
        const { data: activeSessions, error } = await supabase
          .from('game_launch_sessions')
          .select('id, status, launched_at')
          .eq('user_id', user.id)
          .eq('status', 'active');

        if (error) {
          console.error('❌ [UserLayout] 세션 조회 오류:', error);
          return;
        }

        const hasActiveSession = activeSessions && activeSessions.length > 0;

        console.log('📊 [UserLayout] 세션 확인 결과:', {
          user_id: user.id,
          hasActiveSession,
          sessionCount: activeSessions?.length || 0,
          sessions: activeSessions,
          intervalExists: !!balanceUpdateIntervalRef.current
        });

        if (hasActiveSession && !balanceUpdateIntervalRef.current) {
          console.log('🎮 [UserLayout] ✅ active 세션 감지! 30초마다 잔고 업데이트 시작');
          
          // 즉시 한 번 실행
          await syncUserBalance();
          
          // 30초마다 반복
          balanceUpdateIntervalRef.current = setInterval(() => {
            console.log('⏰ [UserLayout] ========== 30초 타이머 실행 ==========');
            syncUserBalance();
          }, 30000);
          
          console.log('✅ [UserLayout] 인터벌 시작 완료, interval ID:', balanceUpdateIntervalRef.current);
        } else if (!hasActiveSession && balanceUpdateIntervalRef.current) {
          console.log('🛑 [UserLayout] active 세션 없음 - 잔고 업데이트 중지');
          clearInterval(balanceUpdateIntervalRef.current);
          balanceUpdateIntervalRef.current = null;
        } else if (!hasActiveSession) {
          console.log('ℹ️ [UserLayout] active 세션 없음 (인터벌도 없음)');
        } else {
          console.log('ℹ️ [UserLayout] active 세션 있음 (인터벌 이미 실행 중)');
        }
      } catch (err) {
        console.error('❌ [UserLayout] checkAndStartBalanceSync 오류:', err);
      }
    };

    // 초기 체크 (즉시 실행)
    console.log('🔄 [UserLayout] 초기 세션 체크 시작');
    checkAndStartBalanceSync();

    // 5초마다 세션 체크 (세션이 생성됐는지 확인)
    const sessionCheckInterval = setInterval(() => {
      console.log('🔄 [UserLayout] 정기 세션 체크 (5초마다)');
      checkAndStartBalanceSync();
    }, 5000);

    // game_launch_sessions 테이블 변경 감지
    const channel = supabase
      .channel('user_balance_sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_launch_sessions',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('🔔 [UserLayout] 세션 변경 감지!', payload.eventType, payload.new);
          
          // UPDATE 이벤트 처리
          if (payload.eventType === 'UPDATE' && payload.new) {
            const newSession = payload.new as any;
            const oldSession = payload.old as any;
            
            // 1. 세션이 강제종료된 경우 (active → ended)
            if (oldSession?.status === 'active' && newSession.status === 'ended') {
              console.log('🛑 [UserLayout] 세션 강제종료 감지! 모니터링 중지:', newSession.id);
              
              const existingInterval = sessionMonitorsRef.current.get(newSession.id);
              if (existingInterval) {
                console.log(`🧹 [UserLayout] 세션 ${newSession.id} 모니터 정리 (강제종료)`);
                clearInterval(existingInterval);
                sessionMonitorsRef.current.delete(newSession.id);
                lastBettingUpdateRef.current.delete(newSession.id);
                lastTxidRef.current.delete(newSession.id);
                console.log(`✅ [UserLayout] 세션 ${newSession.id} 모니터링 완전 중지`);
              }
            }
            
            // 2. 세션이 재활성화된 경우 (ended → active)
            else if (oldSession?.status === 'ended' && newSession.status === 'active') {
              console.log('🔄 [UserLayout] 세션 재활성화 감지! 모니터링 재시작:', newSession.id);
              
              // 기존 모니터가 있으면 명시적으로 정리 (정상적으로는 없어야 함)
              const existingInterval = sessionMonitorsRef.current.get(newSession.id);
              if (existingInterval) {
                console.warn(`⚠️ [UserLayout] ended 상태였는데 모니터가 존재? 정리 후 재시작`);
                clearInterval(existingInterval);
                sessionMonitorsRef.current.delete(newSession.id);
              }
              
              // 재활성화 시 타이머를 현재 시간으로 초기화
              lastBettingUpdateRef.current.set(newSession.id, Date.now());
              
              // lastTxidRef는 기존값 유지 (이미 가져온 베팅 중복 방지)
              if (!lastTxidRef.current.has(newSession.id)) {
                lastTxidRef.current.set(newSession.id, 0);
              }
              
              console.log(`✅ [UserLayout] 세션 ${newSession.id} 타이머 리셋 (재활성화) - lastUpdate=${Date.now()}, lastTxid=${lastTxidRef.current.get(newSession.id)}`);
              
              // 세션 모니터링 재시작
              await startSessionMonitor(newSession.id, newSession.user_id);
            }
          }
          
          checkAndStartBalanceSync();
        }
      )
      .subscribe((status) => {
        console.log('📡 [UserLayout] Realtime 구독 상태:', status);
      });

    return () => {
      console.log('🧹 [UserLayout] Cleanup 시작');
      if (balanceUpdateIntervalRef.current) {
        console.log('🧹 [UserLayout] 잔고 업데이트 인터벌 정리');
        clearInterval(balanceUpdateIntervalRef.current);
        balanceUpdateIntervalRef.current = null;
      }
      if (sessionCheckInterval) {
        console.log('🧹 [UserLayout] 세션 체크 인터벌 정리');
        clearInterval(sessionCheckInterval);
      }
      console.log('🧹 [UserLayout] Realtime 채널 제거');
      supabase.removeChannel(channel);
      console.log('✅ [UserLayout] Cleanup 완료');
    };
  }, [user?.id]);

  // 게임 세션 베팅 내역 동기화 함수
  const syncSessionBetting = async (sessionId: number, opcode: string, secretKey: string, username: string) => {
    try {
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString();

      const lastTxid = lastTxidRef.current.get(sessionId) || 0;

      console.log(`📊 세션 ${sessionId} 베팅 내역 동기화 (lastTxid: ${lastTxid}, username: ${username})`);

      // historyindex 호출
      const result = await investApi.getGameHistory(
        opcode,
        year,
        month,
        lastTxid,
        1000,
        secretKey
      );

      if (result.error) {
        console.log(`⚠️ 세션 ${sessionId} API 호출 오류:`, result.error);
        return false;
      }

      if (!result.data?.DATA || !Array.isArray(result.data.DATA)) {
        console.log(`⚠️ 세션 ${sessionId} 베팅 내역 없음 (DATA 배열 없음)`);
        return false;
      }

      const bettingData = result.data.DATA;
      console.log(`📦 세션 ${sessionId} API 응답: ${bettingData.length}건의 전체 베팅`);
      
      // 해당 사용자의 베팅만 필터링
      const userBettingData = bettingData.filter(
        record => (record.username || record.user) === username
      );

      console.log(`👤 세션 ${sessionId} 사용자 ${username} 베팅: ${userBettingData.length}건`);

      if (userBettingData.length === 0) {
        console.log(`ℹ️ 세션 ${sessionId} - ${username} 베팅 없음`);
        return false;
      }

      let maxTxid = lastTxid;
      let newRecordCount = 0;
      let duplicateCount = 0;

      // 베팅 데이터를 game_records에 저장
      for (const record of userBettingData) {
        try {
          const txid = parseInt(record.txid || record.id || '0');
          
          // 이미 처리한 txid는 건너뛰기
          if (txid <= lastTxid) {
            console.log(`⏭️ 세션 ${sessionId} txid ${txid} 이미 처리됨 (lastTxid: ${lastTxid})`);
            continue;
          }

          const balance = parseFloat(record.balance || 0);
          const betAmount = parseFloat(record.bet || 0);
          const winAmount = parseFloat(record.win || 0);

          // 중복 확인: 이미 DB에 있는지 체크
          const { data: existingRecord } = await supabase
            .from('game_records')
            .select('id')
            .eq('external_txid', txid)
            .maybeSingle();

          if (existingRecord) {
            console.log(`⏭️ 세션 ${sessionId} txid ${txid} 이미 DB에 존재 (중복 방지)`);
            duplicateCount++;
            maxTxid = Math.max(maxTxid, txid);
            continue;
          }

          console.log(`💾 세션 ${sessionId} txid ${txid} 저장 시도...`);

          const { error: insertError } = await supabase
            .from('game_records')
            .insert({
              external_txid: txid,
              username: record.username || username,
              user_id: null, // 트리거에서 자동으로 username → user_id 변환
              game_id: record.game_id || 0,
              provider_id: record.provider_id || Math.floor((record.game_id || 0) / 1000),
              game_title: record.game_title || null,
              provider_name: record.provider_name || null,
              bet_amount: betAmount,
              win_amount: winAmount,
              balance_before: balance + betAmount - winAmount,
              balance_after: balance,
              played_at: record.create_at || new Date().toISOString()
            });

          if (!insertError) {
            newRecordCount++;
            maxTxid = Math.max(maxTxid, txid);
            console.log(`✅ 세션 ${sessionId} txid ${txid} 저장 성공`);
          } else if (insertError.code === '23505') {
            // UNIQUE constraint 위반 (중복)
            console.log(`⏭️ 세션 ${sessionId} txid ${txid} 중복 (23505)`);
            duplicateCount++;
            maxTxid = Math.max(maxTxid, txid);
          } else {
            console.error(`❌ 세션 ${sessionId} txid ${txid} 저장 오류:`, insertError);
          }
        } catch (err: any) {
          console.error(`❌ 세션 ${sessionId} 베팅 처리 오류:`, err);
        }
      }

      // lastTxid 업데이트 (새 데이터가 있든 없든)
      if (maxTxid > lastTxid) {
        lastTxidRef.current.set(sessionId, maxTxid);
        console.log(`📝 세션 ${sessionId} lastTxid 업데이트: ${lastTxid} → ${maxTxid}`);
      }

      if (newRecordCount > 0) {
        lastBettingUpdateRef.current.set(sessionId, Date.now());
        console.log(`✅ 세션 ${sessionId} 새 베팅 ${newRecordCount}건 저장 완료 (중복 ${duplicateCount}건, maxTxid: ${maxTxid})`);
        return true;
      }

      if (duplicateCount > 0) {
        console.log(`ℹ️ 세션 ${sessionId} 중복 베팅만 ${duplicateCount}건 (새 데이터 없음)`);
      } else {
        console.log(`ℹ️ 세션 ${sessionId} 새 베팅 없음`);
      }
      return false;
    } catch (error) {
      console.error(`❌ 세션 ${sessionId} 베팅 내역 동기화 오류:`, error);
      return false;
    }
  };

  // 세션 모니터 시작
  const startSessionMonitor = async (sessionId: number, userId: string) => {
    try {
      console.log(`🎯 ========== 세션 ${sessionId} 모니터링 시작 요청 ==========`);
      console.log(`📝 세션 ID: ${sessionId}, 사용자 ID: ${userId}`);

      // 이미 모니터링 중이면 기존 인터벌 정리
      const existingInterval = sessionMonitorsRef.current.get(sessionId);
      if (existingInterval) {
        console.log(`⚠️ 세션 ${sessionId}는 이미 모니터링 중 - 기존 인터벌 정리 후 재시작`);
        clearInterval(existingInterval);
        sessionMonitorsRef.current.delete(sessionId);
      }

      // 사용자 정보 조회
      console.log(`🔍 세션 ${sessionId} 사용자 정보 조회 중...`);
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('referrer_id, username')
        .eq('id', userId)
        .single();

      if (userError || !userData) {
        console.error(`❌ 세션 ${sessionId} 사용자 정보 조회 실패:`, userError);
        return;
      }

      console.log(`✅ 세션 ${sessionId} 사용자 정보: username=${userData.username}, referrer_id=${userData.referrer_id}`);

      // API 설정 조회
      console.log(`🔍 세션 ${sessionId} API 설정 조회 중...`);
      const { data: apiConfig, error: apiError } = await supabase
        .from('partners')
        .select('opcode, secret_key')
        .eq('id', userData.referrer_id)
        .single();

      if (apiError || !apiConfig) {
        console.error(`❌ 세션 ${sessionId} API 설정 조회 실패:`, apiError);
        return;
      }

      console.log(`✅ 세션 ${sessionId} API 설정: opcode=${apiConfig.opcode}`);

      // 타이머 상태 확인 및 로그
      const hasExistingTimer = lastBettingUpdateRef.current.has(sessionId);
      const existingUpdate = lastBettingUpdateRef.current.get(sessionId);
      const existingTxid = lastTxidRef.current.get(sessionId);
      
      if (hasExistingTimer) {
        console.log(`📝 세션 ${sessionId} 기존 타이머 사용 (재활성화): lastUpdate=${existingUpdate}, lastTxid=${existingTxid || 0}`);
      } else {
        // 새 세션이면 타이머 초기화
        const now = Date.now();
        lastBettingUpdateRef.current.set(sessionId, now);
        lastTxidRef.current.set(sessionId, 0);
        console.log(`📝 세션 ${sessionId} 타이머 신규 초기화: lastUpdate=${now}, lastTxid=0`);
      }

      // 베팅 동기화 및 타임아웃 체크 함수
      const checkBettingAndTimeout = async () => {
        console.log(`\n🔄 ========== 세션 ${sessionId} 베팅 체크 시작 ==========`);
        
        const hasUpdate = await syncSessionBetting(
          sessionId, 
          apiConfig.opcode, 
          apiConfig.secret_key,
          userData.username
        );

        console.log(`📊 세션 ${sessionId} 베팅 동기화 결과: ${hasUpdate ? '새 베팅 있음' : '새 베팅 없음'}`);

        // 4분(240초) 동안 업데이트 없으면 세션 종료
        const lastUpdate = lastBettingUpdateRef.current.get(sessionId);
        if (!lastUpdate) {
          console.error(`❌ 세션 ${sessionId} lastUpdate 없음 (모니터 오류)`);
          return;
        }

        const timeSinceLastUpdate = Date.now() - lastUpdate;
        const secondsElapsed = Math.floor(timeSinceLastUpdate / 1000);
        const timeoutSeconds = 240; // 4분
        
        console.log(`⏱️ 세션 ${sessionId} 경과시간: ${secondsElapsed}초 / ${timeoutSeconds}초 (${(secondsElapsed / timeoutSeconds * 100).toFixed(1)}%)`);

        if (timeSinceLastUpdate > 240000) {
          console.log(`⏱️ ========== 세션 ${sessionId} 타임아웃 감지 (4분) ==========`);
          console.log(`🛑 세션 ${sessionId} 종료 처리 시작...`);
          
          // 세션 상태를 ended로 변경
          const { error: endError } = await supabase
            .from('game_launch_sessions')
            .update({
              status: 'ended',
              ended_at: new Date().toISOString()
            })
            .eq('id', sessionId);

          if (endError) {
            console.error(`❌ 세션 ${sessionId} 종료 처리 오류:`, endError);
          } else {
            console.log(`✅ 세션 ${sessionId} DB 상태 변경: active → ended`);
          }

          // 모니터링 중지
          const interval = sessionMonitorsRef.current.get(sessionId);
          if (interval) {
            console.log(`🛑 세션 ${sessionId} 모니터 인터벌 중지`);
            clearInterval(interval);
            sessionMonitorsRef.current.delete(sessionId);
            lastBettingUpdateRef.current.delete(sessionId);
            lastTxidRef.current.delete(sessionId);
          }

          console.log(`✅ 세션 ${sessionId} 모니터링 완전 종료`);
        } else {
          console.log(`✅ 세션 ${sessionId} 아직 활성 (남은 시간: ${Math.floor((240000 - timeSinceLastUpdate) / 1000)}초)`);
        }

        console.log(`========== 세션 ${sessionId} 베팅 체크 완료 ==========\n`);
      };

      // 즉시 첫 호출
      console.log(`🚀 세션 ${sessionId} 첫 베팅 동기화 (즉시 실행)`);
      await checkBettingAndTimeout();
      
      // 30초마다 반복
      console.log(`⏰ 세션 ${sessionId} 인터벌 설정: 30초마다 반복`);
      const monitorInterval = setInterval(checkBettingAndTimeout, 30000);
      sessionMonitorsRef.current.set(sessionId, monitorInterval);
      
      console.log(`✅ ========== 세션 ${sessionId} 모니터 등록 완료 ==========`);
      console.log(`📊 현재 모니터링 중인 세션 수: ${sessionMonitorsRef.current.size}`);

    } catch (error) {
      console.error(`❌ 세션 ${sessionId} 모니터 시작 오류:`, error);
    }
  };

  // 게임 세션 관리 함수들을 window 객체에 등록
  useEffect(() => {
    // 게임 시작 시 세션 모니터링 시작
    (window as any).startSessionMonitor = startSessionMonitor;

    // 게임 종료 후 잔고 동기화 함수
    (window as any).syncBalanceAfterGame = async (sessionId: number) => {
      try {
        console.log('🔄 게임 종료 후 잔고 동기화 시작:', sessionId);
        
        // 모니터링 중지
        const interval = sessionMonitorsRef.current.get(sessionId);
        if (interval) {
          clearInterval(interval);
          clearTimeout(interval as any);
          sessionMonitorsRef.current.delete(sessionId);
          lastBettingUpdateRef.current.delete(sessionId);
          lastTxidRef.current.delete(sessionId);
        }

        // 게임 세션 종료 표시
        const { error: sessionError } = await supabase
          .from('game_launch_sessions')
          .update({ 
            status: 'ended',
            ended_at: new Date().toISOString()
          })
          .eq('id', sessionId);

        if (sessionError) {
          console.error('❌ 게임 세션 종료 오류:', sessionError);
        } else {
          console.log('✅ 게임 세션 종료 완료');
        }

        console.log('✅ 잔고 동기화 완료');
        
      } catch (error) {
        console.error('❌ 게임 종료 후 잔고 동기화 오류:', error);
      }
    };

    // 게임 세션 종료 함수
    (window as any).endGameSession = async (sessionId: number) => {
      try {
        console.log('🔚 게임 세션 강제 종료:', sessionId);
        
        // 모니터링 중지
        const interval = sessionMonitorsRef.current.get(sessionId);
        if (interval) {
          clearInterval(interval);
          clearTimeout(interval as any);
          sessionMonitorsRef.current.delete(sessionId);
          lastBettingUpdateRef.current.delete(sessionId);
          lastTxidRef.current.delete(sessionId);
        }

        const { error: sessionError } = await supabase
          .from('game_launch_sessions')
          .update({ 
            status: 'ended',
            ended_at: new Date().toISOString()
          })
          .eq('id', sessionId);

        if (sessionError) {
          console.error('❌ 게임 세션 종료 오류:', sessionError);
        } else {
          console.log('✅ 게임 세션 종료 완료');
        }
        
      } catch (error) {
        console.error('❌ 게임 세션 종료 오류:', error);
      }
    };

    // 컴포넌트 언마운트 시 정리
    return () => {
      sessionMonitorsRef.current.forEach((interval) => clearInterval(interval));
      sessionMonitorsRef.current.clear();
      lastBettingUpdateRef.current.clear();
      lastTxidRef.current.clear();
      
      delete (window as any).startSessionMonitor;
      delete (window as any).syncBalanceAfterGame;
      delete (window as any).endGameSession;
    };
  }, [user.id]);

  return (
    <div className="min-h-screen casino-gradient-bg overflow-x-hidden">
      {/* VIP 화려한 상단 빛 효과 */}
      <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-yellow-500/10 via-red-500/5 to-transparent pointer-events-none" />
      
      <UserHeader 
        user={user}
        currentRoute={currentRoute}
        onRouteChange={onRouteChange}
        onLogout={onLogout}
      />
      
      {/* 관리자 메시지 팝업 (최상단 고정) */}
      <UserMessagePopup userId={user.id} />
      
      <main className="relative pb-20 lg:pb-4 pt-16 overflow-x-hidden">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-6 relative z-10 max-w-full">
          {children}
        </div>
      </main>

      {/* 하단 그라데이션 효과 */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/50 to-transparent pointer-events-none z-0" />
      
      {/* 관리자 페이지 이동 버튼 (우측 하단) */}
      <Button
        onClick={() => {
          window.history.pushState({}, '', '/admin');
          window.dispatchEvent(new Event('popstate'));
        }}
        className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg hover:shadow-xl transition-all"
        size="lg"
      >
        <Shield className="w-5 h-5 mr-2" />
        관리자
      </Button>
    </div>
  );
}

// Default export 추가
export default UserLayout;