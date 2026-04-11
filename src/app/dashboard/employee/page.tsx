'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Store { id: string; name: string; }
interface Upload {
  id: string;
  store_id: string;
  store_name: string;
  file_name: string;
  file_type: string;
  records_imported: number;
  records_updated: number;
  records_duplicate: number;
  status: string;
  error_message: string | null;
  created_at: string;
}
interface EmployeeInfo { id: string; name: string; email: string; role: string; }

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function EmployeeDashboard() {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [selectedStore, setSelectedStore] = useState('');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/dashboard');
      if (!res.ok) { router.push('/login'); return; }
      const data = await res.json();
      setEmployee(data.employee || null);
      setStores(data.stores || []);
      setUploads(data.recentUploads || []);
      if (data.stores?.length === 1) setSelectedStore(data.stores[0].id);
    } catch {
      router.push('/login');
    }
    setLoading(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!selectedStore || !csvText || !employee) return;
    setImporting(true);
    setImportResult(null);
    const res = await fetch('/api/shopify-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: selectedStore,
        csvText,
        employeeId: employee.id,
        fileName,
      }),
    });
    setImportResult(await res.json());
    setImporting(false);
    setCsvText('');
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
    loadDashboard();
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  const selectedStoreName = stores.find(s => s.id === selectedStore)?.name;

  return (
    <div className="min-h-screen bg-slate-950 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Welcome, {employee?.name}</h1>
          <p className="text-sm text-slate-400 mt-1">{employee?.role?.replace('_', ' ')} — {employee?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
        >
          Sign Out
        </button>
      </div>

      {/* Upload Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-1">Upload Files</h2>
        <p className="text-xs text-slate-500 mb-5">Upload Shopify billing or Chargeflow invoice CSVs. Format is auto-detected.</p>

        {stores.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400">No stores assigned to you yet.</p>
            <p className="text-xs text-slate-500 mt-1">Ask your admin to assign stores to your account.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1">Store</label>
                <select
                  value={selectedStore}
                  onChange={(e) => { setSelectedStore(e.target.value); setImportResult(null); }}
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select store...</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1">CSV File</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFile}
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-300 file:cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleImport}
                disabled={!selectedStore || !csvText || importing}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {importing ? 'Importing...' : 'Import CSV'}
              </button>
              {fileName && <span className="text-xs text-slate-400">{fileName}</span>}
            </div>

            {importResult && (
              <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${
                importResult.success
                  ? 'bg-emerald-900/20 border border-emerald-800/30 text-emerald-400'
                  : 'bg-red-900/20 border border-red-800/30 text-red-400'
              }`}>
                {importResult.success
                  ? `${importResult.imported} imported, ${importResult.updated || 0} updated, ${importResult.duplicates} unchanged (${importResult.format})`
                  : importResult.error || 'Import failed'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Recent Uploads */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Your Recent Uploads</h2>
        </div>

        {uploads.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-slate-500">No uploads yet. Import a CSV file above to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-left px-5 py-3">Store</th>
                  <th className="text-left px-5 py-3">File</th>
                  <th className="text-left px-5 py-3">Type</th>
                  <th className="text-center px-5 py-3">Records</th>
                  <th className="text-center px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map(u => (
                  <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-slate-400 text-xs">{u.created_at?.split('T')[0] || u.created_at}</td>
                    <td className="px-5 py-3 text-white">{u.store_name}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs font-mono truncate max-w-[150px]">{u.file_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        u.file_type === 'chargeflow' ? 'bg-violet-900/30 text-violet-400' : 'bg-emerald-900/30 text-emerald-400'
                      }`}>{u.file_type}</span>
                    </td>
                    <td className="px-5 py-3 text-center text-slate-300 text-xs">
                      {u.records_imported} new{u.records_updated > 0 ? `, ${u.records_updated} updated` : ''}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        u.status === 'success' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
                      }`}>{u.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
