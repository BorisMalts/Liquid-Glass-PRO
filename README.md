# 🫧 Vortex-Glass

<div align="center">

**Glassmorphism. Done properly.**

*WebGL2 caustics · Chromatic dispersion · Spring-physics cursor · Fresnel edge · Iridescence · GPU-adaptive rendering*

[![Version](https://img.shields.io/badge/version-1.1.1-a78bfa?style=flat-square)](https://github.com/BorisMalts/Vortex-Glass?tab=readme-ov-file)
[![License](https://img.shields.io/badge/license-Apache_2.0-818cf8?style=flat-square)](LICENSE)
[![Size](https://img.shields.io/badge/gzipped-~9kb-34d399?style=flat-square)](#)
[![Zero deps](https://img.shields.io/badge/dependencies-zero-f472b6?style=flat-square)](#)

</div>

---

```
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   ░▒▓█  liquid-glass  █▓▒░                                               ║
║                                                                          ║
║   The glass feels alive.                                                 ║
║   It breathes. It refracts. It responds.                                 ║
║   Now it caustics. Now it tilts. Now it knows physics.                   ║
║                                                                          ║
║   Six Houdini custom properties. One shared WebGL2 context.              ║
║   Symplectic Euler springs. Schlick Fresnel. Voronoi caustics.           ║
║   Zero dependencies. Every frame hand-crafted in GLSL.                  ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Table of Contents

- [Overview](#overview)
- [Architecture at a Glance](#architecture-at-a-glance)
- [What's New in v1.1.1](#whats-new-in-v111)
- [What's New in v1.1.0](#whats-new-in-v110)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [initLiquidGlass()](#initliquidglass)
  - [destroyLiquidGlass()](#destroyliquidglass)
  - [wrapWithDistortion()](#wrapwithdistortion)
  - [createGrainLayer()](#creategrainlayer)
  - [createReplyQuote()](#createreplyquote)
  - [attachElement()](#attachelement)
  - [detachElement()](#detachelement)
  - [getGpuTier()](#getgputier)
  - [version()](#version)
- [CSS Classes](#css-classes)
  - [.lg](#lg)
  - [.lg-interactive](#lg-interactive)
  - [.lg-own](#lg-own)
  - [.lg-reply](#lg-reply)
  - [.lg-pill](#lg-pill)
  - [.lg-card](#lg-card)
  - [.lg-fab](#lg-fab)
  - [.lg-outer](#lg-outer)
  - [.lg-grain](#lg-grain)
- [GPU Tier System](#gpu-tier-system)
- [CSS Custom Properties](#css-custom-properties)
- [Visual Layer Stack](#visual-layer-stack)
- [Spring Physics Deep Dive](#spring-physics-deep-dive)
- [WebGL Caustics Deep Dive](#webgl-caustics-deep-dive)
- [SVG Filter Bank](#svg-filter-bank)
- [Device Orientation Parallax](#device-orientation-parallax)
- [Lifecycle & Memory Management](#lifecycle--memory-management)
- [Accessibility](#accessibility)
- [Performance Notes](#performance-notes)
- [Integration Patterns](#integration-patterns)
  - [Basic card](#basic-card)
  - [Interactive button](#interactive-button)
  - [Chat bubble with reply quote](#chat-bubble-with-reply-quote)
  - [Shadow DOM (manual attach)](#shadow-dom-manual-attach)
  - [SPA lifecycle](#spa-lifecycle)
  - [React component wrapper](#react-component-wrapper)
  - [IntersectionObserver lazy-attach](#intersectionobserver-lazy-attach)
  - [Custom spotlight pre-position](#custom-spotlight-pre-position)
  - [Disabling individual effects](#disabling-individual-effects)
- [Browser Support](#browser-support)
- [FAQ](#faq)
- [Internals Reference](#internals-reference)
- [License](#license)

---

## Overview

**liquid-glass** is a zero-dependency library that brings genuine optical depth to glass-effect UI components.

Starting from v1.1.0 the library moves well beyond CSS-only glassmorphism by introducing a real-time WebGL2 caustic engine, spring-physics cursor dynamics, and physically-based light simulation — while remaining fully adaptive to low-end GPUs and accessible to users who prefer reduced motion.

The design philosophy: every visual effect has a physical counterpart in the real world. Caustics form where light bends through water. Fresnel glow intensifies at grazing angles. Thin-film shimmer comes from wave interference in a soap bubble coating. Nothing is decorative noise for its own sake — each layer simulates a real optical phenomenon.

| Layer | Technique | What it does |
|-------|-----------|--------------|
| 🌊 Distortion | SVG `feTurbulence` + 3-channel `feDisplacementMap` | Organic animated warping with per-channel chromatic fringing |
| ⚡ Caustics | WebGL2 Voronoi fragment shader | Animated light caustic patterns, per-element, blended in screen mode |
| 🌈 Iridescence | `conic-gradient` + Houdini `--lg-irid` | Slow colour-shift rainbow sheen rotating across the surface |
| 💡 Spotlight | `radial-gradient` via spring-driven `--lg-mx` / `--lg-my` | A soft highlight that follows the cursor with physical spring momentum |
| 🔮 Fresnel edge | Schlick approximation in GLSL | Edge glow that intensifies at grazing angles, tilt-aware |
| 🫧 Thin-film | Per-fragment oil-slick interference | Iridescent shimmer that shifts with tilt and time |
| 🌬️ Breathing | `lg-breathe` keyframe animation | Organic `border-radius` oscillation — the border feels alive |
| 🎞️ Film grain | Animated fractal-noise SVG overlay | Micro-texture that prevents the surface from looking synthetic |
| 🔬 Chromatic disp. | Per-channel UV offset in GLSL | Coloured light fringing at glass edges, matching real prism optics |
| 📱 Parallax tilt | `DeviceOrientationEvent` → tilt springs | Gyroscope-driven 3-D lean on mobile devices |

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                        initLiquidGlass()                            │
│                                                                     │
│  ┌───────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Houdini CSS   │  │  SVG filter  │  │  Stylesheet injected   │   │
│  │ registerProp  │  │  bank in     │  │  into <head>           │   │
│  │ --lg-mx/my/   │  │  <body>      │  │  (idempotent guard)    │   │
│  │ tx/ty/hover/  │  │  #lg-distort │  │                        │   │
│  │ irid          │  │  #lg-refract │  │                        │   │
│  └───────────────┘  └──────────────┘  └────────────────────────┘   │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  MutationObserver  →  _attach(el) for every .lg found      │     │
│  │                                                            │     │
│  │  Per element:                                              │     │
│  │  • <canvas class="lg-caustic-canvas">  (2-D overlay)      │     │
│  │  • <div class="lg-grain">              (film grain)        │     │
│  │  • pointermove / pointerenter / pointerleave listeners     │     │
│  │  • ResizeObserver keeps canvas pixel-perfect               │     │
│  │  • 5 SpringState objects in WeakMap<HTMLElement, State>    │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  requestAnimationFrame loop (single, shared)               │     │
│  │                                                            │     │
│  │  Each frame per element:                                   │     │
│  │  1. Advance 5 springs  (symplectic Euler, dt capped)       │     │
│  │  2. Write --lg-mx/my/tx/ty/hover to el.style               │     │
│  │  3. Set perspective rotateX/rotateY transform               │     │
│  │  4. _renderCausticsGL() → drawImage to overlay canvas      │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  ONE shared WebGL2 backend canvas (hidden, in <body>)      │     │
│  │                                                            │     │
│  │  • Resize to each element's physical px before render      │     │
│  │  • Render Voronoi caustic + Fresnel + thin-film shader     │     │
│  │  • drawImage() blit to element's 2-D overlay canvas        │     │
│  │  • Quota: MAX_WEBGL_ELEMENTS = 32  → CSS fallback beyond   │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What's New in v1.1.1

This is a patch release. No behaviour, API, or visual output has changed.

### 🐛 Bug Fixes

**`_buildCSS()` — unclosed `@media (prefers-reduced-motion: reduce)` block**

The closing `}` for the reduced-motion media query was missing at the end of the returned CSS string. In most browsers this caused the parser to silently discard the ruleset entirely, meaning the accessibility override (`animation: none`, `transition: none`, `filter: none`) had no effect for users who had enabled reduced-motion in their OS settings.

```css
/* v1.1.0 — block never closed; rules were ignored by the parser */
@media (prefers-reduced-motion: reduce) {
    .lg { ... }
    .lg-caustic-canvas { display: none; }
↑ missing }

/* v1.1.1 — correctly closed */
@media (prefers-reduced-motion: reduce) {
    .lg { ... }
    .lg-caustic-canvas { display: none; }
}
```

**Impact:** Any user with "Reduce Motion" enabled in their OS accessibility settings (macOS → Accessibility → Display, iOS → Accessibility → Motion, Windows → Ease of Access → Display) would have received full animations in v1.1.0 despite their preference. Upgrading to v1.1.1 immediately restores correct reduced-motion behaviour with no code changes required.

---

**`_attach()` — `es` referenced before declaration in pointer-event closures**

Inside `_attach`, the `onEnter` and `onLeave` closures both wrote to `es.hovered`. However, `es` was declared with `const` *after* those closures — relying on function-scoped `var`-style hoisting that does not apply to `const`/`let`. Under strict temporal dead zone rules this is technically a bug, and any linter or bundler that inlines or reorders declarations (e.g. Rollup, esbuild, Vite production build) could produce a `ReferenceError` at runtime.

```js
// v1.1.0 — es used inside closures before its const declaration
const onEnter = () => { es.hovered = true; };   // ← es not yet declared
const onLeave = () => { es.hovered = false; };  // ← es not yet declared
// ...
const es = { ... };   // declared here

// v1.1.1 — es declared first, assigned after handlers, before _tracked.add()
let es;                                         // ← declared here
const onEnter = () => { es.hovered = true; };   // safe closure reference
const onLeave = () => { es.hovered = false; };  // safe closure reference
// ...
es = { ... };   // assigned before any event can fire
```

**Impact:** In unbundled / native ESM usage this bug was latent (closures run only after `es` was assigned). With Rollup / esbuild / Vite production builds that reorder variable declarations, this could produce a `ReferenceError: Cannot access 'es' before initialization` on the first pointer interaction. Now safe under all build tools and minifiers.

---

## What's New in v1.1.0

### ⚡ WebGL2 Caustic Engine

A Voronoi-based caustic light simulation renders on a per-element 2-D overlay canvas. The library maintains a **single shared WebGL2 context** for the entire page — the backend canvas renders one element at a time then blits the result via `drawImage`. Elements beyond the quota (`MAX_WEBGL_ELEMENTS = 32`) fall back to CSS automatically.

The caustic fragment shader implements:
- Multi-scale animated Voronoi for the caustic ring pattern
- Per-channel chromatic dispersion (R/G/B sampled at different UV offsets)
- Schlick Fresnel edge glow, tilt-aware
- Specular primary and ghost highlights
- Thin-film iridescence mask at grazing angles
- Prismatic border band (light splitting at the glass edge)
- Gradient noise surface undulation

### 🎯 Spring-Physics Cursor Dynamics

Cursor position, hover factor, and 3-D tilt are driven by a **mass–damping–stiffness spring model** (symplectic Euler integration). The spotlight no longer snaps to the cursor — it trails behind with natural momentum, overshoots slightly, then settles.

```
F = −k(x − target) − d·v      (restoring + damping forces)
a = F / m                       (Newton's second law)
v += a · dt                     (velocity update — symplectic first)
x += v · dt                     (position update)
```

Three independent spring configurations are used:

| Spring | Stiffness | Damping | Mass | Character |
|--------|-----------|---------|------|-----------|
| `cursor` | 180 | 18 | 1.0 | Snappy, fast-settling |
| `hover` | 120 | 14 | 1.0 | Softer bloom |
| `tilt` | 90 | 12 | 1.2 | Slow, weighty lean |

### 🔬 Per-Channel Chromatic Dispersion

The caustic layer samples R, G, and B at slightly offset UV coordinates inside the fragment shader, producing coloured light fringing at glass edges — the same optical artefact seen through real glass prisms.

### 🔭 Physically-Based Fresnel Edge

A **Schlick approximation** computes edge glow based on a surface normal that tilts in response to cursor position and device orientation. The edge brightens at grazing angles exactly as real glass does.

```glsl
float schlick(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
```

### 🌈 Thin-Film Iridescence & Prismatic Band

Two GLSL effects simulate the optical phenomena of real glass coatings:
- **Thin-film**: oil-slick interference pattern (`cos` of angle + time + tilt), masked to element edges.
- **Prismatic band**: a narrow rainbow stripe at the very border, simulating light splitting at the glass edge, visible as a faint colour halo.

### 📱 Device Orientation Parallax

`DeviceOrientationEvent` feeds the tilt spring system on mobile. Physically tilting the device produces a 3-D parallax sensation — the glass appears to lean in space. The `beta` axis is offset by −0.5 to compensate for the natural phone-hold angle so the glass sits flat at rest.

### 🌬️ Liquid Border Morphing

Non-pill, non-FAB elements breathe through a 9-second organic `border-radius` animation cycle with eight distinct keyframes using asymmetric radii, making the border feel like a slow liquid surface tension oscillation.

### 🎛️ Six Houdini Properties

Two new custom properties added: `--lg-tx` and `--lg-ty` (tilt axes, type `<number>`), enabling native CSS interpolation of the 3-D transform alongside the existing `--lg-mx`, `--lg-my`, `--lg-irid`, and `--lg-hover`.

### 🧹 Full WeakMap Lifecycle

Per-element state (springs, canvas, ResizeObserver, listeners) is stored in a `WeakMap<HTMLElement, ElementState>`. Removed elements are automatically garbage-collected; `destroyLiquidGlass()` performs a full clean sweep with zero leaks.

---

## Features

- ⚡ **WebGL2 caustic engine** — Voronoi fragment shader, one shared GL context, per-element canvas blit
- 🎯 **Spring-physics cursor** — mass / damping / stiffness model, three independent spring configs
- 🔬 **Per-channel chromatic dispersion** — R / G / B sampled at different UV offsets in GLSL
- 🔭 **Schlick Fresnel edge glow** — physically correct, tilt-aware, grazing-angle brightening
- 🌈 **Thin-film iridescence** — oil-slick interference pattern at element edges
- 🌈 **Prismatic border band** — narrow rainbow stripe simulating light splitting at glass boundary
- 🎞️ **Film grain overlay** — fractal-noise SVG, animated position, soft-light blend
- 🫧 **Liquid border morphing** — organic `border-radius` breathing animation, 8 keyframes
- 📱 **Device orientation parallax** — gyroscope drives 3-D tilt on mobile
- 🏎️ **Adaptive GPU tiers** — `high / mid / low` detection via `UNMASKED_RENDERER_WEBGL`
- 🎛️ **Six Houdini custom properties** — all spring-driven values are CSS-animatable
- 👁️ **ResizeObserver** — caustic canvas stays pixel-perfect as elements resize
- 🧹 **Leak-free WeakMap lifecycle** — GC handles removed elements automatically
- 🔁 **Single shared rAF loop** — one `requestAnimationFrame` for the entire page, regardless of element count
- ♿ **`prefers-reduced-motion` aware** — all animations disabled when requested
- 📦 **Zero dependencies** — pure browser APIs, native ES modules
- 🔄 **Idempotent lifecycle** — `init` / `destroy` safe to call any number of times

---

## Installation

### From GitHub

```bash
git clone https://github.com/BorisMalts/Vortex-Glass
```

Then import directly — the library is a single native ES module:

```js
import { initLiquidGlass } from './liquid-glass.js';
```

No build step required. No bundler required. No npm install required.

### As an ES Module (CDN / self-hosted)

```html
<script type="module">
  import { initLiquidGlass } from './liquid-glass.js';
  initLiquidGlass();
</script>
```

### Bundler (Vite, Rollup, esbuild, Webpack)

Copy `liquid-glass.js` into your project's source directory and import normally. The library uses only standard browser APIs and contains no Node.js-specific code.

```js
import { initLiquidGlass, destroyLiquidGlass } from './lib/liquid-glass.js';
```

> **Note:** If your bundler tree-shakes or reorders declarations aggressively, v1.1.1 is required. Earlier versions contain a TDZ bug that manifests under Rollup/esbuild production builds (see [What's New in v1.1.1](#whats-new-in-v111)).

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>My App</title>
  <style>
    body {
      background: linear-gradient(135deg, #1a0533 0%, #0d1f4c 50%, #0a2a1a 100%);
      min-height: 100vh;
    }
  </style>
</head>
<body>

  <!-- The library injects CSS automatically — no stylesheet link needed -->

  <div class="lg lg-card lg-interactive"
       style="padding: 24px; max-width: 320px; margin: 60px auto; color: white;">
    <!-- .lg-grain is prepended automatically by initLiquidGlass(),
         but you can add it manually to prevent layout shift on load -->
    <div class="lg-grain"></div>
    <h2>Hello, glass.</h2>
    <p>This card caustics, refracts, shimmers, and responds to
       your cursor with spring physics.</p>
  </div>

  <script type="module">
    import { initLiquidGlass } from './liquid-glass.js';
    initLiquidGlass();
    // Done. Every .lg element in the page is now alive.
  </script>

</body>
</html>
```

The library auto-discovers all `.lg` elements present at call time, then watches for new ones via `MutationObserver`. You do not need to call any per-element setup — just add the class.

---

## API Reference

### `initLiquidGlass()`

```ts
function initLiquidGlass(): void
```

Bootstraps the entire library. Safe to call multiple times — subsequent calls before `destroyLiquidGlass()` are silent no-ops (guarded by the `_state.ready` flag).

**What it does internally, in order:**

1. Calls `_registerHoudini()` — registers the six typed CSS custom properties via `CSS.registerProperty`. Skipped silently if the Houdini API is unavailable (Firefox, older browsers degrade gracefully).
2. Calls `_injectSVG()` — creates the hidden `<svg>` with `#lg-distort` and `#lg-refract` filter defs and appends it to `<body>`.
3. Calls `_injectCSS()` — injects the full library stylesheet into `<head>` as a `<style id="liquid-glass-style-110">` element.
4. Calls `_startOrientationTracking()` — registers a passive `deviceorientation` listener for mobile gyroscope parallax.
5. If `document.readyState !== 'loading'`, immediately calls `_startObserver()` and `_startLoop()`. Otherwise defers them to `DOMContentLoaded`.

`_startObserver()` queries all existing `.lg` elements and calls `_attach()` on each, then starts the `MutationObserver` for future DOM changes.

`_startLoop()` starts the shared `requestAnimationFrame` physics loop.

```js
import { initLiquidGlass } from './liquid-glass.js';
initLiquidGlass();
```

---

### `destroyLiquidGlass()`

```ts
function destroyLiquidGlass(): void
```

Full teardown. Undoes every side effect of `initLiquidGlass()` and leaves the module in a state where `initLiquidGlass()` can be called again cleanly.

**What it does, in order:**

1. Cancels the rAF loop (`cancelAnimationFrame`).
2. Disconnects the `MutationObserver`.
3. Calls `_detach(el)` on every currently tracked element — removes caustic canvas, grain layer, event listeners, ResizeObserver, and inline CSS custom properties from each.
4. Removes the injected `<style>`, `<svg>`, and WebGL backend `<canvas>` from the DOM.
5. Calls `_stopOrientationTracking()` to remove the `deviceorientation` listener.
6. Resets `_gpuTierCache` to `null` and `_activeWebGLCount` to 0.
7. Resets the entire `_state` object to its default values.

```js
// On SPA route change:
destroyLiquidGlass();
initLiquidGlass(); // fresh init for the new view
```

---

### `wrapWithDistortion()`

```ts
function wrapWithDistortion(el: HTMLElement): WrapResult

interface WrapResult {
  wrapper: HTMLDivElement;
  unwrap:  () => void;
}
```

Wraps an element in a `.lg-outer` chromatic-aberration container. The SVG filter is applied at the wrapper level so distorted edges aren't clipped by the element's `overflow: hidden`.

The wrapper's `display` mode is inferred automatically from the element's computed style:

| Element `display` | Wrapper class added |
|-------------------|---------------------|
| `flex` / `inline-flex` | `.flex` |
| `grid` / `inline-grid` | `.grid` |
| Any other non-inline | `.block` |
| `inline` | *(no class — wrapper stays `inline-flex`)* |

`unwrap()` restores the exact original DOM position by using the stored `parentNode` and `nextSibling` reference captured at wrap time.

```js
const { wrapper, unwrap } = wrapWithDistortion(document.querySelector('.my-card'));
// Later:
unwrap(); // restores exact original DOM position
```

> **Note on Shadow DOM and iframes:** The SVG filter is injected into `document.body` of the main document. It is not reachable from Shadow DOM trees or cross-origin iframes. To apply distortion inside a Shadow Root, manually clone the `<svg>` element into that shadow root before calling `wrapWithDistortion`.

---

### `createGrainLayer()`

```ts
function createGrainLayer(): HTMLDivElement
```

Creates a `<div class="lg-grain">` animated film-grain overlay. The library inserts one automatically inside `_attach()` if none is already present, but you can call this manually when constructing elements before `initLiquidGlass()` is called, to prevent a brief layout shift.

The grain element uses a fractal-noise SVG data URI as its `background-image` — no external HTTP request. It animates only its `background-position` (a `steps(1)` animation that jumps the texture 9 times per second), making it cheap to run.

```js
const el = document.createElement('div');
el.className = 'lg lg-card lg-interactive';
el.prepend(createGrainLayer()); // manual placement
document.body.appendChild(el);
```

---

### `createReplyQuote()`

```ts
function createReplyQuote(
  sender:   string,
  text:     string,
  isOwn?:   boolean,          // default: false
  onClick?: (() => void) | null
): HTMLDivElement
```

Creates a fully-configured reply-quote bubble for messaging UIs. The returned element is a `.lg.lg-reply.lg-interactive` div with grain layer, sender span, text span, optional click handler, and spring physics attached immediately via `_attach()` if the library is already initialised.

```js
const quote = createReplyQuote(
  'Alice',
  'Are you coming to the meeting?',
  false,
  () => scrollToMessage('msg-42')
);
inputArea.prepend(quote);
```

**`isOwn: true`** applies the `.lg-own` purple-tinted variant, useful to distinguish the user's own quoted messages from received ones.

**DOM structure of the returned element:**

```html
<div class="lg lg-reply lg-interactive [lg-own]">
  <div class="lg-grain"></div>
  <span class="lg-sender">Alice</span>
  <span class="lg-text">Are you coming to the meeting?</span>
</div>
```

---

### `attachElement()`

```ts
function attachElement(el: HTMLElement): void
```

Manually attaches the full liquid-glass effect to a specific element. Useful when adding `.lg` elements to Shadow DOM or detached trees where the `MutationObserver` won't fire. Requires `initLiquidGlass()` to have been called first (logs a `console.warn` otherwise).

If the element is already tracked, this is a no-op.

```js
const el = document.createElement('div');
el.className = 'lg lg-interactive';
shadowRoot.appendChild(el);
attachElement(el);
```

---

### `detachElement()`

```ts
function detachElement(el: HTMLElement): void
```

Manually removes all liquid-glass machinery from an element, restoring it to its pre-attach state. Cleans up: event listeners, ResizeObserver, caustic canvas DOM node, grain layer DOM node, inline CSS custom property overrides, transform inline style, and WebGL quota counter.

Normally not needed — the `MutationObserver` handles cleanup automatically when elements are removed from the main document.

---

### `getGpuTier()`

```ts
function getGpuTier(): 'low' | 'mid' | 'high'
```

Returns the GPU performance tier detected on the current device. The result is cached permanently after first call (the WebGL probe canvas is destroyed immediately after reading the renderer string).

```js
if (getGpuTier() === 'high') {
  // enable additional particle effects in your own code
}
if (getGpuTier() === 'low') {
  // disable heavy background animations unrelated to liquid-glass
}
```

---

### `version()`

```ts
function version(): '1.1.1'
```

Returns the library version string. Useful for runtime debugging.

```js
console.log('liquid-glass version:', version()); // "1.1.1"
```

---

## CSS Classes

### `.lg`

The core glass surface class. Apply to any HTML element to give it the liquid-glass material.

```html
<div class="lg">Your content here</div>
```

**What this class provides:**
- Frosted `backdrop-filter: blur(26px) saturate(175%) brightness(1.10)`
- Layered 7-part `box-shadow` stack (2 inset bevels + 5 ambient/depth shadows)
- Spring-driven `::before` spotlight radial gradient (follows cursor via `--lg-mx` / `--lg-my`)
- Rotating iridescent `::after` conic-gradient (driven by `--lg-irid` Houdini property)
- `lg-breathe` border-radius animation (9s, 6 keyframes, asymmetric radii)
- `lg-irid-spin` iridescence rotation animation (15s linear infinite)
- WebGL caustic canvas overlay (injected by `_attach()`)
- Film grain layer (injected by `_attach()`)
- CSS custom properties `--lg-mx`, `--lg-my`, `--lg-tx`, `--lg-ty`, `--lg-hover`, `--lg-irid`

> **Important:** Never nest `.lg` inside another `.lg`. Stacking `backdrop-filter` is extremely expensive on the GPU. Each `backdrop-filter` requires the browser to flatten the compositing layer behind it — nesting causes exponential cost.

---

### `.lg-interactive`

Adds pointer-responsive hover and active states. Use on any clickable or tappable glass element.

```html
<div class="lg lg-interactive" role="button" tabindex="0">
  Click me
</div>
```

**Hover state:**
- Caustic canvas opacity: `0` → `0.02` (subtle shimmer reveal, `0.35s` ease transition)
- Background brightens to `rgba(255,255,255, 0.060)`
- Shadow depth increases (top bevel strengthens, outer shadows grow)

**Active state (`:active`):**
- `translateY(1px)` — physical depression
- `scale(0.991)` — slight compression
- `transition-duration: 0.07s` — snappy 70 ms snap-back
- Shadow stack collapses to match pressed-surface depth

---

### `.lg-own`

Purple-tinted variant for messages sent by the current user in chat interfaces.

```html
<div class="lg lg-own">Your outgoing message</div>
```

Overrides:
- Background uses `rgba(110, 68, 202, 0.055)` base with purple spotlight
- Box-shadow uses `rgba(165,100,255,*)` colour halo
- `::after` iridescence conic-gradient biased toward indigo/violet hues
- `.lg-sender` text colour shifts to `rgba(226,202,255,0.92)`

---

### `.lg-reply`

Reply-quote layout for chat interfaces. Column flex with a left accent bevel.

```html
<div class="lg lg-reply lg-interactive">
  <div class="lg-grain"></div>
  <span class="lg-sender">Alice</span>
  <span class="lg-text">Original message preview — truncated with ellipsis</span>
</div>
```

**Structural details:**
- `display: flex; flex-direction: column; gap: 3px`
- `padding: 8px 12px; margin-bottom: 8px; border-radius: 10px`
- Left side `inset 2.5px 0 0 rgba(255,255,255,0.40)` bevel for quoted-message indicator
- `.lg-sender` — 11px bold, letterSpacing 0.02em, nowrap + ellipsis
- `.lg-text` — 12px, 50% opacity, nowrap + ellipsis
- Breathing animation excluded (uses `lg-irid-spin` only)

---

### `.lg-pill`

Full-radius pill / chip shape. Breathing animation is excluded because asymmetric border-radius on a pill looks wrong.

```html
<div class="lg lg-pill lg-interactive">Tag Label</div>
```

Built-in padding: `6px 18px`. Border-radius: `999px`.

---

### `.lg-card`

Large card variant with generous radius and padding. Best for content containers.

```html
<div class="lg lg-card">
  <div class="lg-grain"></div>
  <h3>Card Title</h3>
  <p>Card content goes here.</p>
</div>
```

Overrides: `border-radius: 22px; padding: 20px`.

---

### `.lg-fab`

Circular floating action button, fixed 56×56 px, centred content.

```html
<div class="lg lg-fab lg-interactive" role="button" aria-label="Add item">
  ＋
</div>
```

Overrides: `border-radius: 50%; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; flex-shrink: 0`. Breathing animation excluded.

---

### `.lg-outer`

SVG distortion wrapper. Normally you create this via `wrapWithDistortion()`, but you can also write it in HTML directly.

```html
<div class="lg-outer block">
  <div class="lg lg-card">Content</div>
</div>
```

The `filter: url(#lg-distort)` is applied here (not on `.lg` directly) so that the chromatic aberration effect isn't clipped by the element's own `overflow: hidden`. Under `prefers-reduced-motion: reduce` the filter is removed automatically.

Display modifiers: add `.block`, `.flex`, or `.grid` to control wrapper layout.

---

### `.lg-grain`

Animated film-grain overlay. Must be the **first child** inside `.lg` (or at least before non-effect content children). Position: `absolute; inset: 0`. z-index: 3.

The grain is a 240×240 px fractal-noise SVG tiled across the surface, animated via `background-position` jitter at ~9 fps (cheap, GPU-invisible). Blended via `mix-blend-mode: soft-light` at `opacity: 0.038`.

---

## GPU Tier System

At init time the library creates a temporary WebGL context, reads `UNMASKED_RENDERER_WEBGL` via `WEBGL_debug_renderer_info`, then immediately destroys the context (calls `WEBGL_lose_context.loseContext()` and sets `width = height = 0`).

| Tier | Detected renderer strings | WebGL caustics | SVG aber. scale |
|------|--------------------------|----------------|-----------------|
| `low` | Adreno 2xx–4xx, Mali-2/4/T, PowerVR SGX, no WebGL support | Disabled (CSS-only) | Passthrough (identity) filter |
| `mid` | Adreno 5xx/6xx, Mali-G5x/G7x, Apple GPU < 10-core | Enabled at reduced scale | `aber = 0.9`, `refSc = 2` |
| `high` | Desktop GPUs, Apple GPU ≥ 10-core, unrecognised desktop | Full quality | `aber = 1.6`, `refSc = 3` |

**Mobile heuristic:** When `WEBGL_debug_renderer_info` is unavailable (some privacy-hardened browsers), the library falls back to `navigator.userAgent` — mobile UA → `low`, desktop UA → `high`.

**WebGL quota:** A maximum of **32 elements** may have an active WebGL caustic canvas simultaneously (`MAX_WEBGL_ELEMENTS = 32`). Elements beyond this quota receive CSS-only rendering automatically. The quota prevents GPU memory over-commitment on pages with many glass surfaces (e.g. chat lists, dashboards).

---

## CSS Custom Properties

Six typed Houdini properties are registered via `CSS.registerProperty()`, enabling smooth browser-native interpolation between values set each rAF frame.

| Property | Type | Default | Updated by | Range |
|----------|------|---------|------------|-------|
| `--lg-mx` | `<percentage>` | `50%` | Cursor X spring → `springX.value * 100 + '%'` | 0% – 100% |
| `--lg-my` | `<percentage>` | `30%` | Cursor Y spring → `springY.value * 100 + '%'` | 0% – 100% |
| `--lg-irid` | `<angle>` | `0deg` | CSS `lg-irid-spin` keyframe animation | 0deg – 360deg |
| `--lg-hover` | `<number>` | `0` | Hover spring → `hoverSpring.value` | 0 – 1 |
| `--lg-tx` | `<number>` | `0` | Tilt X spring → `tiltX.value` | −1 – 1 |
| `--lg-ty` | `<number>` | `0` | Tilt Y spring → `tiltY.value` | −1 – 1 |

**Houdini availability:** Registered in Chrome/Edge 94+, Safari 15.4+. Not supported in Firefox — values still work as regular custom properties but lose smooth interpolation between keyframes. All animations still function correctly, they just animate via JavaScript rAF rather than the native CSS interpolation path.

**Overriding per-element:**

```css
/* Pre-position the spotlight to upper-left for a hero card */
.hero-card.lg {
  --lg-mx: 18%;
  --lg-my: 12%;
}
```

---

## Visual Layer Stack

Inside every `.lg` element, effects are composited in z-index order:

```
┌─────────────────────────────────────────────────────────┐
│  z 5  Content children       Text, icons, interactive   │
│  z 4  .lg-caustic-canvas     WebGL caustics (screen)    │
│  z 3  .lg-grain              Film grain (soft-light)    │
│  z 2  ::after                Iridescent conic-gradient  │
│  z 1  ::before               Spring spotlight gradient  │
│       .lg background         Frosted glass material     │
│       (backdrop-filter)      Blur / saturate / bright   │
└─────────────────────────────────────────────────────────┘
           ↑ content behind element (not part of .lg DOM)
```

**Blend modes used:**
- `.lg-caustic-canvas` → `mix-blend-mode: screen` — adds light, never darkens
- `.lg-grain` → `mix-blend-mode: soft-light` — gentle contrast texture
- `.lg::after` → `mix-blend-mode: overlay` — iridescent colour shift on the glass

---

## Spring Physics Deep Dive

Every `.lg` element tracked by the library maintains five independent `SpringState` objects:

```
springX     ── horizontal cursor position (0..1)
springY     ── vertical cursor position   (0..1)
hoverSpring ── hover blend factor          (0..1)
tiltX       ── 3-D tilt along X axis      (-1..1)
tiltY       ── 3-D tilt along Y axis      (-1..1)
```

Each spring uses **symplectic (semi-implicit) Euler integration** — the velocity is updated before the position, which provides better long-term energy conservation than explicit Euler and is trivially cheap to compute:

```js
const force = -stiffness * (value - target) - damping * velocity;
velocity   += (force / mass) * dt;  // velocity first
value      += velocity * dt;        // then position
```

The time step `dt` is capped at `MAX_DT = 0.05 s` (= 20 fps equivalent) so that focus-regain after a tab switch doesn't produce an unrealistically large single-frame advance.

**Spring interaction flow:**

```
pointer moves  →  springX.target, springY.target update
                  tiltX.target, tiltY.target update

pointer enters →  hoverSpring.target = 1

pointer leaves →  springX.target = 0.5 (centred)
                  springY.target = 0.30 (slight top bias)
                  hoverSpring.target = 0
                  tiltX.target = 0
                  tiltY.target = 0

device tilts   →  tiltX.target, tiltY.target blend
                  (only when pointer is NOT inside element)
```

---

## WebGL Caustics Deep Dive

The caustic simulation runs entirely inside a GLSL fragment shader. The core technique:

**Voronoi caustics** — real water caustics form where light rays from adjacent regions converge at the boundaries between Voronoi cells. The shader computes the distance from each fragment to the nearest of 25 animated Voronoi points (5×5 grid with ±2 cell neighbourhood search), then maps this distance to a bright sharp ring:

```glsl
float d = voronoi(uv * scale + seed, u_time * speed);
return pow(smoothstep(0.0, 0.30, d), 1.5);
```

Four scales are blended: 3.4 / 5.9 / 2.1 / 8.1 — each with independent speed and seed, producing rich layered caustics that never visibly tile.

**Chromatic dispersion** — R, G, B are sampled from the same Voronoi function but at slightly different UV offsets:

```
R: uvA + vec2( 0.009,  0.004)
G: uvA + vec2(-0.005, -0.006)
B: uvA + vec2( 0.004, -0.010)
```

The offsets are small enough to read as coloured glass fringing rather than gross colour separation.

**One shared context, blit-per-element** — instead of one WebGL context per element (which hits driver limits), the library maintains a single hidden backend `<canvas>`. Each frame, for each WebGL-enabled element:

1. Resize the backend canvas to the element's physical pixel dimensions (free if unchanged)
2. Render the fragment shader with element-specific uniforms (mouse position, hover factor, tilt, time)
3. `ctx2d.drawImage(backendCanvas, 0, 0)` — blit to the element's 2-D overlay canvas

The blit is the most expensive part per element; it's a GPU→GPU texture copy via the browser's 2-D canvas compositing path.

---

## SVG Filter Bank

Two SVG filters are injected into `<body>`:

**`#lg-distort`** — chromatic aberration applied to `.lg-outer` wrappers.

Animates `feTurbulence` `baseFrequency` across three keyframes over 12 seconds, plus randomly seeds it across a 31-second cycle. Three `feDisplacementMap` operations displace R, G, and B channels by different amounts:

| Channel | Scale (high tier) | Scale (mid tier) |
|---------|-------------------|------------------|
| R (xR,yG) | 1.6 | 0.9 |
| G (xG,yB) | 0.99 | 0.56 |
| B (xB,yR) | 0.58 | 0.32 |

Channels are isolated with `feColorMatrix` then recombined via `feBlend mode="screen"`. The low tier receives an identity passthrough filter.

**`#lg-refract`** — higher-amplitude `fractalNoise` displacement applied at the border edge for barrel-distortion effect.

---

## Device Orientation Parallax

On mobile devices, `DeviceOrientationEvent` feeds the global tilt state:

```js
_state.deviceTilt.x = clamp(gamma / 45, -1, 1);   // left/right
_state.deviceTilt.y = clamp(beta / 45 − 0.5, -1, 1); // fwd/back
```

The `/45` normalisation maps the device's natural movement range to −1..1. The `−0.5` on beta compensates for the typical ~20–30° forward lean when holding a phone, so the glass sits at neutral tilt in natural hand position.

When the cursor is inside an element (`es.hovered = true`), cursor tilt takes priority. When the cursor leaves, the tilt springs relax toward `deviceTilt * 0.45` (the 0.45 factor prevents the glass from tilting too aggressively on bumpy surfaces).

---

## Lifecycle & Memory Management

**Normal flow (main document):**

All `.lg` elements are tracked in a `Set<HTMLElement>` (`_tracked`) for iteration, and a `WeakMap<HTMLElement, ElementState>` (`_elements`) for per-element data. When a `.lg` element is removed from the DOM, the `MutationObserver` fires `_detach(el)`, which:

1. Removes 3 event listeners
2. Disconnects the ResizeObserver
3. Removes the caustic canvas DOM node
4. Removes the grain layer DOM node
5. Clears 5 inline CSS custom properties
6. Clears the transform inline style
7. Decrements `_activeWebGLCount` if applicable
8. Deletes from `_elements` WeakMap
9. Deletes from `_tracked` Set

The WeakMap ensures that if `_detach` somehow isn't called (e.g. direct garbage-collection of a detached tree), the `ElementState` objects are still freed by the GC automatically — no hard reference chain can prevent collection.

**SPA route changes:**

Call `destroyLiquidGlass()` before unmounting the old route and `initLiquidGlass()` after mounting the new one. This is the recommended pattern for React, Vue, Svelte, and Angular SPAs.

**Shadow DOM:**

The `MutationObserver` does not observe inside Shadow Roots. Use `attachElement()` and `detachElement()` manually when adding/removing `.lg` elements inside a Shadow Root.

---

## Accessibility

### `prefers-reduced-motion`

When the user has enabled the OS-level "Reduce Motion" preference, the following overrides apply:

```css
@media (prefers-reduced-motion: reduce) {
  .lg, .lg::before, .lg::after, .lg-grain, .lg-caustic-canvas {
    animation:   none !important;
    transition:  none !important;
    will-change: auto !important;
  }
  .lg           { border-radius: 16px !important; transform: none !important; }
  .lg-outer     { filter: none !important; }
  .lg-caustic-canvas { display: none; }
}
```

All motion is removed. The glass material (frosted blur, bevels, shadows) is preserved — only animation and dynamic effects are disabled. This ensures the UI remains visually consistent with the rest of the product rather than suddenly switching to an unstyled fallback.

> **v1.1.1 fix:** The closing `}` brace was missing in v1.1.0, causing this entire block to be silently discarded by the CSS parser. Users with reduced-motion enabled were receiving full animations. This is corrected in v1.1.1.

### Pointer events

All overlay layers (`::before`, `::after`, `.lg-grain`, `.lg-caustic-canvas`) have `pointer-events: none`. Clicks and touches pass through to content children.

### Semantic structure

The library imposes no semantic markup. Use proper `role`, `aria-*`, and `tabindex` attributes on your elements:

```html
<div class="lg lg-interactive" role="button" tabindex="0"
     aria-label="Open settings">
  <div class="lg-grain"></div>
  ⚙
</div>
```

### Focus ring

The library does not impose a focus ring. Add one yourself to match your product's design system:

```css
.lg.lg-interactive:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.65);
  outline-offset: 3px;
}
```

---

## Performance Notes

### `backdrop-filter` (the most expensive property)

`backdrop-filter` requires the browser to composite a separate GPU layer for every element that uses it. Cost scales with element size (pixel area) and the number of visible elements.

- **Never nest `.lg` inside `.lg`.** Stacking backdrop-filter layers is extremely costly.
- On mobile, limit the number of simultaneously visible `.lg` elements. Consider using only 1–3 on any given screen.
- On very large elements (e.g. full-viewport hero panels), reduce the blur radius:
  ```css
  .hero.lg { backdrop-filter: blur(16px) saturate(160%); }
  ```

### WebGL caustics

- One shared GL context — never hits the browser's per-page context limit (~16 contexts).
- Backend canvas resize is cheap when dimensions are unchanged (the common case each frame).
- Quota of 32 active caustic elements prevents GPU memory over-commitment.
- Caustics are hidden at rest (`opacity: 0`) and only gently revealed on hover (`opacity: 0.02`). The render still happens every frame for WebGL-enabled elements, even when invisible. Use `detachElement()` to fully stop caustic rendering for off-screen elements.

### rAF loop

- Single loop for the entire page, started once by `initLiquidGlass()`.
- Per element per frame: 5 spring steps + 5 `setProperty` calls + 1 `style.transform` write + 1 `_renderCausticsGL` call. At 32 elements @ 60 fps this is ~64k simple operations per second — negligible on any modern device.
- All 5 spring states are checked against `_atRest()` but the loop continues unconditionally for simplicity. For pages where all glass elements are truly at rest, a future optimisation could pause the loop and restart on the next pointer event.

### ResizeObserver

- One observer per element, observing `contentRect`.
- Canvas resize only fires when `contentRect` dimensions actually change — no work done on stable layouts.
- Avoid animating `width` or `height` on `.lg` elements. Triggering layout on every frame forces ResizeObserver to fire every frame, which resizes the caustic canvas every frame (moderately expensive).

### Recommendations

```
• Keep .lg elements out of high-frequency scroll lists
  → Use IntersectionObserver + attachElement() / detachElement() for lazy physics

• Avoid width/height CSS transitions on .lg elements
  → Animating size triggers continuous ResizeObserver + caustic canvas resize

• On mobile, prefer 1–3 .lg elements per screen
  → backdrop-filter is the GPU bottleneck on tile-based renderers

• Use .lg-pill and .lg-fab on toolbar items, not list cells
  → Reserve .lg-card for hero surfaces and primary CTAs

• Call destroyLiquidGlass() before heavy animations on non-glass DOM
  → Stops the rAF loop, freeing the frame budget for your own animations
```

---

## Integration Patterns

### Basic card

```html
<div class="lg-outer">
  <div class="lg lg-card" style="color: white; max-width: 300px;">
    <div class="lg-grain"></div>
    <h3 style="margin: 0 0 8px;">Weekly Summary</h3>
    <p style="margin: 0; opacity: 0.7;">12 tasks completed · 3 in progress</p>
  </div>
</div>
```

---

### Interactive button

```html
<div class="lg-outer">
  <button class="lg lg-pill lg-interactive"
          style="font-size: 15px; font-weight: 600; color: white; border: none; cursor: pointer;">
    <div class="lg-grain"></div>
    Get Started
  </button>
</div>
```

---

### Chat bubble with reply quote

```js
import { initLiquidGlass, createReplyQuote, createGrainLayer } from './liquid-glass.js';

initLiquidGlass();

function createBubble(text, isOwn = false, replyTo = null) {
  const bubble = document.createElement('div');
  bubble.className = `lg${isOwn ? ' lg-own' : ''}`;
  bubble.style.cssText =
    'padding: 10px 14px; max-width: 280px; color: white; border-radius: 18px;';

  bubble.appendChild(createGrainLayer());

  if (replyTo) {
    bubble.appendChild(
      createReplyQuote(replyTo.sender, replyTo.text, isOwn, replyTo.onClick)
    );
  }

  bubble.appendChild(
    Object.assign(document.createElement('p'), {
      textContent: text,
      style: 'margin: 6px 0 0;'
    })
  );

  return bubble;
}

document.querySelector('#chat').appendChild(
  createBubble('Got your message!', true, {
    sender: 'Alice',
    text: 'Are you coming to the meeting?',
    onClick: () => scrollToMessage('msg-42')
  })
);
```

---

### Shadow DOM (manual attach)

```js
import { initLiquidGlass, attachElement, detachElement } from './liquid-glass.js';

initLiquidGlass();

class GlassWidget extends HTMLElement {
  #el = null;

  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });

    this.#el = document.createElement('div');
    this.#el.className = 'lg lg-interactive';
    this.#el.textContent = 'Inside shadow DOM';
    shadow.appendChild(this.#el);

    // MutationObserver doesn't see inside shadow DOM
    attachElement(this.#el);
  }

  disconnectedCallback() {
    if (this.#el) detachElement(this.#el);
  }
}

customElements.define('glass-widget', GlassWidget);
```

---

### SPA lifecycle

```js
import { initLiquidGlass, destroyLiquidGlass } from './liquid-glass.js';

// React / Vue / Svelte — on mount:
initLiquidGlass();

// On unmount / route change:
destroyLiquidGlass();
```

**React hook example:**

```jsx
import { useEffect } from 'react';
import { initLiquidGlass, destroyLiquidGlass } from './liquid-glass.js';

function useLiquidGlass() {
  useEffect(() => {
    initLiquidGlass();
    return () => { destroyLiquidGlass(); };
  }, []);
}

// In your layout component:
export function Layout({ children }) {
  useLiquidGlass();
  return <main>{children}</main>;
}
```

**Vue composable example:**

```js
import { onMounted, onUnmounted } from 'vue';
import { initLiquidGlass, destroyLiquidGlass } from './liquid-glass.js';

export function useLiquidGlass() {
  onMounted(() => initLiquidGlass());
  onUnmounted(() => destroyLiquidGlass());
}
```

---

### IntersectionObserver lazy-attach

For long scrolling pages with many `.lg` elements (e.g. a feed or timeline), use IntersectionObserver to activate and deactivate physics only for visible items. This prevents the rAF loop from advancing springs for off-screen elements.

```js
import { initLiquidGlass, attachElement, detachElement } from './liquid-glass.js';

initLiquidGlass();

const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      attachElement(entry.target);
    } else {
      detachElement(entry.target);
    }
  }
}, { rootMargin: '120px' }); // 120px pre-load margin

// Apply to existing elements — do NOT add .lg to the stylesheet
// (the MutationObserver would auto-attach them; bypass this by using a
// different class for initial markup and toggling .lg on intersection)
document.querySelectorAll('.my-glass-item').forEach(el => {
  io.observe(el);
});
```

---

### React component wrapper

```jsx
import { useEffect, useRef } from 'react';
import { attachElement, detachElement } from './liquid-glass.js';

function GlassCard({ children, variant = '', className = '', style = {} }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    attachElement(el);
    return () => { detachElement(el); };
  }, []);

  return (
    <div
      ref={ref}
      className={`lg ${variant} lg-interactive ${className}`.trim()}
      style={style}
    >
      <div className="lg-grain" />
      {children}
    </div>
  );
}

// Usage:
<GlassCard variant="lg-card" style={{ maxWidth: 300, color: 'white' }}>
  <h3>Hello from React</h3>
</GlassCard>
```

---

### Custom spotlight pre-position

Override `--lg-mx` and `--lg-my` per element to pre-position the spotlight before the user hovers:

```css
/* Hero card — spotlight locked to upper-left */
.hero-glass {
  --lg-mx: 20%;
  --lg-my: 15%;
}

/* Right-aligned element — spotlight biased to the right */
.right-panel.lg {
  --lg-mx: 78%;
  --lg-my: 25%;
}
```

The spring system will still animate from this initial value when the user moves the cursor over the element. The custom property acts as the spring's initial position and resting position (when cursor is outside).

---

### Disabling individual effects

**Disable breathing animation on a specific card:**

```css
.my-card.lg {
  /* Override the animation shorthand — keep only iridescence */
  animation: lg-irid-spin 15s linear infinite;
}
```

**Disable iridescence on a specific element:**

```css
.my-card.lg::after {
  display: none;
}
```

**Reduce blur for a lightweight variant:**

```css
.my-card.lg {
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
}
```

**Disable caustics globally (CSS only, no API call):**

```css
.lg-caustic-canvas { display: none !important; }
```

---

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome / Edge | 94+ | Full support — Houdini `CSS.registerProperty`, WebGL2, `backdrop-filter`, `DeviceOrientationEvent` |
| Firefox | 103+ | Full except Houdini (`CSS.registerProperty` not available — custom properties work but aren't smoothly interpolated natively). All animations and physics still function via JS. |
| Safari | 15.4+ | Full support — Houdini, WebGL2, `backdrop-filter`, gyroscope parallax on iOS |
| Chrome Android | 94+ | GPU tier often resolves to `low` or `mid`; caustics may be disabled. `backdrop-filter` supported. Gyroscope parallax active. |
| Safari iOS | 15.4+ | Full support. Gyroscope parallax fully active. Reduced caustic quota recommended for older A-series chips. |
| Samsung Internet | 14+ | Full except Houdini |

**Hard requirements:**
- `backdrop-filter` — required for the glass material. Without it `.lg` renders as a transparent box.
- `WebGL2` — required for caustics. Falls back to CSS-only rendering transparently.
- `CSS.registerProperty` (Houdini) — optional enhancement. Without it the custom properties work but lose native interpolation.

**Graceful degradation path:**

```
WebGL2 unavailable → CSS-only rendering (no caustic canvas)
Houdini unavailable → JS-driven custom properties (still animates, just via rAF)
backdrop-filter unsupported → glass renders without frosted-glass material
prefers-reduced-motion: reduce → all animations and caustics disabled
GPU tier = low → caustics disabled, SVG filter passthrough
```

---

## FAQ

**Q: The glass looks opaque / I can't see through it.**

`backdrop-filter` only blurs content *behind* the element in the GPU compositing stack. Your `.lg` element needs visually rich content behind it — a gradient background, an image, other DOM elements with colour. A `body { background: white }` with nothing else will appear nearly opaque because there's nothing to blur.

---

**Q: The caustics aren't appearing.**

Several reasons this can happen:
1. **`getGpuTier()` returns `'low'`** — caustics are disabled entirely on low-tier GPUs. Check `getGpuTier()` in the console.
2. **Element doesn't have `.lg-interactive`** — caustics are opacity 0 at rest and only revealed on hover for `.lg-interactive` elements.
3. **WebGL2 unavailable** — the library falls back silently to CSS-only. Check `canvas.getContext('webgl2')` in the console.
4. **Quota exceeded** — more than `MAX_WEBGL_ELEMENTS = 32` elements with WebGL active. Earlier-attached elements have priority.

---

**Q: The distortion / chromatic aberration effect isn't showing.**

The SVG filter is injected into `document.body` of the main document. It won't be reachable from Shadow DOM roots or cross-origin iframes. Inject the SVG manually into those contexts. Also check that you're using the `.lg-outer` wrapper — the distortion filter is applied there, not on `.lg` directly.

---

**Q: My bundler (Rollup / esbuild / Vite) throws `ReferenceError: Cannot access 'es' before initialization`.**

You're using v1.1.0 with a bundler that reorders `const` declarations. Upgrade to **v1.1.1** — this TDZ bug is fixed.

---

**Q: Can I disable the breathing animation on a specific element?**

Yes:

```css
.my-specific-card.lg {
  animation: lg-irid-spin 15s linear infinite;
}
```

This replaces the combined `animation` shorthand (which includes `lg-breathe`) with only the iridescence rotation.

---

**Q: How do I use this in a high-frequency scroll list?**

Don't apply `.lg` directly to list items in a large virtual list. Instead:

1. Keep list item markup free of `.lg`.
2. Use an `IntersectionObserver` that adds the `.lg` class (and calls `attachElement()`) when an item enters the viewport, and removes it (calling `detachElement()`) when it leaves.
3. Alternatively, use list virtualisation — only render DOM nodes for visible items.

---

**Q: Can I change the blur amount?**

Yes, override `backdrop-filter` on your element:

```css
.my-card.lg {
  backdrop-filter: blur(10px) saturate(150%);
  -webkit-backdrop-filter: blur(10px) saturate(150%);
}
```

Lower blur values (8–12px) are significantly cheaper on mobile.

---

**Q: Why did my reduced-motion preference have no effect in v1.1.0?**

A missing closing brace in the `@media (prefers-reduced-motion: reduce)` block caused the browser CSS parser to silently discard all rules inside it. This is fixed in v1.1.1 — upgrading immediately restores correct accessibility behaviour with no code changes.

---

**Q: Does this work with CSS-in-JS solutions (styled-components, Emotion)?**

Yes. The library injects its own `<style>` tag — it doesn't depend on your styling solution. Your CSS-in-JS styles apply to `.lg` elements normally. The only consideration: CSS-in-JS libraries that use `Shadow DOM` style scoping will not see the library's injected stylesheet inside those shadow roots.

---

**Q: Can I extend the glass with my own GLSL effects?**

The current API doesn't expose the WebGL context or allow shader injection. The `_state.glBackend` and `_state.glProgram` are module-private. Fork the library and modify `_FRAG_SRC` directly to add your own GLSL stages.

---

**Q: Why is `MAX_WEBGL_ELEMENTS` 32 and not higher?**

Each WebGL-enabled element requires a private `<canvas>` node for its 2-D overlay (the blit target). At 32 elements × ~300×100 px each (a typical chat bubble) the total pixel allocation is ~1 million px — within the comfortable range of any GPU's texture memory. The shared backend canvas is resized per element per frame, so backend memory cost is just one frame buffer. The quota is a safety valve, not a hard technical limit; adjust `MAX_WEBGL_ELEMENTS` in the source if your use case warrants it.

---

## Internals Reference

A quick map of the source sections for contributors:

| Section | Description |
|---------|-------------|
| §0 JSDoc types | `GpuTier`, `ElementState`, `SpringState`, `WrapResult` typedef definitions |
| §1 Module-private state | `_state` singleton, `_elements` WeakMap, `_tracked` Set, `_gpuTierCache` |
| §2 Configuration | `SPRING` presets, `MAX_DT`, `MAX_WEBGL_ELEMENTS` |
| §3 GPU tier detection | `_detectGpuTier()` — WebGL probe + renderer string regex |
| §4 Spring physics | `_createSpring()`, `_stepSpring()`, `_atRest()` |
| §5 Houdini registration | `_registerHoudini()` — `CSS.registerProperty` for 6 typed properties |
| §6 WebGL caustics | `_VERT_SRC`, `_FRAG_SRC`, `_compileShader()`, `_buildProgram()`, `_initWebGL()`, `_renderCausticsGL()` |
| §7 SVG filter bank | `_buildSVGDefs()`, `_injectSVG()` |
| §8 CSS injection | `_buildCSS()`, `_injectCSS()` |
| §9 Device orientation | `_startOrientationTracking()`, `_stopOrientationTracking()` |
| §10 Attach / detach | `_attach()`, `_detach()` — per-element lifecycle |
| §11 rAF loop | `_rafLoop()`, `_startLoop()`, `_stopLoop()` |
| §12 MutationObserver | `_attachSubtree()`, `_detachSubtree()`, `_startObserver()` |
| §13 Display map | `_DISPLAY_MAP` — computed style → wrapper class lookup |
| §14 Public API | All exported functions |

---

## License

Licensed under the [Apache License 2.0](LICENSE).

```
Copyright 2026 Boris Maltsev

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

---

<div align="center">

*Built with an unhealthy obsession with light physics.*

</div>
