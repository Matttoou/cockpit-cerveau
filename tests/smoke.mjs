// node --test tests/smoke.mjs — test de fumée : le cockpit s'affiche en mode local sur un faux Cerveau.
// Données entièrement fictives, aucun jeton, aucun appel à GitHub. Demande Playwright (npm install).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const ICI = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8799;
const URL = `http://127.0.0.1:${PORT}/`;
const auj = new Date().toISOString().slice(0, 10);

const FAUX = {
  "profil.md": "# Profil\n\n## En cours\n- [[jardin]]\n",
  "preferences.md": "# Préférences\n- [Dit] Réponses courtes. — 2026-01-10 · chat ab12cd34\n",
  "decisions.md": `# Décisions\n- [Décision] Le jardin passe au compost. [[jardin]] — ${auj} · chat ab12cd34\n`,
  "a-clarifier.md": `# À clarifier\n- [IA] Arroser le matin ou le soir ? [[jardin]] — ${auj} · chat ab12cd34\n`,
  "pour-assistants.md": "# Pour les assistants\n",
  "projets/jardin.md": `---\nniveau: actif\nmaj: ${auj}\n---\n# Jardin\n\n## En cours\n- [Dit] Planter les tomates. — ${auj} · chat ab12cd34\n`,
  [`journal/rapport-${auj}.md`]: "# Rapport\n\n## Questions à arbitrer\n- Faut-il un deuxième composteur ?\n\n## État technique\n- ok\n",
  [`journal/${auj.slice(0, 7)}.md`]: `# Journal\n- [Dit] Visite du jardin. — ${auj} · chat ab12cd34\n`,
};

let depot, serveur, navigateur;

before(async () => {
  depot = mkdtempSync(join(tmpdir(), "faux-cerveau-"));
  for (const [p, t] of Object.entries(FAUX)) {
    mkdirSync(dirname(join(depot, p)), { recursive: true });
    writeFileSync(join(depot, p), t);
  }
  const git = (...a) => execFileSync("git", ["-C", depot, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=Hermès", "-c", "user.email=hermes@example.invalid", "commit", "-q", "-m", "digestion");

  serveur = spawn("python3", [join(ICI, "serve.py"), String(PORT)], { env: { ...process.env, CERVEAU_REPO: depot }, stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { if ((await fetch(URL)).ok) break; } catch {}
    if (i > 50) throw new Error("serve.py n'a pas démarré");
    await new Promise((r) => setTimeout(r, 100));
  }
  navigateur = await chromium.launch();
});

after(async () => {
  await navigateur?.close();
  serveur?.kill();
  if (depot) rmSync(depot, { recursive: true, force: true });
});

test("chaque onglet et une fiche s'affichent, sans erreur de console", async () => {
  const page = await navigateur.newPage();
  const erreurs = [];
  page.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
  page.on("pageerror", (e) => erreurs.push(e.message));

  await page.goto(URL);
  await page.locator("nav").waitFor({ state: "visible" });

  const vues = { aujourdhui: "Aujourd'hui", decisions: "Décisions", projets: "Projets", agents: "Agents", memoire: "Mémoire", "fiche/jardin": "Jardin" };
  for (const [hash, titre] of Object.entries(vues)) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.locator("#titre", { hasText: titre }).waitFor();
    assert.equal(await page.locator("#vue .erreur").count(), 0, `message d'erreur sur #${hash}`);
    assert.ok((await page.locator("#vue").innerText()).trim().length > 0, `vue vide sur #${hash}`);
  }
  assert.match(await page.locator("#lu").innerText(), /Copie Mac/);
  assert.deepEqual(erreurs, []);
});
