# Product Roadmap

## Planned

- **Fix stale PWA updates on iPhone (service worker cache invalidation)**
  - Move app-shell caching from permanent cache-first to an update-friendly strategy (network-first or stale-while-revalidate for `index.html`, `app.js`, `styles.css`, and `manifest.json`).
  - Ensure cache versioning is release-aware so iOS clients reliably receive new JS/CSS after deploy.
  - Add a lightweight update path (e.g., immediate activation + client refresh signal) so installed home-screen apps do not remain on old functionality.
  - Validate behavior on iPhone and iPad for install, upgrade, and cold-start flows.
