import { ReactNode, useEffect, useRef } from "react";
import { UserHeader } from "./UserHeader";
import { UserMessagePopup } from "./UserMessagePopup";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";
import { investApi } from "../../lib/investApi";

interface UserLayoutProps {
  user: any;
  currentRoute: string;
  onRouteChange: (route: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function UserLayout({ user, currentRoute, onRouteChange, onLogout, children }: UserLayoutProps) {
  const syncingSessionsRef = useRef<Set<number>>(new Set());

  // ==========================================================================
  // 게임창 강제 종료 함수
  // ==========================================================================
  useEffect(() => {
    (window as any).forceCloseGameWindow = (sessionId: number) => {
      const gameWindows = (window as any).gameWindows as Map<number, Window>;
      const gameWindow = gameWindows?.get(sessionId);
      
      if (gameWindow && !gameWindow.closed) {
        gameWindow.close();
        gameWindows.delete(sessionId);
        return true;
      }
      return false;
    };

    return () => {
      delete (window as any).forceCloseGameWindow;
    };
  }, []);

  // ==========================================================================
  // 세션 종료 시 보유금 API 동기화
  // ==========================================================================
  const syncBalanceForSession = async (sessionId: number) => {
    // 중복 동기화 방지
    if (syncingSessionsRef.current.has(sessionId)) {
      console.log(`⚠️ [보유금 동기화] 이미 진행 중: 세션 ${sessionId}`);
      return;
    }

    try {
      syncingSessionsRef.current.add(sessionId);
      console.log(`💰 [보유금 동기화] 시작: 세션 ${sessionId}`);

      // 세션 정보 조회 (users + partners JOIN)
      console.log(`🔍 [보유금 동기화] 세션 조회 시작: sessionId=${sessionId}`);
      
      const { data: session, error: sessionError } = await supabase
        .from('game_launch_sessions')
        .select(`
          user_id,
          users(
            username,
            referrer_id,
            partners:referrer_id(opcode, api_token, secret_key, username)
          )
        `)
        .eq('id', sessionId)
        .single();

      console.log(`🔍 [보유금 동기화] 세션 조회 결과:`, { 
        session, 
        sessionError,
        hasUsers: !!session?.users
      });

      if (sessionError || !session || !session.users) {
        console.error(`❌ [보유금 동기화] 세션 조회 실패:`, { 
          sessionId,
          error: sessionError,
          errorCode: sessionError?.code,
          errorMessage: sessionError?.message
        });
        return;
      }

      const username = (session.users as any).username;
      const partner = (session.users as any).partners;
      
      console.log(`🔍 [보유금 동기화] 파싱된 데이터:`, {
        username,
        partner,
        referrer_id: (session.users as any).referrer_id
      });

      if (!username) {
        console.error(`❌ [보유금 동기화] username 없음`);
        return;
      }

      if (!partner || !partner.opcode) {
        console.error(`❌ [보유금 동기화] partner 정보 없음`, {
          username,
          sessionId,
          referrer_id: (session.users as any).referrer_id,
          partner
        });
        return;
      }

      if (!partner.api_token || !partner.secret_key) {
        console.error(`❌ [보유금 동기화] API 설정 불완전`, {
          opcode: partner.opcode,
          hasApiToken: !!partner.api_token,
          hasSecretKey: !!partner.secret_key,
          apiTokenLength: partner.api_token?.length || 0,
          secretKeyLength: partner.secret_key?.length || 0
        });
        console.error(`💡 해결 방법: partners 테이블에서 opcode='${partner.opcode}'인 레코드에 api_token과 secret_key를 설정하세요.`);
        console.error(`SQL: UPDATE partners SET api_token = 'YOUR_TOKEN', secret_key = 'YOUR_SECRET' WHERE opcode = '${partner.opcode}';`);
        return;
      }

      console.log(`💰 [보유금 조회] API 호출: ${username} (opcode: ${partner.opcode})`);

      // API 호출하여 보유금 조회 (API 설정 직접 전달)
      const balanceResult = await investApi.getUserBalanceWithConfig(
        partner.opcode,
        username,
        partner.api_token,
        partner.secret_key
      );

      if (balanceResult.success && balanceResult.balance !== undefined) {
        // DB 업데이트
        const { error: updateError } = await supabase
          .from('users')
          .update({ 
            balance: balanceResult.balance,
            last_synced_at: new Date().toISOString()
          })
          .eq('id', session.user_id);

        if (updateError) {
          console.error(`❌ [보유금 동기화] DB 업데이트 실패:`, updateError);
        } else {
          console.log(`✅ [보유금 동기화] 완료: ${username} = ${balanceResult.balance}원`);
        }
      } else {
        console.error(`❌ [보유금 동기화] API 조회 실패:`, balanceResult.error);
      }

    } catch (error) {
      console.error(`❌ [보유금 동기화] 오류:`, error);
    } finally {
      syncingSessionsRef.current.delete(sessionId);
    }
  };

  // ==========================================================================
  // 세션 이벤트 감지 (Realtime)
  // ==========================================================================
  useEffect(() => {
    if (!user?.id) return;

    console.log('🚀 [세션 감지] 시작');

    const channel = supabase
      .channel('user_session_monitor')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_launch_sessions',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          const { new: newSession, old: oldSession } = payload as any;

          // 세션 종료 감지 (active → ended/force_ended/auto_ended)
          if (oldSession?.status === 'active' && 
              ['ended', 'force_ended', 'auto_ended'].includes(newSession.status)) {
            console.log('🛑 [세션 종료]', newSession.id, newSession.status);
            
            // 게임창 닫기
            const closed = (window as any).forceCloseGameWindow?.(newSession.id);
            if (closed && newSession.status === 'force_ended') {
              toast.error('관리자에 의해 게임이 종료되었습니다.');
            } else if (newSession.status === 'auto_ended') {
              toast.info('4분간 베팅이 없어 게임이 종료되었습니다.');
            }

            // 세션 종료 시 보유금 동기화
            await syncBalanceForSession(newSession.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ==========================================================================
  // 사용자 is_online 상태 모니터링 (60번 보유금 조회 후 오프라인 처리 감지)
  // ==========================================================================
  useEffect(() => {
    if (!user?.id) return;

    console.log('👤 [온라인 상태 모니터링] 시작:', user.id);

    const channel = supabase
      .channel('user_online_status_monitor')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${user.id}`
        },
        async (payload) => {
          const { new: newUser, old: oldUser } = payload as any;

          // ✅ balance_sync_call_count 60회 도달 감지 - 즉시 로그아웃
          const oldCount = oldUser?.balance_sync_call_count || 0;
          const newCount = newUser?.balance_sync_call_count || 0;
          
          // ⚠️ 테스트용: 1회로 설정 (운영 시 60으로 변경)
          const LOGOUT_COUNT_LIMIT = 60; // 🔧 여기 수정: 60으로 변경
          
          if (newCount >= LOGOUT_COUNT_LIMIT && oldCount < LOGOUT_COUNT_LIMIT) {
            console.log('⚠️ [자동 로그아웃] 보유금 조회 도달 감지:', {
              old_count: oldCount,
              new_count: newCount,
              limit: LOGOUT_COUNT_LIMIT,
              duration: LOGOUT_COUNT_LIMIT === 60 ? '30분 경과' : '테스트 모드'
            });
            
            // 즉시 로그아웃 처리
            console.log('🚪 [자동 로그아웃] 실행');
            onLogout();
            return;
          }

          // 온라인 → 오프라인 전환 감지 (balance_sync_call_count 60회 초과로 인한 자동 로그아웃)
          if (oldUser?.is_online === true && newUser?.is_online === false) {
            console.log('⚠️ [자동 로그아웃] 오프라인 전환 감지');
            
            // 즉시 로그아웃 처리
            console.log('🚪 [자동 로그아웃] 실행');
            onLogout();
          }
        }
      )
      .subscribe();

    return () => {
      console.log('👤 [온라인 상태 모니터링] 종료');
      supabase.removeChannel(channel);
    };
  }, [user?.id, onLogout]);

  // ==========================================================================
  // 게임창 닫힘 감지 시 세션 종료 + 보유금 동기화
  // ==========================================================================
  useEffect(() => {
    (window as any).syncBalanceAfterGame = async (sessionId: number) => {
      try {
        console.log('🔄 [게임창 닫힘] 세션 종료:', sessionId);
        
        // 세션 종료
        const { error: endError } = await supabase
          .from('game_launch_sessions')
          .update({ 
            status: 'ended',
            ended_at: new Date().toISOString()
          })
          .eq('id', sessionId)
          .eq('status', 'active');

        if (endError) {
          console.error('❌ [세션 종료 오류]:', endError);
          return;
        }

        // 보유금 동기화
        await syncBalanceForSession(sessionId);

      } catch (error) {
        console.error('❌ [게임창 닫힘 오류]:', error);
      }
    };

    return () => {
      delete (window as any).syncBalanceAfterGame;
      syncingSessionsRef.current.clear();
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
      
      <main className="relative pb-32 lg:pb-4 pt-20 lg:pt-20 overflow-x-hidden">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-6 relative z-10 max-w-full">
          {children}
        </div>
      </main>

      {/* 하단 그라데이션 효과 */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/50 to-transparent pointer-events-none z-0" />
    </div>
  );
}

export default UserLayout;
