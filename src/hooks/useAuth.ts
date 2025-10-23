import { useState, useEffect, createContext, useContext } from 'react';
import { Partner, AuthState } from '../types';
import { supabase } from '../lib/supabase';
import { storage } from '../lib/utils';

const AuthContext = createContext<{
  authState: AuthState;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  quickLogin: () => Promise<{ success: boolean; error?: string }>;
  checkAuth: () => Promise<void>;
} | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function useAuthProvider() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    token: null,
  });

  // 초기 인증 상태 확인
  useEffect(() => {
    const token = storage.get('auth_token');
    const user = storage.get('auth_user');
    
    if (token && user && typeof user.level === 'number') {
      setAuthState({
        isAuthenticated: true,
        user,
        token,
      });
    }
  }, []);

  const login = async (username: string, password: string) => {
    try {
      // ✅ DB 기반 로그인 (bcrypt 비밀번호 검증은 RPC 필요)
      const { data: loginData, error: loginError } = await supabase
        .rpc('partner_login', {
          p_username: username,
          p_password: password
        });

      if (loginError) {
        console.error('로그인 RPC 오류:', loginError);
        return { 
          success: false, 
          error: `로그인 오류: ${loginError.message || '알 수 없는 오류'}` 
        };
      }

      if (!loginData || loginData.length === 0) {
        console.error('로그인 실패: 사용자 데이터 없음');
        return { 
          success: false, 
          error: '아이디 또는 비밀번호가 올바르지 않습니다.' 
        };
      }

      // ✅ DB에서 조회한 실제 데이터만 사용 (RPC는 배열 반환)
      const partnerData = loginData[0];
      const systemAdminUser: Partner = {
        id: partnerData.id,
        username: partnerData.username,
        nickname: partnerData.nickname,
        partner_type: partnerData.partner_type,
        level: partnerData.level,
        parent_id: partnerData.parent_id || undefined,
        status: partnerData.status,
        balance: partnerData.balance,
        opcode: partnerData.opcode || undefined,
        secret_key: partnerData.secret_key || undefined,
        api_token: partnerData.api_token || undefined,
        commission_rolling: partnerData.commission_rolling,
        commission_losing: partnerData.commission_losing,
        withdrawal_fee: partnerData.withdrawal_fee,
        last_login_at: partnerData.last_login_at,
        created_at: partnerData.created_at,
      };

      console.log('✅ 파트너 로그인 성공:', {
        id: systemAdminUser.id,
        username: systemAdminUser.username,
        partner_type: systemAdminUser.partner_type,
        level: systemAdminUser.level,
        has_opcode: !!systemAdminUser.opcode,
        has_secret_key: !!systemAdminUser.secret_key,
        has_api_token: !!systemAdminUser.api_token
      });

      const newAuthState = {
        isAuthenticated: true,
        user: systemAdminUser,
        token: `partner-token-${systemAdminUser.id}`,
      };

      setAuthState(newAuthState);
      storage.set('auth_token', newAuthState.token);
      storage.set('auth_user', systemAdminUser);

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: '로그인 중 오류가 발생했습니다.' };
    }
  };

  const quickLogin = async () => {
    // ✅ 빠른 로그인 = 일반 로그인과 동일 (smcdev11 계정)
    return await login('smcdev11', 'smcdev11!');
  };

  const logout = () => {
    setAuthState({
      isAuthenticated: false,
      user: null,
      token: null,
    });
    storage.remove('auth_token');
    storage.remove('auth_user');
  };

  const checkAuth = async () => {
    const token = storage.get('auth_token');
    const user = storage.get('auth_user');
    
    if (token && user && typeof user.level === 'number') {
      setAuthState({
        isAuthenticated: true,
        user,
        token,
      });
    }
  };

  return {
    authState,
    login,
    logout,
    quickLogin,
    checkAuth,
  };
}

export { AuthContext };