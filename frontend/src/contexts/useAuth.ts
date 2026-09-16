import { createContext, useContext } from 'react';

export interface AuthUser {
  id:    string;
  email: string;
  name:  string;
}

export interface AuthContextValue {
  user:         AuthUser | null;
  loading:      boolean;
  isNewUser:    boolean;
  signOut:      () => Promise<void>;
  clearNewUser: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
