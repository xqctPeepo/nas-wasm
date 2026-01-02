// Service Worker for Sigma WASM PWA
// Offline-first caching strategy

const CACHE_VERSION = '0.0.1';
const CACHE_PAGES = `sigma-wasm-pages-v${CACHE_VERSION}`;
const CACHE_ASSETS = `sigma-wasm-assets-v${CACHE_VERSION}`;
const CACHE_RUNTIME = `sigma-wasm-runtime-v${CACHE_VERSION}`;
const CACHE_PKG = `sigma-wasm-pkg-v${CACHE_VERSION}`;

// Assets to pre-cache on install
// **Learning Point**: Add new HTML pages here so they're cached for offline use.
// The service worker will cache these pages on first install.
const PRECACHE_PAGES = [
  '/',
  '/index.html',
  '/pages/astar.html',
  '/pages/fractal-chat.html',
  '/pages/function-calling.html',
  '/pages/image-captioning.html',
  '/pages/preprocess-smolvlm-256m.html',
  '/pages/preprocess-smolvlm-500m.html',
  '/pages/hello-wasm.html',
  '/pages/babylon-wfc.html',
  '/pages/babylon-chunks.html',
  '/manifest.json',
];

const PRECACHE_ASSETS = [
  '/favicon.ico',
  '/rustacean.webp',
];

// Install event - pre-cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_PAGES).then((cache) => cache.addAll(PRECACHE_PAGES)),
      caches.open(CACHE_ASSETS).then((cache) => cache.addAll(PRECACHE_ASSETS)),
    ]).then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return (
              name.startsWith('sigma-wasm-') && 
              name !== CACHE_PAGES &&
              name !== CACHE_ASSETS &&
              name !== CACHE_RUNTIME &&
              name !== CACHE_PKG
            );
          })
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Helper to determine cache for a request
function getCacheName(url) {
  const urlPath = new URL(url, self.location.origin).pathname;
  
  // HTML pages
  if (urlPath.endsWith('.html') || urlPath === '/' || !urlPath.includes('.')) {
    return CACHE_PAGES;
  }
  
  // ONNX Runtime files
  if (urlPath.includes('/onnxruntime-wasm/')) {
    return CACHE_RUNTIME;
  }
  
  // WASM modules from pkg/
  if (urlPath.includes('/pkg/')) {
    return CACHE_PKG;
  }
  
  // All other assets (JS, CSS, images, etc.)
  return CACHE_ASSETS;
}

// Helper to check if request should use cache-first
function shouldUseCacheFirst(url) {
  const urlPath = new URL(url, self.location.origin).pathname;
  
  // HTML pages use network-first
  if (urlPath.endsWith('.html') || urlPath === '/' || (!urlPath.includes('.') && !urlPath.startsWith('/@'))) {
    return false;
  }
  
  // All other assets use cache-first
  return true;
}

// Helper to check if request should skip service worker interception
// External URLs (especially large model files) should bypass the service worker
// to avoid timeout issues and allow proper error handling
function shouldSkipInterception(url) {
  const urlObj = new URL(url, self.location.origin);
  
  // Skip external URLs (not same-origin)
  // This allows large model downloads to proceed without service worker interference
  if (urlObj.origin !== self.location.origin) {
    return true;
  }
  
  // Skip Hugging Face URLs (model files are large and have their own caching)
  if (url.includes('huggingface.co')) {
    return true;
  }
  
  // Skip CORS proxy URLs (already handled by model loading code)
  if (
    url.includes('api.allorigins.win') ||
    url.includes('corsproxy.io') ||
    url.includes('api.codetabs.com') ||
    url.includes('cors-anywhere.herokuapp.com') ||
    url.includes('whateverorigin.org')
  ) {
    return true;
  }
  
  return false;
}

// Fetch event - offline-first strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip Vite dev server requests
  if (url.pathname.startsWith('/@')) {
    return;
  }
  
  // Skip chrome-extension and other protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Skip interception for external URLs (especially large model files)
  // This prevents timeout issues with long downloads and allows proper error handling
  if (shouldSkipInterception(request.url)) {
    return;
  }
  
  const cacheName = getCacheName(request.url);
  const useCacheFirst = shouldUseCacheFirst(request.url);
  
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      
      if (useCacheFirst) {
        // Cache-first strategy for assets
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          // Network failed and not in cache - return error
          return new Response('Network error and resource not cached', {
            status: 408,
            statusText: 'Request Timeout',
          });
        }
      } else {
        // Network-first strategy for HTML pages
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          // Network failed, try cache
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // Not in cache either - return error
          return new Response('Network error and page not cached', {
            status: 408,
            statusText: 'Request Timeout',
          });
        }
      }
    })()
  );
});

