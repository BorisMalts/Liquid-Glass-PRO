# liquid-glass-pro

**v3.0.0** — WebGL2 physically-based liquid glass rendering for the web.

Real-time Cook-Torrance specular, chromatic aberration, Voronoi caustics, anisotropic GGX, thin-film iridescence, Fresnel, and spring-physics cursor tracking — with an intelligent CSS fallback for every GPU tier.

---

## Table of Contents

- [What's New in v3.0.0](#whats-new-in-v3)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [HTML Usage](#html-usage)
- [React Usage](#react-usage)
- [Configuration Reference](#configuration-reference)
- [Public API](#public-api)
- [CSS Classes & Data Attributes](#css-classes--data-attributes)
- [GPU Tiers & Fallback Strategy](#gpu-tiers--fallback-strategy)
- [Physics Reference](#physics-reference)
- [Performance Notes](#performance-notes)
- [Browser Support](#browser-support)
- [Changelog](#changelog)

---

## What's New in v3.0.0

### §15 — Full Cook-Torrance PBR Specular WebGL2 Pass
The specular system was completely rewritten from a CSS approximation into a real physically-based rendering pipeline running on a dedicated WebGL2 context (`_spec` singleton):

- **Anisotropic GGX NDF** (Burley 2012) with `BASE_ROUGHNESS = 0.04`, `ANISOTROPY = 0.35`
- **Smith height-correlated visibility function** (Heitz 2014)
- **Schlick Fresnel** with exact F0 derived from `GLASS_IOR = 1.52` → F0 ≈ 0.0426
- **Kulla-Conty multi-bounce energy compensation** (2017) via precomputed LUT on `TEXTURE_UNIT2`
- **Thin-film iridescence** (Born & Wolf 1999) with `FILM_THICKNESS = 320 nm`, `FILM_IOR = 1.38`
- **Area light representative-point approximation** (Karis 2013)
- Three-light configuration:
    - `L0` — cursor-tracking warm-white key light (intensity driven by spring physics)
    - `L1` — static cool-blue fill light
    - `L2` — back-scatter violet rim

### §16 — _buildSpecularCSS() CSS Complement
For devices where WebGL2 is unavailable (low GPU tier or init failure), a physically-grounded CSS fallback derived analytically from the §15 constants provides:

- Three analytically-derived GGX lobes matching L0/L1/L2 light directions and colors
- 7-layer `box-shadow` stack synchronized with L0 hover intensity (×1.5 amplification)
- Thin-film iridescence `conic-gradient` fallback on `::after` with Born & Wolf phase offsets
- Reduced-motion safe defaults

### §8 Integration
`_buildCSS()` now consumes `{ before, hover, specCanvas }` from `_buildSpecularCSS()` and injects `specCanvas` overrides for the `.lg-specular-canvas` WebGL overlay.

---

## How It Works

```
User DOM element (.lg)
       │
       ├─ [GPU tier ≥ 2] WebGL2 Caustics + Refraction (§6)
       │    ├─ html2canvas background capture (§5)
       │    ├─ Cook-Torrance BRDF + chromatic aberration GLSL
       │    ├─ Voronoi caustics
       │    └─ Environment reflection + Fresnel
       │
       ├─ [GPU tier ≥ 1] PBR Specular pass (§15)
       │    ├─ Separate WebGL2 context (_spec)
       │    ├─ Anisotropic GGX NDF, Smith visibility, Kulla-Conty LUT
       │    ├─ Thin-film iridescence
       │    └─ .lg-specular-canvas overlay
       │
       ├─ [all tiers] SVG filter bank (§7)
       │    ├─ Chromatic aberration feDisplacementMap
       │    └─ Micro-distortion feTurbulence
       │
       ├─ [all tiers] Spring physics (§4)
       │    └─ Cursor/gyro → --lg-mx / --lg-my / --lg-sa / --lg-sb
       │
       └─ [WebGL unavailable] CSS fallback (§16)
            ├─ ::before  3-lobe GGX radial-gradient
            ├─ :hover    7-layer box-shadow
            └─ ::after   thin-film conic-gradient
```

---

## Installation

```bash
npm install liquid-glass-pro
```

Or via CDN:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/liquid-glass-pro@3/dist/liquid-glass-pro.min.js"></script>
```

---

## Quick Start

### ES Module

```js
import { initLiquidGlass } from 'liquid-glass-pro';

initLiquidGlass({
  selector: '.glass-card',
  tint: 'rgba(255,255,255,0.08)',
  blur: 18,
  interactive: true,
});
```

### CommonJS

```js
const { initLiquidGlass } = require('liquid-glass-pro');

initLiquidGlass({ selector: '.card' });
```

### UMD / Script tag

```html
<script src="liquid-glass-pro.min.js"></script>
<script>
  LiquidGlass.initLiquidGlass({ selector: '.card' });
</script>
```

---

## HTML Usage

Mark elements with `data-lg` for automatic discovery via `MutationObserver` (§12):

```html
<!-- Auto-discovered on DOMContentLoaded -->
<div class="card" data-lg>
  <h2>Hello</h2>
</div>

<!-- With per-element overrides -->
<div class="card" data-lg data-lg-blur="24" data-lg-tint="rgba(0,120,255,0.10)">
  Premium Card
</div>
```

Or wrap programmatically:

```js
import { wrapWithDistortion } from 'liquid-glass-pro';

const el = document.querySelector('.card');
wrapWithDistortion(el, { blur: 20, grain: true });
```

---

## React Usage

```jsx
import { useLiquidGlass } from 'liquid-glass-pro';

function GlassCard({ children }) {
  const ref = useLiquidGlass({
    blur: 20,
    tint: 'rgba(255,255,255,0.07)',
    interactive: true,
    grain: true,
  });

  return (
    <div ref={ref} className="card">
      {children}
    </div>
  );
}
```

The hook (§14) handles attach on mount, detach on unmount, and re-attach when options change.

### Reply Quote Component

```jsx
import { createReplyQuote } from 'liquid-glass-pro';

// Returns a pre-styled glass DOM node — append it wherever needed
const quote = createReplyQuote({
  author: 'Alice',
  text: 'The refraction looks incredible!',
  tint: 'rgba(120,200,255,0.10)',
});
document.querySelector('.thread').appendChild(quote);
```

---

## Configuration Reference

All options can be passed to `initLiquidGlass()`, `attachElement()`, `useLiquidGlass()`, or as `data-lg-*` attributes.

| Option | Type | Default | Description |
|---|---|---|---|
| `selector` | `string` | `'[data-lg]'` | CSS selector for auto-discovery |
| `blur` | `number` | `18` | Backdrop blur radius in px |
| `tint` | `string` | `'rgba(255,255,255,0.06)'` | Background tint color |
| `interactive` | `boolean` | `true` | Enable cursor spring physics |
| `grain` | `boolean` | `false` | Add film grain overlay layer |
| `refraction` | `boolean` | `true` | Enable WebGL2 refraction (GPU tier ≥ 2) |
| `specular` | `boolean` | `true` | Enable PBR specular pass (GPU tier ≥ 1) |
| `caustics` | `boolean` | `true` | Enable Voronoi caustics |
| `iridescence` | `boolean` | `true` | Enable thin-film iridescence |
| `chromaticAberration` | `number` | `1.0` | Chromatic aberration intensity (0–3) |
| `springStiffness` | `number` | `180` | Spring stiffness (cursor tracking) |
| `springDamping` | `number` | `18` | Spring damping |
| `gyro` | `boolean` | `false` | Use device orientation instead of cursor |
| `refreshOnResize` | `boolean` | `true` | Re-capture background on resize |
| `autoDiscover` | `boolean` | `true` | Watch DOM for new `[data-lg]` elements |

### `data-lg-*` Attribute Mapping

```html
<div data-lg
     data-lg-blur="24"
     data-lg-tint="rgba(0,0,0,0.12)"
     data-lg-grain="true"
     data-lg-refraction="false"
     data-lg-chromatic-aberration="2">
```

---

## Public API

### `initLiquidGlass(options?)` → `void`
Initialise the library and attach to all matching elements. Safe to call multiple times — subsequent calls update global options and re-attach.

```js
initLiquidGlass({ selector: '.lg', blur: 20 });
```

### `destroyLiquidGlass()` → `void`
Detach all elements, destroy WebGL contexts, cancel rAF loop, disconnect MutationObserver.

```js
destroyLiquidGlass();
```

### `attachElement(el, options?)` → `void`
Attach the glass effect to a single DOM element, optionally overriding global options.

```js
attachElement(document.querySelector('#hero'), { blur: 30, grain: true });
```

### `detachElement(el)` → `void`
Remove the glass effect from a single element and clean up its WebGL resources.

```js
detachElement(document.querySelector('#hero'));
```

### `wrapWithDistortion(el, options?)` → `HTMLElement`
Wraps `el` in a `.lg` container, attaches the effect, and returns the wrapper.

```js
const wrapper = wrapWithDistortion(myCard, { interactive: true });
```

### `createGrainLayer()` → `HTMLElement`
Creates a standalone SVG-based film grain `<div>` you can append anywhere.

```js
document.body.appendChild(createGrainLayer());
```

### `createReplyQuote(options)` → `HTMLElement`
Creates a pre-styled glass reply-quote bubble. Options: `{ author, text, tint, avatarUrl }`.

### `refreshBackground(el?)` → `Promise<void>`
Re-captures the background for one element (or all if omitted). Call after layout changes.

```js
await refreshBackground(document.querySelector('.card'));
```

### `getGpuTier()` → `0 | 1 | 2`
Returns the detected GPU capability tier.

| Tier | Meaning |
|------|---------|
| `0` | CSS-only fallback |
| `1` | WebGL2 specular pass only |
| `2` | Full WebGL2 (refraction + caustics + specular) |

```js
if (getGpuTier() === 2) console.log('Full WebGL2 active');
```

### `isRefractionActive()` → `boolean`
Returns `true` if the WebGL2 refraction/caustics pass is currently running.

### `getOptions()` → `Options`
Returns the current merged global options object.

### `version` → `string`
```js
import { version } from 'liquid-glass-pro';
console.log(version); // '3.0.0'
```

### `useLiquidGlass(options?)` → `React.RefObject`
React hook (§14). Attaches on mount, detaches on unmount, re-runs when options reference changes.

---

## CSS Classes & Data Attributes

### Classes applied by the library

| Class | Applied to | Meaning |
|---|---|---|
| `.lg` | wrapper element | Root glass element |
| `.lg-interactive` | wrapper | Cursor-tracking enabled |
| `.lg-grain` | wrapper | Grain layer present |
| `.lg-specular-canvas` | `<canvas>` inside `.lg` | WebGL2 specular overlay |

### Data attributes set by the library

| Attribute | Value | Meaning |
|---|---|---|
| `data-lg-webgl` | `""` (present) | WebGL2 specular pass is active |
| `data-lg-refraction` | `""` (present) | WebGL2 refraction pass is active |
| `data-lg-tier` | `"0"` / `"1"` / `"2"` | Detected GPU tier |

### CSS custom properties (Houdini, §3)

These are set per-frame by the spring physics system and can be consumed in custom CSS:

| Property | Description |
|---|---|
| `--lg-mx` | Cursor X position (0–1, spring-smoothed) |
| `--lg-my` | Cursor Y position (0–1, spring-smoothed) |
| `--lg-sa` | Spring stretch axis A |
| `--lg-sb` | Spring stretch axis B |
| `--lg-vx` | Spring velocity X |
| `--lg-vy` | Spring velocity Y |

Example — custom shimmer tied to cursor:

```css
.lg::before {
  background: radial-gradient(
    ellipse at calc(var(--lg-mx) * 100%) calc(var(--lg-my) * 100%),
    rgba(255,255,255,0.18) 0%,
    transparent 60%
  );
}
```

---

## GPU Tiers & Fallback Strategy

The library auto-detects GPU capability (§2) at init time and selects the appropriate rendering path.

### Tier 2 — Full WebGL2
*Requires: WebGL2, floating-point textures, `EXT_color_buffer_float`*

- html2canvas background capture → WebGL2 refraction + chromatic aberration
- Voronoi caustics
- Cook-Torrance PBR specular pass (§15)
- SVG filter bank
- All CSS spring props

### Tier 1 — Specular Only
*Requires: WebGL2 context (but no float textures / caustics)*

- PBR specular pass only (§15) — `data-lg-webgl` attribute set
- SVG filter bank
- CSS spring props
- No background refraction

### Tier 0 — CSS Fallback
*Fallback when WebGL2 unavailable or context creation fails*

- `_buildSpecularCSS()` (§16) — three analytically-derived GGX lobes on `::before`
- 7-layer `box-shadow` hover highlight
- Thin-film iridescence `conic-gradient` on `::after`
- SVG filter bank (chromatic aberration, micro-distortion)
- CSS spring props (cursor tracking still works)

All visual effects degrade gracefully: the element still looks like glass at every tier.

---

## Physics Reference

### Glass Constants (§15)

| Constant | Value | Source |
|---|---|---|
| `GLASS_IOR` | 1.52 | Borosilicate glass |
| `GLASS_F0` | ≈ 0.0426 | `((IOR−1)/(IOR+1))²` |
| `FILM_THICKNESS` | 320 nm | Anti-reflective coating |
| `FILM_IOR` | 1.38 | MgF₂ coating |
| `BASE_ROUGHNESS` | 0.04 | Near-specular glass surface |
| `ANISOTROPY` | 0.35 | Burley 2012 tangent stretch |

### Specular Model

**BRDF** = D(h) · G(l,v) · F(v,h) / (4·(n·l)·(n·v))

- **D** — Anisotropic GGX NDF (Burley 2012)  
  `αT = BASE_ROUGHNESS / (1 − ANISOTROPY)` → 0.0483  
  `αB = BASE_ROUGHNESS · (1 − ANISOTROPY)` → 0.0331

- **G** — Smith height-correlated masking-shadowing (Heitz 2014)

- **F** — Schlick Fresnel: `F0 + (1−F0)·(1−(v·h))⁵`

- **Multi-bounce** — Kulla-Conty (2017) LUT on `TEXTURE_UNIT2` compensates for energy loss in single-scattering GGX

### Thin-Film Iridescence (Born & Wolf 1999)

OPD = 2 · `FILM_IOR` · `FILM_THICKNESS` = **883.2 nm**

Phase shifts per wavelength channel used for CSS hue stops (§16.C):

| Channel | λ (nm) | Δφ vs R |
|---------|--------|---------|
| R | 630 | 0° |
| G | 530 | ≈ 120° |
| B | 450 | ≈ 240° |

### Spring Physics (§4)

Second-order critically-damped spring:

```
a = stiffness · (target − pos) − damping · vel
vel += a · dt
pos += vel · dt
```

Default: `stiffness = 180`, `damping = 18` (ζ ≈ 0.67, slightly underdamped for snappy feel).

---

## Performance Notes

- The WebGL2 specular pass uses a **single shared `_spec` context** across all `.lg` elements — one context regardless of how many glass elements are on screen.
- The rAF loop (§11) runs only when at least one `.lg` element is visible in the viewport (IntersectionObserver-gated).
- `refreshBackground()` triggers an html2canvas re-capture, which is expensive (~16–80 ms depending on DOM complexity). Call it only after significant layout changes, not per-frame.
- On mobile, consider `gyro: true` to use device orientation instead of cursor tracking — this saves a mousemove listener and produces more natural motion.
- The Kulla-Conty LUT is a 64×64 RG16F texture computed once at `initSpecularPass()` and cached for the lifetime of the page.
- If you have more than ~20 glass elements, disable `refraction` on non-critical ones: `data-lg-refraction="false"`. The specular-only path (tier 1) is ~10× cheaper.

---

## Browser Support

| Browser | WebGL2 Specular | Refraction | CSS Fallback |
|---------|----------------|------------|--------------|
| Chrome 90+ | ✅ | ✅ | ✅ |
| Firefox 90+ | ✅ | ✅ | ✅ |
| Safari 16.4+ | ✅ | ✅ | ✅ |
| Safari 15 | ✅ (tier 1) | ❌ | ✅ |
| iOS Safari 16+ | ✅ | ✅ | ✅ |
| iOS Safari 15 | ❌ | ❌ | ✅ |
| Samsung Internet | ✅ | ✅ | ✅ |

`EXT_color_buffer_float` is required for the refraction pass. All browsers that lack it fall back gracefully to tier 1 or tier 0.

---

## Changelog

### v3.0.0
- **§15** — Full Cook-Torrance PBR specular WebGL2 pass replacing the CSS approximation
    - Anisotropic GGX NDF (Burley 2012)
    - Smith height-correlated visibility (Heitz 2014)
    - Kulla-Conty multi-bounce energy compensation (2017)
    - Thin-film iridescence (Born & Wolf 1999)
    - Area light representative-point (Karis 2013)
    - Three-light config: L0 cursor warm-white, L1 fill cool-blue, L2 back-scatter violet
- **§16** — `_buildSpecularCSS()` — physically-grounded CSS fallback derived analytically from §15 constants
    - Three GGX-lobe `radial-gradient` on `::before` (Lobe A: L0 GGX peak, Lobe B: L1 fill shoulder, Lobe C: L2 back-scatter)
    - 7-layer `box-shadow` on `:hover` synchronized with L0 intensity ×1.5
    - Thin-film iridescence `conic-gradient` on `::after` with Born & Wolf phase offsets
    - Reduced-motion safe guards
- **§8** `_buildCSS()` updated to consume `{ before, hover, specCanvas }` from `_buildSpecularCSS()`
- `.lg-specular-canvas` transition easing aligned with spring `stiffness=180 / damping=18` → `cubic-bezier(0.34, 1.20, 0.64, 1)`

### v3.0.0
- WebGL2 caustics + refraction pass (§6)
- Cook-Torrance GLSL shader (pre-PBR approximation)
- Chromatic aberration + micro-distortion SVG filter bank (§7)
- html2canvas background capture engine (§5)
- Device orientation / gyroscope support (§9)
- `createReplyQuote()` helper
- React hook adapter `useLiquidGlass` (§14)

### v1.x
- CSS-only glass effect
- Spring physics cursor tracking
- Grain layer
- MutationObserver auto-discovery

---

## License

MIT © 2025–2026