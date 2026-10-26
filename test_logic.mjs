// node --test test_logic.mjs — données entièrement fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const L = createRequire(import.meta.url)("./logic.js");

const NOW = new Date("2026-01-15T16:00:00Z");
const commit = (name, date, message) => ({ commit: { author: { name, date }, message } });

test("ligne : étiquette, texte, date, liens, barré", () => {
  const x = L.ligne("- [Décision] Le jardin passe au compost. [[jardin]] — 2026-01-10 · chat ab12cd34");
  assert.equal(x.tag, "Décision");
  assert.equal(x.texte, "Le jardin passe au compost. [[jardin]]");
  assert.equal(x.date, "2026-01-10");
  assert.equal(x.source, "chat ab12cd34");
  assert.deepEqual(x.liens, ["jardin"]);
  assert.equal(L.ligne("- ~~[IA] vieux~~ Résolu").barre, true);
});

test("ouvertes ignore les lignes barrées et le texte libre", () => {
  const t = "# Titre\n> note\n- [IA] Q1 ? — 2026-01-07 · x\n- ~~[IA] Q2~~ Résolu — 2026-01-10 · y\n- [IA] Q3 ? — 2026-01-10 · z";
  assert.deepEqual(L.ouvertes(t).map((x) => x.texte), ["Q1 ?", "Q3 ?"]);
});

test("entete lit le YAML et retire les commentaires", () => {
  const { meta, corps } = L.entete("---\nniveau: actif        # actif | reference\nmaj: 2026-01-10\n---\n# Titre");
  assert.deepEqual(meta, { niveau: "actif", maj: "2026-01-10" });
  assert.equal(corps, "# Titre");
});

test("rapport : questions (ancien et nouveau format) et blocages", () => {
  const ancien = "## A. Interventions qui restent\n1. Arroser.\n2. Tailler.\n### Bloqué ou en retard\n- outil absent\n### Prochaines actions\n- Choisir la haie.";
  assert.deepEqual(L.questionsRapport(ancien), ["Arroser.", "Tailler.", "Choisir la haie."]);
  assert.deepEqual(L.blocagesRapport(ancien), ["outil absent"]);
  const nouveau = "## Questions à arbitrer\n- (nouveau) Garder la haie ?\n## État technique\n- ok";
  assert.deepEqual(L.questionsRapport(nouveau), ["(nouveau) Garder la haie ?"]);
  assert.deepEqual(L.blocagesRapport(nouveau), []);
});

test("parisHeure : heure de Paris en nombre", () => {
  assert.equal(L.parisHeure(new Date("2026-01-15T09:00:00Z")), 10);
  assert.equal(L.parisHeure(new Date("2026-07-15T23:30:00Z")), 1);
});

test("dateInbox : horodatage Unix sinon date du nom", () => {
  assert.equal(L.dateInbox("inbox/2026-01-02-assistant-abcd1234-1767312000.md").getTime(), 1767312000000);
  assert.equal(L.parisDate(L.dateInbox("inbox/2026-01-09-assistant-x.md")), "2026-01-09");
});

test("typeCommit : digestion, dépôt inbox, manuel", () => {
  assert.equal(L.typeCommit(commit("Hermès", "", "digestion 2026-01-15")), "digestion");
  assert.equal(L.typeCommit(commit("Ordinateur", "", "inbox: 2 dépôt(s)")), "inbox");
  assert.equal(L.typeCommit(commit("Quelqu'un", "", "Correctif")), "manuel");
});

const base = {
  commits: [commit("Ordinateur", "2026-01-15T15:00:00Z", "inbox: 3"), commit("Hermès", "2026-01-15T01:30:00Z", "digestion 2026-01-15 01:30 UTC : 4 dépôt(s)")],
  inbox: ["inbox/2026-01-15-assistant-a-1768489200.md"],
  rapport: { date: "2026-01-15", texte: "## Questions à arbitrer\n- Q ?\n## État technique\n- ok" },
  decisions: "- [Décision] Le jardin passe au compost, car moins de déchets. — 2026-01-10 · w",
  pourAssistants: "> Généré automatiquement le 2026-01-15\n- [Décision] Le jardin passe au compost, car moins de déchets. (2026-01-10)",
  fiches: [{ nom: "jardin", meta: { niveau: "actif", maj: "2026-01-10" } }],
};
const etat = (s, id) => s.find((x) => x.id === id)?.etat;

test("santé nominale : tout est ok", () => {
  const s = L.sante(base, NOW);
  assert.equal(L.etatGlobal(s), "ok");
  assert.match(s.find((x) => x.id === "rapport").resume, /1 point à voir/);
});

test("santé : digestion en retard, inbox en retard, export incohérent, fiche périmée", () => {
  const s = L.sante({ ...base,
    commits: [commit("Hermès", "2026-01-14T00:00:00Z", "digestion")],
    inbox: Array.from({ length: 7 }, (_, i) => `inbox/2026-01-15-x-${i}.md`),
    decisions: "- [Décision] Nouvelle décision jamais exportée. — 2026-01-15 · w",
    fiches: [{ nom: "vieux", meta: { niveau: "actif", maj: "2025-09-01" } }] }, NOW);
  assert.equal(etat(s, "digestion"), "warn"); // 40 h : à surveiller ; au-delà de 50 h : problème
  assert.equal(etat(s, "inbox"), "warn");
  assert.equal(etat(s, "export"), "warn");
  assert.equal(etat(s, "perimees"), "warn");
  assert.equal(L.sante({ ...base, commits: [] }, NOW)[0].etat, "err");
});

test("qualité : liens sans fiche, doublons, fiche active sans « En bref »", () => {
  const fiches = [
    { nom: "jardin", dossier: "projets", meta: { niveau: "actif" }, corps: "## En bref\n- [Dit] Voir [[verger]] et [[profil]]." },
    { nom: "verger", dossier: "projets", meta: { niveau: "actif" }, corps: "- [Dit] Lié à [[serre|la serre]] et [[jardin#plan]]." },
    { nom: "verger", dossier: "sujets", meta: { niveau: "reference" }, corps: "" },
  ];
  const q = L.qualite(fiches, { decisions: "- [Décision] Arroser [[serre]]." });
  assert.equal(q.find((x) => x.id === "liens").detail, "serre (dans verger, decisions)");
  assert.equal(q.find((x) => x.id === "doublons").detail, "verger (projets, sujets)");
  assert.equal(q.find((x) => x.id === "sansbref").detail, "verger");
  assert.ok(q.every((x) => x.etat === "info")); // jamais une alerte en page d'accueil
  assert.deepEqual(L.qualite([fiches[0], { ...fiches[1], corps: "## En bref\n- [Dit] [[jardin]]" }]), []);
});

test("santé : blocage signalé et rapport absent", () => {
  const s = L.sante({ ...base, commits: [commit("Hermès", "2026-01-14T01:30:00Z", "digestion")], rapport: { date: "2026-01-14", texte: "### Bloqué ou en retard\n- outil absent" } }, NOW);
  assert.equal(etat(s, "blocage"), "warn");
  assert.equal(etat(s, "rapport"), "info");
});

test("arbitrages : doublons fusionnés, renvois et constats écartés, historiques à part", () => {
  const rapport = { date: "2026-01-15", texte: [
    "## Questions à arbitrer",
    "- (nouveau) Préciser si la haie de thuyas côté rue doit être remplacée par des lauriers.",
    "- Préciser si la haie de thuyas côté rue doit être remplacée par des lauriers ?",
    "- Trancher les questions de [[a-clarifier]].",
    "- Aucun retard détecté.",
    "- Choisir la date de la tonte.",
  ].join("\n") };
  const aClarifier = [
    "- [IA] Haie côté rue : thuyas conservés ou remplacés par des lauriers ? [[jardin]] — 2026-01-05 · a",
    "- [IA] Couleur du portail : vert ou gris ? — 2026-01-12 · b",
    "- [IA] Arrosage : goutte-à-goutte ou manuel ? — 2026-01-02 · c",
  ].join("\n");
  const a = L.arbitrages(rapport, aClarifier, NOW);
  assert.deepEqual(a.actifs.map((x) => x.texte), ["Préciser si la haie de thuyas côté rue doit être remplacée par des lauriers.", "Choisir la date de la tonte."]);
  assert.equal(a.actifs[0].nouveau, true);
  assert.equal(a.actifs[0].aussi.date, "2026-01-05");
  assert.deepEqual(a.historiques.map((x) => x.date), ["2026-01-12", "2026-01-02"]); // plus récente d'abord
  const vieux = L.arbitrages({ ...rapport, date: "2026-01-10" }, aClarifier, NOW);
  assert.equal(vieux.actifs.length, 0);
  assert.equal(vieux.historiques.length, 3);
});

test("proche : exige des mots communs significatifs", () => {
  assert.ok(L.proche("Choisir la couleur du portail du jardin", "Portail du jardin : quelle couleur choisir ?"));
  assert.ok(!L.proche("Choisir la couleur du portail", "Choisir la date de la tonte"));
});

test("md échappe le HTML et rend liens, étiquettes, barré, provenance", () => {
  const html = L.md("---\na: b\n---\n# T\n- [Dit] <img src=x onerror=alert(1)> ~~non~~ [[jardin]] [[inconnue]]", new Set(["jardin"]));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes('href="#fiche/jardin"'));
  assert.ok(html.includes('class="lien mort">inconnue'));
  assert.ok(html.includes("<s>non</s>") && html.includes("tag-Dit"));
  assert.ok(!html.includes("a: b"));
  assert.ok(L.md("- [Dit] Fait. — 2026-01-10 · chat").includes('<span class="prov">2026-01-10 · chat</span>'));
});

test("cherche : sans accents, tous les mots, nom prioritaire", () => {
  const docs = [{ nom: "jardin", dossier: "projets", texte: "- haie thuyas\n- autre" }, { nom: "maison", dossier: "projets", texte: "- le jardin à l'arrière" }];
  assert.deepEqual(L.cherche(docs, "Jardin").map((x) => x.nom), ["jardin", "maison"]);
  assert.equal(L.cherche(docs, "thuyas haie")[0].nom, "jardin");
  assert.deepEqual(L.cherche(docs, "  "), []);
});

test("ligne : maj = date la plus récente de la provenance", () => {
  assert.equal(L.ligne("- [Dit] X. — 2026-01-05 · a ; 2026-01-09 · b").maj, "2026-01-09");
  assert.equal(L.ligne("- Liens : [[a]]").maj, "");
});

test("nature : choix ou fait à confirmer", () => {
  assert.equal(L.nature("Quel rôle restant pour l'outil A ?"), "choix");
  assert.equal(L.nature("L'option B reste-t-elle valable ?"), "choix");
  assert.equal(L.nature("Orthographe du nom : Dupont ou Dupond ?"), "fait");
  assert.equal(L.nature("Restaurer un état Git propre puis publier le rapport."), "technique");
  // L'étiquette d'Hermès l'emporte sur les mots-clés, et ne s'affiche pas.
  assert.equal(L.nature("[IA] [Fait] Faut-il écrire Dupont ou Dupond ?"), "fait");
  assert.equal(L.nature("[choix] Publier le rapport le soir ?"), "choix");
  assert.equal(L.enLigne("[IA] [choix] Garder la haie ?"), '<span class="tag tag-IA">IA</span> Garder la haie ?');
});

const FICHE = { nom: "jardin", corps: "# Jardin potager\n## En bref\n- [Dit] Potager de 20 m². — 2026-01-02 · a\n- Liens : [[maison]]\n## Suivi\n" +
  "- [Dit] Tomates plantées. — 2026-01-12 · b\n- [Source] Sol argileux, à revérifier. — 2026-01-03 · c\n- [Décision] Arrosage du potager le soir avec récupérateur. — 2026-01-11 · d\n- ~~[Dit] Ancien.~~ — 2026-01-14 · e" };

test("titre et projet : chaque ligne une seule fois, décisions fusionnées", () => {
  assert.equal(L.titre(FICHE.corps), "Jardin potager");
  const p = L.projet(FICHE, "- [Décision] Arrosage du potager le soir avec récupérateur. [[jardin]] — 2026-01-11 · d\n- [Décision] Autre. [[maison]] — 2026-01-01 · z",
    "- [IA] Sol argileux ou sableux ? [[jardin]] — 2026-01-04 · c\n- [IA] Autre ? [[maison]] — 2026-01-04 · c");
  assert.deepEqual(p.bref.map((x) => x.texte), ["Potager de 20 m²."]);
  assert.deepEqual(p.evolutions.map((x) => x.texte), ["Tomates plantées.", "Sol argileux, à revérifier."]);
  assert.equal(p.decisions.length, 1);
  assert.deepEqual(p.questions.map((x) => x.texte), ["Sol argileux ou sableux ? [[jardin]]"]);
  assert.deepEqual(p.pistes, []); // déjà montré dans les évolutions
});

test("changements : seulement les lignes récentes non barrées", () => {
  const c = L.changements([FICHE], "- [Décision] Arrosage. — 2026-01-14 · d\n- [Décision] Vieux. — 2026-01-01 · d", "- [IA] Q ? — 2026-01-13 · x", NOW);
  assert.equal(c.depuis, "2026-01-12");
  assert.equal(c.decisions.length, 1);
  assert.equal(c.questions.length, 1);
  assert.deepEqual(c.fiches.map((f) => [f.nom, f.lignes.map((x) => x.texte)]), [["jardin", ["Tomates plantées."]]]);
});

test("lectures : retenues et conversations sans apport", () => {
  const j = "# Journal\n- 2026-01-10 · hermes ab12 : préférence ajoutée.\n- 2026-01-11/12 · claude-code cd34 : rien de durable (ponctuel).";
  const r = L.lectures(j);
  assert.equal(r.total, 2);
  assert.equal(r.ignorees, 1);
  assert.deepEqual(r.retenues.map((x) => [x.source, x.texte]), [["hermes", "préférence ajoutée."]]);
});

test("projet : les pistes au-delà des 4 évolutions restent visibles", () => {
  const corps = "# P\n" + [1, 2, 3, 4, 5].map((i) => `- [Dit] Fait ${i}. — 2026-01-1${i} · a`).join("\n") + "\n- [Dit] Budget à confirmer. — 2026-01-01 · b";
  assert.deepEqual(L.projet({ nom: "p", corps }, "", "").pistes.map((x) => x.texte), ["Budget à confirmer."]);
});

test("santé : blocage du rapport levé par une digestion postérieure", () => {
  const rapport = { date: "2026-01-15", texte: "## Bloqué ou en retard\n- pull bloqué" };
  const avant = L.sante({ ...base, rapport, commits: [commit("Hermès", "2026-01-15T01:30:00Z", "digestion")] }, NOW);
  assert.equal(etat(avant, "blocage"), "warn");
  const apres = L.sante({ ...base, rapport, commits: [commit("Hermès", "2026-01-15T09:00:00Z", "digestion")] }, NOW);
  assert.equal(etat(apres, "blocage"), "info");
});
