import { createContext, ReactNode } from 'react';
import { useAuthProvider, AuthContext } from '../hooks/useAuth';

export { useAuth } from '../hooks/useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}
