'use client';

import { useEffect, useState, useRef } from 'react';

interface SSClient {
  id: string;
  companyName: string;
  email: string;
  isActive: boolean;
}

interface Store {
  id: string;
  name: string;
  shopify_domain: string | null;
  shipsourced_client_id: string | null;
  shipsourced_client_name: string | null;
  last_synced_at: string | null;
  auto_sync: number;
  sync_start_date: string | null;
  chargeflow_api_key: string | null;
}

interface SyncLog {
  id: string;
  sync_type: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'Z');
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SettingsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [clients, setClients] = useState<SSClient[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [fetchingClients, setFetchingClients] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [syncingStore, setSyncingStore] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<Record<string, string>>({});

  // CSV Import state
  const [importStoreId, setImportStoreId] = useState('');
  const [csvRows, setCsvRows] = useState<any[] | null>(null);
  const [csvFileName, setCsvFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    loadStores();
    loadSyncLogs();
    fetchClients();
  }, []);

  async function loadStores() {
    const res = await fetch('/api/stores');
    const data = await res.json();
    setStores(data.stores || []);
  }

  async function loadSyncLogs() {
    try {
      const res = await fetch('/api/sync/log');
      const data = await res.json();
      setSyncLogs(data.logs || []);
    } catch {}
  }

  async function fetchClients() {
    setFetchingClients(true);
    setClientError(null);
    try {
      const res = await fetch('/api/sync/clients');
      const data = await res.json();
      if (data.error) {
        setClientError(data.error);
        setClients([]);
      } else {
        setClients(data.clients || []);
      }
    } catch {
      setClientError('Failed to connect to ShipSourced. Check SHIPSOURCED_API_TOKEN in .env');
      setClients([]);
    }
    setFetchingClients(false);
  }

  async function linkStore(storeId: string, clientId: string, clientName: string) {
    setSaving(storeId);
    setSyncMessage(prev => ({ ...prev, [storeId]: 'Connecting & syncing...' }));
    const res = await fetch(`/api/stores/${storeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipsourcedClientId: clientId, shipsourcedClientName: clientName }),
    });
    const data = await res.json();
    if (data.syncResult?.synced) {
      setSyncMessage(prev => ({ ...prev, [storeId]: `Connected! Synced ${data.syncResult.synced} records` }));
    } else if (data.syncResult?.error) {
      setSyncMessage(prev => ({ ...prev, [storeId]: `Connected. Sync error: ${data.syncResult.error}` }));
    } else {
      setSyncMessage(prev => ({ ...prev, [storeId]: 'Connected!' }));
    }
    setSaving(null);
    loadStores();
    loadSyncLogs();
    setTimeout(() => setSyncMessage(prev => { const n = { ...prev }; delete n[storeId]; return n; }), 5000);
  }

  async function unlinkStore(storeId: string) {
    if (!confirm('Unlink this store from ShipSourced?')) return;
    setSaving(storeId);
    await fetch(`/api/stores/${storeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipsourcedClientId: '', shipsourcedClientName: '' }),
    });
    setSaving(null);
    setSyncMessage(prev => ({ ...prev, [storeId]: 'Unlinked' }));
    loadStores();
    setTimeout(() => setSyncMessage(prev => { const n = { ...prev }; delete n[storeId]; return n; }), 3000);
  }

  async function syncSingleStore(storeId: string) {
    setSyncingStore(storeId);
    setSyncMessage(prev => ({ ...prev, [storeId]: 'Syncing...' }));
    const res = await fetch(`/api/sync/shipsourced?storeId=${storeId}`, { method: 'POST' });
    const data = await res.json();
    setSyncingStore(null);
    setSyncMessage(prev => ({ ...prev, [storeId]: `Synced ${data.synced || 0} records` }));
    loadStores();
    loadSyncLogs();
    setTimeout(() => setSyncMessage(prev => { const n = { ...prev }; delete n[storeId]; return n; }), 5000);
  }

  async function saveSyncStartDate(storeId: string, date: string) {
    setSaving(storeId);
    await fetch(`/api/stores/${storeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncStartDate: date || null }),
    });
    setSaving(null);
    setSyncMessage(prev => ({ ...prev, [storeId]: date ? `Sync cutoff set to ${date}` : 'Sync cutoff removed' }));
    loadStores();
    setTimeout(() => setSyncMessage(prev => { const n = { ...prev }; delete n[storeId]; return n; }), 3000);
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setCsvRows(null);
        return;
      }

      const header = lines[0].toLowerCase().split(',').map(h => h.trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim());
        const row: any = {};
        header.forEach((h, idx) => { row[h] = vals[idx] || ''; });
        if (row.date) rows.push(row);
      }
      setCsvRows(rows);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!importStoreId || !csvRows) return;
    setImporting(true);
    setImportResult(null);
    const res = await fetch('/api/pnl/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: importStoreId, rows: csvRows }),
    });
    const data = await res.json();
    setImportResult(data);
    setImporting(false);
    if (data.success) {
      loadStores();
    }
  }

  function downloadTemplate() {
    const header = 'date,revenue,orders,cogs,shipping,pick_pack,packaging,ad_spend,shopify_fees,other_costs';
    const sample = '2026-01-15,1500.00,25,350.00,200.00,50.00,10.00,300.00,45.00,0';
    const csv = header + '\n' + sample + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'daily_pnl_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const [linkingClient, setLinkingClient] = useState<string | null>(null);

  const usedClientIds = new Set(stores.filter(s => s.shipsourced_client_id).map(s => s.shipsourced_client_id));
  const availableClients = clients.filter(c => !usedClientIds.has(c.id));
  const unlinkedStores = stores.filter(s => !s.shipsourced_client_id);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Settings</h1>
      <p className="text-sm text-slate-400 mb-6">Connect stores, configure sync, and import historical data</p>

      {/* ShipSourced Connection Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-white">ShipSourced Connection</h2>
            {fetchingClients ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400" />
                <span className="text-xs text-slate-400">Loading clients...</span>
              </div>
            ) : clients.length > 0 ? (
              <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded-full">
                Connected — {clients.length} client{clients.length !== 1 ? 's' : ''}
              </span>
            ) : clientError ? (
              <span className="text-[10px] bg-red-900/30 text-red-400 px-2 py-0.5 rounded-full">
                Disconnected
              </span>
            ) : null}
          </div>
          <button
            onClick={fetchClients}
            disabled={fetchingClients}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-lg disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {clientError && (
          <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-900 rounded-lg text-sm text-red-300">
            {clientError}
            <p className="text-xs text-red-400 mt-1">
              Make sure SHIPSOURCED_API_TOKEN is set in your .env file (use your ShipSourced dashboard password).
            </p>
          </div>
        )}

        {/* Store → Client Mapping */}
        {stores.length === 0 ? (
          <p className="text-sm text-slate-400">Add stores first from the Stores page, then come back to link them.</p>
        ) : (
          <div className="space-y-3">
            {stores.map((store) => {
              const isLinked = !!store.shipsourced_client_id;
              const msg = syncMessage[store.id];

              return (
                <div key={store.id} className={`p-4 rounded-lg border ${isLinked ? 'bg-emerald-950/20 border-emerald-900/50' : 'bg-slate-800/50 border-slate-700'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{store.name}</p>
                        {store.shopify_domain && (
                          <span className="text-[10px] text-slate-500">{store.shopify_domain}</span>
                        )}
                      </div>
                      {isLinked ? (
                        <div className="flex items-center gap-3 mt-1">
                          <p className="text-xs text-emerald-400">
                            → {store.shipsourced_client_name || store.shipsourced_client_id}
                          </p>
                          <span className="text-[10px] text-slate-500">
                            Last sync: {timeAgo(store.last_synced_at)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 mt-1">Not connected to ShipSourced</p>
                      )}
                      {msg && (
                        <p className="text-xs text-blue-300 mt-1">{msg}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      {isLinked ? (
                        <>
                          <button
                            onClick={() => syncSingleStore(store.id)}
                            disabled={syncingStore === store.id || saving === store.id}
                            className="px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 border border-blue-900 hover:border-blue-700 rounded-lg disabled:opacity-50"
                          >
                            {syncingStore === store.id ? 'Syncing...' : 'Sync Now'}
                          </button>
                          <button
                            onClick={() => unlinkStore(store.id)}
                            disabled={saving === store.id}
                            className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 rounded-lg disabled:opacity-50"
                          >
                            Unlink
                          </button>
                        </>
                      ) : clients.length > 0 ? (
                        <select
                          onChange={(e) => {
                            const c = clients.find(cl => cl.id === e.target.value);
                            if (c) linkStore(store.id, c.id, c.companyName);
                          }}
                          disabled={saving === store.id}
                          className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 min-w-[200px]"
                          defaultValue=""
                        >
                          <option value="" disabled>Pick a ShipSourced client...</option>
                          {availableClients.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.companyName}{c.email ? ` (${c.email})` : ''}
                            </option>
                          ))}
                          {availableClients.length === 0 && clients.length > 0 && (
                            <option disabled>All clients are already linked</option>
                          )}
                        </select>
                      ) : fetchingClients ? (
                        <span className="text-xs text-slate-500">Loading...</span>
                      ) : (
                        <span className="text-xs text-slate-500">No clients available</span>
                      )}
                    </div>
                  </div>

                  {/* Sync Start Date — only show for linked stores */}
                  {isLinked && (
                    <div className="mt-3 pt-3 border-t border-slate-800/50 flex items-center gap-3">
                      <label className="text-[10px] text-slate-500 uppercase whitespace-nowrap">Sync from:</label>
                      <input
                        type="date"
                        value={store.sync_start_date || ''}
                        onChange={(e) => saveSyncStartDate(store.id, e.target.value)}
                        className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                      {store.sync_start_date && (
                        <button
                          onClick={() => saveSyncStartDate(store.id, '')}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                        >
                          Clear
                        </button>
                      )}
                      <span className="text-[10px] text-slate-600">
                        {store.sync_start_date
                          ? `Only syncs data from ${store.sync_start_date} forward. Earlier data preserved.`
                          : 'Syncs all available data. Set a date to protect historical imports.'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Chargeflow API Keys */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-white">Chargeflow Integration</h2>
          <p className="text-xs text-slate-500 mt-1">Add your Chargeflow API key per store to track chargebacks. Get keys from Chargeflow Settings → Developers.</p>
        </div>
        <div className="space-y-3">
          {stores.map(store => {
            const inputId = `cf-input-${store.id}`;
            return (
              <div key={`cf-${store.id}`} className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 rounded-lg">
                <span className="text-sm text-white w-32 flex-shrink-0">{store.name}</span>
                <input
                  id={inputId}
                  type="password"
                  placeholder="Chargeflow API key..."
                  defaultValue={store.chargeflow_api_key || ''}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={async () => {
                    const input = document.getElementById(inputId) as HTMLInputElement;
                    const val = input?.value.trim() || '';
                    await fetch(`/api/stores/${store.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ chargeflowApiKey: val || null }),
                    });
                    store.chargeflow_api_key = val || null;
                    setStores([...stores]);
                  }}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded transition-colors"
                >
                  Save
                </button>
                <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${store.chargeflow_api_key ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                  {store.chargeflow_api_key ? 'Connected' : 'Not set'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Import Historical Data */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Import Historical Data</h2>
            <p className="text-xs text-slate-400 mt-0.5">Upload CSV from Google Sheets or Shopify exports to backfill daily P&L</p>
          </div>
          <button
            onClick={downloadTemplate}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-lg"
          >
            Download Template
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] text-slate-500 uppercase mb-1">Store</label>
            <select
              value={importStoreId}
              onChange={(e) => setImportStoreId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
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
              onChange={handleCsvFile}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-300 file:cursor-pointer"
            />
          </div>
        </div>

        {/* Expected format */}
        <div className="mb-4 px-3 py-2 bg-slate-800/50 rounded-lg">
          <p className="text-[10px] text-slate-500 uppercase mb-1">Expected CSV columns</p>
          <code className="text-[11px] text-slate-400">
            date, revenue, orders, cogs, shipping, pick_pack, packaging, ad_spend, shopify_fees, other_costs
          </code>
          <p className="text-[10px] text-slate-600 mt-1">
            Dates as YYYY-MM-DD. Monetary values in dollars (e.g. 1500.00). Missing columns default to 0.
          </p>
        </div>

        {/* Preview */}
        {csvRows && (
          <div className="mb-4">
            <p className="text-xs text-slate-300 mb-2">
              Parsed <span className="font-semibold text-white">{csvRows.length}</span> rows from {csvFileName}
            </p>
            {csvRows.length > 0 && (
              <div className="overflow-x-auto max-h-40 overflow-y-auto bg-slate-800/50 rounded-lg">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="text-left px-2 py-1">Date</th>
                      <th className="text-right px-2 py-1">Revenue</th>
                      <th className="text-right px-2 py-1">Orders</th>
                      <th className="text-right px-2 py-1">COGS</th>
                      <th className="text-right px-2 py-1">Shipping</th>
                      <th className="text-right px-2 py-1">Ad Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-b border-slate-800/50">
                        <td className="px-2 py-1 text-slate-300">{r.date}</td>
                        <td className="px-2 py-1 text-right text-slate-400">${r.revenue || '0'}</td>
                        <td className="px-2 py-1 text-right text-slate-400">{r.orders || '0'}</td>
                        <td className="px-2 py-1 text-right text-slate-400">${r.cogs || '0'}</td>
                        <td className="px-2 py-1 text-right text-slate-400">${r.shipping || '0'}</td>
                        <td className="px-2 py-1 text-right text-slate-400">${r.ad_spend || '0'}</td>
                      </tr>
                    ))}
                    {csvRows.length > 10 && (
                      <tr><td colSpan={6} className="px-2 py-1 text-slate-600 text-center">...and {csvRows.length - 10} more rows</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Import button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={!importStoreId || !csvRows || csvRows.length === 0 || importing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
          >
            {importing ? 'Importing...' : `Import ${csvRows?.length || 0} Rows`}
          </button>

          {importResult && (
            <div className={`text-xs ${importResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {importResult.success
                ? `Done — ${importResult.imported} imported, ${importResult.updated} updated${importResult.skipped ? `, ${importResult.skipped} skipped` : ''}`
                : importResult.error || 'Import failed'}
            </div>
          )}
        </div>

        {importResult?.errors && importResult.errors.length > 0 && (
          <div className="mt-3 px-3 py-2 bg-red-900/20 border border-red-900/50 rounded-lg">
            <p className="text-xs text-red-400 font-medium mb-1">Errors:</p>
            {importResult.errors.map((err: string, i: number) => (
              <p key={i} className="text-[11px] text-red-300">{err}</p>
            ))}
          </div>
        )}
      </div>

      {/* Available ShipSourced Clients */}
      {clients.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">ShipSourced Clients</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.map(c => {
              const linkedStore = stores.find(s => s.shipsourced_client_id === c.id);
              return (
                <div key={c.id} className={`p-3 rounded-lg border text-sm ${linkedStore ? 'bg-emerald-950/10 border-emerald-900/30' : 'bg-slate-800/30 border-slate-700'}`}>
                  <p className="font-medium text-white">{c.companyName}</p>
                  {c.email && <p className="text-[10px] text-slate-500">{c.email}</p>}
                  {linkedStore ? (
                    <p className="text-[10px] text-emerald-400 mt-1">→ {linkedStore.name}</p>
                  ) : linkingClient === c.id ? (
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        autoFocus
                        onChange={(e) => {
                          const store = stores.find(s => s.id === e.target.value);
                          if (store) {
                            linkStore(store.id, c.id, c.companyName);
                            setLinkingClient(null);
                          }
                        }}
                        className="flex-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                        defaultValue=""
                      >
                        <option value="" disabled>Select store...</option>
                        {unlinkedStores.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setLinkingClient(null)}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setLinkingClient(c.id)}
                      disabled={unlinkedStores.length === 0}
                      className="mt-2 px-3 py-1 text-[11px] font-medium text-blue-400 hover:text-blue-300 border border-blue-900/50 hover:border-blue-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {unlinkedStores.length > 0 ? 'Link to Store' : 'All stores linked'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Sync Logs */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Recent Sync Activity</h2>
        {syncLogs.length === 0 ? (
          <p className="text-sm text-slate-400">No sync activity yet. Link a store above to start syncing.</p>
        ) : (
          <div className="space-y-2">
            {syncLogs.slice(0, 15).map((log) => (
              <div key={log.id} className="flex items-center justify-between py-2 border-b border-slate-800/50">
                <div>
                  <p className="text-sm text-slate-300">{log.sync_type}</p>
                  <p className="text-[10px] text-slate-500">{log.started_at}</p>
                  {log.error_message && (
                    <p className="text-[10px] text-red-400 mt-0.5 max-w-md truncate">{log.error_message}</p>
                  )}
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    log.status === 'success' ? 'bg-emerald-900/30 text-emerald-400' :
                    log.status === 'error' ? 'bg-red-900/30 text-red-400' :
                    log.status === 'running' ? 'bg-blue-900/30 text-blue-400' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {log.status}
                  </span>
                  {log.records_synced > 0 && (
                    <p className="text-[10px] text-slate-500 mt-0.5">{log.records_synced} records</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
