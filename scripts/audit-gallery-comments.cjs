// Read-only live API audit. Never signs in, creates users, or posts comments.
// The publishable key is sent only to the configured HTTPS Supabase project.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function main() {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../gallery-comments-config.js'), 'utf8'), context, { timeout: 1000 });
    const config = context.window.GALLERY_COMMENTS_CONFIG;
    const base = new URL(config.supabaseUrl);
    assert.match(base.origin, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
    assert.equal(base.pathname, '/');
    assert.equal(base.search + base.hash + base.username + base.password, '');
    assert.match(config.publishableKey, /^sb_publishable_[A-Za-z0-9_-]+$/);
    assert.match(config.turnstileSiteKey, /^0x[A-Za-z0-9_-]+$/);
    console.log('PASS: HTTPS project URL, public key type, Turnstile site key type.');

    const checks = [
        ['Public comment columns readable', '/rest/v1/gallery_comments?select=id,image_id,author_label,body,created_at&limit=0', true],
        ['Authentication UUID unreadable', '/rest/v1/gallery_comments?select=user_id&limit=0', false],
        ['Moderation flag unreadable', '/rest/v1/gallery_comments?select=is_hidden&limit=0', false],
        ['Author management table unreadable', '/rest/v1/gallery_comment_authors?select=user_id&limit=0', false],
        ['Image management table unreadable', '/rest/v1/gallery_comment_images?select=id&limit=0', false],
    ];
    let failed = false;
    for (const [name, route, allow] of checks) {
        const response = await fetch(new URL(route, base), {
            method: 'GET',
            headers: { apikey: config.publishableKey },
            redirect: 'error',
            signal: AbortSignal.timeout(12000),
        });
        const data = await response.json();
        const pass = allow
            ? response.status === 200 && Array.isArray(data) && data.length === 0
            : [401, 403].includes(response.status) && data.code === '42501';
        console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} (HTTP ${response.status}; code ${Array.isArray(data) ? 'array' : String(data.code || 'unknown')})`);
        failed ||= !pass;
    }
    const response = await fetch(new URL('/auth/v1/settings', base), {
        method: 'GET', headers: { apikey: config.publishableKey },
        redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    const settings = await response.json();
    const anonymousEnabled = response.ok && settings.external?.anonymous_users === true;
    console.log(`${anonymousEnabled ? 'PASS' : 'FAIL'}: anonymous sign-in enabled`);
    failed ||= !anonymousEnabled;
    if (failed) process.exitCode = 1;
    console.log('No users or comments were created. RLS policies, authenticated permissions, rate limits and CAPTCHA secret matching require the SQL/dashboard checks.');
}

main().catch(error => {
    // Do not print response bodies, request headers, key values, or stack traces.
    console.error('Audit could not finish:', error.code || error.cause?.code || error.name);
    process.exitCode = 1;
});
