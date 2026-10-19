(() => {
    'use strict';

    // Count only the published site, never file:// or local previews.
    if (window.location.protocol !== 'https:' || window.location.hostname !== 'valley-3333.github.io') return;
    if (!document.querySelector('script[data-cf-beacon]')) {
        const beacon = document.createElement('script');
        beacon.type = 'module';
        beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        // Public installation token, not an account API token or administrator key.
        beacon.dataset.cfBeacon = JSON.stringify({ token: 'cdb5deaca7dd45569d0e09193db9b85f' });
        document.head.appendChild(beacon);
    }

    // Worker deployment, Origin restrictions and D1 writes verified on 2026-10-19.
    const regionAnalyticsEnabled = true;
    // One page view per document. No GPS, cookies, user ID, URL or comment text.
    if (regionAnalyticsEnabled && !window.__valleyRegionAnalyticsSent) {
        window.__valleyRegionAnalyticsSent = true;
        void fetch('https://valley-region-analytics.hoi4-pdf-distribution.workers.dev/collect', {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            keepalive: true,
        }).catch(() => {});
    }
})();
