// Logique pure du cockpit : lecture des fichiers de Cerveau et calcul de l'état. Aucune écriture, aucun réseau.
(function (root) {
  const H = 3600e3;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const parisDate = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(d);
  const parisHeure = (d) => +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(d); // fr-FR écrit « 10 h »

  function depuis(date, now) {
    const h = (now - date) / H;
    if (h < 1) return `il y a ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 36) return `il y a ${Math.round(h)} h`;
    return `il y a ${Math.round(h / 24)} j`;
  }

  // En-tête YAML simple « clé: valeur », comme cerveau.py.
  function entete(texte) {
    const meta = {};
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(texte);
    if (!m) return { meta, corps: texte };
    for (const l of m[1].split("\n")) {
      const i = l.indexOf(":");
      if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).replace(/\s+#.*$/, "").trim();
    }
    return { meta, corps: texte.slice(m[0].length) };
  }

  // « - [Tag] Texte [[lien]]. — 2026-10-20 · source »
  function ligne(l) {
    const brut = l.replace(/^\s*-\s+/, "");
    const barre = brut.startsWith("~~");
    const tag = (/\[(Dit|Décision|IA|Source)\]/.exec(brut) || [])[1] || "";
    const i = brut.lastIndexOf(" — ");
    const texte = (i > 0 ? brut.slice(0, i) : brut).replace(/^\[(Dit|Décision|IA|Source)\]\s*/, "");
    const suite = i > 0 ? brut.slice(i + 3) : "";
    const date = (/\d{4}-\d{2}-\d{2}/.exec(suite) || [])[0] || "";
    const liens = [...brut.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]);
    const maj = (suite.match(/\d{4}-\d{2}-\d{2}/g) || []).sort().pop() || ""; // « 2026-10-05 · notion ; 2026-10-07 · x » : la plus récente
    return { brut, barre, tag, texte, date, maj, source: suite.replace(/^.*?\d{4}-\d{2}-\d{2}\s*·?\s*/, ""), liens };
  }

  const puces = (texte) => texte.split("\n").filter((l) => /^- /.test(l)).map(ligne);
  const ouvertes = (texte) => puces(texte).filter((x) => !x.barre);

  function sections(md) {
    const out = [];
    let cur = { titre: "", niveau: 0, lignes: [] };
    for (const l of md.split("\n")) {
      const h = /^(#{1,4})\s+(.*)/.exec(l);
      if (h) out.push((cur = { titre: h[2].trim(), niveau: h[1].length, lignes: [] }));
      else cur.lignes.push(l);
    }
    return out;
  }

  const lignesDe = (md, re) =>
    sections(md).filter((s) => re.test(s.titre)).flatMap((s) => s.lignes.filter((l) => /^\s*(-|\d+\.)\s+/.test(l)).map((l) => l.replace(/^\s*(-|\d+\.)\s+/, "").trim()));

  // Le rapport a changé de format le 21/10 : on lit l'ancien et le nouveau.
  const questionsRapport = (md) => lignesDe(md, /questions à arbitrer|interventions qui restent|prochaines actions/i);
  const blocagesRapport = (md) => lignesDe(md, /bloqu|état technique/i).filter((l) => !/^ok\b/i.test(l));

  // inbox/2026-01-02-assistant-abcd1234-1767312000.md : horodatage Unix en fin de nom s'il existe.
  function dateInbox(chemin) {
    const nom = chemin.split("/").pop();
    const ts = /-(\d{10})\.md$/.exec(nom);
    if (ts) return new Date(+ts[1] * 1000);
    const d = /^(\d{4}-\d{2}-\d{2})/.exec(nom);
    return d ? new Date(d[1] + "T12:00:00") : null;
  }

  function typeCommit(c) {
    const auteur = c.commit.author.name, msg = c.commit.message;
    if (auteur === "Hermès") return /^digestion/.test(msg) ? "digestion" : "hermes";
    if (/^inbox:/.test(msg)) return "inbox";
    return "manuel";
  }

  // Mots porteurs de sens d'une question, pour repérer les doublons entre rapport et a-clarifier.
  const VIDES = new Set("dans pour avec sans aussi depuis cette comme plus mais elle sont etre faire tout tous quel quelle encore".split(" "));
  const mots = (t) => new Set((sansAccent(t.replace(/^[A-ZÀ-Ý][a-zà-ÿ]+\s*:\s*/, "")).match(/[a-z0-9]{4,}/g) || []).map((m) => m.replace(/s$/, "")).filter((m) => !VIDES.has(m)));
  function proche(a, b) {
    const A = mots(a), B = mots(b), n = [...A].filter((m) => B.has(m)).length;
    return n >= 3 && n / Math.min(A.size, B.size) >= 0.5;
  }

  // Actifs : ce que le dernier rapport (2 jours au plus) met en avant, sans doublon.
  // Historiques : le reste de a-clarifier, du plus récent au plus ancien.
  function arbitrages(rapport, aClarifier, now) {
    const ouv = ouvertes(aClarifier), pris = new Set(), actifs = [];
    const recent = !!rapport && rapport.date >= parisDate(new Date(now - 2 * 864e5));
    for (const brut of rapport ? questionsRapport(rapport.texte) : []) {
      if (/\[\[a-clarifier\]\]/.test(brut)) continue; // simple renvoi vers la liste historique
      if (/^(aucun|aucune|rien)\b/i.test(brut)) continue; // constat, pas une action
      const texte = brut.replace(/^\(?nouveau\)?\s*[:·-]?\s*/i, "");
      if (actifs.some((x) => proche(x.texte, texte))) continue;
      const i = ouv.findIndex((o, j) => !pris.has(j) && proche(o.texte, texte));
      if (i >= 0) pris.add(i);
      actifs.push({ texte, nouveau: texte !== brut, aussi: i >= 0 ? ouv[i] : null });
    }
    const historiques = ouv.filter((_, j) => !pris.has(j)).sort((a, b) => b.date.localeCompare(a.date));
    return recent ? { actifs, historiques, recent } : { actifs: [], historiques: ouv.slice().sort((a, b) => b.date.localeCompare(a.date)), recent };
  }

  const titre = (corps) => ((/^#\s+(.+)/m.exec(corps) || [])[1] || "").trim();

  // shortcut: un point d'a-clarifier est un choix s'il porte sur un rôle, une règle ou une validité, sinon un fait à confirmer ;
  // à remplacer par une étiquette posée par Hermès si le classement se trompe trop souvent.
  const CHOIX = /quel rôle|rôles? (restant|respectif)|vise-t-|reste-t-(il|elle) valable|faut-il|doit-(il|elle)|garder|décider|moratoire/i;
  // Les actions techniques proposées par le rapport (Git, publication, tâches) vont aux agents, pas aux décisions.
  const TECHNIQUE = /\bgit\b|commit|stash|synchronis|publier le rapport|\bcron\b|inbox|jeton|\bskill\b|script/i;
  // L'étiquette posée par Hermès ([technique], [choix] ou [fait]) prime ; les mots-clés ne servent qu'en secours.
  const ETIQUETTE = /\[(technique|choix|fait)\]/i;
  const nature = (t) => (ETIQUETTE.exec(t) || [])[1]?.toLowerCase() || (TECHNIQUE.test(t) ? "technique" : CHOIX.test(t) ? "choix" : "fait");

  // Ce qui reste ouvert dans une fiche : vérifications, points ouverts, prérequis, idées.
  const PISTE = /à (re)?vérifier|à (re)?contrôler|à confirmer|à formaliser|à préciser|à structurer|à identifier|à venir|à reprendre|à trancher|points? ouverts?|restent ouverts|prérequis|prioritaire|^idée\b/i;

  // Synthèse d'un projet : état, évolutions, décisions, questions, pistes ; chaque ligne n'apparaît qu'une fois.
  function projet(f, decisions, aClarifier) {
    const lignes = puces(f.corps).filter((x) => x.tag && !x.barre);
    const bref = puces((sections(f.corps).find((s) => /en bref/i.test(s.titre)) || { lignes: [] }).lignes.join("\n")).filter((x) => x.tag && !x.barre);
    const vu = new Set(bref.map((x) => x.brut));
    const prend = (x) => !vu.has(x.brut) && vu.add(x.brut);
    const recentes = (a, b) => b.maj.localeCompare(a.maj);
    const decs = ouvertes(decisions).filter((x) => x.tag === "Décision" && x.liens.includes(f.nom));
    for (const x of lignes) if (x.tag === "Décision" && !decs.some((d) => proche(d.texte, x.texte))) decs.push(x);
    decs.forEach((x) => vu.add(x.brut));
    return {
      bref,
      evolutions: lignes.filter((x) => x.tag !== "Décision" && !vu.has(x.brut)).sort(recentes).slice(0, 4).filter(prend),
      decisions: decs.sort(recentes),
      questions: ouvertes(aClarifier).filter((x) => x.liens.includes(f.nom)),
      pistes: lignes.filter((x) => PISTE.test(x.texte)).filter(prend),
    };
  }

  // Ce qui est entré dans la mémoire depuis quelques jours (date de la ligne = date de l'information).
  function changements(fiches, decisions, aClarifier, now, jours = 3) {
    const depuis = parisDate(new Date(now - jours * 864e5));
    const neuf = (x) => !x.barre && x.maj >= depuis;
    return {
      depuis,
      decisions: ouvertes(decisions).filter((x) => x.tag === "Décision" && neuf(x)),
      questions: ouvertes(aClarifier).filter(neuf),
      fiches: fiches.map((f) => ({ nom: f.nom, lignes: puces(f.corps).filter((x) => x.tag && x.tag !== "Décision" && neuf(x)).sort((a, b) => b.maj.localeCompare(a.maj)) }))
        .filter((x) => x.lignes.length).sort((a, b) => b.lignes.length - a.lignes.length),
    };
  }

  // Dernières conversations lues par Hermès : « - 2026-10-20 · hermes 7e0573f6 : texte » (date parfois en plage « 2026-10-17/20 »).
  function lectures(journal, n = 12) {
    const l = journal.split("\n").map((x) => /^- (\d{4}-\d{2}-\d{2})\S*\s+·\s+(\S+)[^:]*:\s*(.+)/.exec(x)).filter(Boolean)
      .map((m) => ({ date: m[1], source: m[2], texte: m[3] })).slice(-n).reverse();
    const vide = (x) => /^rien de durable/i.test(x.texte);
    return { total: l.length, retenues: l.filter((x) => !vide(x)), ignorees: l.filter(vide).length };
  }

  const PIRE = { err: 3, warn: 2, info: 1, ok: 0 };
  const BASES = ["profil", "preferences", "decisions", "a-clarifier"];

  // Intégrité de la mémoire, à la manière d'un « doctor » : liens [[…]] sans fiche, noms en double, fiches actives sans « En bref ».
  // Niveau info : à signaler à Hermès, jamais une alerte en page d'accueil.
  function qualite(fiches, autres = {}) {
    const out = [], noms = new Set([...fiches.map((f) => f.nom), ...BASES]);
    const morts = new Map();
    for (const [nom, texte] of [...fiches.map((f) => [f.nom, f.corps]), ...Object.entries(autres)])
      for (const m of String(texte || "").matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
        const cible = m[1].trim();
        if (!noms.has(cible)) morts.set(cible, new Set([...(morts.get(cible) || []), nom]));
      }
    if (morts.size)
      out.push({ id: "liens", titre: "Liens sans fiche", etat: "info", resume: `${morts.size} lien(s) [[…]] vers une fiche inexistante`,
        detail: [...morts].map(([c, de]) => `${c} (dans ${[...de].join(", ")})`).join(" · ") });
    const vus = new Map();
    for (const f of fiches) vus.set(f.nom, [...(vus.get(f.nom) || []), f.dossier]);
    const doubles = [...vus].filter(([, d]) => d.length > 1);
    if (doubles.length)
      out.push({ id: "doublons", titre: "Fiches en double", etat: "info", resume: `${doubles.length} nom(s) de fiche utilisés deux fois`,
        detail: doubles.map(([n, d]) => `${n} (${d.join(", ")})`).join(" · ") });
    const sansBref = fiches.filter((f) => f.meta.niveau === "actif" && typeof f.corps === "string" && !sections(f.corps).some((s) => /en bref/i.test(s.titre)));
    if (sansBref.length)
      out.push({ id: "sansbref", titre: "Fiches sans « En bref »", etat: "info", resume: `${sansBref.length} fiche(s) actives sans synthèse`,
        detail: sansBref.map((f) => f.nom).join(", ") });
    return out;
  }

  // d = { commits, inbox: [chemins], rapport: {date, texte}|null, decisions, pourAssistants, fiches: [{nom, meta}] }
  function sante(d, now) {
    const out = [];
    const aujourdhui = parisDate(now);

    const dig = d.commits.find((c) => typeCommit(c) === "digestion");
    if (!dig) out.push({ id: "digestion", titre: "Digestion Hermès", etat: "err", resume: "Aucune publication trouvée" });
    else {
      const t = new Date(dig.commit.author.date), h = (now - t) / H;
      out.push({ id: "digestion", titre: "Digestion Hermès", etat: h < 26 ? "ok" : h < 50 ? "warn" : "err",
        resume: `Dernière publication ${depuis(t, now)}`, detail: dig.commit.message.split("\n")[0] });
    }

    if (d.rapport && d.rapport.date === aujourdhui) {
      const q = questionsRapport(d.rapport.texte).length;
      out.push({ id: "rapport", titre: "Rapport du matin", etat: "ok", resume: `Reçu ce matin · ${q} point${q > 1 ? "s" : ""} à voir`,
        detail: "L'envoi Telegram lui-même n'est pas visible depuis le dépôt." });
    } else {
      const der = d.rapport ? `dernier le ${d.rapport.date.split("-").reverse().join("/")}` : "aucun rapport trouvé";
      out.push({ id: "rapport", titre: "Rapport du matin", etat: "info",
        resume: parisHeure(now) < 7 ? `Prévu à 5 h 45 · ${der}` : `Pas de rapport aujourd'hui · ${der}`,
        detail: "Normal si la nuit n'a rien apporté : Hermès reste alors silencieux." });
    }
    // Une digestion publiée après le rapport (5 h 45) montre qu'Hermès a repris : le blocage est sans doute levé.
    const td = dig && new Date(dig.commit.author.date);
    const repris = d.rapport && td && (parisDate(td) > d.rapport.date || (parisDate(td) === d.rapport.date && parisHeure(td) >= 6));
    for (const b of d.rapport ? blocagesRapport(d.rapport.texte) : [])
      out.push({ id: "blocage", titre: "Signalé par Hermès", etat: repris ? "info" : "warn", resume: b,
        detail: repris ? `Rapport du ${d.rapport.date.split("-").reverse().join("/")} ; Hermès a publié depuis, sans doute résolu.` : `D'après le rapport du ${d.rapport.date.split("-").reverse().join("/")}.` });

    const ages = d.inbox.map(dateInbox).filter(Boolean);
    const vieux = ages.length ? Math.max(...ages.map((t) => (now - t) / H)) : 0;
    out.push({ id: "inbox", titre: "Boîte de dépôt", etat: d.inbox.length > 6 || vieux > 30 ? "warn" : "ok",
      resume: d.inbox.length ? `${d.inbox.length} en attente · le plus ancien ${depuis(now - vieux * H, now)}` : "Vide : tout est digéré",
      detail: d.inbox.length > 6 ? "Plus de 6 fichiers : retard de digestion." : vieux > 30 ? "Un dépôt a manqué la digestion de la nuit." : "Digérés la nuit prochaine." });

    const derniere = ouvertes(d.decisions)[0];
    const genere = (/Généré automatiquement le (\d{4}-\d{2}-\d{2})/.exec(d.pourAssistants) || [])[1];
    const coherent = !derniere || d.pourAssistants.includes(derniere.texte.slice(0, 60));
    const frais = genere && (now - new Date(genere + "T12:00:00")) / H < 60;
    out.push({ id: "export", titre: "Export pour ChatGPT et Claude", etat: coherent && frais ? "ok" : "warn",
      resume: genere ? `pour-assistants.md du ${genere.split("-").reverse().join("/")}` : "Date introuvable",
      detail: coherent ? "Contient la dernière décision." : "La dernière décision n'y figure pas encore." });

    const perimees = d.fiches.filter((f) => f.meta.niveau === "actif" && f.meta.maj && (now - new Date(f.meta.maj)) / H > 24 * 90);
    if (perimees.length)
      out.push({ id: "perimees", titre: "Fiches actives sans nouvelles", etat: "warn",
        resume: `${perimees.length} fiche(s) actives non mises à jour depuis 3 mois`, detail: perimees.map((f) => f.nom).join(", ") });

    out.push(...qualite(d.fiches, { decisions: d.decisions, "a-clarifier": d.aClarifier, profil: d.profil }));

    return out.sort((a, b) => PIRE[b.etat] - PIRE[a.etat]);
  }

  const etatGlobal = (s) => s.reduce((p, x) => (PIRE[x.etat] > PIRE[p] ? x.etat : p), "ok");

  // Markdown minimal et sûr : tout est échappé avant la mise en forme.
  function enLigne(t, connues) {
    return esc(t)
      .replace(/\s*\[(technique|choix|fait)\]\s*/gi, " ").trim() // l'étiquette range la question, elle ne s'affiche pas
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[(Dit|Décision|IA|Source)\]/g, (_, t) => `<span class="tag tag-${t === "Décision" ? "Decision" : t}">${t}</span>`)
      .replace(/\[\[([^\]|]+)\]\]/g, (_, n) => (connues && connues.has(n) ? `<a href="#fiche/${encodeURIComponent(n)}" class="lien">${n}</a>` : `<span class="lien mort">${n}</span>`));
  }

  function md(texte, connues) {
    const html = [];
    let liste = false;
    for (const l of entete(texte).corps.split("\n")) {
      const h = /^(#{1,4})\s+(.*)/.exec(l), p = /^\s*(?:-|\d+\.)\s+(.*)/.exec(l);
      if (!p && liste) { html.push("</ul>"); liste = false; }
      if (h) html.push(`<h${Math.min(+h[1].length + 1, 4)}>${enLigne(h[2], connues)}</h${Math.min(+h[1].length + 1, 4)}>`);
      else if (p) {
        if (!liste) { html.push("<ul>"); liste = true; }
        const i = p[1].lastIndexOf(" — "), prov = i > 0 && /\d{4}-\d{2}-\d{2}/.test(p[1].slice(i)); // provenance atténuée
        html.push(`<li>${enLigne(prov ? p[1].slice(0, i) : p[1], connues)}${prov ? ` <span class="prov">${esc(p[1].slice(i + 3))}</span>` : ""}</li>`);
      }
      else if (/^>\s?/.test(l)) html.push(`<p class="note">${enLigne(l.replace(/^>\s?/, ""), connues)}</p>`);
      else if (l.trim() && !/^```/.test(l)) html.push(`<p>${enLigne(l, connues)}</p>`);
    }
    if (liste) html.push("</ul>");
    return html.join("\n");
  }

  const sansAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function cherche(docs, q) {
    const mots = sansAccent(q).split(/\s+/).filter(Boolean);
    if (!mots.length) return [];
    const res = [];
    for (const doc of docs) {
      const lignes = doc.texte.split("\n").filter((l) => mots.every((m) => sansAccent(l).includes(m)));
      const dansNom = mots.every((m) => sansAccent(doc.nom).includes(m));
      if (lignes.length || dansNom) res.push({ nom: doc.nom, dossier: doc.dossier, extraits: lignes.slice(0, 3), score: lignes.length + (dansNom ? 10 : 0) });
    }
    return res.sort((a, b) => b.score - a.score);
  }

  // Questions à relire à l'oral avec ChatGPT, une par ligne.
  function pourChatGPT(questions) {
    return "Voici les questions ouvertes de mon cerveau (tenu par Hermès). Pose-les-moi une par une, aide-moi à trancher, " +
      "puis résume mes décisions en une liste courte à transmettre à Hermès.\n\n" + questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  }

  const api = { esc, parisDate, parisHeure, depuis, entete, ligne, puces, ouvertes, sections, questionsRapport, blocagesRapport,
    dateInbox, typeCommit, proche, arbitrages, titre, nature, projet, changements, lectures, qualite, sante, etatGlobal, md, enLigne, cherche, pourChatGPT, sansAccent };
  if (typeof module !== "undefined") module.exports = api;
  else root.Logic = api;
})(this);
