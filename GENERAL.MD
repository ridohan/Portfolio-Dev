# Portfolio Manager — Instructions générales

## Vue d'ensemble

Le projet est un **gestionnaire de patrimoine personnel** permettant de suivre l'ensemble de ses actifs :
- **Patrimoine financier** : investissements organisés en portfolios, enveloppes et positions
- **Immobilier locatif** : biens en location avec suivi de rentabilité
- **Résidences** : résidence principale, secondaire ou bien familial en indivision
- **Dépenses** : suivi mensuel par catégorie et poste
- **Simulation FIRE** : projection vers l'indépendance financière

---

## Structure de navigation

```
Dashboard (vue synthèse)
├── Patrimoine financier
│   ├── Portfolio → Sous-portfolio → Enveloppe → Positions
│   ├── Investissements (analyse de composition cross-portfolios)
│   └── Historique (global, par portfolio, par enveloppe)
├── Immobilier locatif
│   ├── Vue globale consolidée
│   ├── Fiche bien (rentabilité, crédit, dépenses)
│   └── TVA globale
├── Résidences
│   └── Fiche résidence (patrimoine, crédit, caractéristiques)
├── Simulation FIRE
└── Dépenses (tableau mensuel par catégorie)
```

---

## Module : Patrimoine financier

### Hiérarchie

```
Portfolio
└── Sous-portfolio (optionnel)
    └── Enveloppe
        └── Positions / Actifs
```

**Portfolio** — niveau racine. Regroupe les investissements d'un profil ou objectif donné (ex : "Patrimoine perso", "Retraite"). Possède une allocation cible 3-fund.

**Sous-portfolio** — regroupement facultatif au sein d'un portfolio (ex : "Long terme", "Épargne de précaution").

**Enveloppe** — compte ou support réel (ex : PEA, CTO, Livret A, Binance). Un seul type parmi :
- `bourse` — actions, ETF, obligations cotées
- `crypto` — cryptomonnaies
- `épargne` — livrets, fonds euros, dépôts à terme

**Position** — ligne détenue dans une enveloppe. Identifiée par son ISIN (ETF/actions) ou symbole (crypto).

### Agrégation des données

| Niveau | Ce qui est visible |
|---|---|
| Enveloppe | Valeur totale, performance, détail des positions |
| Sous-portfolio | Somme des enveloppes, répartition par type |
| Portfolio | Vision consolidée, allocation réelle vs cible |
| Global | Tous portfolios + immo + résidences |

### 3-fund portfolio

Vision transversale en trois poches :

| Poche | Source |
|---|---|
| **Actions** | Positions `action` (bourse) + tout le crypto |
| **Obligations** | Positions `obligation` (bourse) |
| **Cash** | Tout l'épargne |

Chaque portfolio a une **allocation cible** (cible_actions + cible_obligations + cible_cash = 100%). L'app affiche l'écart réel vs cible et propose des **suggestions de rééquilibrage**.

**Logique de rééquilibrage :**
```
Écart poche X = (V × cible_X / 100) − montant actuel X
  → positif : sous-pondéré → acheter
  → négatif : sur-pondéré  → vendre
```

Deux scénarios : rééquilibrage pur (sans apport) ou avec un montant à investir.

### Analyse des investissements

Page dédiée avec catégorisation heuristique des positions :
- Catégories : Monde, USA, Europe, Pays émergents, Obligations, Immobilier (SCPI/REIT), Crypto, Épargne, etc.
- Vue consolidée cross-portfolios avec graphique barres horizontales

---

## Module : Immobilier locatif

Suivi des biens immobiliers mis en location.

### Ce qu'on suit par bien

- **Crédit** : mensualité, capital restant dû, capital remboursé
- **Rentabilité brute théorique** : loyers annuels / prix d'achat
- **Rentabilité nette réelle** : loyers encaissés YTD − dépenses − taxe foncière
- **Dépenses** : loyers perçus, charges, travaux, TVA — avec fréquences (mensuel, trimestriel, annuel)

### TVA globale

Module dédié au suivi de la TVA pour les régimes soumis (ex : LMNP TVA) :
- TVA collectée sur les loyers
- TVA versée sur les dépenses
- Historique des versements à la DGFiP

### Vue consolidée

Synthèse patrimoniale sur l'ensemble des biens : valeur brute totale, dette totale, patrimoine net, rendement agrégé.

---

## Module : Résidences

Suivi des résidences non locatives (résidence principale, secondaire, bien familial).

### Spécificités

- **Quote-part** : gestion de l'indivision (ex : 50% d'un bien familial)
- **Valeur estimée** mise à jour manuellement
- **Patrimoine net** = valeur de la part − capital restant dû
- **Plus-value latente** = valeur estimée part − prix d'achat part

### Types supportés

`principale` | `secondaire` | `familiale`

---

## Module : Dépenses

Suivi mensuel des dépenses personnelles.

### Structure

```
Catégorie (ex : Logement, Transport)
└── Poste (ex : Loyer, Assurance voiture)
    └── Entrée mensuelle (montant + note optionnelle)
```

### Fonctionnalités clés

- Tableau mensuel sur l'année, navigable par année
- **Moyennes** calculées sur les mois avec au moins une entrée (pas de dilution par les mois vides)
- **Aides mensuelles** (APL, primes) déduites du total net
- Import de la moyenne des dépenses → paramètres FIRE
- Codes couleur personnalisables par catégorie

---

## Module : Simulation FIRE

FIRE = *Financial Independence, Retire Early*

### Paramètres

- Patrimoine financier actuel
- Dépenses annuelles (ou importées depuis le module Dépenses)
- Taux de retrait sécurisé (ex : 4%)
- Âge actuel / âge cible

### Simulateur VPW

*Variable Percentage Withdrawal* — stratégie de retrait adaptative :
- Table de taux par âge chargée depuis Google Sheets
- Calcul du revenu mensuel VPW selon le patrimoine et l'âge
- Simulation des retraits dans le temps

---

## Dashboard

Vue synthèse configurable composée de **blocs reordonnables** :

| Bloc | Contenu |
|---|---|
| Patrimoine financier | Total investi, PV, allocation, sparkline |
| Immobilier locatif | Patrimoine net, rendement |
| Résidences | Patrimoine net, plus-value latente |
| Patrimoine global | Consolidation financier + immo + résidences |
| Projection fin d'année | Extrapolation sur la base des mois écoulés |
| Simulations | Scénarios configurables |
| Jalons | Objectifs patrimoniaux avec jauge |
| FIRE | Résumé des métriques clés |
| Dépenses | Moyenne mensuelle, total YTD |

L'ordre des blocs est **persisté cross-device** via Google Sheets (`ui_prefs`).

---

## Rapports PDF

Générés côté navigateur à la demande depuis le menu Paramètres :

| Rapport | Contenu |
|---|---|
| Portfolio | Positions, PV, allocation, historique graphique |
| Immobilier locatif | Rentabilité théorique + réelle, crédit, charges |
| Résidences | Patrimoine, crédit, caractéristiques |
| Dépenses | Synthèse annuelle, détail par type, aides, évolution |

---

## Principes généraux

- Structure **flexible** : un portfolio peut ne pas avoir de sous-portfolios
- Les noms à tous les niveaux sont **libres**
- **Zéro dépendance externe** : pas de librairie JS, graphiques en SVG natif
- Toutes les données vivent dans **Google Sheets**, l'app ne stocke rien côté serveur
- Les préférences UI sont **synchronisées entre appareils** via la Sheet

---

## Voir aussi

- [Architecture technique](./TECHNICAL.MD)
- [Enveloppe Bourse](./bourse/INSTRUCTIONS.MD)
- [Enveloppe Épargne](./epargne/INSTRUCTIONS.MD)
- [Enveloppe Crypto](./crypto/INSTRUCTIONS.MD)
- [Immobilier locatif](./immobilier-locatif/INSTRUCTIONS.MD)
- [Résidences](./residences/INSTRUCTIONS.MD)
