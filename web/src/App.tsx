import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, ToastProvider, useApp } from './context/AppContext';
import { Shell } from './components/Shell';
import { ExecBoard } from './pages/ExecBoard';
import { Dashboard } from './pages/Dashboard';
import { InitiativesList } from './pages/InitiativesList';
import { InitiativeDetailPage } from './pages/InitiativeDetail';
import { MyWork } from './pages/MyWork';
import { Approvals } from './pages/Approvals';
import { Matrix, Leaderboard, Tasks, Notifications, AuditTrail } from './pages/Reports';
import { AdminUsers, AdminAccess, AdminMail, AdminSettings } from './pages/Admin';
import './lib/chartSetup';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Financial figures should not silently change under a user mid-sentence
      // in a review, so nothing refetches on window focus. Mutations
      // invalidate explicitly instead.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Guards a route behind a permission the server also enforces. */
function Require({ permission, children }: { permission: string; children: JSX.Element }) {
  const { can } = useApp();
  if (!can(permission)) return <Navigate to="/dashboard" replace />;
  return children;
}

/**
 * Landing route.
 *
 * Leadership goes straight to the board; everyone who has work to submit goes
 * to their own queue; PMO and viewers land on the dashboard. Choosing the
 * right first screen per role saves every user one navigation on every visit.
 */
function Home() {
  const { session } = useApp();
  if (session.user.role === 'visl_exec') return <Navigate to="/exec" replace />;
  if (['owner', 'contributor'].includes(session.user.role)) return <Navigate to="/my-work" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <AppProvider>
          <ToastProvider>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<Home />} />
                <Route path="exec" element={<Require permission="exec:view"><ExecBoard /></Require>} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="matrix" element={<Matrix />} />
                <Route path="leaderboard" element={<Leaderboard />} />
                <Route path="my-work" element={<MyWork />} />
                <Route path="initiatives" element={<InitiativesList />} />
                <Route path="initiatives/:id" element={<InitiativeDetailPage />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="approvals" element={<Require permission="actual:approve"><Approvals /></Require>} />
                <Route path="audit" element={<Require permission="audit:view"><AuditTrail /></Require>} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="admin/users" element={<Require permission="user:manage"><AdminUsers /></Require>} />
                <Route path="admin/access" element={<Require permission="user:manage"><AdminAccess /></Require>} />
                <Route path="admin/mail" element={<Require permission="mail:manage"><AdminMail /></Require>} />
                <Route path="admin/settings" element={<Require permission="settings:manage"><AdminSettings /></Require>} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </ToastProvider>
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
