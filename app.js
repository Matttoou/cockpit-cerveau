// Cockpit Cerveau : lit le dépôt GitHub privé (ou la copie Mac en mode local) et affiche. Ne modifie jamais rien.
const L = window.Logic, $ = (s) => document.querySelector(s);
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const BASE = LOCAL ? "/api" : "https://api.github.com";
const REPO = "repos/Matttoou/cerveau";
const CLE = "cockpit-cerveau-jeton";
let D = null; // données chargées

const jeton = () => { try { return localStorage.getItem(CLE) || ""; } catch { return ""; } };
const oublier = () => { try { localStorage.removeItem(CLE); } catch {} };

async function get(chemin, brut) {
  const h = { Accept: brut ? "application/vnd.github.raw+json" : "application/vnd.github+json" };
  if (!LOCAL) h.Authorization = `Bearer ${jeton()}`;
  const r = await fetch(`${BASE}/${chemin}`, { headers: h, cache: "no-store" });
  if (r.status === 401 || r.status === 403 || r.status === 404) throw Object.assign(new Error("acces"), { status: r.status });
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
  return brut ? r.text() : r.json();
}

const fichier = (p) => get(`${REPO}/contents/${p.split("/").map(encodeURIComponent).join("/")}`, true);

async function charger() {
  const [arbre, commits] = await Promise.all([get(`${REPO}/git/trees/main?recursive=1`), get(`${REPO}/commits?per_page=60`)]);
  const chemins = arbre.tree.filter((x) => x.type === "blob").map((x) => x.path);
  const md = (re) => chemins.filter((p) => re.test(p)).sort();
  const fiches = md(/^(projets|sujets|archive\/fiches)\/[^/]+\.md$/);
  const rapport = md(/^journal\/rapport-\d{4}-\d{2}-\d{2}\.md$/).pop();
  const journal = md(/^journal\/\d{4}-\d{2}\.md$/).pop();
  const bases = ["profil.md", "preferences.md", "decisions.md", "a-clarifier.md", "pour-assistants.md"];
  const tous = [...bases, ...fiches, rapport, journal].filter(Boolean);
  const textes = Object.fromEntries(await Promise.all(tous.map(async (p) => [p, await fichier(p)])));
  return {
    lu: new Date(), commits, textes,
    inbox: md(/^inbox\/.+\.md$/).filter((p) => !p.endsWith("README.md")),
    rapport: rapport && { date: rapport.match(/\d{4}-\d{2}-\d{2}/)[0], texte: textes[rapport] },
    journal: journal ? textes[journal] : "",
    fiches: fiches.map((p) => ({ nom: p.split("/").pop().slice(0, -3), dossier: p.split("/")[0], chemin: p, ...L.entete(textes[p]) })),
  };
}

// ---------- rendu ----------
const ETATS = { ok: "Fonctionne", info: "Info", warn: "À surveiller", err: "Problème" };
const jour = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const court = (iso) => L.esc(iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");
const connues = () => new Set([...D.fiches.map((f) => f.nom), "profil", "preferences", "decisions", "a-clarifier"]);
const puce = (n) => `<a class="chip" href="#fiche/${encodeURIComponent(n)}">${L.esc(n)}</a>`;
const pl = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const copier = (texte) => `<button class="copier" data-texte="${L.esc(texte)}" aria-label="Copier">Copier</button>`;

const questions = () => L.arbitrages(D.rapport, D.textes["a-clarifier.md"], new Date());
const sansLiens = (t) => t.replace(/\[\[([^\]]+)\]\]/g, "$1");

function vueAujourdhui() {
  const s = L.sante({ ...D, decisions: D.textes["decisions.md"], pourAssistants: D.textes["pour-assistants.md"] }, new Date());
  const g = L.etatGlobal(s), nAlerte = s.filter((x) => x.etat === "warn" || x.etat === "err").length;
  const q = questions();
  const banniere = { ok: "Tout fonctionne", info: "Tout fonctionne", warn: `${pl(nAlerte, "point")} à surveiller`, err: "Un problème demande ton attention" }[g];
  return `
    <section class="banniere etat-${g}" role="status"><div class="pastille"></div><div><strong>${banniere}</strong>
      <span>${L.esc(LOCAL ? "Copie Mac" : "GitHub")} · lu à ${D.lu.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div></section>
    <a class="carte action" href="#traiter"><div><strong>${q.actifs.length ? `${pl(q.actifs.length, "arbitrage")} en attente` : "Aucun arbitrage en attente"}</strong>
      <span>${pl(q.historiques.length, "question")} historique${q.historiques.length > 1 ? "s" : ""} en réserve</span></div><span class="fleche">›</span></a>
    <h2>État du système</h2>
    <ul class="liste">${s.map((x) => `<li class="sante etat-${x.etat}"><div class="pastille" title="${ETATS[x.etat]}"></div><div>
      <strong>${L.esc(x.titre)}</strong> <em class="etiquette">${ETATS[x.etat]}</em><span>${L.enLigne(x.resume)}</span>
      ${x.detail ? `<small>${L.enLigne(x.detail)}</small>` : ""}</div></li>`).join("")}</ul>
    ${D.rapport ? `<h2>Rapport du ${court(D.rapport.date)}</h2><details class="carte doc" ${D.rapport.date === L.parisDate(new Date()) ? "open" : ""}>
      <summary>${L.esc(jour(D.rapport.date))}</summary>${L.md(D.rapport.texte, connues())}</details>` : ""}`;
}

function vueTraiter() {
  const q = questions();
  const age = (d) => Math.round((new Date() - new Date(d + "T12:00:00")) / 864e5);
  return `
    <p class="intro">Pour trancher, réponds à Hermès : il intégrera ta décision la nuit suivante. Le cockpit ne modifie rien.</p>
    <h2>Arbitrages actifs <span class="compte">${q.actifs.length}</span></h2>
    ${q.actifs.length ? `<ul class="liste">${q.actifs.map((x) => `<li class="question actif"><div>
      ${x.nouveau ? '<span class="nouveau">Nouveau</span> ' : ""}${L.enLigne(x.texte, connues())}
      ${x.aussi ? `<small>Aussi dans les questions ouvertes depuis le ${court(x.aussi.date)}</small>` : ""}</div>${copier(sansLiens(x.texte))}</li>`).join("")}</ul>
      <button class="bouton" data-copier-tout="${L.esc(L.pourChatGPT(q.actifs.map((x) => sansLiens(x.texte))))}">Copier les arbitrages pour ChatGPT</button>
      <p class="intro">Mis en avant par le rapport du ${court(D.rapport.date)}.</p>`
    : `<p class="intro">${q.recent ? "Le dernier rapport ne demande rien." : "Pas de rapport depuis 2 jours : rien n'est mis en avant."}</p>`}
    <details class="replie historique"><summary>Questions historiques <span class="compte">${q.historiques.length}</span></summary>
      <p class="intro">Contradictions et points ouverts notés par Hermès dans a-clarifier, à trancher quand tu as le temps.</p>
      <ul class="liste">${q.historiques.map((x) => `<li class="question"><div>${L.enLigne(x.texte, connues())}
        <small>Ouverte depuis ${pl(age(x.date), "jour")} · ${L.esc(x.source)}</small></div>${copier(sansLiens(x.texte))}</li>`).join("")}</ul>
      ${q.historiques.length ? `<button class="bouton secondaire" data-copier-tout="${L.esc(L.pourChatGPT(q.historiques.map((x) => sansLiens(x.texte))))}">Copier ces questions pour ChatGPT</button>` : ""}
    </details>`;
}

const ICONES = { digestion: ["◉", "Digestion Hermès"], hermes: ["◎", "Hermès"], inbox: ["↑", "Dépôt Mac"], manuel: ["✎", "Modification manuelle"] };

function vueEvolution() {
  const dec = L.ouvertes(D.textes["decisions.md"]).filter((x) => x.tag === "Décision").slice(0, 8);
  const actifs = D.fiches.filter((f) => f.meta.niveau === "actif").sort((a, b) => (b.meta.maj || "").localeCompare(a.meta.maj || ""));
  const enCours = D.fiches.filter((f) => f.meta.niveau === "reference" && f.meta.statut === "en cours");
  const semaine = D.commits.filter((c) => new Date() - new Date(c.commit.author.date) < 7 * 864e5);
  const parJour = {};
  for (const c of semaine) (parJour[L.parisDate(new Date(c.commit.author.date))] ||= []).push(c);
  const journal = L.puces(D.journal).slice(-8).reverse();
  const fiche = (f) => `<li><a class="ligne-fiche" href="#fiche/${encodeURIComponent(f.nom)}"><strong>${L.esc(f.nom)}</strong>
    <span>${L.esc(f.meta.resume || "")}</span><small>${L.esc(f.meta.statut || f.dossier)} · màj ${court(f.meta.maj)}</small></a></li>`;
  return `
    <h2>Décisions récentes</h2>
    <ul class="liste">${dec.map((x) => `<li class="decision"><time>${court(x.date)}</time><div>${L.enLigne(x.texte, connues())}</div></li>`).join("")}</ul>
    <h2>Mémoire active <span class="compte">${actifs.length}</span></h2><ul class="liste">${actifs.map(fiche).join("")}</ul>
    ${enCours.length ? `<details class="replie"><summary>Autres projets en cours (${enCours.length})</summary><ul class="liste">${enCours.map(fiche).join("")}</ul></details>` : ""}
    <h2>Activité sur 7 jours</h2>
    ${Object.entries(parJour).map(([j, cs]) => `<h3>${L.esc(jour(j))}</h3><ul class="liste activite">${cs.map((c) => {
      const [ic, nom] = ICONES[L.typeCommit(c)];
      return `<li><span class="icone" title="${nom}" aria-label="${nom}">${ic}</span><div>${L.esc(c.commit.message.split("\n")[0])}
        <small>${new Date(c.commit.author.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${L.esc(c.commit.author.name)}</small></div></li>`;
    }).join("")}</ul>`).join("") || "<p class='intro'>Aucune activité cette semaine.</p>"}
    ${journal.length ? `<h2>Journal de digestion</h2><ul class="liste journal">${journal.map((x) => `<li>${L.enLigne(x.brut, connues())}</li>`).join("")}</ul>` : ""}`;
}

function docs() {
  const bases = ["profil", "preferences", "decisions", "a-clarifier"].map((n) => ({ nom: n, dossier: "racine", texte: D.textes[n + ".md"] }));
  return [...bases, ...D.fiches.map((f) => ({ nom: f.nom, dossier: f.dossier, texte: D.textes[f.chemin] }))];
}

function vueMemoire(q = "") {
  const groupes = [["actif", "Mémoire active"], ["reference", "Référence"], ["archive", "Archives"]];
  const niveau = (f) => f.meta.niveau || (f.dossier === "archive" ? "archive" : "reference");
  return `
    <input id="recherche" type="search" placeholder="Chercher dans le cerveau…" value="${L.esc(q)}" autocomplete="off" aria-label="Chercher">
    <div id="resultats">${resultats(q)}</div>
    <div id="toutes" ${q ? "hidden" : ""}>
      <h2>Toujours utiles</h2><div class="chips">${["profil", "preferences", "decisions", "a-clarifier"].map(puce).join("")}</div>
      ${groupes.map(([k, t]) => { const fs = D.fiches.filter((f) => niveau(f) === k);
        return fs.length ? `<h2>${t} <span class="compte">${fs.length}</span></h2><div class="chips">${fs.map((f) => puce(f.nom)).join("")}</div>` : ""; }).join("")}
    </div>`;
}

function resultats(q) {
  if (!q.trim()) return "";
  const r = L.cherche(docs(), q);
  if (!r.length) return `<p class="intro">Rien trouvé pour « ${L.esc(q)} ».</p>`;
  return `<ul class="liste">${r.slice(0, 20).map((x) => `<li><a class="ligne-fiche" href="#fiche/${encodeURIComponent(x.nom)}"><strong>${L.esc(x.nom)}</strong>
    ${x.extraits.map((e) => { const l = L.ligne(e); return `<span>${l.tag && !l.barre ? `<span class="tag tag-${l.tag === "Décision" ? "Decision" : l.tag}">${l.tag}</span> ` : ""}${L.enLigne(l.texte, null)}${l.date ? ` <small>${court(l.date)}</small>` : ""}</span>`; }).join("")}</a></li>`).join("")}</ul>`;
}

function vueFiche(nom) {
  const d = docs().find((x) => x.nom === nom);
  if (!d) return `<p class="intro">Fiche introuvable : ${L.esc(nom)}.</p>`;
  const meta = (D.fiches.find((f) => f.nom === nom) || { meta: {} }).meta;
  return `<button class="retour" data-retour>‹ Retour</button>
    <div class="chips">${["niveau", "statut", "maj"].filter((k) => meta[k]).map((k) => `<span class="chip neutre">${L.esc(k === "maj" ? "màj " + court(meta[k]) : meta[k])}</span>`).join("")}</div>
    <article class="carte doc">${L.md(d.texte, connues())}</article>`;
}

// ---------- navigation ----------
const ONGLETS = { aujourdhui: ["Aujourd'hui", vueAujourdhui], traiter: ["À traiter", vueTraiter], evolution: ["Évolution", vueEvolution], memoire: ["Mémoire", vueMemoire] };
let precedente = "aujourdhui";

function afficher() {
  if (!D) return;
  const [vue, arg] = decodeURIComponent(location.hash.slice(1)).split("/");
  const onglet = ONGLETS[vue] ? vue : vue === "fiche" ? "memoire" : "aujourdhui";
  if (vue !== "fiche") precedente = onglet;
  $("#titre").textContent = vue === "fiche" ? arg : ONGLETS[onglet][0];
  $("#vue").innerHTML = vue === "fiche" ? vueFiche(arg) : ONGLETS[onglet][1]();
  document.querySelectorAll("nav a").forEach((a) => a.setAttribute("aria-current", a.hash === "#" + onglet ? "page" : "false"));
  window.scrollTo(0, 0);
}

function toast(t) { const e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(() => (e.hidden = true), 2200); }

async function copierTexte(t) {
  try { await navigator.clipboard.writeText(t); toast("Copié"); } catch { prompt("Copie ce texte :", t); }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-texte],[data-copier-tout],[data-retour],#rafraichir,#deconnexion");
  if (!b) return;
  if (b.dataset.texte) copierTexte(b.dataset.texte);
  else if (b.dataset.copierTout) copierTexte(b.dataset.copierTout).then(() => toast("Copié · colle-le dans ChatGPT"));
  else if (b.hasAttribute("data-retour")) history.length > 1 ? history.back() : (location.hash = precedente);
  else if (b.id === "rafraichir") demarrer();
  else if (b.id === "deconnexion" && confirm("Oublier le jeton sur cet appareil ?")) { oublier(); location.reload(); }
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "recherche") return;
  $("#resultats").innerHTML = resultats(e.target.value);
  $("#toutes").hidden = !!e.target.value.trim();
});

window.addEventListener("hashchange", afficher);

function ecranJeton(message) {
  $("nav").hidden = true;
  $("#titre").textContent = "Connexion";
  $("#vue").innerHTML = `<form id="connexion" class="carte doc">
    <p>Le cockpit lit Cerveau directement sur GitHub avec un jeton <strong>en lecture seule</strong>, gardé uniquement sur cet appareil.</p>
    ${message ? `<p class="erreur">${L.esc(message)}</p>` : ""}
    <label for="jeton">Jeton GitHub</label><input id="jeton" type="password" autocomplete="off" required placeholder="github_pat_…">
    <button class="bouton" type="submit">Ouvrir le cockpit</button>
    <p class="intro">Créer le jeton : <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>,
    dépôt <em>Matttoou/cerveau</em> seulement, permission <em>Contents : Read-only</em>.</p></form>`;
  $("#connexion").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#jeton").value.trim();
    if (!/^github_pat_\w{20,}$/.test(v)) return ecranJeton("Ce n'est pas un jeton « fine-grained » (il commence par github_pat_). Les jetons classiques donnent trop de droits.");
    try { localStorage.setItem(CLE, v); } catch {}
    demarrer();
  };
}

async function demarrer() {
  if (!LOCAL && !jeton()) return ecranJeton();
  $("#chargement").hidden = false;
  try {
    D = await charger();
    $("nav").hidden = false;
    afficher();
  } catch (e) {
    if (e.status && !LOCAL) { oublier(); ecranJeton("Jeton refusé par GitHub (expiré, ou sans accès en lecture à Matttoou/cerveau)."); }
    else $("#vue").innerHTML = `<p class="erreur">Lecture impossible : ${L.esc(e.message)}. Vérifie la connexion puis touche ↻.</p>`;
  } finally { $("#chargement").hidden = true; }
}

$("#deconnexion").hidden = LOCAL;
if (window.top !== window.self) document.body.textContent = ""; // jamais affiché dans le cadre d'un autre site
else demarrer();
