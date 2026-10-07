// In-memory stand-in for supabase-js (PostgREST + Storage) used by the handler tests.
// owner: when set, rows are filtered by user_id like RLS would (the caller-JWT client).
const { randomUUID } = require('node:crypto');
function memoryDb({ owner = null, tables = {} } = {}) {
  const copy = x => JSON.parse(JSON.stringify(x));
  function from(table) {
    tables[table] ||= [];
    let op = 'select', value = null, filters = [], limit = Infinity, head = false, orderBy = null;
    const visible = () => tables[table].filter(r => (!owner || r.user_id === undefined || r.user_id === owner) && filters.every(f => f(r)));
    const run = () => {
      if (op === 'insert') {
        const list = (Array.isArray(value) ? value : [value]).map(v => ({ id: randomUUID(), created_at: new Date().toISOString(), ...copy(v) }));
        if (owner && list.some(r => r.user_id !== owner)) return { error: { message: 'RLS' } };
        tables[table].push(...list); return { data: list };
      }
      if (op === 'update') { const hit = visible(); hit.forEach(r => Object.assign(r, copy(value))); return { data: hit }; }
      if (op === 'delete') { const hit = visible(); tables[table] = tables[table].filter(r => !hit.includes(r)); return { data: hit }; }
      let rows = visible();
      if (orderBy) rows = [...rows].sort((a, b) => (a[orderBy.k] > b[orderBy.k] ? 1 : -1) * (orderBy.asc ? 1 : -1));
      return { data: rows.slice(0, limit) };
    };
    const q = {
      select(_c, o = {}) { head = !!o.head; return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; }, in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      gte(k, v) { filters.push(r => r[k] >= v); return q; }, is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      order(k, o = {}) { orderBy = { k, asc: o.ascending !== false }; return q; }, limit(n) { limit = n; return q; },
      insert(v) { op = 'insert'; value = v; return q; }, update(v) { op = 'update'; value = v; return q; }, delete() { op = 'delete'; return q; },
      upsert(v) { op = 'insert'; value = (Array.isArray(v) ? v : [v]).filter(x => !tables[table].some(r => r.user_id === x.user_id && r.event_id === x.event_id)); return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data ? copy(r.data)[0] ?? null : null, error: r.error ?? null }; },
      single: async () => { const r = run(); return r.error ? { data: null, error: r.error } : r.data.length === 1 ? { data: copy(r.data[0]), error: null } : { data: null, error: { message: 'not one row' } }; },
      then(resolve, reject) { try { const r = run(); resolve(head ? { count: (r.data || []).length, error: r.error ?? null } : { data: r.data ? copy(r.data) : null, error: r.error ?? null }); } catch (e) { reject(e); } },
    };
    return q;
  }
  return { from, tables };
}
module.exports = { memoryDb };
