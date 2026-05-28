const API = {
  get url()   { return localStorage.getItem('appscript_url'); },
  get token() { return localStorage.getItem('appscript_token'); },

  isConfigured() { return !!(this.url && this.token); },

  save(url, token) {
    localStorage.setItem('appscript_url',   url.trim());
    localStorage.setItem('appscript_token', token.trim());
  },

  async getData() {
    const res = await fetch(`${this.url}?token=${encodeURIComponent(this.token)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return json.data;
  },

  async post(action, payload = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      body: JSON.stringify({ action, token: this.token, ...payload }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return json.result;
  },

  // Raccourcis CRUD
  createPortfolio(data)     { return this.post('createPortfolio', data); },
  updatePortfolio(data)     { return this.post('updatePortfolio', data); },
  deletePortfolio(id)       { return this.post('deletePortfolio', { id }); },

  createSubPortfolio(data)  { return this.post('createSubPortfolio', data); },
  deleteSubPortfolio(id)    { return this.post('deleteSubPortfolio', { id }); },

  createEnvelope(data)      { return this.post('createEnvelope', data); },
  deleteEnvelope(id)        { return this.post('deleteEnvelope', { id }); },

  addPosition(data)         { return this.post('addPosition', data); },
  updatePosition(data)      { return this.post('updatePosition', data); },
  deletePosition(id)        { return this.post('deletePosition', { id }); },

  addPrice(data)            { return this.post('addPrice', data); },
  addCryptoPrice(data)      { return this.post('addCryptoPrice', data); },
};
