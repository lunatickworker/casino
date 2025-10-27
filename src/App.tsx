import { useState, useEffect } from 'react';
import { Toaster } from './components/ui/sonner';
import { AdminLogin } from './components/admin/AdminLogin';
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminRoutes } from './components/common/AdminRoutes';
import { UserLogin } from './components/user/UserLogin';
import { UserLayout } from './components/user/UserLayout';
import { UserRoutes } from './components/common/UserRoutes';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BalanceProvider } from './contexts/BalanceContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { MessageQueueProvider } from './components/common/MessageQueueProvider';
import { supabase } from './lib/supabase';

function AppContent() {
  const { authState, logout } = useAuth();
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const handlePopState = () => forceUpdate({});
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleNavigate = (route: string) => {
    window.history.pushState({}, '', route);
    forceUpdate({});
  };

  const currentPath = window.location.pathname;
  
  // 루트 경로는 관리자 페이지로 리다이렉트 (즉시 처리)
  if (currentPath === '/' || currentPath === '') {
    window.history.replaceState({}, '', '/admin');
    window.location.pathname = '/admin';
    return null;
  }

  const isUserPage = currentPath.startsWith('/user');
  const isAdminPage = currentPath.startsWith('/admin');

  // 사용자 페이지 라우팅
  if (isUserPage) {
    const currentRoute = currentPath;

    // 사용자 페이지는 별도의 세션 확인 (localStorage의 user_session)
    const userSessionString = localStorage.getItem('user_session');
    let userSession = null;
    
    try {
      if (userSessionString) {
        userSession = JSON.parse(userSessionString);
      }
    } catch (error) {
      console.error('사용자 세션 파싱 오류:', error);
      localStorage.removeItem('user_session');
    }

    const isUserAuthenticated = !!userSession;

    // 사용자 로그아웃 처리 함수
    const handleUserLogout = async () => {
      if (!userSession?.id) {
        localStorage.removeItem('user_session');
        window.history.replaceState({}, '', '/user');
        forceUpdate({});
        return;
      }

      try {
        console.log('🔓 사용자 로그아웃 처리 시작:', userSession.id);

        // 1. users.is_online = false 업데이트
        const { error: userError } = await supabase
          .from('users')
          .update({ 
            is_online: false,
            updated_at: new Date().toISOString()
          })
          .eq('id', userSession.id);

        if (userError) {
          console.error('❌ is_online 업데이트 오류:', userError);
        } else {
          console.log('✅ is_online = false 업데이트 완료');
        }

        // 2. user_sessions 테이블의 활성 세션 종료
        const { error: sessionError } = await supabase
          .from('user_sessions')
          .update({ 
            is_active: false,
            logout_at: new Date().toISOString()
          })
          .eq('user_id', userSession.id)
          .eq('is_active', true);

        if (sessionError) {
          console.error('❌ user_sessions 종료 오류:', sessionError);
        } else {
          console.log('✅ user_sessions 종료 완료');
        }

        // 3. game_launch_sessions 테이블의 활성 세션 종료
        const { error: gameSessError } = await supabase
          .from('game_launch_sessions')
          .update({ 
            status: 'ended',
            ended_at: new Date().toISOString()
          })
          .eq('user_id', userSession.id)
          .eq('status', 'active');

        if (gameSessError) {
          console.error('❌ game_launch_sessions 종료 오류:', gameSessError);
        } else {
          console.log('✅ game_launch_sessions 종료 완료');
        }

        // 4. 활동 로그 기록
        await supabase
          .from('activity_logs')
          .insert([{
            actor_type: 'user',
            actor_id: userSession.id,
            action: 'logout',
            details: {
              username: userSession.username,
              logout_time: new Date().toISOString()
            }
          }]);

        console.log('✅ 로그아웃 처리 완료');

      } catch (error) {
        console.error('❌ 로그아웃 처리 오류:', error);
      } finally {
        // 5. localStorage 제거 및 리다이렉트 (에러 발생 여부와 무관하게 실행)
        localStorage.removeItem('user_session');
        window.history.replaceState({}, '', '/user');
        forceUpdate({});
      }
    };

    return (
      <>
        {!isUserAuthenticated ? (
          <UserLogin onLoginSuccess={(user) => {
            localStorage.setItem('user_session', JSON.stringify(user));
            window.history.replaceState({}, '', '/user/casino');
            forceUpdate({});
          }} />
        ) : (
          <WebSocketProvider>
            <MessageQueueProvider userType="user" userId={userSession.id}>
              <UserLayout 
                user={userSession}
                currentRoute={currentRoute}
                onRouteChange={handleNavigate}
                onLogout={handleUserLogout}
              >
                <UserRoutes 
                  currentRoute={currentRoute} 
                  user={userSession}
                  onRouteChange={handleNavigate}
                />
              </UserLayout>
            </MessageQueueProvider>
          </WebSocketProvider>
        )}
        <Toaster position="top-right" />
      </>
    );
  }

  // 관리자 페이지 라우팅 (기본)
  const currentRoute = isAdminPage && currentPath !== '/admin' && currentPath !== '/admin/'
    ? currentPath
    : '/admin/dashboard';

  const isAuthenticated = authState.isAuthenticated && authState.user;

  return (
    <>
      {!isAuthenticated ? (
        <AdminLogin onLoginSuccess={() => {
          window.history.replaceState({}, '', '/admin/dashboard');
          forceUpdate({});
        }} />
      ) : (
        <WebSocketProvider>
          <BalanceProvider user={authState.user}>
            <MessageQueueProvider userType="admin" userId={authState.user.id}>
              <AdminLayout currentRoute={currentRoute} onNavigate={handleNavigate}>
                <AdminRoutes currentRoute={currentRoute} user={authState.user} />
              </AdminLayout>
            </MessageQueueProvider>
          </BalanceProvider>
        </WebSocketProvider>
      )}
      <Toaster position="top-right" />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
