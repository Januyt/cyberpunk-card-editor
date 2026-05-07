/**
 * CyberpunkCardApp — FormApplication wrapping the card editor.
 *
 * Reads stats from the CP:R Core actor (with multiple fallback paths to be
 * robust against system version drift), lets the user override any field,
 * and persists layout/text overrides as flags on the actor itself.
 *
 * Capabilities:
 *  - Auto-fill from actor (character / mook / npc), with manual overrides
 *  - Drag-to-rotate 3D preview, drag-to-position calibration with sliders
 *  - Export PNG (download or set as actor token image)
 *  - Post to chat as image, or create a Journal Entry handout
 *  - Persistent layout & overrides per actor (Foundry flags)
 *  - Self-contained HTML export (clipboard)
 */

const MODULE_ID = "cyberpunk-card-editor";

const ROLE_KEYS = [
  "exec", "fixer", "lawman", "media", "medtech",
  "netrunner", "nomad", "rockerboy", "solo", "tech"
];

const ROLE_LABELS = {
  exec: "Exec", fixer: "Fixer", lawman: "Lawman", media: "Media",
  medtech: "Medtech", netrunner: "Netrunner", nomad: "Nomad",
  rockerboy: "Rockerboy", solo: "Solo", tech: "Tech"
};

const STATS_ORDER = ["INT", "REF", "DEX", "TECH", "COOL", "WILL", "MOVE", "BODY", "EMP"];

// ---------- Data readers (defensive against system version drift) ----------

function readStat(actor, statKey) {
  const lower = statKey.toLowerCase();
  const paths = [
    `system.stats.${lower}.value`,
    `system.stats.${lower}.max`,
    `system.stats.${lower}`,
    `system.attributes.${lower}.value`
  ];
  for (const p of paths) {
    const v = foundry.utils.getProperty(actor, p);
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

function readPair(actor, key) {
  const candidates = [
    `system.derivedStats.${key}`,
    `system.attributes.${key}`,
    `system.${key}`
  ];
  for (const base of candidates) {
    const o = foundry.utils.getProperty(actor, base);
    if (o && typeof o === "object") {
      const v = o.value ?? o.current ?? o.val;
      const m = o.max ?? o.maximum ?? o.total;
      if (v !== undefined && m !== undefined) return `${v} / ${m}`;
      if (v !== undefined) return String(v);
    }
  }
  return "";
}

function detectRole(actor) {
  const active = foundry.utils.getProperty(actor, "system.roleInfo.activeRole");
  if (active && typeof active === "string") {
    const a = active.toLowerCase();
    if (ROLE_KEYS.includes(a)) return a;
  }
  if (actor.items) {
    for (const it of actor.items) {
      if (it.type === "role") {
        const name = (it.name || "").toLowerCase();
        for (const r of ROLE_KEYS) {
          if (name.includes(r) || name.includes(ROLE_LABELS[r].toLowerCase())) return r;
        }
      }
    }
  }
  return "solo";
}

// Lightweight html2canvas loader — script is bundled in scripts/lib/.
let _html2canvasPromise = null;
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (_html2canvasPromise) return _html2canvasPromise;
  _html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `modules/${MODULE_ID}/scripts/lib/html2canvas.min.js`;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error("Failed to load html2canvas"));
    document.head.appendChild(s);
  });
  return _html2canvasPromise;
}

// ---------- Application ----------

export class CyberpunkCardApp extends FormApplication {

  constructor(actor, options = {}) {
    super(actor, options);
    this.actor = actor;
    // Treat mook + npc with the simplified template; everything else uses full character layout.
    this.isSimple = ["mook", "npc"].includes(actor.type);
    // Permission flags. canEdit gates writes (saving overrides, setting token, etc.).
    // Observers can still open the editor and use export/share, but cannot mutate.
    this.canEdit = actor.isOwner || game.user.isGM;
    this.readOnly = !this.canEdit;
    this._layout = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "layout") ?? {});
    this._overrides = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "overrides") ?? {});
    // Migration: stats are no longer overridable — they always come from the
    // actor sheet now. Strip any stale stat_* / hp / humanity overrides that
    // earlier versions may have stored, so we don't hide a real stat change.
    for (const k of Object.keys(this._overrides)) {
      if (k.startsWith("stat_") || k === "hp" || k === "humanity") {
        delete this._overrides[k];
      }
    }

    // Auto-refresh when the underlying actor changes (someone edits the sheet,
    // a roll updates HP, etc.). Stored as a Hook id so we can unbind on close.
    this._hookId = Hooks.on("updateActor", (changedActor) => {
      if (changedActor.id !== this.actor.id) return;
      if (this.rendered) this.render(false);
    });
  }

  async close(options) {
    if (this._hookId) Hooks.off("updateActor", this._hookId);
    return super.close(options);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "cyberpunk-card-editor",
      classes: ["cpk-card-app"],
      template: `modules/${MODULE_ID}/templates/card-editor.hbs`,
      width: 1180,
      height: 820,
      resizable: true,
      submitOnClose: true,
      closeOnSubmit: false,
      submitOnChange: false,
      title: "Cyberpunk Card Editor"
    });
  }

  get title() {
    const name = this.actor?.name ?? "";
    return game.i18n.format("CPK-CARD.title", { name });
  }

  async getData() {
    const a = this.actor;
    const role = this._overrides.role ?? detectRole(a);
    // Stats are ALWAYS live from the actor sheet — no overrides. If a player
    // wants to change a stat, they edit the actor sheet itself (single source
    // of truth). Empty values render as empty strings.
    const stats = {};
    for (const k of STATS_ORDER) {
      stats[k] = readStat(a, k);
    }

    const assetsBase = `modules/${MODULE_ID}/assets`;
    // Mooks/NPCs use generic frame (mook_base.png / npc_base.png) instead of role frames.
    const frameKey = this.isSimple ? a.type : role;
    const fallbackFrame = `${assetsBase}/${frameKey}_base.png`;
    const fallbackBg = `${assetsBase}/${frameKey}_background.png`;
    const fallbackVerso = `${assetsBase}/${frameKey}_verso.png`;

    return {
      moduleId: MODULE_ID,
      isSimple: this.isSimple,
      actorType: a.type,
      readOnly: this.readOnly,
      canEdit: this.canEdit,
      role,
      roles: ROLE_KEYS.map(k => ({ key: k, label: ROLE_LABELS[k], selected: k === role })),
      backgrounds: ROLE_KEYS.map(k => ({
        file: `${k}_background.png`,
        label: `${ROLE_LABELS[k]} background`
      })),
      assetsBase,

      // Photo fit mode — chosen by the GM, persisted as a cosmetic override.
      photoFit: this._overrides.photoFit ?? "cover",
      photoFitOptions: ["cover", "contain", "blur"].map(v => ({
        value: v,
        label: { cover: "Remplir (cover)", contain: "Contenir (lettres noires)", blur: "Contenir + flou de bord" }[v],
        selected: (this._overrides.photoFit ?? "cover") === v
      })),

      name: this._overrides.name ?? a.name ?? "",
      subtitle: this._overrides.subtitle ?? (a.system?.information?.alias ?? a.system?.alias ?? ""),
      quote: this._overrides.quote ?? (a.system?.information?.quote ?? ""),
      // HP / Humanity always live from the actor.
      hp: readPair(a, "hp"),
      humanity: this.isSimple ? "" : readPair(a, "humanity"),

      stats,

      characterArt: this._overrides.characterArt ?? a.img ?? "",
      frameArt: this._overrides.frameArt ?? fallbackFrame,
      baseArt: this._overrides.baseArt ?? fallbackBg,
      versoArt: this._overrides.versoArt ?? fallbackVerso,

      layoutJson: JSON.stringify(this._layout || {})
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    this._root = root;
    this._card = root.querySelector(".cpk-card");
    this._cardScene = root.querySelector(".cpk-card-scene");

    this._bindInputs(root);
    this._bindFiles(root);
    this._bindRoleAndBg(root);
    this._bindActions(root);
    this._bindCalibration(root);
    this._bindRotation(root);
    this._applyLayout();

    // Read-only lockdown: an Observer (player viewing another player's sheet)
    // can open the editor and use export/share buttons, but cannot mutate.
    if (this.readOnly) this._applyReadOnly(root);
  }

  /**
   * Disables all write controls in the editor for users who don't own this actor.
   * Disabled = inputs greyed out, file pickers off, write buttons hidden.
   * Read buttons (PNG / Chat / Journal / HTML / Flip / Calibrate) remain available.
   */
  _applyReadOnly(root) {
    root.classList.add("cpk-readonly");
    // Disable every form control
    root.querySelectorAll("input, textarea, select").forEach(el => { el.disabled = true; });
    // Hide write-only buttons
    const writeBtns = ["#cpk-save-actor", "#cpk-reset-layout", "#cpk-set-token"];
    for (const sel of writeBtns) {
      const b = root.querySelector(sel);
      if (b) b.style.display = "none";
    }
    // Show a clear banner so users understand why
    const banner = document.createElement("div");
    banner.className = "cpk-readonly-banner";
    banner.textContent = "👁 Lecture seule — tu n'es pas propriétaire de cet acteur.";
    const controls = root.querySelector(".cpk-controls");
    if (controls) controls.prepend(banner);
  }

  // ---------- Bindings ----------

  _bindInputs(root) {
    // Cosmetic fields → write to overrides on the fly.
    const map = [
      ["#cpk-name", ".cpk-name", "name"],
      ["#cpk-subtitle", ".cpk-subtitle", "subtitle"],
      ["#cpk-quote", ".cpk-quote", "quote"]
    ];
    for (const [inputSel, targetSel, key] of map) {
      const inp = root.querySelector(inputSel);
      const tgt = root.querySelector(targetSel);
      if (!inp || !tgt) continue;
      inp.addEventListener("input", () => {
        tgt.textContent = inp.value;
        this._overrides[key] = inp.value;
      });
    }
    // Stats / HP / Humanity are display-only here — they always reflect the
    // actor sheet. The inputs in the panel are rendered as `disabled`, so
    // there's nothing to bind. To change them, the user edits the actor sheet.
  }

  _bindFiles(root) {
    const bgCopy = root.querySelector(".cpk-character-art-bg");
    const imgMap = {
      characterArt: ".cpk-character-art",
      frameArt:     ".cpk-frame-art",
      baseArt:      ".cpk-base-art",
      versoArt:     ".cpk-verso-art"
    };

    // Bouton "Depuis le PC" → déclenche un <input type="file"> natif
    const localBtn = root.querySelector(".cpk-local-btn[data-key='characterArt']");
    const localFile = root.querySelector("#cpk-character-file");
    const charImg = root.querySelector(".cpk-character-art");
    if (localBtn && localFile && charImg) {
      localBtn.addEventListener("click", () => localFile.click());
      localFile.addEventListener("change", async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const dataUrl = await this._fileToDataUrl(file);
        charImg.src = dataUrl;
        charImg.style.display = "block";
        this._overrides.characterArt = dataUrl;
        if (bgCopy) { bgCopy.src = dataUrl; bgCopy.style.display = ""; }
      });
    }

    // Boutons FilePicker → frame, bg, verso (fichiers côté serveur Foundry)
    root.querySelectorAll(".cpk-fp-btn[data-key]").forEach(btn => {
      const key = btn.dataset.key;
      const imgSel = imgMap[key];
      const img = imgSel ? root.querySelector(imgSel) : null;
      if (!img) return;

      btn.addEventListener("click", () => {
        new FilePicker({
          type: "image",
          current: this._overrides[key] ?? "",
          callback: (path) => {
            img.src = path;
            img.style.display = "block";
            this._overrides[key] = path;
          }
        }).render(true);
      });
    });
  }

  _bindRoleAndBg(root) {
    const roleSel = root.querySelector("#cpk-role-select");
    const bgSel = root.querySelector("#cpk-bg-select");
    const frameImg = root.querySelector(".cpk-frame-art");
    const bgImg = root.querySelector(".cpk-base-art");
    const versoImg = root.querySelector(".cpk-verso-art");
    const base = `modules/${MODULE_ID}/assets`;

    if (roleSel) {
      roleSel.addEventListener("change", () => {
        const r = roleSel.value;
        this._overrides.role = r;
        if (frameImg) {
          frameImg.src = `${base}/${r}_base.png`;
          this._overrides.frameArt = frameImg.src;
        }
        if (versoImg) {
          versoImg.src = `${base}/${r}_verso.png`;
          this._overrides.versoArt = versoImg.src;
        }
        if (bgSel) {
          bgSel.value = `${r}_background.png`;
          if (bgImg) {
            bgImg.src = `${base}/${r}_background.png`;
            this._overrides.baseArt = bgImg.src;
          }
        }
      });
    }
    if (bgSel) {
      bgSel.addEventListener("change", () => {
        if (bgImg) bgImg.src = `${base}/${bgSel.value}`;
        this._overrides.baseArt = `${base}/${bgSel.value}`;
      });
    }

    // Photo fit mode: cover / contain / blur. Updates the front card class
    // and persists the choice as a cosmetic override.
    const fitSel = root.querySelector("#cpk-photo-fit");
    const front = root.querySelector(".cpk-card-front");
    if (fitSel && front) {
      fitSel.addEventListener("change", () => {
        const v = fitSel.value;
        front.classList.remove("cpk-fit-cover", "cpk-fit-contain", "cpk-fit-blur");
        front.classList.add(`cpk-fit-${v}`);
        this._overrides.photoFit = v;
      });
    }
  }

  _bindActions(root) {
    root.querySelector("#cpk-save-actor")?.addEventListener("click", async () => {
      await this.actor.setFlag(MODULE_ID, "layout", this._layout);
      await this.actor.setFlag(MODULE_ID, "overrides", this._overrides);
      ui.notifications.info(game.i18n.localize("CPK-CARD.notify.savedToActor"));
    });

    root.querySelector("#cpk-reset-layout")?.addEventListener("click", async () => {
      this._layout = {};
      this._overrides = {};
      await this.actor.unsetFlag(MODULE_ID, "layout");
      await this.actor.unsetFlag(MODULE_ID, "overrides");
      ui.notifications.info(game.i18n.localize("CPK-CARD.notify.cleared"));
      this.render(true);
    });

    root.querySelector("#cpk-export-html")?.addEventListener("click", async () => {
      const html = this._buildStandaloneHtml();
      try {
        await navigator.clipboard.writeText(html);
        ui.notifications.info(game.i18n.localize("CPK-CARD.notify.exported"));
      } catch {
        new Dialog({
          title: "Export HTML",
          content: `<textarea style="width:100%;height:300px;">${html.replace(/</g, "&lt;")}</textarea>`,
          buttons: { close: { label: "Fermer" } }
        }).render(true);
      }
    });

    root.querySelector("#cpk-flip")?.addEventListener("click", () => {
      this._cardScene?.classList.toggle("cpk-flipped");
    });

    // PNG / chat / journal / token actions
    root.querySelector("#cpk-export-png")?.addEventListener("click", () => this._exportPng({ download: true }));
    root.querySelector("#cpk-set-token")?.addEventListener("click", () => this._setAsToken());
    root.querySelector("#cpk-post-chat")?.addEventListener("click", () => this._postToChat());
    root.querySelector("#cpk-create-journal")?.addEventListener("click", () => this._createJournalEntry());
  }

  _bindRotation(root) {
    let dragging = false, sx = 0, sy = 0, rx = 0, ry = 0;
    const scene = this._cardScene;
    if (!scene) return;
    scene.style.transition = "transform .12s ease-out";

    const onDown = (e) => {
      if (e.target.closest("input, textarea, button, select, label, .cpk-zone-bar, .cpk-sliders")) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const m = scene.style.transform.match(/rotateY\(([^)]+)\).*rotateX\(([^)]+)\)/);
      if (m) { ry = parseFloat(m[1]); rx = parseFloat(m[2]); }
      scene.style.transition = "none";
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      scene.style.transform = `rotateY(${ry + dx * 0.4}deg) rotateX(${rx - dy * 0.4}deg)`;
    };
    const onUp = () => { dragging = false; scene.style.transition = "transform .25s ease-out"; };
    const onDbl = () => { scene.style.transform = "rotateY(0deg) rotateX(0deg)"; };

    scene.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    scene.addEventListener("dblclick", onDbl);
  }

  // ---------- Calibration ----------

  _bindCalibration(root) {
    const toggle = root.querySelector("#cpk-cal-toggle");
    const panel = root.querySelector("#cpk-cal-panel");
    const slidersDiv = root.querySelector("#cpk-cal-sliders");
    const zoneBar = root.querySelector("#cpk-cal-zonebar");
    if (!toggle || !panel || !slidersDiv || !zoneBar) return;

    toggle.addEventListener("click", () => {
      panel.classList.toggle("cpk-hidden");
      this._root.classList.toggle("cpk-cal-active");
    });

    let activeZone = "name";
    const renderSliders = () => {
      const cur = this._layout[activeZone] ?? { x: 50, y: 50, scale: 1, rot: 0 };
      slidersDiv.innerHTML = `
        <label>X (%) <input type="range" min="0" max="100" step="0.1" value="${cur.x}" data-prop="x"></label>
        <label>Y (%) <input type="range" min="0" max="100" step="0.1" value="${cur.y}" data-prop="y"></label>
        <label>Scale <input type="range" min="0.5" max="2" step="0.01" value="${cur.scale}" data-prop="scale"></label>
        <label>Rotation <input type="range" min="-180" max="180" step="1" value="${cur.rot}" data-prop="rot"></label>
      `;
      slidersDiv.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("input", () => {
          const prop = inp.dataset.prop;
          this._layout[activeZone] = this._layout[activeZone] ?? { x: 50, y: 50, scale: 1, rot: 0 };
          this._layout[activeZone][prop] = parseFloat(inp.value);
          this._applyLayout();
        });
      });
    };

    zoneBar.querySelectorAll(".cpk-zb").forEach(zb => {
      zb.addEventListener("click", () => {
        zoneBar.querySelectorAll(".cpk-zb").forEach(z => z.classList.remove("active"));
        zb.classList.add("active");
        activeZone = zb.dataset.z;
        renderSliders();
      });
    });
    renderSliders();
  }

  _applyLayout() {
    const map = {
      name: ".cpk-name",
      subtitle: ".cpk-subtitle",
      hp: ".cpk-hp-block",
      hum: ".cpk-humanity-block",
      quote: ".cpk-quote",
      ...Object.fromEntries(STATS_ORDER.map(s => [`stat_${s}`, `.cpk-stat-block-${s}`]))
    };
    for (const [zone, sel] of Object.entries(map)) {
      const el = this._root?.querySelector(sel);
      if (!el) continue;
      const l = this._layout[zone];
      if (!l) continue;
      el.style.left = `${l.x}%`;
      el.style.top = `${l.y}%`;
      el.style.transform = `translate(-50%, -50%) scale(${l.scale}) rotate(${l.rot}deg)`;
    }
  }

  // ---------- Snapshot pipeline (PNG, chat, journal, token) ----------

  /**
   * Capture the front of the card as a PNG.
   * Returns { dataUrl, canvas }. If options.download is true, also triggers download.
   *
   * Temporarily resets the 3D rotation and hides the back face so html2canvas
   * captures a clean 2D snapshot.
   */
  /**
   * Convertit le src d'une <img> en data URL via fetch, pour que html2canvas
   * puisse lire les images hébergées sur le serveur Foundry sans erreur CORS.
   */
  async _imgToDataUrl(img) {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:")) return;
    try {
      const resp = await fetch(src, { cache: "force-cache" });
      const blob = await resp.blob();
      const dataUrl = await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      img.src = dataUrl;
      return src; // retourne le src original pour restauration
    } catch {
      return null;
    }
  }

  async _exportPng({ download = false, scale = 2 } = {}) {
    const html2canvas = await loadHtml2Canvas().catch(err => {
      ui.notifications.error("html2canvas n'a pas pu se charger.");
      throw err;
    });

    const scene = this._cardScene;
    const front = this._root?.querySelector(".cpk-card-front");
    if (!scene || !front) return null;

    // Aplatir toutes les images en data URL pour contourner les restrictions CORS
    const imgEls = Array.from(front.querySelectorAll("img[src]"));
    const origSrcs = imgEls.map(i => i.getAttribute("src"));
    await Promise.all(imgEls.map(i => this._imgToDataUrl(i)));

    // Figer la scène en vue frontale pour la capture
    const sceneTransform = scene.style.transform;
    const sceneTransition = scene.style.transition;
    const back = this._root.querySelector(".cpk-card-back");
    const backDisplay = back?.style.display;

    scene.style.transition = "none";
    scene.style.transform = "rotateY(0deg) rotateX(0deg)";
    if (back) back.style.display = "none";

    let canvas;
    try {
      canvas = await html2canvas(front, {
        backgroundColor: null,
        scale,
        useCORS: false,
        allowTaint: false,
        logging: false
      });
    } finally {
      // Restaurer les src originaux et la 3D
      imgEls.forEach((img, i) => { if (origSrcs[i]) img.src = origSrcs[i]; });
      scene.style.transform = sceneTransform;
      scene.style.transition = sceneTransition;
      if (back) back.style.display = backDisplay ?? "";
    }

    const dataUrl = canvas.toDataURL("image/png");
    if (download) {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${this.actor.name.replace(/[^a-z0-9]+/gi, "_")}_cpk_card.png`;
      document.body.appendChild(a); a.click(); a.remove();
      ui.notifications.info("PNG téléchargé.");
    }
    return { dataUrl, canvas };
  }

  /**
   * Helper: upload a data-URL to Foundry's data folder; returns the resulting path or null.
   */
  async _uploadDataUrl(dataUrl, filename) {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: "image/png" });
    const worldId = game.world?.id ?? "default";
    const dir = `worlds/${worldId}/cyberpunk-card-editor`;
    try { await FilePicker.browse("data", dir); }
    catch { await FilePicker.createDirectory("data", dir).catch(() => {}); }
    const upload = await FilePicker.upload("data", dir, file, {}, { notify: false });
    return upload?.path ?? null;
  }

  /**
   * Upload the PNG and assign it as actor.img + prototype token texture.
   */
  async _setAsToken() {
    if (!this.actor.isOwner) {
      ui.notifications.warn("Tu n'es pas propriétaire de cet acteur.");
      return;
    }
    const snap = await this._exportPng({ download: false });
    if (!snap) return;
    const path = await this._uploadDataUrl(snap.dataUrl, `${this.actor.id}.png`);
    if (!path) { ui.notifications.error("Upload échoué."); return; }
    const cacheBusted = `${path}?v=${Date.now()}`;
    await this.actor.update({ img: cacheBusted, "prototypeToken.texture.src": cacheBusted });
    ui.notifications.info("Carte définie comme image de l'acteur et du token prototype.");
  }

  /**
   * Post the card as an image message in chat. Visible to all players.
   */
  async _postToChat() {
    const snap = await this._exportPng({ download: false });
    if (!snap) return;
    const path = await this._uploadDataUrl(snap.dataUrl, `${this.actor.id}_${Date.now()}.png`);
    if (!path) { ui.notifications.error("Upload échoué."); return; }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div style="text-align:center;">
        <img src="${path}" alt="${this.actor.name}" style="max-width:380px;border-radius:18px;box-shadow:0 6px 24px rgba(0,0,0,.6);">
      </div>`
    });
    ui.notifications.info("Carte postée dans le chat.");
  }

  /**
   * Create a Journal Entry containing the card image (image-type page in v10+).
   */
  async _createJournalEntry() {
    const snap = await this._exportPng({ download: false });
    if (!snap) return;
    const path = await this._uploadDataUrl(snap.dataUrl, `${this.actor.id}_${Date.now()}.png`);
    if (!path) { ui.notifications.error("Upload échoué."); return; }

    const entry = await JournalEntry.create({
      name: `Carte — ${this.actor.name}`,
      pages: [{
        name: this.actor.name,
        type: "image",
        src: path,
        image: { caption: this.actor.name }
      }]
    });
    entry?.sheet.render(true);
    ui.notifications.info(`Journal Entry créée : "${entry?.name}".`);
  }

  // ---------- Helpers ----------

  _fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  _buildStandaloneHtml() {
    const data = {
      title: this._root.querySelector("#cpk-name")?.value ?? "",
      generatedAt: new Date().toISOString(),
      layout: this._layout,
      overrides: this._overrides
    };
    const cardHtml = this._root.querySelector(".cpk-card-scene")?.outerHTML ?? "";
    const css = Array.from(document.styleSheets)
      .filter(s => (s.href || "").includes(MODULE_ID))
      .map(s => {
        try { return Array.from(s.cssRules).map(r => r.cssText).join("\n"); }
        catch { return ""; }
      }).join("\n");

    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>${data.title} — CP:R Card</title>
<style>
body { margin:0; min-height:100vh; display:grid; place-items:center;
  background: radial-gradient(circle at 15% 10%, rgba(255,38,54,.22), transparent 32%),
              radial-gradient(circle at 80% 80%, rgba(0,234,255,.18), transparent 34%),
              linear-gradient(135deg,#020306,#070812 55%,#020204);
  font-family: Arial, Helvetica, sans-serif; color:#f5f7ff; }
${css}
</style></head><body>
${cardHtml}
<script>
window.__CPK_CARD_STATE__ = ${JSON.stringify(data)};
</script>
</body></html>`;
  }

  async _updateObject(event, formData) {
    await this.actor.setFlag(MODULE_ID, "layout", this._layout);
    await this.actor.setFlag(MODULE_ID, "overrides", this._overrides);
  }
}
