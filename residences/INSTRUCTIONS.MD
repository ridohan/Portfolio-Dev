# Résidences — Base de connaissances pour implémentation

## Contexte projet

Module à intégrer dans le Portfolio Manager existant (HTML/CSS/JS vanilla + Tailwind CDN dark slate + Google Sheets via AppScript Web App). Ce module gère les résidences principale et secondaires dans une logique **patrimoine** — pas de tracking de dépenses, pas de cashflow. Le crédit se rembourse de toute façon ; l'objectif est de visualiser le capital remboursé à date et la valeur nette du bien.

---

## 1. Différence avec l'immobilier locatif

| | Immobilier locatif | Résidences |
|---|---|---|
| Revenus locatifs | Oui | Non |
| Cashflow / rentabilité | Oui | Non |
| Suivi des dépenses | Oui | Non |
| Capital remboursé | Oui | Oui |
| Valeur estimée du marché | Non | Oui (manuelle) |
| Objectif principal | Rentabilité | Patrimoine net |

---

## 2. Modèle de données (Google Sheets)

### Nouvel onglet : `residences`

| Colonne | Type | Description |
|---|---|---|
| `id` | string (uuid) | Identifiant unique |
| `nom` | string | Nom du bien (ex : « Appartement Paris 11e ») |
| `type` | string | `principale` ou `secondaire` |
| `surface_m2` | number | Surface en m² |
| `prix_achat` | number | Prix d'achat total (€) |
| `valeur_estimee` | number | Valeur de marché estimée actuelle (€) — mise à jour manuelle |
| `date_valeur_estimee` | date (YYYY-MM-DD) | Date de la dernière mise à jour de la valeur estimée |
| `montant_credit` | number | Montant emprunté (€) |
| `duree_credit_mois` | number | Durée du crédit (en mois) |
| `taux_credit` | number | Taux annuel du crédit (ex: 0.035 pour 3,5%) |
| `mensualite_assurance` | number | Mensualité d'assurance crédit (€) |
| `numero_pret` | string | Numéro de prêt |
| `date_debut_credit` | date (YYYY-MM-DD) | Date de la 1ère échéance |

Pas d'onglet de dépenses — aucune saisie de mouvements.

---

## 3. Logique métier

### 3.1 Calcul de la mensualité de crédit

Formule d'annuité constante (identique au module locatif) :

```
t_m = taux_credit / 12
n   = duree_credit_mois

mensualite_credit = (montant_credit × t_m) / (1 − (1 + t_m)^(−n))
```

### 3.2 Calcul du capital remboursé (à aujourd'hui)

Depuis `date_debut_credit`, calculer le nombre de mensualités écoulées `k` :

```
k = min(mois_ecoules_depuis_date_debut_credit, duree_credit_mois)

capital_restant_du = montant_credit × ((1 + t_m)^n − (1 + t_m)^k) / ((1 + t_m)^n − 1)

capital_rembourse = montant_credit − capital_restant_du
```

### 3.3 Patrimoine net du bien

```
patrimoine_net = valeur_estimee − capital_restant_du
```

Si le crédit est soldé (`k >= n`) : `capital_restant_du = 0` → `patrimoine_net = valeur_estimee`.

### 3.4 Plus-value latente

```
plus_value_latente = valeur_estimee − prix_achat
```

Indicateur informatif (positif = plus-value, négatif = moins-value).

---

## 4. Poche « Résidences » (Dashboard)

Carte séparée sur le Dashboard, distincte des poches investissements et de l'immobilier locatif.

| Indicateur | Calcul |
|---|---|
| **Valeur estimée totale** | Somme des `valeur_estimee` de toutes les résidences |
| **Dette totale** | Somme des `capital_restant_du` calculés à aujourd'hui |
| **Patrimoine net** | Valeur estimée totale − Dette totale |
| **Capital remboursé total** | Somme des `capital_rembourse` de toutes les résidences |

---

## 5. Structure des vues front

### 5.1 Vue liste — « Mes Résidences »

- Liste des résidences avec pour chacune :
  - Badge type (`PRINCIPALE` / `SECONDAIRE`)
  - Nom, surface, prix d'achat
  - Valeur estimée + date de mise à jour
  - Capital remboursé à ce jour / Capital restant dû
  - Patrimoine net
- Bouton « Ajouter une résidence »

### 5.2 Vue détail d'une résidence

**Bloc 1 — Caractéristiques**
- Tous les champs de `residences`
- Mensualité de crédit calculée (lecture seule)
- Mensualité d'assurance
- Mensualité totale (crédit + assurance)

**Bloc 2 — Patrimoine**

| Indicateur | Valeur |
|---|---|
| Prix d'achat | saisi |
| Valeur estimée | saisie (avec date de MAJ) |
| Plus-value latente | calculée |
| Capital total emprunté | saisi |
| Capital remboursé | calculé |
| Capital restant dû | calculé |
| **Patrimoine net** | calculé |

- Barre de progression du remboursement (capital remboursé / montant total)

**Bloc 3 — Crédit**
- Numéro de prêt
- Date de début, durée totale
- Date de fin théorique (date_debut_credit + duree_credit_mois)
- Mensualités restantes = `max(0, n − k)`
- Projection de fin de crédit (mois/année)

### 5.3 Modal — Ajout / édition d'une résidence

Formulaire avec tous les champs de `residences`. La mensualité de crédit s'affiche en lecture seule et se recalcule en temps réel lors de la saisie du montant, taux et durée.

### 5.4 Modal — Mise à jour de la valeur estimée

Formulaire simple :
- Valeur estimée (€)
- Date d'estimation (défaut : aujourd'hui)

Accessible depuis le bouton « Mettre à jour la valeur » sur la vue détail ou la liste.

---

## 6. Intégration AppScript (nouveaux endpoints)

Étendre `webapp.gs` avec les actions suivantes :

| Action | Description |
|---|---|
| `getResidences` | Lister toutes les résidences |
| `getResidence` | Récupérer une résidence par `id` |
| `addResidence` | Créer une résidence |
| `updateResidence` | Modifier une résidence (y compris valeur estimée) |
| `deleteResidence` | Supprimer une résidence |

---

## 7. Règles et cas particuliers

- **Crédit soldé :** si `k >= n`, `capital_restant_du = 0`, `capital_rembourse = montant_credit`, la barre de progression est à 100%.
- **Bien sans crédit :** `montant_credit = 0` → mensualité = 0, capital remboursé = N/A, patrimoine net = valeur estimée.
- **Valeur estimée non renseignée :** utiliser `prix_achat` par défaut comme valeur de référence. La date de valeur estimée affiche la date d'achat.
- **Une seule résidence principale autorisée** — validation à la saisie (warning, pas un blocage).
- **Résidence secondaire :** peut être multiple, aucune restriction.
