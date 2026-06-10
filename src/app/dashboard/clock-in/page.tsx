'use client';

import { useEffect, useState } from 'react';

interface Employee { id: string; name: string; role: string; hourly_rate_cents: number; }
interface ActiveClock { id: string; employee_id: string; employee_name: string; clock_in: string; }
interface TimeEntry {
  id: string; employee_id: string; employee_name: string;
  clock_in: string; clock_out: string | null; hours: number | null;
  note: string | null; hourly_rate_cents: number;
}
interface Summary {
  employee_id: string; employee_name: string; hourly_rate_cents: number;
  total_hours: number; shift_count: number; total_pay_cents: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
}

function elapsed(clockIn: string): string {
  const ms = Date.now() - new Date(clockIn).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function ClockInPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeClocks, setActiveClocks] = useState<ActiveClock[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [empFilter, setEmpFilter] = useState('');
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [tick, setTick] = useState(0);

  // Add manual entry state
  const [showManual, setShowManual] = useState(false);
  const [manualEmp, setManualEmp] = useState('');
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('17:00');
  const [manualNote, setManualNote] = useState('');

  // Rate editing
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState('');

  // Tick every minute to update elapsed time
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(d => {
      // Only show real team members, not store client accounts
      const team = (d.employees || []).filter((e: Employee) => !e.id.startsWith('emp-') && e.role !== 'viewer');
      setEmployees(team);
    });
  }, []);

  useEffect(() => { loadData(); }, [empFilter, rangeFrom, rangeTo]);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (empFilter) params.set('employeeId', empFilter);
    if (rangeFrom) params.set('from', rangeFrom);
    if (rangeTo) params.set('to', rangeTo);
    const res = await fetch(`/api/time-entries?${params}`);
    const data = await res.json();
    setEntries(data.entries || []);
    setActiveClocks(data.activeClocks || []);
    setSummary(data.summary || []);
    setLoading(false);
  }

  async function clockIn(employeeId: string) {
    await fetch('/api/time-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId }),
    });
    loadData();
  }

  async function clockOut(employeeId: string) {
    await fetch('/api/time-entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId }),
    });
    loadData();
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this time entry?')) return;
    await fetch(`/api/time-entries?id=${id}`, { method: 'DELETE' });
    loadData();
  }

  async function addManualEntry() {
    if (!manualEmp || !manualDate || !manualStart || !manualEnd) return;
    const clockIn = `${manualDate}T${manualStart}:00`;
    const clockOut = `${manualDate}T${manualEnd}:00`;
    await fetch('/api/time-entries', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: manualEmp, clockIn, clockOut, note: manualNote || null }),
    });
    setShowManual(false);
    setManualNote('');
    loadData();
  }

  async function saveRate(employeeId: string) {
    const rateCents = Math.round(parseFloat(rateInput) * 100);
    if (isNaN(rateCents)) return;
    await fetch('/api/time-entries', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, hourlyRateCents: rateCents }),
    });
    setEditingRate(null);
    // Refresh employees
    const res = await fetch('/api/employees');
    const data = await res.json();
    setEmployees(data.employees || []);
    loadData();
  }

  const totalHours = summary.reduce((s, e) => s + (e.total_hours || 0), 0);
  const totalPay = summary.reduce((s, e) => s + (e.total_pay_cents || 0), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Clock In</h1>
          <p className="text-sm text-slate-400 mt-1">Track team hours and pay</p>
        </div>
        <button onClick={() => setShowManual(!showManual)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
          {showManual ? 'Cancel' : '+ Manual Entry'}
        </button>
      </div>

      {/* Manual Entry */}
      {showManual && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">Add Manual Entry</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Employee</label>
              <select value={manualEmp} onChange={e => setManualEmp(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">Select...</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Date</label>
              <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Start</label>
              <input type="time" value={manualStart} onChange={e => setManualStart(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">End</label>
              <input type="time" value={manualEnd} onChange={e => setManualEnd(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Note</label>
              <input type="text" value={manualNote} onChange={e => setManualNote(e.target.value)} placeholder="Optional"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 placeholder:text-slate-600" />
            </div>
          </div>
          <button onClick={addManualEntry} disabled={!manualEmp}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            Add Entry
          </button>
        </div>
      )}

      {/* Active Clocks */}
      {activeClocks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">Currently Clocked In</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeClocks.map(ac => (
              <div key={ac.id} className="bg-emerald-900/20 border border-emerald-800/50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{ac.employee_name}</p>
                  <p className="text-xs text-emerald-400">Clocked in {fmtTime(ac.clock_in)}</p>
                  <p className="text-lg font-bold text-emerald-300 mt-1">{elapsed(ac.clock_in)}</p>
                </div>
                <button onClick={() => clockOut(ac.employee_id)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg">
                  Clock Out
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clock In Buttons */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-white mb-3">Team</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {employees.map(emp => {
            const isActive = activeClocks.some(ac => ac.employee_id === emp.id);
            return (
              <div key={emp.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{emp.name}</p>
                    <p className="text-[10px] text-slate-500 capitalize">{emp.role.replace('_', ' ')}</p>
                  </div>
                  <div className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                </div>
                <div className="flex items-center justify-between">
                  {editingRate === emp.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500">$</span>
                      <input type="number" step="0.01" value={rateInput}
                        onChange={e => setRateInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveRate(emp.id)}
                        className="w-16 px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none"
                        autoFocus />
                      <button onClick={() => saveRate(emp.id)} className="text-[10px] text-emerald-400">/hr</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingRate(emp.id); setRateInput(((emp.hourly_rate_cents || 0) / 100).toString()); }}
                      className="text-[10px] text-slate-500 hover:text-white">
                      {emp.hourly_rate_cents ? `$${(emp.hourly_rate_cents / 100).toFixed(2)}/hr` : 'Set rate'}
                    </button>
                  )}
                  {isActive ? (
                    <button onClick={() => clockOut(emp.id)}
                      className="px-3 py-1.5 bg-red-600/20 border border-red-700/50 text-red-400 text-xs font-medium rounded-lg hover:bg-red-600/30">
                      Clock Out
                    </button>
                  ) : (
                    <button onClick={() => clockIn(emp.id)}
                      className="px-3 py-1.5 bg-emerald-600/20 border border-emerald-700/50 text-emerald-400 text-xs font-medium rounded-lg hover:bg-emerald-600/30">
                      Clock In
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Date Range + Filter */}
      <div className="flex items-center gap-3 mb-4">
        <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none" />
        <span className="text-slate-500 text-sm">to</span>
        <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none" />
        <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none">
          <option value="">All employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* Pay Summary */}
      {summary.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">Pay Summary ({fmtDate(rangeFrom)} — {fmtDate(rangeTo)})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase">Total Hours</p>
              <p className="text-xl font-bold text-white">{totalHours.toFixed(1)}h</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase">Total Pay</p>
              <p className="text-xl font-bold text-emerald-400">{cents(totalPay)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase">Shifts</p>
              <p className="text-xl font-bold text-blue-400">{summary.reduce((s, e) => s + e.shift_count, 0)}</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                <th className="text-left py-2">Employee</th>
                <th className="text-right py-2">Hours</th>
                <th className="text-right py-2">Rate</th>
                <th className="text-right py-2">Shifts</th>
                <th className="text-right py-2">Pay</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.employee_id} className="border-b border-slate-800/50">
                  <td className="py-2 text-white font-medium">{s.employee_name}</td>
                  <td className="py-2 text-right text-slate-300">{(s.total_hours || 0).toFixed(1)}h</td>
                  <td className="py-2 text-right text-slate-400">{s.hourly_rate_cents ? `$${(s.hourly_rate_cents / 100).toFixed(2)}/hr` : '—'}</td>
                  <td className="py-2 text-right text-slate-400">{s.shift_count}</td>
                  <td className="py-2 text-right text-emerald-400 font-medium">{s.total_pay_cents ? cents(s.total_pay_cents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Time Entries Log */}
      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
      ) : entries.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No time entries for this period</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-white">Time Entries ({entries.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-5 py-3">Employee</th>
                  <th className="text-left px-5 py-3">Clock In</th>
                  <th className="text-left px-5 py-3">Clock Out</th>
                  <th className="text-right px-5 py-3">Hours</th>
                  <th className="text-right px-5 py-3">Pay</th>
                  <th className="text-left px-5 py-3">Note</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">{e.employee_name}</td>
                    <td className="px-5 py-3 text-slate-300 text-xs">{fmtTime(e.clock_in)}</td>
                    <td className="px-5 py-3 text-slate-300 text-xs">
                      {e.clock_out ? fmtTime(e.clock_out) : <span className="text-emerald-400">Active</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">
                      {e.hours ? `${e.hours.toFixed(1)}h` : e.clock_out ? '—' : elapsed(e.clock_in)}
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400">
                      {e.hours && e.hourly_rate_cents ? cents(Math.round(e.hours * e.hourly_rate_cents)) : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{e.note || ''}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => deleteEntry(e.id)} className="text-xs text-red-400 hover:text-red-300">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
