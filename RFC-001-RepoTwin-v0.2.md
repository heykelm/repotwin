# RepoTwin — RFC 001

## Plateforme d’optimisation expérimentale des dépôts Git pour les agents IA

**Version :** 0.2  
**Date :** 23 octobre 2026  
**Statut :** Proposition exploratoire — à débattre  
**Signature :** *Measure. Optimize. Prove.*

## 1. Résumé exécutif

RepoTwin est un projet d’outil **local-first** visant à améliorer l’efficacité des agents de développement IA (Codex, Claude Code, Cursor, Gemini CLI) sur un dépôt Git donné.

Le principe est de **comprendre le dépôt**, de **créer une variante expérimentale isolée** (*twin*), d’y appliquer une optimisation ciblée, puis de **comparer les résultats réels** d’un agent sur la version initiale et la version optimisée.

L’indicateur prioritaire est la **consommation de tokens par tâche correctement terminée**, étudiée conjointement avec le taux de réussite, la durée, les itérations et les régressions.

RepoTwin ne prétend pas inventer les scanners de readiness, les fichiers d’instructions ou le suivi des tokens. Sa différenciation potentielle est la **boucle complète d’optimisation expérimentale d’un dépôt spécifique : Analyze → Twin → Compare → Decide**.

**Hypothèse à vérifier :** certaines modifications ciblées du dépôt réduisent de façon reproductible les ressources nécessaires à des agents IA pour accomplir des tâches réelles, sans dégrader la qualité.

Aucun gain n’est encore démontré.

## 2. Problème et motivation

Sur des dépôts complexes, les agents peuvent consacrer des ressources à explorer des fichiers non pertinents, retrouver des chemins obsolètes, reconstruire l’architecture, relire des instructions redondantes ou découvrir les commandes de validation.

Ces comportements peuvent augmenter les tokens consommés, la durée et les erreurs. Mais une alerte statique ne démontre pas nécessairement une perte d’efficacité : un chemin signalé comme absent peut être un alias TypeScript, une colonne SQL ou une référence volontairement non présente sur disque.

**Question centrale :** quelles caractéristiques du dépôt ralentissent réellement les agents, et quelles corrections produisent un gain vérifiable ?

## 3. Solutions existantes et différenciation

### 3.1 Ce qui existe déjà

Des outils comme [`agent-ready`](https://github.com/EShener/agent-ready) proposent déjà des scores de préparation, l’analyse des instructions, la détection de dérives et des corrections. D’autres outils suivent les coûts, les tokens et les performances des agents.

RepoTwin ne doit pas reproduire ces fonctionnalités comme si elles étaient nouvelles. Une étude concurrentielle reste nécessaire pour vérifier si une solution comparable couvre déjà toute la boucle envisagée.

### 3.2 Proposition distinctive

RepoTwin chercherait à relier quatre éléments :

1. Un **diagnostic étayé**, qui identifie les faux positifs et les problèmes potentiellement coûteux.
2. Une **modification réversible** dans un environnement Git isolé.
3. Une **expérience comparative** sur des tâches de développement vérifiables.
4. Une **décision fondée sur les résultats**, et non sur la seule progression d’un score.

Le score de readiness reste utile, mais il n’est pas une preuve d’économie de tokens.

## 4. Architecture fonctionnelle

```text
Dépôt Git
   |
   v
[Analyze]  Scanner(s) + validation des constats
   |
   v
[Diagnose] Hypothèses d'amélioration et risques
   |
   v
[Twin]     Git worktrees isolés
   |                  |
   |              Candidate (optimisée)
   +-- Baseline ------+
                      |
                      v
[Compare]  Tâches agent + tests + métriques
                      |
                      v
[Decide]   Conserver / rejeter / résultat non concluant
```

### 4.1 Analyze — Scanner et comprendre

Le scanner identifie, selon les informations accessibles :

- Langages, frameworks, packages, sous-projets et dépendances.
- Structure des modules, points d’entrée et commandes de test/build/lint.
- Fichiers `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, règles Cursor et autres instructions.
- Références documentaires suspectes, duplications et contradictions.
- Indicateurs de navigation, complexité et couplage utiles aux hypothèses d’optimisation.

L’architecture doit permettre d’intégrer **des scanners interchangeables** : réutiliser `agent-ready` au départ, puis compléter ou remplacer ses analyses lorsque nécessaire.

Chaque constat doit être accompagné d’une preuve, d’un degré de confiance et d’une action suggérée. Les alias, champs métier et chemins ignorés ne doivent pas être supprimés automatiquement.

### 4.2 Diagnose — Formuler une hypothèse

Chaque proposition d’optimisation décrit :

- Le problème observé et ses preuves.
- Le mécanisme supposé de surconsommation ou d’échec.
- La modification proposée.
- Les risques pour le code et les développeurs humains.
- La tâche et les métriques permettant de vérifier le gain.

### 4.3 Twin — Modifier sans risque pour `main`

RepoTwin crée une **Baseline** et une **Candidate** à partir du même état de référence. L’approche envisagée repose sur `git worktree` et des branches isolées.

Les modifications doivent être inspectables par `git diff`, réversibles et soumises aux tests existants. Les actions sur bases de données, services de production, paiements, secrets ou infrastructures externes doivent être désactivées ou explicitement sécurisées pendant les expériences.

### 4.4 Compare — Mesurer réellement

Les deux variantes reçoivent des tâches comparables avec, autant que possible, le même agent, le même modèle, les mêmes paramètres, les mêmes outils et des conditions initiales équivalentes.

**Mesures prioritaires :**

| Indicateur | Pourquoi le mesurer |
| --- | --- |
| Taux de réussite | Éviter de « gagner » des tokens en échouant davantage |
| Tokens totaux par tâche réussie | Mesurer l’efficacité en ressources |
| Tokens d’entrée et de sortie | Comprendre les sources de consommation |
| Durée | Mesurer l’efficacité opérationnelle |
| Itérations et appels d’outils | Détecter les boucles inutiles |
| Fichiers explorés | Étudier l’efficacité de navigation |
| Tests et régressions | Protéger la qualité |
| Interventions humaines | Évaluer l’autonomie réelle |
| Coût du benchmark | Calculer le retour sur investissement net |

Les fournisseurs ne comptabilisent pas nécessairement les tokens de la même manière. Les comparaisons doivent donc préciser la source des mesures et leurs limites.

Les expériences sont répétées lorsque c’est possible : une seule exécution ne suffit pas à prouver une amélioration.

### 4.5 Decide — Recommander sur preuve

RepoTwin distingue :

- **Gain confirmé :** amélioration reproductible sans dégradation de qualité.
- **Résultat non concluant :** variation ou données insuffisantes.
- **Modification défavorable :** échec accru, régression ou surcoût.

Aucune modification ne doit être adoptée automatiquement au seul motif qu’elle améliore un score statique.

## 5. Premier terrain de validation : NiceHub Platform

Un premier rapport `agent-ready` sur NiceHub Platform a indiqué :

| Observation du rapport | Résultat |
| --- | --- |
| Score | 0/100 (F) |
| Findings | 46 |
| Langage principal | JavaScript |
| Frameworks | Aucun détecté |
| Monorepo | Non détecté |
| Package manager | Inconnu |
| Commandes de vérification | Aucune détectée |
| Instructions existantes | `AGENTS.md`, `CLAUDE.md` et sept règles Cursor |

Ces résultats **ne prouvent pas** que NiceHub est mal conçu ni que ses agents consomment trop de tokens. Plusieurs alertes portent sur des références comme `rides.price`, `@/components/entity` ou `.env`, qui peuvent être autre chose que des chemins de fichiers.

### Expérience pilote proposée

**H1 :** corriger les références réellement obsolètes et fournir une carte de navigation ciblée améliore l’efficacité d’un agent sur des tâches NiceHub.

1. Vérifier la structure réelle du dépôt et les alertes du scanner.
2. Choisir trois tâches représentatives, reproductibles et vérifiables.
3. Préparer Baseline et Candidate dans des environnements isolés.
4. Appliquer une seule optimisation à la fois, dans la mesure du possible.
5. Exécuter plusieurs essais avec un premier agent.
6. Comparer tokens, réussite, durée, itérations et tests.
7. Calculer le gain brut puis le gain net après coût des expérimentations.
8. Documenter les limites et décider de conserver ou rejeter la modification.

## 6. MVP — périmètre réduit

### MVP 1 : Analyze

- Analyse locale en lecture seule.
- Import facultatif des résultats `agent-ready`.
- Identification de la structure des packages et des commandes.
- Validation de quelques alertes et détection de faux positifs probables.
- Rapport Markdown/JSON ou HTML avec preuves et recommandations.

### MVP 2 : Twin

- Création d’une variante Git isolée.
- Application d’une optimisation simple, avec validation humaine.
- Affichage du diff et lancement des vérifications disponibles.
- Nettoyage et retour arrière sûrs.

### MVP 3 : Compare

- Intégration d’un seul agent au départ.
- Exécution d’un petit ensemble de tâches vérifiables.
- Collecte des métriques réellement accessibles.
- Rapport Baseline vs Candidate avec verdict et incertitudes.

**Hors MVP :** SaaS multi-utilisateur, support exhaustif des agents, refactoring autonome massif, dashboard complexe, optimisation continue de tous les commits.

**Interface initiale :** CLI locale. Un tableau de bord web local peut suivre une fois la valeur démontrée.

## 7. Objectifs et critères de succès

Les seuils suivants sont des **cibles exploratoires**, non des prédictions :

| Réduction de tokens par tâche réussie | Interprétation |
| --- | --- |
| 10 % | Premier signal encourageant à confirmer |
| 20 % | Objectif de recherche pour le MVP |
| 30 % ou plus | Gain ambitieux nécessitant une validation renforcée |

Le prototype sera jugé utile si :

- Les diagnostics sont plus fiables que les alertes brutes sur des cas vérifiés.
- Les modifications sont réversibles et ne dégradent pas les tests.
- Les mesures sont suffisamment reproductibles pour éclairer une décision.
- Le coût de l’expérience reste proportionné au gain potentiel.
- La valeur ajoutée dépasse celle des outils existants.

Un résultat négatif ou non concluant est acceptable s’il permet de rejeter une hypothèse proprement.

## 8. Risques et limites

- **Variabilité des agents :** des essais répétés peuvent donner des résultats différents.
- **Accès aux métriques :** Cursor, Codex, Gemini et Claude ne fournissent pas nécessairement des traces comparables.
- **Coût :** les benchmarks consomment eux-mêmes des tokens et du temps.
- **Contamination des essais :** caches, historique de conversation et état des outils peuvent biaiser les résultats.
- **Sécurité :** une tâche expérimentale ne doit pas affecter les services de production.
- **Faux positifs :** les scanners peuvent mal interpréter des références métier ou des alias.
- **Sur-optimisation :** une amélioration sur trois tâches peut dégrader d’autres usages.
- **Évolution des modèles :** un gain peut disparaître avec une nouvelle version d’agent.
- **Concurrence :** la combinaison envisagée peut déjà être partiellement ou entièrement proposée ailleurs.

## 9. Questions à soumettre aux experts

1. Quels outils existants couvrent déjà une boucle complète **scan → optimisation → benchmark → décision** ?
2. Quelle architecture de scanners interchangeables minimise la duplication avec `agent-ready` ?
3. Comment distinguer de manière robuste chemins de fichiers, alias, colonnes SQL et références documentaires ?
4. Quelles données de consommation sont accessibles pour Codex, Cursor, Gemini CLI et Claude Code ?
5. Comment isoler les expériences et limiter les biais liés aux caches, à la variabilité et aux services externes ?
6. Quelle méthode statistique et combien de répétitions rendent les résultats crédibles ?
7. Quel indicateur agrégé évite de privilégier la réduction des tokens au détriment de la réussite ?
8. Quelles optimisations simples sont les plus susceptibles de produire un gain mesurable ?
9. Quel coût maximal de benchmark est acceptable au regard des économies futures ?
10. Le produit doit-il viser les développeurs individuels, les équipes ou les organisations ?
11. Faut-il construire une CLI open source, une application locale commerciale ou un service hébergé ?
12. Quels résultats justifieraient un **go**, un **pivot** ou un **no-go** ?

## 10. Positionnement et identité

**Nom :** RepoTwin  
**Dépôt GitHub envisagé :** `repotwin`  
**Signature :** *Measure. Optimize. Prove.*

**Description courte (EN) :**

> RepoTwin creates an experimental twin of your Git repository to test whether targeted optimizations improve AI coding agent efficiency.

**Promesse à valider :**

> Make AI coding agents more efficient on your repository — and prove the improvement.

Le nom *Twin* désigne les deux états comparables du même dépôt : **Baseline** et **Candidate**.

## 11. Décision attendue

- **Go :** développer le prototype local sur NiceHub si une différenciation plausible et un protocole fiable sont établis.
- **Pivot :** réduire le périmètre à l’observabilité ou au diagnostic si les expériences sont trop coûteuses.
- **No-go :** ne pas développer un outil supplémentaire si les solutions existantes couvrent déjà le besoin à un coût acceptable.

**Statut actuel :** discussion ouverte. Aucune économie de tokens, originalité commerciale ou viabilité économique n’est démontrée à ce stade.

---

## Annexe A — Changements par rapport à la v0.1

1. Recentrage sur l’**optimisation expérimentale** plutôt que le scoring de readiness.
2. Scanner repositionné comme **fondation technique réutilisable**.
3. Formalisation de **Baseline / Candidate** comme cœur du concept *Twin*.
4. Introduction des **tokens par tâche réussie** comme indicateur prioritaire, conjointement avec la qualité.
5. Ajout d’un **moteur de décision** distinguant gain confirmé, résultat non concluant et dégradation.
6. Définition de cibles exploratoires **10 / 20 / 30 %**, explicitement non garanties.
7. MVP resserré autour de **Analyze → Twin → Compare**.
8. Renforcement des garde-fous : isolation, coûts, faux positifs, variabilité et sécurité.
9. Clarification de la différenciation vis-à-vis d’`agent-ready` et des outils de benchmarking.
10. Confirmation du nom **RepoTwin** et de la signature **Measure. Optimize. Prove.**
