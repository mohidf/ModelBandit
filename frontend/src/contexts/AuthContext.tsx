import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AuthContext } from './useAuth';

const NEW_USER_KEY  = 'mr_is_new_user';
const ONBOARDED_KEY = 'mr_onboarded';

/**
 * Holds the Supabase session for the whole app.
 * `isNewUser` is true from the first sign-in until the onboarding page clears it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [loading, setLoading]     = useState(true);
  const [isNewUser, setIsNewUser] = useState(() => localStorage.getItem(NEW_USER_KEY) === 'true');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);

      if (event === 'SIGNED_IN' && localStorage.getItem(ONBOARDED_KEY) !== 'true') {
        localStorage.setItem(NEW_USER_KEY, 'true');
        setIsNewUser(true);
      }
      if (event === 'SIGNED_OUT') setIsNewUser(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  function clearNewUser(): void {
    localStorage.removeItem(NEW_USER_KEY);
    localStorage.setItem(ONBOARDED_KEY, 'true');
    setIsNewUser(false);
  }

  async function signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  return (
    <AuthContext.Provider value={{ user, loading, isNewUser, clearNewUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
