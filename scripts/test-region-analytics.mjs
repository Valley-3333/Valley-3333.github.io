import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import worker, { getPrefecture, toJstDay } from '../workers/region-analytics/worker.mjs';

const database = new DatabaseSync(':memory:');
database.exec(fs.readFileSync(new URL('../workers/region-analytics/schema.sql', import.meta.url), 'utf8'));
const env = {
    REGION_DB: {
        prepare(sql) {
            return { bind: (...values) => ({ run: async () => database.prepare(sql).run(...values) }) };
        },
    },
};
let ip = 1;
function request(options = {}) {
    const req = new Request('https://stats.example/collect' + (options.query || ''), {
        method: options.method || 'POST',
        headers: {
            Origin: options.origin ?? 'https://valley-3333.github.io',
            'CF-Connecting-IP': options.ip || `192.0.2.${ip++}`,
            ...(options.headers || {}),
        },
        ...(options.body ? { body: options.body } : {}),
    });
    Object.defineProperty(req, 'cf', { value: options.cf === null ? undefined : options.cf || { country: 'JP', regionCode: '13' } });
    return req;
}
const total = () => database.prepare('SELECT coalesce(sum(views),0) AS views FROM daily_pageviews').get().views;

try {
    assert.equal(toJstDay(Date.parse('2026-10-18T14:59:59Z')), '2026-10-18');
    assert.equal(toJstDay(Date.parse('2026-10-18T15:00:00Z')), '2026-10-19');
    assert.equal(getPrefecture({ country: 'JP', regionCode: '01' }), '北海道');
    assert.equal(getPrefecture({ country: 'JP', regionCode: 'JP-13' }), '東京都');
    assert.equal(getPrefecture({ country: 'JP', regionCode: '27' }), '大阪府');
    assert.equal(getPrefecture({ country: 'JP', regionCode: '47' }), '沖縄県');
    assert.equal(getPrefecture({ country: 'JP', regionCode: '99' }), '国内・都道府県不明');
    assert.equal(getPrefecture({ country: 'JP' }), '国内・都道府県不明');
    assert.equal(getPrefecture({ country: 'US', regionCode: '13' }), '海外・地域不明');

    for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.equal((await worker.fetch(request({ method }), env)).status, 405);
    }
    for (const origin of ['', 'null', 'https://evil.example', 'https://valley-3333.github.io.evil.example']) {
        assert.equal((await worker.fetch(request({ origin }), env)).status, 403);
    }
    assert.equal((await worker.fetch(request({ query: '?prefecture=大阪府' }), env)).status, 404);
    assert.equal((await worker.fetch(request({ method: 'OPTIONS' }), env)).status, 204);
    assert.equal(total(), 0);

    const first = await worker.fetch(request({ body: '{"prefecture":"大阪府","comment":"not collected"}', headers: { 'CF-Region-Code': '27' } }), env);
    assert.equal(first.status, 204);
    assert.equal(await first.text(), '');
    assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://valley-3333.github.io');
    await worker.fetch(request(), env);
    assert.equal(database.prepare('SELECT views FROM daily_pageviews WHERE prefecture = ?').get('東京都').views, 2);
    assert.equal(database.prepare('SELECT count(*) AS count FROM daily_pageviews WHERE prefecture = ?').get('大阪府').count, 0);

    await worker.fetch(request({ cf: { country: 'JP' } }), env);
    await worker.fetch(request({ cf: { country: 'US' } }), env);
    assert.equal(total(), 4);
    assert.deepEqual(database.prepare('PRAGMA table_info(daily_pageviews)').all().map(column => column.name), ['day_jst', 'prefecture', 'views']);
    const json = JSON.stringify(database.prepare('SELECT * FROM daily_pageviews').all());
    assert.equal(json.includes('192.0.2.'), false);
    assert.equal(json.includes('not collected'), false);

    const burstIp = '198.51.100.1';
    for (let index = 0; index < 30; index++) assert.equal((await worker.fetch(request({ ip: burstIp }), env)).status, 204);
    assert.equal((await worker.fetch(request({ ip: burstIp }), env)).status, 429);
    assert.equal(total(), 34);
    assert.equal((await worker.fetch(request({ cf: null }), env)).status, 503);
    assert.equal((await worker.fetch(request(), {})).status, 503);
    const failed = await worker.fetch(request(), { REGION_DB: { prepare() { throw new Error('SECRET_DATABASE_DETAIL'); } } });
    assert.equal(failed.status, 503);
    assert.equal((await failed.text()).includes('SECRET'), false);

    const installedClientSource = fs.readFileSync(new URL('../site-analytics.js', import.meta.url), 'utf8');
    assert.match(installedClientSource, /const regionAnalyticsEnabled = true;/);
    const clientSource = installedClientSource;
    function clientContext(protocol, hostname, existingBeacon = false) {
        const scripts = [];
        const sent = [];
        const context = {
            window: { location: { protocol, hostname } },
            document: {
                querySelector: () => existingBeacon || scripts.length ? {} : null,
                createElement: () => ({ dataset: {} }),
                head: { appendChild: script => scripts.push(script) },
            },
            fetch: (url, options) => { sent.push({ url, options }); return Promise.resolve(); },
        };
        vm.createContext(context);
        vm.runInContext(clientSource, context);
        return { context, scripts, sent };
    }
    for (const [protocol, hostname] of [['file:', ''], ['http:', 'localhost'], ['https:', 'preview.example.com']]) {
        const client = clientContext(protocol, hostname);
        assert.equal(client.sent.length, 0);
        assert.equal(client.scripts.length, 0);
    }
    const client = clientContext('https:', 'valley-3333.github.io');
    vm.runInContext(clientSource, client.context);
    assert.equal(client.sent.length, 1);
    assert.equal(client.scripts.length, 1);
    assert.equal(client.sent[0].options.method, 'POST');
    assert.equal(client.sent[0].options.credentials, 'omit');
    assert.equal(client.sent[0].options.referrerPolicy, 'no-referrer');
    assert.equal(client.sent[0].options.body, undefined);
    assert.equal(client.sent[0].options.headers, undefined);
    const alreadyInstalled = clientContext('https:', 'valley-3333.github.io', true);
    assert.equal(alreadyInstalled.sent.length, 1);
    assert.equal(alreadyInstalled.scripts.length, 0);
    const disabledClient = clientContext('https:', 'valley-3333.github.io');
    disabledClient.sent.length = 0;
    delete disabledClient.context.window.__valleyRegionAnalyticsSent;
    vm.runInContext(installedClientSource.replace('const regionAnalyticsEnabled = true;', 'const regionAnalyticsEnabled = false;'), disabledClient.context);
    assert.equal(disabledClient.sent.length, 0);
    console.log('PASS: JST day boundary, prefectures, unknown regions, CORS/method restrictions, metadata spoof prevention, atomic aggregate counts, no personal fields, burst limits and safe failures.');
    console.log('PASS: browser sends once per published document, sends no body/credentials/referrer, coexists with the analytics beacon and skips local previews.');
} finally {
    database.close();
}
