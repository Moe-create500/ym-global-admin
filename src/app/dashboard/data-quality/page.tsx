'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Issue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  store_id: string;
  store_name: string;
  title: string;
  detail: string;
  action: string;
  link?: string;
}

interface Summary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  stores_checked: number;
}

const severityConfig = {
  critical: { bg: 'bg-red-900/20', border: 'border-red-800/50', text: 'text-red-400', badge: 'bg-red-900/50 text-red-300', label: 'Critical' },
  warning: { bg: 'bg-amber-900/20', border: 'border-amber-800/50', text: 'text-amber-400', badge: 'bg-amber-900/50 text-amber-300', label: 'Warning' },
  info: { bg: 'bg-blue-900/20', border: 'border-blue-800/50', text: 'text-blue-400', badge: 'bg-blue-900/50 text-blue-300', label: 'Info' },
};

export default function DataQualityPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const res = await fetch('/api/data-quality');
    const data = await res.json();
    setIssues(data.issues || []);
    setSummary(data.summary || null);
    setLastChecked(new Date().toLocaleTimeString());
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  const filtered = filter === 'all' ? issues : issues.filter(i => i.severity === filter);

  // Group by category
  const categories = [...new Set(filtered.map(i => i.category))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Data Quality</h1>
          <p className="text-sm text-slate-400 mt-1">
            {summary?.stores_checked} stores checked — last scan {lastChecked}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
        >
          {refreshing ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Re-scan
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <button onClick={() => setFilter('all')}
            className={`bg-slate-900 border rounded-xl p-4 text-left transition-colors ${filter === 'all' ? 'border-blue-500' : 'border-slate-800 hover:border-slate-700'}`}>
            <p className="text-xs text-slate-500 uppercase mb-1">Total Issues</p>
            <p className={`text-2xl font-bold ${summary.total === 0 ? 'text-emerald-400' : 'text-white'}`}>
              {summary.total === 0 ? 'All Clear' : summary.total}
            </p>
          </button>
          <button onClick={() => setFilter('critical')}
            className={`bg-slate-900 border rounded-xl p-4 text-left transition-colors ${filter === 'critical' ? 'border-red-500' : 'border-slate-800 hover:border-slate-700'}`}>
            <p className="text-xs text-slate-500 uppercase mb-1">Critical</p>
            <p className={`text-2xl font-bold ${summary.critical > 0 ? 'text-red-400' : 'text-slate-600'}`}>{summary.critical}</p>
          </button>
          <button onClick={() => setFilter('warning')}
            className={`bg-slate-900 border rounded-xl p-4 text-left transition-colors ${filter === 'warning' ? 'border-amber-500' : 'border-slate-800 hover:border-slate-700'}`}>
            <p className="text-xs text-slate-500 uppercase mb-1">Warnings</p>
            <p className={`text-2xl font-bold ${summary.warning > 0 ? 'text-amber-400' : 'text-slate-600'}`}>{summary.warning}</p>
          </button>
          <button onClick={() => setFilter('info')}
            className={`bg-slate-900 border rounded-xl p-4 text-left transition-colors ${filter === 'info' ? 'border-blue-500' : 'border-slate-800 hover:border-slate-700'}`}>
            <p className="text-xs text-slate-500 uppercase mb-1">Info</p>
            <p className={`text-2xl font-bold ${summary.info > 0 ? 'text-blue-400' : 'text-slate-600'}`}>{summary.info}</p>
          </button>
        </div>
      )}

      {/* Issues List */}
      {filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">OK</div>
          <p className="text-emerald-400 font-semibold text-lg">No issues found</p>
          <p className="text-slate-500 text-sm mt-1">All data checks passed</p>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(category => (
            <div key={category}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{category}</h2>
              <div className="space-y-2">
                {filtered.filter(i => i.category === category).map(issue => {
                  const config = severityConfig[issue.severity];
                  return (
                    <div key={issue.id} className={`${config.bg} border ${config.border} rounded-lg px-4 py-3`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${config.badge}`}>
                              {config.label}
                            </span>
                            <span className="text-xs font-medium text-slate-400">{issue.store_name}</span>
                          </div>
                          <p className={`text-sm font-medium ${config.text}`}>{issue.title}</p>
                          <p className="text-xs text-slate-400 mt-1">{issue.detail}</p>
                          <p className="text-xs text-slate-500 mt-1.5">
                            <span className="text-slate-600">Action:</span> {issue.action}
                          </p>
                        </div>
                        {issue.link && (
                          <Link
                            href={issue.link}
                            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
