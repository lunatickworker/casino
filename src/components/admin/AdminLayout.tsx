import { useState, useEffect } from "react";
import { SidebarProvider } from "../ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { BettingHistorySync } from "./BettingHistorySync";
import { BalanceSyncManager } from "./BalanceSyncManager";
import { useAuth } from "../../contexts/AuthContext";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { Partner } from "../../types";
import { cn } from "../../lib/utils";
import { supabase } from "../../lib/supabase";

interface AdminLayoutProps {
  children: React.ReactNode;
  currentRoute: string;
  onNavigate: (route: string) => void;
}

export function AdminLayout({ children, currentRoute, onNavigate }: AdminLayoutProps) {
  const { authState } = useAuth();
  const { connected } = useWebSocketContext();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // =====================================================
  // setTimeout 기반 세션 자동 종료 (4분 비활성 세션)
  // pg_cron 대체 - 1분마다 체크하여 4분 비활성 세션 auto_ended 처리
  // =====================================================
  useEffect(() => {
    console.log('⏰ [AdminLayout] 세션 자동 종료 시스템 시작');
    
    const autoCloseInterval = setInterval(async () => {
      try {
        const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
        
        // 4분(240초) 이상 활동 없는 active 세션 조회
        const { data: inactiveSessions, error } = await supabase
          .from('game_launch_sessions')
          .select('id, user_id, last_activity_at')
          .eq('status', 'active')
          .lt('last_activity_at', fourMinutesAgo);

        if (error) throw error;

        if (inactiveSessions && inactiveSessions.length > 0) {
          console.log(`⏰ [AdminLayout] 비활성 세션 ${inactiveSessions.length}개 자동 종료 처리`);
          
          // 각 세션을 auto_ended 상태로 변경
          for (const session of inactiveSessions) {
            const { error: updateError } = await supabase
              .from('game_launch_sessions')
              .update({ 
                status: 'auto_ended', 
                ended_at: new Date().toISOString() 
              })
              .eq('id', session.id)
              .eq('status', 'active'); // 동시성 제어 (이미 종료된 세션 스킵)
            
            if (updateError) {
              console.error(`❌ [AdminLayout] 세션 ${session.id} 종료 실패:`, updateError);
            } else {
              console.log(`✅ [AdminLayout] 세션 ${session.id} 자동 종료 완료 (user_id: ${session.user_id})`);
            }
          }
          
          console.log(`✅ [AdminLayout] ${inactiveSessions.length}개 세션 자동 종료 완료`);
        }
      } catch (error) {
        console.error('❌ [AdminLayout] 세션 자동 종료 오류:', error);
      }
    }, 60000); // 1분(60초)마다 실행

    return () => {
      console.log('🧹 [AdminLayout] 세션 자동 종료 시스템 중지');
      clearInterval(autoCloseInterval);
    };
  }, []);

  if (!authState.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a]">
        <div className="text-center space-y-4">
          <div className="loading-premium mx-auto"></div>
          <p className="text-slate-300">로딩 중...</p>
        </div>
      </div>
    );
  }

  const user = authState.user as Partner;

  return (
    <SidebarProvider>
      {/* 백그라운드 베팅 기록 동기화 */}
      <BettingHistorySync user={user} />
      
      {/* 백그라운드 보유금 동기화 (30초 간격) */}
      <BalanceSyncManager user={user} />
      
      <div className="h-screen flex w-full overflow-hidden bg-[#0a0e1a]">
        <div className={cn(
          "fixed left-0 top-0 h-screen transition-all duration-300 z-40",
          "bg-[#0f1419]/95 backdrop-blur-xl border-r border-slate-700/50 shadow-xl",
          sidebarOpen ? "w-64" : "w-16"
        )}>
          <AdminSidebar 
            user={user}
            onNavigate={onNavigate}
            currentRoute={currentRoute}
            className="h-full"
          />
        </div>
        
        <div className={cn(
          "flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300",
          sidebarOpen ? "ml-64" : "ml-16"
        )}>
          <header className="sticky top-0 z-30 bg-[#0f1419]/90 backdrop-blur-lg border-b border-slate-700/50 shadow-sm">
            <AdminHeader 
              user={user}
              wsConnected={connected}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              onRouteChange={onNavigate}
              currentRoute={currentRoute}
            />
          </header>
          
          <main className="flex-1 p-6 overflow-y-auto bg-[#0a0e1a]">
            <div className="max-w-[1600px] mx-auto space-y-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default AdminLayout;