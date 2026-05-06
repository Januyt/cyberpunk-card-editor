# Cyberpunk Card Editor — Foundry VTT Module

Génère une carte de personnage style trading-card (recto/verso) à partir des
Actors du système **Cyberpunk RED Core** (`cyberpunk-red-core`).

- ✅ Auto-rempli depuis la fiche du PJ (nom, surnom, citation, INT/REF/DEX/…, HP, Humanity)
- ✅ Tous les champs sont éditables manuellement (overrides persistants)
- ✅ Upload d'image perso, frame, background, verso
- ✅ Calibration drag-to-rotate + sliders X/Y/Scale/Rotation par zone
- ✅ Recto/verso animé
- ✅ **Export PNG** haute résolution (téléchargement direct)
- ✅ **Définir comme image d'acteur + token** (uploadé dans `worlds/<world>/cyberpunk-card-editor/`)
- ✅ **Poster dans le chat** comme image partagée à toute la table
- ✅ **Créer une Journal Entry** (handout dans le sidebar, draggable vers les joueurs)
- ✅ Export HTML autonome (copie dans le presse-papier)
- ✅ Layout & overrides sauvegardés en flags sur l'acteur (synchronisés joueurs/MJ)
- ✅ **Support Mook + NPC** : layout simplifié (pas de citation, pas d'humanity, frame générique)

## Installation sur Forge VTT

### Option A — Upload du ZIP (le plus simple)

1. Zippe le dossier `cyberpunk-card-editor/` (le ZIP doit contenir le dossier, pas son contenu directement).
2. Sur la Forge → **Game Manager** → ton monde → **Configuration & Setup** → **Modules**.
3. Bouton **"Install Module"** → **"Upload from your Computer"**.
4. Sélectionne le ZIP, valide.
5. Active le module dans le monde (Modules → coche "Cyberpunk Card Editor" → Save).

### Option B — Manifest URL (si tu héberges sur GitHub)

1. Pousse le repo sur GitHub.
2. Crée une release avec le ZIP en asset.
3. Édite `module.json` : remplace les URLs `manifest` et `download` par les bonnes (raw GitHub).
4. Donne la manifest URL aux installeurs : ils la collent dans le champ "Install Module → Manifest URL".

## Boutons de l'éditeur (panneau de gauche)

| Bouton | Action |
| --- | --- |
| 💾 Sauver | Persiste layout + overrides sur l'acteur (flags). |
| ↻ Recto/Verso | Bascule l'animation 3D du flip. |
| 📷 PNG | Télécharge la carte au format PNG haute-res (scale x2). |
| 🪪 → Token | Upload le PNG dans le monde, le définit comme `actor.img` + token prototype. |
| 💬 Chat | Poste la carte comme image dans le chat (visible par tous). |
| 📓 Journal | Crée une Journal Entry image. Le MJ peut la draguer aux joueurs. |
| 📄 HTML | Copie un HTML autonome dans le presse-papier (ouvrable hors Foundry). |
| 🗑 Reset | Supprime tous les overrides + layout pour cet acteur. |

## Placement des images (frames, backgrounds, versos)

Le module attend les fichiers dans `modules/cyberpunk-card-editor/assets/` avec ces noms :

```
exec_base.png         exec_background.png       exec_verso.png
fixer_base.png        fixer_background.png      fixer_verso.png
lawman_base.png       lawman_background.png     lawman_verso.png
media_base.png        media_background.png      media_verso.png
medtech_base.png      medtech_background.png    medtech_verso.png
netrunner_base.png    netrunner_background.png  netrunner_verso.png
nomad_base.png        nomad_background.png      nomad_verso.png
rockerboy_base.png    rockerboy_background.png  rockerboy_verso.png
solo_base.png         solo_background.png       solo_verso.png
tech_base.png         tech_background.png       tech_verso.png

# Pour les mook/NPC :
mook_base.png         mook_background.png       mook_verso.png
npc_base.png          npc_background.png        npc_verso.png
```

- `*_base.png` = la frame du rôle (transparente sur les zones de texte)
- `*_background.png` = le décor de fond du recto
- `*_verso.png` = le visuel du dos de la carte

Sur Forge tu peux aussi pointer vers ton **Asset Library** :
upload les PNG dans Assets, puis dans l'éditeur utilise les uploads de
fichiers (boutons "Frame override / Background override / Verso") qui acceptent
n'importe quelle image et la stockent en data-URL dans les overrides de l'acteur.

## Utilisation

1. Ouvre une fiche de personnage CP:R (character / mook / npc).
2. Clique sur **🪪 Carte** dans l'en-tête de la fiche.
3. Modifie ce que tu veux dans le panneau de gauche (les changements apparaissent en direct).
4. **💾 Sauver** pour que tout soit persistant entre sessions.
5. **⚙ Calibrer** pour positionner les zones de texte (sélectionne une zone, ajuste les sliders).
6. Choisis ta sortie : **📷 PNG** (perso), **💬 Chat** (table), **📓 Journal** (handout), **🪪 → Token** (remplace l'image de l'acteur).

## Macro alternative

Si tu préfères ouvrir l'éditeur via une macro plutôt que le bouton de fiche :

```js
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Sélectionne un token ou définis ton perso.");
game.modules.get("cyberpunk-card-editor").api.open(actor);
```

## Compatibilité

- Foundry VTT v11, **v12 (testé)**, v13.
- Système : `cyberpunk-red-core` ≥ 0.84.0.
- Le module sonde plusieurs paths de données (`system.stats.*.value`,
  `system.derivedStats.hp.value/max`, etc.) — si une stat n'apparaît pas
  auto-remplie, l'input reste vide, tu la saisis à la main, tu sauves :
  l'override est mémorisé.

## Notes techniques

- **html2canvas 1.4.1** est bundlé localement dans `scripts/lib/` (MIT, ~200 KB).
  Aucune dépendance réseau au runtime.
- **Permissions d'upload** : le bouton **🪪 → Token** nécessite que le joueur soit
  propriétaire (Owner) de l'acteur. Sinon il voit un avertissement.
- **Snapshot 3D** : pendant la capture PNG, la rotation 3D est temporairement
  remise à zéro et la face arrière masquée — la carte capturée est toujours plate
  et propre, même si l'utilisateur l'avait pivotée à l'écran.
- **CORS** : les images locales (`modules/...`, `worlds/...`) passent sans souci.
  Si tu utilises des URLs externes (Asset Library d'une autre Forge, CDN, etc.),
  vérifie que CORS est ouvert, sinon html2canvas tombera en mode "tainted canvas"
  et ne pourra pas générer le PNG.

## Dépannage

- **Le bouton n'apparaît pas sur les fiches** → vérifie que le module est bien
  activé pour le monde. Reload (F5) après activation.
- **Les frames n'apparaissent pas** → les PNG ne sont pas dans `assets/`.
  Soit tu les ajoutes au module (au moment du packaging), soit tu utilises
  les uploads dans l'éditeur (override par acteur).
- **L'auto-rempli est vide pour certaines stats** → version du système plus récente
  que celle pour laquelle le code sonde. Ouvre la console (F12), tape
  `game.actors.get("...").system` pour voir l'arbre, et tu peux ajouter le
  bon path dans `scripts/card-app.js` → `readStat` ou `readPair`.
- **Export PNG échoue avec "Tainted canvas"** → une image vient d'un domaine
  externe sans CORS. Solution : upload-la via un bouton "override" dans l'éditeur
  (elle sera convertie en data-URL et passera sans souci).
- **"🪪 → Token" ne marche pas** → permissions Foundry : seul un Owner ou MJ peut
  modifier `actor.img`. Le module l'avertit dans ce cas.

## Licence

Code : MIT (à toi).
html2canvas : MIT, voir `scripts/lib/html2canvas-LICENSE.txt`.
Le module ne contient aucun asset Cyberpunk RED — les frames et backgrounds
sont à fournir séparément (créations perso ou achetées).
