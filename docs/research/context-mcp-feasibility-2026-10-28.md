# Faisabilité : préparation du contexte par MCP

Date : 28 octobre 2026. Étude exploratoire ; aucun benchmark réel exécuté, aucune économie établie.

## Conclusion

Un MCP local de récupération ciblée peut réduire l’exploration répétitive et les sorties inutiles. Il ne contrôle pas l’historique global de l’IDE, ne peut pas retirer un message déjà traité et ne garantit pas une baisse proportionnelle de la consommation d’un abonnement. Le bénéfice doit être démontré contre un agent utilisant déjà efficacement recherche, cache et outils natifs.

## Mécanisme proposé

Un outil `prepare_task` reçoit une demande concise et un dépôt autorisé. Il retourne les points d’entrée probables, symboles, dépendances identifiées, contraintes sourcées, commandes de vérification connues et incertitudes. Un outil de lecture ciblée fournit des extraits exacts avec chemin, version/hash et plage. Les opérations de recherche indépendantes sont regroupées localement ; les résultats bruts restent consultables. Chaque troncature est déclarée.

Premier moteur : recherche lexicale, index de symboles et liens d’imports pour une seule pile TypeScript/JavaScript. Pas de promesse d’analyse universelle Flutter/backend ni d’inférence automatique des règles métier. Pas de résumé LLM obligatoire : ses appels déplaceraient une partie du coût. Traiter le contenu des dépôts comme des données non fiables.

Le cache doit être invalidé sur les contenus modifiés, y compris les changements non committés. Une mémoire de session ne garantit pas que l’agent dispose encore du texte après compaction : ne pas supprimer un extrait demandé sous prétexte qu’il a déjà été lu.

## Faisabilité et frontières

- Réalisable : recherche groupée, extraits par symboles, filtrage déterministe des logs, provenance, index incrémental.
- À vérifier : qualité de sélection, résolution des dépendances, adoption par l’agent, bénéfice au-delà des outils natifs.
- Hors contrôle d’un MCP seul : prompt initial déjà envoyé, historique agrégé par le client, raisonnement interne, cache fournisseur, décompte du forfait.
- Risque : contexte trop réduit, mauvaise sélection ou données obsolètes entraînant davantage de réparations.

## Estimation sans fausse précision

Si l’exploration représente une fraction E de la consommation totale, si l’outil en économise une fraction R, et si son surcoût net représente H du total initial, une approximation est G = E × R − H. Exemple purement hypothétique : E=40 %, R=50 %, H=5 % donne G=15 %. Une baisse de 50 % des sorties d’outils n’est donc pas une baisse de 50 % de la consommation totale.

## Protocole proposé

Pilote de 12 tâches sur trois dépôts (bugs, petites fonctionnalités, changements traversant plusieurs couches, tâches simples témoins). Comparer trois variantes : agent natif, agent avec carte statique concise, agent avec MCP. Trois répétitions donnent 108 exécutions ; ce plan représente un budget à approuver avant toute exécution payante.

Même modèle/version, réglages, demande, révision initiale et critères de réussite. Sessions indépendantes, ordre alterné/aléatoire, mêmes politiques de cache documentées, aucun contexte des solutions précédentes. Tests fonctionnels et revue indépendante du changement ; le build seul ne suffit pas. Comptabiliser échecs, retries et corrections, sans sélectionner seulement les réussites favorables.

Mesurer tokens d’entrée non cachés/cachés, sortie et raisonnement quand disponibles, coût fournisseur réel, durée, temps de revue, réussite et régressions. Inclure préparation et maintenance de l’index. Les mesures serveur (caractères renvoyés et nombre d’appels MCP) sont des métriques intermédiaires, pas les tokens totaux de l’agent. Les API donnent un environnement contrôlé mais ne prouvent pas l’effet sur chaque forfait IDE ; compléter par des essais clients lorsque leur télémétrie le permet.

Seuil de décision proposé, non résultat : viser au moins 20 % de réduction du coût total à réussite comparable pour justifier la maintenance. Examiner médiane, dispersion, cas défavorables et coûts amortis. Un petit pilote ne démontre pas statistiquement l’absence de régressions : poursuivre une validation sur tâches non utilisées pour ajuster le moteur avant communication commerciale.

## Positionnement dans les dépôts existants

Lecture ciblée du code actuel : RepoTwin comporte `src/analysis/context-waste.ts`, un comparateur de métriques et un adaptateur simulé. Les relectures et le seuil de nombre d’appels sont des signaux, pas des preuves de gaspillage : relecture après modification et recherche complexe peuvent être nécessaires. Les tailles d’instructions et les simulations ne valident pas une économie fournisseur.

Propago fournit déjà une lecture progressive de snapshots pour les portages, mais pas un moteur général de récupération du contexte d’une tâche. Démarrer une expérimentation isolée dans RepoTwin, sans modifier son parcours stable ni créer un troisième produit. Décider d’une extraction en moteur partagé avec Propago seulement après résultats.

## Sources primaires

- Architecture MCP (rôle de l’hôte dans l’agrégation du contexte) : https://modelcontextprotocol.io/specification/2025-06-18/architecture
- Anthropic, exécution de code et filtrage des résultats MCP : https://www.anthropic.com/research/code-execution-with-mcp
- Anthropic, découverte d’outils et orchestration programmatique : https://www.anthropic.com/research/advanced-tool-use
- Aider, carte de dépôt et symboles : https://aider.chat/docs/repomap.html

Ces sources établissent des techniques existantes ; elles ne constituent pas une mesure du futur outil ni une analyse exhaustive du marché.
