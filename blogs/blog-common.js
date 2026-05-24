// =============================================================================
// blog-common.js
// ブログ記事共通機能（グッドボタン / X共有 / Giscusコメント）
// =============================================================================

// ---------------------------------------------------------------------------
// 🔧 設定（Giscus）
// Giscus を有効にするには、以下の手順が必要です:
//   1. GitHub リポジトリの Settings → Features → Discussions を有効にする
//   2. https://github.com/apps/giscus にアクセスしてアプリをインストール
//   3. https://giscus.app/ で設定値を取得し、以下に記入する
// ---------------------------------------------------------------------------
const GISCUS_CONFIG = {
    repo:               'Valley-3333/Valley-3333.github.io',  // ← あなたのリポジトリ
    repoId:             'R_kgDONuReyA',                        // ← giscus.app で取得
    category:           'Announcements',                       // ← Discussions のカテゴリ名
    categoryId:         'DIC_kwDONuReyM4C9wEP',                // ← giscus.app で取得
    mapping:            'pathname',                            // URL パスで紐付け
    reactionsEnabled:   '1',
    emitMetadata:       '0',
    inputPosition:      'top',
    theme:              'light',
    lang:               'ja',
};

// ---------------------------------------------------------------------------
// ページ固有キー（LocalStorage 用）
// ---------------------------------------------------------------------------
function getBlogId() {
    const path = window.location.pathname;
    const match = path.match(/blog(\d+)\.html/);
    return match ? 'blog' + match[1] : 'blog_unknown';
}

// ---------------------------------------------------------------------------
// DOM 構築 & 挿入（DOMContentLoaded）
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const navContainer = document.querySelector('.external-nav-container');
    if (!navContainer) return;

    // コンテナを作成
    const wrapper = document.createElement('div');
    wrapper.className = 'blog-actions-wrapper';
    wrapper.innerHTML = buildActionsHTML();

    // .external-nav-container の直前に挿入
    navContainer.parentNode.insertBefore(wrapper, navContainer);

    // 機能を初期化
    initGoodButton();
    initShareButton();
    initGiscus();
});

// ---------------------------------------------------------------------------
// HTML テンプレート
// ---------------------------------------------------------------------------
function buildActionsHTML() {
    return `
        <!-- グッド & 共有ボタン -->
        <div class="blog-actions" id="blogActions">
            <button class="blog-action-btn good-btn" id="goodBtn" type="button" aria-label="いいね">
                <span class="good-btn-icon">
                    <i class="far fa-thumbs-up" id="goodIcon"></i>
                </span>
                <span class="good-btn-label">いいね</span>
                <span class="good-btn-count" id="goodCount">0</span>
            </button>

            <button class="blog-action-btn share-x-btn" id="shareXBtn" type="button" aria-label="Xで共有">
                <i class="fa-brands fa-x-twitter"></i>
                <span>共有</span>
            </button>
        </div>

        <!-- Giscus コメントエリア -->
        <div class="blog-comments" id="blogComments">
            <h3 class="blog-comments-title">
                <i class="far fa-comment-dots"></i>
                コメント
            </h3>
            <div id="giscusContainer"></div>
        </div>
    `;
}

// =============================================================================
// ① グッドボタン（LocalStorage 版）
// =============================================================================
function initGoodButton() {
    const btn       = document.getElementById('goodBtn');
    const icon      = document.getElementById('goodIcon');
    const countEl   = document.getElementById('goodCount');
    if (!btn || !icon || !countEl) return;

    const blogId    = getBlogId();
    const likedKey  = 'good_liked_' + blogId;
    const countKey  = 'good_count_' + blogId;

    // 保存済みの状態を復元
    let count  = parseInt(localStorage.getItem(countKey) || '0', 10);
    let liked  = localStorage.getItem(likedKey) === '1';

    // 表示を更新
    renderGood(btn, icon, countEl, count, liked);

    btn.addEventListener('click', () => {
        if (liked) {
            // いいね解除
            count = Math.max(0, count - 1);
            liked = false;
        } else {
            // いいね
            count += 1;
            liked = true;
            // パーティクルアニメーション
            spawnParticles(btn);
        }
        localStorage.setItem(countKey, String(count));
        localStorage.setItem(likedKey,  liked ? '1' : '0');
        renderGood(btn, icon, countEl, count, liked);
    });
}

function renderGood(btn, icon, countEl, count, liked) {
    countEl.textContent = count;
    if (liked) {
        btn.classList.add('good-btn--active');
        icon.className = 'fas fa-thumbs-up';   // 塗りアイコン
    } else {
        btn.classList.remove('good-btn--active');
        icon.className = 'far fa-thumbs-up';   // 線アイコン
    }
}

// いいね時のパーティクルエフェクト
function spawnParticles(btn) {
    const rect = btn.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
        const p = document.createElement('span');
        p.className = 'good-particle';
        p.style.left = (rect.left + rect.width / 2) + 'px';
        p.style.top  = (rect.top  + rect.height / 2) + 'px';
        const angle  = (Math.PI * 2 / 6) * i;
        const dist   = 25 + Math.random() * 20;
        p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
        document.body.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
    }
}

// ---------------------------------------------------------------------------
// 🔥 Firebase Realtime Database で全ユーザーのカウントを同期する場合の実装案
// ---------------------------------------------------------------------------
/*
// ◆ 準備
//   1. Firebase プロジェクトを作成
//   2. Realtime Database を有効にし、ルールを設定:
//      { "rules": { "likes": { "$blogId": { ".read": true, ".write": true } } } }
//   3. HTML の <head> に Firebase SDK を追加:
//      <script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-app-compat.js"></script>
//      <script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-database-compat.js"></script>

// ◆ 初期化コード（blog-common.js の先頭付近に追加）
const firebaseConfig = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId:         "YOUR_PROJECT",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ◆ initGoodButton を置き換え
function initGoodButton_Firebase() {
    const btn     = document.getElementById('goodBtn');
    const icon    = document.getElementById('goodIcon');
    const countEl = document.getElementById('goodCount');
    if (!btn) return;

    const blogId   = getBlogId();
    const likedKey = 'good_liked_' + blogId;
    const ref      = db.ref('likes/' + blogId);

    // リアルタイムでカウントを監視
    ref.on('value', (snapshot) => {
        const count = snapshot.val() || 0;
        const liked = localStorage.getItem(likedKey) === '1';
        renderGood(btn, icon, countEl, count, liked);
    });

    btn.addEventListener('click', () => {
        const liked = localStorage.getItem(likedKey) === '1';
        if (liked) {
            ref.transaction(c => Math.max(0, (c || 0) - 1));
            localStorage.setItem(likedKey, '0');
        } else {
            ref.transaction(c => (c || 0) + 1);
            localStorage.setItem(likedKey, '1');
            spawnParticles(btn);
        }
    });
}
*/

// =============================================================================
// ② X（旧Twitter）共有ボタン
// =============================================================================
function initShareButton() {
    const btn = document.getElementById('shareXBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const title = document.title;
        const url   = window.location.href;
        const text  = encodeURIComponent(title);
        const link  = encodeURIComponent(url);
        const intentURL = `https://twitter.com/intent/tweet?text=${text}&url=${link}`;

        // ポップアップウィンドウで開く（550×420）
        const w = 550, h = 420;
        const left = (screen.width  - w) / 2;
        const top  = (screen.height - h) / 2;
        window.open(
            intentURL,
            'share_x',
            `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,status=no`
        );
    });
}

// =============================================================================
// ③ Giscus コメント
// =============================================================================
function initGiscus() {
    const container = document.getElementById('giscusContainer');
    if (!container) return;

    // プレースホルダー設定のままの場合はメッセージを表示
    if (GISCUS_CONFIG.repoId === 'YOUR_REPO_ID' || GISCUS_CONFIG.categoryId === 'YOUR_CATEGORY_ID') {
        container.innerHTML = `
            <div class="giscus-placeholder">
                <i class="fas fa-info-circle"></i>
                <p>コメント機能を有効にするには <code>blog-common.js</code> の <code>GISCUS_CONFIG</code> を設定してください。</p>
                <a href="https://giscus.app/" target="_blank" rel="noopener noreferrer">Giscus 設定ページへ →</a>
            </div>
        `;
        return;
    }

    const script = document.createElement('script');
    script.src               = 'https://giscus.app/client.js';
    script.setAttribute('data-repo',               GISCUS_CONFIG.repo);
    script.setAttribute('data-repo-id',            GISCUS_CONFIG.repoId);
    script.setAttribute('data-category',           GISCUS_CONFIG.category);
    script.setAttribute('data-category-id',        GISCUS_CONFIG.categoryId);
    script.setAttribute('data-mapping',            GISCUS_CONFIG.mapping);
    script.setAttribute('data-reactions-enabled',   GISCUS_CONFIG.reactionsEnabled);
    script.setAttribute('data-emit-metadata',       GISCUS_CONFIG.emitMetadata);
    script.setAttribute('data-input-position',      GISCUS_CONFIG.inputPosition);
    script.setAttribute('data-theme',               GISCUS_CONFIG.theme);
    script.setAttribute('data-lang',                GISCUS_CONFIG.lang);
    script.crossOrigin = 'anonymous';
    script.async       = true;

    container.appendChild(script);
}
