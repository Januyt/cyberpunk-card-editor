/**
 * Cyberpunk Card Editor - Foundry VTT module
 * Entry point: registers hooks and exposes the API.
 */

import { CyberpunkCardApp } from "./card-app.js";

const MODULE_ID = "cyberpunk-card-editor";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  // Stocke les layouts de calibration par rôle (partagés entre tous les acteurs du même rôle).
  // Seul le GM peut écrire, mais tous peuvent lire.
  game.settings.register(MODULE_ID, "roleLayouts", {
    name: "Calibration par rôle",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Expose for macros / debugging
  game.modules.get(MODULE_ID).api = {
    open: (actor) => new CyberpunkCardApp(actor).render(true),
    CyberpunkCardApp
  };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready (system: ${game.system.id} v${game.system.version})`);
});

/**
 * Inject the "🪪 Carte" button into the header of any character actor sheet.
 * The Cyberpunk RED Core system uses CPRActorSheet; we listen on the generic
 * renderActorSheet hook so it works on any sheet (including base, custom, etc.).
 */
Hooks.on("renderActorSheet", (app, html, data) => {
  const actor = app.actor;
  if (!actor || !["character", "mook", "npc"].includes(actor.type)) return;

  // Permission gate: a player without at least OBSERVER access shouldn't see
  // the card button — it would let them open someone else's stats.
  // Foundry's permission constants: NONE=0, LIMITED=1, OBSERVER=2, OWNER=3.
  const PERMS = (CONST.DOCUMENT_OWNERSHIP_LEVELS ?? CONST.DOCUMENT_PERMISSION_LEVELS ?? {});
  const minLevel = PERMS.OBSERVER ?? 2;
  if (!game.user.isGM && !actor.testUserPermission(game.user, minLevel)) return;

  const headerActions = html.find(".window-header .window-title");
  if (headerActions.length === 0) return;
  if (html.find(".cpk-card-header-btn").length > 0) return;

  const label = game.i18n.localize("CPK-CARD.button.openEditor");
  const btn = $(`<a class="cpk-card-header-btn" title="${label}" style="margin-right:6px;">${label}</a>`);
  btn.on("click", (ev) => {
    ev.preventDefault();
    new CyberpunkCardApp(actor).render(true);
  });
  headerActions.after(btn);
});
