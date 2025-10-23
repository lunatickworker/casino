import { memo, lazy, Suspense } from "react";

// 사용자 페이지 컴포넌트 (lazy loading)
const UserHome = lazy(() => import("../user/UserHome").then(m => ({ default: m.UserHome })));
const UserCasino = lazy(() => import("../user/UserCasino").then(m => ({ default: m.UserCasino })));
const UserSlot = lazy(() => import("../user/UserSlot").then(m => ({ default: m.UserSlot })));
const UserDeposit = lazy(() => import("../user/UserDeposit").then(m => ({ default: m.UserDeposit })));
const UserWithdraw = lazy(() => import("../user/UserWithdraw").then(m => ({ default: m.UserWithdraw })));
const UserNotice = lazy(() => import("../user/UserNotice").then(m => ({ default: m.UserNotice })));
const UserSupport = lazy(() => import("../user/UserSupport").then(m => ({ default: m.UserSupport })));
const UserProfile = lazy(() => import("../user/UserProfile").then(m => ({ default: m.UserProfile })));
const UserBettingHistory = lazy(() => import("../user/UserBettingHistory").then(m => ({ default: m.UserBettingHistory })));

interface UserRoutesProps {
  currentRoute: string;
  user: any;
  onRouteChange: (route: string) => void;
}

const LoadingFallback = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
  </div>
);

export const UserRoutes = memo(({ currentRoute, user, onRouteChange }: UserRoutesProps) => {
  const renderRoute = () => {
    switch (currentRoute) {
      case '/user/casino':
        return <UserCasino user={user} onRouteChange={onRouteChange} />;
      case '/user/slot':
        return <UserSlot user={user} onRouteChange={onRouteChange} />;
      case '/user/deposit':
        return <UserDeposit user={user} onRouteChange={onRouteChange} />;
      case '/user/withdraw':
        return <UserWithdraw user={user} onRouteChange={onRouteChange} />;
      case '/user/notice':
        return <UserNotice user={user} onRouteChange={onRouteChange} />;
      case '/user/support':
        return <UserSupport user={user} onRouteChange={onRouteChange} />;
      case '/user/profile':
        return <UserProfile user={user} onRouteChange={onRouteChange} />;
      case '/user/betting-history':
        return <UserBettingHistory user={user} />;
      case '/user/home':
      default:
        return <UserHome user={user} onRouteChange={onRouteChange} />;
    }
  };

  return (
    <Suspense fallback={<LoadingFallback />}>
      {renderRoute()}
    </Suspense>
  );
});

UserRoutes.displayName = 'UserRoutes';
