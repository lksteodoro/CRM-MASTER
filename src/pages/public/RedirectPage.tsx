import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { resolveRedirectLink, type ResolvedRedirect } from '../../services/redirectLinks.service';

declare global {
  interface Window {
    __fastRedirectPromise?: Promise<ResolvedRedirect | null>;
  }
}

export function RedirectPage() {
  const { slug = '' } = useParams();
  const [resolved, setResolved] = useState<ResolvedRedirect | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const resolution = window.__fastRedirectPromise ?? resolveRedirectLink(slug);
    void resolution
      .then((result) => {
        if (!active) return;
        if (!result) {
          setError('Este link não existe ou está pausado.');
          return;
        }
        // A função pública já incrementou o contador de acessos no banco.
        // Com zero segundos, evita um render intermediário e redireciona logo
        // após a resolução segura do destino.
        if (result.delay_seconds === 0) {
          window.location.replace(result.target_url);
          return;
        }
        setResolved(result);
        setRemaining(result.delay_seconds);
      })
      .catch(() => active && setError('Não foi possível abrir este link.'));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!resolved || remaining === null) return;
    if (remaining <= 0) {
      window.location.replace(resolved.target_url);
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => Math.max((value ?? 1) - 1, 0)), 1_000);
    return () => clearTimeout(timer);
  }, [remaining, resolved]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-5">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-7 text-center shadow-2xl">
        {error ? (
          <><h1 className="text-lg font-semibold text-[var(--color-text)]">Link indisponível</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">{error}</p></>
        ) : !resolved || remaining === null ? (
          <div className="py-8" />
        ) : (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><ExternalLink size={22} /></span>
            <h1 className="mt-4 text-lg font-semibold text-[var(--color-text)]">{resolved.link_name}</h1>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Você será redirecionado em</p>
            <p aria-live="polite" className="mt-2 text-4xl font-semibold text-[var(--color-brand)]">{remaining}s</p>
            <button type="button" onClick={() => window.location.replace(resolved.target_url)} className="mt-5 w-full rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white hover:brightness-110">Continuar agora</button>
          </>
        )}
      </div>
    </main>
  );
}
