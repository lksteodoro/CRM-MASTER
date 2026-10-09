import { useState, useEffect, useRef } from 'react';
import { X, UploadCloud, PlayCircle, Loader2, AlertCircle, CheckCircle, Database, Info, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, Trash2, Settings, RotateCcw, Plus, FolderOpen, ArrowLeftRight, Unlink, Pencil, ShieldCheck } from 'lucide-react';
import {
  metaGet,
  metaGetAll,
  metaPost,
  metaBatch,
  buildBatchItem,
  metaUploadImage,
  metaUploadVideo,
  waitForVideoReady,
  metaVideoThumbnailUrl,
  getMetaConnectionState,
  MetaNotConnectedError,
} from '../lib/metaGraph';
import {
  SPECIAL_AD_CATEGORIES,
  CATEGORIES_REQUIRING_AUTHORIZATION,
  serializeSpecialAdCategories,
  specialAdCategoryLabel,
  validateDestinationUrl,
} from '../lib/metaCompliance';
import { META_UTM_TEMPLATE } from '../lib/utmBuilder';
import { extractVideoFrame, OPTIMIZE_MIN_BYTES, optimizeForUpload, probeVideo } from '../lib/videoConverter';
import {
  aspectLabel,
  autoPairMedia,
  brazilRegulationParams,
  buildPlacementAssetFeedSpec,
  buildTextOptionsAssetFeedSpec,
  classifyAdSetDestination,
  detectPlacementFormat,
  hasTextVariations,
  MAX_TEXT_OPTIONS,
  mediaLibraryName,
  pickBrazilIdentities,
  pickInheritedCopy,
  textOptions,
} from '../lib/metaCreativeHelpers';
// O módulo foi importado do CRM VENZA. Clientes e credenciais serão ligados
// aos dados reais deste CRM na próxima etapa de integração.
const CLIENTS = [];
const uuidv4 = () => crypto.randomUUID();

const delay = ms => new Promise(res => setTimeout(res, ms));

const normalizeAdAccountId = (value) => {
  const digits = String(value || '').trim().replace(/^act_/i, '').replace(/\D/g, '');
  return digits ? `act_${digits}` : '';
};
/** A Meta aceita até 50 anúncios por conjunto; com Feed + Stories são 2 arquivos por anúncio. */
const MAX_ADS_PER_BATCH = 50;
const MAX_MEDIA_FILES = MAX_ADS_PER_BATCH * 2;
const META_MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'mpg', 'mpeg'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const fileExtension = (file) => file.name.split('.').pop()?.toLowerCase();
const isVideoFile = (file) => file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(fileExtension(file));
const isImageFile = (file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || IMAGE_EXTENSIONS.includes(fileExtension(file));
const byFileName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
/** Tamanho que a Meta recomenda (passar disso corta o texto com "Ver mais"). */
const TEXT_LIMITS = { primaryText: 125, title: 40, description: 30 };
const EMPTY_VARIATIONS = { primaryText: [], title: [], description: [] };
const OPTION_KEYS = { primaryText: 'primaryTexts', title: 'titles', description: 'descriptions' };
// Referência estável: rola o elemento para a vista só quando ele aparece.
const revealOnMount = (element) => element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
const variationsOf = (adsData) => ({ ...EMPTY_VARIATIONS, ...(adsData?.variations || {}) });
const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
const blobToDataUrl = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(blob);
});

/** Largura e altura reais da mídia (para saber se é Feed ou Stories 9:16). */
const readMediaDimensions = (file, type) => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  let settled = false;
  const finish = (width, height) => {
    if (settled) return;
    settled = true;
    URL.revokeObjectURL(url);
    resolve({ width: width || 0, height: height || 0 });
  };
  setTimeout(() => finish(0, 0), 10000);
  if (type === 'VIDEO') {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(video.videoWidth, video.videoHeight);
    video.onerror = () => finish(0, 0);
    video.src = url;
  } else {
    const img = new Image();
    img.onload = () => finish(img.naturalWidth, img.naturalHeight);
    img.onerror = () => finish(0, 0);
    img.src = url;
  }
});

// Lista de campanhas com busca e seleção múltipla (aba Campanha → Usar existente).
const CampaignMultiSelect = ({ campaigns, selectedIds, onChange }) => {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const visible = campaigns.filter(c => !term || (c.name || '').toLowerCase().includes(term) || String(c.id).includes(term));
  const toggle = (id) => onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Busque pelo nome da campanha..." style={{ flex: 1, minWidth: '200px', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '13px', outline: 'none' }} />
        <button type="button" onClick={() => onChange([...new Set([...selectedIds, ...visible.map(c => c.id)])])} style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>Selecionar visíveis</button>
        <button type="button" onClick={() => onChange([])} style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>Limpar</button>
        {selectedIds.length > 0 && <span style={{ fontSize: '11px', fontWeight: '700', background: 'rgba(139,92,246,0.12)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '10px' }}>{selectedIds.length} campanha(s)</span>}
      </div>
      <div style={{ maxHeight: '190px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '8px', background: 'var(--bg-surface)' }}>
        {visible.length === 0 && <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>Nenhuma campanha encontrada.</div>}
        {visible.map(c => {
          const checked = selectedIds.includes(c.id);
          return (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)', background: checked ? 'rgba(16,185,129,0.06)' : 'transparent' }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} style={{ flexShrink: 0, accentColor: 'var(--primary)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: checked ? 'var(--primary)' : 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: {c.id}{c.objective ? ` · ${OBJECTIVE_LABEL(c.objective)}` : ''}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
const MOCK_BM_DATA = {
  bms: [
    { id: 'bm_001', name: 'Venza Assessoria — Principal' },
    { id: 'bm_002', name: 'Venza Assessoria — Clientes' },
  ],
  accounts: {
    bm_001: [
      { id: 'act_111111111', name: 'Venza — Tráfego Pago', status: 1 },
      { id: 'act_222222222', name: 'Venza — Leads', status: 1 },
    ],
    bm_002: [
      { id: 'act_333333333', name: 'Cliente A — Conversão', status: 1 },
      { id: 'act_444444444', name: 'Cliente B — Tráfego', status: 2 },
    ],
  },
};

const MOCK_API = {
  fetchCampaigns: async () => { await delay(600); return [{ id: '111', name: 'Campanha Black Friday' }, { id: '222', name: 'Sempre Ativa - Conversão' }]; },
  fetchPages: async () => { await delay(400); return [{ id: '999', name: 'Página Venza Oficial' }, { id: '888', name: 'Filial São Paulo' }]; },
  fetchIg: async () => { await delay(400); return [{ id: '777', name: '@venza_oficial' }]; },
  fetchPixels: async () => { await delay(500); return [{ id: 'px_1', name: 'Pixel Principal (Sales)' }, { id: 'px_2', name: 'Pixel Landing Page Leads' }]; },
};

const OBJECTIVES = [
  { value: 'OUTCOME_LEADS', label: 'LEADS' },
  { value: 'OUTCOME_SALES', label: 'VENDAS' },
  { value: 'OUTCOME_TRAFFIC', label: 'TRAFEGO' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'ENGAJAMENTO' },
];

const OBJECTIVE_LABEL = (obj) => OBJECTIVES.find(o => o.value === obj)?.label || 'TRAFEGO';

const OPTIMIZATION_GOALS = {
  OUTCOME_SALES: [
    { value: 'OFFSITE_CONVERSIONS', label: 'Conversões' },
    { value: 'CONVERSATIONS',       label: 'Conversas (WhatsApp/Messenger)' },
    { value: 'LINK_CLICKS',         label: 'Cliques no Link' },
    { value: 'LANDING_PAGE_VIEWS',  label: 'Visualizações da Landing Page' },
  ],
  OUTCOME_LEADS: [
    { value: 'LEAD_GENERATION',     label: 'Geração de Leads (Formulário)' },
    { value: 'CONVERSATIONS',       label: 'Conversas (WhatsApp/Messenger)' },
    { value: 'OFFSITE_CONVERSIONS', label: 'Conversões no Site' },
    { value: 'LINK_CLICKS',         label: 'Cliques no Link' },
  ],
  OUTCOME_TRAFFIC: [
    { value: 'LINK_CLICKS',         label: 'Cliques no Link' },
    { value: 'LANDING_PAGE_VIEWS',  label: 'Visualizações da Landing Page' },
    { value: 'CONVERSATIONS',       label: 'Conversas (WhatsApp/Messenger)' },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: 'CONVERSATIONS',       label: 'Conversas (WhatsApp/Messenger)' },
    { value: 'POST_ENGAGEMENT',     label: 'Engajamento no Post' },
    { value: 'LINK_CLICKS',         label: 'Cliques no Link' },
  ],
};

const CTA_OPTIONS = [
  { value: 'LEARN_MORE', label: 'Saiba Mais' },
  { value: 'SHOP_NOW', label: 'Compre Agora' },
  { value: 'SIGN_UP', label: 'Cadastre-se' },
  { value: 'BUY_NOW', label: 'Compre Já' },
  { value: 'GET_OFFER', label: 'Ver Oferta' },
  { value: 'CONTACT_US', label: 'Fale Conosco' },
  { value: 'SEND_MESSAGE', label: 'Enviar Mensagem' },
  { value: 'SUBSCRIBE', label: 'Assinar' },
  { value: 'DOWNLOAD', label: 'Baixar' },
  { value: 'WATCH_MORE', label: 'Ver Mais' },
];

// O padrão vive em lib/utmBuilder para que o criador de anúncios e o criador
// de URL de teste nunca fiquem apontando para formatos diferentes.
const DEFAULT_UTM = META_UTM_TEMPLATE;

const OBJECTIVE_ADSET_CONFIG = {
  OUTCOME_TRAFFIC:    { optimization_goal: 'LINK_CLICKS',         destination_type: 'WEBSITE', needs_pixel: false, valid_goals: ['LINK_CLICKS', 'LANDING_PAGE_VIEWS'] },
  OUTCOME_LEADS:      { optimization_goal: 'LEAD_GENERATION',     destination_type: 'ON_AD',   needs_pixel: false, valid_goals: ['LEAD_GENERATION', 'OFFSITE_CONVERSIONS', 'LINK_CLICKS'] },
  OUTCOME_SALES:      { optimization_goal: 'OFFSITE_CONVERSIONS', destination_type: 'WEBSITE', needs_pixel: true,  valid_goals: ['OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS'] },
  OUTCOME_ENGAGEMENT: { optimization_goal: 'POST_ENGAGEMENT',     destination_type: 'WEBSITE', needs_pixel: false, valid_goals: ['POST_ENGAGEMENT', 'LINK_CLICKS'] },
};

const objFromDemanda = () => 'OUTCOME_LEADS';

// ─── Componentes auxiliares (fora do MetaAdCreator para evitar remount) ────────
const SearchableSelect = ({ items: rawItems, options, value, onChange, placeholder, disabled, highlight }) => {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const items = options ? options.map(o => ({ id: o.value, name: o.label })) : (rawItems || []);
  const showSearch = !options || items.length > 6;

  useEffect(() => {
    const clickOut = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener('mousedown', clickOut);
    return () => document.removeEventListener('mousedown', clickOut);
  }, []);

  const filtered = showSearch
    ? items.filter(i => (i.name || '').toLowerCase().includes(search.toLowerCase()) || (i.id || '').includes(search))
    : items;
  const selected = items.find(i => i.id === value);

  const handleSelect = (id) => { onChange(id); setIsOpen(false); setSearch(''); };

  const accentColor = highlight ? '#10b981' : '#1877F2';
  const borderStyle = isOpen
    ? `2px solid ${accentColor}`
    : highlight && value
      ? '1px solid #10b981'
      : '1px solid var(--border-main)';
  const bgStyle = highlight && value ? 'rgba(16,185,129,0.05)' : 'var(--bg-surface)';

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{ padding: '12px 16px', borderRadius: '10px', border: borderStyle, background: bgStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s' }}
      >
        <span style={{ fontSize: '13px', color: selected && selected.id !== '' ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: selected && selected.id !== '' ? '700' : '500' }}>
          {selected ? selected.name : (placeholder || 'Selecione...')}
        </span>
        <ChevronDown size={16} color={isOpen ? accentColor : highlight && value ? '#10b981' : 'var(--text-muted)'} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s', flexShrink: 0 }} />
      </div>

      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: '10px', boxShadow: '0 12px 32px rgba(0,0,0,0.3)', zIndex: 50, overflow: 'hidden' }}>
          {showSearch && (
            <div style={{ padding: '8px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-surface)' }}>
              <input
                type="text" autoFocus
                placeholder="Filtrar..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', border: `1px solid ${accentColor}`, background: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {filtered.map(item => {
              const isItemSel = value === item.id;
              const isDisabled = item.status === 2 || item.status === 3 || item.status === 4 ||
                item.status === 'DELETED' || item.status === 'ARCHIVED';
              return (
                <div
                  key={item.id}
                  onClick={() => !isDisabled && handleSelect(item.id)}
                  style={{ padding: options ? '10px 16px' : '12px 16px', cursor: isDisabled ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: '2px', background: isItemSel ? `rgba(${highlight ? '16,185,129' : '24,119,242'},0.1)` : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.02)', opacity: isDisabled ? 0.4 : 1 }}
                  onMouseEnter={e => !isDisabled && (e.currentTarget.style.background = isItemSel ? `rgba(${highlight ? '16,185,129' : '24,119,242'},0.1)` : 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => !isDisabled && (e.currentTarget.style.background = isItemSel ? `rgba(${highlight ? '16,185,129' : '24,119,242'},0.1)` : 'transparent')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: isItemSel ? accentColor : item.id === '' ? 'var(--text-muted)' : 'var(--text-main)' }}>{item.name}</span>
                    {isDisabled && <span style={{ fontSize: '9px', fontWeight: '800', background: 'rgba(239,68,68,0.2)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px' }}>INATIVA</span>}
                  </div>
                  {!options && item.id !== '' && <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: {item.id}</span>}
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: '16px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>Nenhuma correspondência encontrada.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

const Field = ({ label, value, onChange, placeholder, type = 'text', width = '100%', required }) => (
  <div style={{ width }}>
    <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}{required && <span style={{ color: '#ef4444', marginLeft: '3px' }}>*</span>}
    </label>
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
    />
  </div>
);

const SelectField = ({ label, value, onChange, required, highlight, options, items, placeholder }) => (
  <div>
    <label style={{ fontSize: '11px', fontWeight: '700', color: highlight ? '#10b981' : 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}{required && <span style={{ color: '#ef4444', marginLeft: '3px' }}>*</span>}
    </label>
    <SearchableSelect
      items={items}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder || 'Selecione...'}
      highlight={highlight}
    />
  </div>
);

// Texto principal, título e descrição aceitam até 5 opções cada: a Meta testa
// as combinações e entrega a melhor para cada pessoa.
const OptionsField = ({ label, values, onChange, multiline, placeholder, limit }) => {
  const list = values.length > 0 ? values : [''];
  const update = (index, value) => onChange(list.map((item, i) => (i === index ? value : item)));
  const remove = (index) => onChange(list.filter((_, i) => i !== index));
  const inputStyle = { width: '100%', padding: '10px 34px 10px 14px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: '8px' }}>
        <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
        {list.length > 1 && <span style={{ fontSize: '10px', fontWeight: '800', color: '#93c5fd', background: 'rgba(47,128,255,0.12)', padding: '2px 8px', borderRadius: '10px' }}>{list.length} opções</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {list.map((value, index) => (
          <div key={index} style={{ position: 'relative' }}>
            {multiline
              ? <textarea rows={index === 0 ? 4 : 3} value={value} placeholder={index === 0 ? placeholder : `Opção ${index + 1}`} onChange={e => update(index, e.target.value)} style={inputStyle} />
              : <input type="text" value={value} placeholder={index === 0 ? placeholder : `Opção ${index + 1}`} onChange={e => update(index, e.target.value)} style={inputStyle} />}
            {index > 0 && (
              <button type="button" onClick={() => remove(index)} title="Remover esta opção" aria-label={`Remover a opção ${index + 1}`}
                style={{ position: 'absolute', top: '8px', right: '8px', width: '20px', height: '20px', borderRadius: '50%', border: 'none', background: 'rgba(239,68,68,0.15)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={12} />
              </button>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>
              <span>{list.length > 1 ? `Opção ${index + 1}` : ''}</span>
              <span style={{ color: value.length > limit ? '#f59e0b' : undefined }} title={`A Meta recomenda até ${limit} caracteres`}>{value.length}/{limit}</span>
            </div>
          </div>
        ))}
      </div>
      {list.length < MAX_TEXT_OPTIONS && (
        <button type="button" onClick={() => onChange([...list, ''])}
          style={{ marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '6px', border: '1px dashed var(--border-main)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
          <Plus size={12} /> Adicionar opção ({list.length}/{MAX_TEXT_OPTIONS})
        </button>
      )}
    </div>
  );
};

/**
 * @param {{ card: any, onClose: () => void, onComplete: () => void, projectId?: string, quickPreset?: any, startBlank?: boolean, onProfileSaved?: (profile: any) => void }} props
 */
const MetaAdCreator = ({ card, onClose, onComplete, projectId, quickPreset = null, startBlank = false, onProfileSaved }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [rawMetaError, setRawMetaError] = useState('');
  const [progress, setProgress] = useState(0);

  // A credencial da Meta vive no servidor (Edge Function meta-proxy). Aqui só
  // guardamos o estado da conexão da agência para habilitar ou bloquear a
  // publicação — o token nunca chega ao navegador.
  const [connection, setConnection] = useState({ connected: false, name: null, status: null, message: null });
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configSaved, setConfigSaved] = useState(false);
  const [configProfile, setConfigProfile] = useState(null);
  const [configAssets, setConfigAssets] = useState({ bms: [], accounts: [], pages: [] });
  // Mantidos apenas como estado interno legado; a seleção visual acontece na aba Conta & BM.
  const [configBmId, setConfigBmId] = useState('');
  const [configAccountId, setConfigAccountId] = useState('');
  const [configPageId, setConfigPageId] = useState('');
  const tokenConfigured = connection.connected;
  const isDemoMode = !connection.connected;
  const DRAFT_KEY = `meta_draft_${card.id || card.clientId}`;

  // ─── Histórico de anúncios criados ───────────────────────────────────────────
  const [adHistory, setAdHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('meta_ad_history')) || []; } catch { return []; }
  });
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const getMetaAdManagerLink = (entry, ad) => {
    const adId = ad?.metaAdIds?.[0] || ad?.metaAdId;
    const accountId = String(entry?.adAccountId || '').replace(/^act_/i, '');
    return adId && accountId
      ? `https://www.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(accountId)}&selected_ad_ids=${encodeURIComponent(adId)}`
      : '';
  };

  const downloadHistoryCSV = (entry) => {
    const BOM = '\uFEFF';
    const headers = ['Arquivo / preview no relatório HTML', 'Nome do Anúncio', 'Copy', 'Título', 'Descrição', 'Link de destino', 'ID do anúncio Meta', 'Abrir anúncio na Meta'];
    const rows = entry.ads.map(ad => [
      ad.fileName,
      ad.adName,
      ad.primaryText,
      ad.title,
      ad.description,
      ad.link,
      ad.metaAdIds?.[0] || ad.metaAdId || '',
      getMetaAdManagerLink(entry, ad),
    ]);
    const csv = BOM + [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anuncios_${entry.timestamp.slice(0, 10)}_${(entry.clientName || 'cliente').replace(/\s/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deleteHistoryEntry = (id) => {
    setAdHistory(prev => {
      const updated = prev.filter(e => e.id !== id);
      localStorage.setItem('meta_ad_history', JSON.stringify(updated));
      return updated;
    });
  };

  const reuseHistoryEntry = (entry, reprocess = false) => {
    const saved = entry.reuseConfig;
    const firstAd = entry.ads?.[0] || {};

    setAccountData(current => ({
      ...current,
      ...(saved?.accountData || {}),
      bmId: entry.bmId || saved?.accountData?.bmId || current.bmId,
      adAccountId: entry.adAccountId || saved?.accountData?.adAccountId || current.adAccountId,
      pageId: entry.pageId || saved?.accountData?.pageId || current.pageId,
    }));
    if (saved) {
      setCampAction(saved.campAction || 'new');
      setCampData(saved.campData || {});
      setAdSetAction(saved.adSetAction || 'new');
      setSelectedCampaignIds(saved.selectedCampaignIds || (saved.campData?.existingId ? [saved.campData.existingId] : []));
      setSelectedAdSetIds(saved.selectedAdSetIds || []);
      setAdSetData(saved.adSetData || {});
      setAdsData(saved.adsData || {});
      setForceMessagesDest(Boolean(saved.forceMessagesDest));
      setLeadDestType(saved.leadDestType || '');
      setSaleConversionEvent(saved.saleConversionEvent || 'PURCHASE');
      setIndividualCopyMode(Boolean(saved.individualCopyMode));
      setAdCopyOverrides(saved.adCopyOverrides || {});
      setPreserveOriginalMedia(saved.preserveOriginalMedia !== false);
    } else {
      setCampAction('new');
      setAdSetAction('new');
      setSelectedAdSetIds([]);
      setCampData(current => ({ ...current, name: `${entry.campaignName || 'Campanha'} — cópia` }));
      setAdsData(current => ({
        ...current,
        primaryText: firstAd.primaryText || current.primaryText,
        title: firstAd.title || current.title,
        link: firstAd.link || current.link,
        namingPattern: firstAd.adName ? firstAd.adName.replace(/[_-]?0*1$/i, '_{{n}}') : current.namingPattern,
      }));
    }

    // O histórico guarda metadados e preview, não o binário original. Forçar
    // novo upload é necessário para a Meta gerar um novo video_id processado.
    setMediaFiles([]);
    setStoryPairs({});
    setActiveCopyFileId(null);
    setActiveTab(3);
    setError(reprocess
      ? 'Reprocessamento preparado. Selecione novamente os vídeos originais para gerar novos IDs na Meta.'
      : 'Lote reaproveitado. Adicione as mídias originais para criar uma nova variação.');
  };

  const mediaThumbnailBase64 = (media) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const done = (val) => { clearTimeout(timer); resolve(val); };

    // Mantém a proporção: a miniatura mostra se a peça é Feed ou Stories.
    const drawToThumb = (source) => {
      try {
        const width = source.videoWidth || source.naturalWidth || 160;
        const height = source.videoHeight || source.naturalHeight || 160;
        const scale = 160 / Math.max(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.7));
      } catch { done(null); }
    };

    if (media.type === 'IMAGE') {
      // Usa FileReader no File original — evita qualquer restrição de blob URL
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => drawToThumb(img);
        img.onerror = () => done(null);
        img.src = e.target.result;
      };
      reader.onerror = () => done(null);
      reader.readAsDataURL(media.file);
    } else {
      // Vídeo: captura frame via blob URL
      const vid = document.createElement('video');
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      const tryDraw = () => { try { drawToThumb(vid); } catch { done(null); } };
      vid.onseeked = tryDraw;
      vid.onloadeddata = () => {
        try { vid.currentTime = Math.min(0.5, vid.duration / 2 || 0); }
        catch { tryDraw(); }
      };
      vid.onerror = () => done(null);
      vid.src = media.preview;
      vid.load();
    }
  });

  const exportPeriodHTML = () => {
    try {
    const from = exportDateFrom ? new Date(exportDateFrom + 'T00:00:00') : null;
    const to   = exportDateTo   ? new Date(exportDateTo   + 'T23:59:59') : null;
    const filtered = adHistory.filter(e => {
      const d = new Date(e.timestamp);
      if (from && d < from) return false;
      if (to   && d > to)   return false;
      return true;
    });
    if (filtered.length === 0) {
      alert('Nenhum lote encontrado no período selecionado. Verifique as datas ou deixe em branco para exportar tudo.');
      return;
    }

    const rows = filtered.flatMap(entry =>
      entry.ads.map(ad => ({
        data:     new Date(entry.timestamp).toLocaleString('pt-BR'),
        cliente:  entry.clientName  || '—',
        campanha: entry.campaignName || '—',
        bm:       entry.bmName       || entry.bmId        || '—',
        conta:    entry.adAccountName|| entry.adAccountId || '—',
        pagina:   entry.pageName     || entry.pageId      || '—',
        nome:     ad.adName   || '—',
        arquivo:  ad.fileName || '—',
        tipo:     ad.mediaType|| '—',
        thumb:    ad.thumbnailBase64 || null,
        copy:     ad.primaryText || '',
        titulo:   ad.title || '',
        link:     ad.link  || '',
      }))
    );

    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const periodLabel = exportDateFrom || exportDateTo
      ? `${exportDateFrom || '…'} até ${exportDateTo || '…'}`
      : 'Todo o período';
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<title>Anúncios Subidos — ${periodLabel}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f17;color:#e0e0e0;font-family:Arial,sans-serif;padding:32px}
  h1{font-size:20px;font-weight:800;color:#C8A23A;margin-bottom:4px}
  .sub{font-size:12px;color:#888;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead tr{background:#1a1a2e}
  th{padding:10px 12px;color:#C8A23A;font-weight:700;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #2d2d3a;white-space:nowrap}
  td{padding:8px 12px;border-bottom:1px solid #1e1e2a;vertical-align:middle}
  tr:hover td{background:#1a1a24}
  .thumb{width:72px;height:72px;object-fit:cover;border-radius:6px;display:block}
  .thumb-placeholder{width:72px;height:72px;border-radius:6px;background:#1e1e2e;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#555}
  .badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700}
  .badge-vid{background:rgba(16,185,129,.2);color:#10b981}
  .badge-img{background:rgba(24,119,242,.15);color:#4a9eff}
  .copy{max-width:260px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
  .link{color:#4a9eff;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
  .muted{color:#777}
</style>
</head>
<body>
<h1>Anúncios Subidos — Venza Assessoria</h1>
<p class="sub">Período: ${esc(periodLabel)} &nbsp;·&nbsp; ${rows.length} anúncio(s) em ${filtered.length} lote(s)</p>
<table>
<thead>
<tr><th>Preview</th><th>Data Upload</th><th>Cliente</th><th>Campanha</th><th>BM</th><th>Conta de Anúncio</th><th>Página</th><th>Nome do Anúncio</th><th>Arquivo</th><th>Copy</th><th>Título</th><th>Link</th></tr>
</thead>
<tbody>
${rows.map(r => `<tr>
<td>${r.thumb
  ? `<img class="thumb" src="${r.thumb}" alt="${esc(r.arquivo)}"/>`
  : `<div class="thumb-placeholder"><span class="${r.tipo==='VIDEO'?'badge-vid':'badge-img'}">${esc(r.tipo)}</span></div>`
}</td>
<td class="muted" style="white-space:nowrap">${esc(r.data)}</td>
<td style="font-weight:700">${esc(r.cliente)}</td>
<td>${esc(r.campanha)}</td>
<td class="muted">${esc(r.bm)}</td>
<td class="muted">${esc(r.conta)}</td>
<td class="muted">${esc(r.pagina)}</td>
<td style="font-weight:600;white-space:nowrap">${esc(r.nome)}</td>
<td class="muted"><span class="badge ${r.tipo==='VIDEO'?'badge-vid':'badge-img'}">${esc(r.tipo)}</span> ${esc(r.arquivo)}</td>
<td><span class="copy">${esc(r.copy)}</span></td>
<td>${esc(r.titulo)}</td>
<td><a class="link" href="${esc(r.link)}" target="_blank">${esc(r.link)}</a></td>
</tr>`).join('\n')}
</tbody>
</table>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    // Abre direto no navegador (mais confiável que download em alguns ambientes)
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setShowExportModal(false);
    } catch (err) {
      console.error('exportPeriodHTML:', err);
      alert('Erro ao gerar exportação: ' + (err.message || err));
    }
  };

  const exportPeriodCSV = () => {
    try {
      const from = exportDateFrom ? new Date(exportDateFrom + 'T00:00:00') : null;
      const to   = exportDateTo   ? new Date(exportDateTo   + 'T23:59:59') : null;
      const filtered = adHistory.filter(e => {
        const d = new Date(e.timestamp);
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
      if (filtered.length === 0) {
        alert('Nenhum lote encontrado no período selecionado.');
        return;
      }
      const BOM = '\uFEFF';
      const headers = ['Data Upload','Cliente','Campanha','BM','Conta de Anúncio','Página','Nome do Anúncio','Arquivo / preview no relatório HTML','Tipo','Copy','Título','Descrição','Link de destino','ID do anúncio Meta','Abrir anúncio na Meta'];
      const rows = filtered.flatMap(entry =>
        entry.ads.map(ad => [
          new Date(entry.timestamp).toLocaleString('pt-BR'),
          entry.clientName || '',
          entry.campaignName || '',
          entry.bmName || entry.bmId || '',
          entry.adAccountName || entry.adAccountId || '',
          entry.pageName || entry.pageId || '',
          ad.adName || '',
          ad.fileName || '',
          ad.mediaType || '',
          ad.primaryText || '',
          ad.title || '',
          ad.description || '',
          ad.link || '',
          ad.metaAdIds?.[0] || ad.metaAdId || '',
          getMetaAdManagerLink(entry, ad),
        ])
      );
      const csv = BOM + [headers, ...rows]
        .map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      const suffix = `${exportDateFrom || 'inicio'}_${exportDateTo || 'fim'}`;
      a.download = `anuncios_subidos_${suffix}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      setShowExportModal(false);
    } catch (err) {
      console.error('exportPeriodCSV:', err);
      alert('Erro ao gerar CSV: ' + (err.message || err));
    }
  };
  // ─── Rascunho local ────────────────────────────────────────────────
  const [draftSavedMsg, setDraftSavedMsg] = useState(false);
  const [hasDraft, setHasDraft] = useState(() => !startBlank && !!localStorage.getItem(DRAFT_KEY));
  const clientInfo = CLIENTS.find(c => c.id === card.clientId) || { name: card.clientName || 'Cliente' };

  // ─── Step 0: Seleção de BM e Conta de Anúncios ────────────────────────────────
  const [bms, setBms] = useState([]);
  const [loadingBms, setLoadingBms] = useState(true);
  const metaStorageKey = projectId
    ? `meta_defaults_proj_${projectId}`
    : `meta_defaults_${card.clientId}`;
  const [accountData, setAccountData] = useState(() => {
    const emptyAccount = { bmId: '', adAccountId: '', pageId: '', igId: '', advertiserAccountId: '' };
    if (quickPreset) {
      return {
        ...emptyAccount,
        bmId: quickPreset.bmId || '',
        adAccountId: quickPreset.adAccountId || '',
        pageId: quickPreset.pageId || '',
        igId: quickPreset.instagramId || '',
      };
    }
    if (startBlank) return emptyAccount;
    try {
      const projSaved = projectId && localStorage.getItem(`meta_defaults_proj_${projectId}`);
      const clientSaved = localStorage.getItem(`meta_defaults_${card.clientId}`);
      const saved = projSaved || clientSaved;
      const parsed = saved ? JSON.parse(saved) : {};
      return {
        bmId: '', adAccountId: '', pageId: '', igId: '', advertiserAccountId: '', ...parsed,
        ...(quickPreset ? {
          bmId: quickPreset.bmId || '',
          adAccountId: quickPreset.adAccountId || '',
          pageId: quickPreset.pageId || '',
          igId: quickPreset.instagramId || '',
        } : {}),
      };
    } catch {
      return {
        bmId: quickPreset?.bmId || '', adAccountId: quickPreset?.adAccountId || '',
        pageId: quickPreset?.pageId || '', igId: quickPreset?.instagramId || '', advertiserAccountId: '',
      };
    }
  });
  // ─── Presets de configuração (BM + Conta + Página) ────────────────────────────
  const [presets, setPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('meta_account_presets')) || []; } catch { return []; }
  });
  const [savePresetName, setSavePresetName] = useState(quickPreset?.name || '');
  const [savePresetImage, setSavePresetImage] = useState(quickPreset?.imageData || '');
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState(quickPreset?.id || '');
  const pendingPresetRef = useRef(null);

  const applyPreset = (preset) => {
    if (accountData.bmId === preset.bmId) {
      setAccountData(a => ({ ...a, adAccountId: preset.adAccountId, pageId: preset.pageId, igId: preset.instagramId || '' }));
      setAdSetData(a => ({ ...a, igId: preset.instagramId || a.igId, pixelId: preset.pixelId || a.pixelId, budget: Number(preset.budget) || a.budget }));
    } else {
      pendingPresetRef.current = preset;
      setAccountData({ bmId: preset.bmId, adAccountId: '', pageId: '', igId: '', advertiserAccountId: '' });
    }
  };

  const savePreset = () => {
    if (!savePresetName.trim()) {
      setError('Informe um nome para salvar o perfil.');
      return;
    }
    if (!accountData.bmId || !accountData.adAccountId || !accountData.pageId) {
      setError('Para salvar o perfil, selecione Business Manager, conta de anúncios e página do Facebook.');
      return;
    }
    setError(null);
    const bmName = bms.find(b => b.id === accountData.bmId)?.name || accountData.bmId;
    const adAccountName = adAccounts.find(a => a.id === accountData.adAccountId)?.name || accountData.adAccountId;
    const pageName = apiData.pages.find(p => p.id === accountData.pageId)?.name || accountData.pageId;
    const selectedInstagramId = accountData.igId || adSetData.igId;
    const ig = apiData.igs.find(item => item.id === selectedInstagramId);
    const pixel = apiData.pixels.find(item => item.id === adSetData.pixelId);
    const newPreset = {
      id: quickPreset?.id || editingPresetId || uuidv4(), name: savePresetName.trim(), projectId: projectId || '',
      bmId: accountData.bmId, bmName, adAccountId: accountData.adAccountId, adAccountName,
      pageId: accountData.pageId, pageName,
      instagramId: selectedInstagramId || '', instagramName: ig?.name || '',
      pixelId: adSetData.pixelId || '', pixelName: pixel?.name || '',
      budget: Number(adSetData.budget) || 50,
      imageData: savePresetImage || quickPreset?.imageData || '',
    };
    const updated = presets.some(preset => preset.id === newPreset.id)
      ? presets.map(preset => preset.id === newPreset.id ? newPreset : preset)
      : [...presets, newPreset];
    setPresets(updated);
    localStorage.setItem('meta_account_presets', JSON.stringify(updated));
    onProfileSaved?.(newPreset);
    setSavePresetName('');
    setSavePresetImage('');
    setEditingPresetId('');
    setShowSavePreset(false);
  };

  const deletePreset = (id) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    localStorage.setItem('meta_account_presets', JSON.stringify(updated));
  };

  const editPreset = (preset) => {
    applyPreset(preset);
    setEditingPresetId(preset.id);
    setSavePresetName(preset.name || '');
    setSavePresetImage(preset.imageData || '');
    setShowSavePreset(false);
  };

  const [adAccounts, setAdAccounts] = useState([]);
  const [allRawAccounts, setAllRawAccounts] = useState([]);

  // Estado da conexão OAuth da agência. Enquanto ela não estiver ativa, o
  // criador roda em modo demonstração e não publica nada.
  useEffect(() => {
    // Remove a credencial que versões anteriores guardavam no navegador. Sem
    // isso, o token continuaria exposto na máquina de quem já usou a ferramenta.
    try {
      localStorage.removeItem('meta_access_token');
    } catch { /* navegador sem storage: nada a limpar */ }

    let alive = true;
    getMetaConnectionState()
      .then(state => { if (alive) setConnection(state); })
      .catch(() => { if (alive) setConnection({ connected: false, name: null, status: null, message: null }); })
      .finally(() => { if (alive) setConnectionChecked(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!connectionChecked) return;
    if (!connection.connected) {
      setBms(MOCK_BM_DATA.bms);
      setLoadingBms(false);
      return;
    }
    setLoadingBms(true);
    // Uma chamada só: contas com o business embutido — não exige a permissão
    // business_management para montar a lista.
    metaGet('me/adaccounts', { fields: 'id,name,account_status,business{id,name}', limit: 100 })
      .then(data => {
        if (data.error) throw new Error(data.error.message);
        const accounts = data.data || [];
        setAllRawAccounts(accounts);
        const bmMap = new Map();
        accounts.forEach(acc => {
          if (acc.business) bmMap.set(acc.business.id, acc.business.name);
        });
        const bmList = Array.from(bmMap, ([id, name]) => ({ id, name }));
        const hasPersonal = accounts.some(acc => !acc.business);
        if (hasPersonal) bmList.push({ id: '__direct__', name: 'Contas Pessoais (sem BM)' });
        setBms(bmList);
        if (!startBlank && bmList.length === 1) setAccountData(a => ({ ...a, bmId: bmList[0].id }));
      })
      .catch(err => {
        console.error('fetchBMs:', err);
        setBms([{ id: '__direct__', name: 'Contas Diretas' }]);
        if (!startBlank) setAccountData(a => ({ ...a, bmId: '__direct__' }));
      })
      .finally(() => setLoadingBms(false));
  }, [connectionChecked, connection.connected]);

  useEffect(() => {
    const bmId = accountData.bmId;
    if (!bmId) { setAdAccounts([]); return; }
    const pending = pendingPresetRef.current;
    const isApplyingPreset = pending && pending.bmId === bmId;
    if (!connection.connected) {
      setAdAccounts(MOCK_BM_DATA.accounts[bmId] || []);
      if (isApplyingPreset) {
        setAccountData(a => ({ ...a, adAccountId: pending.adAccountId, pageId: pending.pageId, igId: pending.instagramId || '' }));
        setAdSetData(a => ({ ...a, igId: pending.instagramId || a.igId, pixelId: pending.pixelId || a.pixelId, budget: Number(pending.budget) || a.budget }));
        pendingPresetRef.current = null;
      }
      return;
    }
    const filtered = allRawAccounts
      .filter(acc => bmId === '__direct__' ? !acc.business : acc.business?.id === bmId)
      .map(acc => ({ id: acc.id, name: acc.name, status: acc.account_status }));
    setAdAccounts(filtered);
    if (isApplyingPreset) {
      setAccountData(a => ({ ...a, adAccountId: pending.adAccountId, pageId: pending.pageId, igId: pending.instagramId || '' }));
      setAdSetData(a => ({ ...a, igId: pending.instagramId || a.igId, pixelId: pending.pixelId || a.pixelId, budget: Number(pending.budget) || a.budget }));
      pendingPresetRef.current = null;
    }
  }, [accountData.bmId, allRawAccounts, connection.connected]);

  // Categoria especial da campanha: sem valor padrão, de propósito.
  const [specialAdCategory, setSpecialAdCategory] = useState('');

  // ─── Beneficiário e pagador (Brasil) ─────────────────────────────────────────
  // Conjunto novo que entrega no Brasil declara quem se beneficia e quem paga.
  // A Meta não lista essas identidades por API, mas os conjuntos que já existem
  // na conta devolvem as que foram usadas: o sistema copia de lá, sem pedir nada.
  // Conjunto existente já tem a declaração e não precisa dela de novo.
  const [regulationScan, setRegulationScan] = useState({ status: 'idle', adSets: [], error: '' });
  // Troca manual (só quando o operador quer outro par): { beneficiaryId, payerId }.
  const [regulationOverride, setRegulationOverride] = useState(null);
  const [editingRegulation, setEditingRegulation] = useState(false);
  const [regulationScanKey, setRegulationScanKey] = useState(0);

  useEffect(() => {
    setRegulationOverride(null);
    setEditingRegulation(false);
  }, [accountData.adAccountId]);

  useEffect(() => {
    const adAccountId = normalizeAdAccountId(accountData.adAccountId);
    if (!adAccountId || !connection.connected) {
      setRegulationScan({ status: 'idle', adSets: [], error: '' });
      return;
    }
    let alive = true;
    setRegulationScan({ status: 'loading', adSets: [], error: '' });
    metaGetAll(
      `${adAccountId}/adsets`,
      { fields: 'id,name,campaign_id,created_time,regional_regulated_categories,regional_regulation_identities', limit: 100 },
      { maxPages: 3 },
    )
      .then(adSets => { if (alive) setRegulationScan({ status: 'done', adSets, error: '' }); })
      .catch(caught => { if (alive) setRegulationScan({ status: 'error', adSets: [], error: caught?.message || 'Falha ao ler os conjuntos da conta.' }); });
    return () => { alive = false; };
  }, [accountData.adAccountId, connection.connected, regulationScanKey]);

  const [apiData, setApiData] = useState({ campaigns: [], pages: [], igs: [], pixels: [] });
  const [loadingApi, setLoadingApi] = useState(false);

  // Recarrega BMs, contas e páginas usando a conexão OAuth da agência. Não há
  // token para testar aqui: a credencial fica no servidor.
  const loadMetaConfiguration = async () => {
    setConfigLoading(true);
    setConfigError('');
    setConfigSaved(false);
    try {
      const state = await getMetaConnectionState();
      setConnection(state);
      if (!state.connected) {
        throw new MetaNotConnectedError(
          state.message || 'A agência ainda não está conectada à Meta. Um administrador precisa conectar em Configurações › APIs.'
        );
      }

      const profile = await metaGet('me', { fields: 'id,name' });
      if (profile.error) throw new Error(profile.error.message || 'A Meta recusou a credencial da agência.');

      const [businesses, rawAccounts, rawPages] = await Promise.all([
        metaGetAll('me/businesses', { fields: 'id,name', limit: 200 }).catch(() => []),
        metaGetAll('me/adaccounts', { fields: 'id,name,account_status,business{id,name}', limit: 200 }),
        metaGetAll('me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: 200 }).catch(() => []),
      ]);

      const bmMap = new Map(businesses.map(business => [business.id, { id: business.id, name: business.name }]));
      rawAccounts.forEach(account => {
        if (account.business?.id) bmMap.set(account.business.id, { id: account.business.id, name: account.business.name || account.business.id });
      });
      const hasDirectAccounts = rawAccounts.some(account => !account.business?.id);
      const foundBms = [
        ...(hasDirectAccounts ? [{ id: '__direct__', name: 'Contas Diretas' }] : []),
        ...Array.from(bmMap.values()),
      ];
      const foundAccounts = rawAccounts.map(account => ({
        id: account.id.startsWith('act_') ? account.id : `act_${account.id}`,
        name: account.name || account.id,
        status: account.account_status,
        business: account.business || null,
      }));
      const foundPages = rawPages.map(page => ({
        id: page.id,
        name: page.name || page.id,
        instagram_business_account: page.instagram_business_account || null,
      }));

      setConfigProfile(profile);
      setConfigAssets({ bms: foundBms, accounts: foundAccounts, pages: foundPages });
    } catch (caught) {
      setConfigProfile(null);
      setConfigAssets({ bms: [], accounts: [], pages: [] });
      setConfigError(caught instanceof Error ? caught.message : 'Não foi possível consultar a Meta.');
    } finally {
      setConfigLoading(false);
    }
  };

  const saveMetaConfiguration = () => {
    if (!configProfile) {
      setConfigError('Carregue os dados da conexão antes de aplicar.');
      return;
    }
    setBms(configAssets.bms);
    setAllRawAccounts(configAssets.accounts);
    setAdAccounts([]);
    setAccountData(previous => ({ ...previous, bmId: '', adAccountId: '', pageId: '', advertiserAccountId: '' }));
    setApiData(previous => ({
      ...previous,
      pages: configAssets.pages.map(page => ({ id: page.id, name: page.name })),
      igs: configAssets.pages
        .filter(page => page.instagram_business_account)
        .map(page => ({ id: page.instagram_business_account.id, name: `@${page.instagram_business_account.username || page.instagram_business_account.id}` })),
    }));
    setConfigError('');
    setConfigSaved(true);
    setTimeout(() => {
      setConfigSaved(false);
      setActiveTab(0);
    }, 700);
  };

  useEffect(() => {
    const adAccountId = accountData.adAccountId;
    if (!adAccountId) return;
    const isConnected = connection.connected;
    setLoadingApi(true);
    async function load() {
      try {
        if (!isConnected) {
          const [camps, pgs, igs, pixs] = await Promise.all([
            MOCK_API.fetchCampaigns(), MOCK_API.fetchPages(), MOCK_API.fetchIg(), MOCK_API.fetchPixels()
          ]);
          setApiData({ campaigns: camps, pages: pgs, igs: igs, pixels: pixs });
        } else {
          const [campsRes, pgsRes, pixsRes] = await Promise.all([
            metaGet(`${adAccountId}/campaigns`, { fields: 'id,name,status,objective', limit: 100 }),
            metaGet('me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: 50 }).catch(() => ({ data: [] })),
            metaGet(`${adAccountId}/adspixels`, { fields: 'id,name', limit: 25 }).catch(() => ({ data: [] })),
          ]);
          if (campsRes.error) throw new Error(campsRes.error.message);
          const pagesData = pgsRes.data || [];
          const igAccounts = pagesData
            .filter(p => p.instagram_business_account)
            .map(p => ({ id: p.instagram_business_account.id, name: `@${p.instagram_business_account.username}` }));
          const DELETED_STATUSES = [3, 4, 'DELETED', 'ARCHIVED'];
          const allCampaigns = (campsRes.data || [])
            .filter(c => !DELETED_STATUSES.includes(c.status))
            .map(c => {
              const isPaused = c.status === 2 || c.status === 'PAUSED';
              return { id: c.id, name: isPaused ? `${c.name} (Pausada)` : c.name, objective: c.objective };
            });
          setApiData({
            campaigns: allCampaigns,
            pages: pagesData.map(p => ({ id: p.id, name: p.name })),
            igs: igAccounts,
            pixels: pixsRes.data || [],
          });
        }
      } catch (e) { console.error('loadApiData:', e); } finally { setLoadingApi(false); }
    }
    load();
  }, [accountData.adAccountId, connection.connected]);

  // AdSets existentes (carregados ao selecionar campanha existente)
  const [existingAdSets, setExistingAdSets] = useState([]);
  const [loadingAdSets, setLoadingAdSets] = useState(false);

  // ─── Tab 1: Campanha ──────────────────────────────────────────────────────────
  const [campAction, setCampAction] = useState('existing');
  const todayDDMMYYYY = (() => {
    const d = new Date();
    return String(d.getDate()).padStart(2,'0') + String(d.getMonth()+1).padStart(2,'0') + String(d.getFullYear());
  })();

  const [campData, setCampData] = useState({
    existingId: '',
    name: `[VENZA] [${OBJECTIVE_LABEL(objFromDemanda(card.demandaObjetivo))}] [${todayDDMMYYYY}]`,
    objective: objFromDemanda(card.demandaObjetivo),
    budgetType: 'ABO',
    budget: Number(quickPreset?.budget) || parseInt((card.demandaOrcamento || '50').replace(/\D/g, ''), 10) || 50,
    status: 'PAUSED',
  });

  // ─── Carregamento de AdSets de campanha existente ────────────────────────────
  const [adSetAction, setAdSetAction] = useState('existing'); // 'new' | 'existing'
  const [selectedAdSetIds, setSelectedAdSetIds] = useState([]);       // multi-select
  const [campaignObjective, setCampaignObjective] = useState(null);   // objetivo da campanha existente
  const [loadingObjective, setLoadingObjective] = useState(false);
  // Campanhas existentes selecionadas. campData.existingId acompanha a primeira
  // (usada para objetivo e para criar conjunto novo, que só vale com uma).
  const [selectedCampaignIds, setSelectedCampaignIds] = useState([]);
  const changeCampaignSelection = (ids) => {
    setSelectedCampaignIds(ids);
    setCampData(current => ({ ...current, existingId: ids[0] || '' }));
    if (ids.length > 1) setAdSetAction('existing');
  };

  const toggleAdSet = (id) => setSelectedAdSetIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const [adSetFetchError, setAdSetFetchError] = useState(null);
  const [adSetRetryKey, setAdSetRetryKey] = useState(0);
  const selectedCampaignKey = selectedCampaignIds.join(',');

  useEffect(() => {
    const campIds = campAction === 'existing' ? selectedCampaignIds : [];
    if (!campIds.length) { setExistingAdSets([]); setAdSetFetchError(null); return; }
    if (!connection.connected) return;
    setLoadingAdSets(true);
    setAdSetFetchError(null);

    // A espera por limite de requisição é tratada dentro do cliente da Graph;
    // aqui só refletimos isso na tela.
    const rateNotice = {
      onRateLimit: (seconds) => {
        setAdSetFetchError(`⏳ Limite de requisições da Meta — aguardando ${seconds}s...`);
      },
    };
    Promise.all(campIds.map(campId =>
      metaGet(`${campId}/adsets`, { fields: 'id,name,status,destination_type,optimization_goal', limit: 100 }, rateNotice)
        .then(json => {
          if (json?.error) throw new Error(`Erro ${json.error.code}: ${json.error.message}`);
          const campaignName = apiData.campaigns.find(c => c.id === campId)?.name || campId;
          return (json.data || [])
            .filter(a => a.status !== 'DELETED' && a.status !== 'ARCHIVED')
            .map(a => ({ ...a, campaign_id: campId, campaignName }));
        })
    ))
      .then(groups => {
        const loaded = groups.flat();
        setExistingAdSets(loaded);
        const loadedIds = new Set(loaded.map(a => a.id));
        setSelectedAdSetIds(prev => prev.filter(id => loadedIds.has(id)));
      })
      .catch(err => { setAdSetFetchError(err.message?.startsWith('Erro') ? err.message : `Falha: ${err.message}`); setExistingAdSets([]); })
      .finally(() => setLoadingAdSets(false));
  }, [selectedCampaignKey, campAction, adSetRetryKey, connection.connected]);

  // ─── Fetch objetivo da campanha existente ─────────────────────────────────────
  useEffect(() => {
    if (campAction !== 'existing' || !campData.existingId) {
      setCampaignObjective(null);
      return;
    }
    if (!connection.connected) return;
    setLoadingObjective(true);
    metaGet(campData.existingId, { fields: 'objective' })
      .then(data => {
        if (data.objective) {
          setCampaignObjective(data.objective);
          const config = OBJECTIVE_ADSET_CONFIG[data.objective];
          if (config) setAdSetData(a => ({ ...a, optimizationGoal: config.optimization_goal }));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingObjective(false));
  }, [campData.existingId, campAction, connection.connected]);

  // ─── Tab 2: Conjunto (AdSet) ──────────────────────────────────────────────────
  const [adSetData, setAdSetData] = useState({
    name: `[BROAD] ${card.demandaPublico || '18-65 BR'}`,
    pixelId: quickPreset?.pixelId || '',
    pageId: quickPreset?.pageId || clientInfo.metaPageId || '',
    igId: quickPreset?.instagramId || '',
    audience: card.demandaPublico || 'Brasil, 18–65 anos, sem segmentação (broad)',
    budget: Number(quickPreset?.budget) || 20,
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    placements: 'ADVANTAGE_PLUS',
    advertiserAccountId: '',
  });

  // ─── Tab 3: Anúncios (lote) ───────────────────────────────────────────────────
  const todayDDMM = (() => {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0');
  })();

  // Padrão: AD01_2703, AD02_2703, etc.
  const resolveAdName = (pattern, idx) =>
    pattern.replace(/{index}/g, String(idx).padStart(2, '0')).replace(/{date}/g, todayDDMM);

  const [adsData, setAdsData] = useState({
    namingPattern: 'AD{index}_{date}', // {date} = DDMM dinamico na hora de publicar
    primaryText: card.demandaDescricao || '',
    description: '',
    // O título é escrito por quem cria o anúncio. Herdar o nome do projeto
    // fazia a headline nascer com o nome do cliente — que raramente é o texto
    // que deve aparecer no anúncio.
    title: '',
    cta: 'LEARN_MORE',
    link: card.linkComplete || '',
    utmTags: DEFAULT_UTM,
    leadFormId: '',
    whatsappWelcomeMsg: 'Olá! Gostaria de mais informações.',
    // Opções 2 a 5 de cada texto (a 1ª fica em primaryText, title e description).
    variations: EMPTY_VARIATIONS,
  });
  const variations = variationsOf(adsData);
  const optionValues = (field) => [adsData[field] || '', ...variations[field]];
  const setOptionValues = (field, values) => setAdsData(current => ({
    ...current,
    [field]: values[0] ?? '',
    variations: { ...variationsOf(current), [field]: values.slice(1) },
  }));
  const globalTextOptions = {
    primaryTexts: textOptions(optionValues('primaryText')),
    titles: textOptions(optionValues('title')),
    descriptions: textOptions(optionValues('description')),
  };
  const usingTextVariations = hasTextVariations(globalTextOptions);
  const [mediaFiles, setMediaFiles] = useState([]);
  // Arrastar e soltar: qual lugar está recebendo ('panel' ou `${idDoAnúncio}:feed|story`).
  const [dropTarget, setDropTarget] = useState(null);
  // Lugar vazio com a lista de mídias aberta: { unitId, role }.
  const [slotPicker, setSlotPicker] = useState(null);
  const slotUploadRef = useRef(null);
  const slotUploadTarget = useRef(null);
  const [createAsDraft, setCreateAsDraft] = useState(false);
  const [preserveOriginalMedia, setPreserveOriginalMedia] = useState(true);
  const [forceMessagesDest, setForceMessagesDest] = useState(false);
  const [leadDestType, setLeadDestType] = useState('WEBSITE');
  const [saleConversionEvent, setSaleConversionEvent] = useState('PURCHASE');
  const [individualCopyMode, setIndividualCopyMode] = useState(false);
  const [adCopyOverrides, setAdCopyOverrides] = useState({});   // { [fileId]: { primaryText?, title?, ... } }
  const [activeCopyFileId, setActiveCopyFileId] = useState(null);
  // Feed + Stories: { [idDaMídiaFeed]: idDaMídiaStories }. A versão 9:16 não vira
  // anúncio próprio — entra no mesmo anúncio, nos posicionamentos verticais.
  const [storyPairs, setStoryPairs] = useState({});
  // Herança por conjunto: copy e URL vêm dos anúncios que já rodam no conjunto.
  const [inheritUrl, setInheritUrl] = useState(true);
  const [inheritCopy, setInheritCopy] = useState(true);
  const [adSetInheritance, setAdSetInheritance] = useState({}); // { [adSetId]: { status, data, error } }

  const usingExistingAdSet = campAction === 'existing' && adSetAction === 'existing' && selectedAdSetIds.length > 0;
  // Beneficiário e pagador só entram quando o sistema cria um conjunto novo.
  const createsNewAdSet = !(campAction === 'existing' && adSetAction === 'existing');
  const detectedRegulation = regulationScan.status === 'done' ? pickBrazilIdentities(regulationScan.adSets, selectedCampaignIds) : null;
  const regulationIds = regulationOverride && (regulationOverride.beneficiaryId.trim() || regulationOverride.payerId.trim())
    ? regulationOverride
    : detectedRegulation;

  // ─── Unidades de anúncio: cada mídia de feed (com a versão Stories junto) ────
  const mediaById = Object.fromEntries(mediaFiles.map(m => [m.id, m]));
  const pairedStoryIds = new Set(Object.values(storyPairs));
  const adUnits = mediaFiles.filter(m => !pairedStoryIds.has(m.id));
  const storyOf = (feedId) => (storyPairs[feedId] ? mediaById[storyPairs[feedId]] || null : null);

  // ─── Herança: lê copy e URL dos anúncios de cada conjunto selecionado ────────
  const inheritActive = usingExistingAdSet && (inheritUrl || inheritCopy);
  const selectedAdSetKey = selectedAdSetIds.join(',');
  useEffect(() => {
    if (!inheritActive || !connection.connected) return;
    const missing = selectedAdSetIds.filter(id => !adSetInheritance[id] || adSetInheritance[id].status === 'error');
    if (!missing.length) return;
    setAdSetInheritance(prev => {
      const next = { ...prev };
      missing.forEach(id => { next[id] = { status: 'loading' }; });
      return next;
    });
    (async () => {
      for (const id of missing) {
        try {
          const ads = await metaGetAll(
            `${id}/ads`,
            { fields: 'id,name,effective_status,creative{object_story_spec,asset_feed_spec,body,title,link_url,object_url,call_to_action_type,url_tags}', limit: 50 },
            { maxPages: 4 },
          );
          const data = pickInheritedCopy(ads);
          setAdSetInheritance(prev => ({ ...prev, [id]: { status: data ? 'ready' : 'empty', data } }));
        } catch (e) {
          setAdSetInheritance(prev => ({ ...prev, [id]: { status: 'error', error: e.message || 'Falha ao ler os anúncios do conjunto.' } }));
        }
      }
    })();
  }, [selectedAdSetKey, inheritActive, connection.connected]);

  const inheritanceFor = (adSetId) => (inheritActive ? adSetInheritance[adSetId] : null);
  const inheritanceLoading = inheritActive && connection.connected && selectedAdSetIds.some(id => !adSetInheritance[id] || adSetInheritance[id].status === 'loading');
  const inheritanceCoversUrl = inheritActive && inheritUrl && selectedAdSetIds.every(id => adSetInheritance[id]?.status === 'ready' && adSetInheritance[id].data?.link);
  const inheritedUrlError = inheritActive && inheritUrl
    ? selectedAdSetIds.map(id => {
        const data = adSetInheritance[id]?.data;
        const problem = data?.link ? validateDestinationUrl(data.link) : null;
        return problem ? `Conjunto "${existingAdSets.find(a => a.id === id)?.name || id}": ${problem}` : null;
      }).find(Boolean) || null
    : null;
  const campaignObjectives = [...new Set(selectedCampaignIds.map(id => apiData.campaigns.find(c => c.id === id)?.objective).filter(Boolean))];

  // Objetivo ativo (detectado da campanha existente ou selecionado na nova)
  const activeObjective = campaignObjective || campData.objective;

  const MSG_DEST_TYPES = ['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT'];
  const MSG_OBJECTIVES  = ['OUTCOME_ENGAGEMENT'];

  // Destino do conjunto selecionado (apenas quando usando existente)
  const detectedDestType = usingExistingAdSet
    ? (existingAdSets.find(a => a.id === selectedAdSetIds[0])?.destination_type || 'WEBSITE')
    : 'WEBSITE';

  // Campanha de mensagens: por objetivo (ENGAGEMENT), por destino detectado, ou toggle manual
  const isAutoMsgDest =
    MSG_OBJECTIVES.includes(activeObjective) ||
    MSG_DEST_TYPES.includes(detectedDestType) ||
    forceMessagesDest;

  // URL necessária apenas nestas condições:
  const needsUrl = !isAutoMsgDest && (
    activeObjective === 'OUTCOME_TRAFFIC' ||
    activeObjective === 'OUTCOME_SALES'   ||
    (activeObjective === 'OUTCOME_LEADS' && leadDestType === 'WEBSITE')
  );

  const isLeadFormDest = activeObjective === 'OUTCOME_LEADS' && leadDestType === 'INSTANT_FORM';

  // ─── Validação por aba ────────────────────────────────────────────────────────
  const tabErrors = {
    0: !accountData.bmId ? 'Selecione uma Business Manager.' :
       !normalizeAdAccountId(accountData.adAccountId) ? 'Selecione uma Conta de Anúncios válida.' :
       !accountData.pageId ? 'Selecione uma Página do Facebook.' : null,
    1: campAction === 'existing' && selectedCampaignIds.length === 0 ? 'Selecione pelo menos uma campanha existente.' :
       campAction === 'existing' && campaignObjectives.length > 1 ? 'As campanhas selecionadas têm objetivos diferentes. Selecione campanhas com o mesmo objetivo.' :
       campAction === 'existing' && adSetAction === 'existing' && selectedAdSetIds.length === 0 ? 'Selecione pelo menos um conjunto de anúncios.' :
       campAction === 'new' && !campData.name.trim() ? 'Informe o nome da campanha.' :
       campAction === 'new' && !specialAdCategory ? 'Declare a categoria especial da campanha.' : null,
    2: (campAction === 'existing' && adSetAction === 'existing' && selectedAdSetIds.length > 0) ? null :
       !adSetData.name.trim() ? 'Informe o nome do conjunto.' : null,
    // A checagem do link cobre a proibição de destino dinâmico (cloaking): o
    // encurtador interno pode trocar de destino depois da aprovação do anúncio.
    3: mediaFiles.length === 0 ? 'Adicione pelo menos 1 mídia.' :
       adUnits.length > MAX_ADS_PER_BATCH ? `A Meta aceita até ${MAX_ADS_PER_BATCH} anúncios por conjunto e o lote tem ${adUnits.length}. Junte as versões Feed + Stories ou remova ${adUnits.length - MAX_ADS_PER_BATCH}.` :
       inheritanceLoading ? 'Aguarde: lendo a copy e a URL dos anúncios de cada conjunto...' :
       (needsUrl && !inheritanceCoversUrl && !adsData.link.trim()) ? (inheritActive ? 'Informe a URL de destino para os conjuntos que ainda não têm anúncio.' : 'Informe a URL de destino.') :
       (needsUrl && !inheritanceCoversUrl ? validateDestinationUrl(adsData.link) : null) ||
       (needsUrl ? inheritedUrlError : null) ||
       (needsUrl ? Object.values(adCopyOverrides).map(override => validateDestinationUrl(override?.link || '')).find(Boolean) || null : null),
  };

  // ─── Funções de Rascunho ─────────────────────────────────────────────────────
  const saveDraft = () => {
    const draft = {
      accountData,
      campAction, campData,
      adSetAction, selectedCampaignIds, selectedAdSetIds, adSetData,
      adsData, forceMessagesDest, leadDestType, saleConversionEvent,
      individualCopyMode, adCopyOverrides, preserveOriginalMedia, inheritUrl, inheritCopy,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setHasDraft(true);
    setDraftSavedMsg(true);
    setTimeout(() => setDraftSavedMsg(false), 2500);
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
  };

  const restoreDraft = () => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!d) return;
      if (d.accountData) setAccountData(d.accountData);
      if (d.campAction) setCampAction(d.campAction);
      if (d.campData) setCampData(d.campData);
      if (d.adSetAction) setAdSetAction(d.adSetAction);
      if (d.selectedCampaignIds) setSelectedCampaignIds(d.selectedCampaignIds);
      else if (d.campData?.existingId) setSelectedCampaignIds([d.campData.existingId]);
      if (d.selectedAdSetIds) setSelectedAdSetIds(d.selectedAdSetIds);
      if (d.inheritUrl != null) setInheritUrl(d.inheritUrl);
      if (d.inheritCopy != null) setInheritCopy(d.inheritCopy);
      if (d.adSetData) setAdSetData(d.adSetData);
      if (d.adsData) setAdsData(d.adsData);
      if (d.forceMessagesDest != null) setForceMessagesDest(d.forceMessagesDest);
      if (d.leadDestType) setLeadDestType(d.leadDestType);
      if (d.saleConversionEvent) setSaleConversionEvent(d.saleConversionEvent);
      if (d.individualCopyMode != null) setIndividualCopyMode(d.individualCopyMode);
      if (d.adCopyOverrides) setAdCopyOverrides(d.adCopyOverrides);
      if (d.preserveOriginalMedia != null) setPreserveOriginalMedia(d.preserveOriginalMedia);
    } catch (e) { console.error('restoreDraft:', e); }
  };
  const goNext = () => {
    const err = tabErrors[activeTab];
    if (err) { setError(err); return; }
    setError(null);
    // Pular Tab 2 quando campanha + conjunto já existentes foram selecionados
    if (activeTab === 1 && usingExistingAdSet) {
      setActiveTab(3);
    } else {
      setActiveTab(a => a + 1);
    }
  };

  // Vídeo entra do jeito que veio, como a imagem: a Meta aceita MP4, MOV, HEVC e
  // outros formatos e converte do lado dela. Converter aqui (ffmpeg só na CPU)
  // levava minutos por vídeo de celular.
  const mediaFilesRef = useRef(mediaFiles);
  mediaFilesRef.current = mediaFiles;
  // Mídias que o operador separou à mão: o pareamento automático não as junta de novo.
  const splitMediaIds = useRef(new Set());

  // pairTo: { mediaId, role } coloca o arquivo enviado no lugar vazio de um
  // anúncio — role 'story' vira a versão Stories dele, 'feed' a versão Feed.
  const addMediaFiles = async (rawFiles, { pairTo = null } = {}) => {
    const files = Array.from(rawFiles || []);
    if (!files.length) return;
    const rejected = [];
    const ignored = files.filter(file => !isVideoFile(file) && !isImageFile(file));
    if (ignored.length) rejected.push(`${ignored.length} arquivo(s) ignorado(s): só entram imagens JPG, PNG, WEBP e vídeos.`);
    const candidates = files
      .filter(file => isVideoFile(file) || isImageFile(file))
      .filter(file => {
        if (isVideoFile(file) && file.size > META_MAX_VIDEO_BYTES) {
          rejected.push(`${file.name}: o vídeo ultrapassa o limite de 4 GB da Meta.`);
          return false;
        }
        return true;
      })
      // Em ordem de nome: a numeração dos anúncios segue a pasta.
      .sort(byFileName);
    const remainingSlots = Math.max(0, MAX_MEDIA_FILES - mediaFilesRef.current.length);
    if (candidates.length > remainingSlots) {
      rejected.push(`Limite de ${MAX_MEDIA_FILES} arquivos por publicação: ${candidates.length - remainingSlots} ficaram de fora.`);
    }
    const allowed = candidates.slice(0, remainingSlots);
    if (rejected.length) setError(rejected.join(' '));
    if (!allowed.length) return;
    const baseMedias = allowed.map((file) => ({
      id: uuidv4(), file,
      preview: URL.createObjectURL(file),
      type: isVideoFile(file) ? 'VIDEO' : 'IMAGE',
      thumbnailBase64: null,
    }));
    // Proporção decide se é Feed ou Stories (9:16) e permite parear as versões.
    // HEVC que o <video> não abre ainda tem as dimensões lidas do cabeçalho.
    const dimensions = await Promise.all(baseMedias.map(async (m) => {
      const dims = await readMediaDimensions(m.file, m.type);
      if (m.type !== 'VIDEO' || (dims.width && dims.height)) return dims;
      const probe = await probeVideo(m.file).catch(() => null);
      return probe ? { width: probe.width, height: probe.height } : dims;
    }));
    const newMedias = baseMedias.map((m, idx) => ({
      ...m,
      width: dimensions[idx].width,
      height: dimensions[idx].height,
      placement: detectPlacementFormat(dimensions[idx].width, dimensions[idx].height),
    }));
    const target = pairTo && newMedias.length === 1 ? mediaFilesRef.current.find(m => m.id === pairTo.mediaId) : null;
    setMediaFiles(prev => [...prev, ...newMedias]);
    if (target) {
      if (pairTo.role === 'story') linkPair(target.id, newMedias[0].id);
      else linkPair(newMedias[0].id, target.id);
    } else {
      setStoryPairs(prev => autoPairMedia(
        [...mediaFilesRef.current, ...newMedias].map(m => ({ id: m.id, name: m.file.name, type: m.type, placement: m.placement || 'feed' })),
        prev,
        [...splitMediaIds.current],
      ));
    }
    if (!rejected.length) setError(null);
    // Captura thumbnails em paralelo logo após seleção dos arquivos
    const thumbs = await Promise.all(newMedias.map(m => mediaThumbnailBase64(m).catch(() => null)));
    // Vídeo que o <video> não abriu (HEVC sem suporte): tira o quadro pelo
    // WebCodecs, três por vez para não esgotar o decodificador da placa.
    const missing = newMedias.map((m, i) => (m.type === 'VIDEO' && !thumbs[i] ? i : -1)).filter(i => i >= 0);
    let cursor = 0;
    await Promise.all([0, 1, 2].map(async () => {
      while (cursor < missing.length) {
        const i = missing[cursor++];
        const frame = await extractVideoFrame(newMedias[i].file, 0.5, 240);
        if (frame) thumbs[i] = await blobToDataUrl(frame);
      }
    }));
    setMediaFiles(prev => prev.map(m => {
      const i = newMedias.findIndex(nm => nm.id === m.id);
      if (i >= 0 && thumbs[i]) return { ...m, thumbnailBase64: thumbs[i] };
      return m;
    }));
  };

  const handleFileUpload = (e, options) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    return addMediaFiles(files, options);
  };

  // Texto próprio de um anúncio fica na chave da mídia que lidera o anúncio;
  // quando outra mídia passa a liderar, o texto vai junto.
  const moveCopyOverride = (fromId, toId) => setAdCopyOverrides(prev => {
    if (!prev[fromId] || prev[toId]) return prev;
    const next = { ...prev, [toId]: prev[fromId] };
    delete next[fromId];
    return next;
  });

  /** Junta duas mídias no mesmo anúncio: `feedId` no Feed e `storyId` em Stories/Reels. */
  const linkPair = (feedId, storyId) => {
    if (!feedId || !storyId || feedId === storyId) return;
    splitMediaIds.current.delete(feedId);
    splitMediaIds.current.delete(storyId);
    setStoryPairs(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key === feedId || key === storyId || next[key] === feedId || next[key] === storyId) delete next[key];
      }
      next[feedId] = storyId;
      return next;
    });
    // O anúncio fica no lugar da mídia que já estava antes na lista.
    setMediaFiles(prev => {
      const feedIndex = prev.findIndex(m => m.id === feedId);
      const storyIndex = prev.findIndex(m => m.id === storyId);
      if (feedIndex < 0 || storyIndex < 0 || feedIndex < storyIndex) return prev;
      const next = [...prev];
      const [feed] = next.splice(feedIndex, 1);
      next.splice(storyIndex, 0, feed);
      return next;
    });
    moveCopyOverride(storyId, feedId);
  };

  /** Separa o par: a versão Stories vira um anúncio próprio, logo depois. */
  const unlinkPair = (feedId) => {
    const storyId = storyPairs[feedId];
    if (!storyId) return;
    splitMediaIds.current.add(feedId);
    splitMediaIds.current.add(storyId);
    setStoryPairs(prev => { const next = { ...prev }; delete next[feedId]; return next; });
    setMediaFiles(prev => {
      const story = prev.find(m => m.id === storyId);
      if (!story) return prev;
      const next = prev.filter(m => m.id !== storyId);
      next.splice(next.findIndex(m => m.id === feedId) + 1, 0, story);
      return next;
    });
  };

  /** Inverte o par: o que estava no Feed vai para Stories e vice-versa. */
  const swapPair = (feedId) => {
    const storyId = storyPairs[feedId];
    if (!storyId) return;
    setStoryPairs(prev => { const next = { ...prev }; delete next[feedId]; next[storyId] = feedId; return next; });
    setMediaFiles(prev => {
      const a = prev.findIndex(m => m.id === feedId);
      const b = prev.findIndex(m => m.id === storyId);
      if (a < 0 || b < 0) return prev;
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    moveCopyOverride(feedId, storyId);
  };

  const removeMedia = (id) => {
    const media = mediaFiles.find(m => m.id === id);
    if (media?.preview) URL.revokeObjectURL(media.preview);
    // Sem o Feed, a versão Stories continua como anúncio e herda o texto próprio.
    if (storyPairs[id]) moveCopyOverride(id, storyPairs[id]);
    else setAdCopyOverrides(prev => { if (!prev[id]) return prev; const next = { ...prev }; delete next[id]; return next; });
    setMediaFiles(prev => prev.filter(m => m.id !== id));
    setStoryPairs(prev => {
      const next = { ...prev };
      delete next[id];
      for (const key of Object.keys(next)) if (next[key] === id) delete next[key];
      return next;
    });
  };

  /** Apaga o anúncio inteiro (Feed e Stories). */
  const removeAd = (unitId) => {
    const storyId = storyPairs[unitId];
    for (const id of [unitId, storyId].filter(Boolean)) {
      const media = mediaFiles.find(m => m.id === id);
      if (media?.preview) URL.revokeObjectURL(media.preview);
    }
    setAdCopyOverrides(prev => { if (!prev[unitId]) return prev; const next = { ...prev }; delete next[unitId]; return next; });
    setMediaFiles(prev => prev.filter(m => m.id !== unitId && m.id !== storyId));
    setStoryPairs(prev => { const next = { ...prev }; delete next[unitId]; return next; });
  };

  const clearAllMedia = () => {
    if (!window.confirm(`Remover as ${mediaFiles.length} mídias do lote?`)) return;
    mediaFiles.forEach(m => m.preview && URL.revokeObjectURL(m.preview));
    splitMediaIds.current.clear();
    setMediaFiles([]);
    setStoryPairs({});
    setAdCopyOverrides({});
    setActiveCopyFileId(null);
  };

  const pushLog = (msg, status = 'loading') => setLogs(prev => [...prev, { id: Date.now() + Math.random(), msg, status }]);
  const updateLastLog = (status) => setLogs(prev => { const c = [...prev]; if (c.length) c[c.length - 1].status = status; return c; });
  const updateLogById = (id, status) => setLogs(prev => prev.map(l => l.id === id ? { ...l, status } : l));

  const handlePublishBatch = async () => {
    const err = tabErrors[3];
    if (err) { setError(err); return; }

    const normalizedAdAccountId = normalizeAdAccountId(accountData.adAccountId);
    if (!normalizedAdAccountId) {
      setError('A conta de anúncios está inválida. Selecione novamente uma conta antes de publicar.');
      setActiveTab(0);
      return;
    }

    // ── Barreiras de conformidade ────────────────────────────────────────────
    // Cada uma corresponde a uma exigência da Meta que, se ignorada, coloca a
    // conta de anúncios em risco. Nenhuma delas tem valor assumido pelo código.
    if (!connection.connected) {
      setError('A agência não está conectada à Meta. Peça a um administrador para conectar em Configurações › APIs.');
      return;
    }
    if (campAction === 'new' && !specialAdCategory) {
      setError('Declare a categoria especial da campanha antes de publicar. Crédito, emprego, moradia, política e apostas têm regras próprias na Meta, e declarar errado restringe a conta.');
      setActiveTab(1);
      return;
    }
    if (createsNewAdSet && regulationScan.status === 'loading') {
      setError('Aguarde um instante: o sistema ainda está buscando o beneficiário e o pagador nos conjuntos da conta.');
      return;
    }

    setIsPublishing(true);
    setPublishDone(false);
    setError(null);
    setRawMetaError('');
    setActiveTab(4);
    setLogs([]);
    setProgress(0);

    // Todo endpoint de criação exige o nó act_<ID>. Sem ele, a Meta interpreta
    // "campaigns" como se fosse um ID de objeto e devolve o erro [100/33].
    const adAccountId = normalizedAdAccountId;
    const selectedBm = bms.find(b => b.id === accountData.bmId);
    const selectedAccount = adAccounts.find(a => normalizeAdAccountId(a.id) === adAccountId);

    // ── Cache SHA-256 ────────────────────────────────────────────────────────
    const UPLOAD_CACHE_KEY = `meta_uploaded_${adAccountId}`;
    const uploadCache = (() => {
      try { return JSON.parse(localStorage.getItem(UPLOAD_CACHE_KEY)) || {}; } catch { return {}; }
    })();
    const saveCache = () => localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(uploadCache));

    const fileHash = async (file) => {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    // ── Semáforo (máx 5 uploads paralelos) ──────────────────────────────────
    const makeSem = (n) => {
      let active = 0;
      const q = [];
      const run = () => {
        if (active >= n || !q.length) return;
        active++;
        const { fn, res, rej } = q.shift();
        fn().then(res).catch(rej).finally(() => { active--; run(); });
      };
      return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); run(); });
    };
    const sem = makeSem(5);
    // Vídeos têm fila própria: cada um sobe em partes de 5 MB, uma depois da
    // outra, e com 6 em paralelo a conexão fica ocupada o tempo todo.
    const videoSem = makeSem(6);
    // Otimização usa a placa de vídeo, que aceita poucas sessões ao mesmo tempo.
    const optimizeSem = makeSem(2);

    // A espera por limite de requisição acontece dentro do cliente da Graph;
    // aqui só mostramos ao operador o que está acontecendo.
    const rateLimitNotice = { onRateLimit: (seconds, code) => pushLog(`⏳ Limite de requisições da Meta (${code}) — aguardando ${seconds}s...`, 'loading') };

    // ── POST simples na Graph API (via servidor) ─────────────────────────────
    const apiPost = async (endpoint, params) => {
      if (!/^act_\d+\/(campaigns|adsets)$/.test(endpoint)) {
        throw new Error(`Endpoint de publicação inválido: ${endpoint}. Selecione novamente a conta de anúncios.`);
      }
      return metaPost(endpoint, params, rateLimitNotice);
    };

    // ── Upload de IMAGEM ─────────────────────────────────────────────────────
    const uploadImage = async (file) => {
      const hash = await metaUploadImage(adAccountId, file, mediaLibraryName(file.name));
      return { type: 'IMAGE', hash };
    };

    // ── Upload de VÍDEO ──────────────────────────────────────────────────────
    // Enviado em partes direto para a Meta pela Edge Function (o token fica no
    // servidor). Sem passar pelo Storage, que no plano gratuito recusa >50 MB.
    const sendVideo = async (file, logPrefix) => {
      const uploadLogId = `video-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      const startedAt = Date.now();
      setLogs(prev => [...prev, { id: uploadLogId, msg: `${logPrefix} Enviando o vídeo (${sizeMb} MB)...`, status: 'loading' }]);
      const onProgress = (fraction) => {
        const pct = Math.round(fraction * 100);
        const seconds = (Date.now() - startedAt) / 1000;
        const speed = seconds > 1 ? ` · ${((file.size * fraction) / 1024 / 1024 / seconds).toFixed(1)} MB/s` : '';
        setLogs(prev => prev.map(l => l.id === uploadLogId ? { ...l, msg: `${logPrefix} Enviando o vídeo (${sizeMb} MB) — ${pct}%${speed}` } : l));
      };

      let videoId;
      try {
        videoId = await metaUploadVideo(adAccountId, file, onProgress);
      } catch (caught) {
        // Uma sessão de upload que caiu no meio não se recupera; abre outra uma vez.
        if (caught instanceof MetaNotConnectedError) {
          updateLogById(uploadLogId, 'error');
          throw caught;
        }
        setLogs(prev => prev.map(l => l.id === uploadLogId ? { ...l, msg: `${logPrefix} Falha no envio, tentando de novo...` } : l));
        try {
          videoId = await metaUploadVideo(adAccountId, file, onProgress);
        } catch (retryError) {
          updateLogById(uploadLogId, 'error');
          throw retryError;
        }
      }
      updateLogById(uploadLogId, 'success');
      return videoId;
    };

    // Vídeo pesado (4K, 60 fps, bitrate alto) encolhe pela placa de vídeo antes de
    // subir, em segundos. Se não compensar ou falhar, sobe o original.
    const prepareVideo = async (file, logPrefix) => {
      if (file.size < OPTIMIZE_MIN_BYTES) return file;
      let logId = null;
      const result = await optimizeSem(() => optimizeForUpload(file, {
        onProgress: (fraction) => {
          const pct = Math.round(fraction * 100);
          if (!logId) {
            logId = `video-opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setLogs(prev => [...prev, { id: logId, msg: `${logPrefix} Otimizando vídeo pesado (${formatMb(file.size)})...`, status: 'loading' }]);
          } else {
            setLogs(prev => prev.map(l => l.id === logId ? { ...l, msg: `${logPrefix} Otimizando vídeo pesado (${formatMb(file.size)}) — ${pct}%` } : l));
          }
        },
      }));
      if (logId) {
        setLogs(prev => prev.map(l => l.id === logId ? {
          ...l,
          status: 'success',
          msg: result.optimized
            ? `${logPrefix} ⚡ Vídeo otimizado: ${formatMb(result.before)} → ${formatMb(result.after)}`
            : `${logPrefix} Otimização não compensou; enviando o original.`,
        } : l));
      }
      return result.file;
    };

    // Depois do envio a Meta ainda processa o vídeo (minutos, em vídeos grandes).
    // Essa espera fica fora da fila de envio para não segurar a vaga de outro vídeo.
    const processVideo = async (videoId, logPrefix) => {
      const statusLogId = `video-status-${videoId}`;
      setLogs(prev => [...prev, { id: statusLogId, msg: `${logPrefix} Meta processando o vídeo...`, status: 'loading' }]);
      try {
        await waitForVideoReady(videoId);
      } catch (caught) {
        updateLogById(statusLogId, 'error');
        throw caught;
      }
      updateLogById(statusLogId, 'success');
      return { type: 'VIDEO', id: videoId };
    };

    // ── Thumbnail (captura frame 0.5s do vídeo) ──────────────────────────────
    const captureThumbnail = async (file) => {
      const thumbName = mediaLibraryName(`${file.name.replace(/\.[^.]+$/, '')}_capa.jpg`);
      const fromVideoElement = () => new Promise((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        const url = URL.createObjectURL(file);
        let settled = false;
        // Sem prazo, um vídeo que o navegador não decodifica deixava a publicação parada.
        const timer = setTimeout(() => finish(null), 15000);
        function finish(blob) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          resolve(blob);
        }
        video.onloadeddata = () => { video.currentTime = Math.min(0.5, (video.duration || 1) / 2); };
        video.onseeked = () => {
          if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.85);
          } catch { finish(null); }
        };
        video.onerror = () => finish(null);
        video.src = url;
      });
      const frame = (await fromVideoElement()) || (await extractVideoFrame(file));
      if (!frame) return null;
      try {
        return await metaUploadImage(adAccountId, frame, thumbName);
      } catch {
        return null;
      }
    };

    // ── Batch item com encoding correto ──────────────────────────────────────
    // CORREÇÃO: body deve ser string URL-encoded manualmente (não URLSearchParams)
    // para garantir que JSON strings dentro dos values sejam encodados corretamente
    // buildBatchItem vem de lib/metaGraph — o corpo é montado igual, mas sem
    // carregar access_token em nenhum item do lote.

    // ── object_story_spec por tipo de mídia ──────────────────────────────────
    const buildStorySpec = ({ uploaded, thumbHash, thumbUrl, isMsgDest, isWhatsApp, isMessenger, isLeadForm, isMultiDest, finalUrl, pageId, igId, copy }) => {

      // ── page_welcome_message: obrigatório para Click to WhatsApp direto ───────
      const pageWelcomeMessage = (isWhatsApp && !isMultiDest) ? {
        type: 'VISUAL_EDITOR',
        version: 2,
        landing_screen_type: 'welcome_message',
        media_type: 'text',
        text_format: {
          customer_action_type: 'autofill_message',
          message: {
            autofill_message: { content: copy.whatsappWelcomeMsg || 'Olá! Gostaria de mais informações.' },
            text: copy.primaryText || 'Olá! Como posso ajudar?',
          },
        },
      } : undefined;

      // ── CTA por destino ──────────────────────────────────────────────────────
      let cta;
      if (isMultiDest && isMsgDest) {
        cta = { type: 'MESSAGE_PAGE', value: {} };
      } else if (isWhatsApp) {
        cta = { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };
      } else if (isMessenger) {
        cta = { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } };
      } else if (isLeadForm) {
        const ctaVal = copy.leadFormId ? { lead_gen_form_id: copy.leadFormId } : {};
        cta = { type: 'SIGN_UP', value: ctaVal };
      } else {
        cta = { type: copy.cta, value: { link: finalUrl } };
      }

      // Campanhas sem destino (Alcance, Reconhecimento…) não têm URL, mas a Meta
      // exige um link no criativo: usa a própria Página do Facebook.
      const pageUrl = `https://www.facebook.com/${pageId}`;
      if (!isMsgDest && !isLeadForm && !finalUrl && cta?.value) cta = { ...cta, value: { link: pageUrl } };

      const spec = { page_id: pageId };
      if (igId) spec.instagram_user_id = igId;

      if (uploaded.type === 'VIDEO') {
        spec.video_data = {
          video_id: uploaded.id,
          message: copy.primaryText,
          title: copy.title,
          call_to_action: cta,
          ...(thumbHash ? { image_hash: thumbHash } : thumbUrl ? { image_url: thumbUrl } : {}),
          ...(pageWelcomeMessage ? { page_welcome_message: JSON.stringify(pageWelcomeMessage) } : {}),
        };
      } else {
        spec.link_data = {
          image_hash: uploaded.hash,
          link: (isWhatsApp || isMessenger || isLeadForm || !finalUrl) ? pageUrl : finalUrl,
          message: copy.primaryText,
          name: copy.title,
          ...(copy.description ? { description: copy.description } : {}),
          call_to_action: cta,
          ...(pageWelcomeMessage ? { page_welcome_message: JSON.stringify(pageWelcomeMessage) } : {}),
        };
      }
      return spec;
    };

    try {
      pushLog(`BM: ${selectedBm?.name || accountData.bmId} · Conta: ${selectedAccount?.name || adAccountId}`, 'success');
      setProgress(5);

      if (!connection.connected) {
        pushLog('MODO DEMONSTRAÇÃO — a agência precisa estar conectada à Meta em Configurações › APIs.', 'error');
        setIsPublishing(false);
        return;
      }

      // ── 1. Campanha ──────────────────────────────────────────────────────────
      let campaignId;
      if (campAction === 'existing') {
        campaignId = campData.existingId;
        const campaignNames = selectedCampaignIds.map(id => apiData.campaigns.find(c => c.id === id)?.name || id);
        pushLog(`Usando ${campaignNames.length > 1 ? `${campaignNames.length} campanhas` : 'campanha'}: ${campaignNames.map(n => `"${n}"`).join(', ')}`, 'success');
        setProgress(15);
      } else {
        pushLog(`Criando campanha: "${campData.name}"...`);
        // A categoria especial é declarada pelo operador na aba Campanha. Antes
        // este campo ia fixo como "[]", o que equivale a declarar à Meta que
        // nenhum anunciante trata de crédito, emprego, moradia ou política.
        const payload = {
          name: campData.name,
          objective: campData.objective,
          status: createAsDraft ? 'DRAFT' : 'PAUSED',
          special_ad_categories: serializeSpecialAdCategories(specialAdCategory),
        };
        pushLog(`Categoria especial declarada: ${specialAdCategoryLabel(specialAdCategory)}`, 'success');
        if (campData.budgetType === 'CBO') {
          payload.daily_budget = String(campData.budget * 100);
        } else {
          payload.is_adset_budget_sharing_enabled = 'false';
        }
        const r = await apiPost(`${adAccountId}/campaigns`, payload);
        campaignId = r.id;
        updateLastLog('success');
        pushLog(`Campanha criada · ID: ${campaignId}`, 'success');
        setProgress(15);
      }

      // ── 2. Conjunto de anúncios ──────────────────────────────────────────────
      // allAdSetIds: multi-select existentes OU array com ID do conjunto novo/único
      let allAdSetIds;
      if (campAction === 'existing' && adSetAction === 'existing' && selectedAdSetIds.length > 0) {
        allAdSetIds = selectedAdSetIds;
        const names = selectedAdSetIds.map(id => existingAdSets.find(a => a.id === id)?.name || id).join(', ');
        pushLog(`Usando ${selectedAdSetIds.length} conjunto(s): ${names}`, 'success');
        setProgress(25);
      } else {
        const effectiveObjective = campaignObjective || campData.objective;
        if (effectiveObjective === 'OUTCOME_SALES' && !adSetData.pixelId) {
          pushLog('⚠️ Sem pixel — conjunto será otimizado por Cliques no Link.', 'success');
        }

        pushLog(`Criando conjunto: "${adSetData.name}"...`);
        const targeting = adSetData.placements === 'ADVANTAGE_PLUS'
          ? { geo_locations: { countries: ['BR'] } }
          : { geo_locations: { countries: ['BR'] }, publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed', 'story', 'facebook_reels'], instagram_positions: ['stream', 'story', 'reels'] };

        const adSetPayload = {
          name: adSetData.name,
          campaign_id: campaignId,
          optimization_goal: adSetData.optimizationGoal,
          billing_event: 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          status: createAsDraft ? 'DRAFT' : 'PAUSED',
          targeting: JSON.stringify(targeting),
        };
        if (campData.budgetType !== 'CBO') adSetPayload.daily_budget = String(adSetData.budget * 100);
        // Beneficiário e pagador (Brasil): o mesmo par que os conjuntos da conta
        // já declaram, ou o que o operador informou. Sem nenhum, segue sem a
        // declaração — se a conta exigir, a Meta recusa e o aviso explica o que fazer.
        if (regulationIds) {
          Object.assign(adSetPayload, brazilRegulationParams(regulationIds));
          const origin = regulationOverride ? 'informado por você' : `copiado do conjunto "${detectedRegulation?.sourceAdSetName}"`;
          pushLog(`Beneficiário ${regulationIds.beneficiaryId || regulationIds.payerId} · pagador ${regulationIds.payerId || regulationIds.beneficiaryId} (${origin})`, 'success');
        } else {
          pushLog('Nenhum conjunto da conta declara beneficiário e pagador — criando sem a declaração.', 'success');
        }

        if (effectiveObjective === 'OUTCOME_SALES') {
          if (adSetData.pixelId) {
            adSetPayload.promoted_object = JSON.stringify({ pixel_id: adSetData.pixelId, custom_event_type: saleConversionEvent });
            adSetPayload.destination_type  = 'WEBSITE';
            adSetPayload.optimization_goal = 'OFFSITE_CONVERSIONS';
          } else {
            // Sem pixel: fallback para cliques (evita erro de promoted_object vazio)
            adSetPayload.optimization_goal = 'LINK_CLICKS';
            adSetPayload.destination_type  = 'WEBSITE';
          }
        } else if (effectiveObjective === 'OUTCOME_LEADS') {
          if (leadDestType === 'INSTANT_FORM') {
            adSetPayload.destination_type   = 'ON_AD';
            adSetPayload.optimization_goal  = 'LEAD_GENERATION';
            adSetPayload.promoted_object    = JSON.stringify({ page_id: accountData.pageId });
          } else if (leadDestType === 'WEBSITE') {
            // LEAD_GENERATION é inválido para WEBSITE — usar goal selecionado pelo usuário
            // com fallback para LINK_CLICKS se ainda estiver no default de formulário
            const VALID_WEBSITE_GOALS = ['LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'OFFSITE_CONVERSIONS'];
            const websiteGoal = VALID_WEBSITE_GOALS.includes(adSetData.optimizationGoal)
              ? adSetData.optimizationGoal
              : 'LINK_CLICKS';
            adSetPayload.destination_type   = 'WEBSITE';
            adSetPayload.optimization_goal  = websiteGoal;
            if (websiteGoal === 'OFFSITE_CONVERSIONS' && adSetData.pixelId) {
              adSetPayload.promoted_object = JSON.stringify({ pixel_id: adSetData.pixelId, custom_event_type: 'LEAD' });
            } else {
              adSetPayload.promoted_object = JSON.stringify({ page_id: accountData.pageId });
            }
          } else if (leadDestType === 'WHATSAPP') {
            adSetPayload.destination_type   = 'WHATSAPP';
            adSetPayload.optimization_goal  = 'CONVERSATIONS';
            adSetPayload.promoted_object    = JSON.stringify({ page_id: accountData.pageId });
          } else if (leadDestType === 'MESSENGER') {
            adSetPayload.destination_type   = 'MESSENGER';
            adSetPayload.optimization_goal  = 'CONVERSATIONS';
            adSetPayload.promoted_object    = JSON.stringify({ page_id: accountData.pageId });
          }
        } else if (effectiveObjective === 'OUTCOME_TRAFFIC') {
          adSetPayload.destination_type = 'WEBSITE';
        } else if (effectiveObjective === 'OUTCOME_ENGAGEMENT') {
          adSetPayload.destination_type = 'WEBSITE';
        }

        const adSetDebugKeys = Object.keys(adSetPayload).join(', ');
        pushLog(`Parâmetros do conjunto: ${adSetDebugKeys}`, 'loading');
        const r = await apiPost(`${adAccountId}/adsets`, adSetPayload);
        allAdSetIds = [r.id];
        updateLastLog('success');
        pushLog(`Conjunto criado · ID: ${r.id}`, 'success');
        setProgress(25);
      }

      // ── Destino de cada conjunto ─────────────────────────────────────────────
      // Com várias campanhas, cada conjunto pode ter destino próprio. O destino
      // define CTA, link e formato do criativo, então é resolvido um a um.
      const usingExistingTargets = campAction === 'existing' && adSetAction === 'existing' && allAdSetIds.length > 0;
      const resolveAdSetDestination = async (adSetId) => {
        if (!usingExistingTargets) return { destType: 'WEBSITE', promotedObject: null, isMultiDest: false };
        const cached = existingAdSets.find(a => a.id === adSetId);
        const info = await metaGet(adSetId, { fields: 'destination_type,promoted_object,optimization_goal' }, rateLimitNotice).catch(() => ({}));
        // "UNDEFINED" com conversão no site é conjunto de site comum; só os de
        // mensagens sem destino declarado são multi-destino.
        const { destType, isMultiDest } = classifyAdSetDestination(
          info.destination_type || cached?.destination_type,
          info.optimization_goal || cached?.optimization_goal,
        );
        return { destType, promotedObject: info.promoted_object || null, isMultiDest };
      };

      const targets = [];
      for (const adSetId of allAdSetIds) {
        const name = existingAdSets.find(a => a.id === adSetId)?.name || (allAdSetIds.length === 1 ? adSetData.name : adSetId);
        const dest = await resolveAdSetDestination(adSetId);
        targets.push({ adSetId, name, ...dest });
      }
      const destTypes = [...new Set(targets.map(t => `${t.destType}${t.isMultiDest ? ' (multi-destino)' : ''}`))];
      pushLog(`Destino ${targets.length > 1 ? 'dos conjuntos' : 'do conjunto'}: ${destTypes.join(', ')}`, 'success');

      const effectiveObjPub = campaignObjective || campData.objective;
      const destFlags = (destType) => {
        const isWhatsApp  = destType === 'WHATSAPP'  || (forceMessagesDest && destType !== 'MESSENGER' && destType !== 'INSTAGRAM_DIRECT');
        const isMessenger = destType === 'MESSENGER' || (forceMessagesDest && destType === 'MESSENGER');
        const isMsgDest   = isWhatsApp || isMessenger || destType === 'INSTAGRAM_DIRECT' || forceMessagesDest;
        const isLeadForm  = (effectiveObjPub === 'OUTCOME_LEADS' && leadDestType === 'INSTANT_FORM') || destType === 'ON_AD';
        return { isWhatsApp, isMessenger, isMsgDest, isLeadForm };
      };
      const objLabels = { OUTCOME_TRAFFIC: '🚦 Tráfego', OUTCOME_LEADS: '📋 Leads', OUTCOME_SALES: '🛒 Vendas', OUTCOME_ENGAGEMENT: '💬 Engajamento' };
      pushLog(`Objetivo: ${objLabels[effectiveObjPub] || effectiveObjPub}`, 'success');

      // ── 3. Upload de mídias em paralelo ──────────────────────────────────────
      const units = adUnits.map((media, i) => ({ media, story: storyOf(media.id), adName: resolveAdName(adsData.namingPattern, i + 1) }));
      const pairedCount = units.filter(u => u.story).length;
      pushLog(`Enviando ${mediaFiles.length} mídia(s) em paralelo (até 6 vídeos ao mesmo tempo)${pairedCount ? ` · ${pairedCount} anúncio(s) com versão Feed + Stories` : ''}...`);

      const uploadResults = await Promise.all(mediaFiles.map(async (media, i) => {
        const logPrefix = `[${i + 1}/${mediaFiles.length}]`;
        const logId = `up-${i}`;
        setLogs(prev => [...prev, { id: logId, msg: `${logPrefix} Enviando: ${media.file.name}...`, status: 'loading' }]);
        try {
          // Vídeos nunca são reutilizados do cache (um ID pode continuar consultável
          // mesmo depois de a Meta marcar o criativo WITH_ISSUES), então nem é
          // preciso ler o arquivo inteiro para calcular o hash: com vários vídeos
          // grandes em paralelo isso estourava a memória do navegador.
          const hash = media.type === 'VIDEO' ? null : await fileHash(media.file);
          const thumbCacheKey = `${hash}_thumb`;
          if (hash && uploadCache[hash]) {
            const thumbHash = uploadCache[thumbCacheKey] || null;
            updateLogById(logId, 'success');
            pushLog(`${logPrefix} ♻️ Reutilizando (${media.file.name})`, 'success');
            return { uploaded: uploadCache[hash], thumbHash, fileId: media.id };
          }
          const [uploaded, thumbHash] = await Promise.all([
            media.type === 'IMAGE'
              ? sem(() => uploadImage(media.file))
              : prepareVideo(media.file, logPrefix)
                .then((file) => videoSem(() => sendVideo(file, logPrefix)))
                .then((videoId) => processVideo(videoId, logPrefix)),
            media.type === 'VIDEO' ? sem(() => captureThumbnail(media.file)) : Promise.resolve(null),
          ]);
          // Sem capa própria, usa a que a Meta gerou ao processar o vídeo.
          let thumbUrl = null;
          if (media.type === 'VIDEO' && !thumbHash) {
            thumbUrl = await metaVideoThumbnailUrl(uploaded.id);
            if (!thumbUrl) throw new Error(`Não foi possível obter a capa do vídeo: ${media.file.name}`);
            pushLog(`${logPrefix} Capa gerada pela Meta.`, 'success');
          }
          if (hash) {
            uploadCache[hash] = uploaded;
            if (thumbHash) uploadCache[thumbCacheKey] = thumbHash;
            saveCache();
          }
          updateLogById(logId, 'success');
          setProgress(prev => Math.min(prev + Math.round(55 / mediaFiles.length), 80));
          return { uploaded, thumbHash, thumbUrl, fileId: media.id };
        } catch (e) {
          updateLogById(logId, 'error');
          throw e;
        }
      }));
      const uploadedById = new Map(uploadResults.map(r => [r.fileId, r]));

      // ── 4. Criativos (um por mídia e conjunto; iguais são reaproveitados) ───
      const resolveCopy = (fileId) => individualCopyMode ? {
        primaryText:      adCopyOverrides[fileId]?.primaryText      ?? adsData.primaryText,
        title:            adCopyOverrides[fileId]?.title             ?? adsData.title,
        description:      adCopyOverrides[fileId]?.description       ?? adsData.description,
        cta:              adCopyOverrides[fileId]?.cta               ?? adsData.cta,
        link:             adCopyOverrides[fileId]?.link              ?? adsData.link,
        utmTags:          adCopyOverrides[fileId]?.utmTags           ?? adsData.utmTags,
        whatsappWelcomeMsg: adCopyOverrides[fileId]?.whatsappWelcomeMsg ?? adsData.whatsappWelcomeMsg,
        leadFormId:       adCopyOverrides[fileId]?.leadFormId        ?? adsData.leadFormId,
      } : adsData;

      // Opções de texto: texto próprio do anúncio vale sozinho; senão, as
      // opções globais (até 5 de cada).
      const optionsFor = (fileId) => {
        const override = individualCopyMode ? adCopyOverrides[fileId] || {} : {};
        const pick = (field) => (override[field] !== undefined ? textOptions([override[field]]) : globalTextOptions[OPTION_KEYS[field]]);
        return { primaryTexts: pick('primaryText'), titles: pick('title'), descriptions: pick('description') };
      };

      // Herança: o que o conjunto já usa tem prioridade sobre a copy digitada.
      const copyFor = (target, fileId) => {
        const base = { ...resolveCopy(fileId), inheritedUrlTags: '', options: optionsFor(fileId) };
        const inherited = inheritanceFor(target.adSetId)?.data;
        if (!inherited) return base;
        const inheritedOptions = inherited.options || { primaryTexts: [], titles: [], descriptions: [] };
        return {
          ...base,
          ...(inheritCopy ? {
            primaryText: inherited.primaryText || base.primaryText,
            title: inherited.title || base.title,
            description: inherited.description || base.description,
            cta: inherited.cta || base.cta,
            options: {
              primaryTexts: inheritedOptions.primaryTexts.length ? inheritedOptions.primaryTexts : base.options.primaryTexts,
              titles: inheritedOptions.titles.length ? inheritedOptions.titles : base.options.titles,
              descriptions: inheritedOptions.descriptions.length ? inheritedOptions.descriptions : base.options.descriptions,
            },
          } : {}),
          ...(inheritUrl && inherited.link ? { link: inherited.link, utmTags: '', inheritedUrlTags: inherited.urlTags || '' } : {}),
        };
      };

      const originalMediaFeatures = (type) => type === 'VIDEO'
        ? {
            advantage_plus_creative: { enroll_status: 'OPT_OUT' },
            video_auto_crop: { enroll_status: 'OPT_OUT' },
            video_uncrop: { enroll_status: 'OPT_OUT' },
          }
        : {
            advantage_plus_creative: { enroll_status: 'OPT_OUT' },
            image_uncrop: { enroll_status: 'OPT_OUT' },
            image_touchups: { enroll_status: 'OPT_OUT' },
          };

      const storyWarnings = new Set();
      const singleTextWarnings = new Map(); // conjunto → motivo de ir só a 1ª opção de texto
      // Devolve os parâmetros do criativo e, quando ele leva várias opções de
      // texto, a versão com só a 1ª opção: se a Meta recusar as opções, essa
      // versão entra no lugar e o anúncio sai mesmo assim.
      const buildCreativeParams = (target, unit) => {
        const flags = destFlags(target.destType);
        const copy = copyFor(target, unit.media.id);
        const perFileFinalUrl = (flags.isMsgDest || !needsUrl) ? '' : (copy.link + (copy.utmTags || ''));
        const feedUp = uploadedById.get(unit.media.id);
        const storyUp = unit.story ? uploadedById.get(unit.story.id) : null;
        const asset = (up) => ({ videoId: up.uploaded.id, hash: up.uploaded.hash, thumbHash: up.thumbHash, thumbUrl: up.thumbUrl });
        const identity = { page_id: accountData.pageId, ...(adSetData.igId ? { instagram_user_id: adSetData.igId } : {}) };
        // Feed + Stories no mesmo anúncio só funciona com destino site: a Meta
        // aceita um único link_urls e não suporta CTA de mensagem/formulário aqui.
        const siteDestination = Boolean(perFileFinalUrl && !flags.isMsgDest && !flags.isLeadForm && !target.isMultiDest);
        const canUsePlacements = Boolean(storyUp && siteDestination);
        if (storyUp && !canUsePlacements) storyWarnings.add(target.name);
        const multiText = hasTextVariations(copy.options);
        if (multiText && canUsePlacements) singleTextWarnings.set(target.name, 'anúncios com Feed + Stories aceitam uma opção de cada texto');
        else if (multiText && !siteDestination) singleTextWarnings.set(target.name, 'opções de texto só valem para destino site');

        const finish = (params) => {
          if (target.isMultiDest || preserveOriginalMedia) {
            params.degrees_of_freedom_spec = JSON.stringify({ creative_features_spec: preserveOriginalMedia ? originalMediaFeatures(feedUp.uploaded.type) : {} });
          }
          if (copy.inheritedUrlTags) params.url_tags = copy.inheritedUrlTags;
          return params;
        };
        const singleText = () => finish({
          object_story_spec: JSON.stringify(buildStorySpec({
            uploaded: feedUp.uploaded, thumbHash: feedUp.thumbHash, thumbUrl: feedUp.thumbUrl, ...flags,
            isMultiDest: target.isMultiDest, finalUrl: perFileFinalUrl, pageId: accountData.pageId,
            igId: adSetData.igId || '', copy,
          })),
        });

        if (canUsePlacements) {
          return {
            params: finish({
              object_story_spec: JSON.stringify(identity),
              asset_feed_spec: JSON.stringify(buildPlacementAssetFeedSpec({
                mediaType: feedUp.uploaded.type,
                feed: asset(feedUp),
                story: asset(storyUp),
                copy,
                link: perFileFinalUrl,
              })),
            }),
            fallback: null,
          };
        }
        if (multiText && siteDestination) {
          return {
            params: finish({
              object_story_spec: JSON.stringify(identity),
              asset_feed_spec: JSON.stringify(buildTextOptionsAssetFeedSpec({
                mediaType: feedUp.uploaded.type,
                asset: asset(feedUp),
                options: copy.options,
                cta: copy.cta,
                link: perFileFinalUrl,
              })),
            }),
            fallback: singleText(),
          };
        }
        return { params: singleText(), fallback: null };
      };

      const uniqueCreatives = [];           // [{ params, fallback }]
      const creativeIndexByKey = new Map(); // conteúdo → índice (dedupe)
      const plan = targets.map(target => ({
        target,
        items: units.map((unit) => {
          const { params, fallback } = buildCreativeParams(target, unit);
          const key = JSON.stringify(params);
          if (!creativeIndexByKey.has(key)) {
            creativeIndexByKey.set(key, uniqueCreatives.length);
            const suffix = inheritActive && targets.length > 1 ? ` · ${String(target.name).slice(0, 60)}` : '';
            const name = `Creative - ${unit.adName}${suffix}`;
            uniqueCreatives.push({ params: { name, ...params }, fallback: fallback ? { name, ...fallback } : null });
          }
          return { unit, creativeIndex: creativeIndexByKey.get(key) };
        }),
      }));
      for (const name of storyWarnings) {
        pushLog(`⚠️ "${name}": Feed + Stories precisa de destino site com URL (este conjunto é de mensagens, formulário ou multi-destino) — publicada só a versão de feed.`, 'error');
      }
      for (const [name, reason] of singleTextWarnings) {
        pushLog(`ℹ️ "${name}": ${reason} — vai a 1ª opção de texto, título e descrição.`, 'success');
      }
      const textOptionCreatives = uniqueCreatives.filter(c => c.fallback).length;
      if (textOptionCreatives > 0) {
        pushLog(`${textOptionCreatives} criativo(s) com várias opções de texto: a Meta testa as combinações e entrega a melhor para cada pessoa.`, 'success');
      }
      if (inheritActive) {
        const inheritedCount = targets.filter(t => inheritanceFor(t.adSetId)?.data).length;
        pushLog(`Herança: ${inheritedCount}/${targets.length} conjunto(s) com ${[inheritUrl && 'URL', inheritCopy && 'copy'].filter(Boolean).join(' e ')} dos anúncios que já rodam.`, 'success');
      }

      const creativesLogId = 'creatives-batch';
      setLogs(prev => [...prev, { id: creativesLogId, msg: `Criando ${uniqueCreatives.length} criativo(s) via Batch API...`, status: 'loading' }]);
      const creativeIds = [];
      const readBatchBody = (item) => { try { return JSON.parse(item.body || '{}'); } catch { return {}; } };
      const batchErrorText = (item, body) => `${body.error?.error_user_msg || body.error?.message || `HTTP ${item.code}`} | Subcode: ${body.error?.error_subcode || 'N/A'}`;
      for (let start = 0; start < uniqueCreatives.length; start += 50) {
        const chunk = uniqueCreatives.slice(start, start + 50);
        const batchCreativeRes = await metaBatch(chunk.map(c => buildBatchItem(`${adAccountId}/adcreatives`, c.params)), rateLimitNotice);
        const retry = []; // { index, reason }
        for (let i = 0; i < batchCreativeRes.length; i++) {
          const body = readBatchBody(batchCreativeRes[i]);
          if (batchCreativeRes[i].code !== 200 || body.error) {
            if (!chunk[i].fallback) {
              updateLogById(creativesLogId, 'error');
              throw new Error(`Criativo [${start + i + 1}]: ${batchErrorText(batchCreativeRes[i], body)}`);
            }
            retry.push({ index: i, reason: batchErrorText(batchCreativeRes[i], body) });
            continue;
          }
          creativeIds[start + i] = body.id;
        }
        if (retry.length > 0) {
          pushLog(`⚠️ A Meta não aceitou as opções de texto em ${retry.length} criativo(s) (${retry[0].reason}). Refazendo com a 1ª opção...`, 'error');
          const retryRes = await metaBatch(retry.map(r => buildBatchItem(`${adAccountId}/adcreatives`, chunk[r.index].fallback)), rateLimitNotice);
          retryRes.forEach((item, k) => {
            const body = readBatchBody(item);
            if (item.code !== 200 || body.error) {
              updateLogById(creativesLogId, 'error');
              throw new Error(`Criativo [${start + retry[k].index + 1}]: ${batchErrorText(item, body)}`);
            }
            creativeIds[start + retry[k].index] = body.id;
          });
        }
      }
      updateLogById(creativesLogId, 'success');
      setProgress(90);

      // ── 5. Batch: anúncios (loop por conjunto) ───────────────────────────────
      let totalCreated = 0;
      const createdAdIdsByMedia = new Map();
      for (let si = 0; si < plan.length; si++) {
        const { target, items } = plan[si];
        const currentAdSetId = target.adSetId;
        const currentAdSetName = target.name;
        const adsLogId = `ads-batch-${si}`;
        setLogs(prev => [...prev, { id: adsLogId, msg: `Criando ${items.length} anúncio(s) no conjunto "${currentAdSetName}" (${si + 1}/${plan.length})...`, status: 'loading' }]);

        // tracking_specs obrigatório quando o conjunto usa pixel (evita erro 2446493)
        const pixelId = target.promotedObject?.pixel_id;
        const trackingSpecs = pixelId
          ? JSON.stringify([{ 'action.type': ['offsite_conversion'], fb_pixel: [pixelId] }])
          : null;

        const adsBatch = items.map(({ unit, creativeIndex }) =>
          buildBatchItem(`${adAccountId}/ads`, {
            name: unit.adName,
            adset_id: currentAdSetId,
            creative: JSON.stringify({ creative_id: creativeIds[creativeIndex] }),
            status: createAsDraft ? 'DRAFT' : 'PAUSED',
            ...(trackingSpecs ? { tracking_specs: trackingSpecs } : {}),
          })
        );

        const batchAdsRes = await metaBatch(adsBatch, rateLimitNotice);

        let okCount = 0;
        for (let adIndex = 0; adIndex < batchAdsRes.length; adIndex++) {
          const item = batchAdsRes[adIndex];
          let body;
          try { body = JSON.parse(item.body || '{}'); } catch { body = {}; }
          if (item.code !== 200 || body.error) {
            const errDetail = body.error?.error_user_msg || body.error?.message || 'sem detalhe';
            const errSub = body.error?.error_subcode || 'N/A';
            pushLog(`Anúncio falhou [HTTP ${item.code}]: ${errDetail} (sub: ${errSub})`, 'error');
          } else {
            okCount++;
            if (body.id) {
              const ids = createdAdIdsByMedia.get(adIndex) || [];
              ids.push(body.id);
              createdAdIdsByMedia.set(adIndex, ids);
            }
          }
        }
        // Detect advertiser verification error in batch items
        const verifItem = batchAdsRes.find(item => {
          try {
            const b = JSON.parse(item.body || '{}');
            return b.error?.code === 100 && b.error?.error_subcode === 3858634;
          } catch { return false; }
        });
        if (verifItem) {
          const verifBody = JSON.parse(verifItem.body || '{}');
          const verifRaw = verifBody.error?.error_user_msg || verifBody.error?.message || '';
          setRawMetaError(`[Código ${verifBody.error?.code}] ${verifRaw}`);
          pushLog('⚠️ Erro de verificação de anunciante — veja o card de ajuda abaixo.', 'error');
          setError('ADVERTISER_VERIFICATION');
        }
        updateLogById(adsLogId, okCount > 0 ? 'success' : 'error');
        pushLog(`${okCount > 0 ? '✅' : '❌'} ${okCount}/${items.length} anúncio(s) criado(s) em "${currentAdSetName}"`, okCount > 0 ? 'success' : 'error');
        totalCreated += okCount;
      }

      setProgress(100);
      if (totalCreated === 0) {
        throw new Error(`Nenhum anúncio foi criado (0/${units.length * plan.length}). Veja os erros acima para detalhes.`);
      }
      if (adsData.utmTags) pushLog('UTM tags aplicadas em todos os anúncios.', 'success');
      pushLog(`✅ ${totalCreated} anúncio(s) no total (${plan.length} conjunto(s)) — todos ${createAsDraft ? 'RASCUNHO' : 'PAUSADOS'}.`, 'success');
      pushLog(createAsDraft ? 'Rascunhos salvos. Revise e publique no Gerenciador de Anúncios.' : 'Revise e ative no Gerenciador de Anúncios quando pronto.', 'success');
      setPublishDone(true);

      // ── Salvar no histórico ──────────────────────────────────────────────────
      const historyEntry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        clientName: clientInfo.name || card.clientId,
        cardTitle: card.title,
        campaignName: campAction === 'existing'
          ? selectedCampaignIds.map(id => apiData.campaigns.find(c => c.id === id)?.name || id).join(' · ')
          : campData.name,
        bmId:          accountData.bmId,
        bmName:        bms.find(b => b.id === accountData.bmId)?.name || '',
        adAccountId:   accountData.adAccountId,
        adAccountName: adAccounts.find(a => a.id === accountData.adAccountId)?.name || '',
        pageId:        accountData.pageId,
        pageName:      apiData.pages.find(p => p.id === accountData.pageId)?.name || '',
        reuseConfig: {
          accountData, campAction, campData, adSetAction, selectedCampaignIds, selectedAdSetIds, adSetData,
          adsData, forceMessagesDest, leadDestType, saleConversionEvent,
          individualCopyMode, adCopyOverrides, preserveOriginalMedia, inheritUrl, inheritCopy,
        },
        ads: units.map((unit, i) => {
          const copy = plan[0] ? copyFor(plan[0].target, unit.media.id) : resolveCopy(unit.media.id);
          return {
            adName: unit.adName,
            primaryText: copy.primaryText,
            title: copy.title,
            description: copy.description,
            link: copy.link,
            fileName: unit.story ? `${unit.media.file.name} + ${unit.story.file.name} (Stories)` : unit.media.file.name,
            mediaType: unit.media.type,
            thumbnailBase64: unit.media.thumbnailBase64 || null,
            metaCreativeId: plan[0] ? creativeIds[plan[0].items[i].creativeIndex] || '' : '',
            metaAdIds: createdAdIdsByMedia.get(i) || [],
          };
        }),
      };
      setAdHistory(prev => {
        const updated = [historyEntry, ...prev];
        try {
          localStorage.setItem('meta_ad_history', JSON.stringify(updated));
        } catch {
          // Quota excedida: salva sem thumbnails para garantir que os dados sejam persistidos
          const stripped = updated.map(e => ({
            ...e,
            ads: e.ads.map(a => ({ ...a, thumbnailBase64: null })),
          }));
          try { localStorage.setItem('meta_ad_history', JSON.stringify(stripped)); } catch { /* ignora */ }
        }
        return updated;
      });

    } catch (err) {
      updateLastLog('error');
      const msg = err.message || 'Erro desconhecido na Graph API.';
      const lowerMsg = msg.toLowerCase();
      const isVerificationErr =
        msg.includes('3858634') ||
        ['regional_regulat', 'beneficiary', 'payer', 'beneficiári', 'pagador', 'anunciante verificado'].some(term => lowerMsg.includes(term));
      pushLog(`ERRO: ${msg}`, 'error');
      if (isVerificationErr) {
        setRawMetaError(msg);
        setError('ADVERTISER_VERIFICATION');
      } else {
        setError(msg);
      }
    } finally {
      setIsPublishing(false);
    }
  };

  // ─── Tela de Publicação (Logs) ────────────────────────────────────────────────
  if (activeTab === 4) {
    const currentLog = [...logs].reverse().find(l => l.status === 'loading') || logs[logs.length - 1];
    const barColor = error ? '#ef4444' : progress === 100 ? '#10b981' : 'linear-gradient(90deg, #1877F2, #10b981)';

    return (
      <div
        className="modal-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          background: 'rgba(2, 6, 23, 0.82)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <div style={{ width: '520px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}>

          {/* Header */}
          <div style={{ padding: '20px 24px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isPublishing
              ? <Loader2 size={20} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
              : error ? <AlertCircle size={20} color="#ef4444" />
              : <CheckCircle size={20} color="#10b981" />}
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)' }}>
              {isPublishing ? 'Publicando...' : error ? 'Erro na publicação' : 'Campanha Enviada!'}
            </h2>
            <span style={{ marginLeft: 'auto', fontSize: '15px', fontWeight: '800', color: error ? '#ef4444' : progress === 100 ? '#10b981' : 'var(--primary)' }}>
              {progress}%
            </span>
          </div>

          {/* Barra de progresso */}
          <div style={{ height: '5px', background: 'var(--border-light)' }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: barColor,
              transition: 'width 0.5s ease',
              borderRadius: '0 3px 3px 0',
            }} />
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '200px' }}>
            {/* Etapa atual */}
            {isPublishing && currentLog && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(24,119,242,0.06)', borderRadius: '8px', border: '1px solid rgba(24,119,242,0.15)' }}>
                <Loader2 size={15} color="var(--primary)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)' }}>{currentLog.msg}</span>
              </div>
            )}

            {/* Erro */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#ef4444' }}>Erro da Meta API</span>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: '#ef4444', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mensagem completa</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-main)', fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word', userSelect: 'all' }}>
                    {error === 'ADVERTISER_VERIFICATION' ? rawMetaError : error}
                  </div>
                </div>
                {(error === 'ADVERTISER_VERIFICATION' || (error + rawMetaError).toLowerCase().includes('verif')) && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    A Meta pediu o <strong style={{ color: 'var(--text-main)' }}>beneficiário e o pagador</strong> do conjunto. O jeito mais rápido: crie <strong style={{ color: 'var(--text-main)' }}>um</strong> conjunto nesta conta pelo Gerenciador de Anúncios (lá a Meta pede para escolher os dois). A partir daí o sistema copia sozinho em todo conjunto novo. Outra opção é publicar em um conjunto que já existe — ele já tem a declaração.
                  </div>
                )}
                <button
                  onClick={() => navigator.clipboard?.writeText(error === 'ADVERTISER_VERIFICATION' ? rawMetaError : error).catch(() => {})}
                  style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                >
                  Copiar erro
                </button>
              </div>
            )}

            {/* Log compacto (só sucesso/erro) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '200px', overflowY: 'auto' }}>
              {logs.filter(l => l.status === 'success' || l.status === 'error').map(log => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px' }}>
                  {log.status === 'success'
                    ? <CheckCircle size={13} color="#10b981" style={{ flexShrink: 0, marginTop: '1px' }} />
                    : <AlertCircle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />}
                  <span style={{ color: log.status === 'error' ? '#ef4444' : 'var(--text-muted)', fontWeight: '500' }}>{log.msg}</span>
                </div>
              ))}
            </div>
          </div>

          {publishDone && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-muted)', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                Fechar
              </button>
              <button onClick={onComplete} style={{ padding: '10px 24px', borderRadius: '8px', background: 'linear-gradient(135deg, #1877F2, #0056d6)', color: 'white', border: 'none', fontWeight: '700', cursor: 'pointer', fontSize: '14px', boxShadow: '0 4px 12px rgba(24,119,242,0.3)' }}>
                ✓ Finalizar
              </button>
            </div>
          )}
          {!publishDone && !isPublishing && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-light)' }}>
              <button onClick={() => setActiveTab(3)} style={{ padding: '10px 20px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-muted)', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                ← Voltar
              </button>
            </div>
          )}
        </div>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─── Input helper ─────────────────────────────────────────────────────────────
  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{ width: activeTab === 3 ? '1280px' : '820px', maxWidth: '97vw', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 48px rgba(0,0,0,0.5)', height: '90vh', transition: 'width 0.25s ease' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: 'linear-gradient(135deg, #1877F2, #0056d6)', padding: '8px', borderRadius: '10px', color: 'white', flexShrink: 0 }}>
              <Database size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', lineHeight: 1.2 }}>Meta Ad Creator</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Configuração e publicação de anúncios
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isDemoMode && (
              <span style={{ fontSize: '11px', fontWeight: '700', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(245,158,11,0.3)' }}>
                MODO DEMO
              </span>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Demo banner */}
        {isDemoMode && (
          <div style={{ padding: '10px 24px', background: 'rgba(245,158,11,0.07)', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={14} color="#f59e0b" />
            <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600' }}>
              {connection.message
                ? <>Modo demonstração — {connection.message}</>
                : <>Modo demonstração — a agência ainda não está conectada à Meta. Um administrador precisa conectar em <strong>Configurações › APIs › Meta Ads</strong>, com login da Meta ou token geral da agência. O token por projeto serve só para métricas e não publica.</>}
            </span>
          </div>
        )}

        {/* Rascunho disponivel */}
        {hasDraft && (
          <div style={{ padding: '10px 24px', background: 'rgba(16,185,129,0.07)', borderBottom: '1px solid rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CheckCircle size={14} color="#10b981" />
            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '600', flex: 1 }}>
              Rascunho salvo — restaure para continuar de onde parou.
            </span>
            <button onClick={restoreDraft} style={{ fontSize: '12px', fontWeight: '700', color: '#10b981', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>
              Restaurar
            </button>
            <button onClick={clearDraft} style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
              Descartar
            </button>
          </div>
        )}

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* Sidebar de abas */}
          <div style={{ width: '210px', flexShrink: 0, backgroundColor: 'var(--bg-surface)', borderRight: '1px solid var(--border-light)', padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {['0. Conta & BM', '1. Campanha', '2. Conjunto de Anúncios', '3. Criativos (Lote)'].map((t, i) => (
              <button
                key={i}
                onClick={() => { setError(null); setActiveTab(i); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '11px 12px', borderRadius: '8px',
                  fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer',
                  background: activeTab === i ? 'rgba(16,185,129,0.1)' : 'transparent',
                  color: activeTab === i ? 'var(--primary)' : 'var(--text-muted)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <span>{t}</span>
                {activeTab > i && activeTab !== 5 && activeTab !== 6 && !tabErrors[i] && <CheckCircle size={14} color="#10b981" />}
              </button>
            ))}

            {activeTab === 3 && adUnits.length > 0 && (
              <div style={{ padding: '14px', background: 'var(--bg-app)', border: '1px solid var(--primary)', borderRadius: '10px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>Resumo</div>
                <div style={{ fontSize: '18px', color: 'var(--primary)', fontWeight: '800' }}>{adUnits.length} ad{adUnits.length > 1 ? 's' : ''}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-main)', marginTop: '2px' }}>{usingExistingAdSet && selectedAdSetIds.length > 1 ? `em cada um dos ${selectedAdSetIds.length} conjuntos` : 'prontos para publicar'}</div>
                {pairedStoryIds.size > 0 && <div style={{ fontSize: '11px', color: '#c4b5fd', marginTop: '4px' }}>{pairedStoryIds.size} com Feed + Stories</div>}
              </div>
            )}

            <div style={{ marginTop: 'auto' }}>
              <button
                onClick={() => { setConfigError(''); setActiveTab(6); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '11px 12px', borderRadius: '8px',
                  fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer',
                  background: activeTab === 6 ? 'rgba(47,128,255,0.12)' : 'transparent',
                  color: activeTab === 6 ? '#2f80ff' : 'var(--text-muted)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings size={14} /> Conexão com a Meta
                </span>
                {connection.connected && <CheckCircle size={13} color="#10b981" />}
              </button>
              <div style={{ height: '1px', background: 'var(--border-light)', margin: '8px 0' }} />
              <button
                onClick={() => { setError(null); setActiveTab(5); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '11px 12px', borderRadius: '8px',
                  fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer',
                  background: activeTab === 5 ? 'rgba(16,185,129,0.1)' : 'transparent',
                  color: activeTab === 5 ? '#10b981' : 'var(--text-muted)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={14} /> Histórico
                </span>
                {adHistory.length > 0 && (
                  <span style={{ fontSize: '11px', fontWeight: '800', background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '2px 7px', borderRadius: '10px' }}>
                    {adHistory.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Conteúdo */}
          <div style={{ flex: 1, padding: activeTab === 3 ? '16px' : '28px', overflowY: activeTab === 3 ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

            {/* ── ABA 6: Configuração da Meta ── */}
            {activeTab === 6 && (() => {
              const visibleAccounts = configAssets.accounts.filter(account =>
                configBmId === '__direct__' ? !account.business?.id : account.business?.id === configBmId
              );
              const fieldStyle = {
                width: '100%', padding: '11px 13px', borderRadius: '8px',
                border: '1px solid var(--border-main)', background: 'var(--bg-surface)',
                color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
              };
              const labelStyle = {
                display: 'block', marginBottom: '6px', fontSize: '11px', fontWeight: '800',
                color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
              };
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '620px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: 'var(--text-main)' }}>Conexão com a Meta</h3>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                      A credencial da agência fica guardada no servidor e nunca passa por este navegador. Aqui você recarrega as contas, páginas e Business Managers disponíveis.
                    </p>
                  </div>

                  <div style={{ padding: '16px', border: '1px solid var(--border-light)', borderRadius: '12px', background: 'var(--bg-surface)' }}>
                    <label style={labelStyle}>Status da conexão</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 11px', borderRadius: '7px',
                        fontSize: '12px', fontWeight: '800',
                        background: connection.connected ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
                        color: connection.connected ? '#10b981' : '#ef4444',
                        border: `1px solid ${connection.connected ? 'rgba(16,185,129,0.32)' : 'rgba(239,68,68,0.32)'}`,
                      }}>
                        {connection.connected ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                        {connection.connected ? `Conectada${connection.name ? ` — ${connection.name}` : ''}` : 'Sem conexão ativa'}
                      </span>
                      <button
                        type="button"
                        onClick={loadMetaConfiguration}
                        disabled={configLoading}
                        style={{
                          minWidth: '170px', padding: '10px 15px', borderRadius: '8px', border: 'none',
                          background: configLoading ? 'var(--border-main)' : 'linear-gradient(135deg, #2f80ff, #06b6d4)',
                          color: 'white', fontSize: '12px', fontWeight: '800', cursor: configLoading ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                        }}
                      >
                        {configLoading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Consultando...</> : <><RotateCcw size={14} /> Recarregar contas</>}
                      </button>
                    </div>
                    <p style={{ margin: '9px 0 0', fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      Quem conecta ou reconecta a agência é um administrador, em Configurações › APIs › Meta Ads. Nenhum token é digitado ou guardado aqui — é o que mantém a ferramenta dentro das regras da Meta.
                    </p>
                  </div>

                  {configError && (
                    <div style={{ padding: '11px 13px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertCircle size={14} /> {configError}
                    </div>
                  )}

                  {configProfile && (
                    <>
                      <div style={{ padding: '11px 13px', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.08)', color: '#10b981', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle size={14} /> Conectado como {configProfile.name}
                      </div>

                      <div aria-hidden="true" style={{ display: 'none' }}>
                        <div>
                          <label style={labelStyle}>Business Manager</label>
                          <select
                            value={configBmId}
                            onChange={event => {
                              const nextBm = event.target.value;
                              const nextAccounts = configAssets.accounts.filter(account => nextBm === '__direct__' ? !account.business?.id : account.business?.id === nextBm);
                              setConfigBmId(nextBm);
                              setConfigAccountId(nextAccounts[0]?.id || '');
                            }}
                            style={fieldStyle}
                          >
                            {configAssets.bms.length === 0 && <option value="">Nenhuma BM disponível</option>}
                            {configAssets.bms.map(bm => <option key={bm.id} value={bm.id}>{bm.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Conta de anúncios</label>
                          <select value={configAccountId} onChange={event => setConfigAccountId(event.target.value)} style={fieldStyle}>
                            {visibleAccounts.length === 0 && <option value="">Nenhuma conta nesta BM</option>}
                            {visibleAccounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.id}</option>)}
                          </select>
                        </div>
                      </div>

                      <div aria-hidden="true" style={{ display: 'none' }}>
                        <label style={labelStyle}>Página do Facebook</label>
                        <select value={configPageId} onChange={event => setConfigPageId(event.target.value)} style={fieldStyle}>
                          {configAssets.pages.length === 0 && <option value="">Nenhuma página disponível</option>}
                          {configAssets.pages.map(page => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}
                        </select>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={saveMetaConfiguration}
                          disabled={!configProfile}
                          style={{
                            padding: '11px 20px', borderRadius: '8px', border: 'none',
                            background: configSaved ? '#10b981' : 'linear-gradient(135deg, #2f80ff, #0063d8)',
                            color: 'white', fontSize: '13px', fontWeight: '800', cursor: !configAccountId || !configPageId ? 'not-allowed' : 'pointer',
                            opacity: !configProfile ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '7px',
                          }}
                        >
                          <CheckCircle size={15} /> {configSaved ? 'Aplicado!' : 'Aplicar contas'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── ABA 5: Histórico ── */}
            {activeTab === 5 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-main)', margin: 0 }}>Histórico de Anúncios Criados</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {adHistory.length > 0 && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{adHistory.length} lote(s)</span>}
                    {adHistory.length > 0 && (
                      <button
                        onClick={() => setShowExportModal(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 13px', borderRadius: '8px', background: 'rgba(200,162,58,0.12)', border: '1px solid rgba(200,162,58,0.35)', color: 'var(--primary)', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                      >
                        <Download size={13} /> Exportar Período
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Modal exportar período ── */}
                {showExportModal && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '28px', width: '380px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>Exportar Histórico</h4>
                        <button onClick={() => setShowExportModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><X size={18} /></button>
                      </div>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                        Selecione o período. <strong>HTML</strong> abre no navegador com previews das artes. <strong>CSV</strong> abre no Excel sem imagens.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Data inicial</label>
                          <input type="date" value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)}
                            style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '13px', fontWeight: '600' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Data final</label>
                          <input type="date" value={exportDateTo} onChange={e => setExportDateTo(e.target.value)}
                            style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '13px', fontWeight: '600' }} />
                        </div>
                      </div>
                      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Deixe em branco para exportar todo o histórico.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button onClick={exportPeriodHTML} style={{ width: '100%', padding: '11px', borderRadius: '8px', background: 'var(--primary)', border: 'none', color: '#000', fontWeight: '800', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
                          <Download size={14} /> Abrir HTML com Previews (navegador)
                        </button>
                        <button onClick={exportPeriodCSV} style={{ width: '100%', padding: '11px', borderRadius: '8px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontWeight: '700', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
                          <Download size={14} /> Baixar CSV (Excel, sem imagens)
                        </button>
                        <button onClick={() => setShowExportModal(false)} style={{ width: '100%', padding: '9px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-muted)', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {adHistory.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <Clock size={36} style={{ opacity: 0.3 }} />
                    <p style={{ fontSize: '14px', fontWeight: '600', margin: 0 }}>Nenhum anúncio criado ainda</p>
                    <p style={{ fontSize: '12px', margin: 0 }}>O histórico aparece aqui após a publicação</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {adHistory.map(entry => (
                      <div key={entry.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden' }}>
                        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)' }}>{entry.clientName}</span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                                {entry.ads.length} anúncio{entry.ads.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              {new Date(entry.timestamp).toLocaleString('pt-BR')} · {entry.campaignName}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button
                              onClick={() => reuseHistoryEntry(entry, false)}
                              title="Reaproveitar configuração"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(47,128,255,0.1)', border: '1px solid rgba(47,128,255,0.35)', color: '#60a5fa', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              <RotateCcw size={13} /> Reaproveitar
                            </button>
                            <button
                              onClick={() => reuseHistoryEntry(entry, true)}
                              title="Reenviar mídias para a Meta e reprocessar"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#fbbf24', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              <UploadCloud size={13} /> Reprocessar
                            </button>
                            <button
                              onClick={() => downloadHistoryCSV(entry)}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              <Download size={13} /> CSV
                            </button>
                            <button
                              onClick={() => deleteHistoryEntry(entry.id)}
                              style={{ display: 'flex', alignItems: 'center', padding: '7px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        {(entry.bmName || entry.adAccountName || entry.pageName) && (
                          <div style={{ padding: '6px 16px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '16px', flexWrap: 'wrap', background: 'rgba(200,162,58,0.04)' }}>
                            {entry.bmName && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}><strong style={{ color: 'var(--primary)' }}>BM:</strong> {entry.bmName}</span>}
                            {entry.adAccountName && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}><strong style={{ color: 'var(--primary)' }}>Conta:</strong> {entry.adAccountName}</span>}
                            {entry.pageName && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}><strong style={{ color: 'var(--primary)' }}>Página:</strong> {entry.pageName}</span>}
                          </div>
                        )}
                        <div style={{ borderTop: '1px solid var(--border-light)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '72px 1.1fr 1fr 1fr 1.4fr', fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 16px', background: 'rgba(0,0,0,0.15)' }}>
                            <span>Preview</span><span>Arquivo</span><span>Nome do Anúncio</span><span>Título</span><span>Link</span>
                          </div>
                          {entry.ads.map((ad, idx) => (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '72px 1.1fr 1fr 1fr 1.4fr', padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.03)', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '60px', height: '60px', borderRadius: '6px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {ad.thumbnailBase64
                                  ? <img src={ad.thumbnailBase64} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                  : <span style={{ fontSize: '9px', fontWeight: '700', color: ad.mediaType === 'VIDEO' ? '#10b981' : '#1877F2' }}>{ad.mediaType === 'VIDEO' ? 'VID' : 'IMG'}</span>
                                }
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                <span style={{ fontSize: '10px', fontWeight: '700', background: ad.mediaType === 'VIDEO' ? 'rgba(16,185,129,0.15)' : 'rgba(24,119,242,0.12)', color: ad.mediaType === 'VIDEO' ? '#10b981' : '#1877F2', padding: '2px 5px', borderRadius: '4px', flexShrink: 0 }}>
                                  {ad.mediaType === 'VIDEO' ? 'VID' : 'IMG'}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ad.fileName}>{ad.fileName}</span>
                              </div>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.adName}</span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ad.title}>{ad.title || '—'}</span>
                              <span style={{ fontSize: '11px', color: '#1877F2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ad.link}>{ad.link || '—'}</span>
                            </div>
                          ))}
                        </div>
                        {entry.ads[0]?.primaryText && (
                          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-light)', background: 'rgba(0,0,0,0.1)' }}>
                            <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Copy: </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entry.ads[0].primaryText.slice(0, 180)}{entry.ads[0].primaryText.length > 180 ? '…' : ''}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab !== 5 && activeTab !== 6 && loadingApi ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', color: 'var(--text-muted)', gap: '12px' }}>
                <Loader2 size={32} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
                <p style={{ fontSize: '13px', fontWeight: '600' }}>Sincronizando com a Business Manager...</p>
              </div>
            ) : activeTab !== 5 && activeTab !== 6 && (
              <>
                {error && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#ef4444', fontWeight: '600' }}>
                    <AlertCircle size={14} /> {error}
                  </div>
                )}

                {/* ── ABA 0: Conta & BM ── */}
                {activeTab === 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>

                    {/* Perfis são escolhidos antes de abrir o criador, pela biblioteca de
                        publicação. Aqui fica apenas o formulário do perfil selecionado ou vazio. */}

                    {/* ── ETAPA 1: Business Manager ── */}
                    {(() => {
                      const done = !!accountData.bmId;
                      return (
                        <div style={{ paddingBottom: '20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: done ? '#10b981' : '#1877F2', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>
                              {done ? <CheckCircle size={14} /> : '1'}
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business Manager</span>
                            {done && <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '600' }}>— {bms.find(b => b.id === accountData.bmId)?.name}</span>}
                          </div>
                          {loadingBms ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', paddingLeft: '36px' }}>
                              <Loader2 size={14} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} /> Carregando...
                            </div>
                          ) : (
                            <div style={{ paddingLeft: '36px', maxWidth: '400px' }}>
                              <SearchableSelect 
                                items={bms} 
                                value={accountData.bmId} 
                                onChange={(id) => setAccountData({ bmId: id, adAccountId: '', pageId: '', igId: '', advertiserAccountId: '' })} 
                                placeholder="Selecione a Business Manager..." 
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── ETAPA 2: Conta de Anúncios ── */}
                    {accountData.bmId && (() => {
                      const done = !!accountData.adAccountId;
                      return (
                        <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '20px', paddingBottom: '20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: done ? '#10b981' : '#1877F2', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>
                              {done ? <CheckCircle size={14} /> : '2'}
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Conta de Anúncios</span>
                          </div>
                          {adAccounts.length === 0 ? (
                            <div style={{ fontSize: '13px', color: 'var(--text-muted)', paddingLeft: '36px' }}>Nenhuma conta encontrada nesta BM.</div>
                          ) : (
                            <div style={{ paddingLeft: '36px', maxWidth: '400px' }}>
                              <SearchableSelect 
                                items={adAccounts} 
                                value={accountData.adAccountId} 
                                onChange={(id) => setAccountData(a => ({ ...a, adAccountId: id, pageId: '', igId: '', advertiserAccountId: '' }))} 
                                placeholder="Selecione a Conta..." 
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── ETAPA 3: Página do Facebook ── */}
                    {accountData.adAccountId && (() => {
                      const done = !!accountData.pageId;
                      return (
                        <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '20px', paddingBottom: '20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: done ? '#10b981' : '#1877F2', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>
                              {done ? <CheckCircle size={14} /> : '3'}
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Página do Facebook</span>
                          </div>
                          <div style={{ paddingLeft: '36px', maxWidth: '400px' }}>
                            {loadingApi ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                                <Loader2 size={14} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} /> Carregando páginas...
                              </div>
                            ) : apiData.pages.length > 0 ? (
                              <SearchableSelect 
                                items={apiData.pages} 
                                value={accountData.pageId} 
                                onChange={(id) => setAccountData(a => ({ ...a, pageId: id }))} 
                                placeholder="Busque a Página..." 
                              />
                            ) : (
                              <div>
                                <input type="text" placeholder="Cole o ID da Página do Facebook" value={accountData.pageId} onChange={e => setAccountData(a => ({ ...a, pageId: e.target.value }))}
                                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                                <p style={{ fontSize: '10px', color: '#f59e0b', marginTop: '5px' }}>Token sem permissão <strong>pages_show_list</strong>. Digite o ID da página manualmente.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── ETAPA 4: Instagram ── */}
                    {accountData.pageId && (
                      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '20px', paddingBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                          <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: accountData.igId ? '#10b981' : '#1877F2', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>
                            {accountData.igId ? <CheckCircle size={14} /> : '4'}
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Conta Instagram <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>(opcional)</span></span>
                        </div>
                        <div style={{ paddingLeft: '36px', maxWidth: '400px' }}>
                          {apiData.igs.length > 0 ? (
                            <SearchableSelect
                              items={apiData.igs}
                              value={accountData.igId}
                              onChange={(id) => {
                                setAccountData(a => ({ ...a, igId: id }));
                                setAdSetData(a => ({ ...a, igId: id }));
                              }}
                              placeholder="Selecione a conta Instagram..."
                            />
                          ) : <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Nenhuma conta Instagram vinculada foi encontrada. Você pode seguir sem ela ou escolher depois no conjunto de anúncios.</p>}
                        </div>
                      </div>
                    )}

                    {/* ── Confirmação final ── */}
                    {accountData.bmId && accountData.adAccountId && accountData.pageId && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ padding: '16px', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <CheckCircle size={16} color="#10b981" style={{ flexShrink: 0 }} />
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', flex: 1 }}>
                            <strong style={{ color: '#10b981' }}>Destino confirmado · </strong>
                            {accountData.bmId !== '__direct__' && <><strong style={{ color: 'var(--text-main)' }}>{bms.find(b => b.id === accountData.bmId)?.name}</strong>{' → '}</>}
                            <strong style={{ color: 'var(--text-main)' }}>{adAccounts.find(a => a.id === accountData.adAccountId)?.name}</strong>
                            {' → '}
                            <strong style={{ color: 'var(--text-main)' }}>{apiData.pages.find(p => p.id === accountData.pageId)?.name || accountData.pageId}</strong>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button
                              onClick={() => setShowSavePreset(v => !v)}
                              style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.4)', background: showSavePreset ? 'rgba(139,92,246,0.1)' : 'rgba(16,185,129,0.06)', color: 'var(--primary)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              {quickPreset || editingPresetId ? 'Editar perfil' : 'Salvar perfil'}
                            </button>
                          </div>
                        </div>
                        {showSavePreset && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                            <input
                              type="text"
                              placeholder="Nome do perfil (ex: Instituto NTA — Principal)"
                              value={savePresetName}
                              onChange={e => setSavePresetName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && savePreset()}
                              autoFocus
                              style={{ minWidth: 0, padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--primary)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }}
                            />
                            <label title="Foto do card (opcional)" style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-main)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {savePresetImage ? '✓ Foto' : 'Foto'}
                              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={event => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => setSavePresetImage(String(reader.result || ''));
                                reader.readAsDataURL(file);
                              }} />
                            </label>
                            <button onClick={savePreset} disabled={!savePresetName.trim()} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: savePresetName.trim() ? 'var(--primary)' : 'var(--border-main)', color: 'white', fontSize: '12px', fontWeight: '700', cursor: savePresetName.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>{quickPreset || editingPresetId ? 'Confirmar edição' : 'Criar perfil'}</button>
                            <button onClick={() => { setShowSavePreset(false); setSavePresetName(''); setSavePresetImage(''); setEditingPresetId(''); }} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>✕</button>
                            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>O perfil é salvo imediatamente na biblioteca com BM, conta, página, Instagram, pixel e orçamento atual.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── ABA 1: Campanha ── */}
                {activeTab === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                    <h3 style={{ fontSize: '17px', fontWeight: '700', color: 'var(--text-main)' }}>Setup da Campanha</h3>

                    <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '4px', width: 'fit-content' }}>
                      {[['new', 'Criar Nova'], ['existing', 'Usar Existente']].map(([v, l]) => (
                        <button key={v} onClick={() => setCampAction(v)} style={{ padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', border: 'none', background: campAction === v ? 'var(--bg-app)' : 'transparent', color: campAction === v ? 'var(--text-main)' : 'var(--text-muted)', cursor: 'pointer', boxShadow: campAction === v ? '0 2px 6px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.15s' }}>
                          {l}
                        </button>
                      ))}
                    </div>

                    {campAction === 'existing' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Campanhas <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <p style={{ margin: '-4px 0 8px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>Pode marcar várias: os mesmos criativos vão para os conjuntos escolhidos, cada um com a copy e a URL que já usa.</p>
                          {apiData.campaigns.length === 0 ? (
                            <div style={{ fontSize: '13px', color: '#f59e0b', padding: '12px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px' }}>
                              Nenhuma campanha ativa encontrada nesta conta.
                            </div>
                          ) : (
                            <CampaignMultiSelect
                              campaigns={apiData.campaigns}
                              selectedIds={selectedCampaignIds}
                              onChange={ids => { changeCampaignSelection(ids); if (ids.length <= 1) setAdSetAction('existing'); }}
                            />
                          )}
                        </div>

                        {campaignObjectives.length > 1 && (
                          <div style={{ fontSize: '12px', color: '#f59e0b', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px' }}>
                            As campanhas marcadas têm objetivos diferentes ({campaignObjectives.map(OBJECTIVE_LABEL).join(', ')}). Publique um objetivo por vez.
                          </div>
                        )}
                        {selectedCampaignIds.length > 0 && (
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Conjunto de Anúncios
                            </label>
                            {selectedCampaignIds.length === 1 && <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '4px', width: 'fit-content', marginBottom: '10px' }}>
                              {[['new', '+ Criar Novo'], ['existing', 'Usar Existente']].map(([v, l]) => (
                                <button key={v} onClick={() => setAdSetAction(v)} style={{ padding: '7px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', border: 'none', background: adSetAction === v ? 'var(--bg-app)' : 'transparent', color: adSetAction === v ? 'var(--text-main)' : 'var(--text-muted)', cursor: 'pointer', boxShadow: adSetAction === v ? '0 2px 6px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.15s' }}>
                                  {l}
                                </button>
                              ))}
                            </div>}
                            {adSetAction === 'existing' && (
                              loadingAdSets ? (
                                <div style={{ fontSize: '13px', color: adSetFetchError ? '#f59e0b' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <Loader2 size={14} color={adSetFetchError ? '#f59e0b' : 'var(--primary)'} style={{ animation: 'spin 1s linear infinite' }} />
                                  {adSetFetchError || 'Carregando conjuntos...'}
                                </div>
                              ) : existingAdSets.length > 0 ? (
                                <div>
                                  {/* Toolbar: selecionar todos / limpar */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                    <button
                                      onClick={() => setSelectedAdSetIds(existingAdSets.filter(a => a.status !== 'DELETED' && a.status !== 'ARCHIVED').map(a => a.id))}
                                      style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                                    >Selecionar todos</button>
                                    <button
                                      onClick={() => setSelectedAdSetIds([])}
                                      style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                                    >Limpar</button>
                                    {selectedAdSetIds.length > 0 && (
                                      <span style={{ fontSize: '11px', fontWeight: '700', background: 'rgba(139,92,246,0.12)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '10px' }}>
                                        {selectedAdSetIds.length} selecionado(s)
                                      </span>
                                    )}
                                  </div>
                                  {/* Lista de checkboxes */}
                                  <div style={{ maxHeight: selectedCampaignIds.length > 1 ? '300px' : '200px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '8px', background: 'var(--bg-surface)' }}>
                                    {existingAdSets.map((adSet, adSetIndex) => {
                                      const isDisabled = adSet.status === 'DELETED' || adSet.status === 'ARCHIVED';
                                      const isChecked = selectedAdSetIds.includes(adSet.id);
                                      const showCampaignHeader = selectedCampaignIds.length > 1 && (adSetIndex === 0 || existingAdSets[adSetIndex - 1].campaign_id !== adSet.campaign_id);
                                      return (
                                        <div key={adSet.id}>
                                        {showCampaignHeader && (
                                          <div style={{ padding: '7px 12px', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--primary)', background: 'var(--bg-app)', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adSet.campaignName}</span>
                                            <button type="button" onClick={() => setSelectedAdSetIds(prev => [...new Set([...prev, ...existingAdSets.filter(a => a.campaign_id === adSet.campaign_id).map(a => a.id)])])} style={{ fontSize: '10px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'none' }}>Marcar todos</button>
                                          </div>
                                        )}
                                        <label
                                          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.4 : 1, borderBottom: '1px solid var(--border-light)', background: isChecked ? 'rgba(16,185,129,0.06)' : 'transparent' }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            disabled={isDisabled}
                                            onChange={() => toggleAdSet(adSet.id)}
                                            style={{ flexShrink: 0, accentColor: 'var(--primary)' }}
                                          />
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: '700', color: isChecked ? 'var(--primary)' : 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{adSet.name}</div>
                                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: {adSet.id}</div>
                                          </div>
                                          {isDisabled && <span style={{ fontSize: '9px', fontWeight: '800', background: 'rgba(239,68,68,0.2)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>INATIVA</span>}
                                        </label>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : adSetFetchError ? (
                                <div style={{ fontSize: '12px', color: '#ef4444', padding: '8px', background: 'rgba(239,68,68,0.08)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                  <span>{adSetFetchError}</span>
                                  <button onClick={() => setAdSetRetryKey(k => k + 1)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer', whiteSpace: 'nowrap' }}>Tentar novamente</button>
                                </div>
                              ) : (
                                <div style={{ fontSize: '12px', color: '#f59e0b' }}>Nenhum conjunto ativo encontrado {selectedCampaignIds.length > 1 ? 'nestas campanhas' : 'nesta campanha'}.</div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    ) : (

                      <>
                        <Field label="Nome da Campanha" required value={campData.name} onChange={e => setCampData({ ...campData, name: e.target.value })} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <SelectField label="Objetivo Meta" value={campData.objective} onChange={(newObj) => {
                            const newLabel = OBJECTIVE_LABEL(newObj);
                            const oldLabel = OBJECTIVE_LABEL(campData.objective);
                            const updatedName = campData.name.includes(`[${oldLabel}]`)
                              ? campData.name.replace(`[${oldLabel}]`, `[${newLabel}]`)
                              : campData.name;
                            setCampData({ ...campData, objective: newObj, name: updatedName });
                            setAdSetData(a => ({ ...a, optimizationGoal: OPTIMIZATION_GOALS[newObj]?.[0]?.value || 'LINK_CLICKS' }));
                          }} options={OBJECTIVES} />
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Orçamento</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', color: 'var(--text-main)' }}>
                                <input type="checkbox" checked={campData.budgetType === 'CBO'} onChange={e => setCampData({ ...campData, budgetType: e.target.checked ? 'CBO' : 'ABO' })} />
                                CBO (Advantage+)
                              </label>
                            </div>
                          </div>
                        </div>
                        {campData.budgetType === 'CBO' && (
                          <Field label="Orçamento Diário CBO (R$)" type="number" value={campData.budget} onChange={e => setCampData({ ...campData, budget: Number(e.target.value) })} width="48%" />
                        )}

                        {/* Declaração obrigatória: a Meta trata categoria errada
                            como violação e restringe a conta de anúncios. */}
                        <div style={{ padding: '14px', borderRadius: '10px', border: `1px solid ${specialAdCategory ? 'var(--border-light)' : 'rgba(245,158,11,0.45)'}`, background: specialAdCategory ? 'var(--bg-surface)' : 'rgba(245,158,11,0.06)' }}>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Categoria especial do anúncio <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <select
                            value={specialAdCategory}
                            onChange={e => setSpecialAdCategory(e.target.value)}
                            style={{ width: '100%', padding: '11px 13px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                          >
                            <option value="">Selecione — obrigatório antes de publicar</option>
                            {SPECIAL_AD_CATEGORIES.map(category => (
                              <option key={category.value} value={category.value}>{category.label}</option>
                            ))}
                          </select>
                          <p style={{ margin: '8px 0 0', fontSize: '11px', lineHeight: 1.55, color: 'var(--text-muted)' }}>
                            {specialAdCategory
                              ? SPECIAL_AD_CATEGORIES.find(item => item.value === specialAdCategory)?.hint
                              : 'Crédito, emprego, moradia, finanças, política e apostas têm regras próprias de segmentação na Meta. Declarar a categoria errada é motivo de restrição da conta de anúncios.'}
                          </p>
                          {CATEGORIES_REQUIRING_AUTHORIZATION.includes(specialAdCategory) && (
                            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.32)' }}>
                              <AlertCircle size={14} color="#f59e0b" style={{ flexShrink: 0, marginTop: '1px' }} />
                              <span style={{ fontSize: '11px', lineHeight: 1.55, color: '#f59e0b', fontWeight: '600' }}>
                                Esta categoria exige autorização prévia da Meta para o anunciante. Sem ela, o anúncio é reprovado e as reprovações seguidas pesam contra a conta.
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px' }}>
                          <CheckCircle size={15} color="#10b981" />
                          <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '700' }}>
                            Status: PAUSADA — revise no Ads Manager antes de ativar
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── ABA 2: Conjunto ── */}
                {activeTab === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                    <h3 style={{ fontSize: '17px', fontWeight: '700', color: 'var(--text-main)' }}>Conjunto de Anúncios (Ad Set)</h3>

                    {/* Badge: objetivo detectado da campanha existente */}
                    {campAction === 'existing' && (
                      loadingObjective ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          <Loader2 size={13} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
                          Detectando objetivo da campanha...
                        </div>
                      ) : campaignObjective ? (
                        <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', fontSize: '12px', color: 'var(--primary)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ⚡ Objetivo detectado: {OBJECTIVE_LABEL(campaignObjective)} — parâmetros ajustados automaticamente
                        </div>
                      ) : null
                    )}

                    <Field label="Nome do Conjunto" required value={adSetData.name} onChange={e => setAdSetData({ ...adSetData, name: e.target.value })} />

                    <div style={{ padding: '10px 14px', background: 'rgba(24,119,242,0.05)', border: '1px solid rgba(24,119,242,0.15)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                      <CheckCircle size={13} color="#1877F2" />
                      <span style={{ color: 'var(--text-muted)' }}>Página: <strong style={{ color: 'var(--text-main)' }}>{apiData.pages.find(p => p.id === accountData.pageId)?.name || accountData.pageId}</strong></span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <SelectField label="Conta Instagram (opcional)" value={adSetData.igId}
                        onChange={val => setAdSetData({ ...adSetData, igId: val })}
                        items={[{ id: '', name: '— Nenhuma —' }, ...apiData.igs]}
                        placeholder="— Nenhuma —" />
                      <div />
                    </div>

                    {(() => {
                      const effectiveObj = campaignObjective || campData.objective;
                      const goalsForSelect = OPTIMIZATION_GOALS[effectiveObj] || OPTIMIZATION_GOALS.OUTCOME_TRAFFIC;
                      const showPixel = effectiveObj === 'OUTCOME_SALES' || effectiveObj === 'OUTCOME_LEADS';
                      return (
                        <>
                          {/* Tipo de captação — Leads */}
                          {effectiveObj === 'OUTCOME_LEADS' && (
                            <SelectField label="Tipo de Captação de Lead" value={leadDestType}
                              onChange={val => setLeadDestType(val)} highlight
                              options={[
                                { value: 'INSTANT_FORM', label: 'Formulário Instantâneo (nativo Meta)' },
                                { value: 'WEBSITE',      label: 'Site / Landing Page' },
                                { value: 'WHATSAPP',     label: 'WhatsApp' },
                                { value: 'MESSENGER',    label: 'Messenger' },
                              ]} />
                          )}
                          {/* Evento de conversão — Vendas */}
                          {effectiveObj === 'OUTCOME_SALES' && (
                            <SelectField label="Evento de Conversão" value={saleConversionEvent}
                              onChange={val => setSaleConversionEvent(val)} highlight
                              options={[
                                { value: 'PURCHASE',              label: 'Compra (Purchase)' },
                                { value: 'ADD_TO_CART',           label: 'Adicionar ao Carrinho' },
                                { value: 'INITIATE_CHECKOUT',     label: 'Iniciar Checkout' },
                                { value: 'COMPLETE_REGISTRATION', label: 'Cadastro Completo' },
                                { value: 'LEAD',                  label: 'Lead' },
                                { value: 'VIEW_CONTENT',          label: 'Ver Conteúdo' },
                              ]} />
                          )}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <SelectField label="Otimização" value={adSetData.optimizationGoal}
                              onChange={val => setAdSetData({ ...adSetData, optimizationGoal: val })}
                              options={goalsForSelect} />
                            <SelectField label="Posicionamentos" value={adSetData.placements}
                              onChange={val => setAdSetData({ ...adSetData, placements: val })}
                              options={[
                                { value: 'ADVANTAGE_PLUS', label: 'Advantage+ (Automático)' },
                                { value: 'MANUAL',         label: 'Manual' },
                              ]} />
                          </div>
                          {showPixel && (
                            <SelectField label="📍 Pixel de Conversão" value={adSetData.pixelId}
                              onChange={val => setAdSetData({ ...adSetData, pixelId: val })} highlight
                              items={[{ id: '', name: '— Selecione o Pixel —' }, ...apiData.pixels.map(p => ({ id: p.id, name: `${p.name} (ID: ${p.id})` }))]}
                              placeholder="— Selecione o Pixel —" />
                          )}
                          {/* Aviso sem pixel — Vendas */}
                          {effectiveObj === 'OUTCOME_SALES' && !adSetData.pixelId && (
                            <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', fontSize: '12px', color: '#f59e0b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              ⚠️ Sem pixel — conjunto otimizado por Cliques no Link. Selecione um Pixel para otimizar por Conversão.
                            </div>
                          )}

                          {/* Beneficiário e pagador (Brasil): copiados dos conjuntos da conta */}
                          {(() => {
                            const found = Boolean(regulationIds);
                            const tone = found ? '16,185,129' : regulationScan.status === 'loading' ? '47,128,255' : '245,158,11';
                            const linkButton = { fontSize: '11px', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '700', whiteSpace: 'nowrap', padding: 0 };
                            const idInput = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-main)', fontSize: '12px', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' };
                            return (
                              <div style={{ padding: '12px 14px', background: `rgba(${tone},0.06)`, border: `1px solid rgba(${tone},0.28)`, borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  {regulationScan.status === 'loading'
                                    ? <Loader2 size={14} color="#2f80ff" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                                    : <ShieldCheck size={14} color={found ? '#10b981' : '#f59e0b'} style={{ flexShrink: 0 }} />}
                                  <strong style={{ color: 'var(--text-main)' }}>Beneficiário e pagador</strong>
                                  <span style={{ color: 'var(--text-muted)' }}>· exigidos pela Meta para anúncios no Brasil</span>
                                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
                                    {regulationScan.status !== 'loading' && connection.connected && <button type="button" style={linkButton} onClick={() => setRegulationScanKey(k => k + 1)}>Buscar de novo</button>}
                                    <button type="button" style={linkButton} onClick={() => {
                                      if (!regulationOverride) setRegulationOverride({ beneficiaryId: '', payerId: '' });
                                      setEditingRegulation(v => !v);
                                    }}>{editingRegulation ? 'Fechar' : 'Trocar'}</button>
                                  </div>
                                </div>
                                {regulationScan.status === 'loading' && <span style={{ color: 'var(--text-muted)' }}>Procurando nos conjuntos que já existem nesta conta...</span>}
                                {found && (
                                  <span style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                    Beneficiário <strong style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{regulationIds.beneficiaryId || regulationIds.payerId}</strong>
                                    {' · '}Pagador <strong style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{regulationIds.payerId || regulationIds.beneficiaryId}</strong>
                                    <br />
                                    {regulationOverride && (regulationOverride.beneficiaryId.trim() || regulationOverride.payerId.trim())
                                      ? 'Informado por você.'
                                      : `Preenchido sozinho: é o mesmo par do conjunto "${detectedRegulation.sourceAdSetName}"${detectedRegulation.adSetCount > 1 ? ` e de outros ${detectedRegulation.adSetCount - 1} conjunto(s)` : ''} desta conta.`}
                                  </span>
                                )}
                                {!found && regulationScan.status !== 'loading' && (
                                  <span style={{ color: '#f59e0b', lineHeight: 1.5, fontWeight: '600' }}>
                                    {regulationScan.status === 'error'
                                      ? `Não foi possível ler os conjuntos da conta (${regulationScan.error}).`
                                      : 'Nenhum conjunto desta conta declara beneficiário e pagador ainda.'}
                                    {' '}O conjunto será criado sem a declaração. Se a Meta exigir, crie um conjunto nesta conta pelo Gerenciador de Anúncios uma vez e clique em "Buscar de novo": a partir daí o sistema copia sozinho.
                                  </span>
                                )}
                                {editingRegulation && regulationOverride && (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                    <input aria-label="ID do beneficiário" placeholder={detectedRegulation?.beneficiaryId || 'ID do beneficiário'} value={regulationOverride.beneficiaryId}
                                      onChange={e => setRegulationOverride(prev => ({ ...prev, beneficiaryId: e.target.value.trim() }))} style={idInput} />
                                    <input aria-label="ID do pagador" placeholder={detectedRegulation?.payerId || 'ID do pagador (vazio = mesmo do beneficiário)'} value={regulationOverride.payerId}
                                      onChange={e => setRegulationOverride(prev => ({ ...prev, payerId: e.target.value.trim() }))} style={idInput} />
                                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                      <span>Pode ser o mesmo ID nos dois campos.</span>
                                      {detectedRegulation && <button type="button" style={linkButton} onClick={() => { setRegulationOverride(null); setEditingRegulation(false); }}>Usar o encontrado na conta</button>}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      );
                    })()}

                    {campData.budgetType === 'ABO' && (
                      <Field label="Orçamento Diário ABO (R$)" type="number" value={adSetData.budget} onChange={e => setAdSetData({ ...adSetData, budget: Number(e.target.value) })} width="48%" />
                    )}

                    <div>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Direcionamento Detalhado</label>
                      <textarea rows={3} value={adSetData.audience} onChange={e => setAdSetData({ ...adSetData, audience: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                )}

                {/* ── ABA 3: Anúncios (lote) ── */}
                {activeTab === 3 && (() => {
                  const activeId = adUnits.some(m => m.id === activeCopyFileId) ? activeCopyFileId : (adUnits[0]?.id ?? null);
                  const activeIdx = adUnits.findIndex(m => m.id === activeId);
                  const activeMedia = adUnits[activeIdx] ?? null;
                  const blockedAdSets = usingExistingAdSet
                    ? selectedAdSetIds
                        .map(id => existingAdSets.find(a => a.id === id))
                        .filter(a => a && classifyAdSetDestination(a.destination_type, a.optimization_goal).isMultiDest)
                    : [];
                  const placementsSupported = !isAutoMsgDest && !isLeadFormDest;
                  const MEDIA_DRAG_TYPE = 'application/x-venza-media';
                  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
                  const acceptsDrop = (e) => isFileDrag(e) || Array.from(e.dataTransfer?.types || []).includes(MEDIA_DRAG_TYPE);
                  const typeLabel = (m) => (m.type === 'VIDEO' ? 'vídeo' : 'imagem');

                  // Coloca uma mídia já enviada no lugar vazio de um anúncio.
                  const placeMedia = (unit, role, mediaId) => {
                    const media = mediaById[mediaId];
                    if (!media || media.id === unit.id) return;
                    if (media.type !== unit.type) {
                      setError(`Feed e Stories do mesmo anúncio precisam ser do mesmo tipo: este anúncio é ${typeLabel(unit)} e a mídia escolhida é ${typeLabel(media)}.`);
                      return;
                    }
                    setError(null);
                    if (role === 'story') linkPair(unit.id, media.id);
                    else linkPair(media.id, unit.id);
                    setSlotPicker(null);
                  };
                  const openSlotUpload = (unit, role) => {
                    slotUploadTarget.current = { mediaId: unit.id, role };
                    setSlotPicker(null);
                    slotUploadRef.current?.click();
                  };
                  const dropHandlers = (key, onDropFiles, onDropMedia) => ({
                    onDragOver: (e) => { if (!acceptsDrop(e)) return; e.preventDefault(); e.stopPropagation(); if (dropTarget !== key) setDropTarget(key); },
                    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(current => (current === key ? null : current)); },
                    onDrop: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropTarget(null);
                      if (e.dataTransfer.files?.length) onDropFiles?.(e.dataTransfer.files);
                      else if (onDropMedia) onDropMedia(e.dataTransfer.getData(MEDIA_DRAG_TYPE));
                    },
                  });

                  const mediaThumb = (m, fit = 'cover') => (m.thumbnailBase64 || m.type === 'IMAGE'
                    ? <img src={m.thumbnailBase64 || m.preview} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} />
                    : <video src={m.preview} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} />);

                  const iconButton = (title, onClick, icon, tone = 'var(--text-muted)') => (
                    <button type="button" title={title} aria-label={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
                      style={{ width: '26px', height: '26px', borderRadius: '7px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: tone, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {icon}
                    </button>
                  );

                  // Lugar do Feed ou do Stories dentro do cartão do anúncio.
                  const renderSlot = (unit, role, media) => {
                    const key = `${unit.id}:${role}`;
                    const isStory = role === 'story';
                    const width = isStory ? 68 : 96;
                    const label = isStory ? 'Stories / Reels' : 'Feed';
                    const highlight = dropTarget === key;
                    if (media) {
                      const ratio = aspectLabel(media.width, media.height);
                      const mismatch = isStory ? media.placement !== 'story' : media.placement === 'story';
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: `${width}px`, flexShrink: 0 }}>
                          <div
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData(MEDIA_DRAG_TYPE, media.id); e.dataTransfer.effectAllowed = 'move'; }}
                            title={`${media.file.name} — arraste para o lugar vazio de outro anúncio`}
                            style={{ position: 'relative', width: '100%', height: '120px', borderRadius: '8px', overflow: 'hidden', background: '#000', cursor: 'grab', border: `2px solid ${isStory ? 'rgba(139,92,246,0.55)' : 'rgba(16,185,129,0.55)'}` }}
                          >
                            {mediaThumb(media)}
                            <span style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '8px', fontWeight: '800', padding: '2px 5px', borderRadius: '4px', background: isStory ? 'rgba(139,92,246,0.9)' : 'rgba(16,185,129,0.9)', color: 'white' }}>
                              {ratio || (isStory ? '9:16' : 'FEED')}
                            </span>
                            <button type="button" title={`Remover ${media.file.name}`} aria-label={`Remover ${media.file.name}`}
                              onClick={(e) => { e.stopPropagation(); removeMedia(media.id); }}
                              style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.65)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <X size={12} />
                            </button>
                          </div>
                          <span style={{ fontSize: '10px', fontWeight: '700', color: isStory ? '#c4b5fd' : '#34d399', textAlign: 'center' }}>{label}</span>
                          {mismatch && ratio && <span style={{ fontSize: '9px', color: '#f59e0b', textAlign: 'center', lineHeight: 1.2 }}>{isStory ? 'não é 9:16' : 'é vertical 9:16'}</span>}
                        </div>
                      );
                    }
                    const pickerOpen = slotPicker?.unitId === unit.id && slotPicker?.role === role;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: `${width}px`, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSlotPicker(pickerOpen ? null : { unitId: unit.id, role }); }}
                          {...dropHandlers(key, (files) => addMediaFiles(files, { pairTo: { mediaId: unit.id, role } }), (mediaId) => placeMedia(unit, role, mediaId))}
                          title={`Adicionar a versão ${label} deste anúncio`}
                          style={{ width: '100%', height: '120px', borderRadius: '8px', border: `2px dashed ${highlight ? '#2f80ff' : isStory ? 'rgba(139,92,246,0.45)' : 'rgba(16,185,129,0.45)'}`, background: highlight ? 'rgba(47,128,255,0.10)' : 'transparent', color: isStory ? '#c4b5fd' : '#34d399', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '10px', fontWeight: '800', padding: '6px' }}
                        >
                          <Plus size={16} />
                          {isStory ? 'Stories 9:16' : 'Feed 4:5'}
                          <span style={{ fontSize: '9px', fontWeight: '600', color: 'var(--text-muted)' }}>opcional</span>
                        </button>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textAlign: 'center' }}>{label}</span>
                      </div>
                    );
                  };

                  // Lista para escolher a mídia de um lugar vazio.
                  const renderSlotPicker = (unit) => {
                    if (slotPicker?.unitId !== unit.id) return null;
                    const role = slotPicker.role;
                    const wanted = role === 'story' ? 'story' : 'feed';
                    const candidates = mediaFiles
                      .filter(m => m.id !== unit.id && m.type === unit.type && !storyPairs[m.id] && !pairedStoryIds.has(m.id))
                      .sort((a, b) => Number(b.placement === wanted) - Number(a.placement === wanted));
                    return (
                      <div ref={revealOnMount} onClick={e => e.stopPropagation()} style={{ marginTop: '8px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: '800', color: 'var(--text-main)' }}>
                          <span>Versão {role === 'story' ? 'Stories / Reels' : 'Feed'} deste anúncio</span>
                          <button type="button" onClick={() => setSlotPicker(null)} aria-label="Fechar" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}><X size={14} /></button>
                        </div>
                        {candidates.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                            {candidates.map(m => (
                              <button type="button" key={m.id} onClick={() => placeMedia(unit, role, m.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px', borderRadius: '6px', border: '1px solid var(--border-light)', background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left' }}>
                                <span style={{ width: '28px', height: '36px', borderRadius: '4px', overflow: 'hidden', background: '#000', flexShrink: 0 }}>{mediaThumb(m)}</span>
                                <span style={{ flex: 1, minWidth: 0, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.file.name}</span>
                                <span style={{ fontSize: '9px', fontWeight: '800', color: m.placement === 'story' ? '#c4b5fd' : '#34d399' }}>{aspectLabel(m.width, m.height) || (m.placement === 'story' ? '9:16' : 'FEED')}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Nenhum{unit.type === 'VIDEO' ? ' vídeo' : 'a imagem'} solto no lote. Envie o arquivo abaixo.</span>
                        )}
                        <button type="button" onClick={() => openSlotUpload(unit, role)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px', borderRadius: '6px', border: '1px dashed var(--border-main)', background: 'transparent', color: 'var(--primary)', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}>
                          <UploadCloud size={13} /> Enviar arquivo do computador
                        </button>
                      </div>
                    );
                  };

                  const renderAdCard = (unit, index) => {
                    const story = storyOf(unit.id);
                    const feedMedia = story ? unit : (unit.placement === 'story' ? null : unit);
                    const storyMedia = story || (unit.placement === 'story' ? unit : null);
                    const isActive = individualCopyMode && unit.id === activeId;
                    const hasOwnCopy = Object.keys(adCopyOverrides[unit.id] || {}).length > 0;
                    const files = [feedMedia, storyMedia].filter(Boolean);
                    return (
                      <div key={unit.id}
                        onClick={() => { if (individualCopyMode) setActiveCopyFileId(unit.id); }}
                        style={{ padding: '10px', borderRadius: '12px', border: `${isActive ? 2 : 1}px solid ${isActive ? 'var(--primary)' : story ? 'rgba(139,92,246,0.35)' : 'var(--border-light)'}`, background: 'var(--bg-surface)', cursor: individualCopyMode ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{resolveAdName(adsData.namingPattern, index + 1)}</span>
                          <span style={{ fontSize: '9px', fontWeight: '800', color: unit.type === 'VIDEO' ? '#34d399' : '#60a5fa', background: unit.type === 'VIDEO' ? 'rgba(16,185,129,0.12)' : 'rgba(24,119,242,0.12)', padding: '2px 6px', borderRadius: '4px' }}>{unit.type === 'VIDEO' ? 'VÍDEO' : 'IMAGEM'}</span>
                          {hasOwnCopy && <span title="Este anúncio tem texto próprio" style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />}
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                            {iconButton('Texto próprio deste anúncio', () => { setIndividualCopyMode(true); setActiveCopyFileId(unit.id); }, <Pencil size={13} />, hasOwnCopy ? '#10b981' : 'var(--text-muted)')}
                            {story && iconButton('Inverter Feed e Stories', () => swapPair(unit.id), <ArrowLeftRight size={13} />)}
                            {story && iconButton('Separar em dois anúncios', () => unlinkPair(unit.id), <Unlink size={13} />)}
                            {iconButton('Apagar este anúncio', () => removeAd(unit.id), <Trash2 size={13} />, '#ef4444')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                          {renderSlot(unit, 'feed', feedMedia)}
                          {renderSlot(unit, 'story', storyMedia)}
                        </div>
                        {renderSlotPicker(unit)}
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4, minWidth: 0 }}>
                          {files.map(m => (
                            <div key={m.id} title={m.file.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.file.name} · {formatMb(m.file.size)}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  };

                  const formatModeControl = (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>Enquadramento:</span>
                      <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '2px' }}>
                        {[[true, 'Original, sem corte'], [false, 'Meta adapta']].map(([value, text]) => (
                          <button key={text} type="button" onClick={() => setPreserveOriginalMedia(value)}
                            title={value ? 'Desliga corte, expansão e retoques automáticos da Meta' : 'A Meta pode cortar e ajustar a mídia em cada posicionamento'}
                            style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: '700', cursor: 'pointer', background: preserveOriginalMedia === value ? 'var(--bg-app)' : 'transparent', color: preserveOriginalMedia === value ? 'var(--text-main)' : 'var(--text-muted)', boxShadow: preserveOriginalMedia === value ? '0 1px 4px rgba(0,0,0,0.15)' : 'none' }}>
                            {text}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                  const uploadInputs = (
                      <input ref={slotUploadRef} type="file" accept="image/jpeg,image/png,image/webp,video/*" style={{ display: 'none' }}
                        onChange={(e) => { const pairTo = slotUploadTarget.current; slotUploadTarget.current = null; handleFileUpload(e, { pairTo }); }} />
                  );
                  const addButtons = (big = false) => (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: big ? 'center' : 'flex-start' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: big ? '10px 18px' : '7px 12px', borderRadius: '8px', background: 'linear-gradient(135deg, #1877F2, #0056d6)', color: 'white', fontSize: big ? '13px' : '12px', fontWeight: '800', cursor: 'pointer' }}>
                        <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                        <Plus size={14} /> Adicionar mídias
                      </label>
                      <label title="Seleciona todos os vídeos e imagens de uma pasta" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: big ? '10px 18px' : '7px 12px', borderRadius: '8px', border: '1px solid var(--border-main)', color: 'var(--text-main)', fontSize: big ? '13px' : '12px', fontWeight: '700', cursor: 'pointer' }}>
                        <input type="file" multiple style={{ display: 'none' }} {...{ webkitdirectory: '' }} onChange={handleFileUpload} />
                        <FolderOpen size={14} /> Pasta inteira
                      </label>
                    </div>
                  );

                  /* Empty state */
                  if (mediaFiles.length === 0) return (
                    <div
                      {...dropHandlers('panel', (files) => addMediaFiles(files))}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', borderRadius: '16px', border: `2px dashed ${dropTarget === 'panel' ? '#2f80ff' : 'rgba(16,185,129,0.35)'}`, background: dropTarget === 'panel' ? 'rgba(47,128,255,0.06)' : 'rgba(16,185,129,0.03)', padding: '24px' }}
                    >
                      {uploadInputs}
                      <div style={{ width: '72px', height: '72px', borderRadius: '20px', background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(24,119,242,0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <UploadCloud size={36} color="var(--primary)" />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', marginBottom: '6px' }}>Arraste os arquivos ou a pasta para cá</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: '460px' }}>
                          Imagens JPG, PNG, WEBP e vídeos MP4, MOV ou HEVC, sem converter. Até {MAX_ADS_PER_BATCH} anúncios por lote ({MAX_MEDIA_FILES} arquivos com Feed + Stories).
                          Arquivos com o mesmo nome e marcação de formato (ex.: <em>video1_feed</em> e <em>video1_stories</em>) viram um anúncio só.
                        </div>
                      </div>
                      {addButtons(true)}
                      {formatModeControl}
                    </div>
                  );

                  return (
                  <div style={{ display: 'flex', gap: '0', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {uploadInputs}

                    {/* ── Mídias: um cartão por anúncio, com Feed e Stories ── */}
                    <div
                      {...dropHandlers('panel', (files) => addMediaFiles(files))}
                      onClick={() => setSlotPicker(null)}
                      style={{ flex: 1.25, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', paddingRight: '14px', borderRadius: '10px', outline: dropTarget === 'panel' ? '2px dashed #2f80ff' : 'none', outlineOffset: '-2px', background: dropTarget === 'panel' ? 'rgba(47,128,255,0.04)' : 'transparent' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-app)', paddingBottom: '8px', borderBottom: '1px solid var(--border-light)' }}>
                        {addButtons()}
                        <span style={{ fontSize: '12px', color: adUnits.length > MAX_ADS_PER_BATCH ? '#ef4444' : 'var(--text-muted)', fontWeight: '700' }}>
                          {adUnits.length}/{MAX_ADS_PER_BATCH} anúncio{adUnits.length !== 1 ? 's' : ''} · {mediaFiles.length} arquivo{mediaFiles.length !== 1 ? 's' : ''}
                          {pairedStoryIds.size > 0 ? ` · ${pairedStoryIds.size} com Feed + Stories` : ''}
                        </span>
                        <button type="button" onClick={clearAllMedia}
                          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', color: '#ef4444', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
                          <Trash2 size={13} /> Limpar tudo
                        </button>
                        <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                          {formatModeControl}
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Arraste uma mídia para o lugar vazio de outro anúncio para juntar Feed + Stories.</span>
                        </div>
                      </div>
                      {placementsSupported && blockedAdSets.length > 0 && pairedStoryIds.size > 0 && (
                        <div style={{ fontSize: '11px', color: '#f59e0b', padding: '8px 10px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                          Nestes conjuntos o Stories não entra (destino de mensagens/multi-destino): {blockedAdSets.map(a => a.name).join(', ')}. Neles vai só a versão de feed.
                        </div>
                      )}
                      {!placementsSupported && pairedStoryIds.size > 0 && (
                        <div style={{ fontSize: '11px', color: '#f59e0b', padding: '8px 10px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                          Feed + Stories só funciona com destino site. Neste destino (mensagens/formulário) vai só a versão de feed.
                        </div>
                      )}
                      {adUnits.length > MAX_ADS_PER_BATCH && (
                        <div style={{ fontSize: '11px', color: '#ef4444', padding: '8px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', fontWeight: '600' }}>
                          A Meta aceita até {MAX_ADS_PER_BATCH} anúncios por conjunto. Junte versões Feed + Stories ou apague {adUnits.length - MAX_ADS_PER_BATCH} anúncio(s).
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                        {adUnits.map((unit, index) => renderAdCard(unit, index))}
                      </div>
                    </div>

                    {/* Direita: Copy */}
                    <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-light)', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
                      {usingExistingAdSet && (
                        <div style={{ padding: '12px', borderRadius: '10px', border: '1px solid rgba(47,128,255,0.35)', background: 'rgba(47,128,255,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: '800', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Herdar de cada conjunto</div>
                            <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>Cada conjunto recebe os criativos novos com a copy e a URL dos anúncios que já rodam nele — assim um conjunto não fica com URLs diferentes.</p>
                          </div>
                          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-main)', cursor: 'pointer' }}>
                              <input type="checkbox" checked={inheritUrl} onChange={e => setInheritUrl(e.target.checked)} style={{ accentColor: 'var(--primary)' }} /> Herdar URL
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-main)', cursor: 'pointer' }}>
                              <input type="checkbox" checked={inheritCopy} onChange={e => setInheritCopy(e.target.checked)} style={{ accentColor: 'var(--primary)' }} /> Herdar copy (texto, título, descrição e CTA)
                            </label>
                          </div>
                          {inheritActive && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
                              {selectedAdSetIds.map(id => {
                                const adSet = existingAdSets.find(a => a.id === id);
                                const entry = adSetInheritance[id];
                                const data = entry?.data;
                                return (
                                  <div key={id} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-surface)', fontSize: '11px' }}>
                                    <div style={{ fontWeight: '700', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {adSet?.name || id}
                                      {selectedCampaignIds.length > 1 && adSet?.campaignName && <span style={{ fontWeight: '500', color: 'var(--text-muted)' }}> · {adSet.campaignName}</span>}
                                    </div>
                                    {(!entry || entry.status === 'loading') && <div style={{ color: 'var(--text-muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Lendo os anúncios do conjunto...</div>}
                                    {entry?.status === 'error' && <div style={{ color: '#ef4444', marginTop: '3px' }}>Não foi possível ler os anúncios: {entry.error}. Usa a copy e a URL abaixo.</div>}
                                    {entry?.status === 'empty' && <div style={{ color: '#f59e0b', marginTop: '3px' }}>Conjunto sem anúncios — usa a copy e a URL preenchidas abaixo.</div>}
                                    {entry?.status === 'ready' && data && (
                                      <div style={{ marginTop: '3px', display: 'flex', flexDirection: 'column', gap: '2px', color: 'var(--text-muted)' }}>
                                        {inheritUrl && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.link}>🔗 {data.link || <em>sem URL nos anúncios — usa a URL abaixo</em>}</div>}
                                        {inheritCopy && data.primaryText && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.primaryText}>✍️ {data.primaryText}</div>}
                                        {inheritCopy && data.title && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📰 {data.title}</div>}
                                        <div style={{ fontSize: '10px' }}>Base: {data.adCount} anúncio(s) · referência "{data.sourceAdName}"</div>
                                        {inheritUrl && data.distinctLinks.length > 1 && (
                                          <div style={{ color: '#f59e0b', fontSize: '10px' }}>⚠️ Este conjunto já tem {data.distinctLinks.length} URLs diferentes — os novos anúncios usam a mais usada.</div>
                                        )}
                                        {inheritUrl && data.link && validateDestinationUrl(data.link) && <div style={{ color: '#ef4444', fontSize: '10px' }}>{validateDestinationUrl(data.link)}</div>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {inheritActive && (
                            <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                              Os campos abaixo valem para o que não for herdado e para conjuntos sem anúncio.
                            </p>
                          )}
                        </div>
                      )}
                      <Field label="Nomenclatura do Anúncio" value={adsData.namingPattern} onChange={e => setAdsData({ ...adsData, namingPattern: e.target.value })} placeholder="AD{index}_DDMM_{index}" />
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '-8px', lineHeight: '1.4' }}>
                        <strong style={{ color: 'var(--text-main)' }}>{'{index}'}</strong> → 01, 02... &nbsp;|&nbsp; <strong style={{ color: 'var(--text-main)' }}>{'{date}'}</strong> → {todayDDMM}
                      </p>
                      {adsData.namingPattern && (
                        <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '10px 12px' }}>
                          <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Preview</div>
                          {[1, 2, 3].map(i => (
                            <div key={i} style={{ fontSize: '12px', fontFamily: 'monospace', color: i === 1 ? 'var(--primary)' : 'var(--text-muted)', padding: '1px 0' }}>
                              {resolveAdName(adsData.namingPattern, i)}
                            </div>
                          ))}
                          {adUnits.length > 3 && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>+{adUnits.length - 3} mais...</div>
                          )}
                        </div>
                      )}
                      <div style={{ height: '1px', background: 'var(--border-light)' }} />

                      {/* ── Mesmo texto para todos x texto por anúncio ── */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Textos dos anúncios</span>
                        <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '2px' }}>
                          {[['global', 'Iguais para todos'], ['individual', 'Por anúncio']].map(([v, l]) => (
                            <button key={v} type="button" onClick={() => {
                              const toIndividual = v === 'individual';
                              setIndividualCopyMode(toIndividual);
                              if (toIndividual && !activeCopyFileId && adUnits.length > 0) setActiveCopyFileId(adUnits[0].id);
                            }} style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', border: 'none', background: (v === 'individual') === individualCopyMode ? 'var(--bg-app)' : 'transparent', color: (v === 'individual') === individualCopyMode ? 'var(--text-main)' : 'var(--text-muted)', cursor: 'pointer', boxShadow: (v === 'individual') === individualCopyMode ? '0 1px 4px rgba(0,0,0,0.15)' : 'none', transition: 'all 0.15s' }}>
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ── Texto próprio do anúncio selecionado ── */}
                      {individualCopyMode && activeMedia && (() => {
                        const overrides = adCopyOverrides[activeId] || {};
                        const hasOverride = (f) => overrides[f] !== undefined;
                        const getVal = (f) => hasOverride(f) ? overrides[f] : adsData[f];
                        const setVal = (f, v) => setAdCopyOverrides(prev => ({ ...prev, [activeId]: { ...prev[activeId], [f]: v } }));
                        const clearVal = (f) => setAdCopyOverrides(prev => { const c = { ...prev[activeId] }; delete c[f]; return { ...prev, [activeId]: c }; });
                        const navButton = (disabled) => ({ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--border-main)', background: 'transparent', color: disabled ? 'var(--border-main)' : 'var(--text-muted)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });

                        return (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'rgba(16,185,129,0.08)', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.2)' }}>
                              <span style={{ width: '30px', height: '38px', borderRadius: '4px', overflow: 'hidden', background: '#000', flexShrink: 0 }}>
                                {activeMedia.thumbnailBase64 || activeMedia.type === 'IMAGE'
                                  ? <img src={activeMedia.thumbnailBase64 || activeMedia.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <video src={activeMedia.preview} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--primary)' }}>{resolveAdName(adsData.namingPattern, activeIdx + 1)}</div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeMedia.file.name}</div>
                              </div>
                              <button type="button" aria-label="Anúncio anterior" disabled={activeIdx <= 0} onClick={() => setActiveCopyFileId(adUnits[activeIdx - 1]?.id)} style={navButton(activeIdx <= 0)}><ChevronLeft size={14} /></button>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>{activeIdx + 1}/{adUnits.length}</span>
                              <button type="button" aria-label="Próximo anúncio" disabled={activeIdx >= adUnits.length - 1} onClick={() => setActiveCopyFileId(adUnits[activeIdx + 1]?.id)} style={navButton(activeIdx >= adUnits.length - 1)}><ChevronRight size={14} /></button>
                              {Object.keys(overrides).length > 0 && (
                                <button type="button" onClick={() => setAdCopyOverrides(prev => ({ ...prev, [activeId]: {} }))} style={{ fontSize: '10px', padding: '3px 7px', borderRadius: '4px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                  Resetar
                                </button>
                              )}
                            </div>
                            <p style={{ margin: '-6px 0 0', fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                              Clique num cartão à esquerda para escolher o anúncio. Campo que você não mexer usa o texto de "Iguais para todos", com todas as opções; campo alterado vale só para este anúncio.
                            </p>

                            {[
                              { key: 'primaryText', label: 'Texto principal', multiline: true },
                              { key: 'title', label: 'Título', multiline: false },
                              { key: 'description', label: 'Descrição', multiline: false },
                            ].map(({ key, label, multiline }) => (
                              <div key={key}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '700', color: hasOverride(key) ? '#10b981' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {label}
                                    {!hasOverride(key) && textOptions(optionValues(key)).length > 1 && <span style={{ textTransform: 'none', fontWeight: '600', color: '#93c5fd' }}> · usando as {textOptions(optionValues(key)).length} opções gerais</span>}
                                  </label>
                                  {hasOverride(key) && (
                                    <button type="button" onClick={() => clearVal(key)} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', border: '1px solid rgba(16,185,129,0.3)', background: 'transparent', color: '#10b981', cursor: 'pointer' }}>← usar o geral</button>
                                  )}
                                </div>
                                {multiline ? (
                                  <textarea rows={3} value={getVal(key)} onChange={e => setVal(key, e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${hasOverride(key) ? '#10b981' : 'var(--border-main)'}`, background: hasOverride(key) ? 'rgba(16,185,129,0.04)' : 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                                ) : (
                                  <input type="text" value={getVal(key)} onChange={e => setVal(key, e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${hasOverride(key) ? '#10b981' : 'var(--border-main)'}`, background: hasOverride(key) ? 'rgba(16,185,129,0.04)' : 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                                )}
                              </div>
                            ))}
                            <SelectField label="CTA" value={getVal('cta')} onChange={val => setVal('cta', val)} highlight={hasOverride('cta')} options={CTA_OPTIONS} />
                            {needsUrl && (
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '700', color: hasOverride('link') ? '#10b981' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>URL</label>
                                  {hasOverride('link') && <button type="button" onClick={() => clearVal('link')} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', border: '1px solid rgba(16,185,129,0.3)', background: 'transparent', color: '#10b981', cursor: 'pointer' }}>← usar o geral</button>}
                                </div>
                                <input type="text" value={getVal('link')} onChange={e => setVal('link', e.target.value)} placeholder="https://..." style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${hasOverride('link') ? '#10b981' : 'var(--border-main)'}`, background: hasOverride('link') ? 'rgba(16,185,129,0.04)' : 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* ── Textos iguais para todos, com até 5 opções de cada ── */}
                      {!individualCopyMode && <>
                      <OptionsField label="Texto principal" multiline limit={TEXT_LIMITS.primaryText}
                        placeholder="Ex.: Descubra como reduzir custos e ganhar previsibilidade na sua operação."
                        values={optionValues('primaryText')} onChange={values => setOptionValues('primaryText', values)} />
                      <OptionsField label="Título" limit={TEXT_LIMITS.title}
                        placeholder="Ex.: Planeje seus investimentos com segurança"
                        values={optionValues('title')} onChange={values => setOptionValues('title', values)} />
                      <OptionsField label="Descrição" limit={TEXT_LIMITS.description}
                        placeholder="Ex.: Atendimento especializado e condições exclusivas."
                        values={optionValues('description')} onChange={values => setOptionValues('description', values)} />
                      {usingTextVariations && (
                        <div style={{ fontSize: '11px', lineHeight: 1.5, color: 'var(--text-muted)', padding: '9px 11px', borderRadius: '8px', background: 'rgba(47,128,255,0.06)', border: '1px solid rgba(47,128,255,0.25)' }}>
                          A Meta testa as combinações e entrega a melhor para cada pessoa.
                          {(isAutoMsgDest || isLeadFormDest)
                            ? <strong style={{ color: '#f59e0b' }}> Neste destino (mensagens ou formulário) a Meta só aceita uma opção: vai a 1ª de cada campo.</strong>
                            : pairedStoryIds.size > 0 && <strong style={{ color: '#f59e0b' }}> Anúncios com Feed + Stories aceitam uma opção de cada campo: neles vai a 1ª. Os demais levam todas.</strong>}
                        </div>
                      )}
                      <SelectField label="CTA (Call to Action)" value={adsData.cta} onChange={val => setAdsData({ ...adsData, cta: val })} options={CTA_OPTIONS} />
                      </>}
                      {/* ── Bloco inteligente: URL / WhatsApp / formulário ── */}
                      {isAutoMsgDest ? (
                        <div style={{ padding: '12px 14px', background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.25)', borderRadius: '8px', fontSize: '12px', color: '#25d366', fontWeight: '600', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📱</span>
                            <span>
                              {MSG_OBJECTIVES.includes(activeObjective)
                                ? `Objetivo ${OBJECTIVE_LABEL(activeObjective)} detectado`
                                : `Destino ${detectedDestType} detectado`
                              } — URL desativada automaticamente
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '500' }}>
                            O criativo usará o link da página do Facebook e abrirá o WhatsApp/Messenger diretamente.
                          </span>
                          <div style={{ marginTop: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: '#25d366', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              💬 Mensagem pré-preenchida no WhatsApp
                            </label>
                            <input
                              type="text"
                              value={adsData.whatsappWelcomeMsg || ''}
                              onChange={e => setAdsData({ ...adsData, whatsappWelcomeMsg: e.target.value })}
                              placeholder="Olá! Gostaria de mais informações."
                              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(37,211,102,0.3)', background: 'rgba(37,211,102,0.04)', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                            />
                            <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                              Texto pré-preenchido quando o usuário clica no anúncio e abre o WhatsApp.
                            </p>
                          </div>
                        </div>
                      ) : needsUrl ? (
                        <>
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              URL de Destino {inheritanceCoversUrl ? <span style={{ color: '#93c5fd', textTransform: 'none', fontWeight: '600' }}>(herdada de cada conjunto)</span> : <span style={{ color: '#ef4444' }}>*</span>}
                            </label>
                            <input
                              type="text"
                              value={adsData.link}
                              onChange={e => setAdsData({ ...adsData, link: e.target.value })}
                              placeholder="https://..."
                              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${!adsData.link.trim() && !inheritanceCoversUrl ? 'rgba(239,68,68,0.5)' : 'var(--border-main)'}`, background: 'transparent', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                            />
                            {!adsData.link.trim() && !inheritanceCoversUrl && (
                              <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
                                Obrigatório para campanha de {OBJECTIVE_LABEL(activeObjective)}.
                              </p>
                            )}
                          </div>
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              UTM Tags (url_tags)
                            </label>
                            <textarea rows={3} value={adsData.utmTags} onChange={e => setAdsData({ ...adsData, utmTags: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-main)', background: 'transparent', color: 'var(--text-main)', fontSize: '11px', outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                            <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                              Variáveis Meta: {'{{placement}}'}, {'{{campaign.name}}'}, {'{{ad.id}}'}, etc.
                            </p>
                          </div>
                        </>
                      ) : isLeadFormDest ? (
                        <>
                          <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', fontSize: '12px', color: '#10b981', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            📋 Formulário Instantâneo — URL não necessária
                          </div>
                          <Field label="ID do Formulário de Lead (opcional)" value={adsData.leadFormId} onChange={e => setAdsData({ ...adsData, leadFormId: e.target.value })} placeholder="Ex: 1234567890123456" />
                          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '-8px', lineHeight: '1.4' }}>
                            Deixe em branco para criar o anúncio sem formulário vinculado.
                          </p>
                        </>
                      ) : null}

                      {/* Toggle manual — desabilitado quando detectado automaticamente */}
                      <div
                        onClick={() => !isAutoMsgDest && setForceMessagesDest(v => !v)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: isAutoMsgDest ? 'default' : 'pointer', userSelect: 'none', padding: '8px 0', opacity: isAutoMsgDest ? 0.45 : 1 }}
                        title={isAutoMsgDest ? 'Desativado — destino detectado automaticamente' : ''}
                      >
                        <div style={{ width: '32px', height: '18px', borderRadius: '9px', background: isAutoMsgDest ? 'var(--primary)' : 'var(--border-main)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                          <div style={{ position: 'absolute', top: '2px', left: isAutoMsgDest ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Campanha de WhatsApp / Mensagens
                          {isAutoMsgDest && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#25d366', fontWeight: '700' }}>(detectado automaticamente)</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        {activeTab !== 5 && activeTab !== 6 && <div style={{ padding: '14px 24px', backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          {activeTab > 0 ? (
            <button onClick={() => {
              setError(null);
              // Pular Tab 2 ao voltar quando conjunto existente selecionado
              if (activeTab === 3 && usingExistingAdSet) setActiveTab(1);
              else setActiveTab(a => a - 1);
            }} style={{ padding: '10px 20px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-muted)', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
              ← Voltar
            </button>
          ) : <div />}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Botão Salvar Rascunho */}
            <button
              onClick={saveDraft}
              title="Salvar todas as configurações como rascunho (sem publicar)"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '8px', background: draftSavedMsg ? 'rgba(16,185,129,0.12)' : 'transparent', border: `1px solid ${draftSavedMsg ? 'rgba(16,185,129,0.4)' : 'var(--border-light)'}`, color: draftSavedMsg ? '#10b981' : 'var(--text-muted)', fontWeight: '700', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}
            >
              {draftSavedMsg ? <><CheckCircle size={14} /> Salvo!</> : <><Download size={14} /> Salvar progresso</>}
            </button>

            {activeTab < 3 ? (
              <button onClick={goNext} className="btn-primary" style={{ padding: '10px 28px', borderRadius: '8px', fontWeight: '700' }}>
                Próximo →
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Toggle Rascunho */}
                <button
                  onClick={() => setCreateAsDraft(v => !v)}
                  title="Cria com status rascunho em vez de pausado"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '7px',
                    padding: '9px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '700',
                    border: `1px solid ${createAsDraft ? 'rgba(16,185,129,0.6)' : 'var(--border-main)'}`,
                    background: createAsDraft ? 'rgba(16,185,129,0.1)' : 'transparent',
                    color: createAsDraft ? 'var(--primary)' : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <span style={{
                    width: '14px', height: '14px', borderRadius: '3px',
                    border: `2px solid ${createAsDraft ? 'var(--primary)' : 'var(--text-muted)'}`,
                    background: createAsDraft ? 'var(--primary)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {createAsDraft && <span style={{ color: 'white', fontSize: '9px', fontWeight: '900', lineHeight: 1 }}>✓</span>}
                  </span>
                  Criar como rascunho na Meta
                </button>

                <button
                  onClick={handlePublishBatch}
                  disabled={mediaFiles.length === 0}
                  style={{
                    padding: '10px 28px', borderRadius: '8px', fontWeight: '800', fontSize: '14px',
                    background: mediaFiles.length === 0 ? 'var(--border-main)' : createAsDraft ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'linear-gradient(135deg, #1877F2, #0056d6)',
                    color: mediaFiles.length === 0 ? 'var(--text-muted)' : 'white', border: 'none',
                    cursor: mediaFiles.length === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    boxShadow: mediaFiles.length > 0 ? `0 6px 16px ${createAsDraft ? 'rgba(109,40,217,0.3)' : 'rgba(24,119,242,0.3)'}` : 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  <PlayCircle size={17} />
                  {createAsDraft
                    ? `Salvar Rascunho${adUnits.length > 0 ? ` (${adUnits.length})` : ''}`
                    : `Publicar ${adUnits.length > 0 ? `${adUnits.length} ad${adUnits.length > 1 ? 's' : ''}` : 'Lote'} na Meta`
                  }
                </button>
              </div>
            )}
          </div>
        </div>}
      </div>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
};

export default MetaAdCreator;
