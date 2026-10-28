# RepoTwin : premières mesures reproductibles

Date : 28 octobre 2026. Deux niveaux de preuve : sorties MCP mesurées localement et quatre appels réels de diagnostic. Aucun gain de forfait ou coût monétaire établi.

## Résultat principal

Le mode compact **actuel** ne réduit pas la taille des réponses en échec dans les six cas testés : il ajoute le résumé et les données structurées à la sortie brute capturée. Cela protège les diagnostics disponibles, mais augmente le contexte. Ce résultat porte sur le code local corrigé (HEAD 5f88337 plus modifications non committées), dont les hashes figurent dans context-benchmark.json, pas sur le tag publié seul.

## Mesures locales

Le banc utilise le serveur MCP réel via transport en mémoire. Il exécute réellement node:test et TypeScript sur des projets temporaires synthétiques. Chaque mode est appelé ; pour éviter de confondre variation des timings avec variation du format, une réponse brute de référence est également reconstruite à partir du même résultat compact selon le format serveur actuel. Tableau : corps texte JSON complet retourné par MCP, métadonnées comprises, mais hors enveloppe JSON-RPC de transport. Référence = mode non compact de RepoTwin, **pas un terminal d’IDE**.

| Cas | Brut, octets UTF-8 | Compact actuel, octets UTF-8 | Variation |
|---|---:|---:|---:|
| success | 666 | 665 | -0.15 % |
| assertion | 2,685 | 2,972 | +10.69 % |
| multiline | 2,869 | 3,087 | +7.60 % |
| multiple-errors | 4,975 | 5,288 | +6.29 % |
| large-logs | 66,950 | 68,488 | +2.30 % |
| typescript-errors | 1,054 | 2,027 | +92.31 % |

Le caractère gagné sur une réussite provient du booléen JSON `true` contre `false`, pas d’une optimisation utile. Les fichiers JSON contiennent aussi les mesures en caractères et une approximation caractères/4 ; cette approximation n’est pas utilisée comme une consommation fournisseur.

Les sorties complètes conservent les sentinelles de diagnostic des cas non tronqués. Les résumés seuls perdent certaines informations node:test. Le cas de logs volumineux dépasse la capture de 64 Kio : l’erreur placée après le bruit peut manquer dans les deux modes. `outputTruncated` le signale ; ce cas ne valide pas la préservation complète des diagnostics.

## Micro-pilote avec usage réellement déclaré

Quatre sessions indépendantes `codex exec --json --ephemeral --ignore-user-config`, modèle demandé `gpt-6.1-sol`, raisonnement low, mode read-only, ordre brut/compact/compact/brut. Une seule fixture d’assertion (401 obtenu, 200 attendu). Même demande de diagnostic, aucune utilisation d’outil et aucune modification. La réponse MCP enregistrée est fournie dans le prompt : ce n’est pas une exécution MCP en direct par l’agent ni une tâche d’implémentation complète.

| Essai | Variante | Tokens entrée | Dont cache | Tokens sortie | Diagnostic |
|---|---|---:|---:|---:|---|
| 1 | raw | 15,056 | 0 | 192 | 401 obtenu / 200 attendu identifié |
| 2 | compact | 15,129 | 0 | 186 | 401 obtenu / 200 attendu identifié |
| 3 | compact | 15,129 | 0 | 175 | 401 obtenu / 200 attendu identifié |
| 4 | raw | 15,056 | 12,288 | 177 | 401 obtenu / 200 attendu identifié |

- Entrée : **+73 tokens** pour le mode compact dans les deux répétitions (+0,48 % du total d’entrée). Les instructions de base Codex représentent une partie importante de l’entrée ; ne pas interpréter ce pourcentage comme le seul poids du diagnostic.
- Total entrée + sortie : brut **30,481**, compact **30,619**, soit **+0.45 %** sur ces deux diagnostics par variante.
- Total des quatre appels : **61,100 tokens** d’entrée + sortie déclarés, dont 12 288 tokens d’entrée en cache. Le cache est un sous-ensemble de l’entrée, il n’est pas ajouté une seconde fois.
- Les quatre diagnostics sont corrects pour l’assertion fournie et ne prétendent pas savoir si le test ou le code métier doit changer. Vérification manuelle des réponses et contrôle des sentinelles numériques/fichier. Aucune réussite d’implémentation n’est revendiquée.
- Un seul essai brut bénéficie du cache : les conditions de coût ne sont pas équilibrées. Aucune conversion en euros/dollars ni en autonomie d’abonnement.
- Deux répétitions sur un seul cas ne fournissent pas une estimation représentative ou un intervalle de confiance commercial.

## Décision

Ne pas annoncer d’économie de tokens pour le mode actuel. Ne pas lancer une campagne coûteuse d’implémentation pour mesurer un gain de taille déjà absent dans ces cas.

La prochaine variante à évaluer serait un résumé avec accès aux logs par identifiant et lecture paginée, tout en préservant les erreurs non reconnues. Elle n’est pas implémentée ni mesurée ici. Une campagne ultérieure devra inclure l’exploration, les modifications, tous les appels de logs et les corrections, puis comparer qualité et coût total avec un agent natif utilisant correctement ses limites de sortie.

## Reproduire

Mesures locales (sans appel IA) :

```sh
node --import tsx scripts/context-benchmark.mjs
```

Micro-pilote (consomme le compte Codex connecté, quatre appels maximum, aucune reprise automatique) :

```sh
python3 scripts/context-agent-pilot.py docs/benchmarks/assertion-raw-matched-mcp.json docs/benchmarks/assertion-compact-mcp.json /chemin/nouveau-dossier-resultats
```

Node 22+ pour RepoTwin, Codex CLI authentifié et modèle accessible requis. Le dossier de sortie du pilote doit être nouveau. Les sorties et timings peuvent varier. Les fichiers `.input.txt`, `.jsonl` et `results.json` du premier pilote sont conservés dans `agent-pilot-2026-10-28/`.

Source des champs d’usage : https://learn.chatgpt.com/docs/non-interactive-mode . Ces relevés sont les compteurs déclarés par Codex, pas une facture API.

La mesure locale a été relancée pour documenter les diagnostics manquants sur logs tronqués. La paire d’assertion du micro-pilote initial a été conservée séparément ; ses hashes d’entrée figurent dans les résultats du pilote. Les timings des sorties locales ultérieures peuvent différer.
