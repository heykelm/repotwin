# RepoTwin — RFC 001
## Plateforme d'analyse et d'optimisation expérimentale des dépôts Git pour les agents IA

**Version :** 0.1 — Document de discussion  
**Date :** 23 octobre 2026  
**Statut :** Proposition exploratoire — non validée  
**Public cible :** Architectes logiciels, développeurs, experts en agents IA, ingénieurs QA, spécialistes DevEx et observabilité.

---

## 1. Résumé exécutif

Les agents de développement IA tels que Codex, Claude Code, Cursor et Gemini CLI sont capables d'intervenir sur des dépôts logiciels complexes. Leur efficacité dépend toutefois de nombreux facteurs : structure du projet, qualité des instructions, facilité de navigation, disponibilité des tests, architecture du code et pertinence du contexte accessible.

Plusieurs outils, notamment `agent-ready`, évaluent déjà la préparation d'un dépôt pour ces agents et proposent des améliorations.

**RepoTwin propose d'aller au-delà de cette évaluation statique.**

Son ambition est d'identifier les obstacles susceptibles de dégrader l'efficacité des agents, de proposer des modifications contrôlées du dépôt et, surtout, de mesurer expérimentalement leurs effets sur des tâches de développement réelles.

L'objectif n'est pas simplement d'améliorer un score de conformité, mais de déterminer si une modification permet à un agent de produire un résultat correct avec moins de tokens, moins de temps, moins d'itérations ou moins d'interventions humaines.

**Hypothèse centrale :** la préparation d'un dépôt pour les agents IA peut être optimisée et évaluée empiriquement, plutôt que seulement estimée à partir de règles statiques.

Cette hypothèse reste à démontrer.

## 2. Problématique

Un agent IA intervenant sur un projet logiciel peut consacrer une partie significative de ses ressources à :

- Explorer des fichiers sans rapport direct avec la tâche.
- Reconstituer une architecture insuffisamment documentée.
- Lire plusieurs fois les mêmes éléments de contexte.
- Interpréter des instructions redondantes ou contradictoires.
- Chercher des chemins de fichiers obsolètes.
- Identifier les commandes de test, de build et de validation.
- Corriger des erreurs causées par une mauvaise compréhension du projet.

Ces comportements peuvent entraîner une consommation supplémentaire de tokens, une augmentation de la durée d'exécution ou une baisse du taux de réussite.

Cependant, une structure de dépôt jugée complexe par un scanner n'est pas nécessairement inefficace pour un agent. Inversement, un dépôt bien noté peut rester difficile à modifier.

**Problème de recherche : comment distinguer les caractéristiques structurelles réellement pénalisantes pour les agents IA des simples écarts à des conventions de préparation ?**

## 3. État des solutions existantes

### 3.1. Outils de préparation des dépôts

`agent-ready` fournit notamment :

- Un score de préparation des dépôts.
- L'analyse des instructions destinées aux agents.
- La détection de références potentiellement obsolètes.
- Des recommandations et des corrections automatiques.
- Des rapports et comparaisons entre dépôts.
- Des fonctionnalités d'intégration CI.

RepoTwin ne doit donc pas considérer ces fonctions comme des innovations propres.

### 3.2. Outils d'observabilité et de benchmarking

D'autres solutions permettent déjà, à différents niveaux, de suivre les tokens, les coûts, les durées, les traces d'exécution ou les performances d'agents sur des tâches de référence.

La mesure de consommation ou le benchmarking d'agents ne constituent pas, isolément, une différenciation suffisante.

### 3.3. Espace de différenciation envisagé

La proposition de RepoTwin consiste à **relier le diagnostic d'un dépôt, la génération de modifications contrôlées et leur validation expérimentale sur ce même dépôt**.

Cette combinaison doit faire l'objet d'une étude concurrentielle approfondie avant toute revendication de nouveauté.

## 4. Proposition de solution

RepoTwin est envisagé comme un outil *local-first*, compatible avec les dépôts Git existants.

Il comprend quatre composants complémentaires.

### 4.1. Repository Scanner

**Objectif : comprendre le dépôt avant toute intervention.**

Le scanner recueille notamment :

- Langages, frameworks et gestionnaires de packages.
- Structure des applications et modules.
- Dépendances et points d'entrée.
- Instructions `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` et règles Cursor.
- Commandes de test, lint et build.
- Références documentaires potentiellement obsolètes.
- Caractéristiques de complexité, de couplage et de navigation.

Il peut s'appuyer sur des outils existants, notamment `agent-ready`, complétés par des analyses spécifiques.

Le résultat doit inclure les preuves, les incertitudes et les limites de détection.

### 4.2. Diagnostic Engine

**Objectif : transformer les observations en hypothèses d'amélioration.**

Le moteur doit distinguer :

1. Les problèmes confirmés.
2. Les problèmes probables.
3. Les faux positifs ou éléments nécessitant une validation.
4. Les améliorations purement conventionnelles, sans effet démontré sur les agents.

Exemple : `rides.price` peut représenter une colonne métier plutôt qu'un chemin de fichier manquant. Le système ne doit pas recommander sa suppression sans comprendre son contexte.

Chaque proposition devra indiquer :

- Le problème observé et ses preuves.
- Le mécanisme supposé de dégradation des performances.
- La correction proposée.
- Le risque de modification.
- Le moyen de vérifier l'hypothèse.

### 4.3. Optimization Engine

**Objectif : appliquer des changements ciblés et réversibles.**

Les modifications envisagées incluent :

- Correction des chemins réellement obsolètes.
- Consolidation des instructions redondantes.
- Création de cartographies de modules.
- Documentation des commandes de vérification.
- Amélioration de la découverte des fichiers pertinents.
- Réorganisation ciblée de composants, lorsque cela est justifié.

Les changements sont préparés dans un environnement Git isolé, par exemple à l'aide de `git worktree`.

Les corrections déterministes à faible risque sont prioritaires. Les refactorings complexes exigent une validation explicite et des tests adaptés.

### 4.4. Experimental Benchmark Engine

**Objectif : mesurer les effets réels des modifications.**

Le moteur exécute des tâches représentatives sur deux versions du dépôt :

- **Baseline :** dépôt original.
- **Candidate :** dépôt avec les optimisations proposées.

Les expériences doivent contrôler autant que possible le modèle, les paramètres, le contexte initial, les outils disponibles, la tâche et les conditions d'exécution.

Les métriques envisagées sont :

| Métrique | Finalité |
|---|---|
| Taux de réussite | Vérifier la capacité à terminer correctement la tâche |
| Tokens consommés | Mesurer les ressources mobilisées |
| Durée d'exécution | Mesurer la latence de résolution |
| Nombre d'itérations | Identifier les tentatives et corrections répétées |
| Nombre de fichiers explorés | Étudier l'efficacité de navigation |
| Résultats des tests | Détecter les régressions |
| Interventions humaines | Mesurer l'autonomie effective |

Le coût total de l'expérience doit être pris en compte dans l'évaluation du retour sur investissement.

## 5. Architecture conceptuelle

```text
                   RepoTwin
                      |
              Repository Scanner
                      |
               Diagnostic Engine
                      |
              Optimization Engine
                      |
                Git Worktree
                 /        \
            Baseline    Candidate
                 \        /
               Benchmark Engine
                      |
               Results Analyzer
                      |
             Recommendation Report
```

Une architecture modulaire est privilégiée afin de permettre :

- Le remplacement des scanners.
- L'intégration de différents agents IA.
- L'ajout de nouvelles métriques.
- Le fonctionnement local sans infrastructure cloud obligatoire.
- Une éventuelle intégration CI/CD ultérieure.

## 6. Premier cas d'étude : NiceHub Platform

NiceHub Platform est proposé comme premier dépôt pilote.

Un audit préliminaire réalisé avec `agent-ready` a produit les résultats suivants :

| Observation | Résultat |
|---|---|
| Agent Readiness Score | 0/100 |
| Anomalies signalées | 46 |
| Instructions Codex | `AGENTS.md` détecté |
| Instructions Claude | `CLAUDE.md` détecté |
| Règles Cursor | Sept fichiers détectés |
| Frameworks | Aucun détecté |
| Gestionnaire de packages | Inconnu |
| Commandes de vérification | Aucune détectée |

Le rapport mentionne notamment des références de chemins potentiellement obsolètes, des commandes de test absentes et des instructions redondantes.

Ces observations ne permettent pas de conclure que le dépôt est de mauvaise qualité ni que les agents consomment excessivement des tokens.

Elles fournissent toutefois des hypothèses concrètes à vérifier.

### Expérience pilote proposée

**Hypothèse H1 :** corriger les références réellement obsolètes et fournir une cartographie de navigation ciblée réduit le travail d'exploration des agents sur certaines tâches NiceHub.

Protocole initial :

1. Sélectionner trois tâches représentatives et vérifiables.
2. Préparer deux versions isolées du dépôt.
3. Exécuter les tâches avec un agent donné, dans des conditions aussi comparables que possible.
4. Répéter les expériences pour observer leur variabilité.
5. Comparer réussite, tokens, durée et régressions.
6. Évaluer si le gain éventuel justifie le coût de l'optimisation et du benchmark.

Aucun pourcentage d'économie n'est avancé avant ces mesures.

## 7. MVP envisagé

La première version doit rester volontairement limitée.

**Inclus dans le MVP :**

- Analyse locale en lecture seule d'un dépôt Git.
- Intégration facultative d'`agent-ready`.
- Détection de la structure réelle des packages.
- Validation de références documentaires suspectes.
- Identification des instructions redondantes.
- Rapport HTML/JSON avec preuves et recommandations.
- Préparation d'une modification simple dans un worktree.
- Comparaison expérimentale limitée à un agent et quelques tâches.

**Hors périmètre initial :**

- Refactoring architectural autonome à grande échelle.
- Support complet de tous les agents.
- Plateforme SaaS multi-utilisateur.
- Optimisation garantie des coûts.
- Benchmark continu sur l'ensemble des commits.
- Modification automatique de la production.

Le premier objectif est un prototype démontrant la faisabilité et la valeur des mesures, pas un produit commercial complet.

## 8. Contraintes et risques

### Fiabilité des mesures

Les modèles peuvent produire des résultats différents sur une même tâche. Une amélioration observée lors d'une seule exécution ne constitue pas une preuve suffisante.

### Coût des expérimentations

Les benchmarks peuvent consommer davantage de ressources que les optimisations ne permettent d'en économiser. Des budgets maximums et des critères d'arrêt sont nécessaires.

### Compatibilité entre agents

Codex, Claude Code, Cursor et Gemini n'exposent pas nécessairement les mêmes traces, métriques ni mécanismes d'exécution automatisée.

### Sécurité

Les expériences ne doivent pas déclencher d'actions irréversibles sur des services de production, des bases de données, des comptes de paiement ou des secrets.

### Faux positifs

Les scanners statiques peuvent confondre références métier, alias, chemins générés et véritables fichiers manquants.

### Sur-optimisation

Une modification améliorant un benchmark particulier peut dégrader d'autres tâches ou rendre le dépôt plus difficile à maintenir pour les développeurs humains.

### Pérennité

Les agents IA évoluent rapidement. Une optimisation utile pour une version de modèle peut perdre son intérêt après une mise à jour.

## 9. Critères de validation du concept

La poursuite du projet dépendra de plusieurs résultats observables :

- Le scanner produit des diagnostics plus fiables que les alertes brutes, sur des cas vérifiables.
- Au moins une optimisation peut être appliquée et annulée de manière sûre.
- Le benchmark permet de distinguer une amélioration d'une variation aléatoire raisonnablement.
- La qualité des résultats n'est pas dégradée.
- Le coût et la complexité des expériences restent acceptables.
- Des utilisateurs identifient une valeur supplémentaire par rapport aux outils existants.

Un résultat négatif est également utile : il peut démontrer que certaines recommandations de readiness n'améliorent pas les performances réelles.

## 10. Questions ouvertes pour les experts

**Architecture et analyse statique**

1. Quelles propriétés d'un dépôt influencent réellement la capacité d'un agent à le comprendre ?
2. Quels scanners existants pourraient être réutilisés plutôt que redéveloppés ?
3. Comment distinguer les références obsolètes des alias, identifiants métier et chemins relatifs ?

**Agents IA et mesure**

4. Peut-on collecter de façon fiable les tokens et traces de Codex, Cursor, Claude Code et Gemini ?
5. Comment garantir des comparaisons équitables entre deux versions d'un dépôt ?
6. Combien de répétitions sont nécessaires pour produire un résultat exploitable ?
7. Quels indicateurs doivent primer : tokens, taux de réussite, durée ou interventions humaines ?

**Optimisation**

8. Quelles modifications simples ont le meilleur potentiel de gain ?
9. Comment éviter qu'une optimisation des instructions augmente le contexte inutilement ?
10. Peut-on apprendre des résultats d'expériences précédentes pour recommander des optimisations sur d'autres dépôts ?

**Produit et marché**

11. Existe-t-il déjà une solution couvrant toute la boucle diagnostic → modification → expérimentation → décision ?
12. Quelle valeur supplémentaire justifierait l'adoption de RepoTwin ?
13. Faut-il cibler les développeurs individuels, les équipes d'ingénierie ou les organisations utilisant massivement des agents ?
14. Le modèle pertinent est-il un outil open source, une CLI commerciale, une application locale ou un service SaaS ?
15. Les gains potentiels sont-ils suffisants pour compenser le coût des expériences ?

## 11. Positionnement proposé

**RepoTwin — Measure before you optimize.**

*An experimental optimization platform for AI coding agents and Git repositories.*

RepoTwin n'a pas vocation à remplacer les agents de développement ni les outils existants de préparation des dépôts.

Il cherche à établir un lien mesurable entre les caractéristiques d'un repository, les modifications qui lui sont apportées et les performances réelles des agents qui y travaillent.

**La promesse à valider :** ne plus se contenter de supposer qu'un dépôt est mieux préparé pour l'IA, mais disposer de preuves permettant de décider quelles optimisations méritent d'être conservées.

---

## 12. Décision attendue à l'issue de la revue

Cette RFC doit permettre de décider :

- **Go :** développer un prototype limité sur NiceHub si la différenciation technique paraît crédible.
- **Pivot :** réduire le périmètre à un moteur de mesure ou de diagnostic si la boucle complète est trop coûteuse.
- **No-go :** abandonner le développement spécifique si les solutions existantes couvrent déjà suffisamment le besoin.

**Statut actuel : discussion ouverte. Aucune faisabilité, originalité commerciale ou économie de tokens n'est encore démontrée.**

