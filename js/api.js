// api.js
// Gestion de la durée de cache pour le refresh des prix (PriceService).
// Plus de dépendance AppScript — toutes les données sont dans localStorage.

const CACHE_TTL_KEY     = 'portfolio_cache_ttl';
const CACHE_TTL_DEFAULT = 60 * 60 * 1000; // 1 heure par défaut pour les prix

const API = {
  get cacheTTL() {
    const v = localStorage.getItem(CACHE_TTL_KEY);
    return v ? Number(v) : CACHE_TTL_DEFAULT;
  },
  getCacheTTLMinutes() { return Math.round(this.cacheTTL / 60000); },
  setCacheTTL(minutes) {
    localStorage.setItem(CACHE_TTL_KEY, Math.max(1, Number(minutes)) * 60000);
  },
};
