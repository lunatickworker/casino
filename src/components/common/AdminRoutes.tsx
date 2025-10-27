import { lazy, Suspense } from "react";
import { LoadingSpinner } from "./LoadingSpinner";

// Lazy load 컴포넌트들 - 메모리 최적화
const Dashboard = lazy(() => import("../admin/Dashboard").then(m => ({ default: m.Dashboard })));
const UserManagement = lazy(() => import("../admin/UserManagement").then(m => ({ default: m.UserManagement })));
const BlacklistManagement = lazy(() => import("../admin/BlacklistManagement").then(m => ({ default: m.BlacklistManagement })));
const PointManagement = lazy(() => import("../admin/PointManagement").then(m => ({ default: m.PointManagement })));
const OnlineUsers = lazy(() => import("../admin/OnlineUsers").then(m => ({ default: m.OnlineUsers })));
const PartnerConnectionStatus = lazy(() => import("../admin/PartnerConnectionStatus").then(m => ({ default: m.PartnerConnectionStatus })));
const PartnerManagement = lazy(() => import("../admin/PartnerManagement").then(m => ({ default: m.PartnerManagement })));
const PartnerCreation = lazy(() => import("../admin/PartnerCreation").then(m => ({ default: m.PartnerCreation })));
const PartnerTransactions = lazy(() => import("../admin/PartnerTransactions").then(m => ({ default: m.PartnerTransactions })));
const CommissionSettlement = lazy(() => import("../admin/CommissionSettlement").then(m => ({ default: m.CommissionSettlement })));
const IntegratedSettlement = lazy(() => import("../admin/IntegratedSettlement").then(m => ({ default: m.IntegratedSettlement })));
const TransactionManagement = lazy(() => import("../admin/TransactionManagement").then(m => ({ default: m.TransactionManagement })));
const TransactionApprovalManager = lazy(() => import("../admin/TransactionApprovalManager").then(m => ({ default: m.TransactionApprovalManager })));
const EnhancedGameManagement = lazy(() => import("../admin/EnhancedGameManagement").then(m => ({ default: m.EnhancedGameManagement })));
const BettingManagement = lazy(() => import("../admin/BettingManagement").then(m => ({ default: m.BettingManagement })));
const BettingHistory = lazy(() => import("../admin/BettingHistory").then(m => ({ default: m.BettingHistory })));
const CallCycle = lazy(() => import("../admin/CallCycle").then(m => ({ default: m.CallCycle })));
const CustomerSupport = lazy(() => import("../admin/CustomerSupport").then(m => ({ default: m.CustomerSupport })));
const Announcements = lazy(() => import("../admin/Announcements").then(m => ({ default: m.Announcements })));
const MessageCenter = lazy(() => import("../admin/MessageCenter").then(m => ({ default: m.MessageCenter })));
const SystemSettings = lazy(() => import("../admin/SystemSettings").then(m => ({ default: m.SystemSettings })));
const BannerManagement = lazy(() => import("../admin/BannerManagement").then(m => ({ default: m.BannerManagement })));
const MenuManagement = lazy(() => import("../admin/MenuManagement").then(m => ({ default: m.MenuManagement })));
const ApiTester = lazy(() => import("../admin/ApiTester").then(m => ({ default: m.ApiTester })));
const AutoSyncMonitor = lazy(() => import("../admin/AutoSyncMonitor").then(m => ({ default: m.AutoSyncMonitor })));

interface AdminRoutesProps {
  currentRoute: string;
  user: any;
}

export function AdminRoutes({ currentRoute, user }: AdminRoutesProps) {
  const renderRoute = () => {
    switch (currentRoute) {
      // 대시보드
      case '/admin/dashboard':
      case '/admin/realtime':
        return <Dashboard user={user} />;

    // 회원 관리
    case '/admin/users':
    case '/admin/user-management':
      return <UserManagement />;
    case '/admin/blacklist':
      return <BlacklistManagement />;
    case '/admin/points':
      return <PointManagement />;
    case '/admin/online':
    case '/admin/online-users':
      return <OnlineUsers user={user} />;
    case '/admin/online-status':
      return <PartnerConnectionStatus user={user} />;
    case '/admin/logs':
      return <BettingHistory user={user} />;

    // 파트너 관리
    case '/admin/head-office':
    case '/admin/partners/master':
      return <PartnerCreation user={user} />;
    case '/admin/partners':
    case '/admin/partner-hierarchy':
      return <PartnerManagement />;
    case '/admin/partner-transactions':
    case '/admin/partners/transactions':
      return <PartnerTransactions />;
    case '/admin/partner-online':
    case '/admin/partners/status':
    case '/admin/partner-connection-status':
      return <PartnerConnectionStatus user={user} />;
    case '/admin/partner-dashboard':
    case '/admin/partners/dashboard':
      return <Dashboard user={user} />;

    // 정산 및 거래
    case '/admin/settlement':
    case '/admin/commission-settlement':
    case '/admin/settlement/commission':
      return <CommissionSettlement user={user} />;
    case '/admin/integrated-settlement':
    case '/admin/settlement/integrated':
      return <IntegratedSettlement user={user} />;
    case '/admin/transactions':
      return <TransactionManagement user={user} />;
    case '/admin/transaction-approval':
      return <TransactionApprovalManager user={user} />;

    // 게임 관리
    case '/admin/games':
    case '/admin/game-lists':
      return <EnhancedGameManagement user={user} />;
    case '/admin/betting':
    case '/admin/betting-history':
      return <BettingHistory user={user} />;
    case '/admin/betting-management':
      return <BettingManagement user={user} />;
    case '/admin/call-cycle':
      return <CallCycle user={user} />;

    // 커뮤니케이션
    case '/admin/communication':
    case '/admin/customer-service':
    case '/admin/support':
      return <CustomerSupport user={user} />;
    case '/admin/announcements':
      return <Announcements user={user} />;
    case '/admin/messages':
      return <MessageCenter user={user} />;

    // 시스템 설정
    case '/admin/settings':
    case '/admin/system-settings':
      return <SystemSettings user={user} />;
    case '/admin/system':
    case '/admin/system-info':
      return <SystemSettings user={user} initialTab="info" />;
    case '/admin/api-tester':
      return <ApiTester user={user} />;
    case '/admin/banners':
      return <BannerManagement user={user} />;
    case '/admin/menu-management':
      return <MenuManagement user={user} />;
    case '/admin/auto-sync-monitor':
      return <AutoSyncMonitor />;

      default:
        return <Dashboard user={user} />;
    }
  };

  return (
    <Suspense fallback={<LoadingSpinner size="lg" text="페이지를 불러오는 중..." className="min-h-screen" />}>
      {renderRoute()}
    </Suspense>
  );
}
