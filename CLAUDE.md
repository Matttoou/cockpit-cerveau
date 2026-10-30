# Cockpit Cerveau

Page statique (HTML, CSS, JS sans bibliothèque) qui lit le dépôt `Matttoou/cerveau` en lecture seule. Voir `README.md`.

## Propre à ce projet
- Lecture seule par construction : le cockpit n'écrit jamais dans Cerveau. Hermès est le seul à écrire.
- Aucune dépendance, aucun serveur, aucune donnée stockée hors du jeton. Toute nouvelle dépendance se discute avant.
- La logique pure va dans `logic.js`, testée dans `test_logic.mjs` avec des données fictives ; l'affichage va dans `app.js`.
- Tout texte venant de Cerveau passe par `esc` ou `enLigne` avant affichage.
- Tests : `node --test test_logic.mjs`. Essai sur de fausses données : `CERVEAU_REPO=/chemin/faux-clone python3 serve.py`.
- Mettre à jour le README quand un voyant ou une règle de classement change.

# Règles de code

## Avant de coder
- Lis le code existant et réutilise ses fonctions, conventions et dépendances avant d'en ajouter. Une nouvelle dépendance se justifie en une phrase.
- Si la tâche touche plus de 3 fichiers ou implique un choix difficile à défaire, propose un plan court avant d'écrire.
- Choisis la solution la plus simple qui marche. Pas d'abstraction ni d'option « pour plus tard ».

## En écrivant
- Valide les données à chaque frontière : saisie, réponse d'API, fichier lu. Ne fais jamais confiance aux données externes.
- Ne masque jamais une erreur : gère-la, ou laisse-la remonter avec un message utile. Dans l'interface, le message dit ce qui s'est passé et quoi faire.
- Distingue « vide » et « lecture échouée » : n'affiche jamais un état vide quand la donnée n'a pas pu être lue.
- Préfère les retours anticipés à l'imbrication. Nomme les seuils, délais et limites dans des constantes.
- Garde des fonctions courtes et des fichiers cohérents. Au-delà d'environ 400 lignes, demande-toi s'il faut découper (repère, pas règle).
- Aucun secret dans le code ni dans les commits. Pas d'innerHTML avec des données non échappées.
- Ne modifie jamais une config de lint, de format ou de test, ni un test, pour faire passer un échec : corrige le code. Si le test est faux, dis-le explicitement.

## Tests
- Toute logique non triviale (calcul, dates, classement, parsing) a un test. Le nom du test décrit le comportement attendu.
- Pour un bug : d'abord un test qui le reproduit, puis la correction.
- Pas d'objectif de couverture chiffré.

## Avant de dire « terminé »
- Lance les tests et vérifications du projet, et rapporte le résultat réel, échecs compris.
- Relis ton diff en cherchant ce qui casserait : debug oublié, cas limites, erreurs non gérées.
- Commits au format `type: description` (feat, fix, refactor, docs, test, chore).

## Passage de relais
- Si la session est longue ou interrompue, écris un point d'étape : objectif, ce qui marche (avec la preuve), ce qui a échoué, ce qui reste, prochaine action.
- Fin d'une session qui fusionne des changements : déposer dans `Matttoou/cerveau` un fichier neuf `inbox/AAAA-MM-JJ-claude-code-<id>.md` qui résume ce qui a changé et pourquoi, les décisions de Matthias (`[Décision]`), les propositions (`[IA]`) et le point d'arrêt. Jamais de modification des fiches : Hermès digère. Les sessions dans le cloud ne sont pas captées par `sync-mac.py`.
