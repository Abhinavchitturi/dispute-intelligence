import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ListFilter,
  ShieldAlert,
  GitCompare,
  TrendingUp,
  ScrollText,
  Settings,
  Search,
  RotateCcw,
  ExternalLink,
  ChevronRight,
  Database,
  CheckCircle2,
  Sparkles,
  UserCheck
} from 'lucide-react';
import { resetDemoData } from '../../api/client';

export function AppShell() {
  const [searchVal, setSearchVal] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchVal.trim()) {
      navigate(`/queue?search=${encodeURIComponent(searchVal.trim())}`);
    }
  };

  const handleResetData = async () => {
    try {
      setIsResetting(true);
      await resetDemoData();
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 3000);
      window.location.reload();
    } catch (err) {
      alert('Failed to reset demo data.');
    } finally {
      setIsResetting(false);
    }
  };

  const navItems = [
    { name: 'Overview', to: '/', icon: LayoutDashboard },
    { name: 'Dispute Queue', to: '/queue', icon: ListFilter },
    { name: 'Case Investigation', to: '/investigate/DEMO-DSP-1042', icon: ShieldAlert },
    { name: 'Similar Cases', to: '/similar', icon: GitCompare },
    { name: 'Pattern Insights', to: '/patterns', icon: TrendingUp },
    { name: 'Audit Trail', to: '/audit', icon: ScrollText },
    { name: 'Settings & Integrations', to: '/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-[#070D1E] text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0B132B] border-r border-[#1E293B] flex flex-col flex-shrink-0 select-none">
        {/* Brand Header */}
        <div className="p-5 border-b border-[#1E293B] flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-bold">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-bold tracking-tight text-white text-lg">ResolveIQ</span>
              <span className="text-[10px] font-mono uppercase bg-blue-950 text-blue-400 border border-blue-800 px-1.5 py-0.2 rounded font-semibold">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">PayPal Dispute Intelligence</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Investigation Workspace
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                      : 'text-slate-300 hover:bg-[#161F38] hover:text-white'
                  }`
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Demo Mode Notice Box */}
        <div className="p-4 m-3 rounded-lg bg-[#111A33] border border-[#233054] text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold text-slate-200 flex items-center space-x-1">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span>Environment</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-purple-900/40 text-purple-300 border border-purple-700/50">
              DEMO DATA
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5">
            Operating on 12 seeded disputes & 20 historical precedents. PayPal Sandbox actions simulate safely.
          </p>
          <button
            onClick={handleResetData}
            disabled={isResetting}
            className="w-full flex items-center justify-center space-x-1.5 px-2.5 py-1.5 bg-[#1C2541] hover:bg-[#233054] text-slate-200 rounded text-[11px] font-medium border border-slate-700/60 transition"
          >
            <RotateCcw className={`w-3 h-3 ${isResetting ? 'animate-spin' : ''}`} />
            <span>{isResetting ? 'Resetting...' : resetSuccess ? 'Seeded Fresh!' : 'Reset Demo Data'}</span>
          </button>
        </div>

        {/* User Card */}
        <div className="p-3 border-t border-[#1E293B] flex items-center space-x-3 bg-[#0B132B]">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-white">
            SJ
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">Sarah Jenkins</p>
            <p className="text-[10px] text-slate-400 truncate">Senior Dispute Investigator</p>
          </div>
          <UserCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-14 bg-[#0B132B]/80 backdrop-blur border-b border-[#1E293B] flex items-center justify-between px-6 z-10">
          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} className="relative w-96">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search disputes, transactions, buyers (e.g. 1042)..."
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition"
            />
          </form>

          {/* Right Header Status Badges */}
          <div className="flex items-center space-x-3 text-xs">
            {/* Tagline / Environment Pill */}
            <div className="hidden lg:flex items-center space-x-2 px-3 py-1 bg-[#161F38] border border-[#233054] rounded-full text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-[11px] font-medium">Demo Mode • Verified Evidence Rules Active</span>
            </div>

            <div className="h-4 w-px bg-slate-700 hidden lg:block" />

            <div className="text-[11px] text-slate-400 hidden sm:block">
              Tagline: <span className="text-slate-200 italic font-normal">"Every claim. Every source. One clearer investigation."</span>
            </div>
          </div>
        </header>

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#070D1E]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
