import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './providers/AuthProvider';
import { FiltersProvider } from './state/FiltersContext';
import { ProtectedRoute, AdminRoute } from './routes/guards';

import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TelaoPage } from './pages/public/TelaoPage';

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
import { ClientsListPage } from './pages/admin/ClientsListPage';
import { ClientDetailPage } from './pages/admin/ClientDetailPage';
import { AdminProjectsPage } from './pages/admin/AdminProjectsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AuditLogPage } from './pages/admin/AuditLogPage';

function App() {
  return (
    <AuthProvider>
      <FiltersProvider>
        <Routes>
          {/* Públicas */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="/telao/:token" element={<TelaoPage />} />

          {/* Autenticadas */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />

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
