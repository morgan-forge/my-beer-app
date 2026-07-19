/* My Beer – cache app shell for offline use. User data (beer-in-stock.json) is loaded via file picker, not cached. */

var CACHE_NAME = 'my-beer-v5';
var SHELL_URLS = ['index.html', 'styles.css', 'app.js', 'manifest.json'];

self.addEventListener('install', function (e) {
	e.waitUntil(
		caches.open(CACHE_NAME).then(function (cache) {
			return cache.addAll(SHELL_URLS);
		}).then(function () { return self.skipWaiting(); }).catch(function () {})
	);
});

self.addEventListener('activate', function (e) {
	e.waitUntil(
		caches.keys().then(function (names) {
			return Promise.all(
				names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); })
			);
		}).then(function () { return self.clients.claim(); })
	);
});

self.addEventListener('fetch', function (e) {
	var url = new URL(e.request.url);
	if (url.origin !== self.location.origin) return;
	if (e.request.method !== 'GET') return;
	e.respondWith(
		caches.match(e.request).then(function (cached) {
			if (cached) return cached;
			return fetch(e.request).then(function (res) {
				var clone = res.clone();
				if (res.status === 200 && /\.(html|css|js|json)$/i.test(url.pathname)) {
					caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
				}
				return res;
			});
		})
	);
});
