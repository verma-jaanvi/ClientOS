import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useMe } from '../../lib/auth';

export default function Layout() {
  const { me } = useMe();
  const nav = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg border px-3 py-1.5 text-sm ${isActive ? 'border-blue-500 bg-blue-50 font-medium' : 'border-transparent text-slate-600 hover:bg-slate-100'}`;
  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r bg-white p-4">
        <p className="mb-4 font-semibold">ClientOS</p>
        <nav className="space-y-1">
          <NavLink to="/app" end className={link}>Clients</NavLink>
          <NavLink to="/app/requests" className={link}>Requests</NavLink>
          <NavLink to="/app/settings" className={link}>Settings</NavLink>
        </nav>
        <div className="mt-8 text-xs text-slate-500">
          <p className="font-medium text-slate-700">{me.workspace.name}</p>
          <p>{me.user.email}</p>
          <button className="mt-2 underline" onClick={async () => { await supabase.auth.signOut(); nav('/login'); }}>Log out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6"><Outlet /></main>
    </div>
  );
}
