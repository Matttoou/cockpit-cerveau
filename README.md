# Cockpit Cerveau

Tableau de bord, sur iPhone et sur Mac, qui sert à superviser Cerveau : état du système, éléments à arbitrer, ce qui évolue, recherche dans la mémoire.

## Principes
- **Lecture seule par construction.** Le cockpit lit le dépôt GitHub privé `Matttoou/cerveau` avec un jeton qui n'a que la permission *Contents : Read-only*. Il ne peut techniquement rien écrire : Hermès reste le seul à écrire.
- **Aucune duplication.** Le cockpit ne contient et ne stocke aucune donnée. À chaque ouverture, il relit Cerveau en direct.
- **Pas de serveur, pas de coût, pas de dépendance.** C'est une page statique (HTML, CSS, JS sans bibliothèque). Le jeton reste dans le navigateur de l'appareil et n'est envoyé qu'à `api.github.com`, ce que la politique de sécurité de la page (CSP) impose.

## Ce que montre chaque onglet
| Onglet | Contenu | Source dans Cerveau |
|---|---|---|
| **Aujourd'hui** | Bandeau d'état global ; une ligne par contrôle : digestion Hermès, rapport du matin, boîte de dépôt, export pour ChatGPT et Claude, fiches actives sans nouvelles depuis plus de 3 mois, blocages signalés par Hermès ; puis le rapport du jour | commits, `inbox/`, `journal/rapport-*.md`, `decisions.md`, `pour-assistants.md`, en-têtes des fiches |
| **À traiter** | **Arbitrages actifs** : ce que le dernier rapport (2 jours au plus) met en avant, dédupliqué (une question déjà dans `a-clarifier.md` n'apparaît qu'une fois, avec sa date d'ouverture ; renvois et constats retirés). **Questions historiques**, repliées : le reste de `a-clarifier.md`, de la plus récente à la plus ancienne. Boutons Copier, et copie groupée pour en parler avec ChatGPT | `journal/rapport-*.md`, `a-clarifier.md` |
| **Évolution** | 8 dernières décisions, mémoire active, autres projets en cours, activité des 7 derniers jours (digestions, dépôts du Mac, modifications manuelles), dernières lignes du journal | `decisions.md`, en-têtes, commits, `journal/AAAA-MM.md` |
| **Mémoire** | Recherche plein texte, sans tenir compte des accents ; lecture des fiches, avec liens `[[…]]` cliquables, étiquettes colorées et provenance atténuée | toutes les fiches |

### Règles des voyants
- **Digestion** : vert si Hermès a publié depuis moins de 26 h, orange de 26 à 50 h, rouge au-delà.
- **Rapport du matin** : vert si le rapport du jour (heure de Paris) existe. Sinon gris, car Hermès reste silencieux quand la nuit n'a rien apporté. L'envoi Telegram lui-même ne se voit pas depuis le dépôt.
- **Boîte de dépôt** : orange au-delà de 6 fichiers, ou si un dépôt a plus de 30 h (il a manqué une digestion).
- **Export** : orange si `pour-assistants.md` date de plus de 2,5 jours ou s'il ne contient pas la dernière décision. C'est le même contrôle que le rapport du matin.
- **Signalé par Hermès** : chaque ligne des sections « Bloqué » ou « État technique » du dernier rapport.

## Accès
### Sur le Mac, sans jeton (mode local)
`python3 ~/cockpit-cerveau/serve.py`, puis ouvrir http://localhost:8765. Ce mode lit la copie `~/Cerveau` (dernier commit), qui peut avoir jusqu'à 3 h de retard sur GitHub. Le serveur n'écoute que sur la machine (127.0.0.1) et ne sert que les fichiers suivis par Git.

### Sur l'iPhone et partout ailleurs (mode GitHub)
1. **Héberger la page.** Elle ne contient aucune donnée personnelle. Recommandé : un dépôt public `Matttoou/cockpit-cerveau` avec GitHub Pages (gratuit), ce qui donne l'adresse `https://matttoou.github.io/cockpit-cerveau/`.
2. **Créer le jeton** (une fois par an) : github.com → Settings → Developer settings → Fine-grained tokens → *Generate new token*.
   - Repository access : *Only select repositories* → `Matttoou/cerveau`.
   - Permissions : *Contents : Read-only* (*Metadata : Read-only* est ajoutée d'office). Rien d'autre.
   - Expiration : 1 an maximum.
3. **Sur l'iPhone** : ouvrir l'adresse dans Safari, Partager → *Sur l'écran d'accueil*, puis ouvrir le cockpit **depuis l'icône** et y coller le jeton. L'app de l'écran d'accueil a son propre stockage, séparé de Safari, et iOS ne l'efface pas après 7 jours d'inutilisation comme il le fait pour les sites ouverts dans Safari.
4. **Révoquer** : bouton ⏻ du cockpit (oublie le jeton sur l'appareil), ou suppression du jeton sur GitHub (coupe l'accès partout).

## Sécurité
- Le jeton ne donne que la lecture de Cerveau. S'il fuyait, le risque serait la lecture de Cerveau, rien d'autre. On le révoque en un clic sur GitHub.
- Tout le texte venant de Cerveau est échappé avant affichage, même s'il contient du HTML. Un test le vérifie, et un faux dépôt piégé a été essayé.
- La CSP n'autorise que les scripts de la page et les appels à `api.github.com`. La page n'envoie pas de référent et demande à ne pas être indexée.
- Seuls les jetons *fine-grained* (`github_pat_…`) sont acceptés ; les jetons classiques, aux droits trop larges, sont refusés.
- La page refuse de s'afficher dans le cadre d'un autre site (protection contre le détournement de clic).
- Le jeton est gardé dans le stockage local du navigateur, propre au domaine `matttoou.github.io`. Ce domaine ne sert que ce cockpit : n'y publier aucun autre site GitHub Pages, car il pourrait lire le jeton.
- Aucune donnée de Cerveau n'est enregistrée sur l'appareil : elle reste en mémoire le temps de l'affichage.

## Développement
- `logic.js` : logique pure (lecture des lignes `[Tag] … — date · source`, voyants, rendu Markdown sûr, recherche). Tests : `node --test test_logic.mjs`.
- `app.js` : chargement (1 appel pour l'arborescence, 1 pour les commits, environ 35 fichiers lus) et affichage.
- `serve.py` : mode local. Il imite les 3 appels GitHub à partir de `~/Cerveau`. `CERVEAU_REPO=/autre/clone` permet de tester sur un autre dépôt.
- Le format du rapport du matin a changé le 21/10 : `questionsRapport` lit l'ancien format (« Interventions qui restent », « Prochaines actions ») et le nouveau (« Questions à arbitrer »).

## Limites de la V1
- L'état réel des tâches Hermès (dernier passage ok ou en erreur) et la remise Telegram ne sont pas dans le dépôt : le cockpit les déduit des commits et du rapport. Évolution possible, à valider : `cerveau.py publie` écrirait un petit `etat.json` (statut des tâches « Cerveau »), que le cockpit afficherait.
- Un blocage signalé par le rapport reste affiché jusqu'au rapport suivant, même s'il a été corrigé entre-temps.
- Pas de mode hors ligne : il faut du réseau pour lire GitHub.
