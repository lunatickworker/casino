import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { investApi } from '../lib/investApi';

interface User {
  id: string;
  username: string;
  nickname: string;
  status: string;
  balance: number;
  points: number;
  vip_level: number;
  referrer_id?: string;
  is_online: boolean;
  created_at: string;
  updated_at: string;
}

interface UserAuthState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
}

export function useUserAuth() {
  const [authState, setAuthState] = useState<UserAuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true
  });

  // 🔒 내부 DB 기반 잔고 관리 (외부 API 호출 제거)
  // 💰 실시간 WebSocket 기반으로 관리자페이지와 동기화
  const refreshUserBalance = useCallback(async (user: User) => {
    try {
      console.log('💰 내부 DB 잔고 새로고침:', user.username);

      // DB에서 최신 잔고 정보만 조회 (외부 API 호출 없음)
      const { data, error } = await supabase
        .from('users')
        .select('balance, points, updated_at')
        .eq('id', user.id)
        .single();

      if (error) {
        console.warn('⚠️ DB 잔고 조회 실패:', error.message);
        return;
      }

      if (data) {
        console.log('✅ 내부 DB 잔고 정보:', {
          username: user.username,
          balance: data.balance,
          points: data.points,
          lastUpdated: data.updated_at
        });
        
        // 사용자 객체 업데이트 (메모리)
        user.balance = parseFloat(data.balance) || 0;
        user.points = parseFloat(data.points) || 0;
        user.updated_at = data.updated_at;
      }

    } catch (error) {
      console.error('❌ 내부 잔고 새로고침 오류:', error);
    }
  }, []);

  // 로그인 상태 확인
  const checkAuthStatus = useCallback(async () => {
    try {
      // 로컬 스토리지에서 사용자 정보 확인
      const savedUser = localStorage.getItem('user_session');
      if (!savedUser) {
        setAuthState({
          isAuthenticated: false,
          user: null,
          isLoading: false
        });
        return;
      }

      const parsedUser = JSON.parse(savedUser);
      
      // 데이터베이스에서 최신 사용자 정보 확인
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', parsedUser.id)
        .maybeSingle();

      if (error || !data) {
        localStorage.removeItem('user_session');
        setAuthState({
          isAuthenticated: false,
          user: null,
          isLoading: false
        });
        return;
      }

      // 사용자 상태 확인
      if (data.status === 'blocked') {
        localStorage.removeItem('user_session');
        setAuthState({
          isAuthenticated: false,
          user: null,
          isLoading: false
        });
        return;
      }

      // 🔒 백그라운드 잔고 동기화 비활성화 (자동 출금 방지)
      // 💰 사용자 잔고 보존 - 로그아웃/로그인 시에도 마지막 보유금 유지
      console.log('✅ 인증 상태 확인 - 기존 잔고 유지:', {
        username: data.username,
        balance: data.balance,
        note: '자동 출금 방지를 위해 백그라운드 동기화 스킵'
      });

      setAuthState({
        isAuthenticated: true,
        user: data,
        isLoading: false
      });

    } catch (error) {
      console.error('인증 상태 확인 오류:', error);
      setAuthState({
        isAuthenticated: false,
        user: null,
        isLoading: false
      });
    }
  }, []);

  // 로그인
  const login = useCallback(async (username: string, password: string) => {
    try {
      const { data, error } = await supabase
        .rpc('user_login', {
          p_username: username.trim(),
          p_password: password
        });

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
      }

      const user = data[0];

      if (user.status === 'blocked') {
        throw new Error('차단된 계정입니다. 고객센터에 문의해주세요.');
      }

      if (user.status === 'pending') {
        throw new Error('승인 대기 중인 계정입니다. 잠시 후 다시 시도해주세요.');
      }

      // ⚠️ 로그인 시 자동 잔고 동기화 비활성화 (자동 출금 방지)
      // 🔒 사용자 로그인 시 마지막 보유금 유지 (Guidelines.md 요구사항)
      console.log('✅ 로그인 성공 - 기존 잔고 유지:', {
        username: user.username,
        balance: user.balance,
        note: '자동 출금 방지를 위해 잔고 동기화 스킵'
      });

      // 로컬 스토리지에 사용자 정보 저장
      localStorage.setItem('user_session', JSON.stringify(user));

      // 상태 업데이트
      setAuthState({
        isAuthenticated: true,
        user: user,
        isLoading: false
      });

      return user;
    } catch (error) {
      throw error;
    }
  }, []);

  // 로그아웃
  const logout = useCallback(async () => {
    try {
      if (authState.user) {
        // 온라인 상태 업데이트
        await supabase
          .from('users')
          .update({ is_online: false })
          .eq('id', authState.user.id);

        // 활성 세션 종료
        await supabase
          .from('user_sessions')
          .update({ is_active: false, logout_at: new Date().toISOString() })
          .eq('user_id', authState.user.id)
          .eq('is_active', true);
      }

      // 로컬 스토리지 정리
      localStorage.removeItem('user_session');

      // 상태 초기화
      setAuthState({
        isAuthenticated: false,
        user: null,
        isLoading: false
      });
    } catch (error) {
      console.error('로그아웃 오류:', error);
      // 오류가 있어도 로컬 상태는 정리
      localStorage.removeItem('user_session');
      setAuthState({
        isAuthenticated: false,
        user: null,
        isLoading: false
      });
    }
  }, [authState.user]);

  // 사용자 정보 업데이트
  const updateUser = useCallback((updatedUser: Partial<User>) => {
    setAuthState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...updatedUser } : null
    }));
  }, []);

  // 컴포넌트 마운트 시 인증 상태 확인
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // 사용자 정보 실시간 업데이트 구독
  useEffect(() => {
    if (!authState.isAuthenticated || !authState.user) return;

    const subscription = supabase
      .channel('user_updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${authState.user.id}`
      }, (payload) => {
        const newData = payload.new as User;
        updateUser(newData);
        
        // 로컬 스토리지도 업데이트
        localStorage.setItem('user_session', JSON.stringify(newData));
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [authState.isAuthenticated, authState.user, updateUser]);

  // 내부 DB 잔고 새로고침 (안전한 방식)
  const refreshBalance = useCallback(async () => {
    if (!authState.user) {
      throw new Error('로그인이 필요합니다.');
    }

    console.log('💰 내부 잔고 새로고침 시작:', authState.user.username);
    await refreshUserBalance(authState.user);
    
    // 최신 사용자 정보 다시 가져와서 상태 업데이트
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authState.user.id)
      .single();

    if (!error && data) {
      setAuthState(prev => ({
        ...prev,
        user: data
      }));
      localStorage.setItem('user_session', JSON.stringify(data));
    }
  }, [authState.user, refreshUserBalance]);

  return {
    authState,
    login,
    logout,
    updateUser,
    checkAuthStatus,
    refreshBalance  // 안전한 내부 잔고 새로고침 함수 제공
  };
}