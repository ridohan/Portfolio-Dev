// prices.js
// Fetch des prix ETF (EODHD ou JustETF fallback) et crypto (CoinGecko) côté front.
// Snapshot journalier de l'historique des enveloppes.

const PRICES_TS_KEY    = 'portfolio_prices_ts';
const SNAPSHOT_TS_KEY  = 'portfolio_snapshot_ts';
const CG_IDS_KEY       = 'portfolio_cg_ids'; // symbol → coingecko_id

// ─── PRICE SERVICE ────────────────────────────────────────────────────────────

const PriceService = {

  lastRefreshTs() {
    const v = localStorage.getItem(PRICES_TS_KEY);
    return v ? Number(v) : null;
  },

  ageSeconds() {
    const ts = this.lastRefreshTs();
    return ts ? Math.floor((Date.now() - ts) / 1000) : Infinity;
  },

  shouldRefresh() {
    const ts = this.lastRefreshTs();
    if (!ts) return true;
    return (Date.now() - ts) > API.cacheTTL;
  },

  // ─── ETF — EODHD (un seul appel batch, ISINs directs) ───────────────────────

  _getEODHDKey() {
    return (STATE.ui_prefs?.eodhd_api_key || '').trim();
  },

  // Un seul appel pour tous les ISINs — EODHD accepte les ISINs directement.
  // Premier ISIN dans le path, les suivants dans &s=
  async fetchETFPricesBatchEODHD(isins) {
    const apiKey = this._getEODHDKey();
    if (!apiKey || !isins.length) return {};

    const [first, ...rest] = isins;
    const url = `https://eodhd.com/api/real-time/${first}?api_token=${apiKey}&fmt=json`
      + (rest.length ? `&s=${rest.join(',')}` : '');

    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();

    // Réponse : objet si un seul ISIN, tableau sinon
    const rows = Array.isArray(data) ? data : [data];
    const result = {};
    rows.forEach(row => {
      const prix = row.close ?? row.last ?? null;
      if (prix != null && row.code) result[row.code] = Number(prix);
    });
    return result;
  },

  // ─── ETF — JustETF (fallback, un appel par ISIN) ────────────────────────────

  async fetchETFPrice(isin) {
    const url = `https://www.justetf.com/api/etfs/${isin}/quote?locale=fr&currency=EUR`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.latestQuote?.raw ?? null;
  },

  // ─── CRYPTO — CoinGecko ─────────────────────────────────────────────────────

  async _resolveCoinGeckoIds(symbols) {
    let mapping = {};
    try { mapping = JSON.parse(localStorage.getItem(CG_IDS_KEY) || '{}'); } catch {}

    const missing = symbols.filter(s => !mapping[s.toUpperCase()]);
    if (missing.length === 0) return mapping;

    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=eur&order=market_cap_desc&per_page=500&page=1&sparkline=false'
      );
      if (!res.ok) return mapping;
      const coins = await res.json();
      coins.forEach(c => {
        const sym = (c.symbol || '').toUpperCase();
        if (!mapping[sym]) mapping[sym] = c.id;
      });
      localStorage.setItem(CG_IDS_KEY, JSON.stringify(mapping));
    } catch {}

    return mapping;
  },

  async fetchCryptoPrices(symbols) {
    if (!symbols.length) return {};
    const mapping = await this._resolveCoinGeckoIds(symbols);
    const ids = [...new Set(symbols.map(s => mapping[s.toUpperCase()]).filter(Boolean))];
    if (!ids.length) return {};

    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=eur`
    );
    if (!res.ok) return {};
    const data = await res.json();

    const result = {};
    symbols.forEach(s => {
      const id = mapping[s.toUpperCase()];
      if (id && data[id]?.eur != null) result[s.toUpperCase()] = data[id].eur;
    });
    return result;
  },

  // ─── REFRESH PRINCIPAL ──────────────────────────────────────────────────────

  async refresh() {
    const now = new Date().toISOString();
    let etfOk = 0, cryptoOk = 0, errors = 0;

    // ISINs uniques dans les enveloppes bourse (hors LIQUIDITES)
    const bourseIds = STATE.envelopes.filter(e => e.type === 'bourse').map(e => e.id);
    const isins = [...new Set(
      STATE.positions
        .filter(p => bourseIds.includes(p.envelope_id) && p.identifiant && p.identifiant !== 'LIQUIDITES')
        .map(p => p.identifiant)
    )];

    // Symboles uniques dans les enveloppes crypto
    const cryptoIds = STATE.envelopes.filter(e => e.type === 'crypto').map(e => e.id);
    const symbols = [...new Set(
      STATE.positions
        .filter(p => cryptoIds.includes(p.envelope_id) && p.identifiant)
        .map(p => p.identifiant)
    )];

    // ── Fetch ETF ────────────────────────────────────────────────────────────
    if (isins.length) {
      const hasEODHD = !!this._getEODHDKey();

      if (hasEODHD) {
        // EODHD : un seul appel batch, ISINs directs, résultat indexé par ISIN
        try {
          const prices = await this.fetchETFPricesBatchEODHD(isins);
          isins.forEach(isin => {
            const prix = prices[isin] ?? prices[isin.toUpperCase()] ?? null;
            if (prix == null) { errors++; return; }
            const existing = STATE.prices.find(p => p.isin === isin);
            if (existing) { existing.prix_actuel = prix; existing.derniere_maj = now; }
            else STATE.prices.push({ isin, nom: isin, type: 'ETF', prix_actuel: prix, derniere_maj: now });
            etfOk++;
          });
        } catch { errors += isins.length; }
      } else {
        // JustETF : appels parallèles (pas de rate limiting strict pour une dizaine d'ISINs)
        const results = await Promise.allSettled(isins.map(isin => this.fetchETFPrice(isin)));
        results.forEach((res, i) => {
          const isin = isins[i];
          if (res.status === 'fulfilled' && res.value !== null) {
            const prix = res.value;
            const existing = STATE.prices.find(p => p.isin === isin);
            if (existing) { existing.prix_actuel = prix; existing.derniere_maj = now; }
            else STATE.prices.push({ isin, nom: isin, type: 'ETF', prix_actuel: prix, derniere_maj: now });
            etfOk++;
          } else { errors++; }
        });
      }
    }

    // ── Fetch crypto ─────────────────────────────────────────────────────────
    if (symbols.length) {
      try {
        const prices = await this.fetchCryptoPrices(symbols);
        symbols.forEach(sym => {
          const prix = prices[sym.toUpperCase()];
          if (prix == null) return;
          const existing = STATE.crypto_prices.find(p => (p.symbole || '').toUpperCase() === sym.toUpperCase());
          if (existing) { existing.prix_actuel = prix; existing.derniere_maj = now; }
          else STATE.crypto_prices.push({ symbole: sym, nom: sym, prix_actuel: prix, derniere_maj: now });
          cryptoOk++;
        });
      } catch { errors++; }
    }

    localStorage.setItem(PRICES_TS_KEY, String(Date.now()));
    return { etfOk, cryptoOk, errors };
  },
};

// ─── SNAPSHOT SERVICE ─────────────────────────────────────────────────────────

const SnapshotService = {

  lastSnapshotTs() {
    const v = localStorage.getItem(SNAPSHOT_TS_KEY);
    return v ? Number(v) : null;
  },

  ageSeconds() {
    const ts = this.lastSnapshotTs();
    return ts ? Math.floor((Date.now() - ts) / 1000) : Infinity;
  },

  shouldSnapshot() {
    const ts = this.lastSnapshotTs();
    if (!ts) return true;
    return (Date.now() - ts) > 20 * 60 * 60 * 1000;
  },

  take() {
    const today = new Date().toISOString().slice(0, 10);

    const priceIndex = {};
    STATE.prices.forEach(p => { priceIndex[p.isin] = Number(p.prix_actuel) || 0; });
    STATE.crypto_prices.forEach(p => {
      priceIndex[(p.symbole || '').toUpperCase()] = Number(p.prix_actuel) || 0;
    });

    const existingIdx = {};
    STATE.history.forEach((h, i) => {
      const d = String(h.date).slice(0, 10);
      existingIdx[`${d}|${h.envelope_id}`] = i;
    });

    STATE.envelopes.forEach(envelope => {
      const positions = STATE.positions.filter(p => p.envelope_id === envelope.id);
      if (!positions.length) return;

      const isEpargne = envelope.type === 'épargne';
      let valeurInvestie = 0, valeurActuelle = 0;

      positions.forEach(pos => {
        const qte     = Number(pos.quantite)   || 0;
        const pxAchat = Number(pos.prix_achat) || 0;

        if (pos.identifiant === 'LIQUIDITES') {
          valeurInvestie += qte;
          valeurActuelle += qte;
          return;
        }

        const lookupKey = envelope.type === 'crypto'
          ? (pos.identifiant || '').toUpperCase()
          : pos.identifiant;
        const pxActuel = isEpargne ? pxAchat : (priceIndex[lookupKey] || 0);

        valeurInvestie += isEpargne ? pxAchat : pxAchat * qte;
        valeurActuelle += isEpargne ? pxAchat : pxActuel * qte;
      });

      const pvEuros = valeurActuelle - valeurInvestie;
      const pvPct   = valeurInvestie > 0
        ? Number(((valeurActuelle / valeurInvestie - 1) * 100).toFixed(2))
        : 0;

      const key   = `${today}|${envelope.id}`;
      const entry = { date: today, envelope_id: envelope.id, valeur_investie: valeurInvestie, valeur_actuelle: valeurActuelle, pv_euros: pvEuros, pv_pct: pvPct };

      if (existingIdx[key] !== undefined) {
        STATE.history[existingIdx[key]] = entry;
      } else {
        STATE.history.push(entry);
        existingIdx[key] = STATE.history.length - 1;
      }
    });

    localStorage.setItem(SNAPSHOT_TS_KEY, String(Date.now()));
  },
};
