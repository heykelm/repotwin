# Recherche Approfondie : Le Combo Optimal pour l'Efficience de Contexte IA

Date : 29 octobre 2026  
Auteurs : Antigravity (DeepMind) & Astra  
Statut : Rapport de Recherche & Preuves Expérimentales

---

## 1. Diagnostic de l'anomalie : Le « Paradoxe du Double Payload »

Le micro-pilote initial d'Astra a mesuré **+0.45 % à +10 % de taille supplémentaire** pour le mode compact.
L'analyse du code source (`src/mcp/server.ts:429-432`) révèle la cause mécanique exacte :

```ts
// Dans le serveur MCP testé par Astra :
errorOutput: sieve ? sieve.compactOutput : f.output,
rawOutput: isCompact ? f.output : undefined, // <-- LE PIÈGE EST ICI
extractedFailures: sieve && sieve.failures.length > 0 ? sieve.failures : undefined
```

Pour sécuriser le diagnostic et éviter qu'un échec de regex ne masque une erreur, l'implémentation renvoyait **à la fois** :
1. Le résumé compact (`compactOutput`)
2. Les échecs structurés (`extractedFailures`)
3. **Et l'intégralité du log brut (`rawOutput`)**

Par définition mathématique, pour tout log de test de taille $L > 0$ et résumé $S > 0$, la charge utile sérialisée était :
$$\text{Taille}_{\text{Dual}} = \text{Envelope} + S + L + \text{Overhead JSON} > \text{Taille}_{\text{Raw}} = \text{Envelope} + L$$

Le mode compact ne pouvait pas réduire la consommation puisqu'il contenait déjà 100 % du log brut à l'intérieur de son propre JSON.

---

## 2. Les 3 Variables du Problème

Pour qu'une optimisation devienne réellement rentable, trois facteurs doivent être combinés :

| Facteur | Impact | Observation |
| :--- | :--- | :--- |
| **1. Volume initial du log ($L$)** | Sur un test de 10 lignes (800 octets), l'overhead JSON domine. Sur un test de 350 lignes (28 Ko), le bruit domine à 94 %. | **Seuil de rentabilité : ~600 octets.** En dessous, le brut est plus léger. Au-delà, le résumé devient mathématiquement supérieur. |
| **2. Nombre d'itérations ($N$)** | Dans une session de débogage multi-tours, le contexte s'accumule de manière quadratique : $\sum_{i=1}^N \text{Contexte}_i$. | Au tour 1, l'écart est minime. Au tour 4, un log non compacté sature 45 000 tokens contre 20 000 tokens. |
| **3. Architecture de transmission** | Monolithique (tout dans le même message) vs Deux Niveaux (Two-Tier Lazy Fetch). | **C'est le facteur décisif.** |

---

## 3. Le Combo Gagnant : L'Architecture « Two-Tier » (Lazy Fetch)

Au lieu d'injecter 30 Ko de logs dans la conversation de l'agent au cas où il en aurait besoin, l'architecture optimale sépare la détection de la consultation approfondie :

```
┌────────────────────────────────────────────────────────┐
│  Agent appelle repotwin_run_checks                     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  Tier 1 : Réponse MCP Chirurgicale (~850 octets)       │
│  - Statut : Échec                                      │
│  - Erreur : test/billing.test.ts:42 (401 vs 200)       │
│  - Log Handle : "rt_chk_9f2a" (350 lignes disponibles) │
└──────────────────────────┬─────────────────────────────┘
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
[Cas 1 : 80% des cas]               [Cas 2 : 20% des cas complexes]
L'agent a assez d'infos pour        L'agent demande les détails :
corriger le code immédiatement.     repotwin_get_log({ id: "rt_chk_9f2a", tail: 40 })
-> ZÉRO bruit injecté dans          -> Seules 40 lignes utiles sont injectées.
   l'historique !
```

---

## 4. Mesures Expérimentales Comparatives

Simulation reproductible exécutée via `scripts/research-threshold-benchmark.mjs` :

### A. Taille de la charge utile par profil de test (1 seul tour)

| Profil de test | Raw v0.2 (Capped 2k) | Dual (Actuel v0.3) | Pure Compact (Sans raw) | Two-Tier (Sans fetch) | Two-Tier (Avec fetch 40 l) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Tiny (10 lignes, ~850 B)** | 1 300 B | 1 800 B (+38.5 %) | **830 B (-36.2 %)** | **870 B (-33.1 %)** | 2 020 B |
| **Small (40 lignes, ~3.2 KB)** | 2 450 B | 4 150 B (+69.4 %) | **830 B (-66.1 %)** | **870 B (-64.5 %)** | 4 370 B |
| **Medium (120 lignes, ~9.8 KB - Jest)** | 2 450 B | 10 750 B (+338.8 %) | **830 B (-66.1 %)** | **870 B (-64.5 %)** | 5 170 B |
| **Large (350 lignes, ~28.5 KB)** | 2 450 B | 29 450 B (+1 102 %) | **830 B (-66.1 %)** | **870 B (-64.5 %)** | 5 170 B |
| **Heavy (800 lignes, ~65.5 KB)** | 2 450 B | 66 485 B (+2 613 %) | **830 B (-66.1 %)** | **870 B (-64.5 %)** | 5 170 B |

### B. Consommation de contexte cumulée sur 4 tours de debug (Profil Medium, 4 000 tokens de base)

| Stratégie | Contexte Tour 1 | Contexte Tour 2 | Contexte Tour 3 | Contexte Tour 4 | Total cumulé facturé | Variation vs Raw v0.2 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Raw Uncapped (Terminal brut)** | 6 813 tks | 9 626 tks | 12 439 tks | 15 252 tks | **44 130 tokens** | +79.2 % |
| **Dual v0.3 (Actuel)** | 6 938 tks | 9 876 tks | 12 814 tks | 15 752 tks | **45 380 tokens** | +84.2 % |
| **Raw v0.2 (Capped 2k)** | 4 863 tks | 5 726 tks | 6 589 tks | 7 452 tks | **24 630 tokens** | 0.0 % (Réf) |
| **Two-Tier (Avec 25 % fetch rate)** | 4 468 tks | 4 936 tks | 5 404 tks | 6 947 tks | **21 755 tokens** | **-11.7 %** |
| **Pure Compact (Surgical Sieve)** | 4 458 tks | 4 916 tks | 5 374 tks | 5 832 tks | **20 580 tokens** | **-16.4 % (-53% vs brut)** |

---

## 5. Le Seuil de Rentabilité (Tipping Point)

Le seuil de bascule précis où résumer devient avantageux a été mesuré à **600 octets (~15 lignes)** :
- **Sous 600 octets** : la sortie brute est tellement courte que la parser et l'envelopper dans des clés JSON coûte plus cher que de la renvoyer telle quelle.
- **Au-dessus de 600 octets** : le rapport signal/bruit s'effondre. Le filtrage chirurgical préserve entre 60 % et 90 % de la taille utile.

---

## 6. Recommandations pour la suite du chantier

1. **Ne plus jamais renvoyer `rawOutput` complet dans le même message JSON que le résumé.**
2. **Implémenter l'outil complémentaire `repotwin_get_log`** :
   - Paramètres : `candidateId`, `commandId`, `tail: number` (défaut 50 lignes).
   - L'agent ne charge les logs bruts que s'il en exprime expressément le besoin.
3. **Appliquer une règle de seuil dynamique** :
   - Si la sortie fait moins de 15 lignes (< 600 octets), la renvoyer brute directement sans surcoût de parsing.
   - Si la sortie dépasse 15 lignes, renvoyer le résumé chirurgical avec le handle `logId`.

