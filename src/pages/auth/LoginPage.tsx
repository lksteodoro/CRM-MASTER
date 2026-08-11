import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { GraduationCap, Loader2, AlertTriangle, MailCheck } from 'lucide-react';
import { signIn, requestPasswordReset } from '../../services/auth.service';
import { useAuth } from '../../providers/AuthProvider';
import { isSupabaseConfigured } from '../../integrations/supabase/client';
import { SupabaseSetupNotice } from './SupabaseSetupNotice';

export function LoginPage() {
  const { session, profile, isAdmin, loading: authLoading } = useAuth();
  const location = useLocation();

  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  if (!isSupabaseConfigured) return <SupabaseSetupNotice />;

  if (!authLoading && session && profile) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? (isAdmin ? '/agency' : '/projects')} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        // A navegação acontece pelo redirect acima assim que o profile carrega.
      } else {
        await requestPasswordReset(email.trim());
        setResetSent(true);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Erro inesperado.';
      setError(
        raw.toLowerCase().includes('invalid login')
          ? 'E-mail ou senha incorretos.'
          : raw
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand)]">
            <GraduationCap size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Leads Hub</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {mode === 'login' ? 'Entre com sua conta' : 'Recuperar acesso'}
          </p>
        </div>

        {resetSent ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center">
            <MailCheck size={26} className="mx-auto mb-3 text-[var(--color-good)]" />
            <p className="text-sm text-[var(--color-text)]">
              Se existir uma conta com <b>{email}</b>, enviamos um link para redefinir a senha.
            </p>
            <button
              onClick={() => {
                setResetSent(false);
                setMode('login');
              }}
              className="mt-4 text-xs text-[var(--color-brand)] hover:underline"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6"
          >
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">E-mail</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
              />
            </label>

            {mode === 'login' && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--color-text-muted)]">Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
                />
              </label>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-bad-soft)] bg-[var(--color-bad-soft)] p-3 text-xs text-[var(--color-bad)]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {mode === 'login' ? 'Entrar' : 'Enviar link de recuperação'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'reset' : 'login');
                setError(null);
              }}
              className="text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-brand)]"
            >
              {mode === 'login' ? 'Esqueci minha senha' : 'Voltar para o login'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-[11px] text-[var(--color-text-faint)]">
          O acesso é criado pelo administrador. Não há cadastro público.
        </p>
      </div>
    </div>
  );
}
