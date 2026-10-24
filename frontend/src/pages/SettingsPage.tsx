import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Settings,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Key,
  ExternalLink,
  Cpu,
  Database,
  Info
} from 'lucide-react';
import {
  fetchIntegrationStatus,
  testPayPalConnectivity,
  testAIConnectivity,
  resetDemoData
} from '../api/client';

export function SettingsPage() {
  const [testingPayPal, setTestingPayPal] = useState(false);
  const [payPalTestResult, setPayPalTestResult] = useState<any | null>(null);

  const [testingAI, setTestingAI] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<any | null>(null);

  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['integrationStatus'],
    queryFn: fetchIntegrationStatus,
  });

  const handleTestPayPal = async () => {
    try {
      setTestingPayPal(true);
      const res = await testPayPalConnectivity();
      setPayPalTestResult(res);
    } catch (e: any) {
      setPayPalTestResult({ connected: false, message: e.message });
    } finally {
      setTestingPayPal(false);
    }
  };

  const handleTestAI = async () => {
    try {
      setTestingAI(true);
      const res = await testAIConnectivity();
      setAiTestResult(res);
    } catch (e: any) {
      setAiTestResult({ connected: false, message: e.message });
    } finally {
      setTestingAI(false);
    }
  };

  const handleResetData = async () => {
    try {
      setResetting(true);
      const res = await resetDemoData();
      setResetMessage(res.message);
      setTimeout(() => setResetMessage(null), 4000);
      refetch();
    } catch (e: any) {
      alert('Failed to reset demo data.');
    } finally {
      setResetting(false);
    }
  };

  if (isLoading || !status) {
    return (
      <div className="py-16 text-center text-slate-400 text-xs">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        Checking system integration configurations...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Settings &amp; Integration Connectivity</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Inspect sandbox credentials status, AI provider fallback readiness, and local database environments.
        </p>
      </div>

      {/* Mode Status Card */}
      <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 uppercase font-semibold">Active Application Mode:</span>
            <span className="text-xs px-2.5 py-0.5 rounded font-mono font-bold uppercase bg-purple-950 text-purple-300 border border-purple-800">
              {status.environment_mode.toUpperCase()} MODE
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
            In Demo mode, ResolveIQ uses deterministic synthetic records and rules-based brief generation.
            Actions are safely simulated without modifying live payment balances.
          </p>
        </div>

        <button
          onClick={handleResetData}
          disabled={resetting}
          className="flex items-center space-x-1.5 px-3 py-2 bg-[#161F38] hover:bg-[#233054] text-slate-200 rounded-lg text-xs font-semibold border border-[#233054] transition disabled:opacity-50 self-start md:self-auto"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
          <span>{resetting ? 'Resetting DB...' : resetMessage || 'Reset Demo Dataset'}</span>
        </button>
      </div>

      {/* Integration Checks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* PayPal Sandbox Box */}
        <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1E293B]">
            <div className="flex items-center space-x-2">
              <Key className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white">PayPal Sandbox REST API</h2>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                status.paypal.configured
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-amber-950 text-amber-300 border border-amber-800'
              }`}
            >
              {status.paypal.configured ? 'CONFIGURED' : 'UNCONFIGURED (DEMO FALLBACK)'}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[#161F38]">
              <span className="text-slate-400">Environment Endpoint</span>
              <span className="font-mono text-slate-200">{status.paypal.base_url}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#161F38]">
              <span className="text-slate-400">PAYPAL_CLIENT_ID</span>
              <span className="font-mono text-slate-200">
                {status.paypal.client_id_configured ? '•••••••• [Configured]' : 'Not Configured'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#161F38]">
              <span className="text-slate-400">PAYPAL_CLIENT_SECRET</span>
              <span className="font-mono text-slate-200">
                {status.paypal.client_secret_configured ? '•••••••• [Configured]' : 'Not Configured'}
              </span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleTestPayPal}
              disabled={testingPayPal}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-blue-600/20 transition disabled:opacity-50"
            >
              {testingPayPal ? 'Executing Handshake...' : 'Test PayPal Sandbox Connection'}
            </button>
          </div>

          {payPalTestResult && (
            <div
              className={`p-3 rounded-lg text-xs space-y-1 ${
                payPalTestResult.connected
                  ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/40 border border-rose-800 text-rose-300'
              }`}
            >
              <div className="font-semibold flex items-center space-x-1.5">
                {payPalTestResult.connected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
                <span>{payPalTestResult.connected ? 'Handshake Succeeded' : 'Handshake Failed'}</span>
              </div>
              <p className="text-[11px]">{payPalTestResult.message}</p>
            </div>
          )}
        </div>

        {/* AI Provider Box */}
        <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1E293B]">
            <div className="flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-purple-400" />
              <h2 className="text-sm font-bold text-white">AI Provider &amp; Fallback Engine</h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
              OPERATIONAL
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[#161F38]">
              <span className="text-slate-400">Configured Provider</span>
              <span className="font-mono text-slate-200 uppercase">{status.ai_provider.provider}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#161F38]">
              <span className="text-slate-400">Deterministic Rule Engine</span>
              <span className="font-semibold text-emerald-400">Always Active (Offline Ready)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#161F38]">
              <span className="text-slate-400">Citation Validator</span>
              <span className="font-semibold text-emerald-400">Enforced</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleTestAI}
              disabled={testingAI}
              className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-purple-600/20 transition disabled:opacity-50"
            >
              {testingAI ? 'Verifying...' : 'Test Intelligence Engine'}
            </button>
          </div>

          {aiTestResult && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 space-y-1">
              <div className="font-semibold flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{aiTestResult.service}</span>
              </div>
              <p className="text-[11px] text-emerald-200">{aiTestResult.message}</p>
            </div>
          )}
        </div>
      </div>

      {/* Feature Availability Matrix */}
      <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B]">
        <h2 className="text-sm font-bold text-white mb-3">Feature Capability Matrix</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {Object.entries(status.features_available).map(([k, v]) => (
            <div key={k} className="p-3 rounded-lg bg-[#161F38] border border-[#233054] flex items-center justify-between">
              <span className="text-slate-300 capitalize">{k.replace(/_/g, ' ')}</span>
              {v ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  READY
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  OPTIONAL
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Setup Instructions / Environment Documentation */}
      <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center space-x-2">
          <Info className="w-4 h-4 text-blue-400" />
          <span>Configuring Live PayPal Sandbox Credentials</span>
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          To switch from Demo mode to PayPal Sandbox mode, create a PayPal Developer Sandbox App at{' '}
          <a
            href="https://developer.paypal.com/dashboard/applications/sandbox"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline inline-flex items-center"
          >
            developer.paypal.com <ExternalLink className="w-3 h-3 ml-1" />
          </a>{' '}
          and add your keys to the backend <code className="text-slate-200 font-mono">.env</code> file:
        </p>

        <div className="p-3 rounded-lg bg-[#070D1E] border border-[#233054] text-[11px] font-mono text-slate-300 overflow-x-auto">
          <div>RESOLVEIQ_MODE=sandbox</div>
          <div>PAYPAL_CLIENT_ID=your_sandbox_client_id</div>
          <div>PAYPAL_CLIENT_SECRET=your_sandbox_client_secret</div>
          <div>AI_PROVIDER=gemini # optional</div>
          <div>AI_API_KEY=your_gemini_api_key # optional</div>
        </div>
      </div>
    </div>
  );
}
