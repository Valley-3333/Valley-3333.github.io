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
    const regionEndpoint = 'https://valley-region-analytics.hoi4-pdf-distribution.workers.dev';
    const requestOptions = {
        method: 'POST', mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', keepalive: true,
    };
    const dailyStorageKey = 'valley-analytics-last-counted-day';
    const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day || '');

    async function countDailyBrowser(day) {
        // Store only the server's JST date, never an identifier or browsing history.
        // If storage is unavailable, skip uniques instead of counting every page.
        try {
            const previousDay = window.localStorage.getItem(dailyStorageKey);
            if (previousDay === day) return;
            // Verify writes are allowed before recording a unique view on the server.
            window.localStorage.setItem(dailyStorageKey, previousDay || '');
            const result = await fetch(`${regionEndpoint}/unique`, requestOptions);
            const countedDay = result.headers.get('X-Region-Analytics-Day');
            if (result.status === 204 && validDay(countedDay)) {
                window.localStorage.setItem(dailyStorageKey, countedDay);
            }
        } catch { /* Analytics and storage errors must not affect the page. */ }
    }

    // One page view per document. No GPS, cookies, user ID, URL or comment text.
    if (regionAnalyticsEnabled && !window.__valleyRegionAnalyticsSent) {
        window.__valleyRegionAnalyticsSent = true;
        void fetch(`${regionEndpoint}/collect`, requestOptions).then(result => {
            const day = result.headers.get('X-Region-Analytics-Day');
            // Old Workers do not send this header: page views keep working during rollout.
            if (result.status !== 204 || !validDay(day)) return;
            if (window.navigator?.locks) {
                return window.navigator.locks.request('valley-analytics-daily', () => countDailyBrowser(day));
            }
            return countDailyBrowser(day);
        }).catch(() => {});
    }
})();
