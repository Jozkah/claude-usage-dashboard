---
version: 1
slug: "design-proposals"
primary_target: "design-proposals"
related_targets: []
---

# Surface brief: design-proposals (three dashboard redesign proposals)

Mode: Operate. Visitor completes a task: see which account has room, then what was spent. Brief-pinned: three fully different proposals drawn from getlayers.ai, curated.design, 60fps.design, refero.design, reactbits.dev, auragradients and lucide icons. Static HTML, code-led. Sample data is synthetic and labelled.

## Direction contract

### A. Ledger
THESIS: the answer is a fuel gauge, not a ring; the page refuses the card grid and reads as one long ruled list.
OWN-WORLD: #f2f2f0 ground, white rows, near-black ink, one signal orange used only for limits near the edge; Inter; huge ghost wordmark behind a sticky pill nav (60fps).
STORY: scan five rows, see which tank is fullest, then read spend underneath.
FIRST VIEWPORT: ghost "LIMITS" wordmark, pill nav, then five account rows each with a liquid tank gauge, percent and reset; best account row marked "Use next".
FORM: single centred 880px column; slosh-gauge liquid fill, spring-eased count-up.
### B. Daylight
THESIS: the weather is the data; the page background is a blend-mode gradient that warms as headroom shrinks.
OWN-WORLD: layered sky gradient on cream, frosted panels, grain, Bricolage Grotesque + Hanken Grotesk, ink-brown text; account chosen drives the sky (Aura).
STORY: pick an account tile, the whole page shifts to its mood, the hero number says how much is left.
FIRST VIEWPORT: left a giant remaining-percent for the selected account over the sky, right a stack of account tiles; chart sits under as a skyline.
FORM: asymmetric 5/7 split, pointer-driven gradient parallax.
### C. Command Wall
THESIS: a bento wall of live tiles with a particle orb that is literally the headroom: dots remaining equal percent left.
OWN-WORLD: forest-black #08120e, ivory text, chartreuse #c8f169 flat accent, hairline borders, JetBrains-free: Space-free: "Sora" display, "Manrope" body; dock rail with Lucide icons, spotlight border that follows the cursor (reactbits).
STORY: orb answers the question, tiles drill down.
FIRST VIEWPORT: dock rail left, particle orb tile spanning two rows, account tiles, usage tile.
FORM: 12-col bento, canvas particles, dock magnification.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
