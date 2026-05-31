# Immobilier Locatif — Base de connaissances pour implémentation

## Contexte projet

Module à intégrer dans le Portfolio Manager existant (HTML/CSS/JS vanilla + Tailwind CDN dark slate + Google Sheets via AppScript Web App). Ce module gère des biens immobiliers locatifs avec suivi de rentabilité théorique et réelle.

---

## 1. Modèle de données (Google Sheets)

### Nouvel onglet : `biens_immo`

| Colonne | Type | Description |
|---|---|---|
| `id` | string (uuid) | Identifiant unique |
| `nom` | string | Nom du bien |
| `surface_m2` | number | Surface en m² |
| `prix_achat` | number | Prix d'achat total (€) |
| `loyer_annuel_ht` | number | Loyer annuel HT théorique (€) |
| `taxe_fonciere` | number | Taxe foncière annuelle (€) |
| `charges_annuelles` | number | Charges annuelles prévisionnelles (€) |
| `montant_credit` | number | Montant emprunté (€) |
| `duree_credit_mois` | number | Durée du crédit (en mois) |
| `taux_credit` | number | Taux annuel du crédit (ex: 0.035 pour 3,5%) |
| `mensualite_assurance` | number | Mensualité d'assurance crédit (€) |
| `numero_pret` | string | Numéro de prêt |
| `date_debut_credit` | date (YYYY-MM-DD) | Date de la 1ère échéance |

### Nouvel onglet : `depenses_immo`

| Colonne | Type | Description |
|---|---|---|
| `id` | string (uuid) | Identifiant unique |
| `bien_id` | string | Référence vers `biens_immo.id` |
| `type` | string | `echeance_pret` / `charge` / `assurance` / `loyer` |
| `date` | date (YYYY-MM-DD) | Date de la dépense / du paiement |
| `montant_ttc` | number | Montant TTC encaissé ou décaissé (€) |
| `tva_rate` | number | Taux TVA applicable (ex: 0.10 pour 10%) — `null` si non applicable |
| `montant_ht` | number | Montant HT calculé (€) — rempli auto si TTC + TVA |
| `periode_debut` | date (YYYY-MM-DD) | Début de la période couverte — uniquement pour `loyer` |
| `periode_fin` | date (YYYY-MM-DD) | Fin de la période couverte — uniquement pour `loyer` |
| `note` | string | Commentaire libre |

---

## 2. Logique métier

### 2.1 Calcul de la mensualité de crédit

Formule d'annuité constante :

```
t_m = taux_credit / 12
n   = duree_credit_mois

mensualite_credit = (montant_credit × t_m) / (1 − (1 + t_m)^(−n))
```

### 2.2 Calcul du capital remboursé (à une date donnée)

À partir de la `date_debut_credit`, calculer le nombre de mensualités écoulées `k` jusqu'à aujourd'hui :

```
k = min(mois_ecoules_depuis_date_debut_credit, duree_credit_mois)

capital_restant_du = montant_credit × ((1 + t_m)^n − (1 + t_m)^k) / ((1 + t_m)^n − 1)

capital_rembourse = montant_credit − capital_restant_du
```

### 2.3 Rentabilité théorique (pendant crédit)

Basée uniquement sur les valeurs prévisionnelles saisies dans `biens_immo`.

```
charges_credit_annuelles = (mensualite_credit + mensualite_assurance) × 12

cashflow_annuel_theorique     = loyer_annuel_ht − taxe_fonciere − charges_annuelles − charges_credit_annuelles
cashflow_mensuel_theorique    = cashflow_annuel_theorique / 12

rendement_brut                = loyer_annuel_ht / prix_achat × 100
rendement_net_pendant_credit  = cashflow_annuel_theorique / prix_achat × 100
```

### 2.4 Rentabilité théorique (post crédit)

```
cashflow_annuel_post_credit  = loyer_annuel_ht − taxe_fonciere − charges_annuelles
cashflow_mensuel_post_credit = cashflow_annuel_post_credit / 12

rendement_net_post_credit    = cashflow_annuel_post_credit / prix_achat × 100
```

### 2.5 Rentabilité réelle (live, basée sur les dépenses saisies)

Calculée depuis les entrées de `depenses_immo` pour l'année civile en cours.

**Loyers perçus (HT) :** sommer les `montant_ht` des lignes `loyer` dont la `periode_debut` ou `periode_fin` couvre au moins un jour de l'année en cours (règle de proratisation à la période couverte).

**Dépenses réelles :** sommer les `montant_ttc` de tous les types hors `loyer` pour l'année en cours.

**Taxe foncière :** inclure `taxe_fonciere` de `biens_immo` dans les dépenses annuelles (charge ponctuelle annuelle).

```
cashflow_reel_ytd = loyers_ht_ytd − depenses_reelles_ytd − taxe_fonciere
```

**Extrapolation sur 12 mois :** basée sur le nombre de mois complets écoulés depuis le 1er janvier (ou depuis la date de la première dépense saisie si acquisition en cours d'année).

```
mois_ecoules = nombre de mois complets avec au moins une entrée dans depenses_immo

loyers_annualises   = (loyers_ht_ytd / mois_ecoules) × 12
depenses_annualisees = (depenses_reelles_ytd / mois_ecoules) × 12

cashflow_projete_annuel = loyers_annualises − depenses_annualisees − taxe_fonciere
rendement_reel_projete  = cashflow_projete_annuel / prix_achat × 100
```

### 2.6 Gestion des loyers avec TVA

Lors de la saisie d'un loyer en TTC :

```
montant_ht = montant_ttc / (1 + tva_rate)
```

La TVA applicable est normalement 10 % (para-hôtellerie/meublé). Le taux est configurable par saisie.

### 2.7 Couverture de période d'un loyer

Un loyer peut couvrir une période différente de sa date de paiement (ex : loyer trimestriel reçu en avril, couvrant janvier-mars).

- `date` = date de réception du paiement
- `periode_debut` / `periode_fin` = période couverte par ce loyer

Pour les calculs de rentabilité, utiliser la période couverte (pas la date de paiement) pour affecter le loyer au bon exercice.

---

## 3. Poche d'investissement « Immobilier Locatif »

Poche séparée du portfolio global (ne s'agrège pas dans la valeur globale).

| Indicateur | Calcul |
|---|---|
| **Valeur brute** | Somme des `prix_achat` de tous les biens |
| **Valeur nette** | Somme des `capital_rembourse` calculés à aujourd'hui pour tous les biens |
| **Engagement crédit restant** | Somme des `capital_restant_du` de tous les biens encore en crédit |

Affichage en carte dédiée sur le Dashboard, distincte des autres poches.

---

## 4. Structure des vues front

### 4.1 Vue liste — « Mes Biens »

- Liste des biens avec pour chaque bien :
  - Nom, surface, prix d'achat
  - Cashflow mensuel théorique (pendant crédit)
  - Rendement net théorique pendant crédit
  - Capital remboursé à ce jour
- Bouton « Ajouter un bien »

### 4.2 Vue détail d'un bien

**Bloc 1 — Caractéristiques**
- Tous les champs de `biens_immo`
- Mensualité de crédit calculée
- Mensualité d'assurance

**Bloc 2 — Rentabilité théorique**

| Indicateur | Pendant crédit | Post crédit |
|---|---|---|
| Cashflow annuel | calculé | calculé |
| Cashflow mensuel | calculé | calculé |
| Rendement net | calculé | calculé |

**Bloc 3 — Rentabilité réelle (année en cours)**
- Loyers HT perçus YTD
- Dépenses réelles YTD (hors taxe foncière)
- Cashflow réel YTD
- Cashflow projeté sur 12 mois (extrapolé)
- Rendement réel projeté

**Bloc 4 — Capital remboursé**
- Capital total emprunté
- Capital remboursé à ce jour
- Capital restant dû
- Barre de progression

**Bloc 5 — Dépenses**
- Tableau des dépenses avec : date, type, montant, période couverte (pour loyers), note
- Filtres par type et par année
- Bouton « Ajouter une dépense »

### 4.3 Modal — Ajout / édition d'un bien

Formulaire avec tous les champs de `biens_immo`. Affichage en lecture seule de la mensualité calculée en temps réel lors de la saisie.

### 4.4 Modal — Ajout d'une dépense

Champs :
- Type (select : Échéance prêt / Charge / Assurance / Loyer)
- Date de paiement
- Montant
- Si type = Loyer : toggle TTC/HT, taux TVA (défaut 10%), période début, période fin
- Note (optionnel)

---

## 5. Intégration AppScript (nouveaux endpoints)

Étendre `webapp.gs` avec les actions suivantes (via `action` dans le body POST) :

| Action | Description |
|---|---|
| `getBiensImmo` | Lister tous les biens |
| `getBienImmo` | Récupérer un bien par `id` |
| `addBienImmo` | Créer un bien |
| `updateBienImmo` | Modifier un bien |
| `deleteBienImmo` | Supprimer un bien et ses dépenses |
| `getDepensesImmo` | Lister les dépenses d'un bien (`bien_id` requis) |
| `addDepenseImmo` | Ajouter une dépense |
| `updateDepenseImmo` | Modifier une dépense |
| `deleteDepenseImmo` | Supprimer une dépense |

---

## 6. Règles et cas particuliers

- **Acquisition en cours d'année :** l'extrapolation annuelle part de la date de la première dépense saisie, pas du 1er janvier.
- **Bien sans crédit :** `montant_credit = 0` → mensualité = 0, capital remboursé = N/A, rentabilité post crédit = rentabilité courante.
- **Loyer trimestriel :** un seul enregistrement avec `periode_debut` = 1er du mois de début, `periode_fin` = dernier jour du mois de fin.
- **Taxe foncière :** saisie prévisionnelle dans `biens_immo`, intégrée dans les calculs théoriques ET réels (non saisie comme dépense dans `depenses_immo`).
- **Charges annuelles prévisionnelles :** valeur indicative pour la rentabilité théorique uniquement ; les vraies charges apparaissent dans `depenses_immo` pour le réel.
