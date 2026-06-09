'use client';

import { useEffect, useState, useRef } from 'react';

interface Store { id: string; name: string; platform: string; shipsourced_client_id: string | null; }
interface FbProfile { id: string; store_id: string; profile_name: string; ad_account_id: string; ad_account_name: string; }

type FileCategory = 'fb_invoice' | 'google_invoice' | 'shopify_billing' | 'chargeflow';

interface UploadResult { status: 'idle' | 'uploading' | 'done' | 'error'; message: string; }

const CATEGORIES: { key: FileCategory; label: string; color: string; endpoint: string; platform?: string }[] = [
  { key: 'fb_invoice', label: 'FB Invoice', color: 'text-blue-400', endpoint: '/api/ads/import', platform: 'facebook' },
  { key: 'google_invoice', label: 'Google Invoice', color: 'text-green-400', endpoint: '/api/ads/import', platform: 'google' },
  { key: 'shopify_billing', label: 'Shopify Billing', color: 'text-emerald-400', endpoint: '/api/shopify-invoices' },
  { key: 'chargeflow', label: 'Chargeflow', color: 'text-violet-400', endpoint: '/api/chargebacks/sync' },
];

function FileSlot({ storeId, category, results, onUpload }: {
  storeId: string;
  category: typeof CATEGORIES[0];
  results: Record<string, UploadResult>;
  onUpload: (storeId: string, category: FileCategory, text: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const key = `${storeId}-${category.key}`;
  const result = results[key] || { status: 'idle', message: '' };

  return (
    <div className="flex-1 min-w-0">
      <input ref={ref} type="file" accept=".csv" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => onUpload(storeId, category.key, ev.target?.result as string);
          reader.readAsText(file);
          if (ref.current) ref.current.value = '';
        }}
      />
      <button onClick={() => ref.current?.click()} disabled={result.status === 'uploading'}
        className={`w-full px-2 py-2.5 border border-dashed rounded-lg text-[10px] font-medium transition-colors ${
          result.status === 'done' ? 'border-emerald-700 bg-emerald-950/20 text-emerald-400' :
          result.status === 'error' ? 'border-red-700 bg-red-950/20 text-red-400' :
          result.status === 'uploading' ? 'border-blue-700 bg-blue-950/20 text-blue-400' :
          'border-slate-600 text-slate-400 hover:border-slate-500 hover:text-white'
        }`}>
        {result.status === 'uploading' ? 'Uploading...' :
         result.status === 'done' ? result.message :
         result.status === 'error' ? result.message :
         category.label}
      </button>
    </div>
  );
}

export default function BulkUploadPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [fbProfiles, setFbProfiles] = useState<FbProfile[]>([]);
  const [results, setResults] = useState<Record<string, UploadResult>>({});
  const [showMapping, setShowMapping] = useState(false);

  // Mapping editor state
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [availableAccounts, setAvailableAccounts] = useState<{ id: string; account_id: string; name: string; linked: { storeName: string; profileName: string } | null }[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/stores').then(r => r.json()),
      fetch('/api/fb/profiles').then(r => r.json()),
    ]).then(([storeData, fbData]) => {
      setStores((storeData.stores || []).filter((s: Store) => s.platform === 'shopify'));
      setFbProfiles(fbData.profiles || []);
    });
  }, []);

  async function handleUpload(storeId: string, category: FileCategory, csvText: string) {
    const key = `${storeId}-${category}`;
    setResults(prev => ({ ...prev, [key]: { status: 'uploading', message: '' } }));

    try {
      const cat = CATEGORIES.find(c => c.key === category)!;
      let body: any;

      if (category === 'fb_invoice' || category === 'google_invoice') {
        body = { storeId, platform: cat.platform, csvText };
      } else if (category === 'shopify_billing') {
        body = { storeId, csvText };
      } else {
        body = { storeId, csvText };
      }

      const res = await fetch(cat.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success || data.synced !== undefined) {
        const parts: string[] = [];
        if (data.imported) parts.push(`${data.imported} new`);
        if (data.updated) parts.push(`${data.updated} upd`);
        if (data.duplicates) parts.push(`${data.duplicates} dup`);
        if (data.skippedFailed) parts.push(`${data.skippedFailed} failed`);
        if (data.synced !== undefined) parts.push(`${data.synced} synced`);
        setResults(prev => ({ ...prev, [key]: { status: 'done', message: parts.join(', ') || 'Done' } }));
      } else {
        setResults(prev => ({ ...prev, [key]: { status: 'error', message: data.error || 'Failed' } }));
      }
    } catch (e: any) {
      setResults(prev => ({ ...prev, [key]: { status: 'error', message: e.message } }));
    }
  }

  async function addFbProfile(storeId: string) {
    if (!newProfileName || !newAccountId) return;
    const accountId = newAccountId.startsWith('act_') ? newAccountId : `act_${newAccountId}`;
    await fetch('/api/fb/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, profileName: newProfileName, adAccountId: accountId, adAccountName: newProfileName }),
    });
    setAddingTo(null);
    setNewProfileName('');
    setNewAccountId('');
    const res = await fetch('/api/fb/profiles');
    const data = await res.json();
    setFbProfiles(data.profiles || []);
  }

  async function removeFbProfile(profileId: string) {
    if (!confirm('Remove this ad account mapping?')) return;
    await fetch(`/api/fb/profiles?id=${profileId}`, { method: 'DELETE' });
    const res = await fetch('/api/fb/profiles');
    const data = await res.json();
    setFbProfiles(data.profiles || []);
  }

  const doneCount = Object.values(results).filter(r => r.status === 'done').length;
  const totalSlots = stores.length * 4;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Bulk Upload</h1>
          <p className="text-sm text-slate-400 mt-1">Upload reconciliation files per store</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowMapping(!showMapping)}
            className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
              showMapping ? 'bg-blue-600/20 border-blue-700 text-blue-400' : 'border-slate-700 text-slate-400 hover:text-white'
            }`}>
            {showMapping ? 'Hide Mapping' : 'Ad Account Mapping'}
          </button>
          {doneCount > 0 && (
            <a href="/dashboard/daily"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg">
              View Reconciliation →
            </a>
          )}
        </div>
      </div>

      {/* Progress */}
      {doneCount > 0 && (
        <div className="mb-4 px-4 py-2 bg-emerald-900/20 border border-emerald-800/50 rounded-lg flex items-center justify-between">
          <span className="text-xs text-emerald-400">{doneCount} file{doneCount !== 1 ? 's' : ''} uploaded</span>
          <button onClick={() => setResults({})} className="text-xs text-slate-400 hover:text-white">Reset</button>
        </div>
      )}

      {/* Ad Account Mapping Panel */}
      {showMapping && (
        <div className="bg-slate-900 border border-blue-900/50 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">Ad Account → Store Mapping</h2>
          <div className="space-y-3">
            {stores.map(store => {
              const profiles = fbProfiles.filter(p => p.store_id === store.id);
              const isAdding = addingTo === store.id;
              return (
                <div key={store.id} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-white">{store.name}</h3>
                    <button onClick={() => {
                      if (isAdding) { setAddingTo(null); }
                      else {
                        setAddingTo(store.id); setNewProfileName(''); setNewAccountId('');
                        if (availableAccounts.length === 0) {
                          setLoadingAccounts(true);
                          fetch('/api/fb/profiles/accounts').then(r => r.json()).then(d => {
                            setAvailableAccounts(d.accounts || []);
                            setLoadingAccounts(false);
                          }).catch(() => setLoadingAccounts(false));
                        }
                      }
                    }} className="text-[10px] text-blue-400 hover:text-blue-300">
                      {isAdding ? 'Cancel' : '+ Add Account'}
                    </button>
                  </div>
                  {profiles.length === 0 && !isAdding && (
                    <p className="text-[10px] text-slate-500">No FB ad accounts linked</p>
                  )}
                  {profiles.length > 0 && (
                    <div className="space-y-1">
                      {profiles.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-400 font-medium">{p.profile_name}</span>
                            <span className="text-slate-500 font-mono">{p.ad_account_id}</span>
                          </div>
                          <button onClick={() => removeFbProfile(p.id)} className="text-slate-500 hover:text-red-400 text-[10px]">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {isAdding && (
                    <div className="flex items-center gap-2 mt-2">
                      <input type="text" placeholder="Name (e.g. SINO5)" value={newProfileName}
                        onChange={e => setNewProfileName(e.target.value)}
                        className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500 w-28" />
                      {loadingAccounts ? (
                        <div className="flex-1 px-2 py-1.5 text-xs text-slate-500">Loading accounts...</div>
                      ) : availableAccounts.length > 0 ? (
                        <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)}
                          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500 flex-1">
                          <option value="">Select ad account...</option>
                          {availableAccounts.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.id}){a.linked ? ` — ${a.linked.storeName}/${a.linked.profileName}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input type="text" placeholder="act_123456789" value={newAccountId}
                          onChange={e => setNewAccountId(e.target.value)}
                          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500 flex-1 font-mono" />
                      )}
                      <button onClick={() => addFbProfile(store.id)} disabled={!newProfileName || !newAccountId}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                        Add
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-3 px-5 mb-2">
        <div className="text-[10px] text-slate-500 uppercase font-semibold">Store</div>
        <div className="text-[10px] text-blue-400 uppercase font-semibold text-center">FB Invoice</div>
        <div className="text-[10px] text-green-400 uppercase font-semibold text-center">Google Invoice</div>
        <div className="text-[10px] text-emerald-400 uppercase font-semibold text-center">Shopify Billing</div>
        <div className="text-[10px] text-violet-400 uppercase font-semibold text-center">Chargeflow</div>
      </div>

      {/* Per-Store Rows */}
      <div className="space-y-2">
        {stores.map(store => {
          const profiles = fbProfiles.filter(p => p.store_id === store.id);
          const storeUploads = Object.entries(results).filter(([k]) => k.startsWith(store.id));
          const storeDone = storeUploads.filter(([, r]) => r.status === 'done').length;
          const storeError = storeUploads.filter(([, r]) => r.status === 'error').length;

          return (
            <div key={store.id} className={`bg-slate-900 border rounded-xl px-5 py-3 ${
              storeDone === 4 ? 'border-emerald-800/60' : storeError > 0 ? 'border-red-800/40' : 'border-slate-800'
            }`}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-3 items-center">
                {/* Store info */}
                <div>
                  <h3 className="text-sm font-semibold text-white">{store.name}</h3>
                  {profiles.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {profiles.map(p => (
                        <span key={p.id} className="text-[9px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">{p.profile_name}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-slate-500 mt-0.5">No FB accounts</p>
                  )}
                </div>

                {/* Upload slots */}
                {CATEGORIES.map(cat => (
                  <FileSlot key={cat.key} storeId={store.id} category={cat} results={results} onUpload={handleUpload} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
