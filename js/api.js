const CACHE_KEY     = 'portfolio_cache';
const CACHE_TTL_KEY = 'portfolio_cache_ttl';
const CACHE_TTL_DEFAULT = 5 * 60 * 1000; // 5 minutes

const API = {
  get url()   { return localStorage.getItem('appscript_url'); },
  get token() { return localStorage.getItem('appscript_token'); },

  get cacheTTL() {
    const v = localStorage.getItem(CACHE_TTL_KEY);
    return v ? Number(v) : CACHE_TTL_DEFAULT;
  },
  getCacheTTLMinutes() { return Math.round(this.cacheTTL / 60000); },
  setCacheTTL(minutes) {
    localStorage.setItem(CACHE_TTL_KEY, Math.max(1, Number(minutes)) * 60000);
  },

  isConfigured() { return !!(this.url && this.token); },

  save(url, token) {
    localStorage.setItem('appscript_url',   url.trim());
    localStorage.setItem('appscript_token', token.trim());
  },

  // ─── CACHE ──────────────────────────────────────────────────────────────────

  _getCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > this.cacheTTL) return null;
      return data;
    } catch { return null; }
  },

  _setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch {} // quota dépassé — on continue sans cache
  },

  clearCache() {
    localStorage.removeItem(CACHE_KEY);
  },

  cacheAge() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { timestamp } = JSON.parse(raw);
      return Math.floor((Date.now() - timestamp) / 1000); // en secondes
    } catch { return null; }
  },

  // ─── REQUÊTES ───────────────────────────────────────────────────────────────

  async getData(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = this._getCache();
      if (cached) return cached;
    }
    const res  = await fetch(`${this.url}?token=${encodeURIComponent(this.token)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    this._setCache(json.data);
    return json.data;
  },

  async post(action, payload = {}) {
    const res  = await fetch(this.url, {
      method: 'POST',
      body: JSON.stringify({ action, token: this.token, ...payload }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    // Toute écriture invalide le cache — le prochain getData ira chercher les données fraîches
    this.clearCache();
    return json.result;
  },

  // Comme post() mais sans invalider le cache — utilisé pour les sauvegardes silencieuses
  // (ex: profil FIRE) qui ne doivent pas déclencher un rechargement des données.
  async postSilent(action, payload = {}) {
    const res  = await fetch(this.url, {
      method: 'POST',
      body: JSON.stringify({ action, token: this.token, ...payload }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return json.result;
  },

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  createPortfolio(data)     { return this.post('createPortfolio', data); },
  updatePortfolio(data)     { return this.post('updatePortfolio', data); },
  deletePortfolio(id)       { return this.post('deletePortfolio', { id }); },

  createSubPortfolio(data)  { return this.post('createSubPortfolio', data); },
  deleteSubPortfolio(id)    { return this.post('deleteSubPortfolio', { id }); },

  createEnvelope(data)      { return this.post('createEnvelope', data); },
  updateEnvelope(data)      { return this.post('updateEnvelope', data); },
  deleteEnvelope(id)        { return this.post('deleteEnvelope', { id }); },

  addPosition(data)         { return this.post('addPosition', data); },
  updatePosition(data)      { return this.post('updatePosition', data); },
  deletePosition(id)        { return this.post('deletePosition', { id }); },

  addPrice(data)            { return this.post('addPrice', data); },
  addCryptoPrice(data)      { return this.post('addCryptoPrice', data); },

  createCharge(data)        { return this.post('createCharge', data); },
  updateCharge(data)        { return this.post('updateCharge', data); },
  deleteCharge(id)          { return this.post('deleteCharge', { id }); },

  // Sauvegarde silencieuse du profil FIRE (n'invalide pas le cache principal)
  saveFireProfile(data)     { return this.postSilent('saveFireProfile', data); },

  // ─── DÉPENSES ─────────────────────────────────────────────────────────────

  createExpenseCategory(data) { return this.post('createExpenseCategory', data); },
  updateExpenseCategory(data) { return this.post('updateExpenseCategory', data); },
  deleteExpenseCategory(id)   { return this.post('deleteExpenseCategory', { id }); },
  reorderCategories(data)     { return this.postSilent('reorderCategories', data); },

  createExpenseItem(data)     { return this.post('createExpenseItem', data); },
  updateExpenseItem(data)     { return this.post('updateExpenseItem', data); },
  deleteExpenseItem(id)       { return this.post('deleteExpenseItem', { id }); },

  upsertExpenseEntry(data)    { return this.post('upsertExpenseEntry', data); },
  deleteExpenseEntry(data)    { return this.post('deleteExpenseEntry', data); },

  createExpenseAid(data)      { return this.post('createExpenseAid', data); },
  updateExpenseAid(data)      { return this.post('updateExpenseAid', data); },
  deleteExpenseAid(id)        { return this.post('deleteExpenseAid', { id }); },
};
