(() => {
    'use strict';

    const config = window.GALLERY_COMMENTS_CONFIG || {};
    const configured = Boolean(config.supabaseUrl && config.publishableKey);
    const byId = id => document.getElementById(id);
    const dialog = byId('galleryCommentsDialog');
    const form = byId('galleryCommentForm');
    const body = byId('galleryCommentBody');
    const submit = byId('galleryCommentSubmit');
    const status = byId('galleryCommentStatus');
    const readStatus = byId('galleryCommentsReadStatus');
    const list = byId('galleryCommentsList');
    const refresh = byId('galleryCommentsRefresh');
    const more = byId('galleryCommentsMore');
    const drafts = new Map();
    const pageSize = 20;
    let activeItem = null;
    let clientPromise;
    let turnstilePromise;
    let widgetId = null;
    let captchaToken = '';
    let captchaRequired = false;
    let posting = false;
    let reading = false;
    let readVersion = 0;
    let offset = 0;

    // External code is loaded only when the configured comments are opened.
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            const timer = setTimeout(() => {
                script.remove();
                reject(new Error('SCRIPT_LOAD_FAILED'));
            }, 15000);
            script.onload = () => { clearTimeout(timer); resolve(); };
            script.onerror = () => {
                clearTimeout(timer);
                script.remove();
                reject(new Error('SCRIPT_LOAD_FAILED'));
            };
            document.head.appendChild(script);
        });
    }

    function getClient() {
        if (!clientPromise) {
            clientPromise = loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js')
                .then(() => window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
                    auth: {
                        storageKey: 'valley-gallery-anonymous-auth',
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: false,
                    },
                }))
                .catch(error => { clientPromise = null; throw error; });
        }
        return clientPromise;
    }

    function updateControls() {
        body.disabled = posting;
        submit.disabled = posting || (captchaRequired && !captchaToken);
        submit.textContent = posting ? '投稿中…' : '匿名で投稿する';
        refresh.disabled = reading;
        more.disabled = reading;
        const length = Array.from(body.value).length;
        byId('galleryCommentCount').textContent = `${length} / 500`;
        body.setCustomValidity(length > 500 ? 'コメントは500文字以内で入力してください。' : '');
    }

    function removeCaptcha() {
        if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
        widgetId = null;
        captchaToken = '';
        captchaRequired = false;
        byId('galleryCommentCaptcha').replaceChildren();
    }

    async function prepareCaptcha(item) {
        if (!config.turnstileSiteKey) return;
        captchaRequired = true;
        updateControls();
        const client = await getClient();
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (activeItem !== item || !dialog.open) return;
        if (data.session) {
            captchaRequired = false;
            updateControls();
            return;
        }
        if (!turnstilePromise) {
            turnstilePromise = loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
                .catch(error => { turnstilePromise = null; throw error; });
        }
        await turnstilePromise;
        if (activeItem !== item || !dialog.open || widgetId !== null) return;
        widgetId = window.turnstile.render('#galleryCommentCaptcha', {
            sitekey: config.turnstileSiteKey,
            theme: 'light',
            size: 'flexible',
            callback: token => { captchaToken = token; status.textContent = ''; updateControls(); },
            'expired-callback': () => { captchaToken = ''; updateControls(); },
            'error-callback': () => {
                captchaToken = '';
                status.textContent = '確認に失敗しました。コメント欄を開き直してください。';
                updateControls();
            },
        });
    }

    function renderComment(comment) {
        const row = document.createElement('li');
        const header = document.createElement('div');
        header.className = 'gallery-comment-meta';
        const author = document.createElement('strong');
        author.textContent = comment.author_label;
        const time = document.createElement('time');
        time.dateTime = comment.created_at;
        time.textContent = new Intl.DateTimeFormat('ja-JP', {
            dateStyle: 'medium', timeStyle: 'short',
        }).format(new Date(comment.created_at));
        const text = document.createElement('p');
        // User text is never interpreted as HTML or rendered as external links.
        text.textContent = comment.body;
        header.append(author, time);
        row.append(header, text);
        return row;
    }

    async function loadComments(append = false) {
        const item = activeItem;
        const version = ++readVersion;
        reading = true;
        readStatus.textContent = 'コメントを読み込み中…';
        more.hidden = true;
        updateControls();
        try {
            const client = await getClient();
            const start = append ? offset : 0;
            const { data, error } = await client.from('gallery_comments')
                .select('id, image_id, author_label, body, created_at')
                .eq('image_id', item.id)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(start, start + pageSize);
            if (error) throw error;
            if (version !== readVersion || activeItem !== item || !dialog.open) return;
            if (!append) list.replaceChildren();
            const comments = data.slice(0, pageSize);
            list.append(...comments.map(renderComment));
            offset = start + comments.length;
            more.hidden = data.length <= pageSize;
            readStatus.textContent = offset ? '新しいコメントから表示しています。' : 'まだコメントはありません。最初の感想をどうぞ。';
        } catch {
            if (version === readVersion && dialog.open) {
                readStatus.textContent = 'コメントを読み込めませんでした。「更新」から再試行できます。';
                // Retain a retry route for pagination failures.
                more.hidden = !append;
            }
        } finally {
            if (version === readVersion) { reading = false; updateControls(); }
        }
    }

    window.addEventListener('gallery:comments', async event => {
        if (activeItem) drafts.set(activeItem.id, body.value);
        removeCaptcha();
        const item = event.detail;
        activeItem = item;
        ++readVersion;
        reading = false;
        offset = 0;
        byId('galleryCommentsTitle').textContent = `${item.title}へのコメント`;
        byId('galleryCommentsImage').src = item.image;
        byId('galleryCommentsImage').alt = item.title;
        byId('galleryCommentsDescription').textContent = item.description;
        byId('galleryCommentsUnavailable').hidden = configured;
        form.hidden = !configured;
        refresh.hidden = !configured;
        more.hidden = true;
        status.textContent = '';
        readStatus.textContent = '';
        list.replaceChildren();
        body.value = drafts.get(item.id) || '';
        updateControls();
        if (!dialog.open) dialog.showModal();
        if (!configured) return;
        void loadComments();
        try {
            await prepareCaptcha(item);
        } catch {
            if (activeItem === item && dialog.open) {
                status.textContent = '投稿前の確認を読み込めませんでした。コメント欄を開き直してください。';
            }
        }
    });

    function postError(error) {
        const message = error.message || '';
        if (message.includes('GALLERY_RATE_LIMIT')) return '投稿は60秒に1回です。少し待ってから再投稿してください。';
        if (message.includes('GALLERY_BLOCKED')) return 'この匿名IDからの投稿は停止されています。';
        if (message.includes('GALLERY_INVALID_BODY')) return 'コメントは1〜500文字で入力してください。';
        if (message.includes('CAPTCHA_REQUIRED') || /captcha/i.test(message)) return '投稿前の確認を完了して、もう一度お試しください。';
        return '投稿できませんでした。通信状態を確認して再度お試しください。';
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (posting || !activeItem || !configured) return;
        const item = activeItem;
        const text = body.value.trim();
        if (!text || Array.from(text).length > 500) {
            status.textContent = 'コメントは1〜500文字で入力してください。';
            body.focus();
            return;
        }
        posting = true;
        updateControls();
        status.textContent = '投稿中…';
        try {
            const client = await getClient();
            const { data, error: sessionError } = await client.auth.getSession();
            if (sessionError) throw sessionError;
            if (!data.session) {
                if (config.turnstileSiteKey && !captchaToken) {
                    await prepareCaptcha(item);
                    throw new Error('CAPTCHA_REQUIRED');
                }
                const { error } = await client.auth.signInAnonymously({ options: { captchaToken } });
                if (error) {
                    if (widgetId !== null) window.turnstile.reset(widgetId);
                    captchaToken = '';
                    throw error;
                }
                if (activeItem === item) removeCaptcha();
            }
            const { error } = await client.rpc('post_gallery_comment', { p_image_id: item.id, p_body: text });
            if (error) throw error;
            drafts.delete(item.id);
            if (activeItem === item && dialog.open) {
                body.value = '';
                status.textContent = 'コメントを公開しました。ありがとうございます。';
                await loadComments();
            }
        } catch (error) {
            if (activeItem === item && dialog.open) status.textContent = postError(error);
        } finally {
            posting = false;
            updateControls();
        }
    });

    body.addEventListener('input', updateControls);
    refresh.addEventListener('click', () => { void loadComments(); });
    more.addEventListener('click', () => { void loadComments(true); });
    byId('galleryCommentsClose').addEventListener('click', () => dialog.close());
    let backdropPressed = false;
    function isOutsideDialog(event) {
        const bounds = dialog.getBoundingClientRect();
        return event.target === dialog && (
            event.clientX < bounds.left || event.clientX >= bounds.right ||
            event.clientY < bounds.top || event.clientY >= bounds.bottom
        );
    }
    dialog.addEventListener('pointerdown', event => {
        backdropPressed = event.button === 0 && isOutsideDialog(event);
    });
    dialog.addEventListener('click', event => {
        // Both press and release must be outside; selecting text must not dismiss it.
        if (backdropPressed && isOutsideDialog(event)) dialog.close();
        backdropPressed = false;
    });
    dialog.addEventListener('close', () => {
        backdropPressed = false;
        if (activeItem) drafts.set(activeItem.id, body.value);
        activeItem = null;
        ++readVersion;
        reading = false;
        removeCaptcha();
    });
})();
