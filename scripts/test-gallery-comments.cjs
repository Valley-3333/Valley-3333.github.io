// UI regression checks using an explicit Supabase/Turnstile mock.
// Requires Playwright and Chrome; no external service or credentials are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const sdkMock = `window.__galleryMock = { reads: [], posts: [], signIns: 0, session: null, failRead: false, postError: null, rows: [] };
window.supabase = { createClient: () => ({
    auth: {
        getSession: async () => ({ data: { session: window.__galleryMock.session } }),
        signInAnonymously: async ({ options }) => {
            const s = window.__galleryMock;
            s.signIns++;
            s.captchaToken = options.captchaToken;
            s.session = { user: { id: 'test-user' } };
            return { data: { session: s.session }, error: null };
        },
    },
    from: () => {
        let imageId;
        const query = {
            select() { return this; },
            eq(column, value) { imageId = value; return this; },
            order() { return this; },
            async range(start, end) {
                const s = window.__galleryMock;
                s.reads.push(imageId);
                if (s.failRead) return { error: { message: 'Network failure' } };
                return { data: s.rows.filter(row => row.image_id === imageId).slice(start, end + 1), error: null };
            },
        };
        return query;
    },
    rpc: async (name, args) => {
        const s = window.__galleryMock;
        s.posts.push({ name, args });
        if (s.postError) return { error: { message: s.postError } };
        s.rows.unshift({ id: String(s.posts.length), image_id: args.p_image_id, author_label: '匿名-test', body: args.p_body, created_at: new Date().toISOString() });
        return { error: null };
    },
}) };`;

const captchaMock = `window.turnstile = {
    render(selector, options) {
        window.__captchaOptions = options;
        document.querySelector(selector).textContent = '認証確認（テスト）';
        return 'test-widget';
    },
    remove() {}, reset() {},
};`;

async function main() {
    // Prevent accidental ID changes between the gallery and the database catalog.
    const html = fs.readFileSync(path.join(root, 'gallery.html'), 'utf8');
    const sql = fs.readFileSync(path.join(root, 'supabase/gallery-comments.sql'), 'utf8');
    const imageIds = [...html.matchAll(/\{ id: (\d+), image:/g)].map(m => Number(m[1]));
    const catalog = sql.split('insert into public.gallery_comment_images')[1].split(';')[0];
    const databaseIds = [...catalog.matchAll(/\((\d+), '/g)].map(m => Number(m[1]));
    assert.deepEqual(databaseIds, imageIds);
    assert.equal(new Set(imageIds).size, imageIds.length);

    let browser;
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [];
        const externalRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        let configured = false;
        let captcha = false;
        await page.route('**/*', async route => {
            const url = route.request().url();
            if (url.endsWith('/gallery-comments-config.js')) {
                // Never load real project settings, even after local setup.
                return route.fulfill({ contentType: 'text/javascript', body: configured
                    ? `window.GALLERY_COMMENTS_CONFIG = { supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', turnstileSiteKey: '${captcha ? 'test-sitekey' : ''}' };`
                    : 'window.GALLERY_COMMENTS_CONFIG = {};'
                });
            }
            if (!url.startsWith('http://gallery.test/')) {
                externalRequests.push(url);
                if (url.includes('/supabase-js@')) return route.fulfill({ contentType: 'text/javascript', body: sdkMock });
                if (url.includes('challenges.cloudflare.com')) return route.fulfill({ contentType: 'text/javascript', body: captchaMock });
                return route.abort();
            }
            // Serve local files through routing; this test makes no network calls.
            const filename = path.resolve(root, '.' + decodeURIComponent(new URL(url).pathname));
            if (!filename.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
            const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
            return route.fulfill({ path: filename, contentType: mime[path.extname(filename)] || 'application/octet-stream' });
        });
        const url = 'http://gallery.test/gallery.html';
        const open = async name => {
            await page.getByRole('button', { name: name + 'へのコメント', exact: true }).click();
            await page.waitForFunction(() => document.getElementById('galleryCommentsDialog').open);
        };
        const close = () => page.getByRole('button', { name: '閉じる', exact: true }).click();
        const waitRead = () => page.waitForFunction(() => document.getElementById('galleryCommentsReadStatus').textContent.includes('最初の感想') || document.querySelector('#galleryCommentsList li'));
        await page.goto(url);
        assert.equal(await page.locator('.gallery-open-comments').count(), imageIds.length);
        await open('ぞう');
        assert.equal(await page.locator('#galleryCommentsUnavailable').isVisible(), true);
        assert.equal(await page.locator('#galleryCommentForm').isVisible(), false);
        assert.equal(externalRequests.some(url => /supabase|turnstile/.test(url)), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: 'ぞうへのコメント', exact: true }).evaluate(el => el === document.activeElement), true);

        configured = true;
        await page.reload();
        await open('ぞう');
        await waitRead();
        assert.equal(await page.evaluate(() => window.__galleryMock.signIns), 0);
        const input = page.locator('#galleryCommentBody');
        await input.fill('ぞうへの下書き');
        await page.setViewportSize({ width: 1100, height: 800 });
        assert.equal(await input.inputValue(), 'ぞうへの下書き');
        await close();
        await open('こねこ');
        await waitRead();
        assert.equal(await input.inputValue(), '');
        await close();
        await open('ぞう');
        await waitRead();
        assert.equal(await input.inputValue(), 'ぞうへの下書き');
        const payload = '<img src=x onerror="window.__xss=true">\nいい絵ですね';
        await input.fill('  ' + payload + '  ');
        await page.getByRole('button', { name: '匿名で投稿する', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('galleryCommentStatus').textContent.includes('公開しました'));
        assert.equal(await page.locator('#galleryCommentsList li p').first().textContent(), payload);
        assert.equal(await page.locator('#galleryCommentsList img').count(), 0);
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        assert.equal(await page.evaluate(() => window.__galleryMock.signIns), 1);
        assert.deepEqual(await page.evaluate(() => window.__galleryMock.posts[0]), { name: 'post_gallery_comment', args: { p_image_id: 1, p_body: payload } });
        if (process.env.GALLERY_TEST_SCREENSHOT) {
            await page.locator('#galleryCommentsDialog').evaluate(el => { el.scrollTop = 0; });
            await page.screenshot({ path: process.env.GALLERY_TEST_SCREENSHOT.replace(/\.png$/, '-desktop.png') });
        }
        await close();
        await open('こねこ');
        await waitRead();
        assert.equal(await page.locator('#galleryCommentsList li').count(), 0);
        await input.fill('🐘'.repeat(500));
        assert.equal(await input.evaluate(el => el.checkValidity()), true);
        await input.fill('🐘'.repeat(501));
        assert.equal(await input.evaluate(el => el.checkValidity()), false);
        await input.fill('再投稿の内容');
        await page.evaluate(() => { window.__galleryMock.postError = 'GALLERY_RATE_LIMIT'; });
        await page.getByRole('button', { name: '匿名で投稿する', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('galleryCommentStatus').textContent.includes('60秒'));
        assert.equal(await input.inputValue(), '再投稿の内容');
        await page.evaluate(() => { window.__galleryMock.postError = 'GALLERY_BLOCKED'; });
        await page.getByRole('button', { name: '匿名で投稿する', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('galleryCommentStatus').textContent.includes('停止'));

        await page.evaluate(() => { window.__galleryMock.failRead = true; });
        await page.getByRole('button', { name: '更新', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('galleryCommentsReadStatus').textContent.includes('読み込めません'));
        await page.evaluate(() => {
            window.__galleryMock.failRead = false;
            window.__galleryMock.rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i), image_id: 2, author_label: '匿名-test', body: 'コメント ' + i, created_at: new Date().toISOString() }));
        });
        await page.getByRole('button', { name: '更新', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('#galleryCommentsList li').length === 20);
        await page.getByRole('button', { name: 'もっと見る', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('#galleryCommentsList li').length === 25);
        assert.equal(await page.locator('#galleryCommentsMore').isVisible(), false);
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(await page.locator('#galleryCommentsDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        await page.locator('#galleryCommentsDialog').evaluate(el => { el.scrollTop = 0; });
        const screenshot = process.env.GALLERY_TEST_SCREENSHOT || path.join(os.tmpdir(), 'valley-gallery-comments-mobile.png');
        await page.screenshot({ path: screenshot });
        console.log('Mobile screenshot:', screenshot);
        await close();

        captcha = true;
        await page.reload();
        await open('ぞう');
        await page.waitForFunction(() => window.__captchaOptions);
        assert.equal(await page.locator('#galleryCommentSubmit').isDisabled(), true);
        await page.evaluate(() => window.__captchaOptions.callback('verified-token'));
        await input.fill('確認後の投稿');
        await page.getByRole('button', { name: '匿名で投稿する', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('galleryCommentStatus').textContent.includes('公開しました'));
        assert.equal(await page.evaluate(() => window.__galleryMock.captchaToken), 'verified-token');
        assert.equal(await page.locator('#galleryCommentCaptcha').textContent(), '');
        assert.deepEqual(errors, []);
        console.log('PASS: catalog IDs, unconfigured state, image isolation, drafts, safe text, anonymous posting, Unicode limit, error recovery, pagination, mobile layout, CAPTCHA and focus.');
        console.log('Supabase is mocked; live database permissions and SQL execution still require a configured project.');
    } finally {
        if (browser) await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
