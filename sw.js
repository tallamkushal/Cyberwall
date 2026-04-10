const CACHE = 'cyberwall-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/auth.html',
  '/dashboard.html',
  '/onboarding.html',
  '/css/style.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/cloudflare.js',
  '/js/whatsapp.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/widget-security.html',
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate — clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for API calls, cache first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network for API calls and Supabase
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) {
    return;
  }

  // Network-first for all assets so updates are picked up immediately
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── AUTH TOKEN ────────────────────────────────────────────────────────────────
// The dashboard sends the session token via postMessage so the SW can use it
// for authenticated widget data fetches.
let _authToken = null;

self.addEventListener('message', e => {
  if (e.data?.type === 'SET_TOKEN') {
    _authToken = e.data.token || null;
  }
});

// ── PWA WIDGETS ───────────────────────────────────────────────────────────────
self.addEventListener('widgetinstall', e => {
  e.waitUntil(refreshWidget(e.widget));
});

self.addEventListener('widgetresume', e => {
  e.waitUntil(refreshWidget(e.widget));
});

self.addEventListener('widgetclick', e => {
  e.waitUntil(clients.openWindow('/dashboard.html'));
});

self.addEventListener('widgetuninstall', () => {
  // nothing to clean up
});

async function refreshWidget(widget) {
  if (!self.widgets) return; // browser doesn't support Widgets API

  const [template, data] = await Promise.all([
    fetchTemplate(),
    fetchWidgetData(),
  ]);

  for (const instance of (widget.instances || [])) {
    await self.widgets.updateByInstanceId(instance.id, {
      template,
      data: JSON.stringify(data),
    });
  }
}

async function fetchTemplate() {
  try {
    const res = await fetch('/widget-security.html', { cache: 'no-store' });
    return await res.text();
  } catch {
    return '<p style="color:#fff;padding:12px">ProCyberWall</p>';
  }
}

async function fetchWidgetData() {
  if (!_authToken) {
    return {
      status_text: 'Sign in to view',
      dot_class: 'red',
      attacks_blocked: '--',
      domain: '',
      updated_at: 'Open app to sync',
    };
  }

  try {
    const res = await fetch('/api/widget-data', {
      headers: { Authorization: `Bearer ${_authToken}` },
    });
    if (!res.ok) throw new Error('auth');
    return await res.json();
  } catch {
    return {
      status_text: 'Offline',
      dot_class: 'red',
      attacks_blocked: '--',
      domain: '',
      updated_at: 'Could not refresh',
    };
  }
}
