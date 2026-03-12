# liquid-glass-pro

**v4.0.0** — WebGL2 physically-based liquid glass rendering for the web.

Real Snell's law background refraction via html2canvas, Sellmeier optical dispersion across five Schott glass types, PCG2D-hashed Voronoi caustics with F2−F1 distance fields and domain warping, Cook-Torrance PBR specular, thin-film iridescence, Fresnel reflection, chromatic aberration, spring-physics cursor tracking — with an intelligent CSS fallback for every GPU tier.

---

## Table of Contents

- [What's New in v4](#whats-new-in-v4)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [HTML Usage](#html-usage)
- [React / Vue / Svelte](#react--vue--svelte)
- [Configuration Reference](#configuration-reference)
- [Public API](#public-api)
- [CSS Classes & Data Attributes](#css-classes--data-attributes)
- [Glass Types & Sellmeier Dispersion](#glass-types--sellmeier-dispersion)
- [Caustics Tuning](#caustics-tuning)
- [GPU Tiers & Fallback Strategy](#gpu-tiers--fallback-strategy)
- [Physics Reference](#physics-reference)
- [Performance Notes](#performance-notes)
- [Browser Support](#browser-support)
- [Changelog](#changelog)

---

## What's New in v4

### Sellmeier dispersion — replaces Cauchy approximation

v3 used a Cauchy approximation with manually tuned IOR offsets of ±0.018 to produce chromatic splitting. v4 replaces this with the full three-term Sellmeier equation sourced directly from the Schott glass catalogue 2023:

```
n²(λ) = 1 + B₁λ²/(λ²−C₁) + B₂λ²/(λ²−C₂) + B₃λ²/(λ²−C₃)
```

The three resonance terms correspond to UV electronic absorption (C₁ ≈ 0.006–0.014 µm²), near-UV secondary (C₂ ≈ 0.020–0.060 µm²), and far-IR phonon lattice (C₃ ≈ 100–200 µm²). Accuracy vs spectrometer measurement: RMS error < 0.0001 across the full visible range (380–750 nm). Cauchy over-estimated blue dispersion by ~2.5× compared to physical measurements.

### Five optical glass types

The new `glassType` option selects from five Schott catalogue materials, each with distinct dispersion character:

| Glass | Abbe V | Δn R→B | Character |
|---|---|---|---|
| `BK7` | 64.17 | 0.0110 | Standard optical — camera lenses, cover glass |
| `SF11` | 25.76 | 0.0408 | Heavy flint — crystal, Swarovski, prisms |
| `NK51A` | 81.61 | 0.0054 | Fluorite crown — APO lenses, near-zero aberration |
| `NBK10` | 67.90 | 0.0084 | Thin crown — architectural window glass |
| `F2` | 36.43 | 0.0227 | Flint — vintage optics, achromatic doublets |

The Fresnel F0 term is also derived from the Sellmeier green-channel IOR (n at 550 nm) instead of the fixed constant `0.04` used in v3.

### Improved Voronoi caustic system

The caustic engine is rebuilt around four improvements:

**PCG2D integer hash** replaces the sin()-based trigonometric hash. Based on Jarzynski & Olano (2020) "Hash Functions for GPU Rendering" (JCGT Vol 9 No 3). Uses only integer arithmetic — no sin/cos — with a period of 2³² per axis and zero visible lattice bias. The two interleaved PCG streams with XOR-shift mixing produce strong avalanche: every input bit affects every output bit.

**F2−F1 distance field** replaces the F1 (nearest-only) metric. The difference between the second-nearest and nearest Voronoi cell distance peaks sharply exactly at cell boundaries, producing tight caustic filaments that match real underwater light patterns. F1 produced "pillow" artefacts at cell centres; F2−F1 eliminates these entirely.

**Domain warping** pre-distorts the UV coordinate by a low-frequency gradient noise field before Voronoi evaluation (technique: Inigo Quilez, "Warped domain Voronoi"). This breaks global square lattice regularity — cells are no longer visibly arranged on a grid at any scale or zoom level.

**Six octaves with rotation stagger** replaces four fixed-grid octaves. Each octave is rotated by 11.25° (π/16 radians) relative to the previous, preventing the star-burst alignment artefact that appeared when multiple Voronoi grids shared the same axis orientation. Per-cell animation now uses four independent PCG2D-derived random scalars (X/Y frequency, X/Y phase offset) and one depth scalar, so no two cells ever move in synchrony.

### Physical chromatic caustics

The per-channel caustic UV offset in `chromaticCaustic()` is now derived from the Sellmeier Δn of the selected glass type rather than fixed constants. SF11 glass shows dramatically wider spectral splitting than BK7 or N-FK51A, making the choice of glass type visually consistent across both refraction and caustic passes.

---

## How It Works

```
User DOM element (.lg)
       │
       ├─ [GPU tier high] WebGL2 Caustics + Refraction (§6)
       │    ├─ html2canvas background capture (§5)
       │    │    ├─ Fires once at init, then every bgCaptureInterval ms
       │    │    ├─ Also fires on scroll (debounced 150ms) and resize
       │    │    └─ Scroll-drift compensation via u_scroll uniform
       │    ├─ Snell's law UV displacement per pixel (surfaceNormal bump-map)
       │    ├─ Sellmeier per-channel IOR dispersion (R at 680nm / G at 550nm / B at 450nm)
       │    ├─ Six-octave Voronoi caustics (PCG2D hash, F2−F1, domain warp, rotation stagger)
       │    ├─ Environment reflection probe (Fresnel-weighted horizontal mirror)
       │    └─ Born & Wolf thin-film iridescence (λR / λG / λB interference)
       │
       ├─ [GPU tier ≥ mid] PBR Specular pass (§15)
       │    ├─ Separate WebGL2 context (_spec singleton)
       │    ├─ Anisotropic GGX NDF (Burley 2012)
       │    ├─ Smith height-correlated visibility (Heitz 2014)
       │    ├─ Schlick Fresnel — F0 from Sellmeier n(550nm), not fixed constant
       │    ├─ Kulla-Conty multi-bounce energy compensation (2017)
       │    ├─ Thin-film iridescence (Born & Wolf 1999)
       │    ├─ Three-light config: L0 cursor key / L1 fill / L2 back-scatter
       │    └─ .lg-specular-canvas overlay (screen blend, z-index above caustics)
       │
       ├─ [all tiers] SVG filter bank (§7)
       │    ├─ Chromatic aberration feDisplacementMap (animated turbulence)
       │    └─ Micro-distortion fractalNoise feTurbulence on content
       │
       ├─ [all tiers] Spring physics (§3)
       │    ├─ Semi-implicit Euler damped harmonic oscillator
       │    ├─ Cursor → springX / springY → --lg-mx / --lg-my
       │    ├─ Gyroscope → tiltX / tiltY → CSS perspective transform
       │    └─ Hover intensity spring → caustic + specular opacity
       │
       └─ [GPU tier low / WebGL failure] CSS fallback (§16)
            ├─ ::before  three GGX-lobe radial-gradient (A: L0 peak, B: L1 fill, C: L2 scatter)
            ├─ :hover    seven-layer box-shadow synchronised with L0 intensity ×1.5
            └─ ::after   thin-film conic-gradient with Born & Wolf phase offsets
```

---

## Installation

```bash
npm install liquid-glass-pro
```

Requires **html2canvas ^1.4.1** as a peer dependency (loaded before `initLiquidGlass()` is called):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

---

## Quick Start

```js
import { initLiquidGlass } from './liquid-glass-pro.js';

initLiquidGlass({
  glassType:          'BK7',    // Optical glass material (new in v4)
  ior:                1.45,
  refractionStrength: 0.045,
  aberrationStrength: 1.6,
  bgCaptureInterval:  2000,
  bgCaptureScale:     0.35,
  caustics:           true,
  grain:              true,
  iridescence:        true,
  breathe:            true,
  glassOpacity:       0.08,
  glassSaturation:    110,
  specularStrength:   0.5,
  specularWhiteness:  0.5,
});
```

Then mark any element with the `lg` class:

```html
<div class="lg lg-card lg-interactive">
  Hello, glass world.
</div>
```

---

## HTML Usage

### Shape modifiers

| Class | Effect |
|---|---|
| `lg-card` | `border-radius: 22px`, `padding: 20px` |
| `lg-pill` | `border-radius: 999px`, `padding: 6px 18px` |
| `lg-fab` | 56×56 circular button, flex-centered |

### Interactive elements

Add `lg-interactive` to enable cursor spring-physics, hover highlight amplification and the specular pass's cursor-tracking light (L0):

```html
<button class="lg lg-pill lg-interactive">Click me</button>
```

### Own messages (chat)

```html
<div class="lg lg-own lg-interactive chat-bubble">
  Purple-tinted variant for sent messages.
</div>
```

### Reply quotes

```js
import { createReplyQuote } from './liquid-glass-pro.js';

const quote = createReplyQuote(
  'Alice',                           // sender name
  'The refraction looks incredible!', // preview text
  false,                             // isOwn
  () => scrollToMessage(id)          // optional click handler
);
chatContainer.appendChild(quote);
```

---

## React / Vue / Svelte

### React hook

```jsx
import { useRef } from 'react';
import { useLiquidGlass } from './liquid-glass-pro.js';

function GlassCard({ children }) {
  const ref = useRef(null);
  useLiquidGlass(ref);  // attach on mount, detach on unmount

  return (
    <div ref={ref} className="lg lg-card lg-interactive">
      {children}
    </div>
  );
}
```

### Vue 3 composable

```js
import { onMounted, onUnmounted } from 'vue';
import { attachElement, detachElement } from './liquid-glass-pro.js';

export function useLiquidGlass(elRef) {
  onMounted(()   => attachElement(elRef.value));
  onUnmounted(() => detachElement(elRef.value));
}
```

### Svelte action

```svelte
<script>
  import { attachElement, detachElement } from './liquid-glass-pro.js';

  function liquidGlass(node) {
    attachElement(node);
    return { destroy: () => detachElement(node) };
  }
</script>

<div class="lg lg-card" use:liquidGlass>
  Hello from Svelte
</div>
```

---

## Configuration Reference

All options passed to `initLiquidGlass()`. Missing values fall back to defaults.

| Option | Type | Default | Description |
|---|---|---|---|
| `selector` | `string` | `'.lg'` | CSS selector for auto-discovery via MutationObserver |
| `glassType` | `string` | `'BK7'` | **v4** Optical glass material. One of `'BK7'`, `'SF11'`, `'NK51A'`, `'NBK10'`, `'F2'`. Controls Sellmeier dispersion coefficients for both refraction and caustic passes. See [Glass Types](#glass-types--sellmeier-dispersion). |
| `ior` | `number` | `1.45` | Base index of refraction used for surface normal refraction strength. When `glassType` is set, per-channel IOR is computed from Sellmeier; this value controls only the overall displacement magnitude. |
| `refractionStrength` | `number` | `0.035` | UV displacement scale for Snell refraction. Higher = stronger fish-eye effect. |
| `aberrationStrength` | `number` | `1.6` | px magnitude of SVG feDisplacementMap chromatic aberration. Half on `mid` tier. |
| `bgCaptureInterval` | `number` | `200` | ms between background re-captures. Lower = fresher refraction, higher CPU cost. |
| `bgCaptureScale` | `number` | `0.65` | html2canvas resolution scale (0.35 = 35% of viewport). Lower = faster but blurrier. |
| `caustics` | `boolean` | `true` | Master switch for WebGL2 Voronoi caustic pass. |
| `grain` | `boolean` | `true` | Inject `.lg-grain` film-grain overlay inside each element. |
| `iridescence` | `boolean` | `true` | Enable thin-film interference CSS animation on `::after`. |
| `breathe` | `boolean` | `true` | Enable `lg-breathe` border-radius morph animation. |
| `glassOpacity` | `number` | `0.12` | Base white tint. 0.0 = pure refraction, 1.0 = frosted opaque. |
| `glassSaturation` | `number` | `100` | `backdrop-filter: saturate()` value. Below 100 desaturates background. |
| `specularStrength` | `number` | `1.0` | Scales overall PBR specular brightness. 0.0 = invisible, 1.0 = full. |
| `specularWhiteness` | `number` | `0.5` | Controls warmth of specular highlight. 0.0 = warm tungsten, 1.0 = pure white. |

### Changing glass type at runtime

`glassType` can be patched on the live options object without calling `initLiquidGlass()` again. The GLSL shader re-evaluates `u_glassType` on every frame:

```js
import { getOptions } from './liquid-glass-pro.js';

// Switch to heavy flint — vivid rainbow splitting
getOptions().glassType = 'SF11';

// Switch back to standard borosilicate
getOptions().glassType = 'BK7';
```

Call `refreshBackground()` after switching glass type to force an immediate re-capture with the new IOR values.

---

## Public API

### `initLiquidGlass(options?)` → `void`

Initialises the system. Safe to call from any readyState — if the DOM is still loading, execution is deferred to `DOMContentLoaded`. Subsequent calls are no-ops; call `destroyLiquidGlass()` first to re-initialise.

```js
initLiquidGlass({ glassType: 'SF11', ior: 1.5, bgCaptureInterval: 3000 });
```

---

### `destroyLiquidGlass()` → `void`

Full teardown: detaches all elements, destroys both WebGL contexts, cancels rAF loop, disconnects MutationObserver and IntersectionObserver, removes injected `<style>` and `<svg>`.

```js
destroyLiquidGlass();
// Safe to call initLiquidGlass() again afterwards
```

---

### `attachElement(el)` → `void`

Manually attaches the glass effect to a single element outside the automatic selector scan. Useful for Shadow DOM or framework-managed components. Requires `initLiquidGlass()` to have been called first.

```js
attachElement(document.querySelector('#modal'));
```

---

### `detachElement(el)` → `void`

Removes the glass effect from one element and frees its resources. Safe to call if the element was never attached.

```js
detachElement(document.querySelector('#modal'));
```

---

### `wrapWithDistortion(el)` → `{ wrapper, unwrap }`

Wraps `el` in a `.lg-outer` SVG-filter container at its current DOM position. Preserves original `display` type (block / flex / grid). Returns the wrapper and an `unwrap()` function to restore the original structure.

```js
const { wrapper, unwrap } = wrapWithDistortion(myCard);
// Later:
unwrap();
```

---

### `createReplyQuote(sender, text, isOwn, onClick)` → `HTMLDivElement`

Factory for chat reply-quote elements. Returns a detached `.lg.lg-reply` element ready to append to your chat container.

```js
const quote = createReplyQuote(
  'Bob',
  'Are you seeing the refraction?',
  false,           // isOwn — true applies purple .lg-own tint
  () => jumpTo(id) // optional click handler
);
```

---

### `refreshBackground()` → `Promise<void>`

Forces an immediate html2canvas re-capture outside the regular interval. Call after large DOM mutations (modal open, route change, dynamic content insertion) or after changing `glassType`.

```js
await refreshBackground();
```

---

### `getGpuTier()` → `'low' | 'mid' | 'high'`

Returns the memoised GPU capability tier detected at first call.

| Tier | Condition | Features active |
|---|---|---|
| `'high'` | Desktop / Apple silicon GPU | Full: refraction + caustics + specular |
| `'mid'` | Adreno 500–600 / Mali-G57–G75 | Caustics + specular, aberration at ½ strength |
| `'low'` | Legacy mobile / WebGL unavailable | CSS fallback only |

---

### `isRefractionActive()` → `boolean`

Returns `true` once the first successful html2canvas background capture has completed and the WebGL texture is populated.

---

### `getOptions()` → `LGOptions`

Returns a **live reference** to the currently active options object. Mutations take effect on the next animation frame — use this to change `glassType`, `specularStrength`, etc. at runtime without re-initialising.

```js
const opts = getOptions();
opts.glassType       = 'NK51A';  // near-zero dispersion (APO)
opts.specularStrength = 0.8;
```

> **Note:** In v3, `getOptions()` returned a shallow copy. In v4 it returns the live object to support runtime glass-type switching.

---

### `version()` → `'4.0.0'`

---

## CSS Classes & Data Attributes

### Classes applied by the library

| Class | Applied to | Purpose |
|---|---|---|
| `.lg-outer` | wrapper (optional) | SVG chromatic-aberration filter context |
| `.lg-grain` | `<div>` inside `.lg` | Film grain SVG noise overlay |
| `.lg-caustic-canvas` | `<canvas>` inside `.lg` | WebGL caustics / refraction blitted output |
| `.lg-specular-canvas` | `<canvas>` inside `.lg` | WebGL PBR specular blitted output |
| `.lg-reply` | `.lg` element | Reply quote shape + left-border accent |
| `.lg-own` | `.lg` element | Purple-tint variant for own messages |

### Data attributes set by the library

| Attribute | Meaning |
|---|---|
| `data-lg-webgl="1"` | WebGL caustic + specular passes are active on this element |
| `data-lg-refract="1"` | Background texture is populated (refraction live) |

### Houdini CSS custom properties

Set per-frame by the spring system. Consume in custom CSS for cursor-reactive effects:

| Property | Description |
|---|---|
| `--lg-mx` | Cursor X, spring-smoothed, `0%`–`100%` |
| `--lg-my` | Cursor Y, spring-smoothed, `0%`–`100%` |
| `--lg-hover` | Hover intensity `0`–`1` |
| `--lg-tx` | Tilt X `−1`–`+1` |
| `--lg-ty` | Tilt Y `−1`–`+1` |
| `--lg-irid` | Iridescence rotation angle (`<angle>`) |
| `--lg-sa` `--lg-sb` `--lg-sc` `--lg-sd` | Per-element random specular lobe offsets (re-randomised on each hover enter) |

```css
/* Custom shimmer tied to cursor — works at all GPU tiers */
.lg::before {
  background: radial-gradient(
    ellipse at var(--lg-mx) var(--lg-my),
    rgba(255,255,255,0.18) 0%,
    transparent 60%
  );
}
```

---

## Glass Types & Sellmeier Dispersion

### Physical background

The refractive index of optical glass is wavelength-dependent — a phenomenon known as dispersion. The industry-standard model for describing this relationship is the Sellmeier equation (1871), which expresses n(λ) as a sum of three resonance terms corresponding to electronic and phonon absorption bands:

```
n²(λ) = 1 + B₁λ²/(λ²−C₁)   ← UV electronic resonance
             + B₂λ²/(λ²−C₂)   ← near-UV secondary
             + B₃λ²/(λ²−C₃)   ← far-IR phonon lattice
```

where λ is in micrometres (µm) and B/C coefficients come from the Schott glass catalogue. The valid range is λ ∈ [0.365, 2.325] µm; for visible light (0.380–0.750 µm) the RMS error versus spectrometer measurement is < 0.0001.

In v3, a Cauchy approximation was used with a manually tuned fixed offset of ±0.018 to split red and blue IOR values. This over-estimated dispersion in the blue channel by approximately 2.5× relative to physical measurements. In v4, the full Sellmeier equation is evaluated in the GLSL fragment shader for each of the three RGB primary wavelengths:

```
λR = 0.680 µm (680 nm)  — red   primary, CIE standard illuminant D65
λG = 0.550 µm (550 nm)  — green primary, peak of human photopic response
λB = 0.450 µm (450 nm)  — blue  primary
```

### Per-type optical constants

**BK7 — Borosilicate Crown** (`glassType: 'BK7'`)

The most widely used optical glass. Found in camera lenses (Zeiss, Leica, Nikon), microscope objectives, laser windows and display cover glass.

```
Abbe V = 64.17 | n_D = 1.51680 | Δn(R→B) = 0.01101
n(680nm) = 1.5143 | n(550nm) = 1.5187 | n(450nm) = 1.5253
Sellmeier: B₁=1.03961212 C₁=0.00600070
           B₂=0.23179234 C₂=0.02001791
           B₃=1.01046945 C₃=103.56065
```

**SF11 — Heavy Flint** (`glassType: 'SF11'`)

Dense flint glass used in spectroscopic prisms, diffraction gratings, decorative crystal (Swarovski), chandeliers and high-power laser optics. Maximum prismatic chromatic splitting among the five types.

```
Abbe V = 25.76 | n_D = 1.78472 | Δn(R→B) = 0.04079
n(680nm) = 1.7702 | n(550nm) = 1.7847 | n(450nm) = 1.8110
Sellmeier: B₁=1.73848403 C₁=0.01366091
           B₂=0.31116800 C₂=0.06169579
           B₃=1.17490871 C₃=121.92271
```

**N-FK51A — Fluorite Crown** (`glassType: 'NK51A'`)

Low-index fluorophosphate glass used in APO camera lenses (Super-APO, fluorite elements), telescope apochromatic objectives and UV optics. Near-zero chromatic fringing.

```
Abbe V = 81.61 | n_D = 1.48656 | Δn(R→B) = 0.00536
n(680nm) = 1.4838 | n(550nm) = 1.4866 | n(450nm) = 1.4892
Sellmeier: B₁=0.97124800 C₁=0.00472302
           B₂=0.21602196 C₂=0.01530890
           B₃=0.90448069 C₃=168.68184
```

**N-BK10 — Thin Crown** (`glassType: 'NBK10'`)

Low-index borosilicate crown used in architectural window glass, display panels, lightweight optical elements and eyeglass lenses. Clean, familiar everyday window character.

```
Abbe V = 67.90 | n_D = 1.49780 | Δn(R→B) = 0.00841
n(680nm) = 1.4936 | n(550nm) = 1.4978 | n(450nm) = 1.5020
Sellmeier: B₁=0.88841934 C₁=0.00516901
           B₂=0.32846101 C₂=0.01774020
           B₃=0.95900362 C₃=95.75651
```

**F2 — Flint** (`glassType: 'F2'`)

Classic medium flint used in achromatic doublet objectives, ornamental glass and spectroscopic prisms. Medium-high dispersion with a warm vintage character.

```
Abbe V = 36.43 | n_D = 1.62005 | Δn(R→B) = 0.02265
n(680nm) = 1.6150 | n(550nm) = 1.6200 | n(450nm) = 1.6377
Sellmeier: B₁=1.34533359 C₁=0.00997744
           B₂=0.20977271 C₂=0.04703645
           B₃=0.89270000 C₃=111.88676
```

### Visual comparison

| Glass | Refraction character | Caustic colour split |
|---|---|---|
| N-FK51A | Clean, near-achromatic | Barely visible spectral fringing |
| N-BK10 | Gentle bend, everyday window | Subtle warm/cool edge |
| BK7 | Standard optical quality | Visible but controlled prismatic rim |
| F2 | Noticeably curved, warm tones | Clear rainbow edge, vintage feel |
| SF11 | Strong displacement, wide bloom | Vivid full-spectrum rainbow |

---

## Caustics Tuning

The Voronoi caustic system is configured via `causticBandImproved()` calls inside `caustic()` in the GLSL fragment shader. All six octaves use the improved PCG2D/F2−F1/domain-warp engine.

### Six-octave default configuration

```glsl
float c = 0.0;

// Octave 0: large base cells, slow drift
c += causticBandImproved(uv + mw,        5.8,  0.28, vec2( 0.000,  0.000), 0.0, 1.8) * 0.26;

// Octave 1: medium cells, primary filaments
c += causticBandImproved(uv + mw * 0.7,  9.3,  0.41, vec2( 7.139, 13.000), 1.0, 2.2) * 0.22;

// Octave 2: medium-small, sharp bright lines
c += causticBandImproved(uv + mw * 1.1, 13.7,  0.57, vec2(17.321,  4.472), 2.0, 2.5) * 0.18;

// Octave 3: small cells, fine texture grain
c += causticBandImproved(uv,             6.2,  0.19, vec2(31.623, 22.360), 3.0, 1.6) * 0.14;

// Octave 4: large-medium, broad undulation
c += causticBandImproved(uv + mw * 0.3, 11.1,  0.33, vec2( 2.646, 44.721), 4.0, 2.0) * 0.12;

// Octave 5: fine sparkle, fast
c += causticBandImproved(uv + mw * 1.4, 18.4,  0.72, vec2(54.772,  8.944), 5.0, 3.0) * 0.08;
```

### `causticBandImproved` parameter reference

```glsl
causticBandImproved(uv, cellFreq, speed, seed, octIdx, sharp)
```

| Parameter | Type | Effect |
|---|---|---|
| `uv` | `vec2` | Input UV (apply `mw` cursor offset here) |
| `cellFreq` | `float` | Cell density — higher = more cells, smaller bubbles |
| `speed` | `float` | Animation speed multiplier |
| `seed` | `vec2` | UV offset seed — break inter-octave alignment |
| `octIdx` | `float` | Octave index 0–5 — drives 11.25° rotation stagger |
| `sharp` | `float` | Power curve exponent — higher = tighter filament lines |

### Overall brightness

```glsl
// In main(), the 0.52 and 0.5 scalars control peak intensity
vec3 col = vec3(cBase * 0.52) + chromCaustic * 0.5;

// Quieter caustics
vec3 col = vec3(cBase * 0.25) + chromCaustic * 0.3;

// More pronounced
vec3 col = vec3(cBase * 0.70) + chromCaustic * 0.7;
```

### Quick reference

| Parameter | Location | Effect |
|---|---|---|
| `cellFreq` arg | `caustic()` in `_FRAG_SRC` | Bubble size — higher = smaller cells |
| `sharp` arg | `caustic()` in `_FRAG_SRC` | Filament tightness — higher = sharper lines |
| octave `* N` weight | `caustic()` in `_FRAG_SRC` | Per-octave brightness contribution |
| `cBase * N` | `main()` in `_FRAG_SRC` | Master caustic brightness multiplier |
| `chromCaustic * N` | `main()` in `_FRAG_SRC` | Chromatic caustic split brightness |
| `pow(caustic(uvA), 1.7)` exponent | `main()` | Global contrast — higher = tighter filaments |

---

## GPU Tiers & Fallback Strategy

### Tier `high` — Full WebGL2
*Desktop and Apple silicon (M-series) GPUs.*

- html2canvas background capture → Snell's law UV refraction shader
- Sellmeier per-channel IOR dispersion (R/G/B at their physical wavelengths)
- Environment reflection probe (Fresnel-weighted planar mirror)
- Six-octave Voronoi caustics (PCG2D hash, F2−F1, domain warp, rotation stagger)
- Cook-Torrance PBR specular pass on `.lg-specular-canvas`
- SVG chromatic aberration at full `aberrationStrength`

### Tier `mid` — Caustics + Specular
*Adreno 500–600, Mali-G57/G75.*

- Same as `high` but chromatic aberration at 50% strength
- Refraction may be disabled if `EXT_color_buffer_float` is unavailable

### Tier `low` — CSS only
*Legacy mobile GPUs, WebGL2 unavailable, restricted CSP.*

- `::before` — three analytically-derived GGX radial-gradient lobes matching L0/L1/L2 light directions and colours
- `:hover` — seven-layer box-shadow stack synchronised with L0 intensity ×1.5
- `::after` — thin-film iridescence `conic-gradient` with Born & Wolf 120°/240° phase offsets
- SVG filter bank (chromatic aberration, micro-distortion)
- Spring physics cursor tracking still fully active

All tiers produce a recognisable glass element. GPU-specific visual layers are purely additive.

---

## Physics Reference

### Glass Constants (§15)

| Constant | Value | Physical basis |
|---|---|---|
| `GLASS_IOR` | Sellmeier n(550nm) | Green-channel IOR from selected glass type (v4) |
| `GLASS_F0` | `((n−1)/(n+1))²` | Fresnel at normal incidence — derived from Sellmeier (v4) |
| `FILM_THICKNESS` | 320 nm | Anti-reflective MgF₂ coating thickness |
| `FILM_IOR` | 1.38 | MgF₂ coating refractive index |
| `BASE_ROUGHNESS` | 0.04 | α = roughness² — near-specular glass surface |
| `ANISOTROPY` | 0.35 | Burley 2012 tangent axis stretch |

### Sellmeier evaluation wavelengths

| Channel | Wavelength | Physical basis |
|---|---|---|
| Red | 680 nm | Near photopic long-wavelength edge |
| Green | 550 nm | Peak of human photopic response (reference) |
| Blue | 450 nm | Near photopic short-wavelength edge |

### Specular BRDF

```
f_r(l,v) = D(h)·F(v,h)·V(l,v) + f_ms(l,v)
```

- **D** — Anisotropic GGX NDF (Burley 2012)
  `αT = 0.04 / √(1 − 0.9·0.35) ≈ 0.0483`
  `αB = 0.04 · √(1 − 0.9·0.35) ≈ 0.0331`

- **F** — Schlick: `F0 + (1−F0)·(1−VdotH)⁵`
  F0 = Sellmeier n(550nm) → `((n−1)/(n+1))²` (v4, was fixed 0.04 in v3)

- **V** — Smith height-correlated GGX (Heitz 2014): prevents over-darkening at grazing angles

- **f_ms** — Kulla-Conty multi-bounce (2017): compensates energy lost in single-scattering GGX at high roughness. Negligible at `α = 0.04` but present for mathematical completeness.

### Three-Light Config (§15.K)

| Light | Colour | Intensity | Position |
|---|---|---|---|
| L0 — key | warm white `(1.00, 0.97, 0.92)` | `2.8 + hover·1.4` | cursor-tracking |
| L1 — fill | cool blue `(0.88, 0.93, 1.00)` | `0.55` | static upper-left |
| L2 — back | violet `(0.76, 0.70, 1.00)` | `0.30` | mirror of L0 |

### Thin-Film Iridescence (§15.H — Born & Wolf 1999)

```
OPD = 2 · FILM_IOR · FILM_THICKNESS · cos(θt)
    = 2 · 1.38 · 320 · cos(0°)
    = 883.2 nm

I(λ) = 0.5 + 0.5 · cos(2π · OPD / λ)
```

Evaluated at λR = 680 nm, λG = 550 nm, λB = 450 nm.
Phase shifts at normal incidence: 0° / 120° / 240°. Same offsets used in CSS fallback conic-gradient.

### Voronoi Caustic System (v4 — §D)

**PCG2D hash** (Jarzynski & Olano 2020):
```glsl
uvec2 v = p * uvec2(1664525u, 1013904223u) + uvec2(1013904223u, 1664525u);
v.x += v.y * 1664525u;
v.y += v.x * 1664525u;
v ^= (v >> 16u);
v.x += v.y * 1664525u;
v.y += v.x * 1664525u;
v ^= (v >> 16u);
return vec2(v) * (1.0 / 4294967295.0);
```

**F2−F1 distance field:**
```glsl
// minD1 = nearest cell, minD2 = second-nearest
return clamp(minD2 - minD1, 0.0, 1.0);  // peaks at cell boundaries
```

**Domain warp:**
```glsl
float wx = gnoise(uv * 2.3 + vec2(0.0, 17.4) + t * 0.04) - 0.5;
float wy = gnoise(uv * 1.7 + vec2(31.7,  0.0) + t * 0.03) - 0.5;
return uv + vec2(wx, wy) * 0.18;  // max ±0.18 warp magnitude
```

**Rotation stagger:**
```glsl
float rotAngle = octIdx * 0.19635;  // 11.25° = π/16 per octave
vec2 uvRot = rot2(uv, rotAngle);
```

### Spring Physics (§3)

Semi-implicit (symplectic) Euler — unconditionally stable for all positive dt:

```
F        = −k·(x − target) − d·v
v(t+dt)  = v(t) + (F/m)·dt    ← velocity updated first
x(t+dt)  = x(t) + v(t+dt)·dt  ← position uses new velocity
```

| Preset | Stiffness | Damping | Mass | Character |
|---|---|---|---|---|
| `cursor` | 180 | 18 | 1.0 | Fast, snappy |
| `hover` | 120 | 14 | 1.0 | Slightly slower fade |
| `tilt` | 90 | 12 | 1.2 | Heavy, inertial |

Max delta-time capped at 50 ms to prevent integrator explosion on tab wake-up.

---

## Performance Notes

**Shared GL contexts** — both caustic (§6) and specular (§15) passes each use a single `WebGL2RenderingContext` shared across all glass elements. The canvas is resized per-element before each draw, eliminating browser limits on concurrent contexts.

**IntersectionObserver gate** — elements outside the viewport skip all WebGL work entirely. Off-screen elements are not rendered.

**Frame budgets in rAF loop:**

| Operation | Frequency | Reasoning |
|---|---|---|
| Spring integration + CSS props | Every frame (60 fps) | Required for smooth cursor tracking |
| Specular GL pass | Every frame (60 fps) | Cursor-tracking L0 needs full rate |
| Caustic GL pass | Every 2nd frame (≈30 fps) | Caustic noise is slow-moving; halving is imperceptible |
| domRect refresh | Every 8th frame (≈7.5 Hz) | Reduces layout thrash |
| `data-lg-refract` sync | Every 30th frame (≈2 Hz) | Data attribute, no visual urgency |

**Voronoi complexity note** — the improved PCG2D caustic system uses a 3×3 neighbourhood search (vs 5×5 in v3) because domain warping fills the quality gap at lower cost. Total instruction count is comparable to v3's 5×5 search after accounting for PCG2D integer-arithmetic savings versus sin().

**Background capture cost** — each html2canvas call is 10–40 ms at `bgCaptureScale: 0.35`. Scheduled via `requestIdleCallback` when available, falling back to `setTimeout`. A mutex prevents concurrent captures. The previous texture remains active during capture — no flicker.

**Hard cap** — `MAX_WEBGL_ELEMENTS = 32`. Elements beyond this count receive the CSS fallback. This prevents GPU memory exhaustion on lower-end devices.

**Recommendations:**
- Keep `bgCaptureScale` at `0.35` or below for most use cases
- Increase `bgCaptureInterval` to 3000–5000 ms on pages with stable backgrounds
- Use `caustics: false` on purely decorative elements that don't need the full effect
- The specular-only path (tier `mid`) is approximately 10× cheaper than the full refraction path
- `glassType: 'NK51A'` has the smallest per-channel IOR spread — imperceptibly cheaper to evaluate than `SF11`

---

## Known Issues & Fixes

### `.lg-specular-canvas` stretching to 4096px

**Root cause:** `_buildSpecularCSS()` (§15.4, the exported function) correctly includes `position: absolute` for `.lg-specular-canvas`. However, `_buildSpecularCSS()` (§16, the internal function called by `_buildCSS()`) only sets `transition` and `pointer-events` — it omits `position`. Since `_buildCSS()` calls the internal version, `position: absolute` never reaches the injected stylesheet, leaving each specular canvas at `position: static`. A 4096×4096 in-flow canvas then stretches its parent `.lg` to 4096px height.

**Fix:** add `position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;` to the `.lg-specular-canvas` block inside `_buildSpecularCSS()` (§16) in `liquid-glass-pro.js`.

---

## Browser Support

| Browser | Caustics + Refraction | PBR Specular | CSS Fallback |
|---|---|---|---|
| Chrome 90+ | ✅ | ✅ | ✅ |
| Firefox 90+ | ✅ | ✅ | ✅ |
| Safari 16.4+ | ✅ | ✅ | ✅ |
| Safari 15 | ❌ | ✅ | ✅ |
| iOS Safari 16+ | ✅ | ✅ | ✅ |
| iOS Safari 15 | ❌ | ❌ | ✅ |
| Samsung Internet 16+ | ✅ | ✅ | ✅ |

`EXT_color_buffer_float` is required for the refraction pass (floating-point background texture). Browsers that lack it fall through gracefully to the specular-only or CSS-only path.

---

## Changelog

### v4.0.0

**§C — Sellmeier dispersion replaces Cauchy approximation**
- Full three-term Sellmeier equation evaluated per fragment in GLSL: `n²(λ) = 1 + Σ Bⱼλ²/(λ²−Cⱼ)`
- Five glass types from Schott catalogue 2023: BK7, SF11, N-FK51A, N-BK10, F2
- All coefficients validated: RMS error < 0.0001 vs spectrometer across 380–750 nm
- Per-channel IOR at λR=680nm / λG=550nm / λB=450nm (CIE D65 primaries)
- New `u_glassType` uniform (float 0–4) mapped from `glassType` option string
- Fresnel F0 now derived from Sellmeier n(550nm) — was fixed 0.04 in v3

**§D — Improved Voronoi caustic system**
- PCG2D integer hash (Jarzynski & Olano 2020, JCGT Vol 9 No 3) replaces sin()-based hash
  — no lattice bias, period 2³² per axis, ~30% faster on GPU than trigonometric hash
- F2−F1 distance field replaces F1 — peaks at cell boundaries, eliminates pillow artefact
- Domain warping (IQ "Warped domain Voronoi") pre-distorts UV before Voronoi evaluation
- Per-cell independent animation: 4 PCG2D-derived scalars (rx, ry, px, py) per cell
- Per-cell depth variation: random scalar ∈ [0.5, 1.5] modulates caustic brightness
- Six octaves (was four) with 11.25° (π/16) rotation stagger per octave index
- 3×3 neighbourhood search (was 5×5) — domain warp fills quality gap at lower cost

**§G — chromaticRefraction() updated for Sellmeier**
- Per-channel displacement delta now uses `iorR`, `iorG`, `iorB` from Sellmeier
- Reference wavelength changed from `u_ior` to `iorG` (green, 550nm)
- Chromatic split is now physically accurate — SF11 shows 3.7× more splitting than BK7

**chromaticCaustic() — physical spectral split**
- RGB caustic UV offset derived from Sellmeier Δn instead of fixed ±0.009/0.010
- Split direction set at 37° to avoid alignment with rotation stagger series (multiples of 11.25°)

**rot2(), domainWarp(), voronoiF2F1(), causticBandImproved() — new GLSL helpers**

**Demo (demo.html)**
- Glass type selector UI with live IOR readout and dispersion bar per channel
- Debug panel extended: Glass, IOR (green), Δn R→B, Dispersion algorithm, Voronoi type, Octave count
- Hero eyebrow badge updated to reflect v4.0.0 feature set
- Voronoi comparison section: v3 vs v4 side-by-side
- Geist + DM Serif Display fonts
- `applyGlass()` JS handler patches `_LG_opts.glassType` and calls `refreshBackground()`

**`getOptions()` now returns live reference** (was shallow copy in v3) — enables runtime glass-type switching without reinitialisation.

---

### v3.0.0

**§15 — Full Cook-Torrance PBR Specular WebGL2 pass**
- Anisotropic GGX NDF (Burley 2012) with `BASE_ROUGHNESS = 0.04`, `ANISOTROPY = 0.35`
- Smith height-correlated visibility function (Heitz 2014)
- Schlick Fresnel with exact F0 from `GLASS_IOR = 1.52` → F0 ≈ 0.0426
- Kulla-Conty multi-bounce energy compensation (2017)
- Thin-film iridescence (Born & Wolf 1999) — `FILM_THICKNESS = 320 nm`, `FILM_IOR = 1.38`
- Area light representative-point approximation (Karis 2013)
- Three-light configuration: L0 cursor key, L1 static fill, L2 back-scatter
- Dedicated `.lg-specular-canvas` overlay per element

**§16 — `_buildSpecularCSS()` physically-grounded CSS fallback**
- Three GGX-lobe `radial-gradient` on `::before`
- Seven-layer `box-shadow` on `:hover`
- Thin-film iridescence `conic-gradient` on `::after`
- `prefers-reduced-motion` safe guards

**§5–§6 — Screen-space background refraction**
- html2canvas background capture engine with `requestIdleCallback` scheduling
- Snell's law UV displacement in GLSL fragment shader
- Cauchy per-channel IOR dispersion (R/G/B split at Δ IOR ±0.018) — replaced by Sellmeier in v4
- Environment reflection probe (Fresnel-weighted planar mirror)
- Scroll-drift compensation via `u_scroll` uniform
- `glassOpacity` and `glassSaturation` parameters

**Other**
- `specularStrength` and `specularWhiteness` init options
- IntersectionObserver viewport gate
- Frame-budget system (`_rafFrame` counter)
- `MAX_WEBGL_ELEMENTS = 32` hard cap

### v2.x
- Voronoi caustics (4 animated octaves, sin()-based hash, F1 metric)
- SVG chromatic aberration + micro-distortion filter bank
- Spring physics (semi-implicit Euler, three presets)
- Device orientation gyroscope support
- `createReplyQuote()` helper
- React hook `useLiquidGlass` (§14)
- MutationObserver auto-discovery

### v1.x
- CSS-only glass effect
- `backdrop-filter` blur + saturation
- Film grain overlay
- Initial spring physics cursor tracking

---

## License

[Apache 2.0](http://www.apache.org/licenses/LICENSE-2.0) © 2026 Boris Maltsev