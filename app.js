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
  const tous = [...bases.filter((p) => chemins.includes(p)), ...fiches, rapport, journal].filter(Boolean);
  const textes = Object.fromEntries(bases.map((p) => [p, ""])); // une fiche de base absente ne bloque pas le cockpit
  Object.assign(textes, Object.fromEntries(await Promise.all(tous.map(async (p) => [p, await fichier(p)]))));
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
const MAINTENANT = () => new Date();
const jour = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const court = (iso) => L.esc(iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");
const ilya = (iso) => { const j = Math.round((MAINTENANT() - new Date(iso + "T12:00:00")) / 864e5); return j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`; };
const connues = () => new Set([...D.fiches.map((f) => f.nom), "profil", "preferences", "decisions", "a-clarifier"]);
const pl = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const copier = (texte, label = "Copier") => `<button class="copier" data-texte="${L.esc(texte)}" aria-label="${label}">${label}</button>`;
const sansLiens = (t) => t.replace(/\[\[([^\]]+)\]\]/g, "$1");
const sansLiensVisibles = (t) => t.replace(/(\s*\[\[[^\]]+\]\])+\s*$/, ""); // les liens de fin deviennent des puces à part
const fiche = (nom) => D.fiches.find((f) => f.nom === nom);
const nomDe = (nom) => (fiche(nom) && L.titre(fiche(nom).corps)) || nom;
const puce = (n, cls = "") => `<a class="chip ${cls}" href="#fiche/${encodeURIComponent(n)}">${L.esc(nomDe(n))}</a>`;
const puces = (noms) => noms.filter((n) => fiche(n)).map((n) => puce(n, "petite")).join("");
const tag = (t) => (t ? `<span class="tag tag-${t === "Décision" ? "Decision" : t}">${t}</span> ` : "");

// Questions du rapport et d'a-clarifier rangées par nature, sans doublon : choix, faits à confirmer, actions techniques.
function aTrancher() {
  const q = L.arbitrages(D.rapport, D.textes["a-clarifier.md"], MAINTENANT());
  const rapport = q.actifs.map((x) => {
    const texte = x.aussi ? x.aussi.texte : x.texte.replace(/^Matthias\s*:\s*/i, ""); // a-clarifier garde les deux versions et leurs sources
    return { ...x, texte, liens: L.ligne(texte).liens, date: x.aussi?.date, rapport: true };
  });
  const tous = [...rapport, ...q.historiques], de = (n) => tous.filter((x) => L.nature(x.texte) === n);
  return { choix: de("choix"), faits: de("fait"), technique: de("technique") };
}

function sante() {
  const s = L.sante({ ...D, decisions: D.textes["decisions.md"], pourAssistants: D.textes["pour-assistants.md"],
    aClarifier: D.textes["a-clarifier.md"], profil: D.textes["profil.md"] }, MAINTENANT());
  return { s, global: L.etatGlobal(s), alertes: s.filter((x) => x.etat === "warn" || x.etat === "err") };
}

const question = (x, avecAge) => `<li class="question${x.rapport ? " actif" : ""}"><div>
  ${x.nouveau ? '<span class="nouveau">Nouveau</span> ' : ""}${L.enLigne(sansLiensVisibles(x.texte), connues())}
  <small>${x.rapport ? `${x.aussi ? "Rappelée" : "Posée"} par Hermès dans le rapport du ${court(D.rapport.date)}` : ""}${x.rapport && x.date ? " · " : ""}${x.date && avecAge ? `ouverte ${ilya(x.date)}` : ""}</small>
  ${x.liens?.length ? `<div class="chips">${puces(x.liens)}</div>` : ""}</div>${copier(sansLiens(x.texte))}</li>`;

function vueAujourdhui() {
  const { global, alertes } = sante(), t = aTrancher(), now = MAINTENANT();
  const ch = L.changements(D.fiches, D.textes["decisions.md"], D.textes["a-clarifier.md"], now);
  const actifs = D.fiches.filter((f) => f.meta.niveau === "actif" && f.dossier === "projets").sort((a, b) => (b.meta.maj || "").localeCompare(a.meta.maj || ""));
  const attention = [];
  if (alertes.length) attention.push(`<a class="alerte etat-${global}" href="#agents"><div class="pastille"></div><div><strong>${L.esc(alertes[0].titre)}</strong><span class="deux-lignes">${L.enLigne(alertes[0].resume)}</span>
    <span>${alertes.length > 1 ? `et ${pl(alertes.length - 1, "autre point")} technique${alertes.length > 2 ? "s" : ""} · ` : ""}voir les agents</span></div><span class="fleche">›</span></a>`);
  if (t.choix.length) attention.push(`<a class="carte action" href="#decisions"><div><em class="sur">${pl(t.choix.length, "décision")} à prendre</em>
    <strong>${L.enLigne(sansLiensVisibles(t.choix[0].texte))}</strong>${t.choix.length > 1 ? `<span class="deux-lignes">puis : ${L.enLigne(sansLiensVisibles(t.choix[1].texte))}</span>` : ""}</div><span class="fleche">›</span></a>`);
  if (t.faits.length) attention.push(`<a class="carte action" href="#decisions/faits"><div><em class="sur">${pl(t.faits.length, "fait")} à confirmer</em>
    <strong>Réponses courtes attendues par Hermès</strong><span>${t.faits.slice(0, 3).map((x) => L.esc(sansLiens(x.texte).split(/[:?(]/)[0].trim())).join(" · ")}</span></div><span class="fleche">›</span></a>`);
  return `
    <p class="date-jour">${L.esc(jour(L.parisDate(now)))}</p>
    <p class="resume-jour">${resumeJour(global, alertes, t)}</p>
    <div class="grille-jour"><div>
      <h2>À ton attention</h2>
      ${attention.join("") || `<p class="carte vide">Rien ne t'attend. Cerveau tourne seul.</p>`}
      <h2>Ce qui a changé <span class="discret">depuis le ${court(ch.depuis)}</span></h2>
      ${changementsHtml(ch)}
    </div><div>
      <h2>Projets en mouvement</h2>
      <div class="projets-mini">${actifs.map(carteProjet).join("")}</div>
      <a class="lien-suite" href="#projets">Tous les projets ›</a>
      ${D.rapport ? `<h2>Dernier rapport d'Hermès</h2><details class="carte doc"><summary>${L.esc(jour(D.rapport.date))}${D.rapport.date === L.parisDate(now) ? " · ce matin" : ""}</summary>${L.md(D.rapport.texte, connues())}</details>` : ""}
    </div></div>`;
}

function resumeJour(global, alertes, t) {
  const morceaux = [];
  if (t.choix.length) morceaux.push(`${pl(t.choix.length, "décision")} t'attend${t.choix.length > 1 ? "ent" : ""}`);
  if (alertes.length) morceaux.push(global === "err" ? "un problème technique est à regarder" : "un point technique demande un coup d'œil");
  if (!morceaux.length) return "Tout est à jour. Rien ne demande ton attention.";
  return L.esc(morceaux.join(", et ") + ".").replace(/^./, (c) => c.toUpperCase());
}

function changementsHtml(ch) {
  const blocs = [];
  if (ch.decisions.length) blocs.push(`<li><span class="icone-ch dec" aria-hidden="true">✓</span><div><strong>${pl(ch.decisions.length, "décision")} enregistrée${ch.decisions.length > 1 ? "s" : ""}</strong>
    ${ch.decisions.slice(0, 2).map((x) => `<span>${L.enLigne(sansLiensVisibles(x.texte))}</span>`).join("")}
    ${ch.decisions.length > 2 ? `<a class="lien-suite" href="#decisions/prises">Voir les ${ch.decisions.length} ›</a>` : ""}</div></li>`);
  for (const f of ch.fiches.slice(0, 3))
    blocs.push(`<li><a class="ligne-fiche" href="#fiche/${encodeURIComponent(f.nom)}"><span class="icone-ch" aria-hidden="true">+</span><div><strong>${L.esc(nomDe(f.nom))} <span class="compte">${f.lignes.length}</span></strong>
      <span>${L.enLigne(sansLiensVisibles(f.lignes[0].texte))}</span></div></a></li>`);
  if (ch.fiches.length > 3) blocs.push(`<li class="discret-li">Aussi : ${ch.fiches.slice(3).map((f) => puce(f.nom, "petite")).join(" ")}</li>`);
  if (ch.questions.length) blocs.push(`<li><a class="ligne-fiche" href="#decisions"><span class="icone-ch q" aria-hidden="true">?</span><div><strong>${ch.questions.length} nouvelle${ch.questions.length > 1 ? "s" : ""} question${ch.questions.length > 1 ? "s" : ""}</strong>
    <span>Hermès a relevé des contradictions à trancher</span></div></a></li>`);
  return blocs.length ? `<ul class="liste changements">${blocs.join("")}</ul>` : `<p class="carte vide">Rien de nouveau dans la mémoire depuis le ${court(ch.depuis)}.</p>`;
}

function carteProjet(f) {
  const p = L.projet(f, D.textes["decisions.md"], D.textes["a-clarifier.md"]), der = p.evolutions[0];
  const statut = f.meta.statut || (f.dossier === "sujets" ? "sujet" : "");
  return `<a class="carte projet" href="#fiche/${encodeURIComponent(f.nom)}">
    <div class="haut"><strong>${L.esc(nomDe(f.nom))}</strong>${statut ? `<span class="statut s-${L.esc(statut.replace(/\s/g, "-"))}">${L.esc(statut)}</span>` : ""}</div>
    <p>${L.esc(f.meta.resume || "")}</p>
    ${der ? `<p class="dernier"><time>${court(der.maj)}</time> ${L.enLigne(sansLiensVisibles(der.texte))}</p>` : ""}
    <div class="compteurs">${p.questions.length ? `<span class="c-q">${pl(p.questions.length, "question")}</span>` : ""}${p.pistes.length ? `<span>${pl(p.pistes.length, "point")} ouvert${p.pistes.length > 1 ? "s" : ""}</span>` : ""}${p.decisions.length ? `<span>${pl(p.decisions.length, "décision")}</span>` : ""}<span class="maj">màj ${L.esc(ilya(f.meta.maj || ""))}</span></div></a>`;
}

function vueDecisions(ancre) {
  const t = aTrancher();
  const prises = L.ouvertes(D.textes["decisions.md"]).filter((x) => x.tag === "Décision").slice(0, 12);
  setTimeout(() => ancre && document.getElementById(ancre)?.scrollIntoView({ block: "start" }));
  return `
    <p class="intro">Réponds à Hermès sur Telegram ou WhatsApp : il intègre ta réponse la nuit suivante. Le cockpit ne modifie rien.</p>
    <h2 id="choix">À décider <span class="compte">${t.choix.length}</span></h2>
    <p class="intro">Des choix que toi seul peux faire : rôles, règles, orientation d'un projet.</p>
    ${t.choix.length ? `<ul class="liste">${t.choix.map((x) => question(x, true)).join("")}</ul>
      <button class="bouton" data-copier-tout="${L.esc(L.pourChatGPT(t.choix.map((x) => sansLiens(x.texte))))}">Préparer ces décisions avec ChatGPT</button>`
    : `<p class="carte vide">Aucune décision en attente.</p>`}
    <h2 id="faits">À confirmer <span class="compte">${t.faits.length}</span></h2>
    <p class="intro">Deux versions d'un même fait se contredisent dans la mémoire. Une réponse courte suffit.</p>
    ${t.faits.length ? `<ul class="liste">${t.faits.map((x) => question(x, true)).join("")}</ul>
      <button class="bouton secondaire" data-copier-tout="${L.esc(L.pourChatGPT(t.faits.map((x) => sansLiens(x.texte))))}">Copier pour ChatGPT</button>` : `<p class="carte vide">Rien à confirmer.</p>`}
    <h2 id="prises">Décisions prises</h2>
    <ul class="liste">${prises.map((x) => `<li class="decision"><time>${court(x.date)}</time><div>${L.enLigne(sansLiensVisibles(x.texte), connues())}
      ${x.liens.length ? `<div class="chips">${puces(x.liens)}</div>` : ""}</div></li>`).join("")}</ul>
    <a class="lien-suite" href="#fiche/decisions">Tout le journal des décisions ›</a>`;
}

// Groupes tirés de la section « En cours » de profil.md, tenue par Hermès.
function groupes() {
  const sec = L.sections(D.textes["profil.md"]).find((s) => /en cours/i.test(s.titre));
  const out = (sec ? sec.lignes : []).map((l) => /^([^:[]+?)\s*:\s*(.*\[\[.*)/.exec(l)).filter(Boolean)
    .map((m) => ({ titre: m[1].trim(), noms: [...m[2].matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]).filter((n) => fiche(n)) }));
  const pris = new Set(out.flatMap((g) => g.noms));
  const reste = D.fiches.filter((f) => !pris.has(f.nom) && f.dossier !== "archive").map((f) => f.nom);
  if (reste.length) out.push({ titre: "Autres", noms: reste });
  return out;
}

function vueProjets() {
  const ordre = { "en cours": 0, "idée": 1, "en pause": 2 };
  const tri = (a, b) => (ordre[fiche(a).meta.statut] ?? 3) - (ordre[fiche(b).meta.statut] ?? 3) || (fiche(b).meta.maj || "").localeCompare(fiche(a).meta.maj || "");
  const archives = D.fiches.filter((f) => f.dossier === "archive");
  return groupes().map((g) => `<h2>${L.esc(g.titre)} <span class="compte">${g.noms.length}</span></h2>
    <div class="projets">${g.noms.sort(tri).map((n) => carteProjet(fiche(n))).join("")}</div>`).join("") +
    (archives.length ? `<details class="replie"><summary>Archives (${archives.length})</summary><div class="chips">${archives.map((f) => puce(f.nom)).join("")}</div></details>` : "");
}

const li = (x) => `<li>${tag(x.tag)}${L.enLigne(sansLiensVisibles(x.texte), connues())}${x.maj ? ` <small class="quand">${court(x.maj)}</small>` : ""}</li>`;
const bloc = (titre, xs, vide) => `<section class="bloc"><h3>${titre}${xs.length ? ` <span class="compte">${xs.length}</span>` : ""}</h3>${xs.length ? `<ul class="points">${xs.map(li).join("")}</ul>` : `<p class="discret">${vide}</p>`}</section>`;

function vueFiche(nom) {
  const f = fiche(nom);
  if (!f) {
    const texte = D.textes[nom + ".md"];
    if (!texte) return `<p class="intro">Fiche introuvable : ${L.esc(nom)}.</p>`;
    return `<button class="retour" data-retour>‹ Retour</button><article class="carte doc">${L.md(texte, connues())}</article>`;
  }
  const p = L.projet(f, D.textes["decisions.md"], D.textes["a-clarifier.md"]);
  const lies = [...new Set(L.puces(f.corps).flatMap((x) => x.liens))].filter((n) => n !== nom && fiche(n));
  const m = f.meta;
  return `<button class="retour" data-retour>‹ Retour</button>
    <section class="tete-projet">
      <div class="chips">${m.statut ? `<span class="statut s-${L.esc(m.statut.replace(/\s/g, "-"))}">${L.esc(m.statut)}</span>` : ""}<span class="chip neutre">${L.esc({ actif: "mémoire active", reference: "référence", archive: "archive" }[m.niveau] || f.dossier)}</span>${m.maj ? `<span class="chip neutre">màj ${L.esc(ilya(m.maj))}</span>` : ""}</div>
      <p class="resume">${L.esc(m.resume || "")}</p>
    </section>
    <div class="grille-projet">
      ${bloc("Où on en est", p.bref, "Pas de synthèse dans la fiche.")}
      ${bloc("Dernières évolutions", p.evolutions, "Aucune information datée.")}
      ${bloc("Décisions prises", p.decisions, "Aucune décision enregistrée pour ce projet.")}
      <section class="bloc${p.questions.length ? " attention" : ""}"><h3>À clarifier${p.questions.length ? ` <span class="compte">${p.questions.length}</span>` : ""}</h3>
        ${p.questions.length ? `<ul class="points">${p.questions.map((x) => `<li>${L.enLigne(sansLiensVisibles(x.texte), connues())} ${copier(sansLiens(x.texte))}</li>`).join("")}</ul>` : `<p class="discret">Rien de bloquant signalé par Hermès.</p>`}</section>
      ${bloc("Points ouverts et prochaines étapes", p.pistes, "Aucun point ouvert relevé dans la fiche.")}
    </div>
    ${lies.length ? `<h2>Liés</h2><div class="chips">${lies.map((n) => puce(n)).join("")}</div>` : ""}
    <details class="carte doc fiche-complete"><summary>Fiche complète</summary>${L.md(f.corps, connues())}</details>`;
}

const ICONES = { digestion: ["◉", "Digestion Hermès"], hermes: ["◎", "Hermès"], inbox: ["↑", "Dépôt Mac"], manuel: ["✎", "Modification manuelle"] };
const pire = (xs) => { const e = L.etatGlobal(xs.length ? xs : [{ etat: "ok" }]); return e === "info" ? "ok" : e; }; // une info n'est pas un problème

function vueAgents() {
  const { s } = sante(), par = (...ids) => s.filter((x) => ids.includes(x.id));
  const now = MAINTENANT(), lus = L.lectures(D.journal);
  const cc = D.inbox.filter((p) => /claude-code/.test(p)), depot = D.commits.find((c) => L.typeCommit(c) === "inbox");
  const heure = (c) => new Date(c.commit.author.date).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const agent = (nom, role, items, lignes) => `<article class="carte agent etat-${pire(items)}"><div class="haut"><div class="pastille"></div><div><strong>${nom}</strong><span>${role}</span></div>
    <em class="etiquette">${ETATS[pire(items)]}</em></div><ul class="faits">${lignes.join("")}</ul></article>`;
  const fait = (x) => `<li class="etat-${x.etat}"><span>${L.esc(x.titre)}</span><b>${L.enLigne(x.resume)}</b>${x.detail && x.etat !== "ok" ? `<small>${L.enLigne(x.detail)}</small>` : ""}</li>`;
  const semaine = D.commits.filter((c) => now - new Date(c.commit.author.date) < 7 * 864e5);
  const parJour = {};
  for (const c of semaine) (parJour[L.parisDate(new Date(c.commit.author.date))] ||= []).push(c);
  return `
    <div class="agents">
      ${agent("Hermès", "Gère la mémoire · digère chaque nuit vers 3 h 30 · rapport à 5 h 45", par("digestion", "rapport", "blocage", "inbox"),
        [...par("digestion", "rapport", "inbox").map(fait), ...s.filter((x) => x.id === "blocage" && x.etat !== "info").map(fait),
         ...(s.some((x) => x.id === "blocage" && x.etat === "info") ? [`<li class="etat-info"><details><summary>${pl(s.filter((x) => x.id === "blocage" && x.etat === "info").length, "signalement")} du rapport, sans doute résolu${s.filter((x) => x.id === "blocage" && x.etat === "info").length > 1 ? "s" : ""}</summary>
           <ul class="faits">${s.filter((x) => x.id === "blocage" && x.etat === "info").map((x) => `<li class="etat-info"><b>${L.enLigne(x.resume)}</b></li>`).join("")}</ul></details></li>`] : [])])}
      ${agent("Claude Code", "Développe sur le Mac · dépose ses conversations toutes les 3 h", [], [
        `<li class="etat-ok"><span>Dernier dépôt</span><b>${depot ? L.esc(heure(depot)) : "aucun récemment"}</b></li>`,
        `<li class="etat-${cc.length ? "info" : "ok"}"><span>En attente de digestion</span><b>${cc.length ? pl(cc.length, "conversation") : "aucune"}</b></li>`])}
      ${agent("ChatGPT et Claude", "Lisent l'export de la mémoire · tu leur parles, Hermès retient", par("export"), par("export").map(fait))}
    </div>
    ${aTrancher().technique.length ? `<h2>Actions techniques demandées par Hermès</h2><ul class="liste">${aTrancher().technique.map((x) => `<li class="question actif"><div>${L.enLigne(x.texte, connues())}
      <small>Rapport du ${court(D.rapport.date)}${par("blocage").some((b) => b.etat === "info") ? " · Hermès a publié depuis : vérifier si c'est encore utile" : ""}</small></div>${copier(x.texte)}</li>`).join("")}</ul>` : ""}
    ${par("perimees", "liens", "doublons", "sansbref").length ? `<h2>Qualité de la mémoire</h2><ul class="liste">${par("perimees", "liens", "doublons", "sansbref").map((x) => `<li class="sante etat-${x.etat}"><div class="pastille"></div><div><strong>${L.esc(x.resume)}</strong><small>${L.esc(x.detail)}</small></div></li>`).join("")}</ul>` : ""}
    <h2>Ce qu'Hermès a retenu récemment</h2>
    <p class="intro">Sur les ${lus.total} dernières conversations lues, ${lus.retenues.length} ${lus.retenues.length > 1 ? "ont" : "a"} apporté quelque chose ; ${lus.ignorees} n'avaient rien de durable.</p>
    <ul class="liste">${lus.retenues.map((x) => `<li><div>${L.enLigne(x.texte, connues())}<small>${court(x.date)} · ${L.esc(x.source)}</small></div></li>`).join("")}</ul>
    <details class="replie"><summary>Activité technique sur 7 jours (${semaine.length})</summary>
    ${Object.entries(parJour).map(([j, cs]) => `<h3>${L.esc(jour(j))}</h3><ul class="liste activite">${cs.map((c) => {
      const [ic, nom] = ICONES[L.typeCommit(c)];
      return `<li><span class="icone" title="${nom}" aria-label="${nom}">${ic}</span><div>${L.esc(c.commit.message.split("\n")[0])}
        <small>${new Date(c.commit.author.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${L.esc(c.commit.author.name)}</small></div></li>`;
    }).join("")}</ul>`).join("") || "<p class='intro'>Aucune activité cette semaine.</p>"}</details>`;
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
      <h2>Toujours utiles</h2><div class="chips">${["profil", "preferences", "decisions", "a-clarifier"].map((n) => `<a class="chip" href="#fiche/${n}">${n}</a>`).join("")}</div>
      ${groupes.map(([k, t]) => { const fs = D.fiches.filter((f) => niveau(f) === k);
        return fs.length ? `<h2>${t} <span class="compte">${fs.length}</span></h2><div class="chips">${fs.map((f) => puce(f.nom)).join("")}</div>` : ""; }).join("")}
    </div>`;
}

function resultats(q) {
  if (!q.trim()) return "";
  const r = L.cherche(docs(), q);
  if (!r.length) return `<p class="intro">Rien trouvé pour « ${L.esc(q)} ».</p>`;
  return `<ul class="liste">${r.slice(0, 20).map((x) => `<li><a class="ligne-fiche" href="#fiche/${encodeURIComponent(x.nom)}"><strong>${L.esc(nomDe(x.nom))}</strong>
    ${x.extraits.map((e) => { const l = L.ligne(e); return `<span>${l.tag && !l.barre ? tag(l.tag) : ""}${L.enLigne(l.texte, null)}${l.date ? ` <small>${court(l.date)}</small>` : ""}</span>`; }).join("")}</a></li>`).join("")}</ul>`;
}

// ---------- navigation ----------
const ONGLETS = { aujourdhui: ["Aujourd'hui", vueAujourdhui], decisions: ["Décisions", vueDecisions], projets: ["Projets", vueProjets], agents: ["Agents", vueAgents], memoire: ["Mémoire", vueMemoire] };
const ANCIENS = { traiter: "decisions", evolution: "projets" }; // adresses de la V1
let precedente = "aujourdhui";

function afficher() {
  if (!D) return;
  let [vue, arg] = decodeURIComponent(location.hash.slice(1)).split("/");
  vue = ANCIENS[vue] || vue;
  const onglet = ONGLETS[vue] ? vue : vue === "fiche" ? (fiche(arg) ? "projets" : "memoire") : "aujourdhui";
  if (vue !== "fiche") precedente = onglet;
  $("#titre").textContent = vue === "fiche" ? nomDe(arg) : ONGLETS[onglet][0];
  $("#vue").innerHTML = vue === "fiche" ? vueFiche(arg) : ONGLETS[onglet][1](arg);
  document.querySelectorAll("nav a").forEach((a) => a.setAttribute("aria-current", a.hash === "#" + onglet ? "page" : "false"));
  const { global } = sante(), n = aTrancher().choix.length;
  $("#badge-decisions").hidden = !n; $("#badge-decisions").textContent = n;
  $("#etat-agents").hidden = global === "ok" || global === "info"; $("#etat-agents").className = `point-etat etat-${global}`;
  $("#lu").textContent = `${LOCAL ? "Copie Mac" : "GitHub"} · lu à ${D.lu.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  if (!arg || vue === "fiche") window.scrollTo(0, 0);
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
    // Seul un 401 prouve que le jeton est mort (expiré ou révoqué) ; un 403 ou 404 peut être passager, on garde le jeton.
    if (e.status === 401 && !LOCAL) { oublier(); ecranJeton("Jeton refusé par GitHub (expiré ou révoqué)."); }
    else if (e.status && !LOCAL) $("#vue").innerHTML = `<p class="erreur">GitHub refuse la lecture (${e.status}). Touche ↻ dans un moment ; si ça dure, ⏻ pour changer de jeton.</p>`;
    else $("#vue").innerHTML = `<p class="erreur">Lecture impossible : ${L.esc(e.message)}. Vérifie la connexion puis touche ↻.</p>`;
  } finally { $("#chargement").hidden = true; }
}

$("#deconnexion").hidden = LOCAL;
if (window.top !== window.self) document.body.textContent = ""; // jamais affiché dans le cadre d'un autre site
else demarrer();
