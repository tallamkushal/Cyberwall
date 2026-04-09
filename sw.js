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
