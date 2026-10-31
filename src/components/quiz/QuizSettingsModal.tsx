import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { QuizProductRow } from '../../integrations/supabase/database.types';
import { normalizeRedirectSlug } from '../../services/redirectLinks.service';
import {
  createQuizProduct,
  DEFAULT_THEME,
  updateQuizSettings,
  type Quiz,
  type QuizSettingsInput,
  type QuizTheme,
} from '../../services/quizzes.service';
import { inputClass, labelClass } from './quizStyles';

const PRESET_COLORS = ['#6284ff', '#7c3aed', '#16a34a', '#0ea5e9', '#f97316', '#e11d48', '#eab308', '#111827'];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
      {options.map(([option, label]) => (
        <button key={option} type="button" onClick={() => onChange(option)} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${value === option ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{label}</button>
      ))}
    </div>
  );
}

export function QuizSettingsModal({ quiz, products, initialTab = 'general', onClose, onSaved, onProductCreated }: {
  quiz: Quiz;
  products: QuizProductRow[];
  initialTab?: 'general' | 'appearance';
  onClose: () => void;
  onSaved: (quiz: Quiz) => void;
  onProductCreated: (product: QuizProductRow) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [form, setForm] = useState<QuizSettingsInput>({
    name: quiz.name,
    slug: quiz.slug,
    title: quiz.title,
    product_id: quiz.product_id,
    active: quiz.active,
    theme: { ...DEFAULT_THEME, ...quiz.theme, welcome: { ...DEFAULT_THEME.welcome, ...quiz.theme.welcome } },
  });
  const [newProduct, setNewProduct] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = form.theme;
  const setTheme = (patch: Partial<QuizTheme>) => setForm((current) => ({ ...current, theme: { ...current.theme, ...patch } }));
  const setWelcome = (patch: Partial<NonNullable<QuizTheme['welcome']>>) => setTheme({ welcome: { ...theme.welcome, ...patch } });

  async function addProduct() {
    try {
      const product = await createQuizProduct(newProduct);
      onProductCreated(product);
      setForm((current) => ({ ...current, product_id: product.id }));
      setNewProduct('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar o produto.');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try { onSaved(await updateQuizSettings(quiz.id, form)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="quiz-settings-title" className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 id="quiz-settings-title" className="font-semibold text-[var(--color-text)]">Configurações do quiz</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={17} /></button>
        </div>
        <div className="px-5 pt-4"><Segmented value={tab} options={[['general', 'Geral'], ['appearance', 'Aparência e tela inicial']]} onChange={setTab} /></div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {tab === 'general' ? (
            <>
              <div><label className={labelClass}>Nome interno</label><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} required /></div>
              <div><label className={labelClass}>Título (aba do navegador e topo do quiz sem logo)</label><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} required /></div>
              <div>
                <label className={labelClass}>Link público</label>
                <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 text-xs text-[var(--color-text-faint)]"><span className="whitespace-nowrap">{window.location.origin}/q/</span><input value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: normalizeRedirectSlug(event.target.value) }))} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-[var(--color-brand)] outline-none" required /></div>
                {form.slug !== quiz.slug && quiz.published_version_id && <p className="mt-1 text-[11px] text-[var(--color-warn)]">Atenção: o link antigo deixa de funcionar para quem já recebeu.</p>}
              </div>
              <div>
                <label className={labelClass}>Produto</label>
                <select value={form.product_id ?? ''} onChange={(event) => setForm((current) => ({ ...current, product_id: event.target.value || null }))} className={inputClass}>
                  <option value="">— Sem produto —</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <div className="mt-2 flex gap-2"><input value={newProduct} onChange={(event) => setNewProduct(event.target.value)} className={inputClass} placeholder="Novo produto (ex.: Gestão de tráfego)" /><button type="button" onClick={() => void addProduct()} disabled={!newProduct.trim()} className="shrink-0 rounded-lg border border-[var(--color-border)] px-3 text-xs text-[var(--color-text)] disabled:opacity-40">Criar</button></div>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Quiz ativo (link público funcionando)</label>
            </>
          ) : (
            <>
              <p className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">A aparência vale para o lead depois de <strong>Publicar</strong>. Use <strong>Testar</strong> para ver antes.</p>
              <div>
                <label className={labelClass}>Cor principal</label>
                <div className="flex flex-wrap items-center gap-2">
                  {PRESET_COLORS.map((color) => <button key={color} type="button" onClick={() => setTheme({ primaryColor: color })} className={`h-8 w-8 rounded-full border-2 ${theme.primaryColor === color ? 'border-[var(--color-text)]' : 'border-transparent'}`} style={{ background: color }} aria-label={`Cor ${color}`} />)}
                  <input type="color" value={theme.primaryColor} onChange={(event) => setTheme({ primaryColor: event.target.value })} className="h-8 w-10 cursor-pointer rounded border border-[var(--color-border)] bg-transparent" aria-label="Escolher outra cor" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className={labelClass}>Fundo</label><Segmented value={theme.mode ?? 'dark'} options={[['dark', 'Escuro'], ['light', 'Claro']]} onChange={(mode) => setTheme({ mode })} /></div>
                <div><label className={labelClass}>Botões</label><Segmented value={theme.buttonShape ?? 'rounded'} options={[['rounded', 'Arredondado'], ['pill', 'Pílula'], ['square', 'Reto']]} onChange={(buttonShape) => setTheme({ buttonShape })} /></div>
                <div><label className={labelClass}>Fonte</label><select value={theme.font} onChange={(event) => setTheme({ font: event.target.value as QuizTheme['font'] })} className={inputClass}><option value="jakarta">Plus Jakarta Sans (moderna)</option><option value="inter">Inter (neutra)</option><option value="nunito">Nunito (amigável)</option><option value="serif">Fraunces (sofisticada)</option></select></div>
                <div><label className={labelClass}>Transição</label><Segmented value={theme.transition ?? 'slide'} options={[['slide', 'Deslizar'], ['fade', 'Suave'], ['none', 'Nenhuma']]} onChange={(transition) => setTheme({ transition })} /></div>
              </div>
              <div><label className={labelClass}>Progresso</label><Segmented value={theme.progress ?? 'bar'} options={[['bar', 'Barra'], ['percent', 'Barra + %'], ['steps', 'Etapas'], ['none', 'Oculto']]} onChange={(progress) => setTheme({ progress })} /><p className="mt-1 text-[11px] text-[var(--color-text-faint)]">Calculado pelo caminho real do lead, considerando as ramificações.</p></div>
              <div><label className={labelClass}>Logotipo (URL da imagem)</label><input value={theme.logoUrl ?? ''} onChange={(event) => setTheme({ logoUrl: event.target.value })} className={inputClass} placeholder="https://..." /></div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]"><input type="checkbox" checked={Boolean(theme.welcome?.enabled)} onChange={(event) => setWelcome({ enabled: event.target.checked })} /> Mostrar tela inicial</label>
                {theme.welcome?.enabled && (
                  <div className="mt-3 space-y-3">
                    <div><label className={labelClass}>Selo (opcional)</label><input value={theme.welcome.badge ?? ''} onChange={(event) => setWelcome({ badge: event.target.value })} className={inputClass} placeholder="Diagnóstico gratuito" /></div>
                    <div><label className={labelClass}>Título</label><input value={theme.welcome.title ?? ''} onChange={(event) => setWelcome({ title: event.target.value })} className={inputClass} placeholder="Descubra em 1 minuto se..." /></div>
                    <div><label className={labelClass}>Benefício / subtítulo</label><textarea value={theme.welcome.subtitle ?? ''} onChange={(event) => setWelcome({ subtitle: event.target.value })} rows={2} className={inputClass} placeholder="Responda algumas perguntas e receba uma recomendação personalizada." /></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><label className={labelClass}>Texto do botão</label><input value={theme.welcome.buttonLabel ?? ''} onChange={(event) => setWelcome({ buttonLabel: event.target.value })} className={inputClass} placeholder="Começar" /></div>
                      <div><label className={labelClass}>Nota ao lado do botão</label><input value={theme.welcome.note ?? ''} onChange={(event) => setWelcome({ note: event.target.value })} className={inputClass} placeholder="Leva menos de 1 minuto" /></div>
                    </div>
                    <div><label className={labelClass}>Imagem (URL, opcional)</label><input value={theme.welcome.imageUrl ?? ''} onChange={(event) => setWelcome({ imageUrl: event.target.value })} className={inputClass} placeholder="https://..." /></div>
                  </div>
                )}
              </div>
            </>
          )}
          {error && <p role="alert" className="text-xs text-[var(--color-bad)]">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancelar</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 size={14} className="animate-spin" />} Salvar</button>
        </div>
      </form>
    </div>
  );
}
