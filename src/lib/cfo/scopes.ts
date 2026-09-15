import type DatabaseType from 'better-sqlite3';

/** Reporting scopes. Three concepts are kept apart on purpose:
 *   - legal entity   — who owns the money (YM Global Ventures LLC, ShipSourced)
 *   - business unit  — what we report on (a store, or ShipSourced as a whole)
 *   - warehouse      — where fulfilment physically happens (California, China)
 *  ShipSourced California / China are WAREHOUSE-level P&L scopes. Whether
 *  China is a separate legal entity is an unresolved decision and is exposed
 *  as such (`mapping.status = 'unresolved'`) rather than assumed. */

export type ScopeKind = 'group' | 'store' | 'entity' | 'warehouse';

export interface Scope {
  id: string;                 // 'all' | 'stores' | 'store:<id>' | 'ss' | 'ss:ca' | 'ss:cn'
  label: string;
  kind: ScopeKind;
  storeIds: string[];         // stores whose records roll into this scope
  company: 'ymgv' | 'shipsourced' | null;   // bank_accounts.company that funds it
  warehouse: 'US' | 'CN' | null;
  legalEntity: string | null;
  mapping: { status: 'resolved' | 'unresolved'; decisions: string[] };
  parentId: string | null;
  /** false for stores switched off or hidden from the dashboard — still
   *  selectable as a scope, but not a row in group tables. */
  active: boolean;
}

interface StoreRow { id: string; name: string; platform: string | null; is_active: number; dashboard_hidden: number | null; brand: string | null }

const YM_ENTITY = 'YM Global Ventures LLC';

export function listScopes(db: DatabaseType.Database): Scope[] {
  const stores: StoreRow[] = db.prepare(
    `SELECT id, name, platform, is_active, dashboard_hidden, brand FROM stores ORDER BY name`
  ).all() as any[];
  const ss = stores.find(s => s.name === 'ShipSourced');
  const brandStores = stores.filter(s => s.id !== ss?.id);
  const brandIds = brandStores.map(s => s.id);
  const ssIds = ss ? [ss.id] : [];

  const scopes: Scope[] = [
    { id: 'all', label: 'Everything', kind: 'group', storeIds: [...brandIds, ...ssIds], company: null, warehouse: null, legalEntity: null,
      mapping: { status: 'resolved', decisions: [] }, parentId: null, active: true },
    { id: 'stores', label: 'All stores', kind: 'group', storeIds: brandIds, company: 'ymgv', warehouse: null, legalEntity: YM_ENTITY,
      mapping: { status: 'resolved', decisions: [] }, parentId: 'all', active: true },
  ];
  for (const s of brandStores) {
    scopes.push({
      id: `store:${s.id}`, label: s.name + (!s.is_active ? ' (inactive)' : s.dashboard_hidden ? ' (hidden)' : ''), kind: 'store', storeIds: [s.id], company: 'ymgv', warehouse: null, legalEntity: YM_ENTITY,
      mapping: { status: 'resolved', decisions: [] }, parentId: 'stores', active: !!s.is_active && !s.dashboard_hidden,
    });
  }
  if (ss) {
    const ssDecisions = [
      'Is ShipSourced China a separate legal entity from ShipSourced (California), or a warehouse of the same company? Consolidation eliminations depend on it.',
      'Which ShipSourced costs belong to China: the ESCOR Group monthly payment, XE/Wise transfers to China agents, 1688 purchases? Each needs an explicit mapping, not a guess from the paying account.',
    ];
    scopes.push({ id: 'ss', label: 'ShipSourced (combined)', kind: 'entity', storeIds: ssIds, company: 'shipsourced', warehouse: null, legalEntity: 'ShipSourced',
      mapping: { status: 'resolved', decisions: [] }, parentId: 'all', active: true });
    scopes.push({ id: 'ss:ca', label: 'ShipSourced California', kind: 'warehouse', storeIds: ssIds, company: 'shipsourced', warehouse: 'US', legalEntity: 'ShipSourced',
      mapping: { status: 'unresolved', decisions: ssDecisions }, parentId: 'ss', active: true });
    scopes.push({ id: 'ss:cn', label: 'ShipSourced China', kind: 'warehouse', storeIds: ssIds, company: 'shipsourced', warehouse: 'CN', legalEntity: null,
      mapping: { status: 'unresolved', decisions: ssDecisions }, parentId: 'ss', active: true });
  }
  return scopes;
}

export function resolveScope(db: DatabaseType.Database, id: string | null | undefined): Scope | null {
  const all = listScopes(db);
  return all.find(s => s.id === (id || 'all')) || null;
}

/** The units that appear as ROWS of the business table for a scope. */
export function childUnits(db: DatabaseType.Database, scope: Scope): Scope[] {
  const all = listScopes(db);
  if (scope.kind === 'group') {
    const rows = all.filter(s => s.parentId === scope.id && s.active);
    // Everything → stores group expands to its stores, plus ShipSourced combined
    if (scope.id === 'all') return [...all.filter(s => s.parentId === 'stores' && s.active), ...rows.filter(s => s.id === 'ss')];
    return rows;
  }
  if (scope.id === 'ss') return all.filter(s => s.parentId === 'ss');
  return [scope];
}
