# ◆ Liquid Glass PRO

> The browser's most physically accurate glass effect. Real Snell's law refraction, Voronoi caustics, spring physics, and iridescence — all in a single zero-framework JS file.

![Screenshot 2026-03-05 at 15 09 19](https://github.com/user-attachments/assets/7cd030bf-b4a7-479a-83ae-bccd678e2d72)

![Version](https://img.shields.io/badge/version-2.0.0-a084f0?style=flat-square)
![Previous](https://img.shields.io/badge/prev-v1.1.1-6366f1?style=flat-square&logo=github)
![WebGL2](https://img.shields.io/badge/WebGL2-required%20for%20caustics-4f46e5?style=flat-square)
![License](https://img.shields.io/badge/license-Apache%202.0-22c55e?style=flat-square)
![Dependencies](https://img.shields.io/badge/dependencies-1%20(html2canvas)-f59e0b?style=flat-square)
![Size](https://img.shields.io/badge/size-~18kb%20gzipped-0ea5e9?style=flat-square)
![SSR](https://img.shields.io/badge/SSR-safe-34d399?style=flat-square)

> **Upgrading from v1.1.1?** See the [migration table](#whats-new-in-v2-vs-v111) — the API is additive. Existing `class="lg"` markup works without any changes.

---

## Table of contents

- [What's new in v2](#whats-new-in-v2-vs-v111)
- [Competitor comparison](#what-it-beats-from-competitors)
- [Quick start](#quick-start)
- [HTML usage](#html-usage)
- [React / Vue / Svelte](#framework-usage)
- [How real refraction works](#how-real-refraction-works)
- [Physics deep-dive](#physics-deep-dive)
- [Configuration reference](#configuration-reference)
- [CSS class reference](#css-class-reference)
- [JavaScript API](#javascript-api)
- [Performance guide](#performance-guide)
- [Browser support](#browser-support)
- [GPU tiers explained](#gpu-tiers-explained)
- [SPA & Shadow DOM](#spa--shadow-dom)
- [Why a Python server?](#why-a-python-server)
- [Architecture overview](#architecture-overview)
- [Shader pipeline](#shader-pipeline)
- [FAQ](#faq)
- [License](#license)

---

## What's new in v2 vs v1.1.1

| Feature | v1.1.1 | v2.0.0 |
|---|---|---|
| Screen-space refraction | SVG `feDisplacementMap` (illusory) | **Real** — html2canvas DOM capture → WebGL2 texture → Snell's law UV displacement per pixel |
| Chromatic dispersion | Caustic-layer only | + Per-channel IOR at refraction (Cauchy model: Δn R/B = ±0.018) |
| Environment reflection | ✗ | ✅ Fresnel-weighted mirror probe of background at grazing incidence |
| Surface normals | Flat Schlick normal | Bump-map from gradient noise, mouse-warped on hover |
| Background updates | — | Scroll (debounced 150ms), resize, configurable interval |
| Config API | Hardcoded shader constants | Full `LGOptions` object with 10 fields |
| React hook | ✗ | ✅ `useLiquidGlass(ref)` — attach on mount, cleanup on unmount |
| Vue composable | ✗ | ✅ Works with `onMounted` / `onUnmounted` |
| SSR safety | ✗ (DOM at import) | ✅ No DOM access at import time — safe in Next.js, Nuxt, SvelteKit |
| Background capture scale | — | Configurable `bgCaptureScale` (default 35% for performance) |
| Scroll drift compensation | — | `u_scroll` uniform corrects UV drift between capture and render |
| Zero flicker on recapture | — | Previous texture stays active during async html2canvas call |

---

## Quick start

```bash
# Clone the project
git clone https://github.com/BorisMalts/Liquid-Glass-PRO
cd Liquid-Glass-PRO

# Install the only dependency (html2canvas)
npm install

# Launch development server
python run.py
# → http://localhost:8080/demo.html opens automatically
```

No bundler required. The library is a plain ES module — import it directly in a `<script type="module">` tag.

---

## HTML usage

### 1. Load html2canvas

```html
<!-- Option A: npm (recommended for production) -->
<script src="node_modules/html2canvas/dist/html2canvas.min.js"></script>

<!-- Option B: CDN (no install needed) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

html2canvas **must** load before `initLiquidGlass()` is called. It doesn't need to be `await`-ed — the first background capture is async and non-blocking.

### 2. Mark your glass elements

Add `class="lg"` to any element. Combine with variant classes:

```html
<!-- Interactive card -->
<div class="lg lg-card lg-interactive">
  <h2>The background behind this card bends through Snell's law.</h2>
  <p>Hover slowly to see the photo geometry shift.</p>
</div>

<!-- Pill chip -->
<span class="lg lg-pill lg-interactive">New feature</span>

<!-- Floating action button -->
<button class="lg lg-fab lg-interactive">✦</button>

<!-- Chat bubble (received) -->
<div class="lg lg-interactive">Hey, did you see the refraction?</div>

<!-- Chat bubble (own / sent) — purple tint -->
<div class="lg lg-own lg-interactive">Yes — it's real Snell's law!</div>

<!-- Reply-quote widget -->
<div class="lg lg-reply lg-interactive">
  <span class="lg-sender">Alice</span>
  <span class="lg-text">Did you see the refraction?</span>
</div>
```

### 3. Initialise

```html
<script type="module">
  import { initLiquidGlass } from './liquid-glass-pro.js';

  initLiquidGlass({
    ior:                 1.45,   // index of refraction  (1.0 = air, 1.5 = glass)
    refractionStrength:  0.035,  // UV displacement magnitude
    aberrationStrength:  1.6,    // SVG chromatic aberration px (high GPU tier)
    bgCaptureInterval:   600,    // ms between background recaptures
    bgCaptureScale:      0.35,   // capture resolution = 35% of screen (fast)
    caustics:            true,   // WebGL Voronoi caustic simulation
    grain:               true,   // film grain overlay
    iridescence:         true,   // thin-film conic gradient
    breathe:             true,   // organic border-radius animation
    selector:            '.lg',  // CSS selector for auto-attach
  });
</script>
```

That's it. Every element with `class="lg"` already in the DOM — and any added dynamically — will receive the full effect automatically via `MutationObserver`.

---

## Framework usage

### React

```jsx
import { useRef } from 'react';
import { initLiquidGlass, useLiquidGlass } from './liquid-glass-pro.js';

// Call once at app root — before any component renders
initLiquidGlass({ ior: 1.45, refractionStrength: 0.04 });

// Hook: auto-attach on mount, auto-detach on unmount
function GlassCard({ children }) {
  const ref = useRef(null);
  useLiquidGlass(ref);

  return (
    <div ref={ref} className="lg lg-card lg-interactive">
      {children}
    </div>
  );
}

// Or: use the class and let MutationObserver pick it up automatically
function GlassButton({ label }) {
  return (
    <button className="lg lg-pill lg-interactive">
      {label}
    </button>
  );
}
```

`useLiquidGlass(ref)` reads `window.React` at call time — no hard peer-dependency. Works with React 16.8+, Preact, and any React-compatible runtime.

### Vue 3

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { initLiquidGlass, attachElement, detachElement } from './liquid-glass-pro.js';

initLiquidGlass({ ior: 1.45 });

const cardRef = ref(null);
onMounted(()   => attachElement(cardRef.value));
onUnmounted(() => detachElement(cardRef.value));
</script>

<template>
  <div ref="cardRef" class="lg lg-card lg-interactive">
    <slot />
  </div>
</template>
```

### Svelte

```svelte
<script>
  import { onMount, onDestroy } from 'svelte';
  import { initLiquidGlass, attachElement, detachElement } from './liquid-glass-pro.js';

  initLiquidGlass({ ior: 1.45 });

  let el;
  onMount(()   => attachElement(el));
  onDestroy(() => detachElement(el));
</script>

<div bind:this={el} class="lg lg-card lg-interactive">
  <slot />
</div>
```

### Next.js / Nuxt (SSR)

```js
// pages/_app.js  (Next.js) or plugins/glass.client.js (Nuxt)
import { initLiquidGlass } from './liquid-glass-pro.js';

if (typeof window !== 'undefined') {
  // Only runs in the browser — library is SSR-safe
  initLiquidGlass({ ior: 1.45 });
}
```

The library checks `typeof window` at every internal DOM access — it will never throw during server-side rendering.

---

## How real refraction works

```
┌──────────────────────────────────────────────────────────────────────┐
│                    BACKGROUND CAPTURE PIPELINE                       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  html2canvas renders document.documentElement               │     │
│  │  at bgCaptureScale = 35%  (default)                         │     │
│  │                                                             │     │
│  │  1920 × 1080 screen  →  672 × 378 capture canvas            │     │
│  │  ~8× fewer pixels than full-res → 8–25ms on modern laptop   │     │
│  │                                                             │     │
│  │  Glass elements are excluded via ignoreElements callback    │     │
│  │  to prevent visual self-referential feedback loop.          │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  gl.texImage2D() uploads the canvas to WebGL2 texture unit 1│     │
│  │  Previous texture stays active during upload → no flicker   │     │
│  │  gl.generateMipmap() → LINEAR_MIPMAP_LINEAR filtering       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Per frame in the WebGL2 fragment shader (per pixel):       │     │
│  │                                                             │     │
│  │  a. surfaceNormal(uv)                                       │     │
│  │       Finite-difference gradient of animated noise field    │     │
│  │       → perturbed normal N in view space                    │     │
│  │                                                             │     │
│  │  b. refractUV(screenUV, N)                                  │     │
│  │       Snell's law:  delta_uv = N.xy * (1/IOR) * strength    │     │
│  │       + device/cursor tilt contribution * 0.4               │     │
│  │                                                             │     │
│  │  c. chromaticRefraction(uv, N)                              │     │
│  │       Cauchy dispersion — three IOR offsets:                │     │
│  │         R  →  IOR − 0.010  (refracts least  ~1.440)         │     │
│  │         G  →  IOR          (reference       ~1.450)         │     │
│  │         B  →  IOR + 0.018  (refracts most   ~1.468)         │     │
│  │       Each channel samples texture at its own displaced UV  │     │
│  │                                                             │     │
│  │  d. environmentReflection(uv, N, fr)                        │     │
│  │       At high Fresnel factor (grazing angles / edges):      │     │
│  │       mirror-sample background horizontally → reflection    │     │
│  │                                                             │     │
│  │  e. Blend refracted background into caustic composite       │     │
│  │       weight = smoothstep(centre→edge) * 0.28 * bgReady     │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Recapture triggers:                                        │     │
│  │    • setInterval every bgCaptureInterval ms (default 600)   │     │
│  │    • window 'scroll' debounced at 150ms                     │     │
│  │    • ResizeObserver on document.body                        │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

**Why not `readPixels` from the page compositor?**
`readPixels` on the browser's compositor framebuffer is blocked for security — a malicious page could steal pixel data from cross-origin iframes. html2canvas is the highest-fidelity same-origin DOM capture technique available inside the browser sandbox.

**Why not CSS `element()` function?**
`element()` is non-standard, implemented only in Firefox, and provides a live texture reference without the UV displacement necessary for true refraction. It also cannot be used as a WebGL texture source directly.

**Scroll drift compensation:**
When the user scrolls between a background capture and the current render frame, the screen-space UVs computed by the shader become stale. The shader receives `u_scroll` — the normalised scroll delta since last capture — and adds it to every UV lookup, keeping refracted content visually correct throughout scroll inertia.

---

## Physics deep-dive

### Spring integration

All animated values (cursor position, hover blend, 3D tilt) use a **damped harmonic oscillator** advanced with symplectic (semi-implicit) Euler integration:

```
F  = −k·(x − target) − d·v      spring + damping force
a  = F / m
v += a · dt                      velocity updated FIRST (symplectic stability)
x += v · dt
```

Why symplectic Euler over standard explicit Euler? Explicit Euler has positive energy drift — springs slowly accumulate energy and oscillate forever or diverge. Symplectic Euler conserves energy to first order, giving stable oscillations that naturally decay to rest.

Three independent presets are used:

| Spring | Stiffness | Damping | Mass | Character |
|---|---|---|---|---|
| `cursor` | 180 | 18 | 1.0 | Snappy — tracks pointer closely |
| `hover` | 120 | 14 | 1.0 | Smooth fade in/out on enter/leave |
| `tilt` | 90 | 12 | 1.2 | Lazy, weighty — gyro and 3D lean |

`MAX_DT = 0.05s` clamps the integration step — prevents a single huge advance when the tab returns from background, which would otherwise snap all springs instantly to target.

### Voronoi caustics

Real underwater caustics form because the water surface acts as a lens — parallel rays converge at Voronoi cell edges, producing bright bands. The simulation:

```
1. Tile space into animated Voronoi cells
   - Seed points move sinusoidally with per-cell frequency variation
   - hash2() gives pseudo-random per-cell velocities

2. For each pixel: minD = distance to nearest seed point

3. causticBand() = pow(smoothstep(0.0, 0.30, minD), 1.5)
   - Bright near cell edges (where real caustics peak)
   - The 1.5 exponent increases contrast

4. Four scales blended (3.4, 5.9, 2.1, 8.1) with different speeds
   - Breaks periodicity at every zoom level
   - Avoids the "tiled look" of single-scale Voronoi
```

### Schlick Fresnel

```glsl
fr(θ) = F₀ + (1 − F₀) · (1 − cosθ)⁵

F₀ = ((n₁ − n₂) / (n₁ + n₂))²
   ≈ 0.04  (air-to-glass interface, n₁=1.0, n₂=1.5)
```

At normal incidence (θ=0°) the surface is mostly transparent (4% reflection). At grazing incidence (θ→90°) the surface is fully reflective (100%). This correctly produces brighter edges and dimmer centres, matching real glass behaviour.

### Cauchy chromatic dispersion

Real glass has a wavelength-dependent index of refraction described by the Cauchy equation:

```
n(λ) = A + B/λ²
```

For typical borosilicate glass:
- Red   (700 nm): n ≈ 1.440
- Green (550 nm): n ≈ 1.450  ← reference
- Blue  (450 nm): n ≈ 1.468

Each channel refracts to a slightly different UV, producing the characteristic rainbow fringing (lateral chromatic aberration) visible at glass edges.

---

## Configuration reference

```js
initLiquidGlass({

  // ── Refraction (new in v2) ───────────────────────────────────────────
  ior: 1.45,
  // Index of refraction. Physical reference values:
  //   1.00  air / vacuum
  //   1.33  water
  //   1.45  borosilicate glass (Pyrex, optical glass)   ← default
  //   1.52  soda-lime glass (windows, bottles)
  //   1.72  flint glass (high-dispersion optical)
  //   2.42  diamond
  // Higher values = stronger bending. Reasonable range: 1.0 – 2.0.

  refractionStrength: 0.035,
  // Scales the UV displacement in the refraction shader.
  //   0.01  very subtle, barely visible
  //   0.03  natural glass feel              ← default
  //   0.05  dramatic
  //   0.08  funhouse-mirror territory

  aberrationStrength: 1.6,
  // SVG feDisplacementMap scale in CSS pixels applied to .lg-outer wrappers.
  // Affects the chromatic colour fringe at glass element boundaries.
  // High GPU tier: full value. Mid tier: ×0.5. Low tier: filter disabled.
  // Keep ≤ 2.0 to avoid "zebra stripe" artefacts on text content.

  bgCaptureInterval: 600,
  // Milliseconds between periodic html2canvas background recaptures.
  //   200–400ms   for fast-changing UIs (video, live data feeds)
  //   600ms       balanced default
  //  1000–2000ms  for mostly static pages
  // Set to a very large number to disable periodic capture (use refreshBackground() manually).

  bgCaptureScale: 0.35,
  // Resolution multiplier for the background capture canvas.
  //   1920×1080 at 0.35 → captures 672×378 (~0.25 MP)
  //   1920×1080 at 1.00 → captures 1920×1080 (~2.1 MP)
  // Performance vs quality:
  //   0.20  fastest, noticeably blurry refraction detail
  //   0.35  good balance                    ← default
  //   0.50  sharper detail, ~2× CPU cost vs 0.35
  //   0.75  very sharp, suitable for hero elements only
  //   1.00  pixel-perfect, expensive — pair with long bgCaptureInterval

  // ── Visual layers ────────────────────────────────────────────────────
  caustics: true,
  // Enable the WebGL2 Voronoi caustic overlay.
  // When false, the overlay <canvas> is still created (used for refraction blit)
  // but the Voronoi caustic contribution is not rendered.

  grain: true,
  // Inject a .lg-grain film-grain overlay into each element.
  // Animated fractal noise at 9 fps — adds tactile analogue texture.
  // Invisible at default opacity (0.038) but perceptible under close inspection.

  iridescence: true,
  // Enable the .lg::after conic-gradient thin-film iridescence animation.
  // Controls whether the lg-breathe keyframe is injected alongside lg-irid-spin.

  breathe: true,
  // Enable the lg-breathe border-radius morphing animation (9s cycle).
  // When false the @keyframes block is omitted entirely from the stylesheet.

  // ── Advanced ─────────────────────────────────────────────────────────
  selector: '.lg',
  // CSS selector used by MutationObserver and the initial querySelectorAll.
  // Change to use a custom class name or data attribute:
  //   selector: '[data-glass]'
  //   selector: '.my-glass-component'

});
```

---

## CSS class reference

### Base + variants

| Class | Role | Key styles |
|---|---|---|
| `lg` | **Required.** Base glass element | `backdrop-filter`, `box-shadow`, Houdini custom properties |
| `lg-interactive` | Cursor tracking + hover / active states | `cursor: pointer`, hover brightness lift |
| `lg-card` | Padded content card | `border-radius: 22px`, `padding: 20px` |
| `lg-pill` | Full-radius chip / tag | `border-radius: 999px`, `padding: 6px 18px` |
| `lg-fab` | Circular floating action button | `border-radius: 50%`, `56×56px` |
| `lg-reply` | Reply-quote widget for chat UIs | Compact padding, 2.5px left accent stripe |
| `lg-own` | "Own message" purple-tint variant | Purple ambient fill + lavender shadow |

### Effect layers (auto-injected)

| Class | z-index | Role |
|---|---|---|
| `lg-caustic-canvas` | 4 | WebGL caustics overlay, `mix-blend-mode: screen` |
| `lg-grain` | 3 | Film grain, `mix-blend-mode: soft-light` |
| `lg::after` | 2 | Iridescent conic gradient rotation |
| `lg::before` | 1 | Cursor-following specular highlight |

### z-index stack inside `.lg`

```
z-index 5  ← your content (text, icons, buttons)
z-index 4  ← .lg-caustic-canvas  (WebGL caustics, blend: screen)
z-index 3  ← .lg-grain           (film grain, blend: soft-light)
z-index 2  ← .lg::after          (iridescence conic gradient)
z-index 1  ← .lg::before         (cursor specular highlight)
z-index 0  ← .lg base            (glass material, backdrop-filter)
```

### Composing classes

```html
<div class="lg lg-card lg-interactive">Card</div>
<span class="lg lg-pill lg-interactive">Chip</span>
<button class="lg lg-fab lg-interactive">＋</button>

<!-- Chat UI -->
<div class="lg lg-interactive">Received bubble</div>
<div class="lg lg-own lg-interactive">Sent bubble</div>
<div class="lg lg-reply">
  <span class="lg-sender">Name</span>
  <span class="lg-text">Quoted message preview</span>
</div>
```

### Custom CSS properties

```css
/* Override spring-animated properties with static values */
.my-element {
  --lg-mx:    75%;    /* highlight hot-spot X */
  --lg-my:    20%;    /* highlight hot-spot Y */
  --lg-hover: 0.8;   /* semi-hovered appearance */
  --lg-irid:  45deg;  /* iridescence start angle */
}

/* Custom border-radius variant */
.lg.my-sharp-card {
  border-radius: 8px;
  animation: lg-irid-spin 15s linear infinite; /* keep irid, no breathe */
}
```

---

## JavaScript API

### Core lifecycle

```js
import { initLiquidGlass, destroyLiquidGlass } from './liquid-glass-pro.js';

// Initialise — call once at app entry point.
// Idempotent: subsequent calls are no-ops.
initLiquidGlass(options?: Partial<LGOptions>): void

// Full teardown.
// Removes: event listeners, RAF loop, MutationObserver,
// injected <style>, <svg>, WebGL canvas. Resets all state.
// Safe to call before re-initialising on SPA navigation.
destroyLiquidGlass(): void
```

### Per-element control

```js
import {
  attachElement, detachElement,
  wrapWithDistortion, createGrainLayer, createReplyQuote,
} from './liquid-glass-pro.js';

// Manually attach glass effect — use for Shadow DOM elements
// that MutationObserver can't see.
// initLiquidGlass() must have been called first.
attachElement(el: HTMLElement): void

// Remove all glass machinery from an element.
// Cleans up: canvas, grain, listeners, ResizeObserver, CSS vars.
detachElement(el: HTMLElement): void

// Wrap element in .lg-outer for SVG aberration filter.
// Returns { wrapper, unwrap } — call unwrap() to restore original DOM.
wrapWithDistortion(el: HTMLElement): { wrapper: HTMLElement, unwrap: () => void }

// Create a standalone .lg-grain div.
createGrainLayer(): HTMLDivElement

// Create a .lg-reply chat quote element.
//   sender  — display name
//   text    — quoted message preview
//   isOwn   — true for purple .lg-own tint (default: false)
//   onClick — optional click handler
createReplyQuote(
  sender:   string,
  text:     string,
  isOwn?:   boolean,
  onClick?: ((e: MouseEvent) => void) | null
): HTMLDivElement
```

### Background refraction

```js
import { refreshBackground, isRefractionActive } from './liquid-glass-pro.js';

// Force an immediate background capture.
// Returns Promise<void> that resolves after texture upload completes.
// Use after significant DOM changes your bgCaptureInterval would miss:
//   modal open, route transition, dynamic content load, etc.
refreshBackground(): Promise<void>

// Returns true once at least one capture has completed.
// Use to gate refraction-dependent UI or show a loading indicator.
isRefractionActive(): boolean
```

### Diagnostics

```js
import { getGpuTier, getOptions, version } from './liquid-glass-pro.js';

// Detected GPU tier — result is memoised, O(1) after first call.
getGpuTier(): 'high' | 'mid' | 'low'

// Shallow copy of current resolved LGOptions (safe to log).
getOptions(): LGOptions

// Library version string.
version(): '2.0.0'
```

### React hook

```js
import { useLiquidGlass } from './liquid-glass-pro.js';

// Attach on mount, detach on unmount.
// Calls initLiquidGlass() automatically if not already called.
// Reads window.React — no hard import dependency.
// Requires React 16.8+.
useLiquidGlass(ref: React.RefObject<HTMLElement>): void
```

---

## Performance guide

### Benchmark (1920×1080, MacBook Pro M2)

| Metric | Value |
|---|---|
| html2canvas capture at 35% scale | 8–18ms |
| WebGL render per element per frame | ~0.2ms |
| CSS custom property updates per element per frame | 6 × `setProperty()` |
| Memory per attached element (incl. canvas) | ~1.2 MB |
| Memory for background texture at 35% of 1080p | ~1.0 MB |

### Tuning for many elements / low-power

```js
initLiquidGlass({
  bgCaptureInterval: 2000,   // recapture every 2s
  bgCaptureScale:    0.20,   // smaller texture
  caustics:          false,  // no WebGL caustics
  grain:             false,  // no grain layer
  breathe:           false,  // no border animation
});
```

### Tuning for high-quality showcase

```js
initLiquidGlass({
  bgCaptureInterval:  300,    // near-real-time
  bgCaptureScale:     0.65,   // sharper refraction detail
  refractionStrength: 0.055,  // more visible bending
  aberrationStrength: 2.0,    // stronger colour fringe
});
```

### Element count guidelines

| GPU tier | Recommended WebGL elements |
|---|---|
| `high` | Up to 32 (hard cap) |
| `mid` | Up to 16 |
| `low` | 0 (CSS-only only) |

Elements beyond `MAX_WEBGL_ELEMENTS = 32` silently fall back to CSS-only glass. Hover effects, iridescence, and backdrop-filter still work — only the caustic overlay is disabled.

---

## Browser support

| Browser | Glass material | Caustics | Real refraction | Gyro tilt |
|---|---|---|---|---|
| Chrome 100+ | ✅ | ✅ WebGL2 | ✅ | ✗ desktop |
| Firefox 100+ | ✅ | ✅ WebGL2 | ✅ | ✗ desktop |
| Safari 15.4+ | ✅ | ✅ WebGL2 | ✅ | ✗ desktop |
| Edge 100+ | ✅ | ✅ WebGL2 | ✅ | ✗ desktop |
| iOS Safari 15.4+ | ✅ | ✅ mid-tier | ✅ | ✅ DeviceOrientation |
| Android Chrome 100+ | ✅ | ⚠ tier-dependent | ✅ | ✅ DeviceOrientation |
| Chrome < 69 / Safari < 14 | ⚠ no `backdrop-filter` | ✗ | ✗ | ✗ |

`backdrop-filter` is required for the frosted-glass base. On unsupported browsers the element renders as semi-transparent without blur — functional, not visually optimal.

---

## GPU tiers explained

The tier is detected once via `WEBGL_debug_renderer_info` on first `_attach()` call:

### `high`
Full feature set: WebGL2 caustics at full `aberrationStrength`, real background refraction, all shader layers active.
Typical hardware: Desktop dGPU (NVIDIA/AMD), Apple Silicon M-series, iPhone A12+, Snapdragon 8 Gen 1+.

### `mid`
WebGL2 caustics at half `aberrationStrength`. All other features active.
Typical hardware: Adreno 5xx/6xx (Snapdragon 7xx), Mali-G57/G77 (mid-range 2019–2022 Android).

### `low`
CSS-only frosted glass. No WebGL caustic overlay, no real refraction. SVG filters replaced with identity pass-throughs. `backdrop-filter` + all CSS effects remain active.
Typical hardware: Adreno 2xx–4xx, Mali-T/2xx, PowerVR SGX, early Intel integrated.

---

## SPA & Shadow DOM

### SPA navigation

```js
import { initLiquidGlass, destroyLiquidGlass } from './liquid-glass-pro.js';

// React Router v6 example
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function App() {
  const location = useLocation();

  useEffect(() => {
    initLiquidGlass({ ior: 1.45 });
    return () => destroyLiquidGlass();   // cleanup on route unmount
  }, [location.pathname]);

  return <Outlet />;
}
```

`destroyLiquidGlass()` removes the injected `<style>`, `<svg>`, WebGL canvas, all event listeners, the MutationObserver, and the RAF loop. After calling it, `initLiquidGlass()` can be called again cleanly.

### Shadow DOM

The MutationObserver watches `document.body` and cannot see into Shadow roots. Use `attachElement()` / `detachElement()` manually:

```js
class GlassWidget extends HTMLElement {
  connectedCallback() {
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<div class="lg lg-card lg-interactive" id="g">...</div>`;
    attachElement(this.shadow.getElementById('g'));
  }
  disconnectedCallback() {
    const el = this.shadow.getElementById('g');
    if (el) detachElement(el);
  }
}
```

### Modal / route change

```js
// Force a fresh capture after a modal opens
async function openModal() {
  modal.classList.add('open');
  await new Promise(r => setTimeout(r, 300));   // wait for CSS transition
  await refreshBackground();
}
```

---

## Why a Python server?

ES modules (`type="module"`) and html2canvas DOM capture are **both blocked on `file://`** URLs by all browsers:

- `file://` has no `Origin` — browsers deny cross-origin-like behaviour
- ES module imports require same-origin HTTP
- html2canvas requires a real HTTP response for correct layout capture
- WebGL canvas read-back requires `Cross-Origin-Opener-Policy` headers

`run.py` is a zero-install Python 3.7+ stdlib server with exactly the headers needed:

```
Access-Control-Allow-Origin:      *
Cross-Origin-Opener-Policy:       same-origin
Cross-Origin-Embedder-Policy:     require-corp
Content-Type:                     application/javascript  (for .js modules)
```

```bash
python run.py                    # http://localhost:8080, auto-opens browser
python run.py --port 3000        # custom port
python run.py --host 0.0.0.0     # expose to LAN (test on phone)
python run.py --no-open          # headless / CI mode
```

For production any standard HTTP server works — Vite, nginx, Apache. No special configuration beyond correct `Content-Type: application/javascript` for `.js` files.

---

## Architecture overview

```
liquid-glass-pro.js
│
├── §0   JSDoc type definitions
│         LGOptions, GpuTier, SpringState, ElementState, WrapResult
│
├── §1   Module-private state
│         _defaults, _opts          — configuration
│         _state                    — singleton flags + DOM/WebGL references
│         _elements (WeakMap)       — per-element runtime state
│         _tracked  (Set)           — RAF iteration set
│         SPRING                    — physics presets (frozen constant)
│         MAX_WEBGL_ELEMENTS = 32
│         MAX_DT = 0.05s
│
├── §2   GPU tier detection
│         WebGL1 throwaway context → WEBGL_debug_renderer_info
│         Renderer string pattern matching → 'high' | 'mid' | 'low'
│         Context released immediately via WEBGL_lose_context
│         Result memoised in _gpuTierCache
│
├── §3   Spring physics engine
│         _createSpring(initialValue)     → SpringState
│         _stepSpring(s, cfg, dt)         → symplectic Euler integration
│
├── §4   Houdini CSS custom properties
│         CSS.registerProperty() for --lg-mx, --lg-my, --lg-irid,
│         --lg-hover, --lg-tx, --lg-ty
│         Enables GPU-accelerated gradient interpolation on compositor thread
│
├── §5   Background capture engine                          ← NEW in v2
│         _captureBackground()          async, html2canvas mutex lock
│         _startBackgroundCapture()     allocates texture + starts triggers
│         _stopBackgroundCapture()      clears interval
│         Triggers: setInterval, scroll (debounced 150ms), ResizeObserver
│
├── §6   WebGL2 caustics + refraction engine
│         _VERT_SRC    full-screen triangle vertex shader
│         _FRAG_SRC    fragment shader (caustics + all physical effects)
│         │
│         │   Fragment shader features:
│         │   ├── hash2(), gnoise()              utility noise functions
│         │   ├── surfaceNormal()                bump-map normal      ← NEW
│         │   ├── refractUV()                    Snell's law UV       ← NEW
│         │   ├── sampleBackground()             background lookup    ← NEW
│         │   ├── chromaticRefraction()          Cauchy dispersion    ← NEW
│         │   ├── voronoi(), causticBand(),
│         │   │   caustic()                      Voronoi caustics     (v1)
│         │   ├── schlick()                      Fresnel factor       (v1)
│         │   ├── environmentReflection()        mirror probe         ← NEW
│         │   └── main()                         12-step composite pipeline
│         │
│         ├── §6.1  _compileShader(), _buildProgram()
│         │         _initWebGL()     shared context + program init
│         └──       _renderCausticsGL(es, now)   per-element render + blit
│
├── §7   SVG filter bank
│         _buildSVGDefs(tier)     animated 3-channel chromatic aberration
│         _injectSVG()            inserts hidden <svg> into <body>
│
├── §8   CSS injection
│         _buildCSS()             generates full stylesheet string
│         _injectCSS()            inserts <style id="liquid-glass-pro-style-200">
│
├── §9   Device orientation
│         _startOrientationTracking()   DeviceOrientationEvent → tilt
│         _stopOrientationTracking()    listener cleanup
│
├── §10  Per-element attach / detach
│         _attach(el)    canvas, grain, springs, pointer listeners, ResizeObserver
│         _detach(el)    full cleanup, returns WebGL slot to pool
│
├── §11  rAF animation loop
│         _rafLoop(ts)   advance springs → CSS vars → WebGL render per element
│         _startLoop(), _stopLoop()
│
├── §12  MutationObserver
│         _attachSubtree(), _detachSubtree()
│         _startObserver()   childList + subtree watch on document.body
│
└── §13  Public API  (14 named exports)
          initLiquidGlass, destroyLiquidGlass
          attachElement, detachElement
          wrapWithDistortion, createGrainLayer, createReplyQuote
          refreshBackground, isRefractionActive
          getGpuTier, getOptions, version
          useLiquidGlass
```

---

## Shader pipeline

Per-pixel execution order in the fragment shader (12 steps):

```
Input: v_uv — normalised [0,1]² UV from vertex shader

 1. surfaceNormal(uv)
      gnoise sampled at uv, uv+ε_x, uv+ε_y → finite-difference gradient
      Mouse-influenced exp() radial warp near cursor when hovered
      → vec3 N  (perturbed surface normal in view space)

 2. chromaticRefraction(uv, N)                              ← v2
      element UV → screen UV → +u_scroll drift compensation
      Cauchy IOR offsets:  R(−0.010)  G(0)  B(+0.018)
      refractUV() applied per channel → 3 independent texture samples
      → vec3 refractedBg  (R, G, B each from different displaced UV)

 3. Fresnel factor
      full-element normal with cursor/tilt lean → schlick(cosθ, 0.04)
      → float fr  ∈ [0, 1]

 4. environmentReflection(uv, N, fr)                        ← v2
      screen UV → mirror UV (flip X + normal perturbation)
      texture sample × fr × 0.35
      → vec3 envRefl  (edge reflection contribution)

 5. Voronoi caustics
      caustic(uvA) with 4 scale/speed/seed combos → float cBase
      per-channel causticBand at 3 UV offsets → vec3 chromCaustic

 6. Specular highlights
      lightPos = (0.22, 0.18) + mouse×hover + tilt
      wide lobe (pow 7) + tight lobe (pow 16) + ghost bounce (pow 11)
      → float specular

 7. Fresnel edge glow
      top / bottom / left edge bands via smoothstep + pow
      → float edgeGlow

 8. Thin-film iridescence
      polar angle + time + tilt → cosine spectrum (0°, 120°, 240° offsets)
      masked by smoothstep at element edges
      → vec3 irid

 9. Prismatic edge band
      narrow ring at edgeR ≈ 0.92 via double smoothstep
      → vec3 prismColor

10. Surface undulation
      two-octave gnoise → very slow organic wave motion
      → float wave

11. Compose
      col  = caustics + chromCaustic
      col += specular + edgeGlow + irid + prismColor + wave + envRefl
      col  = mix(col, refractedBg, smoothstep(0, 0.18, 1-edgeR) × 0.28 × bgReady)

12. Vignette + alpha
      soft smoothstep feather at element edges
      luma = dot(col, BT.601 coefficients)
      alpha = clamp(luma × 1.85, 0, 1) × 0.88
      → vec4 fragColor  (premultiplied RGBA)
```

---

## FAQ

**Q: Why does the refraction look blurry?**
The background texture is captured at `bgCaptureScale` (default 35%). Increase to 0.5–0.75 for sharper detail. `LINEAR_MIPMAP_LINEAR` filtering also smooths the texture, which looks physically correct for glass but reduces sharp edge detail from the source.

**Q: The refraction doesn't update when I scroll.**
Ensure `run.py` is serving the demo (not `file://`). If you're in an iframe, the parent scroll won't bubble — call `refreshBackground()` manually on the inner scroll event.

**Q: html2canvas shows blank regions for some content.**
html2canvas has known limitations: CSS pseudo-element gradients may not render, WebGL canvases are tainted and appear transparent, cross-origin images without CORS headers are excluded. These regions appear transparent in the refraction texture — correct degraded behaviour.

**Q: Can I use this without html2canvas?**
Yes — caustics, spring physics, iridescence, and all CSS effects work without it. Only real screen-space refraction requires html2canvas. If `window.html2canvas` is absent, `_captureBackground()` returns early and `u_bgReady` stays `0.0` — the shader skips the background blend entirely.

**Q: The glass is too opaque / not glass-like enough.**
The `refrBlend` weight in the shader (`0.28`) controls how much of the refracted background shows through the caustic composite. It's a hard-coded compositional constant — edit it in `_FRAG_SRC` if you need a different opacity range.

**Q: Does this work inside an iframe?**
Yes, but html2canvas only captures same-origin content. Cross-origin parent frames appear transparent. `backdrop-filter` may also behave differently depending on stacking context inside iframes.

**Q: Safari doesn't show the effect.**
`-webkit-backdrop-filter` is included in the injected CSS. Ensure Safari 15.4+ for WebGL2. On older Safari, only the CSS material renders; caustics are silently disabled.

**Q: My Lighthouse score dropped.**
html2canvas adds ~120 kb gzipped. Load it with `defer` or dynamically after first user interaction to keep it off the critical path. The library itself is ~18 kb gzipped.

**Q: Can I animate `ior` dynamically?**
Not at runtime without calling `initLiquidGlass()` again. `_opts.ior` is read each frame in `_renderCausticsGL()`, so you can mutate it directly — but this is an internal API and may change between versions:
```js
import * as LG from './liquid-glass-pro.js';
// Internal — use with caution:
// _opts is module-private; expose via getOptions() only reads a copy.
```
A `setOption(key, value)` export is planned for v2.1.

---

## License

```
Copyright 2025 Liquid Glass PRO Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

v1.1.1 was also released under Apache 2.0.

html2canvas is licensed under MIT — see [html2canvas/LICENSE](https://github.com/niklasvh/html2canvas/blob/master/LICENSE).
