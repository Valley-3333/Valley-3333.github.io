import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import worker from '../workers/region-analytics/worker.mjs';

const db = new DatabaseSync(':memory:');
const schema = fs.readFileSync(new URL('../workers/region-analytics/schema.sql', import.meta.url), 'utf8');
// Upgrades preserve existing page views, and running setup twice is safe.
db.exec('CREATE TABLE daily_pageviews (day_jst TEXT, prefecture TEXT, views INTEGER, PRIMARY KEY(day_jst,prefecture)); INSERT INTO daily_pageviews VALUES (\'2026-10-18\', \'東京都\', 7);');
db.exec(schema);
db.exec(schema);
assert.equal(db.prepare('SELECT views FROM daily_pageviews').get().views, 7);
const env = { REGION_DB: { prepare(sql) { return { bind: (...args) => ({ run: async () => db.prepare(sql).run(...args) }) }; } } };
const req = (path, origin = 'https://valley-3333.github.io', method = 'POST') => {
    const request = new Request(`https://stats.example${path}`, {
        method, headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.100' },
    });
    Object.defineProperty(request, 'cf', { value: { country: 'JP', regionCode: '13' } });
    return request;
};
try {
    const page = await worker.fetch(req('/collect'), env);
    assert.equal(page.status, 204);
    assert.match(page.headers.get('X-Region-Analytics-Day'), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(page.headers.get('Access-Control-Expose-Headers'), 'X-Region-Analytics-Day');
    const unique = await worker.fetch(req('/unique'), env);
    assert.equal(unique.status, 204);
    const today = page.headers.get('X-Region-Analytics-Day');
    const row = db.prepare('SELECT * FROM daily_access_summary WHERE day_jst = ?').get(today);
    assert.equal(row.views, 1);
    assert.equal(row.unique_browsers, 1);
    assert.equal((await worker.fetch(req('/unique', 'https://evil.example'), env)).status, 403);
    assert.equal((await worker.fetch(req('/unique', undefined, 'GET'), env)).status, 405);
    assert.equal((await worker.fetch(req('/unique?visitor=123'), env)).status, 404);
    assert.deepEqual(db.prepare('PRAGMA table_info(daily_unique_browsers)').all().map(col => col.name), ['day_jst', 'prefecture', 'browsers']);

    const source = fs.readFileSync(new URL('../site-analytics.js', import.meta.url), 'utf8');
    const key = 'valley-analytics-last-counted-day';
    const store = new Map();
    let lockTail = Promise.resolve();
    const locks = { request(_name, callback) { lockTail = lockTail.then(callback); return lockTail; } };
    function openPage({ day = '2026-10-19', storage = store, status = 204, legacy = false, useLocks = true, reject = false } = {}) {
        const sent = [];
        const context = {
            window: {
                location: { protocol: 'https:', hostname: 'valley-3333.github.io' },
                navigator: useLocks ? { locks } : {},
                localStorage: {
                    getItem: k => storage.get(k) ?? null,
                    setItem: (k, v) => storage.set(k, v),
                },
            },
            document: { querySelector: () => true },
            fetch: async (url, options) => {
                sent.push({ url, options });
                if (reject && url.endsWith('/unique')) throw new Error('offline');
                return { status: url.endsWith('/unique') ? status : 204, headers: { get: () => legacy ? null : day } };
            },
        };
        vm.createContext(context);
        vm.runInContext(source, context);
        return sent;
    }
    const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await lockTail; };
    const first = openPage();
    const second = openPage();
    await settle();
    assert.equal([...first, ...second].filter(item => item.url.endsWith('/collect')).length, 2);
    assert.equal([...first, ...second].filter(item => item.url.endsWith('/unique')).length, 1);
    assert.equal(store.get(key), '2026-10-19');
    assert.equal(store.size, 1);
    const repeat = openPage();
    await settle();
    assert.equal(repeat.length, 1);
    const nextDay = openPage({ day: '2026-10-20' });
    await settle();
    assert.equal(nextDay.length, 2);
    assert.equal(store.get(key), '2026-10-20');
    for (const item of [...first, ...second, ...nextDay]) {
        assert.equal(item.options.credentials, 'omit');
        assert.equal(item.options.referrerPolicy, 'no-referrer');
        assert.equal(item.options.body, undefined);
        assert.equal(item.options.headers, undefined);
    }
    const old = openPage({ storage: new Map(), legacy: true });
    const invalid = openPage({ storage: new Map(), day: 'arbitrary-id' });
    const blocked = openPage({ storage: { get() { throw new Error('denied'); }, set() {} } });
    const writeBlocked = openPage({ storage: { get() {}, set() { throw new Error('denied'); } } });
    await settle();
    for (const result of [old, invalid, blocked, writeBlocked]) assert.equal(result.length, 1);
    for (const failure of [{ status: 503 }, { status: 429 }, { reject: true }]) {
        const retryStore = new Map();
        openPage({ storage: retryStore, ...failure });
        await settle();
        assert.notEqual(retryStore.get(key), '2026-10-19');
        const retry = openPage({ storage: retryStore });
        await settle();
        assert.equal(retry.length, 2);
        assert.equal(retryStore.get(key), '2026-10-19');
    }
    const fallback = openPage({ storage: new Map(), useLocks: false });
    await settle();
    assert.equal(fallback.length, 2);
    console.log('PASS: migration preserves views; private daily aggregate view; endpoint and CORS restrictions; daily browser deduplication across pages/tabs; server JST date; no IDs or IP storage; legacy, blocked storage and failed-send handling.');
} finally { db.close(); }
