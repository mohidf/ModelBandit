import { useEffect, useState, type ReactNode } from 'react';
import { useSession, signOut as authSignOut } from '../lib/auth';
import { AuthContext } from './useAuth';

const ONBOARDED_KEY = 'mr_onboarded';

function onboardedUsers(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ONBOARDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Exposes the Better Auth session to the app.
 * `isNewUser` is true for an account that has never dismissed the onboarding
 * page in this browser. It's tracked per user ID so a shared machine works.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  const user = data?.user ?? null;
  const [onboarded, setOnboarded] = useState<Set<string>>(onboardedUsers);

  useEffect(() => {
    localStorage.setItem(ONBOARDED_KEY, JSON.stringify([...onboarded]));
  }, [onboarded]);

  const isNewUser = user !== null && !onboarded.has(user.id);

  function clearNewUser(): void {
    if (user) setOnboarded(prev => new Set(prev).add(user.id));
  }

  async function signOut(): Promise<void> {
    const { error } = await authSignOut();
    if (error) throw new Error(error.message ?? 'Sign out failed.');
  }

  return (
    <AuthContext.Provider value={{ user, loading: isPending, isNewUser, clearNewUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
