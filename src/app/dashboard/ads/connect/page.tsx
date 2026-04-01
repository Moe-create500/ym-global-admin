'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface Store { id: string; name: string; }
interface FBProfile {
  id: string;
  store_id: string;
  store_name: string;
  profile_name: string;
  ad_account_id: string | null;
  ad_account_name: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  token_expiring_soon: number;
  token_expired: number;
  last_sync_at: string | null;
}
interface FBAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export default function ConnectFacebookPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <ConnectFacebookContent />
    </Suspense>
  );
}

function ConnectFacebookContent() {
  const searchParams = useSearchParams();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [profiles, setProfiles] = useState<FBProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Per-profile state for ad account selection
  const [accountsMap, setAccountsMap] = useState<Record<string, FBAdAccount[]>>({});
  const [loadingAccounts, setLoadingAccounts] = useState<Record<string, boolean>>({});
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  // Success/error from OAuth callback
  const success = searchParams.get('success');
  const newProfileId = searchParams.get('profileId');
  const error = searchParams.get('error');
  const accountCount = searchParams.get('accounts');

  useEffect(() => {
    loadStores();
    loadProfiles();
  }, []);

  // After OAuth success, auto-load ad accounts for the new profile
  useEffect(() => {
    if (success === '1' && newProfileId) {
      loadAdAccounts(newProfileId);
    }
  }, [success, newProfileId]);

  async function loadStores() {
    const res = await fetch('/api/stores');
    const data = await res.json();
    setStores(data.stores || []);
  }

  async function loadProfiles() {
    setLoading(true);
    const res = await fetch('/api/fb/profiles');
    const data = await res.json();
    setProfiles(data.profiles || []);
    setLoading(false);
  }

  async function loadAdAccounts(profileId: string) {
    setLoadingAccounts((prev) => ({ ...prev, [profileId]: true }));
    try {
      const res = await fetch(`/api/fb/profiles/accounts?profileId=${profileId}`);
      const data = await res.json();
      if (data.accounts) {
        setAccountsMap((prev) => ({ ...prev, [profileId]: data.accounts }));
      }
    } catch {
      // ignore
    }
    setLoadingAccounts((prev) => ({ ...prev, [profileId]: false }));
  }

  function handleConnect() {
    if (!selectedStore) return;
    setConnecting(true);
    window.location.href = `/api/ads/facebook/auth?storeId=${selectedStore}`;
  }

  async function handleAssignAccount(profileId: string) {
    const accountId = selectedAccounts[profileId];
    if (!accountId) return;
    const accounts = accountsMap[profileId] || [];
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;

    await fetch('/api/fb/profiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: profileId,
        adAccountId: account.id,
        adAccountName: account.name,
        profileName: account.name,
      }),
    });
    loadProfiles();
  }

  async function handleSync(profileId: string, storeId: string) {
    setSyncing((prev) => ({ ...prev, [profileId]: true }));
    try {
      await fetch('/api/ads/facebook/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, storeId }),
      });
      loadProfiles();
    } catch {
      // ignore
    }
    setSyncing((prev) => ({ ...prev, [profileId]: false }));
  }

  async function handleDisconnect(profileId: string) {
    if (!confirm('Disconnect this Facebook account?')) return;
    await fetch(`/api/fb/profiles?id=${profileId}`, { method: 'DELETE' });
    loadProfiles();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Facebook Ad Accounts</h1>
      <p className="text-sm text-slate-400 mb-6">
        Connect Facebook to automatically pull ad spend data per store.
      </p>

      {/* OAuth callback messages */}
      {success === '1' && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-4 mb-6">
          <p className="text-sm text-emerald-300 font-medium">Facebook connected successfully!</p>
          <p className="text-xs text-emerald-400 mt-1">
            Found {accountCount} ad account(s). Select one below to assign to your store.
          </p>
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-300 font-medium">Connection failed</p>
          <p className="text-xs text-red-400 mt-1">{decodeURIComponent(error)}</p>
        </div>
      )}

      {/* Connect new store */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-8 max-w-lg">
        <h3 className="text-sm font-semibold text-white mb-4">Connect a Store</h3>
        <p className="text-xs text-slate-400 mb-4">
          Select a store, then connect with Facebook to authorize access to its ad accounts.
        </p>

        <div className="mb-4">
          <label className="block text-xs text-slate-400 mb-1">Store</label>
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select a store...</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleConnect}
          disabled={!selectedStore || connecting}
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
          {connecting ? 'Redirecting...' : 'Connect with Facebook'}
        </button>
        <p className="text-[10px] text-slate-500 mt-2 text-center">
          Redirects to Facebook to authorize access to your ad accounts.
        </p>
      </div>

      {/* Connected Profiles */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-4">Connected Accounts</h3>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
          </div>
        ) : profiles.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-400">No Facebook accounts connected yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {profiles.map((profile) => {
              const accounts = accountsMap[profile.id] || [];
              const isLoadingAccounts = loadingAccounts[profile.id];
              const isSyncing = syncing[profile.id];
              const isNew = newProfileId === profile.id;
              const hasAdAccount = !!profile.ad_account_id;

              return (
                <div
                  key={profile.id}
                  className={`bg-slate-900 border rounded-xl p-5 ${
                    isNew ? 'border-blue-600' : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">
                          {profile.profile_name === 'Pending Setup' ? profile.store_name : profile.profile_name}
                        </h4>
                        {/* Token status badge */}
                        {profile.token_expired ? (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-red-900/50 text-red-400 border border-red-800 rounded-full">
                            Token Expired
                          </span>
                        ) : profile.token_expiring_soon ? (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-yellow-900/50 text-yellow-400 border border-yellow-800 rounded-full">
                            Expiring Soon
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Store: {profile.store_name}
                        {profile.ad_account_id && (
                          <> &middot; Ad Account: <span className="text-slate-400">{profile.ad_account_name || profile.ad_account_id}</span></>
                        )}
                      </p>
                      {profile.last_sync_at && (
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          Last synced: {new Date(profile.last_sync_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {hasAdAccount && (
                        <button
                          onClick={() => handleSync(profile.id, profile.store_id)}
                          disabled={isSyncing || profile.token_expired === 1}
                          className="px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 border border-blue-900 hover:border-blue-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDisconnect(profile.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 rounded-lg transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {/* Ad Account Selection */}
                  {!hasAdAccount && (
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mt-3">
                      <p className="text-xs text-slate-400 mb-3">Select an ad account to track spend for this store:</p>
                      {accounts.length === 0 && !isLoadingAccounts ? (
                        <button
                          onClick={() => loadAdAccounts(profile.id)}
                          className="px-3 py-2 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                        >
                          Load Ad Accounts
                        </button>
                      ) : isLoadingAccounts ? (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                          Loading ad accounts from Facebook...
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedAccounts[profile.id] || ''}
                            onChange={(e) => setSelectedAccounts((prev) => ({ ...prev, [profile.id]: e.target.value }))}
                            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                          >
                            <option value="">Select ad account...</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({acc.account_id}) — {acc.currency}
                                {acc.account_status !== 1 ? ' [DISABLED]' : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssignAccount(profile.id)}
                            disabled={!selectedAccounts[profile.id]}
                            className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
                          >
                            Assign
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Already assigned — show change option */}
                  {hasAdAccount && (
                    <div className="mt-3">
                      <button
                        onClick={() => {
                          loadAdAccounts(profile.id);
                          // Clear current assignment to show selector
                          fetch('/api/fb/profiles', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: profile.id, adAccountId: null, adAccountName: null }),
                          }).then(() => loadProfiles());
                        }}
                        className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Change ad account
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
