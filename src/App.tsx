import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './providers/AuthProvider';
import { FiltersProvider } from './state/FiltersContext';
import { ProtectedRoute, AdminRoute, AgencyToolRoute } from './routes/guards';

import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TelaoPage } from './pages/public/TelaoPage';
import { RedirectPage } from './pages/public/RedirectPage';

import { ProjectLayout } from './components/layout/ProjectLayout';
import { AdminShell } from './components/layout/AdminShell';

import { PortfolioPage } from './pages/PortfolioPage';
import { Dashboard } from './pages/Dashboard';
import { CampaignsPage } from './pages/CampaignsPage';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { AdsPage } from './pages/AdsPage';
import { AdDetailPage } from './pages/AdDetailPage';
import { LeadsPage } from './pages/LeadsPage';
import { ComercialPage } from './pages/ComercialPage';
import { RankingPage } from './pages/RankingPage';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage';

import { AgencyHomePage } from './pages/admin/AgencyHomePage';
import { AgencyKanbanPage } from './pages/admin/AgencyKanbanPage';
import { DisparoKanbanPage } from './pages/admin/DisparoKanbanPage';
import { DisparoDashboardPage } from './pages/admin/DisparoDashboardPage';
import { ListSanitizerPage } from './pages/admin/ListSanitizerPage';
import { RedirectLinksPage } from './pages/admin/RedirectLinksPage';
import { InfobipTemplatesPage } from './pages/admin/InfobipTemplatesPage';
import { InfobipBroadcastsPage } from './pages/admin/InfobipBroadcastsPage';
import { ClientsListPage } from './pages/admin/ClientsListPage';
import { ClientDetailPage } from './pages/admin/ClientDetailPage';
import { AdminProjectsPage } from './pages/admin/AdminProjectsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AuditLogPage } from './pages/admin/AuditLogPage';
import { MetaAdsToolPage } from './pages/admin/MetaAdsToolPage';
import { AgencySettingsPage } from './pages/admin/AgencySettingsPage';
import { ClientDisparoPortalPage } from './pages/client/ClientDisparoPortalPage';

function App() {
  return (
    <AuthProvider>
      <FiltersProvider>
        <Routes>
          {/* Públicas */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="/telao/:token" element={<TelaoPage />} />
          <Route path="/r/:slug" element={<RedirectPage />} />

          {/* Autenticadas */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            {/* Portal externo do cliente: não usa AdminRoute nem o shell interno. */}
            <Route path="/cliente/demandas" element={<ClientDisparoPortalPage />} />
            <Route path="/cliente/:clientId/demandas" element={<ClientDisparoPortalPage />} />

            {/* Ferramentas liberadas individualmente. Admins têm acesso total; para
                os demais a AgencyToolRoute bloqueia inclusive acesso direto por URL. */}
            <Route element={<AgencyToolRoute tool="disparo.dashboard" />}>
              <Route element={<AdminShell />}>
                <Route path="/agency/disparo" element={<Navigate to="/agency/disparo/dashboard" replace />} />
                <Route path="/agency/disparo/dashboard" element={<DisparoDashboardPage />} />
              </Route>
            </Route>
            <Route element={<AgencyToolRoute tool="disparo.redirects" />}><Route element={<AdminShell />}><Route path="/agency/disparo/redirecionador" element={<RedirectLinksPage />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="disparo.templates" />}><Route element={<AdminShell />}><Route path="/agency/disparo/templates" element={<InfobipTemplatesPage />} /><Route path="/agency/disparo/template" element={<Navigate to="/agency/disparo/templates" replace />} /><Route path="/agency/disparo/tempelte" element={<Navigate to="/agency/disparo/templates" replace />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="disparo.broadcasts" />}><Route element={<AdminShell />}><Route path="/agency/disparo/transmissoes" element={<InfobipBroadcastsPage />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="disparo.request" />}><Route element={<AdminShell />}><Route path="/agency/disparo/solicitar" element={<ClientDisparoPortalPage />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="disparo.demands" />}><Route element={<AdminShell />}><Route path="/agency/disparo/demandas" element={<DisparoKanbanPage />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="disparo.sanitizer" />}><Route element={<AdminShell />}><Route path="/agency/disparo/higienizador" element={<ListSanitizerPage />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="disparo.report" />}><Route element={<AdminShell />}><Route path="/agency/disparo/relatorio" element={<DisparoDashboardPage reportOnly />} /></Route></Route>
            <Route element={<AgencyToolRoute tool="meta_ads" />}><Route element={<AdminShell />}><Route path="/agency/ferramentas/meta-ads" element={<MetaAdsToolPage />} /></Route></Route>

            {/* Projeto — o id na URL é a fonte de verdade */}
            <Route path="/project/:projectId" element={<ProjectLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="portfolio" element={<PortfolioPage />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="campanhas" element={<CampaignsPage />} />
              <Route path="campanhas/:campaignId" element={<CampaignDetailPage />} />
              <Route path="anuncios" element={<AdsPage />} />
              <Route path="anuncios/:adId" element={<AdDetailPage />} />
              <Route path="leads" element={<LeadsPage />} />
              <Route path="comercial" element={<ComercialPage />} />
              <Route path="comercial/ranking" element={<RankingPage />} />
              <Route path="configuracoes" element={<ProjectSettingsPage />} />
            </Route>

            {/* Administração — somente ADMIN */}
            <Route element={<AdminRoute />}>
              <Route element={<AdminShell />}>
                <Route path="/agency" element={<AgencyHomePage />} />
                <Route path="/agency/kanban" element={<AgencyKanbanPage />} />
                <Route path="/agency/ferramentas" element={<Navigate to="/agency/ferramentas/meta-ads" replace />} />
                <Route path="/agency/configuracoes" element={<AgencySettingsPage />} />
                <Route path="/admin/clients" element={<ClientsListPage />} />
                <Route path="/admin/clients/:clientId" element={<ClientDetailPage />} />
                <Route path="/admin/projects" element={<AdminProjectsPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/audit" element={<AuditLogPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </FiltersProvider>
    </AuthProvider>
  );
}

export default App;
