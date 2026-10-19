const SITE_ORIGIN = 'https://valley-3333.github.io';
const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

// Best-effort per-isolate burst protection. Hashes live in memory for one minute;
// neither raw IPs nor hashes are written to D1 or returned to the client.
let rateSalt;
const minuteBuckets = new Map();
let currentMinute = -1;

export function toJstDay(timestamp) {
    return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getPrefecture(cf) {
    if (cf.country !== 'JP') return '海外・地域不明';
    const code = String(cf.regionCode ?? '').replace(/^JP-/, '');
    if (!/^\d{1,2}$/.test(code)) return '国内・都道府県不明';
    return PREFECTURES[Number(code) - 1] || '国内・都道府県不明';
}

async function permitBurst(address, now) {
    rateSalt ||= crypto.randomUUID();
    const minute = Math.floor(now / 60000);
    if (minute !== currentMinute) {
        minuteBuckets.clear();
        currentMinute = minute;
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${rateSalt}:${minute}:${address}`));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const count = minuteBuckets.get(key) || 0;
    if (count >= 30 || (!count && minuteBuckets.size >= 4096)) return false;
    minuteBuckets.set(key, count + 1);
    return true;
}

function reply(status, cors = false, extra = {}) {
    return new Response(null, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...(cors ? { 'Access-Control-Allow-Origin': SITE_ORIGIN, Vary: 'Origin' } : {}),
            ...extra,
        },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!['/collect', '/unique'].includes(url.pathname) || url.search) return reply(404);
        if (!['POST', 'OPTIONS'].includes(request.method)) return reply(405, false, { Allow: 'POST, OPTIONS' });
        if (request.headers.get('Origin') !== SITE_ORIGIN) return reply(403);
        if (request.method === 'OPTIONS') {
            return reply(204, true, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' });
        }
        if (!env.REGION_DB || !request.cf) return reply(503, true);
        const address = request.headers.get('CF-Connecting-IP');
        if (!address) return reply(503, true);

        try {
            const now = Date.now();
            if (!await permitBurst(address, now)) return reply(429, true, { 'Retry-After': '60' });
            // Location is supplied by Cloudflare, never trusted from headers or body.
            // Do not read the body: comments, user IDs, URLs and coordinates are unnecessary.
            const day = toJstDay(now);
            const statement = url.pathname === '/unique' ? `
                INSERT INTO daily_unique_browsers (day_jst, prefecture, browsers) VALUES (?, ?, 1)
                ON CONFLICT(day_jst, prefecture) DO UPDATE SET browsers = browsers + 1
            ` : `
                INSERT INTO daily_pageviews (day_jst, prefecture, views) VALUES (?, ?, 1)
                ON CONFLICT(day_jst, prefecture) DO UPDATE SET views = views + 1
            `;
            await env.REGION_DB.prepare(statement).bind(day, getPrefecture(request.cf)).run();
            return reply(204, true, {
                'X-Region-Analytics-Day': day,
                'Access-Control-Expose-Headers': 'X-Region-Analytics-Day',
            });
        } catch {
            // Analytics failures never expose database details or block the website.
            return reply(503, true);
        }
    },
};
