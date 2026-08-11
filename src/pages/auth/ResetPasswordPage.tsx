import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Loader2, AlertTriangle } from 'lucide-react';
import { updatePassword } from '../../services/auth.service';

/**
 * Destino do link enviado por e-mail (recuperação de senha e confirmação de
 * convite). O Supabase já traz a sessão na URL, então basta definir a senha.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível definir a senha.');
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
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Definir nova senha</h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6"
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--color-text-muted)]">Nova senha</span>
            <input
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--color-text-muted)]">Confirmar senha</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
            />
          </label>

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
            Salvar senha
          </button>
        </form>
      </div>
    </div>
  );
}
