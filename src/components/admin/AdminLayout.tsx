import { useState } from "react";
import { SidebarProvider } from "../ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useWebSocketContext } from "../../contexts/WebSocketContext";
import { Partner } from "../../types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ExternalLink } from "lucide-react";

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
          
          <main className="flex-1 p-6 overflow-y-auto bg-[#0a0e1a] pb-20">
            <div className="max-w-[1600px] mx-auto space-y-6">
              {children}
            </div>
          </main>

          {/* 사용자 페이지로 이동 버튼 (고정) */}
          <div className="fixed bottom-6 right-6 z-50">
            <Button
              onClick={() => {
                window.history.pushState({}, '', '/user');
                window.dispatchEvent(new Event('popstate'));
              }}
              className="h-14 px-6 rounded-xl shadow-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 border border-cyan-400/30 transition-all duration-300 hover:scale-105 hover:shadow-cyan-500/50"
            >
              <ExternalLink className="h-5 w-5 mr-2" />
              <span className="font-semibold">사용자 페이지</span>
            </Button>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default AdminLayout;
