'use client';

import { useEffect, useState } from 'react';

interface Store { id: string; name: string; }

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: number;
  store_count: number;
  last_login_at: string | null;
  created_at: string;
}

export default function TeamPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [uploads, setUploads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'viewer', storeIds: [] as string[] });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [empRes, storeRes, uploadRes] = await Promise.all([
      fetch('/api/employees'),
      fetch('/api/stores'),
      fetch('/api/employee/uploads?limit=50'),
    ]);
    const empData = await empRes.json();
    const storeData = await storeRes.json();
    const uploadData = await uploadRes.json();
    setEmployees(empData.employees || []);
    setStores(storeData.stores || []);
    setUploads(uploadData.uploads || []);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAddError('');
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || 'Failed to add employee');
      setSaving(false);
      return;
    }
    setForm({ name: '', email: '', password: '', role: 'viewer', storeIds: [] });
    setShowAdd(false);
    setSaving(false);
    loadData();
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this employee?')) return;
    await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    loadData();
  }

  function handleLoginAs(empId: string) {
    window.open(`/api/auth/impersonate?id=${empId}`, '_blank');
  }

  function toggleStore(storeId: string) {
    setForm(prev => ({
      ...prev,
      storeIds: prev.storeIds.includes(storeId)
        ? prev.storeIds.filter(s => s !== storeId)
        : [...prev.storeIds, storeId],
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <p className="text-sm text-slate-400 mt-1">{employees.length} active member{employees.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
        >
          {showAdd ? 'Cancel' : '+ Add Employee'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">New Employee</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Password *</label>
              <input
                type="password"
                required
                minLength={4}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 4 characters"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => {
                  const newRole = e.target.value;
                  const allStoreIds = (newRole === 'data_corrector' || newRole === 'admin') ? stores.map(s => s.id) : form.storeIds;
                  setForm({ ...form, role: newRole, storeIds: allStoreIds });
                }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="admin">Admin — Full access</option>
                <option value="manager">Manager — Manage assigned stores</option>
                <option value="data_corrector">Data Corrector — Data quality & accuracy</option>
                <option value="media_buyer">Media Buyer — Ad management</option>
                <option value="creative">Creative — Videos & content</option>
                <option value="viewer">Viewer — Read-only</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-2">Assign to Stores</label>
            {(form.role === 'data_corrector' || form.role === 'admin') ? (
              <p className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
                All stores automatically assigned for {form.role === 'data_corrector' ? 'Data Corrector' : 'Admin'} role
              </p>
            ) : (
            <div className="flex flex-wrap gap-2">
              {stores.map(store => (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => toggleStore(store.id)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    form.storeIds.includes(store.id)
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {store.name}
                </button>
              ))}
            </div>
            )}
          </div>

          {addError && (
            <div className="bg-red-900/20 border border-red-800/30 text-red-400 px-3 py-2 rounded-lg text-sm mb-4">
              {addError}
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {saving ? 'Adding...' : 'Add Employee'}
            </button>
          </div>
        </form>
      )}

      {employees.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No employees added yet</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Role</th>
                <th className="text-center px-5 py-3">Stores</th>
                <th className="text-left px-5 py-3">Last Login</th>
                <th className="text-center px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-5 py-3 text-white font-medium">{emp.name}</td>
                  <td className="px-5 py-3 text-slate-400">{emp.email}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                      emp.role === 'admin' ? 'bg-purple-900/30 text-purple-400' :
                      emp.role === 'manager' ? 'bg-blue-900/30 text-blue-400' :
                      emp.role === 'data_corrector' ? 'bg-emerald-900/30 text-emerald-400' :
                      emp.role === 'media_buyer' ? 'bg-orange-900/30 text-orange-400' :
                      emp.role === 'creative' ? 'bg-pink-900/30 text-pink-400' :
                      'bg-slate-800 text-slate-400'
                    }`}>
                      {emp.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">{emp.store_count}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{emp.last_login_at || 'Never'}</td>
                  <td className="px-5 py-3 text-center flex items-center justify-center gap-3">
                    <button
                      onClick={() => handleLoginAs(emp.id)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Login As
                    </button>
                    <button
                      onClick={() => handleDeactivate(emp.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Activity */}
      {uploads.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-white mb-4">Upload Activity</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-5 py-3">Employee</th>
                    <th className="text-left px-5 py-3">Store</th>
                    <th className="text-left px-5 py-3">File</th>
                    <th className="text-left px-5 py-3">Type</th>
                    <th className="text-center px-5 py-3">Records</th>
                    <th className="text-center px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((u: any) => (
                    <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-slate-400 text-xs">{u.created_at?.split('T')[0] || u.created_at}</td>
                      <td className="px-5 py-3 text-white">{u.employee_name}</td>
                      <td className="px-5 py-3 text-slate-300">{u.store_name}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs font-mono truncate max-w-[150px]">{u.file_name}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          u.file_type === 'chargeflow' ? 'bg-violet-900/30 text-violet-400' : 'bg-emerald-900/30 text-emerald-400'
                        }`}>{u.file_type}</span>
                      </td>
                      <td className="px-5 py-3 text-center text-slate-300 text-xs">
                        {u.records_imported} new{u.records_updated > 0 ? `, ${u.records_updated} upd` : ''}{u.records_duplicate > 0 ? `, ${u.records_duplicate} dup` : ''}
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
          </div>
        </div>
      )}
    </div>
  );
}
