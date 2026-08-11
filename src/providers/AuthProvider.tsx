import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../integrations/supabase/client';
import { fetchProfile, signOut as signOutService } from '../services/auth.service';
import type { ProfileRow } from '../integrations/supabase/database.types';

interface AuthContextValue {
  session: Session | null;
  profile: ProfileRow | null;
  loading: boolean;
  isAdmin: boolean;
  /** Cliente que o ADMIN escolheu inspecionar em "Ver como". Apenas visual. */
  previewClientId: string | null;
  setPreviewClientId: (clientId: string | null) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewClientId, setPreviewClientId] = useState<string | null>(null);

  // Guarda o id do usuário atual fora do estado React — o listener abaixo é
  // registrado uma única vez (deps: []), então uma variável de estado normal
  // ficaria presa no valor da primeira renderização.
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile(nextSession: Session | null) {
      if (!nextSession?.user) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      try {
        const p = await fetchProfile(nextSession.user.id);
        if (active) setProfile(p);
      } catch {
        if (active) setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      currentUserIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      void loadProfile(data.session);
    });

    // O callback do onAuthStateChange não pode ser async nem chamar o Supabase
    // diretamente — isso trava o cliente. Por isso o carregamento do profile é
    // agendado fora do callback.
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      const nextUserId = nextSession?.user?.id ?? null;
      const sameUser = nextUserId === currentUserIdRef.current;
      currentUserIdRef.current = nextUserId;
      setSession(nextSession);

      // O Supabase renova o token (evento TOKEN_REFRESHED) toda vez que a aba
      // volta a ficar em foco, mesmo sem nada ter mudado. Recarregar o profile
      // nesse caso derrubava telas com formulário aberto (ex: Configurações)
      // a cada troca de aba. Só recarrega quando o usuário logado de fato muda.
      if (sameUser && event !== 'SIGNED_OUT') return;

      setLoading(true);
      setTimeout(() => void loadProfile(nextSession), 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      isAdmin: profile?.role === 'ADMIN',
      previewClientId,
      setPreviewClientId,
      signOut: async () => {
        await signOutService();
        setProfile(null);
        setSession(null);
        setPreviewClientId(null);
      },
      refreshProfile: async () => {
        if (!session?.user) return;
        setProfile(await fetchProfile(session.user.id));
      },
    }),
    [session, profile, loading, previewClientId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
