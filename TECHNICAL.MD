# Architecture Technique

## Contraintes

- Application **100% statique** — HTML, CSS, JavaScript vanilla
- Hébergée sur **GitHub Pages** (ou équivalent)
- **Aucun backend, aucune base de données serveur**
- Google Sheets est la **seule source de vérité** pour toutes les données

---

## Vue d'ensemble

```
App HTML (GitHub Pages)
    │
    │  fetch() — requêtes HTTP
    ▼
AppScript Web App  ←──── déclencheur horaire (prix + historique)
    │
    │  lecture / écriture
    ▼
Google Sheet (BDD)
    ├── portfolios
    ├── sub_portfolios
    ├── envelopes
    ├── positions
    ├── prices
    └── history
```

L'app HTML ne connaît que l'URL de l'AppScript Web App. Tout le reste se passe côté Google.

---

## Google Sheet — Structure des onglets

### `portfolios`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique (ex : `p_001`) |
| `nom` | string | Nom du portfolio |
| `cible_actions` | number | % cible poche actions (0-100) |
| `cible_obligations` | number | % cible poche obligations (0-100) |
| `cible_cash` | number | % cible poche cash (0-100) |

> La somme `cible_actions + cible_obligations + cible_cash` doit toujours être égale à 100.

### `sub_portfolios`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `nom` | string | Nom du sous-portfolio |
| `portfolio_id` | string | Référence vers `portfolios.id` |

### `envelopes`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `nom` | string | Nom de l'enveloppe (ex : "PEA Boursorama") |
| `type` | string | `bourse` \| `crypto` \| `épargne` |
| `portfolio_id` | string | Référence vers `portfolios.id` |
| `sub_portfolio_id` | string | Référence vers `sub_portfolios.id` *(vide si rattaché directement au portfolio)* |

### `positions`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `envelope_id` | string | Référence vers `envelopes.id` |
| `isin` | string | Code ISIN de l'ETF |
| `quantite` | number | Nombre de parts détenues |
| `prix_achat` | number | Prix unitaire à l'achat (en €) |
| `date_achat` | date | Date d'achat *(optionnel)* |

### `prices`

| Colonne | Type | Description |
|---|---|---|
| `isin` | string | Code ISIN |
| `nom` | string | Nom complet de l'ETF |
| `type` | string | `action` \| `bond` |
| `prix_actuel` | number | Cours actuel (en €) |
| `derniere_maj` | datetime | Horodatage de la dernière mise à jour |

### `crypto_prices`

| Colonne | Type | Description |
|---|---|---|
| `symbole` | string | Symbole du coin (ex : `BTC`, `ETH`) |
| `nom` | string | Nom complet (ex : `Bitcoin`) |
| `prix_actuel` | number | Prix actuel (en €) |
| `derniere_maj` | datetime | Horodatage de la dernière mise à jour |

### `history`

| Colonne | Type | Description |
|---|---|---|
| `date` | date | Date du snapshot (un par jour) |
| `envelope_id` | string | Référence vers `envelopes.id` |
| `valeur_investie` | number | Somme des prix d'achat × quantités |
| `valeur_actuelle` | number | Somme des prix actuels × quantités |
| `pv_euros` | number | Valeur actuelle − valeur investie |
| `pv_pct` | number | Plus-value en % |

---

## AppScript Web App

### Déploiement

L'AppScript est déployé comme **Web App** depuis l'éditeur Google Apps Script :
- **Exécuter en tant que** : Moi *(accès à la sheet)*
- **Accès** : Tout le monde

Google fournit une URL fixe :
```
https://script.google.com/macros/s/{SCRIPT_ID}/exec
```

Cette URL est le seul point de configuration à renseigner dans l'app HTML.

### Endpoints

Toutes les requêtes passent par cette URL unique. L'action est passée en paramètre :

**Lecture (GET)**
```
GET ?action=getData
→ retourne portfolios, sub_portfolios, envelopes, positions, prices
```

**Écriture (POST)**
```json
{ "action": "addPosition", "envelope_id": "e_001", "isin": "LU0274208692", "quantite": 10, "prix_achat": 412.50 }
{ "action": "deletePosition", "id": "pos_003" }
{ "action": "createEnvelope", "nom": "PEA", "type": "bourse", "portfolio_id": "p_001" }
{ "action": "createPortfolio", "nom": "Patrimoine perso" }
```

### Déclencheurs automatiques (triggers)

Deux déclencheurs tournent côté AppScript sans intervention de l'utilisateur :

| Déclencheur | Fréquence | Action |
|---|---|---|
| Mise à jour des prix ETF | Toutes les heures | Met à jour `prices.prix_actuel` pour chaque ISIN |
| Mise à jour des prix crypto | Toutes les heures | Met à jour `crypto_prices.prix_actuel` via CoinMarketCap (top 500, recherche par symbole) |
| Snapshot historique | Chaque jour (ex : 18h) | Calcule et écrit une ligne dans `history` par enveloppe |

Le snapshot journalier fonctionne **même si l'utilisateur n'ouvre pas l'app**.

---

## Sécurité

### Principe

Aucun secret n'est stocké dans le code source (repo GitHub public). L'accès est protégé par un **token secret** côté AppScript, et par le fait que l'URL AppScript elle-même n'est jamais commitée.

### Token secret (Script Properties)

Deux secrets sont stockés dans les **Script Properties** de l'AppScript :

| Clé | Rôle | Fonction pour la définir |
|---|---|---|
| `SECRET_TOKEN` | Authentification des requêtes de l'app HTML | `setSecretToken()` |
| `CMC_API_KEY` | Clé API CoinMarketCap pour les prix crypto | `setCMCApiKey()` |

Chaque requête depuis l'app doit inclure ce token :
- **GET** : paramètre URL `?token=xxx`
- **POST** : champ `token` dans le body JSON

AppScript refuse toute requête avec un token absent ou incorrect.

### Premier lancement de l'app

L'app affiche un **écran de configuration** à la première ouverture. L'utilisateur saisit :
1. L'URL de son AppScript Web App
2. Son token secret

Ces deux valeurs sont stockées dans le `localStorage` du navigateur. Elles ne sont jamais dans le code source.

```
Repo GitHub  →  code source public, zéro secret
localStorage →  URL AppScript + token (local, jamais envoyé nulle part)
AppScript    →  token de référence dans Script Properties (côté Google)
```

---

## Voir aussi

- [Structure globale du projet](./GENERAL.MD)
- [Enveloppe Bourse](./bourse/INSTRUCTIONS.MD)
