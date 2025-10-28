import { ReactNode, useEffect, useRef } from "react";
import { UserHeader } from "./UserHeader";
import { UserMessagePopup } from "./UserMessagePopup";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { Shield } from "lucide-react";
import { Button } from "../ui/button";

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

  // =====================================================
  // 게임창 강제 종료 함수 등록
  // =====================================================
  useEffect(() => {
    // 게임창 강제 종료 함수
    (window as any).forceCloseGameWindow = (sessionId: number) => {
      const gameWindows = (window as any).gameWindows as Map<number, Window>;
      const gameWindow = gameWindows?.get(sessionId);
      
      if (gameWindow && !gameWindow.closed) {
        gameWindow.close();
        gameWindows.delete(sessionId);
        console.log('🔴 게임창 강제 종료:', sessionId);
        toast.error('관리자에 의해 게임이 종료되었습니다.');
        return true;
      }
      return false;
    };

    return () => {
      delete (window as any).forceCloseGameWindow;
    };
  }, []);

  // =====================================================
  // 모든 외부 API 호출 제거 - Realtime Subscription만 사용
  // 1. 5초마다 세션 체크 폴링 제거
  // 2. 30초마다 전체 잔고 동기화 API 호출 제거
  // 3. 30초마다 베팅 동기화 API 호출 제거
  // Backend에서 30초마다 historyindex 호출하여 DB에 기록
  // Frontend는 Realtime Subscription으로만 데이터 수신
  // =====================================================
  useEffect(() => {
    if (!user?.id) {
      console.log('⚠️ [UserLayout] user.id 없음');
      return;
    }

    console.log('🚀 [UserLayout] Realtime Subscription 시스템 시작, user.id:', user.id);

    // game_launch_sessions 테이블 변경 감지 (API 호출 없이 realtime만 사용)
    const channel = supabase
      .channel('user_session_monitor')
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
            
            // 1. 세션이 강제종료된 경우 (active → ended, force_ended, auto_ended)
            if (oldSession?.status === 'active' && 
                (newSession.status === 'ended' || newSession.status === 'force_ended' || newSession.status === 'auto_ended')) {
              console.log('🛑 [UserLayout] 세션 종료 감지! status:', newSession.status, 'sessionId:', newSession.id);
              
              // 게임창 강제로 닫기
              const closed = (window as any).forceCloseGameWindow?.(newSession.id);
              
              if (closed) {
                if (newSession.status === 'force_ended') {
                  toast.error('관리자에 의해 게임이 종료되었습니다.');
                } else if (newSession.status === 'auto_ended') {
                  toast.error('4분간 베팅이 없어 게임이 자동 종료되었습니다.');
                }
              }
              
              // 모니터링 중지
              const existingInterval = sessionMonitorsRef.current.get(newSession.id);
              if (existingInterval) {
                console.log(`🧹 [UserLayout] 세션 ${newSession.id} 모니터 정리 (${newSession.status})`);
                clearInterval(existingInterval);
                sessionMonitorsRef.current.delete(newSession.id);
                lastBettingUpdateRef.current.delete(newSession.id);
                lastTxidRef.current.delete(newSession.id);
                console.log(`✅ [UserLayout] 세션 ${newSession.id} 모니터링 완전 중지`);
              }
            }
            
            // 2. 세션이 재활성화된 경우 (ended → active)
            else if (oldSession?.status === 'ended' && newSession.status === 'active') {
              console.log('🔄 [UserLayout] 세션 재활성화 감지! 타이머 리셋:', newSession.id);
              
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
        }
      )
      .subscribe((status) => {
        console.log('📡 [UserLayout] Realtime 구독 상태:', status);
      });

    return () => {
      console.log('🧹 [UserLayout] Cleanup 시작');
      console.log('🧹 [UserLayout] Realtime 채널 제거');
      supabase.removeChannel(channel);
      console.log('✅ [UserLayout] Cleanup 완료');
    };
  }, [user?.id]);

  // 세션 모니터 시작 (60초 타임아웃으로 변경)
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

      // 60초(변경됨) 타임아웃 체크 함수
      const checkTimeout = async () => {
        console.log(`\n🔄 ========== 세션 ${sessionId} 타임아웃 체크 ==========`);

        const lastUpdate = lastBettingUpdateRef.current.get(sessionId);
        if (!lastUpdate) {
          console.error(`❌ 세션 ${sessionId} lastUpdate 없음 (모니터 오류)`);
          return;
        }

        const timeSinceLastUpdate = Date.now() - lastUpdate;
        const secondsElapsed = Math.floor(timeSinceLastUpdate / 1000);
        const timeoutSeconds = 60; // 60초로 변경
        
        console.log(`⏱️ 세션 ${sessionId} 경과시간: ${secondsElapsed}초 / ${timeoutSeconds}초 (${(secondsElapsed / timeoutSeconds * 100).toFixed(1)}%)`);

        if (timeSinceLastUpdate > 60000) { // 60초 = 60000ms
          console.log(`⏱️ ========== 세션 ${sessionId} 타임아웃 감지 (60초) ==========`);
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
          console.log(`✅ 세션 ${sessionId} 아직 활성 (남은 시간: ${Math.floor((60000 - timeSinceLastUpdate) / 1000)}초)`);
        }

        console.log(`========== 세션 ${sessionId} 타임아웃 체크 완료 ==========\n`);
      };

      // 즉시 첫 호출
      console.log(`🚀 세션 ${sessionId} 첫 타임아웃 체크 (즉시 실행)`);
      await checkTimeout();
      
      // 10초마다 반복 (타임아웃 체크만)
      console.log(`⏰ 세션 ${sessionId} 인터벌 설정: 10초마다 반복`);
      const monitorInterval = setInterval(checkTimeout, 10000);
      sessionMonitorsRef.current.set(sessionId, monitorInterval);
      
      console.log(`✅ ========== 세션 ${sessionId} 모니터 등록 완료 ==========`);
      console.log(`📊 현재 모니터링 중인 세션 수: ${sessionMonitorsRef.current.size}`);

    } catch (error) {
      console.error(`❌ 세션 ${sessionId} 모니터 시작 오류:`, error);
    }
  };

  // game_records 테이블 변경 감지로 베팅 업데이트 확인
  useEffect(() => {
    if (!user?.id) return;

    console.log('🎲 [UserLayout] game_records 실시간 구독 시작');

    const channel = supabase
      .channel('user_betting_updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_records',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('🎲 [UserLayout] 새 베팅 감지!', payload.new);
          
          // 해당 세션의 lastBettingUpdate 시간 갱신
          const newRecord = payload.new as any;
          // game_records는 session_id를 갖고 있지 않으므로
          // 현재 active 세션들의 타이머를 모두 갱신
          const { data: activeSessions } = await supabase
            .from('game_launch_sessions')
            .select('id')
            .eq('user_id', user.id)
            .eq('status', 'active');

          if (activeSessions && activeSessions.length > 0) {
            activeSessions.forEach(session => {
              lastBettingUpdateRef.current.set(session.id, Date.now());
              console.log(`⏱️ 세션 ${session.id} 타이머 리셋 (새 베팅 감지)`);
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // 게임 세션 관리 함수들을 window 객체에 등록
  useEffect(() => {
    // 게임 시작 시 세션 모니터링 시작
    (window as any).startSessionMonitor = startSessionMonitor;

    // 게임 종료 후 잔고 동기화 함수
    (window as any).syncBalanceAfterGame = async (sessionId: number) => {
      try {
        console.log('🔄 게임 종료 후 세션 정리:', sessionId);
        
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
        
      } catch (error) {
        console.error('❌ 게임 종료 후 세션 정리 오류:', error);
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
    </div>
  );
}

// Default export 추가
export default UserLayout;