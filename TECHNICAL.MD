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
    ├── prices / crypto_prices
    ├── history
    ├── charges
    ├── fire_profile
    ├── vpw
    ├── expense_categories / expense_items / expense_entries / expense_aids
    ├── biens_immo / depenses_immo
    ├── residences
    └── ui_prefs
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

### `charges`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `portfolio_id` | string | Référence vers `portfolios.id` |
| `nom` | string | Libellé de la charge |
| `montant` | number | Montant annuel (en €) |
| `date_fin` | date | Date de fin *(optionnel)* |

### `fire_profile`

| Colonne | Type | Description |
|---|---|---|
| `key` | string | Clé du paramètre |
| `value` | mixed | Valeur (taux de retrait, patrimoine cible, dépenses annuelles, âge actuel, etc.) |

### `vpw`

Table de correspondance VPW (Variable Percentage Withdrawal) pré-calculée, chargée depuis la Sheet. Utilisée pour le simulateur VPW intégré.

### `expense_categories`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `nom` | string | Nom de la catégorie |
| `type` | string | Type (logement, transport, alimentation, etc.) |
| `color` | string | Couleur d'affichage (clé Tailwind, ex : `slate`, `blue`) |

### `expense_items`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `category_id` | string | Référence vers `expense_categories.id` |
| `nom` | string | Libellé du poste (ex : "Loyer", "Courses") |

### `expense_entries`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `item_id` | string | Référence vers `expense_items.id` |
| `year` | number | Année |
| `month` | number | Mois (1–12) |
| `montant` | number | Montant saisi (en €) |
| `note` | string | Note libre *(optionnel)* |

### `expense_aids`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `nom` | string | Libellé de l'aide (ex : "APL", "Prime activité") |
| `montant` | number | Montant mensuel (en €) |

### `biens_immo`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `nom` | string | Nom du bien |
| `prix_achat` | number | Prix d'achat (en €) |
| `credit_montant` | number | Capital emprunté (en €) |
| `credit_taux` | number | Taux annuel (%) |
| `credit_duree` | number | Durée du crédit (mois) |
| `credit_debut` | date | Date de début du crédit |
| `loyer_hc` | number | Loyer hors charges mensuel (en €) |
| `charges_mensuelles` | number | Charges mensuelles estimées (en €) |
| `taxe_fonciere` | number | Taxe foncière annuelle (en €) |

### `depenses_immo`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `bien_id` | string | Référence vers `biens_immo.id` |
| `type` | string | `loyer` \| `charge` \| `travaux` \| `tva` |
| `montant` | number | Montant (en €) |
| `date` | date | Date de la dépense |
| `note` | string | Note libre *(optionnel)* |
| `frequence` | string | `mensuel` \| `trimestriel` \| `annuel` *(pour les loyers)* |
| `tva_taux` | number | Taux TVA appliqué *(si applicable)* |

### `residences`

| Colonne | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `nom` | string | Nom de la résidence |
| `type` | string | `principale` \| `secondaire` \| `familiale` |
| `valeur_achat` | number | Prix d'achat (en €) |
| `valeur_estimee` | number | Valeur actuelle estimée (en €) |
| `quote_part` | number | Quote-part détenue (%) — pour les biens en indivision |
| `credit_montant` | number | Capital emprunté (en €) |
| `credit_taux` | number | Taux annuel (%) |
| `credit_duree` | number | Durée du crédit (mois) |
| `credit_debut` | date | Date de début du crédit |

### `ui_prefs`

| Colonne | Type | Description |
|---|---|---|
| `key` | string | Clé de préférence (ex : `dashboard_order`) |
| `value` | string | Valeur sérialisée en JSON |

Permet la persistance des préférences UI cross-device via Google Sheets.

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
→ retourne l'intégralité du STATE : portfolios, envelopes, positions, prices, history,
  charges, fire_profile, vpw, expense_*, biens_immo, depenses_immo, residences, ui_prefs
```

**Écriture (POST) — exemples**
```json
{ "action": "addPosition", "envelope_id": "e_001", "isin": "LU0274208692", "quantite": 10, "prix_achat": 412.50 }
{ "action": "deletePosition", "id": "pos_003" }
{ "action": "createEnvelope", "nom": "PEA", "type": "bourse", "portfolio_id": "p_001" }
{ "action": "createPortfolio", "nom": "Patrimoine perso" }
{ "action": "saveUiPref", "key": "dashboard_order", "value": "[...]" }
```

### Déclencheurs automatiques (triggers)

| Déclencheur | Fréquence | Action |
|---|---|---|
| Mise à jour des prix ETF | Toutes les heures | Met à jour `prices.prix_actuel` pour chaque ISIN |
| Mise à jour des prix crypto | Toutes les heures | Met à jour `crypto_prices.prix_actuel` via CoinMarketCap (top 500) |
| Snapshot historique | Chaque jour (ex : 18h) | Calcule et écrit une ligne dans `history` par enveloppe |

Le snapshot journalier fonctionne **même si l'utilisateur n'ouvre pas l'app**.

---

## Sécurité

### Principe

Aucun secret n'est stocké dans le code source (repo GitHub public). L'accès est protégé par un **token secret** côté AppScript, et par le fait que l'URL AppScript elle-même n'est jamais commitée.

### Token secret (Script Properties)

| Clé | Rôle | Fonction pour la définir |
|---|---|---|
| `SECRET_TOKEN` | Authentification des requêtes de l'app HTML | `setSecretToken()` |
| `CMC_API_KEY` | Clé API CoinMarketCap pour les prix crypto | `setCMCApiKey()` |

Chaque requête depuis l'app doit inclure ce token :
- **GET** : paramètre URL `?token=xxx`
- **POST** : champ `token` dans le body JSON

### Premier lancement

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

## Cache local

Un mécanisme de **cache localStorage** évite les appels réseau répétés :

- Le `STATE` complet est sérialisé et stocké dans `localStorage` après chaque chargement réussi
- Un TTL configurable (par défaut quelques heures) détermine quand le cache est considéré périmé
- Un **modal Paramètres Cache** permet de :
  - Forcer un rechargement depuis Google Sheets
  - Ajuster le TTL
  - **Exporter** le cache en JSON (sauvegarde locale)
  - **Importer** un JSON pour restaurer un état

---

## Architecture du code (`js/app.js`)

L'application est un fichier unique organisé en sections commentées.

### STATE global

```js
let STATE = {
  portfolios, sub_portfolios, envelopes, positions,
  prices, crypto_prices,
  charges, history,
  fire_profile, vpw,
  expense_categories, expense_items, expense_entries, expense_aids,
  biens_immo, depenses_immo,
  residences,
  ui_prefs
};
```

Toutes les données sont chargées en une seule requête `getData` et stockées dans ce STATE. Les fonctions de rendu et de calcul lisent directement depuis ce STATE.

### Router

Navigation basée sur `location.hash`. La fonction `navigate(hash)` change le hash, un listener `hashchange` appelle `render()` qui dispatche vers la bonne vue.

```
#dashboard        → renderDashboard()
#investissements  → renderInvestissements()
#immo             → renderImmo()
#immo/:id         → renderImmoDetail()
#residences       → renderResidences()
#residences/:id   → renderResidenceDetail()
#fire             → renderFire()
#expenses         → renderExpenses()
#hist-global      → renderHistGlobal()
#hist-pf/:id      → renderHistPortfolio()
#hist-env/:id     → renderHistEnvelope()
```

### Préférences UI cross-device

Le système `ui_prefs` permet de persister des préférences côté Google Sheets et de les synchroniser entre appareils :

- **Priorité 1** : `localStorage` (rendu instantané, pas d'attente réseau)
- **Priorité 2** : `STATE.ui_prefs` (chargé depuis Google Sheets au démarrage)

À chaque changement, `persistUiPref(key, value)` écrit en localStorage **et** envoie un POST `saveUiPref` vers AppScript en arrière-plan.

---

## Modules fonctionnels

### Patrimoine financier

- Vue par **portfolio** → **sous-portfolio** → **enveloppe** → **positions**
- Calcul de la **plus-value** (€ et %) par enveloppe et globalement
- **Allocation** bourse / crypto / épargne avec barre visuelle et cible configurable
- **Suggestions de rééquilibrage** basées sur les cibles de chaque portfolio
- **Taux de rendement annualisé** (TWRR simplifié) calculé sur l'historique
- Tri des positions par colonne (ISIN, quantité, valeur, PV%)
- **Charges** par portfolio (frais récurrents, date de fin)
- Page **Investissements** avec analyse de composition :
  - Catégorisation heuristique des ETF (Monde, USA, Europe, Obligations, Immobilier, Pays émergents, etc.)
  - Vue consolidée cross-portfolios
  - Graphique barres horizontales par catégorie

### Historique & graphiques

- Snapshot journalier par enveloppe → consolidation globale en temps réel
- Déduplication et normalisation des entrées d'historique
- **Graphique SVG** custom (pas de librairie externe) :
  - Axes Y adaptatifs avec `niceNumber()` et `fmtAxisSmart()`
  - Grille, tooltips au survol, filtre par période (1M, 3M, 6M, 1A, Max)
  - Sparkline miniature pour le dashboard
- Pages historique dédiées : global, par portfolio, par enveloppe

### Simulation FIRE

- Paramètres configurables : patrimoine actuel, dépenses annuelles, taux de retrait, âge actuel, âge cible
- Calcul de la **date d'indépendance financière** estimée
- **Simulateur VPW** (Variable Percentage Withdrawal) :
  - Table de taux VPW chargée depuis la Sheet
  - Calcul du revenu mensuel VPW selon l'âge et le patrimoine
  - Simulation asynchrone des retraits dans le temps
- Import de la moyenne des dépenses réelles → paramètres FIRE (depuis le module Dépenses)
- Cards dashboard avec résumé des métriques clés

### Dépenses

- Structure **Catégories → Postes → Entrées mensuelles**
- Tableau mensuel sur l'année en cours, navigable par année
- **Calcul des moyennes** par type (uniquement sur les mois avec au moins une entrée)
- **Aides mensuelles** (APL, primes, etc.) déduites du total
- Modal de saisie par cellule avec modes "montant fixe" / "note" / "estimation"
- Prévisualisation en temps réel lors de la saisie
- Codes couleur personnalisables par catégorie (palette Tailwind)
- **Rapport PDF** avec synthèse annuelle, détail par type, évolution mensuelle

### Immobilier locatif

- CRUD complet sur les **biens immobiliers**
- Calculs financiers :
  - Mensualité crédit (formule d'amortissement standard)
  - Capital restant dû à une date donnée
  - Capital remboursé
  - **Rentabilité brute théorique** (loyers / prix achat)
  - **Rentabilité nette réelle** sur l'année en cours (loyers encaissés − dépenses − taxe foncière)
- Suivi des **dépenses par bien** : loyers, charges, travaux, TVA
  - Fréquences de loyer : mensuel, trimestriel, annuel
  - Champs TVA (collectée / versée) pour les régimes soumis à TVA
- **Module TVA global** : récapitulatif TVA collectée vs versée, suivi des versements
- Vue consolidée globale : rendement agrégé, charges à venir, capital crédit total
- **Rapport PDF** détaillé : rentabilité théorique + réelle, crédit, charges

### Résidences

- CRUD sur les **résidences** (principale, secondaire, familiale)
- Gestion de la **quote-part** (indivision) : valeur totale vs valeur de la part
- Calculs financiers : mensualité, capital restant dû, patrimoine net (valeur part − dette)
- **Plus-value latente** par résidence
- Vue liste + vue détail avec 3 blocs :
  - Bloc 1 : métriques patrimoniales (valeur, achat, PV)
  - Bloc 2 : crédit (mensualité, capital restant, remboursé)
  - Bloc 3 : caractéristiques (type, quote-part)
- Modal de **mise à jour de la valeur estimée**
- **Rapport PDF** avec synthèse patrimoniale et détail par résidence

### Dashboard

- **Blocs reordonnables** via un modal drag-and-drop (ordre persisté dans `ui_prefs`)
- Blocs disponibles : Patrimoine financier, Immobilier locatif, Résidences, Patrimoine global, Projection fin d'année, Simulations, Jalons, FIRE, Dépenses
- Titres des blocs **cliquables** → navigation directe vers la page correspondante, avec couleur au survol cohérente avec les onglets de navigation (bleu pour financier/immo, violet pour résidences, orange pour FIRE, emerald pour dépenses)
- **Patrimoine global consolidé** : synthèse financier + immo locatif + résidences
- **Projection fin d'année** : extrapolation sur la base des mois écoulés
- **Jalons patrimoniaux** : objectifs avec jauge de progression
- **Simulations** de scénarios (configurables)

### Rapports PDF

Générés côté navigateur via `window.open()` avec du HTML/CSS inline :
- Rapport **Portfolio** (positions, PV, allocation, historique graphique)
- Rapport **Immobilier locatif** (rentabilité théorique + réelle, crédit, charges)
- Rapport **Résidences** (patrimoine, crédit, caractéristiques)
- Rapport **Dépenses** (synthèse annuelle, détail par type, aides, évolution)

Style commun : en-tête avec titre/date, pied de page, palette de couleurs cohérente, mise en page optimisée pour l'impression.

---

## Voir aussi

- [Structure globale du projet](./GENERAL.MD)
- [Enveloppe Bourse](./bourse/INSTRUCTIONS.MD)
