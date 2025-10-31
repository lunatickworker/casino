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