import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, RotateCcw, Sliders, TriangleAlert } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import {
  buildAdUrl,
  buildTestUrl,
  defaultTestValues,
  normalizeUrl,
  UTM_DESCRIPTIONS,
  UTM_KEYS,
  type UtmValues,
} from '../../lib/utmBuilder';

type CopyTarget = 'test' | 'ad' | null;

export function UtmTesterPage() {
  const [input, setInput] = useState('');
  const [values, setValues] = useState<UtmValues>(() => defaultTestValues());
  const [showValues, setShowValues] = useState(false);
  const [copied, setCopied] = useState<CopyTarget>(null);

  // O link é recalculado a cada tecla: não existe botão "gerar" porque não há
  // nada para confirmar — o resultado é consequência direta do que foi digitado.
  const result = useMemo(() => {
    if (!input.trim()) return null;
    const check = normalizeUrl(input);
    if ('error' in check) return { error: check.error };
    return {
      testUrl: buildTestUrl(check.url, values),
      adUrl: buildAdUrl(check.url),
      hadQuery: check.url.search.length > 0,
      insecure: check.url.protocol !== 'https:',
    };
  }, [input, values]);

  async function copy(text: string, target: Exclude<CopyTarget, null>) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Área de transferência bloqueada pelo navegador: o texto continua
      // selecionável na tela, então não há nada a corrigir aqui.
    }
  }

  const ready = result && !('error' in result) ? result : null;
  const error = result && 'error' in result ? result.error : null;

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header>
        <div className="flex items-center gap-2">
          <Link2 size={21} className="text-[var(--color-brand)]" />
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Criador de URL de teste</h1>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
          Cole o endereço da página e receba o link pronto para clicar e conferir se o rastreamento
          está chegando no analytics — antes de subir a campanha.
        </p>
      </header>

      <Card>
        <label htmlFor="destino" className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Endereço da página
        </label>
        <input
          id="destino"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="institutosoftskills.com.br/clube/"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] px-4 py-3 text-base text-[var(--color-text)] outline-none transition focus:border-[var(--color-brand)]"
        />
        <p className="mt-2 text-xs text-[var(--color-text-faint)]">
          Pode colar com ou sem <code className="rounded bg-[var(--color-panel-2)] px-1">https://</code>. Parâmetros que já existirem no endereço são mantidos.
        </p>

        {error && (
          <p role="alert" className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]">
            <TriangleAlert size={15} /> {error}
          </p>
        )}
      </Card>

      {ready && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Link de teste</h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Clique nele e procure o acesso no seu analytics. É este link que você usa para validar.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copy(ready.testUrl, 'test')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  {copied === 'test' ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                </button>
                <a
                  href={ready.testUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                >
                  <ExternalLink size={14} /> Abrir
                </a>
              </div>
            </div>

            <p className="mt-3 break-all rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--color-text)]">
              {ready.testUrl}
            </p>

            {ready.insecure && (
              <p className="mt-3 flex items-start gap-2 text-xs text-[var(--color-warn,#f59e0b)]">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                Este endereço usa http. Para teste funciona, mas a Meta exige https no destino do anúncio.
              </p>
            )}
            {ready.hadQuery && (
              <p className="mt-2 text-xs text-[var(--color-text-faint)]">
                O endereço já tinha parâmetros próprios e eles foram preservados.
              </p>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Link para o anúncio</h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Este é o que vai no campo de destino da Meta. Não clique nele para testar: as macros
                  só são substituídas na entrega do anúncio.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copy(ready.adUrl, 'ad')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
              >
                {copied === 'ad' ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
              </button>
            </div>

            <p className="mt-3 break-all rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--color-text-muted)]">
              {ready.adUrl}
            </p>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">O que cada parâmetro leva</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowValues((current) => !current)}
                  aria-expanded={showValues}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                >
                  <Sliders size={14} /> {showValues ? 'Fechar' : 'Ajustar valores do teste'}
                </button>
                {showValues && (
                  <button
                    type="button"
                    onClick={() => setValues(defaultTestValues())}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                  >
                    <RotateCcw size={14} /> Restaurar
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="pb-2 pr-4 font-semibold">Parâmetro</th>
                    <th className="pb-2 pr-4 font-semibold">No anúncio</th>
                    <th className="pb-2 font-semibold">No teste</th>
                  </tr>
                </thead>
                <tbody>
                  {UTM_KEYS.map((key) => (
                    <tr key={key} className="border-b border-[var(--color-border-soft,var(--color-border))] last:border-0">
                      <td className="py-3 pr-4 align-top">
                        <span className="font-mono text-[12px] text-[var(--color-text)]">{key}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-text-faint)]">{UTM_DESCRIPTIONS[key].label}</span>
                      </td>
                      <td className="py-3 pr-4 align-top text-xs text-[var(--color-text-muted)]">
                        {UTM_DESCRIPTIONS[key].meaning}
                      </td>
                      <td className="py-3 align-top">
                        {showValues ? (
                          <input
                            value={values[key]}
                            onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                            aria-label={`Valor de teste para ${key}`}
                            className="w-full min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
                          />
                        ) : (
                          <span className="font-mono text-[12px] text-[var(--color-text)]">{values[key]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-[var(--color-text-faint)]">
              A data e a hora no nome da campanha de teste servem para você achar exatamente este clique
              no relatório depois.
            </p>
          </Card>
        </>
      )}
    </main>
  );
}
