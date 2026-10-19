(() => {
    'use strict';

    // Count only the published site, never file:// or local previews.
    if (window.location.protocol !== 'https:' || window.location.hostname !== 'valley-3333.github.io') return;
    if (document.querySelector('script[data-cf-beacon]')) return;

    const beacon = document.createElement('script');
    beacon.type = 'module';
    beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    // Public installation token, not an account API token or administrator key.
    beacon.dataset.cfBeacon = JSON.stringify({ token: 'cdb5deaca7dd45569d0e09193db9b85f' });
    document.head.appendChild(beacon);
})();
