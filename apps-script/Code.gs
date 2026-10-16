/**
 * AHG53 WhatsApp Agent — Google Sheets database API.
 *
 * Paste this file into the Sheet's Apps Script editor (Extensions → Apps Script), then:
 *   1. Run `setup` once (creates the tabs and asks for permission).
 *   2. Project Settings → Script properties → add API_SECRET = <long random string, same as APPS_SCRIPT_SECRET on Vercel>.
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → copy the /exec URL
 *      into APPS_SCRIPT_URL on Vercel.
 * Every request must carry API_SECRET; without it nothing is read or written.
 * Keep the Sheet private (don't share it publicly) — it holds customer data.
 */

var SCHEMA = {
  contacts: {
    cols: {
      id: 'text', wa_id: 'text', name: 'text', business_name: 'text', country: 'text', city: 'text', lang: 'text',
      tags: 'json', status: 'text', lead_score: 'text', bot_paused: 'bool', paused_at: 'text', paused_reason: 'text',
      marketing_opt_in: 'bool', opt_in_at: 'text', opt_in_source: 'text', opted_out: 'bool', opted_out_at: 'text',
      flow: 'text', flow_step: 'text', flow_data: 'json', after_hours_notified_at: 'text',
      last_inbound_at: 'text', last_outbound_at: 'text', created_at: 'text', updated_at: 'text'
    },
    unique: [['wa_id']],
    defaults: { lang: 'en', tags: [], status: 'new', bot_paused: false, marketing_opt_in: false, opted_out: false, flow_data: {} }
  },
  messages: {
    cols: { id: 'text', contact_id: 'text', direction: 'text', wamid: 'text', type: 'text', body: 'text', status: 'text', kind: 'text', campaign_id: 'text', created_at: 'text' },
    unique: [['wamid']],
    defaults: { kind: 'service' }
  },
  leads: {
    cols: {
      id: 'text', contact_id: 'text', name: 'text', business_name: 'text', location: 'text', country: 'text', service: 'text',
      budget: 'text', deadline: 'text', score: 'text', score_points: 'int', status: 'text', campaign_id: 'text',
      nudged_at: 'text', created_at: 'text', updated_at: 'text', completed_at: 'text'
    },
    unique: [],
    defaults: { status: 'in_progress' }
  },
  handoffs: {
    cols: { id: 'text', contact_id: 'text', reason: 'text', summary: 'text', status: 'text', created_at: 'text', resolved_at: 'text' },
    unique: [],
    defaults: { status: 'open' }
  },
  suppression: {
    cols: { id: 'text', phone_hash: 'text', reason: 'text', created_at: 'text' },
    unique: [['phone_hash']],
    defaults: {}
  },
  templates: {
    cols: { id: 'text', meta_id: 'text', name: 'text', language: 'text', category: 'text', status: 'text', components: 'json', params: 'json', has_url_var: 'bool', synced_at: 'text', created_at: 'text' },
    unique: [['name', 'language']],
    defaults: { components: [], params: [], has_url_var: false }
  },
  campaigns: {
    cols: {
      id: 'text', name: 'text', template_name: 'text', audience: 'json', params: 'json', link_url: 'text', status: 'text',
      scheduled_at: 'text', recipient_count: 'int', created_at: 'text', started_at: 'text', finished_at: 'text'
    },
    unique: [],
    defaults: { audience: {}, params: {}, status: 'draft', recipient_count: 0 }
  },
  campaign_recipients: {
    cols: {
      id: 'text', campaign_id: 'text', contact_id: 'text', status: 'text', wamid: 'text', track_code: 'text', error: 'text',
      sent_at: 'text', delivered_at: 'text', read_at: 'text', clicked_at: 'text', replied_at: 'text', converted_at: 'text', created_at: 'text'
    },
    unique: [['campaign_id', 'contact_id'], ['track_code']],
    defaults: { status: 'pending' }
  },
  sequence_enrollments: {
    cols: {
      id: 'text', contact_id: 'text', lead_id: 'text', sequence: 'text', step: 'int', next_run_at: 'text', last_sent_at: 'text',
      status: 'text', stop_reason: 'text', enrolled_at: 'text', created_at: 'text'
    },
    unique: [],
    defaults: { step: 0, status: 'active' }
  },
  settings: { cols: { key: 'text', value: 'json' }, unique: [['key']], defaults: {} },
  quota_usage: { cols: { month: 'text', used: 'int' }, unique: [['month']], defaults: { used: 0 } }
};

// Tables whose rows are removed together with their contact ("delete my data").
var CASCADE = ['messages', 'leads', 'handoffs', 'campaign_recipients', 'sequence_enrollments'];

var DEFAULT_SETTINGS = {
  monthly_message_limit: 2000,
  service_reserve: 300,
  ai_enabled: true,
  ai_max_tokens: 1024,
  business_hours: { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00' },
  reengage_enabled: false,
  post_quote_sequence: [
    { day: 1, template: 'ahg_quote_followup' },
    { day: 3, template: 'ahg_quote_followup_2' },
    { day: 7, template: 'ahg_reengage' }
  ]
};

// ---------------------------------------------------------------- setup (run once from the editor)
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = Object.keys(SCHEMA[name].cols);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(cols.length, sh.getMaxColumns())).setNumberFormat('@'); // plain text: no date/number guessing
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#ffc61a');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  // Default settings
  var ctx = newCtx();
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!findRows(ctx, 'settings', { key: k }).length) insertRows(ctx, 'settings', [{ key: k, value: DEFAULT_SETTINGS[k] }], true);
  });
  if (!PropertiesService.getScriptProperties().getProperty('API_SECRET')) {
    Logger.log('Now add the script property API_SECRET (Project Settings → Script properties).');
  }
  Logger.log('Setup complete.');
}

// ---------------------------------------------------------------- 5-minute cron (for Vercel's free plan)
// Script properties CRON_URL (https://YOUR-APP.vercel.app/api/cron/tick) and CRON_SECRET must be set.
function installCron() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cronTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronTick').timeBased().everyMinutes(5).create();
  Logger.log('cronTick will run every 5 minutes.');
}

function cronTick() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('CRON_URL');
  var secret = props.getProperty('CRON_SECRET');
  if (!url || !secret) return Logger.log('Set CRON_URL and CRON_SECRET script properties first.');
  var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + secret }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) Logger.log('cron tick failed: HTTP ' + res.getResponseCode());
}

// ---------------------------------------------------------------- HTTP entry points
function doGet() {
  return json({ ok: true, service: 'ahg53-sheets-db' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'bad json' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  if (!secret || secret.length < 24 || body.secret !== secret) return json({ error: 'unauthorized' });
  if (!Array.isArray(body.ops) || body.ops.length > 200) return json({ error: 'bad ops' });

  // Only writes take the script lock; reads and cache ops (login limiter, dedupe) never wait behind it.
  var writes = body.ops.some(function (op) { return WRITE_OPS.indexOf(op.op) > -1; });
  var lock = writes ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(15000)) return json({ error: 'busy' });
  try {
    var ctx = newCtx();
    var results = body.ops.map(function (op) {
      try {
        return { ok: true, data: run(ctx, op) };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err), code: err && err.code };
      }
    });
    if (writes) SpreadsheetApp.flush();
    return json({ results: results });
  } finally {
    if (lock) lock.releaseLock();
  }
}

var WRITE_OPS = ['insert', 'update', 'upsert', 'remove', 'consume_quota', 'release_quota', 'inbound', 'cleanup'];

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail(message, code) {
  var e = new Error(message);
  e.code = code;
  throw e;
}

// ---------------------------------------------------------------- operations
function run(ctx, op) {
  var t = op.table;
  if (t && !SCHEMA[t]) fail('unknown table ' + t, 'bad_table');
  switch (op.op) {
    case 'find': return findRows(ctx, t, op.where, op);
    case 'count': return findRows(ctx, t, op.where, {}).length;
    case 'insert': return insertRows(ctx, t, op.rows || [], !!op.ignoreConflict);
    case 'update': return updateRows(ctx, t, op.where, op.patch || {});
    case 'upsert': return upsertRow(ctx, t, op.row, op.key);
    case 'remove': return removeRows(ctx, t, op.where);
    case 'consume_quota': return consumeQuota(ctx, op.month, op.n, op.limit, !!op.force);
    case 'release_quota': return consumeQuota(ctx, op.month, -Math.abs(op.n), Infinity, true);
    case 'rate_limit': return rateLimit(op.key, op.window, op.max);
    case 'seen': return seen(op.key, op.ttl);
    case 'inbound': return inbound(ctx, op);
    case 'cleanup': return cleanup(ctx, op.keepDays || 60);
    default: fail('unknown op ' + op.op, 'bad_op');
  }
}

function newCtx() {
  return { ss: SpreadsheetApp.getActive(), tables: {} };
}

function table(ctx, name) {
  if (ctx.tables[name]) return ctx.tables[name];
  var sh = ctx.ss.getSheetByName(name);
  if (!sh) fail('missing tab ' + name + ' — run setup()', 'no_tab');
  var cols = Object.keys(SCHEMA[name].cols);
  var last = sh.getLastRow();
  var values = last > 1 ? sh.getRange(2, 1, last - 1, cols.length).getValues() : [];
  var rows = values.map(function (r) { return fromRow(name, cols, r); });
  ctx.tables[name] = { sh: sh, cols: cols, rows: rows };
  return ctx.tables[name];
}

// ---- cell conversion
function toCell(type, v) {
  if (v === null || v === undefined) return '';
  if (type === 'bool') return v ? 'true' : 'false';
  if (type === 'int') return String(Number(v) || 0);
  if (type === 'json') return JSON.stringify(v);
  var s = String(v);
  // Block formula injection from customer text: text starting with = + - @ is stored with a leading apostrophe.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function fromCell(type, v) {
  if (v instanceof Date) v = v.toISOString();
  if (v === '' || v === null || v === undefined) {
    return type === 'bool' ? false : null;
  }
  if (type === 'bool') return v === true || String(v).toLowerCase() === 'true';
  if (type === 'int') return Number(v) || 0;
  if (type === 'json') {
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  var s = String(v);
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  return s;
}

function fromRow(name, cols, r) {
  var o = {};
  var types = SCHEMA[name].cols;
  for (var i = 0; i < cols.length; i++) o[cols[i]] = fromCell(types[cols[i]], r[i]);
  return o;
}

function toRow(name, cols, o) {
  var types = SCHEMA[name].cols;
  return cols.map(function (c) { return toCell(types[c], o[c]); });
}

// ---- filtering
function matches(o, where) {
  if (!where) return true;
  for (var k in where) {
    var cond = where[k];
    var v = o[k];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && cond.op) {
      if (!testOp(v, cond)) return false;
    } else if (typeof cond === 'boolean') {
      if (!!v !== cond) return false;
    } else if (cond === null) {
      if (!(v === null || v === '')) return false;
    } else if (String(v === null || v === undefined ? '' : v) !== String(cond)) {
      return false;
    }
  }
  return true;
}

function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  a = String(a); b = String(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function testOp(v, c) {
  var empty = v === null || v === undefined || v === '';
  switch (c.op) {
    case 'neq': return String(empty ? '' : v) !== String(c.value);
    case 'in': return !empty && c.value.map(String).indexOf(String(v)) > -1;
    case 'nin': return empty || c.value.map(String).indexOf(String(v)) === -1;
    case 'lt': return !empty && cmp(v, c.value) < 0;
    case 'lte': return !empty && cmp(v, c.value) <= 0;
    case 'gt': return !empty && cmp(v, c.value) > 0;
    case 'gte': return !empty && cmp(v, c.value) >= 0;
    case 'lt_or_null': return empty || cmp(v, c.value) < 0;
    case 'null': return empty;
    case 'notnull': return !empty;
    case 'endswith': return !empty && String(v).slice(-String(c.value).length) === String(c.value);
    case 'ilike': return !empty && String(v).toLowerCase().indexOf(String(c.value).toLowerCase()) > -1;
    case 'overlaps': return Array.isArray(v) && v.some(function (x) { return c.value.indexOf(x) > -1; });
    default: fail('unknown filter ' + c.op, 'bad_filter');
  }
}

function findRows(ctx, name, where, opts) {
  var rows = table(ctx, name).rows.filter(function (o) { return matches(o, where); });
  if (opts && opts.order) {
    var f = opts.order, dir = opts.desc ? -1 : 1;
    rows.sort(function (a, b) {
      var ea = a[f] === null || a[f] === '', eb = b[f] === null || b[f] === '';
      if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empty values last
      return cmp(a[f], b[f]) * dir;
    });
  }
  var off = (opts && opts.offset) || 0;
  var lim = (opts && opts.limit) || rows.length;
  return rows.slice(off, off + lim);
}

// ---- writes
function nowIso() { return new Date().toISOString(); }

function randomHex(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}

function conflictWith(tbl, name, row) {
  var uniques = SCHEMA[name].unique;
  for (var u = 0; u < uniques.length; u++) {
    var keys = uniques[u];
    if (keys.some(function (k) { return row[k] === null || row[k] === undefined || row[k] === ''; })) continue;
    for (var i = 0; i < tbl.rows.length; i++) {
      var r = tbl.rows[i];
      if (keys.every(function (k) { return String(r[k]) === String(row[k]); })) return r;
    }
  }
  return null;
}

function insertRows(ctx, name, rows, ignoreConflict) {
  var tbl = table(ctx, name);
  var schema = SCHEMA[name];
  var inserted = [], conflicts = [];
  rows.forEach(function (input) {
    var row = {};
    tbl.cols.forEach(function (c) {
      var d = schema.defaults[c];
      row[c] = input[c] !== undefined ? input[c] : d !== undefined ? JSON.parse(JSON.stringify(d)) : null;
    });
    if ('id' in schema.cols && !row.id) row.id = Utilities.getUuid();
    if ('created_at' in schema.cols && !row.created_at) row.created_at = nowIso();
    if ('enrolled_at' in schema.cols && !row.enrolled_at) row.enrolled_at = nowIso();
    if ('track_code' in schema.cols && !row.track_code) row.track_code = randomHex(12);
    var existing = conflictWith(tbl, name, row);
    if (existing) {
      if (!ignoreConflict) fail('duplicate ' + name, 'conflict');
      conflicts.push(existing);
      return;
    }
    tbl.rows.push(row);
    inserted.push(row);
  });
  if (inserted.length) {
    var start = tbl.sh.getLastRow() + 1;
    tbl.sh.getRange(start, 1, inserted.length, tbl.cols.length)
      .setNumberFormat('@')
      .setValues(inserted.map(function (r) { return toRow(name, tbl.cols, r); }));
  }
  return { rows: inserted, conflicts: conflicts };
}

function writeRow(tbl, name, index) {
  tbl.sh.getRange(index + 2, 1, 1, tbl.cols.length).setValues([toRow(name, tbl.cols, tbl.rows[index])]);
}

function updateRows(ctx, name, where, patch) {
  var tbl = table(ctx, name);
  var n = 0;
  for (var i = 0; i < tbl.rows.length; i++) {
    if (!matches(tbl.rows[i], where)) continue;
    for (var k in patch) if (k in SCHEMA[name].cols) tbl.rows[i][k] = patch[k];
    if ('updated_at' in SCHEMA[name].cols && !('updated_at' in patch)) tbl.rows[i].updated_at = nowIso();
    writeRow(tbl, name, i);
    n++;
  }
  return n;
}

function upsertRow(ctx, name, row, key) {
  var where = {};
  key.forEach(function (k) { where[k] = row[k]; });
  var n = updateRows(ctx, name, where, row);
  if (!n) insertRows(ctx, name, [row], true);
  return n ? 'updated' : 'inserted';
}

function removeRows(ctx, name, where) {
  var tbl = table(ctx, name);
  var removed = [];
  for (var i = tbl.rows.length - 1; i >= 0; i--) {
    if (!matches(tbl.rows[i], where)) continue;
    removed.push(tbl.rows[i]);
    tbl.sh.deleteRow(i + 2);
    tbl.rows.splice(i, 1);
  }
  if (name === 'contacts') {
    removed.forEach(function (c) {
      CASCADE.forEach(function (child) { removeRows(ctx, child, { contact_id: c.id }); });
    });
  }
  return removed.length;
}

/** Atomically add n to the month's quota unless it would pass `limit` (always adds when force). */
function consumeQuota(ctx, month, n, limit, force) {
  var rows = findRows(ctx, 'quota_usage', { month: month });
  var used = rows.length ? rows[0].used : 0;
  if (!force && used + n > limit) return false;
  var next = Math.max(used + n, 0);
  if (rows.length) updateRows(ctx, 'quota_usage', { month: month }, { used: next });
  else insertRows(ctx, 'quota_usage', [{ month: month, used: next }], true);
  return true;
}

function rateLimit(key, windowSec, max) {
  var cache = CacheService.getScriptCache();
  var k = 'rl:' + key + ':' + Math.floor(Date.now() / 1000 / windowSec);
  var count = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(count), Math.min(Math.max(windowSec, 1), 21600));
  return count <= max;
}

function seen(key, ttl) {
  var cache = CacheService.getScriptCache();
  var k = 'seen:' + key;
  if (cache.get(k)) return true;
  cache.put(k, '1', Math.min(ttl || 21600, 21600));
  return false;
}

/**
 * Everything the bot needs for one incoming message, in one round trip:
 * get-or-create the contact, store the message (duplicates are detected),
 * mark a recent campaign as replied, and return the open quote, settings and quota.
 */
function inbound(ctx, op) {
  var now = nowIso();
  var contact = findRows(ctx, 'contacts', { wa_id: op.wa_id })[0];
  var isNew = false;
  if (!contact) {
    contact = insertRows(ctx, 'contacts', [{ wa_id: op.wa_id, name: op.profile_name || null, updated_at: now }], true).rows[0]
      || findRows(ctx, 'contacts', { wa_id: op.wa_id })[0];
    isNew = true;
  }
  if (op.wamid && findRows(ctx, 'messages', { wamid: op.wamid }).length) return { duplicate: true };
  insertRows(ctx, 'messages', [{ contact_id: contact.id, direction: 'inbound', wamid: op.wamid, type: op.type, body: op.body, status: 'received' }], true);

  var prevInbound = contact.last_inbound_at;
  updateRows(ctx, 'contacts', { id: contact.id }, { last_inbound_at: now });

  var weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  var recent = findRows(ctx, 'campaign_recipients', { contact_id: contact.id, status: 'sent', replied_at: null, sent_at: { op: 'gte', value: weekAgo } }, { order: 'sent_at', desc: true, limit: 1 })[0];
  if (recent) updateRows(ctx, 'campaign_recipients', { id: recent.id }, { replied_at: now });

  var lead = findRows(ctx, 'leads', { contact_id: contact.id, status: 'in_progress' }, { order: 'created_at', desc: true, limit: 1 })[0] || null;
  var settings = {};
  findRows(ctx, 'settings', {}).forEach(function (s) { settings[s.key] = s.value; });
  var quota = findRows(ctx, 'quota_usage', { month: op.month })[0];

  return {
    duplicate: false,
    isNew: isNew,
    contact: findRows(ctx, 'contacts', { id: contact.id })[0],
    prevLastInbound: prevInbound,
    lead: lead,
    settings: settings,
    quotaUsed: quota ? quota.used : 0
  };
}

/** Keep the Sheet fast: drop messages older than keepDays and finished enrolments older than 90 days. */
function cleanup(ctx, keepDays) {
  var cutoff = new Date(Date.now() - keepDays * 864e5).toISOString();
  var out = {};
  out.messages = rewriteKeeping(ctx, 'messages', function (r) { return !r.created_at || r.created_at >= cutoff; });
  var old = new Date(Date.now() - 90 * 864e5).toISOString();
  out.enrollments = rewriteKeeping(ctx, 'sequence_enrollments', function (r) { return r.status === 'active' || !r.enrolled_at || r.enrolled_at >= old; });
  return out;
}

function rewriteKeeping(ctx, name, keep) {
  var tbl = table(ctx, name);
  var kept = tbl.rows.filter(keep);
  var removed = tbl.rows.length - kept.length;
  if (!removed) return 0;
  var last = tbl.sh.getLastRow();
  if (last > 1) tbl.sh.getRange(2, 1, last - 1, tbl.cols.length).clearContent();
  if (kept.length) tbl.sh.getRange(2, 1, kept.length, tbl.cols.length).setValues(kept.map(function (r) { return toRow(name, tbl.cols, r); }));
  tbl.rows = kept;
  return removed;
}
