import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  clients as initialClients,
  projects as initialProjects,
  createClient as createClientRecord,
} from '../data/mockData';
import { presetToRange } from '../lib/metrics';
import { defaultRankingSettings } from '../lib/comercial';
import type {
  Annotation,
  Client,
  DateRange,
  DateRangePreset,
  Lead,
  PointsTransaction,
  Project,
  RankingSettings,
} from '../types';

export type Role = 'agencia' | 'cliente';

interface FiltersContextValue {
  clients: Client[];
  activeClientId: string;
  activeClient: Client | undefined;
  switchClient: (clientId: string) => void;
  addClient: (name: string, segment: string) => Client;
  role: Role;
  setRole: (role: Role) => void;
  projects: Project[];
  clientProjects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  selectedProject: Project | undefined;
  hasEnteredProject: boolean;
  enterProject: (id: string) => void;
  createProject: (project: Omit<Project, 'id'>) => Project;
  setProjectCampaigns: (projectId: string, campaignIds: string[]) => void;
  setProjectGoals: (projectId: string, leadGoal: number, cplGoal: number, monthlyLeadGoal: number) => void;
  dateRange: DateRange;
  setPreset: (preset: DateRangePreset) => void;
  setCustomRange: (start: string, end: string) => void;
  isConfigOpen: boolean;
  openConfig: () => void;
  closeConfig: () => void;
  importedLeads: Lead[];
  addImportedLeads: (newLeads: Lead[]) => void;
  annotations: Annotation[];
  addAnnotation: (projectId: string, date: string, text: string) => void;
  removeAnnotation: (id: string) => void;
  rankingSettings: RankingSettings;
  setRankingSettings: (settings: RankingSettings) => void;
  pointsLedger: PointsTransaction[];
  addPointsTransaction: (tx: Omit<PointsTransaction, 'id' | 'at'>) => void;
  goalsVersion: number;
  bumpGoalsVersion: () => void;
  /**
   * Amarra um projeto real (Supabase) a um conjunto de dados de demonstração.
   * Ponte temporária da Fase 1: campanhas/anúncios/leads/vendas ainda são mock.
   * Sai de cena quando a integração com a Meta entrar (Fase 2).
   */
  bindDemoDataset: (realProjectId: string, goals: RealGoals | null) => void;
}

export interface RealGoals {
  lead_goal: number | null;
  cpl_goal: number | null;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [clientsState, setClientsState] = useState<Client[]>(initialClients);
  const [activeClientId, setActiveClientId] = useState(initialClients[0].id);
  const [role, setRole] = useState<Role>('agencia');

  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjects[0].id);
  const [hasEnteredProject, setHasEnteredProject] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({
    preset: '7d',
    ...presetToRange('7d'),
  });
  const [isConfigOpen, setConfigOpen] = useState(false);
  const [importedLeads, setImportedLeads] = useState<Lead[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [rankingSettings, setRankingSettings] = useState<RankingSettings>(defaultRankingSettings);
  const [pointsLedger, setPointsLedger] = useState<PointsTransaction[]>([]);
  const [goalsVersion, setGoalsVersion] = useState(0);

  // Hash estável do UUID real → índice no dataset de demonstração, para que o
  // mesmo projeto caia sempre no mesmo conjunto de dados entre recarregamentos.
  const bindDemoDataset = useCallback(
    (realProjectId: string, goals: RealGoals | null) => {
      let hash = 0;
      for (let i = 0; i < realProjectId.length; i++) {
        hash = (Math.imul(31, hash) + realProjectId.charCodeAt(i)) | 0;
      }
      const demo = initialProjects[Math.abs(hash) % initialProjects.length];

      setSelectedProjectId(demo.id);
      setActiveClientId(demo.clientId);
      setHasEnteredProject(true);

      if (goals) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === demo.id
              ? {
                  ...p,
                  leadGoal: goals.lead_goal ?? p.leadGoal,
                  cplGoal: goals.cpl_goal ?? p.cplGoal,
                  monthlyLeadGoal: goals.lead_goal ?? p.monthlyLeadGoal,
                }
              : p
          )
        );
      }
    },
    []
  );

  const activeClient = useMemo(
    () => clientsState.find((c) => c.id === activeClientId),
    [clientsState, activeClientId]
  );
  const clientProjects = useMemo(
    () => projects.filter((p) => p.clientId === activeClientId),
    [projects, activeClientId]
  );
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const value: FiltersContextValue = {
    clients: clientsState,
    activeClientId,
    activeClient,
    switchClient: (clientId) => {
      setActiveClientId(clientId);
      setHasEnteredProject(false);
    },
    addClient: (name, segment) => {
      const created = createClientRecord(name, segment);
      setClientsState((prev) => [...prev, created]);
      return created;
    },
    role,
    setRole,
    projects,
    clientProjects,
    selectedProjectId,
    setSelectedProjectId,
    selectedProject,
    hasEnteredProject,
    enterProject: (id) => {
      setSelectedProjectId(id);
      setHasEnteredProject(true);
      const project = projects.find((p) => p.id === id);
      if (project) setActiveClientId(project.clientId);
    },
    createProject: (project) => {
      const created: Project = { ...project, id: `proj-custom-${Date.now()}` };
      setProjects((prev) => [...prev, created]);
      return created;
    },
    setProjectCampaigns: (projectId, campaignIds) =>
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, campaignIds } : p))
      ),
    setProjectGoals: (projectId, leadGoal, cplGoal, monthlyLeadGoal) =>
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, leadGoal, cplGoal, monthlyLeadGoal } : p))
      ),
    dateRange,
    setPreset: (preset) =>
      setDateRange(
        preset === 'custom'
          ? { preset, start: dateRange.start, end: dateRange.end }
          : { preset, ...presetToRange(preset) }
      ),
    setCustomRange: (start, end) => setDateRange({ preset: 'custom', start, end }),
    isConfigOpen,
    openConfig: () => setConfigOpen(true),
    closeConfig: () => setConfigOpen(false),
    importedLeads,
    addImportedLeads: (newLeads) => setImportedLeads((prev) => [...newLeads, ...prev]),
    annotations,
    addAnnotation: (projectId, date, text) =>
      setAnnotations((prev) => [
        ...prev,
        { id: `annot-${Date.now()}`, projectId, date, text },
      ]),
    removeAnnotation: (id) => setAnnotations((prev) => prev.filter((a) => a.id !== id)),
    rankingSettings,
    setRankingSettings,
    pointsLedger,
    addPointsTransaction: (tx) =>
      setPointsLedger((prev) => [
        { ...tx, id: `tx-${Date.now()}-${prev.length}`, at: new Date().toISOString() },
        ...prev,
      ]),
    goalsVersion,
    bumpGoalsVersion: () => setGoalsVersion((v) => v + 1),
    bindDemoDataset,
  };

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used within FiltersProvider');
  return ctx;
}
