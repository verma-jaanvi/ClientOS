import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './lib/auth';
import Layout from './pages/agency/Layout';
import { Login, Signup } from './pages/agency/AuthPages';
import Join from './pages/agency/Join';
import Dashboard from './pages/agency/Dashboard';
import ClientDetail from './pages/agency/ClientDetail';
import ProjectPage from './pages/agency/ProjectPage';
import DeliverablePage from './pages/agency/DeliverablePage';
import RequestsPage from './pages/agency/RequestsPage';
import Settings from './pages/agency/Settings';
import ClientApp from './pages/client/ClientApp';

export default function App() {
  return (
    <Routes>
      {/* Client screens: magic link only, no account */}
      <Route path="/c/:token" element={<ClientApp />} />

      {/* Agency screens */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/join" element={<Join />} />
      <Route path="/app" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="deliverables/:id" element={<DeliverablePage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
