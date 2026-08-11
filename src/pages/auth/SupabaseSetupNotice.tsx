import { Database, ExternalLink } from 'lucide-react';

/**
 * Exibida quando VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não estão definidas.
 * Evita que a aplicação quebre com erro de rede antes do backend existir.
 */
export function SupabaseSetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-warn-soft)]">
            <Database size={17} className="text-[var(--color-warn)]" />
          </div>
          <h1 className="text-base font-semibold text-[var(--color-text)]">
            Conexão com o Supabase não configurada
          </h1>
        </div>

        <p className="text-sm text-[var(--color-text-muted)]">
          O código está pronto, mas ainda falta apontar para um projeto Supabase. Siga os passos:
        </p>

        <ol className="mt-4 flex flex-col gap-3 text-sm text-[var(--color-text)]">
          <Step n={1}>
            Crie um projeto em{' '}
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[var(--color-brand)] hover:underline"
            >
              supabase.com/dashboard <ExternalLink size={11} />
            </a>
          </Step>
          <Step n={2}>
            No <b>SQL Editor</b>, rode em ordem os arquivos de{' '}
            <code className="rounded bg-[var(--color-panel-2)] px-1 py-0.5 text-[11px]">
              supabase/migrations/
            </code>{' '}
            (0001 → 0004).
          </Step>
          <Step n={3}>
            Em <b>Authentication → Users</b>, crie os usuários do cenário de teste (veja o cabeçalho
            do arquivo 0004) com <i>Auto Confirm User</i> marcado.
          </Step>
          <Step n={4}>
            Copie{' '}
            <code className="rounded bg-[var(--color-panel-2)] px-1 py-0.5 text-[11px]">
              .env.example
            </code>{' '}
            para{' '}
            <code className="rounded bg-[var(--color-panel-2)] px-1 py-0.5 text-[11px]">.env</code>{' '}
            e preencha a URL e a <b>anon key</b> (Project Settings → API).
          </Step>
          <Step n={5}>Reinicie o servidor de desenvolvimento.</Step>
        </ol>

        <p className="mt-5 rounded-lg border border-[var(--color-bad-soft)] bg-[var(--color-bad-soft)] p-3 text-xs text-[var(--color-bad)]">
          Nunca coloque a <b>service_role key</b> no arquivo .env do front-end — ela ignora o RLS e
          tudo prefixado com VITE_ vai junto no bundle enviado ao navegador.
        </p>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-panel-2)] text-[11px] font-medium text-[var(--color-text-muted)]">
        {n}
      </span>
      <span className="text-[var(--color-text-muted)]">{children}</span>
    </li>
  );
}
