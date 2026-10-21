// Logique pure du cockpit : lecture des fichiers de Cerveau et calcul de l'état. Aucune écriture, aucun réseau.
(function (root) {
  const H = 3600e3;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const parisDate = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(d);
  const parisHeure = (d) => +new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).format(d);

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
    return { brut, barre, tag, texte, date, source: suite.replace(/^.*?\d{4}-\d{2}-\d{2}\s*·?\s*/, ""), liens };
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

  const PIRE = { err: 3, warn: 2, info: 1, ok: 0 };

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
    for (const b of d.rapport ? blocagesRapport(d.rapport.texte) : [])
      out.push({ id: "blocage", titre: "Signalé par Hermès", etat: "warn", resume: b, detail: `D'après le rapport du ${d.rapport.date.split("-").reverse().join("/")}.` });

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

    return out.sort((a, b) => PIRE[b.etat] - PIRE[a.etat]);
  }

  const etatGlobal = (s) => s.reduce((p, x) => (PIRE[x.etat] > PIRE[p] ? x.etat : p), "ok");

  // Markdown minimal et sûr : tout est échappé avant la mise en forme.
  function enLigne(t, connues) {
    return esc(t)
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
    dateInbox, typeCommit, proche, arbitrages, sante, etatGlobal, md, enLigne, cherche, pourChatGPT, sansAccent };
  if (typeof module !== "undefined") module.exports = api;
  else root.Logic = api;
})(this);
