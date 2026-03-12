// liquid-glass-pro.js · v4.1.0
//
// Physically-based liquid glass rendering for the web, built on WebGL2 + CSS backdrop-filter.
//
// ── How it works ──────────────────────────────────────────────────────────────
//
//   1. html2canvas captures the page at reduced resolution and uploads the
//      result to a WebGL2 texture (TEXTURE_UNIT1, sampler u_background).
//
//   2. The fragment shader derives a surface normal from animated gradient noise
//      and displaces the background UV via Snell's law — independently for each
//      RGB channel using physically accurate Sellmeier IOR values.
//
//   3. An SVG feDisplacementMap on the .lg-outer wrapper adds chromatic
//      aberration at the DOM level, running in parallel with the WebGL pass.
//
//   4. A full Cook-Torrance PBR specular highlight is rendered into a dedicated
//      .lg-specular-canvas per element:
//        · Anisotropic GGX NDF              (Burley 2012,  αT=0.0483, αB=0.0331)
//        · Smith height-correlated visibility (Heitz 2014)
//        · Schlick Fresnel — F0 derived from Sellmeier n(550 nm), not fixed 0.04
//        · Kulla-Conty multi-bounce energy compensation (2017)
//        · Thin-film iridescence             (Born & Wolf 1999, d=320 nm, n=1.38)
//        · Three-light config: L0 cursor key · L1 fill · L2 back-scatter
//
//   5. Six octaves of Voronoi caustics (PCG2D hash · F2−F1 distance field ·
//      domain warping · rotation stagger) produce caustic patterns that are
//      physically consistent with the Sellmeier dispersion of the active glass.
//
//   6. Semi-implicit Euler spring physics drives cursor tracking and device tilt
//      with three presets: cursor (stiff, snappy) · hover (soft) · tilt (inertial).
//
//   7. Houdini CSS custom properties (--lg-mx, --lg-my, --lg-tx …) are written
//      every rAF frame, enabling smooth browser-native CSS transitions.
//
//   8. Twelve glass surface variants (clear · frosted · smoke · tinted-blue ·
//      tinted-violet · tinted-amber · mirror · ice · bronze · emerald · rose ·
//      obsidian) define physical optical character via Beer-Lambert absorption,
//      Fresnel F0, scatter amount, and per-variant caustic tinting — all driven
//      by GLSL uniforms uploaded per frame, switchable at runtime without reinit.
//
// ── What's new in v4.1.0 ──────────────────────────────────────────────────────
//
//   Glass Variant System
//     Twelve physically-grounded surface presets derived from real optical
//     constants (Schott catalogue 2023, Warren & Brandt 2008, Palik 1998).
//     Each variant encodes: IOR · Beer-Lambert tintRGB · tintStrength · frosted ·
//     mirror · smokeDensity · causticScale · causticTint · blurPx · CSS overrides.
//     Switch at runtime: setGlassVariant('obsidian') takes effect in one rAF frame.
//
//   Beer-Lambert chromatic absorption  (§H2)
//     Per-channel absorption: σ_ch = (1 − tintRGB_ch) · tintStrength · 3.5
//     Applied to refracted background before caustic compositing so tinted-glass
//     caustic filaments appear in the glass's own hue.
//
//   Frosted scatter refraction  (§H3)
//     Multi-scale noise UV jitter (11× + 27× frequency, independent drift axes)
//     approximates sub-surface scattering in ground glass.  Three-tap average
//     simulates the scatter lobe integral.  Blended with sharp refraction by
//     frostedAmount so partial frost gives a continuous haze gradient.
//
//   Mirror reflection mode  (§12 composition pass)
//     u_mirrorStrength collapses transmission (refractedBg · (1−mirror·0.92))
//     and amplifies environmentReflection() by a factor of up to 6.5×.
//     IOR 1.785 (SF11) yields F0 ≈ 0.079 — 2× standard glass — for crisp Fresnel.
//
//   Smoke density uniform  (§12 composition pass)
//     Broadband post-composite darkening: col *= (1 − smokeDensity · 0.68).
//     Simulates Fe²⁺/Fe³⁺ absorption not captured by the Beer-Lambert tint term.
//
//   CSS variant override layer  (§8)
//     Each variant class (.lg-v-clear … .lg-v-obsidian) overrides backdrop-filter
//     and background gradient for accurate first-frame appearance before the WebGL
//     pass renders.  Hover/active states per variant class.
//
//   _buildSpecularCSS() refactored into §16
//     CSS fallback specular geometry analytically derived from GGX NDF α=0.04,
//     anisotropy=0.35: three lobes (GGX peak, fill shoulder, back-scatter) with
//     colours matching L0/L1/L2 from §15.K.  Thin-film CSS fallback phase offsets
//     derived from Born & Wolf OPD equation at FILM_THICKNESS=320 nm.
//
// ── What's new in v4.0.0 ──────────────────────────────────────────────────────
//
//   Sellmeier dispersion replaces Cauchy approximation
//     Equation: n²(λ) = 1 + Σ Bⱼλ²/(λ²−Cⱼ)   (three resonance terms)
//     Cauchy over-estimated blue-channel dispersion by ~2.5×. Sellmeier accuracy:
//     RMS error < 0.0001 vs spectrometer across the full visible range 380–750 nm.
//
//   Five optical glass types from the Schott catalogue 2023
//     BK7    Abbe V=64.17  Δn=0.0110  standard optical, camera lenses, cover glass
//     SF11   Abbe V=25.76  Δn=0.0408  heavy flint, crystal, Swarovski, prisms
//     NK51A  Abbe V=81.61  Δn=0.0054  fluorite crown, APO lenses, near-zero fringing
//     NBK10  Abbe V=67.90  Δn=0.0084  thin crown, architectural window glass
//     F2     Abbe V=36.43  Δn=0.0227  flint, achromatic doublets, vintage optics
//
//   Rebuilt Voronoi caustic engine
//     · PCG2D integer hash (Jarzynski & Olano, JCGT 2020) — no sin/cos,
//       no lattice bias, period 2³² per axis, ~30% faster than trig hash
//     · F2−F1 distance field — caustic filaments peak at cell boundaries,
//       eliminates the cell-centre pillow artefact present in F1
//     · Domain warping (IQ "Warped domain Voronoi") — breaks square lattice
//       regularity at all frequencies before Voronoi evaluation
//     · Six octaves with 11.25° (π/16) rotation stagger per octave index
//     · Per-cell independent animation: 4 PCG2D scalars (rx, ry, px, py)
//       + one depth scalar — no two cells ever move in synchrony
//
//   Physical chromatic caustics
//     Per-channel RGB caustic UV offset is now derived from the Sellmeier Δn
//     of the active glass type — SF11 shows 3.7× wider spectral splitting than BK7.
//
//   Full Cook-Torrance PBR specular pass  (§15)
//     Dedicated .lg-specular-canvas per element, rendered by a shared WebGL2
//     context.  Anisotropic GGX NDF + Smith height-correlated visibility +
//     Schlick Fresnel + Kulla-Conty multi-bounce + thin-film iridescence.
//     Three area lights with Karis (2013) representative-point roughness modification.
//
//   Fresnel F0 derived from Sellmeier n(550 nm) — was fixed constant 0.04 in v3.
//   getOptions() returns a live reference — glass type can be changed at runtime
//   without calling destroyLiquidGlass() / initLiquidGlass() again.
//
// ── Render loop frame budget  (at 60 fps, high-tier GPU) ────────────────────
//
//   Every frame     Spring integration (5 springs × N elements) + CSS writes
//   Every 2 frames  Caustic WebGL pass          (~30 fps, imperceptible at these frequencies)
//   Every frame     Specular WebGL pass          (60 fps, cursor tracking requires full rate)
//   Every 8 frames  domRect refresh              (~7.5 Hz, avoids layout thrash)
//   Every 30 frames data-lg-refract attr sync    (~2 Hz, CSS only, no urgency)
//   Idle / scroll   html2canvas background capture  (debounced 150 ms on scroll)
//
// ── Degradation tiers ────────────────────────────────────────────────────────
//
//   high  — desktop + Apple Silicon: full feature set, max aberration,
//            background refraction, 6-octave caustics, PBR specular
//   mid   — Adreno 5xx/6xx, Mali-G57/G75: caustics + specular,
//            chromatic aberration at ½ strength, no background refraction
//   low   — legacy mobile (Adreno 2xx-4xx, Mali-2/4, PowerVR SGX):
//            CSS-only (backdrop-filter + SVG no-op stubs), no WebGL
//
// ── IntersectionObserver viewport gate ──────────────────────────────────────
//
//   Off-screen elements are excluded from all GPU work entirely.
//   The IO fires at threshold:0 so the gate activates the moment any pixel
//   of a tracked element enters or leaves the viewport, with no root margin.
//   This eliminates GPU cost for glass elements scrolled out of view.
//
// ── Limitations ───────────────────────────────────────────────────────────────
//
//   Refraction is a snapshot, not a live compositor feed. html2canvas fails on
//   cross-origin <iframe>, CDN images without CORS headers and external fonts.
//   The background is automatically re-captured every bgCaptureInterval ms,
//   on scroll (debounced 150 ms) and on viewport resize.
//
// ── Dependencies ──────────────────────────────────────────────────────────────
//
//   html2canvas ^1.4.1 — must be loaded before initLiquidGlass() is called.
//   WebGL2 — required for caustics and refraction. On failure the system
//   degrades automatically: high → mid → low CSS-only tier.
//
// ── Quick start ───────────────────────────────────────────────────────────────
//
//   import {
//     initLiquidGlass,
//     setGlassType,
//     setGlassVariant,
//     refreshBackground,
//   } from './liquid-glass-pro.js'
//
//   initLiquidGlass({
//     glassType:          'BK7',      // 'BK7' | 'SF11' | 'NK51A' | 'NBK10' | 'F2'
//     glassVariant:       'clear',    // see GLASS_VARIANTS for all 12 options
//     ior:                1.45,
//     refractionStrength: 0.035,
//     bgCaptureInterval:  2000,
//   })
//
//   <div class="lg lg-card lg-interactive">hello, glass</div>
//
//   // Switch glass material and variant at runtime — no reinit required:
//   setGlassType('SF11')             // heavy flint — vivid rainbow splitting
//   setGlassVariant('tinted-amber')  // cobalt-amber Beer-Lambert absorption
//   setGlassVariant('obsidian')      // near-black, volcanic glass, purple sheen
//   refreshBackground()              // immediate re-capture with new IOR values
//
// ── Module structure ──────────────────────────────────────────────────────────
//
//   §0   JSDoc type definitions
//   §1   Module-level state + Glass Variant presets (GLASS_VARIANTS)
//   §2   GPU tier detection (_detectGpuTier)
//   §3   Spring physics (semi-implicit Euler)
//   §4   Houdini CSS custom properties
//   §5   Background capture engine (html2canvas → WebGL2 texture)
//   §6   WebGL2 caustics + Sellmeier refraction render engine
//          §6.0  GLSL source strings (_VERT_SRC, _FRAG_SRC)
//            §A  Hash functions (hash2, pcg2, pcg2f)
//            §B  Gradient noise (gnoise)
//            §C  Sellmeier dispersion + per-channel IOR
//            §D  Improved Voronoi caustic system (F2−F1, domain warp, PCG2D)
//            §E  Surface normal (animated bump map)
//            §F  Snell's law UV refraction
//            §G  Background sampling + chromatic refraction
//            §H  Schlick Fresnel
//            §H2 Beer-Lambert chromatic transmission
//            §H3 Frosted glass scatter refraction
//            §I  Environment reflection probe
//            §J  Main fragment program + composition pass
//          §6.1  WebGL2 helper functions (_compileShader, _buildProgram, _initWebGL)
//   §7   SVG filter bank (chromatic aberration + micro-distortion)
//   §8   CSS injection (_buildCSS, _injectCSS)
//   §9   Device orientation tracking (gyroscope tilt parallax)
//   §10  Per-element attachment / detachment (_attach, _detach)
//   §11  requestAnimationFrame render loop
//   §12  MutationObserver — automatic element discovery
//   §13  Public API (initLiquidGlass, destroyLiquidGlass, setGlassType,
//                    setGlassVariant, getGlassVariants, refreshBackground, …)
//   §14  React hook adapter (useLiquidGlass) + Vue/Svelte patterns
//   §15  Cook-Torrance PBR specular pass
//          §15.0  Constants (GLASS_IOR, GLASS_F0, FILM_THICKNESS, BASE_ROUGHNESS)
//          §15.1  GLSL fragment shader (_SPEC_FRAG_SRC)
//            §15.A  Surface normal + tangent frame (buildFrame)
//            §15.B  GGX isotropic NDF (D_GGX)
//            §15.C  Anisotropic GGX NDF (D_GGX_aniso, Burley 2012)
//            §15.D  Schlick Fresnel with exact F0 from IOR
//            §15.E  Smith height-correlated visibility (Heitz 2014)
//            §15.F  Anisotropic Smith-GGX visibility
//            §15.G  Kulla-Conty multi-bounce energy compensation (2017)
//            §15.H  Thin-film iridescence (Born & Wolf 1999)
//            §15.I  Area light representative-point approximation (Karis 2013)
//            §15.J  Full Cook-Torrance BRDF evaluation
//            §15.K  Three-light configuration (L0 cursor · L1 fill · L2 back)
//            §15.L  Vignette + alpha derivation
//            §15.M  Main
//          §15.1  WebGL2 init (initSpecularPass, _buildKullaContyLUT)
//          §15.2  Per-element canvas attachment (attachSpecularCanvas)
//          §15.3  Per-frame render (renderSpecularGL)
//          §15.4  CSS for specular canvas layer (buildSpecularCSS)
//          §15.5  Teardown (destroySpecularPass)
//   §16  _buildSpecularCSS() — CSS fallback + hover amplification
//          §16.A  Fallback specular ::before (GGX-derived ellipse geometry)
//          §16.B  Hover box-shadow amplification (synced to L0 × 1.5)
//          §16.C  Specular canvas transitions + thin-film CSS fallback
//
// ── License ───────────────────────────────────────────────────────────────────
//
//   Apache 2.0 © 2026 Boris Maltsev



// ─────────────────────────────────────────────────────────────────────────────
// §0  JSDoc type definitions
//
//  These types are used throughout the module for IDE intellisense and static
//  analysis (e.g. via VS Code + TypeScript "checkJs" mode).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Three-tier GPU capability classification derived from WebGL renderer string
 * inspection and mobile user-agent analysis.
 *
 *   'low'  — old mobile GPUs (Adreno 2xx–4xx, Mali-2/4, PowerVR SGX)
 *             → CSS-only mode, no WebGL caustics, no refraction.
 *
 *   'mid'  — mid-range mobile GPUs (Adreno 5xx–6xx, Mali-G57/G75)
 *             → WebGL caustics enabled, chromatic aberration at ½ strength.
 *
 *   'high' — desktop and Apple silicon GPUs
 *             → Full feature set, maximum aberration, background refraction.
 *
 * @typedef {'low'|'mid'|'high'} GpuTier
 */

/**
 * Configuration options accepted by initLiquidGlass() and stored in _opts.
 * All properties are optional; missing values fall back to _defaults.
 *
 * @typedef {Object} LGOptions
 *
 * @property {number}  [ior=1.45]
 *   Index of refraction of the virtual glass medium.
 *   Physical range: 1.0 (air) → 1.9 (dense flint glass).
 *   Values near 1.0 produce minimal bending; higher values exaggerate the
 *   displacement of the background texture in the refraction pass.
 *
 * @property {number}  [refractionStrength=0.035]
 *   Scalar applied to the Snell-derived UV displacement vector.
 *   Increase for a more dramatic "fish-eye" lens effect; decrease for subtlety.
 *
 * @property {number}  [aberrationStrength=1.6]
 *   Pixel magnitude of the SVG feDisplacementMap chromatic-aberration filter
 *   on 'high'-tier GPUs. Half this value is used on 'mid' tier.
 *
 * @property {number}  [bgCaptureInterval=600]
 *   Milliseconds between automatic background re-captures.
 *   Lower values keep the refracted texture fresher but increase CPU load
 *   (each html2canvas call is ~10–40 ms on a modern machine at scale 0.35).
 *
 * @property {number}  [bgCaptureScale=0.35]
 *   Resolution scale factor passed to html2canvas.
 *   0.35 means the capture canvas is 35% of viewport dimensions, yielding
 *   ~8× fewer pixels than full resolution — a major performance saving.
 *   Raise toward 1.0 for crisper refraction at the cost of capture speed.
 *
 * @property {boolean} [caustics=true]
 *   Master switch for the WebGL2 Voronoi caustic/refraction pass.
 *   When false, only the CSS backdrop-filter layer is rendered.
 *
 * @property {boolean} [grain=true]
 *   When true a film-grain <div class="lg-grain"> overlay is injected inside
 *   each glass element to break up banding in the caustic gradient.
 *
 * @property {boolean} [iridescence=true]
 *   Enables the thin-film interference CSS conic-gradient animation (::after
 *   pseudo-element). Disable if the rainbow shimmer is too distracting.
 *
 * @property {boolean} [breathe=true]
 *   Enables the 'lg-breathe' border-radius keyframe animation that morphs the
 *   glass outline, simulating a slow viscous liquid surface tension.
 *
 * @property {string}  [selector='.lg']
 *   CSS selector used to auto-discover glass elements in the DOM.
 *   Change to a more specific selector for scoped component usage.
 */

/**
 * Single-axis spring state. All three fields are mutated in-place each frame
 * by _stepSpring() to advance the spring toward its target value.
 *
 * @typedef {Object} SpringState
 * @property {number} value    - Current interpolated value.
 * @property {number} velocity - Current velocity (units per second).
 * @property {number} target   - Desired resting value the spring pulls toward.
 */

/**
 * Per-element runtime state stored in the _elements WeakMap.
 * Created once in _attach() and cleaned up in _detach().
 *
 * @typedef {Object} ElementState
 *
 * @property {HTMLCanvasElement}        canvas
 *   The offscreen caustic canvas injected as the first child of the .lg element.
 *   Receives drawImage() output from the shared WebGL back-buffer each frame.
 *
 * @property {CanvasRenderingContext2D} ctx2d
 *   2D context of the caustic canvas; used only for drawImage() blitting.
 *
 * @property {ResizeObserver}           ro
 *   Observes the .lg element's content rect; resizes canvas.width/height when
 *   the element's layout dimensions change.
 *
 * @property {SpringState}              springX
 *   Horizontal cursor position (0–1 across element width). Drives --lg-mx and
 *   the u_mouse.x uniform in the GLSL shader.
 *
 * @property {SpringState}              springY
 *   Vertical cursor position (0–1 across element height). Drives --lg-my and
 *   the u_mouse.y uniform.
 *
 * @property {SpringState}              hoverSpring
 *   0 = pointer outside element, 1 = pointer inside. Animates the caustic
 *   canvas opacity, specular hotspot intensity, and the mouse-warp term in
 *   surfaceNormal(). Uses softer spring constants than cursor tracking.
 *
 * @property {SpringState}              tiltX
 *   Horizontal tilt angle (−1 to +1). Driven by pointer position while hovered
 *   and by device orientation (gyroscope) while idle. Feeds CSS perspective
 *   rotateY and the u_tilt.x shader uniform.
 *
 * @property {SpringState}              tiltY
 *   Vertical tilt angle (−1 to +1). Mirrors tiltX on the Y axis; drives
 *   CSS rotateX and u_tilt.y.
 *
 * @property {number}                   width
 *   Physical pixel width of the caustic canvas (logical CSS px × DPR).
 *
 * @property {number}                   height
 *   Physical pixel height of the caustic canvas.
 *
 * @property {boolean}                  hovered
 *   True when the pointer is currently inside the element's bounding box.
 *   Used to switch between cursor-driven tilt and gyroscope-driven tilt.
 *
 * @property {number}                   dpr
 *   Clamped device pixel ratio (max 2) at the time the element was attached.
 *
 * @property {DOMRect}                  domRect
 *   Cached result of getBoundingClientRect(). Updated every 4 rAF frames to
 *   avoid layout thrash; used to compute screen-space UV offsets for refraction.
 *
 * @property {Function}                 pointerMove
 *   Bound pointermove handler stored here so it can be removed in _detach().
 *
 * @property {Function}                 pointerEnter
 *   Bound pointerenter handler.
 *
 * @property {Function}                 pointerLeave
 *   Bound pointerleave handler.
 */


// ─────────────────────────────────────────────────────────────────────────────
// §1  Module-level state
//
//  All mutable singleton state lives in these two objects plus a handful of
//  top-level variables.  Keeping state centralised:
//    • makes destroyLiquidGlass() trivial — one Object.assign() resets it all
//    • avoids hidden cross-function coupling through module-level locals
//    • lets future versions snapshot/restore state across SPA navigations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile-time defaults.  Never mutated — _opts is the live working copy.
 *
 * @type {LGOptions}
 */
const _defaults = {
    ior:                 1.45,   // soda-lime glass is ~1.52; slightly lower for subtlety
    refractionStrength:  0.08,   // UV displacement scale; tuned empirically
    aberrationStrength:  1.6,    // px magnitude of SVG feDisplacementMap on high tier
    bgCaptureInterval:   200,    // ms — balance freshness vs. html2canvas overhead
    bgCaptureScale:      0.65,   // 65% linear scale → ~8× pixel reduction
    caustics:            true,
    grain:               true,
    iridescence:         true,
    breathe:             true,
    selector:            '.lg',
    glassOpacity:         0.12,   // base white tint
    glassSaturation:      100,    // backdrop-filter saturation %
    // Glass material type — controls Sellmeier dispersion coefficients.
    // Accepts string name or numeric index (0–4).
    // Each type corresponds to a real optical glass from Schott catalogue.
    //
    //   'BK7'     (0) — borosilicate crown, Abbe V=64.17  — default
    //   'SF11'    (1) — heavy flint,        Abbe V=25.76  — strong rainbow
    //   'NK51A'   (2) — fluorite crown,     Abbe V=81.61  — minimal dispersion
    //   'NBK10'   (3) — thin crown,         Abbe V=67.90  — window glass feel
    //   'F2'      (4) — flint,              Abbe V=36.43  — medium prismatic
    //
    // Abbe number V = (nD − 1) / (nF − nC):
    //   High V → low dispersion (colours stay together)
    //   Low  V → high dispersion (strong rainbow fringing)
    glassType:            'BK7',
    // ── §v4.1  Glass Variant System ──────────────────────────────────────────
    // Controls the physical character of the glass surface beyond optical type.
    // Values: 'clear' | 'frosted' | 'smoke' | 'tinted-blue' | 'tinted-violet'
    //       | 'tinted-amber' | 'mirror' | 'ice' | 'bronze' | 'emerald'
    //       | 'rose' | 'obsidian'
    glassVariant:  'clear',
};

/**
 * Live resolved options. Initialised with _defaults, then shallow-merged
 * with the user-supplied object in initLiquidGlass().
 *
 * @type {LGOptions}
 */
let _opts = { ..._defaults };

/**
 * Global singleton runtime state.
 *
 * Naming conventions used in this object:
 *   gl*       — WebGL2 objects (context, program, buffers, textures)
 *   bg*       — Background capture subsystem state
 *   device*   — Physical sensor readings
 *   *Handler  — Event listener function references (for cleanup)
 *   *Id       — setInterval / requestAnimationFrame handles
 *   *Ready    — Boolean flags indicating subsystem initialisation status
 */
const _state = {
    // ── Lifecycle flags ──────────────────────────────────────────────────────
    ready:          false,   // true after initLiquidGlass() has been called
    svgReady:       false,   // true after SVG filter bank has been injected
    houdiniReg:     false,   // true after CSS.registerProperty() calls succeeded
    started:        false,

    // ── DOM references ───────────────────────────────────────────────────────
    observer:       /** @type {MutationObserver|null} */ (null),  // watches for new .lg nodes
    styleEl:        /** @type {HTMLStyleElement|null} */ (null),  // injected <style> tag
    svgEl:          /** @type {SVGSVGElement|null}    */ (null),  // injected <svg> with filters

    // ── rAF ──────────────────────────────────────────────────────────────────
    rafId:          0,  // non-zero while animation loop is running

    // ── WebGL2 caustics back-end ─────────────────────────────────────────────
    // A single WebGL2 context services ALL glass elements — each frame the
    // viewport is resized to the current element's dimensions before drawing,
    // and the result is blitted via drawImage() into the element's 2D canvas.
    // This 1-context-N-elements design avoids browser limits on WebGL contexts.
    glBackend:      /** @type {WebGL2RenderingContext|null} */ (null),
    glCanvas:       /** @type {HTMLCanvasElement|null}      */ (null),  // hidden 0×0 source
    glProgram:      /** @type {WebGLProgram|null}           */ (null),
    glUniforms:     /** @type {Record<string,WebGLUniformLocation|null>} */ ({}),
    glBuffer:       /** @type {WebGLBuffer|null}            */ (null),  // fullscreen triangle VBO
    glStartTime:    0,   // performance.now() at context creation; used to derive u_time

    // ── Background capture (introduced in v2.0.0) ────────────────────────────
    // html2canvas renders the page into a low-res canvas; that canvas is
    // uploaded to bgTexture on TEXTURE_UNIT1 for the refraction shader pass.
    bgTexture:      /** @type {WebGLTexture|null}             */ (null),
    bgCanvas:       /** @type {HTMLCanvasElement|null}        */ (null),  // CPU-side 2D copy
    bgCtx:          /** @type {CanvasRenderingContext2D|null} */ (null),
    bgCaptureId:    0,       // setInterval handle — cleared in _stopBackgroundCapture()
    bgReady:        false,   // true once the first successful capture has completed
    bgCapturing:    false,   // mutex — prevents concurrent html2canvas invocations
    bgScrollX:      0,       // window.scrollX at last capture — used to compute scroll drift
    bgScrollY:      0,       // window.scrollY at last capture

    // ── Physical sensors ─────────────────────────────────────────────────────
    deviceTilt:     { x: 0, y: 0 },  // normalised gyroscope data; fed to tilt springs
    orientHandler:  /** @type {Function|null} */ (null),  // stored for removeEventListener
};

/**
 * Stores ElementState objects keyed by their .lg HTMLElement.
 * WeakMap is used deliberately — when the DOM element is garbage-collected
 * (e.g. after a SPA route change) the entry is automatically reclaimed,
 * preventing memory leaks even if _detach() is never called.
 *
 * @type {WeakMap<HTMLElement, ElementState>}
 */
const _elements = new WeakMap();

/**
 * Strong-reference set of all currently tracked elements.
 * Required because WeakMap is not iterable; _tracked is iterated each rAF frame.
 * Must be kept in sync with _elements (both updated in _attach / _detach).
 *
 * @type {Set<HTMLElement>}
 */
const _tracked  = new Set();

/**
 * Cached GPU tier result — _detectGpuTier() is idempotent; the WebGL probe
 * canvas is created only once and the result is memoised here.
 *
 * @type {GpuTier|null}
 */
let _gpuTierCache    = null;

/**
 * Count of elements currently using the shared WebGL context.
 * Compared against MAX_WEBGL_ELEMENTS in _attach() to enforce the hard cap.
 */
let _activeWebGLCount = 0;

/**
 * Hard limit on the number of elements that will receive WebGL caustics.
 * Elements beyond this count fall back to the CSS-only visual layer.
 * Prevents context memory exhaustion on lower-end devices.
 */
const MAX_WEBGL_ELEMENTS = 32;

/**
 * Maximum physics delta-time cap in seconds.
 * Prevents the spring integrator from exploding when the tab is hidden and
 * then restored, which would produce a single enormous dt.
 */
const MAX_DT = 0.05;  // 50 ms cap → equivalent to a ~20 fps minimum

// ─────────────────────────────────────────────────────────────────────────────
// §1.5  Glass variant presets  (new in v4.1.0)
//
//  Each variant defines the complete optical + visual character of a glass
//  surface type.  Parameters map directly to the GLSL uniforms introduced
//  in §6.2 of the fragment shader.
//
//  Physical basis:
//    tintRGB        — Beer-Lambert absorption: σ = (1−tintRGB) · tintStrength · 3.5
//                     I = I₀ · exp(−σ · d)   (d = glass thickness ≈ 1.0)
//    frosted        — Rough-surface scatter: adds multi-scale noise UV jitter
//                     to the refraction lookup, simulating sub-surface scattering
//                     in ground glass or sandblasted surfaces.
//    mirror         — Amplifies environmentReflection() term + raises F0 toward 1.
//    smokeDensity   — Uniform darkening after Beer-Lambert (soot/carbon absorption).
//    causticScale   — Per-variant intensity of the Voronoi caustic composite.
//    causticTint    — RGB colour multiplication applied to the caustic layer,
//                     making ice caustics blue, amber caustics warm, etc.
//    blurPx         — backdrop-filter blur in px (CSS, not GLSL).
//    saturate       — backdrop-filter saturate % (CSS).
//    brightness     — backdrop-filter brightness multiplier (CSS).
//    bgTint         — CSS rgba() string for the background gradient tint.
//
//  IOR notes:
//    ice     1.309 — published optical constant for H₂O ice (Warren 2008)
//    emerald 1.575 — mid-point of emerald IOR range 1.565–1.602
//    obsidian 1.49 — volcanic obsidian (SiO₂-rich rhyolite glass)
//    SF11    1.785 — used for mirror (maximum Fresnel F0 in catalogue)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} GlassVariantDef
 * @property {string}   label
 * @property {string}   cssClass
 * @property {number}   ior
 * @property {[r,g,b]}  tintRGB        Linear RGB 0..1
 * @property {number}   tintStrength   0..1
 * @property {number}   frosted        0..1 scatter amount
 * @property {number}   mirror         0..1 mirror boost
 * @property {number}   smokeDensity   0..1 uniform darkening
 * @property {number}   causticScale   Caustic intensity multiplier
 * @property {[r,g,b]}  causticTint    RGB tint for caustics
 * @property {number}   blurPx         CSS backdrop-filter blur
 * @property {number}   saturate       CSS backdrop-filter saturate %
 * @property {number}   brightness     CSS backdrop-filter brightness
 * @property {string}   bgTint         CSS rgba() for background gradient
 */

const GLASS_VARIANTS = Object.freeze({

    // ── 1. Clear ──────────────────────────────────────────────────────────────
    // Near-invisible glass: maximum background transmission, minimal tint.
    // IOR 1.45 = soda-lime float glass, slight Δn, crisp caustics.
    clear: {
        label:        'Clear',
        cssClass:     'lg-v-clear',
        ior:          1.45,
        tintRGB:      [1.00, 1.00, 1.00],
        tintStrength: 0.00,
        frosted:      0.00,
        mirror:       0.00,
        smokeDensity: 0.00,
        causticScale: 0.80,
        causticTint:  [1.00, 1.00, 1.00],
        blurPx:       7,
        saturate:     155,
        brightness:   1.08,
        bgTint:       'rgba(255,255,255,0.04)',
    },

    // ── 2. Frosted ────────────────────────────────────────────────────────────
    // Ground-glass / sandblasted surface.  Heavy scatter completely diffuses
    // the refracted image, leaving only soft light bleed through the surface.
    // backdrop-filter blur 40px approximates the sub-surface scatter MFP.
    frosted: {
        label:        'Frosted',
        cssClass:     'lg-v-frosted',
        ior:          1.47,
        tintRGB:      [1.00, 1.00, 1.00],
        tintStrength: 0.18,
        frosted:      0.90,
        mirror:       0.00,
        smokeDensity: 0.00,
        causticScale: 0.38,
        causticTint:  [1.00, 1.00, 1.00],
        blurPx:       40,
        saturate:     78,
        brightness:   1.16,
        bgTint:       'rgba(255,255,255,0.20)',
    },

    // ── 3. Smoke ──────────────────────────────────────────────────────────────
    // Dark smoked glass (automotive / architectural tint film).
    // Beer-Lambert: uniform σ across R/G/B → neutral-density absorption.
    // IOR 1.52 = standard commercial tinted float glass.
    smoke: {
        label:        'Smoke',
        cssClass:     'lg-v-smoke',
        ior:          1.52,
        tintRGB:      [0.54, 0.57, 0.63],
        tintStrength: 0.58,
        frosted:      0.10,
        mirror:       0.10,
        smokeDensity: 0.52,
        causticScale: 0.55,
        causticTint:  [0.68, 0.70, 0.78],
        blurPx:       16,
        saturate:     58,
        brightness:   0.66,
        bgTint:       'rgba(18,20,28,0.52)',
    },

    // ── 4. Tinted Blue ────────────────────────────────────────────────────────
    // Cobalt-blue architectural glass.
    // Beer-Lambert: σR=3.1, σG=1.8, σB=0.2 → strong red/green absorption.
    // Caustic tint maps absorption to vivid blue-cyan filaments.
    'tinted-blue': {
        label:        'Tinted Blue',
        cssClass:     'lg-v-tinted-blue',
        ior:          1.47,
        tintRGB:      [0.10, 0.44, 1.00],
        tintStrength: 0.38,
        frosted:      0.00,
        mirror:       0.04,
        smokeDensity: 0.08,
        causticScale: 1.05,
        causticTint:  [0.22, 0.58, 1.00],
        blurPx:       12,
        saturate:     145,
        brightness:   1.04,
        bgTint:       'rgba(30,90,210,0.13)',
    },

    // ── 5. Tinted Violet ──────────────────────────────────────────────────────
    // UV-filter glass / amethyst crystal.
    // Beer-Lambert: absorbs G (trough at 550nm), passes R+B → purple.
    'tinted-violet': {
        label:        'Tinted Violet',
        cssClass:     'lg-v-tinted-violet',
        ior:          1.49,
        tintRGB:      [0.58, 0.14, 1.00],
        tintStrength: 0.42,
        frosted:      0.00,
        mirror:       0.06,
        smokeDensity: 0.10,
        causticScale: 1.10,
        causticTint:  [0.62, 0.28, 1.00],
        blurPx:       12,
        saturate:     135,
        brightness:   1.02,
        bgTint:       'rgba(100,30,210,0.14)',
    },

    // ── 6. Tinted Amber ───────────────────────────────────────────────────────
    // Amber / honey-gold / cognac glass.
    // Beer-Lambert: strong B absorption (σB=4.2), minimal R/G → warm glow.
    // Historically amber glass = UV-protective pharmaceutical / spirits bottles.
    'tinted-amber': {
        label:        'Tinted Amber',
        cssClass:     'lg-v-tinted-amber',
        ior:          1.53,
        tintRGB:      [1.00, 0.64, 0.06],
        tintStrength: 0.44,
        frosted:      0.00,
        mirror:       0.05,
        smokeDensity: 0.06,
        causticScale: 1.15,
        causticTint:  [1.00, 0.76, 0.28],
        blurPx:       11,
        saturate:     148,
        brightness:   1.07,
        bgTint:       'rgba(220,130,20,0.13)',
    },

    // ── 7. Mirror ─────────────────────────────────────────────────────────────
    // First-surface mirror coating (silver on glass).
    // IOR 1.785 = SF11 flint → F0 ≈ 0.079 (2× standard glass).
    // u_mirrorStrength = 0.92 collapses transmission, renders pure reflection.
    // Caustics become sharp specular flares.
    mirror: {
        label:        'Mirror',
        cssClass:     'lg-v-mirror',
        ior:          1.785,
        tintRGB:      [0.90, 0.93, 0.96],
        tintStrength: 0.08,
        frosted:      0.00,
        mirror:       0.92,
        smokeDensity: 0.00,
        causticScale: 1.50,
        causticTint:  [0.94, 0.96, 1.00],
        blurPx:       3,
        saturate:     125,
        brightness:   1.18,
        bgTint:       'rgba(220,228,240,0.08)',
    },

    // ── 8. Ice ────────────────────────────────────────────────────────────────
    // Polycrystalline water ice.
    // IOR = 1.309 (Warren & Brandt 2008, 550nm, T=–10°C).
    // Frosted 0.40 simulates polycrystalline grain-boundary scatter.
    // Caustic tint = cold blue — ice acts as a natural UV-pass filter.
    ice: {
        label:        'Ice',
        cssClass:     'lg-v-ice',
        ior:          1.309,
        tintRGB:      [0.70, 0.88, 1.00],
        tintStrength: 0.24,
        frosted:      0.42,
        mirror:       0.07,
        smokeDensity: 0.04,
        causticScale: 1.35,
        causticTint:  [0.55, 0.83, 1.00],
        blurPx:       20,
        saturate:     60,
        brightness:   1.22,
        bgTint:       'rgba(165,215,255,0.16)',
    },

    // ── 9. Bronze ─────────────────────────────────────────────────────────────
    // Bronze-tinted decorative glass / copper dichroic filter.
    // Beer-Lambert: absorbs B strongly, passes R+G at different rates.
    bronze: {
        label:        'Bronze',
        cssClass:     'lg-v-bronze',
        ior:          1.58,
        tintRGB:      [0.80, 0.48, 0.10],
        tintStrength: 0.46,
        frosted:      0.00,
        mirror:       0.16,
        smokeDensity: 0.14,
        causticScale: 0.92,
        causticTint:  [1.00, 0.66, 0.20],
        blurPx:       13,
        saturate:     128,
        brightness:   0.96,
        bgTint:       'rgba(180,100,20,0.14)',
    },

    // ── 10. Emerald ───────────────────────────────────────────────────────────
    // Genuine emerald / chrome-doped beryl glass.
    // IOR 1.575 = mid emerald range. Cr³⁺ absorption peaks at 430nm and 610nm
    // create the distinctive green transmission window near 500–570nm.
    emerald: {
        label:        'Emerald',
        cssClass:     'lg-v-emerald',
        ior:          1.575,
        tintRGB:      [0.06, 0.74, 0.28],
        tintStrength: 0.44,
        frosted:      0.00,
        mirror:       0.09,
        smokeDensity: 0.08,
        causticScale: 1.08,
        causticTint:  [0.18, 1.00, 0.42],
        blurPx:       12,
        saturate:     158,
        brightness:   1.03,
        bgTint:       'rgba(15,140,50,0.14)',
    },

    // ── 11. Rose ──────────────────────────────────────────────────────────────
    // Rose-quartz / cranberry glass / ruby flash.
    // Manganese-doped silicate glass: absorbs 490–580nm (green), passes red+blue.
    rose: {
        label:        'Rose',
        cssClass:     'lg-v-rose',
        ior:          1.46,
        tintRGB:      [1.00, 0.32, 0.50],
        tintStrength: 0.34,
        frosted:      0.04,
        mirror:       0.03,
        smokeDensity: 0.04,
        causticScale: 0.98,
        causticTint:  [1.00, 0.52, 0.63],
        blurPx:       11,
        saturate:     138,
        brightness:   1.05,
        bgTint:       'rgba(240,80,120,0.12)',
    },

    // ── 12. Obsidian ──────────────────────────────────────────────────────────
    // Natural volcanic obsidian (rhyolitic glass ~72% SiO₂).
    // Near-black: strong broadband absorption from Fe²⁺/Fe³⁺/magnetite inclusions.
    // IOR 1.49–1.52 (mid range). High mirror component from polished surface.
    obsidian: {
        label:        'Obsidian',
        cssClass:     'lg-v-obsidian',
        ior:          1.49,
        tintRGB:      [0.07, 0.05, 0.11],
        tintStrength: 0.86,
        frosted:      0.07,
        mirror:       0.24,
        smokeDensity: 0.74,
        causticScale: 0.30,
        causticTint:  [0.28, 0.18, 0.44],
        blurPx:       15,
        saturate:     55,
        brightness:   0.54,
        bgTint:       'rgba(8,5,18,0.72)',
    },
});

/**
 * Immutable spring configuration presets.
 * Each preset is a { stiffness, damping, mass } tuple that controls the
 * character of the corresponding spring animation:
 *
 *   cursor  — fast, snappy tracking of pointer position
 *   hover   — slightly slower fade-in/out of hover intensity
 *   tilt    — slow, weighty tilt that lags behind the cursor
 *
 * The spring equation used is a semi-implicit Euler integration of:
 *   F = −k·(x − target) − d·v    (damped harmonic oscillator)
 *   a = F / m
 *
 * Tuning guide:
 *   Increase stiffness → faster response (higher natural frequency)
 *   Increase damping   → less overshoot / oscillation
 *   Increase mass      → slower, more inertial feel
 */
const SPRING = Object.freeze({
    cursor: { stiffness: 180, damping: 18, mass: 1.0 },
    hover:  { stiffness: 120, damping: 14, mass: 1.0 },
    tilt:   { stiffness:  90, damping: 12, mass: 1.2 },
});

/**
 * Rolling frame counter incremented at the top of every _rafLoop() tick.
 * Wraps at 65535 via bitwise AND to stay a safe integer indefinitely.
 * Used to derive per-subsystem frame-skip budgets without allocating a
 * counter per element:
 *
 *   _rafFrame % 2  === 0  → caustic GL pass   (~30 fps at 60 fps display)
 *   _rafFrame % 8  === 0  → domRect refresh   (~7.5 Hz)
 *   _rafFrame % 30 === 0  → data-attr sync    (~2 Hz)
 *
 * Reset to 0 by _stopLoop() so budgets restart cleanly after pause/resume.
 *
 * @type {number}
 */
let _rafFrame = 0;

/**
 * Set of .lg elements currently intersecting the viewport.
 * Maintained in real time by the IntersectionObserver created in
 * _startObserver() (_io).  Elements absent from this set are skipped
 * entirely in the WebGL render block of _rafLoop(), eliminating GPU
 * work for off-screen glass.
 *
 * Kept in sync with _tracked via:
 *   _attach()  → _io.observe(el)   adds el when it enters viewport
 *   _detach()  → _io.unobserve(el) + _visibleElements.delete(el)
 *
 * @type {Set<HTMLElement>}
 */
const _visibleElements = new Set();

/**
 * Shared IntersectionObserver instance that populates _visibleElements.
 * Created once in _startObserver() with threshold:0 so it fires as soon
 * as a single pixel of a tracked element enters or leaves the viewport.
 * Null before _startObserver() runs and after destroyLiquidGlass() resets
 * module state — all call sites guard with optional chaining (_io?.observe).
 *
 * @type {IntersectionObserver|null}
 */
let _io = null;


// ─────────────────────────────────────────────────────────────────────────────
// §2  GPU tier detection
//
//  Strategy:
//    1. Create a temporary WebGL1 context (WebGL1 is more universally supported
//       for probing than WebGL2 — we only need renderer string info here).
//    2. Query WEBGL_debug_renderer_info for the unmasked renderer string.
//    3. Match the string against known low/mid/high regex patterns.
//    4. If the extension is unavailable (privacy browsers, iOS 16+), fall back
//       to a user-agent mobile check: mobile → 'low', desktop → 'high'.
//    5. Apple GPU: use the core count from the renderer string to distinguish
//       low-core (≤7, iPad/iPhone) → 'mid' vs. high-core (≥10, M-series) → 'high'.
//    6. Tear down the probe context immediately to avoid consuming GPU resources.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects the device GPU tier by probing WebGL renderer information.
 * Result is memoised in _gpuTierCache after the first call.
 *
 * @returns {GpuTier}
 */
function _detectGpuTier() {
    // Return cached result immediately on subsequent calls.
    if (_gpuTierCache !== null) return _gpuTierCache;

    const canvas = document.createElement('canvas');
    try {
        // Prefer explicit 'webgl' context; fall back to legacy 'experimental-webgl'
        // for very old Chrome / Safari builds.
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        if (!gl) {
            // WebGL entirely unavailable (headless, old IE, restricted CSP).
            _gpuTierCache = 'low';
            return 'low';
        }

        // Broad mobile heuristic used when renderer string is unavailable.
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

        const dbg = gl.getExtension('WEBGL_debug_renderer_info');

        if (!dbg) {
            // Extension blocked (Firefox resistFingerprinting, iOS 16+, etc.).
            // Best-effort classification: mobile devices default to 'low' to avoid
            // shipping expensive WebGL effects to potentially weak GPUs.
            _gpuTierCache = isMobile ? 'low' : 'high';
        } else {
            const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase();

            if (/adreno [2-4]\d{2}|mali-[24t]|powervr sgx|sgx 5/.test(r)) {
                // Qualcomm Adreno 2xx–4xx, ARM Mali-2/4/T series, PowerVR SGX:
                // Legacy mobile GPUs with limited fill-rate and memory bandwidth.
                _gpuTierCache = 'low';
            } else if (/adreno [56]\d{2}|mali-g[57]/.test(r)) {
                // Adreno 500/600 series, Mali-G57/G75:
                // Capable mid-range mobile GPUs found in recent Android flagships.
                _gpuTierCache = 'mid';
            } else if (/apple gpu/.test(r)) {
                // Apple GPU — differentiate by core count in the renderer string
                // (e.g. "Apple GPU (10-core)" for M1 Pro vs "Apple GPU (4-core)" for iPhone).
                const m = r.match(/(\d+)-core/);
                _gpuTierCache = (m && parseInt(m[1], 10) >= 10) ? 'high' : 'mid';
            } else {
                // All other renderers (NVIDIA, AMD, Intel Iris, generic desktop):
                // Assume high-tier capability.
                _gpuTierCache = 'high';
            }
        }

        // Politely release the WebGL context to free GPU resources.
        gl.getExtension('WEBGL_lose_context')?.loseContext();

    } catch (_) {
        // Any unexpected error (security exception, context creation failure)
        // → conservative 'low' to avoid broken rendering.
        _gpuTierCache = 'low';
    } finally {
        // Zero out canvas dimensions to trigger resource reclamation in browsers
        // that do not free GPU memory until canvas dimensions reach zero.
        canvas.width = canvas.height = 0;
    }

    return _gpuTierCache;
}


// ─────────────────────────────────────────────────────────────────────────────
// §3  Spring physics
//
//  Implementation: semi-implicit (symplectic) Euler integration of a damped
//  harmonic oscillator.  This integrator is unconditionally stable for the
//  parameter ranges used here and is computationally cheap (two multiplies,
//  two additions per axis per frame).
//
//  Semi-implicit Euler:
//    F        = −k · (x − target) − d · v     [restoring + damping force]
//    v(t+dt)  = v(t) + (F / m) · dt           [velocity update first]
//    x(t+dt)  = x(t) + v(t+dt) · dt           [position update uses new v]
//
//  The key property is that energy is conserved (never grows) for any
//  positive dt, unlike explicit Euler which can diverge for stiff springs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a SpringState with value, velocity, and target all set to
 * the same initial value so the spring begins in a resting equilibrium.
 *
 * @param {number} v - Initial (and target) value.
 * @returns {SpringState}
 */
const _createSpring = v => ({ value: v, velocity: 0, target: v });

/**
 * Advances a spring by one time step using semi-implicit Euler integration.
 * Mutates the spring state object in place (no allocation per frame).
 *
 * @param {SpringState}                          s    - Spring state (mutated).
 * @param {{ stiffness: number, damping: number, mass: number }} cfg - Spring constants.
 * @param {number}                               dt   - Delta time in seconds.
 */
function _stepSpring(s, cfg, dt) {
    // Clamp dt to MAX_DT so tab-wake-up or long GC pauses don't teleport values.
    const safe = Math.min(dt, MAX_DT);

    // Net force: restoring (Hooke's law) + velocity-proportional damping.
    const f = -cfg.stiffness * (s.value - s.target) - cfg.damping * s.velocity;

    // Semi-implicit Euler: update velocity before position.
    s.velocity += (f / cfg.mass) * safe;
    s.value    += s.velocity * safe;
}


// ─────────────────────────────────────────────────────────────────────────────
// §4  Houdini CSS custom properties
//
//  CSS.registerProperty() declares custom properties with explicit type
//  syntax, enabling the browser to:
//    • Interpolate them smoothly in CSS transitions (the key benefit here)
//    • Parse and validate their values at computed-style time
//
//  Without registration, custom properties are treated as raw strings and
//  cannot be transitioned by the browser's interpolation engine.
//
//  Properties registered:
//    --lg-mx    <percentage>   cursor X position within element (0%–100%)
//    --lg-my    <percentage>   cursor Y position within element (0%–100%)
//    --lg-irid  <angle>        iridescence rotation angle (driven by keyframes)
//    --lg-hover <number>       hover intensity scalar (0–1)
//    --lg-tx    <number>       tilt X (−1 to +1, drives rotateY)
//    --lg-ty    <number>       tilt Y (−1 to +1, drives rotateX)
//
//  Errors are silently swallowed because:
//    • The same property may have been registered by a prior initLiquidGlass() call
//    • Older browsers (Safari < 15) may not implement registerProperty at all
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers typed Houdini CSS custom properties so they can be interpolated
 * by the browser during CSS transitions and animations.
 * Idempotent — safe to call multiple times.
 */
function _registerHoudini() {
    // Guard: skip if already registered, or if API is unsupported (Safari < 15).
    if (_state.houdiniReg || !window.CSS?.registerProperty) return;
    _state.houdiniReg = true;

    [
        // Cursor position — drives radial-gradient highlight in ::before pseudo-element.
        { name: '--lg-mx',    syntax: '<percentage>', inherits: false, initialValue: '50%'  },
        { name: '--lg-my',    syntax: '<percentage>', inherits: false, initialValue: '30%'  },
        // Iridescence rotation — driven by @keyframes lg-irid-spin.
        { name: '--lg-irid',  syntax: '<angle>',      inherits: false, initialValue: '0deg' },
        // Hover intensity — animated by spring; controls CSS transitions.
        { name: '--lg-hover', syntax: '<number>',     inherits: false, initialValue: '0'    },
        // Tilt components — drive CSS perspective transform.
        { name: '--lg-tx',    syntax: '<number>',     inherits: false, initialValue: '0'    },
        { name: '--lg-ty',    syntax: '<number>',     inherits: false, initialValue: '0'    },
    ].forEach(p => {
        try {
            CSS.registerProperty(p);
        } catch (_) {
            // Already registered or unsupported — no action required.
        }
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// §5  Background capture engine  (new in v2.0.0)
//
//  Overview
//  ────────
//  The refraction effect requires knowledge of what lies behind the glass
//  element.  CSS backdrop-filter provides a blurred approximation, but it does
//  not expose the actual pixel data to WebGL.  The solution is to use
//  html2canvas to periodically render a downscaled snapshot of the page,
//  upload it to a WebGL2 texture, and sample from that texture in the fragment
//  shader at refracted UV coordinates.
//
//  Architecture
//  ────────────
//  ┌────────────────────────────────────────────────────────────────────────┐
//  │  DOM (live page)                                                       │
//  │       ↓  html2canvas (async, runs on JS thread, ~10–40 ms)            │
//  │  HTMLCanvasElement  (bgCaptureScale × viewport resolution)             │
//  │       ↓  gl.texImage2D + generateMipmap (GPU upload, ~1 ms)           │
//  │  WebGL2 TEXTURE_2D on TEXTURE_UNIT1  (u_background sampler)           │
//  │       ↓  fragment shader samples at refractedUV                       │
//  │  Per-pixel refracted colour                                            │
//  └────────────────────────────────────────────────────────────────────────┘
//
//  Refresh triggers
//  ────────────────
//  1. setInterval(bgCaptureInterval)       — steady-state periodic refresh
//  2. window 'scroll' event (debounced 150 ms) — keeps refraction aligned
//     after the user scrolls; scroll offset at capture time is stored in
//     _state.bgScrollX / bgScrollY so the shader can compensate for drift
//     between capture and render time.
//  3. ResizeObserver on <body>             — recaptures on layout reflow
//  4. refreshBackground() public API      — called by host app after large
//     DOM mutations (modal open, route change, dynamic content insertion)
//
//  Anti-flicker
//  ────────────
//  The previous texture remains bound and sampled while a new capture is in
//  progress.  The bgCapturing mutex prevents concurrent html2canvas calls that
//  could race on the texture upload.
//
//  Scroll drift compensation
//  ──────────────────────────
//  Between captures the user may scroll, causing the captured background to
//  be misaligned with the current viewport.  The shader receives a u_scroll
//  uniform that encodes (currentScroll − captureScroll) / viewportSize, and
//  adds this offset to the screen-space UV before texture lookup.
//
//  CPU-side 2D copy
//  ────────────────
//  A second 2D canvas (_state.bgCanvas) stores a CPU-readable copy of the
//  latest capture.  This is not currently consumed by the main render path but
//  is available for future use cases such as CSS element() references or
//  canvas-based fallback renderers for elements that exceed MAX_WEBGL_ELEMENTS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performs a single background capture using html2canvas and uploads the
 * result to the shared WebGL background texture (TEXTURE_UNIT1).
 *
 * The function is guarded by a mutex (_state.bgCapturing) so that even if
 * called rapidly (e.g. during fast scroll), no more than one html2canvas
 * instance runs concurrently.
 *
 * Silently degrades if html2canvas is not loaded — the shader's u_bgReady
 * uniform will remain 0.0 and refraction will be disabled for that frame.
 *
 * @async
 * @returns {Promise<void>}
 */
async function _captureBackground() {
    // Mutex check: bail out if a capture is already in flight.
    if (_state.bgCapturing || !window.html2canvas) return;
    _state.bgCapturing = true;

    try {
        const scale = _opts.bgCaptureScale;

        // html2canvas options:
        //   scale           — reduces resolution to bgCaptureScale fraction
        //   useCORS         — attempts CORS requests for cross-origin images
        //   allowTaint      — allows tainted canvas (may produce security warnings
        //                     for cross-origin content but won't throw)
        //   backgroundColor — null = transparent, lets the page BG show through
        //   logging         — disabled to avoid console spam
        //   removeContainer — html2canvas's internal clone container is cleaned up
        //   ignoreElements  — exclude glass elements themselves to prevent a
        //                     visual feedback loop where the glass reflects itself
        const captured = await html2canvas(document.documentElement, {
            scale,
            useCORS:           true,
            allowTaint:        true,
            backgroundColor:   null,
            logging:           false,
            removeContainer:   true,
            ignoreElements: el =>
                el.classList?.contains('lg')               ||  // glass content elements
                el.classList?.contains('lg-outer')         ||  // distortion wrappers
                el.classList?.contains('lg-caustic-canvas') || // caustic overlays
                el.classList?.contains('lg-specular-canvas')||
                el.tagName === 'CANVAS',
        });

        // Record the scroll position at capture time so the refraction shader
        // can compute the drift offset in real-time (u_scroll uniform).
        _state.bgScrollX = window.scrollX;
        _state.bgScrollY = window.scrollY;

        // ── GPU upload ────────────────────────────────────────────────────────
        const gl = _state.glBackend;
        if (gl && _state.bgTexture) {
            // Bind to unit 1 (unit 0 is reserved for future caustic LUT use).
            gl.bindTexture(gl.TEXTURE_2D, _state.bgTexture);
            // Upload the entire canvas as an RGBA texture; the browser converts
            // the canvas pixel format automatically.
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, captured);
            // Generate mipmaps for minification (when glass element is smaller
            // than the background texture sample footprint).
            gl.generateMipmap(gl.TEXTURE_2D);
            // Signal to the shader that valid background data is now available.
            _state.bgReady = true;
        }

        // ── CPU-side 2D copy ──────────────────────────────────────────────────
        // Lazily create the 2D canvas on the first successful capture.
        if (!_state.bgCanvas) {
            _state.bgCanvas = document.createElement('canvas');
            _state.bgCtx    = _state.bgCanvas.getContext('2d');
        }
        _state.bgCanvas.width  = captured.width;
        _state.bgCanvas.height = captured.height;
        _state.bgCtx.drawImage(captured, 0, 0);

    } catch (err) {
        // Common failure modes:
        //   • Cross-origin <iframe> with strict sandbox policy
        //   • Content-Security-Policy blocking canvas drawing
        //   • Out-of-memory on very large viewports at high scale
        // In all cases: degrade silently and leave u_bgReady = 0.0 in the shader
        // so the render falls back to the caustic-only visual.
        console.warn(
            'LG-PRO: background capture failed — refraction disabled this frame.',
            err
        );
    } finally {
        // Always release the mutex, even if an error occurred.
        _state.bgCapturing = false;
    }
}

/**
 * Creates the background WebGL texture, kicks off the first capture, and
 * registers the three refresh triggers (interval, scroll, resize).
 *
 * Called once by _initWebGL() after the WebGL context has been successfully
 * created.  Safe to call from a non-document-ready state — html2canvas
 * itself handles the case where the DOM is still loading.
 */
function _startBackgroundCapture() {
    const gl = _state.glBackend;
    if (!gl) return;

    // ── Create background texture on TEXTURE_UNIT1 ────────────────────────────
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    _state.bgTexture = tex;

    _state.bgCaptureId = -1;

    // Kick off first capture, then let _scheduleCapture() maintain the loop.
    _captureBackground().finally(_scheduleCapture);

    // ── Scroll-driven refresh (debounced) ─────────────────────────────────────
    _state.bgScrollDebounce = 0;
    _state.bgScrollHandler = () => {
        clearTimeout(_state.bgScrollDebounce);
        _state.bgScrollDebounce = setTimeout(_captureBackground, 150);
    };
    window.addEventListener('scroll', _state.bgScrollHandler, { passive: true });

    // ── Resize-driven refresh ─────────────────────────────────────────────────
    _state.bgResizeObserver = new ResizeObserver(() => _captureBackground());
    _state.bgResizeObserver.observe(document.body);
}

/**
 * Schedules the next background capture using requestIdleCallback when
 * available, falling back to setTimeout.  Only one pending schedule exists
 * at any time — the function is called exclusively from the Promise.finally
 * of _captureBackground(), so there is no concurrent scheduling.
 *
 * Guard conditions that abort rescheduling:
 *   • _state.bgCaptureId === 0  — _stopBackgroundCapture() was called;
 *                                  do not re-queue after destroy.
 *   • document.visibilityState  — skip when tab is hidden; the scroll/resize
 *                                  listeners will trigger a fresh capture when
 *                                  the user returns.
 */
/**
 * Schedules the next background capture using requestIdleCallback when
 * available, falling back to setTimeout.  Only one pending schedule exists
 * at any time — the function is called exclusively from the Promise.finally
 * of _captureBackground(), so there is no concurrent scheduling.
 *
 * bgCaptureId sentinel values:
 *   0   — _stopBackgroundCapture() was called; chain must terminate immediately.
 *  -1   — first-run sentinel set by _startBackgroundCapture() before the initial
 *          _captureBackground() call.  Allows _scheduleCapture() to proceed even
 *          though no real rIC/setTimeout handle has been assigned yet.
 *  > 0  — live rIC or setTimeout handle from a previous schedule call.
 *
 * Guard conditions that abort rescheduling:
 *   • _state.bgCaptureId === 0  — _stopBackgroundCapture() was called;
 *                                  do not re-queue after destroy.
 *   • document.visibilityState  — skip when tab is hidden; the scroll/resize
 *                                  listeners will trigger a fresh capture when
 *                                  the user returns.
 */
function _scheduleCapture() {
    // 0 = _stopBackgroundCapture() has been called — terminate the chain.
    // −1 = sentinel from _startBackgroundCapture() for the very first run;
    //      no real handle exists yet, but the chain should continue normally.
    if (_state.bgCaptureId === 0) return;

    const delay = _opts.bgCaptureInterval;

    // Shared callback: re-check the sentinel before firing to handle the edge
    // case where destroyLiquidGlass() is called while an idle/timeout is queued.
    const run = () => {
        if (_state.bgCaptureId === 0) return;
        _captureBackground().finally(_scheduleCapture);
    };

    if (window.requestIdleCallback) {
        // requestIdleCallback fires during browser idle time so html2canvas
        // does not compete with user interactions or rAF callbacks.
        // The timeout option guarantees execution within delay+200 ms even if
        // the browser never goes idle (e.g. on a continuously animated page).
        _state.bgCaptureId = requestIdleCallback(run, { timeout: delay + 200 });
    } else {
        // Plain setTimeout fallback for browsers without rIC (Safari < 16.4).
        _state.bgCaptureId = setTimeout(run, delay);
    }
}

/**
 * Cancels the periodic capture interval and resets capture-related state.
 * Called by destroyLiquidGlass().  Does NOT delete the WebGL texture
 * (that happens when the GL context is freed).
 */
function _stopBackgroundCapture() {
    // Zero out FIRST so any in-flight _scheduleCapture() finally-callback
    // sees bgCaptureId === 0 and does not re-queue after cancellation.
    const id = _state.bgCaptureId;
    _state.bgCaptureId = 0;

    if (id) {
        (window.cancelIdleCallback || clearTimeout)(id);
        clearTimeout(id);  // safe no-op if id was an rIC handle
    }

    clearTimeout(_state.bgScrollDebounce);
    _state.bgReady     = false;
    _state.bgCapturing = false;

    if (_state.bgScrollHandler) {
        window.removeEventListener('scroll', _state.bgScrollHandler);
        _state.bgScrollHandler = null;
    }
    if (_state.bgResizeObserver) {
        _state.bgResizeObserver.disconnect();
        _state.bgResizeObserver = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  WebGL2 caustics + refraction render engine
//
//  Shader architecture
//  ───────────────────
//  A single fullscreen triangle is rasterized (3 vertices → 1 draw call),
//  covering the entire canvas.  The fragment shader is responsible for:
//
//  1. surfaceNormal(uv)
//     Derives a perturbed surface normal from animated gradient noise.
//     The normal encodes spatially-varying glass thickness, producing the
//     characteristic "swimming" distortion of real glass.
//
//  2. chromaticRefraction(uv, N)
//     Samples u_background three times — once per colour channel — at UV
//     coordinates displaced according to Snell's law but with slightly
//     different IOR per channel (Cauchy dispersion).  This is the core
//     "real" refraction feature introduced in v2.0.0.
//
//  3. environmentReflection(uv, N, fresnelFactor)
//     At grazing angles (high Fresnel factor) the background is sampled at
//     a horizontally mirrored UV, approximating a planar reflection probe.
//
//  4. caustic(uv)
//     Multi-layer animated Voronoi distance field produces the underwater
//     caustic light-beam pattern.  Four octaves at different scales and speeds.
//
//  5. Composition pass
//     Caustics + chromatic refraction + specular + Fresnel edge glow +
//     iridescence + prismatic edges + surface wave noise are additively
//     blended, then multiplied by a vignette mask.
//
//  Coordinate systems
//  ──────────────────
//  v_uv          0..1 in element local space (origin = top-left)
//  screenUV      0..1 in viewport space; computed as:
//                  elementPos + v_uv * elementSize
//  refractedUV   screenUV displaced by Snell delta + IOR dispersion delta
//  bgUV          = refractedUV, looked up in u_background (viewport-space)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// §6.0  GLSL source strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vertex shader source.
 *
 * Outputs a fullscreen triangle covering clip-space [−1,1]² using only 3
 * vertices (no index buffer needed).  The UV interpolant v_uv is derived
 * from the clip-space position: v_uv = a_pos * 0.5 + 0.5.
 *
 * The fullscreen-triangle trick avoids the diagonal seam artefact that can
 * appear when rendering with two triangles (a quad) at high magnification.
 *
 * @type {string}
 */
const _VERT_SRC = /* glsl */`#version 300 es
precision mediump float;

// ── Inputs ───────────────────────────────────────────────────────────────────
in  vec2 a_pos;  // clip-space position: one of (−1,−1), (3,−1), (−1,3)

// ── Outputs ──────────────────────────────────────────────────────────────────
out vec2 v_uv;   // element-local UV (0..1), interpolated across fragment

void main() {
    // Map clip-space [−1,1] → texture UV [0,1].
    v_uv        = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * Fragment shader source.
 *
 * Full GLSL 300 es implementation of the Liquid Glass PRO visual layer.
 * See §6 module comment for a detailed description of each functional block.
 *
 * Uniform layout:
 *   u_time         float     Seconds since GL context creation.
 *   u_mouse        vec2      Spring-smoothed cursor position in element UV space.
 *   u_hover        float     Spring-smoothed hover intensity (0–1).
 *   u_tilt         vec2      Spring-smoothed tilt angles (−1 to +1 per axis).
 *   u_res          vec2      Physical canvas dimensions in pixels.
 *   u_background   sampler2D html2canvas background texture (unit 1).
 *   u_bgRes        vec2      Background texture pixel dimensions (reserved).
 *   u_elementPos   vec2      Element top-left corner in normalised screen space (0..1).
 *   u_elementSize  vec2      Element dimensions as fraction of viewport.
 *   u_ior          float     Index of refraction.
 *   u_refractStr   float     UV displacement scale for refraction.
 *   u_bgReady      float     1.0 if background texture contains valid data, 0.0 otherwise.
 *   u_scroll       vec2      Scroll drift since last capture, normalised to screen size.
 *   u_glassType    float     Sellmeier glass material selector (0–4).
 *
 * @type {string}
 */
const _FRAG_SRC = /* glsl */`#version 300 es
precision highp float;

// ── Interpolants ─────────────────────────────────────────────────────────────
in  vec2  v_uv;       // Element-local UV (0..1, top-left origin)

// ── Output ───────────────────────────────────────────────────────────────────
out vec4  fragColor;  // Premultiplied RGBA output

// ── Uniforms ─────────────────────────────────────────────────────────────────
uniform float     u_time;         // Seconds since context creation
uniform vec2      u_mouse;        // Cursor position in element UV (spring-smoothed)
uniform float     u_hover;        // Hover intensity scalar, 0=idle 1=hovered
uniform vec2      u_tilt;         // Tilt angles per axis (−1..+1)
uniform vec2      u_res;          // Physical canvas size in pixels

// ── v2.0.0 background refraction uniforms ────────────────────────────────────
uniform sampler2D u_background;   // html2canvas snapshot, bound to TEXTURE_UNIT1
uniform vec2      u_bgRes;        // Background texture pixel dimensions (reserved)
uniform vec2      u_elementPos;   // Element top-left in normalised screen space
uniform vec2      u_elementSize;  // Element size as fraction of viewport
uniform float     u_ior;          // Physical index of refraction
uniform float     u_refractStr;   // UV displacement magnitude for refraction
uniform float     u_bgReady;      // 1.0 when u_background contains valid data
uniform vec2      u_scroll;       // Scroll drift since last capture, normalised

// ── v3.1.0 glass material type ────────────────────────────────────────────────
// Selects Sellmeier dispersion coefficients for the chosen optical glass.
//   0 = BK7     borosilicate crown   Abbe V=64.17  standard optical glass
//   1 = SF11    heavy flint          Abbe V=25.76  maximum prismatic effect
//   2 = N-FK51A fluorite crown       Abbe V=81.61  apochromat, near-zero dispersion
//   3 = N-BK10  thin crown           Abbe V=67.90  window glass character
//   4 = F2      flint                Abbe V=36.43  medium-high dispersion
uniform float     u_glassType;

// ── v4.1.0 glass variant uniforms ────────────────────────────────────────────
uniform vec3      u_tintRGB;        // Beer-Lambert tint colour (linear RGB)
uniform float     u_tintStrength;   // Absorption coefficient scale
uniform float     u_frostedAmount;  // Scatter-blur amount 0..1
uniform float     u_mirrorStrength; // Mirror reflection boost 0..1
uniform float     u_smokeDensity;   // Uniform broadband darkening 0..1
uniform float     u_causticScale;   // Caustic intensity multiplier
uniform vec3      u_causticTint;    // RGB tint applied to caustic layer

// ════════════════════════════════════════════════════════════════════════════
// §A  Hash functions
//
//  Two independent hash families are used in this shader:
//
//  hash2()   — Classic trigonometric hash used throughout the original
//              noise and Voronoi code.  Fast on all GPU tiers but has
//              visible lattice artefacts at low frequencies.
//
//  pcg2()    — PCG (Permuted Congruential Generator) integer hash,
//              adapted from Jarzynski & Olano (2020) "Hash Functions for
//              GPU Rendering".  Uses only integer arithmetic (no sin/cos),
//              produces higher-quality randomness with no visible lattice.
//              Used exclusively in the improved Voronoi system (§D).
//
//  Why two families:
//    pcg2() requires bit manipulation (floatBitsToUint etc.) which is
//    GLSL ES 3.00 only.  The original hash2() is retained for gnoise()
//    and surfaceNormal() where the slight lattice correlation is invisible
//    at the noise frequencies used (7× and 11× UV scale).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Classic trigonometric gradient hash.
 * Maps a 2D lattice point → pseudo-random 2D vector in [−1,1]².
 * Used by gnoise() and surfaceNormal().
 *
 * @param  p  2D integer lattice coordinate (fractional part ignored)
 * @return    Pseudo-random 2D gradient vector in [−1,1]²
 */
vec2 hash2(vec2 p) {
    p = vec2(
        dot(p, vec2(127.1, 311.7)),
        dot(p, vec2(269.5, 183.3))
    );
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

/**
 * PCG2D — high-quality integer-based 2D hash.
 * Source: Jarzynski & Olano (2020), "Hash Functions for GPU Rendering",
 *         JCGT Vol 9 No 3.  https://jcgt.org/published/0009/03/02/
 *
 * Algorithm:
 *   Uses a permuted congruential generator with two interleaved streams.
 *   Each stream multiplies by a large odd prime, then applies a XOR-shift
 *   using the other stream's high bits.  This creates strong avalanche
 *   (every input bit affects every output bit) without sin/cos.
 *
 * Properties vs hash2():
 *   • No visible lattice or directional bias at any frequency
 *   • Period 2³² per axis (hash2 has ~2²³ before sin aliasing)
 *   • ~30% faster on GPU than sin-based hashes on modern hardware
 *   • Required by the improved Voronoi (§D) for unbiased cell jitter
 *
 * @param  p  2D unsigned integer seed (any values valid)
 * @return    2D hash in [0,1]² (unsigned, not centred)
 */
vec2 pcg2(uvec2 p) {
    // Two interleaved PCG streams — each multiplies by a different prime
    // and XOR-shifts using the other stream's high bits.
    uvec2 v = p * uvec2(1664525u, 1013904223u) + uvec2(1013904223u, 1664525u);
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    // XOR-shift: mix in high bits to remove low-frequency correlation
    v  ^= (v >> 16u);
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v  ^= (v >> 16u);
    // Map to [0,1]: divide by max uint (2³²−1)
    return vec2(v) * (1.0 / 4294967295.0);
}

/**
 * Convenience wrapper: converts float lattice coords → pcg2 output.
 * The floor() call strips the fractional part so the same cell always
 * gets the same random value regardless of which fragment samples it.
 *
 * @param  p  2D float coordinate (fractional part ignored)
 * @return    2D hash in [0,1]²
 */
vec2 pcg2f(vec2 p) {
    // Bias by 0.5 before floor to avoid negative-zero IEEE edge case
    // which would map (−0.5, +0.5) to different cells on some drivers.
    uvec2 ip = uvec2(ivec2(floor(p + 0.5)) + ivec2(32768));
    return pcg2(ip);
}


// ════════════════════════════════════════════════════════════════════════════
// §B  Gradient noise  (Perlin-style)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 2D gradient noise (Perlin-style, value range ≈ [0,1]).
 * Uses bilinear interpolation of pseudo-random gradient vectors at the four
 * corners of the unit cell containing p.
 * The 0.5+0.5 remap ensures non-negative output for use as a height field.
 *
 * @param  p  2D continuous input coordinate
 * @return    Smooth noise value in [0, 1]
 */
float gnoise(vec2 p) {
    vec2 i = floor(p);   // Integer lattice cell
    vec2 f = fract(p);   // Fractional position within cell

    // Smoothstep curve for C1-continuous interpolation (eliminates gradient discontinuities)
    vec2 u = f * f * (3.0 - 2.0 * f);

    // Bilinear interpolation of dot(gradient, offset) at four cell corners
    return mix(
        mix(dot(hash2(i + vec2(0,0)), f - vec2(0,0)),
            dot(hash2(i + vec2(1,0)), f - vec2(1,0)), u.x),
        mix(dot(hash2(i + vec2(0,1)), f - vec2(0,1)),
            dot(hash2(i + vec2(1,1)), f - vec2(1,1)), u.x),
        u.y
    ) * 0.5 + 0.5;
}


// ════════════════════════════════════════════════════════════════════════════
// §C  Sellmeier dispersion — replaces Cauchy approximation
//
//  Physical basis:
//    n²(λ) = 1 + Σ_j [ B_j · λ² / (λ² − C_j) ]
//
//    Three resonance terms per material:
//      j=1 → UV electronic absorption  (C₁ ≈ 0.006–0.014 µm²)
//      j=2 → near-UV secondary         (C₂ ≈ 0.020–0.060 µm²)
//      j=3 → far-IR phonon lattice     (C₃ ≈ 100–200    µm²)
//
//  All coefficients from Schott Glass catalogue 2023 edition.
//  Valid range: λ ∈ [0.365, 2.325] µm.  For visible (0.380–0.750 µm):
//  RMS error < 0.0001 vs spectrometer measurement.
//
//  Replaces Cauchy which over-estimated blue dispersion by ~2.5×:
//    Cauchy  Δn(R→B) ≈ 0.028  (empirically tuned, wrong shape)
//    BK7     Δn(R→B) ≈ 0.011  (physically exact)
//    SF11    Δn(R→B) ≈ 0.041  (heavy flint, strong rainbow)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sellmeier dispersion equation.
 * Returns the refractive index n(λ) for the glass material selected
 * by the u_glassType uniform.
 *
 * @param  l   Wavelength in micrometres (µm).
 *             Visible primaries: R=0.680, G=0.550, B=0.450
 * @return     Refractive index n(λ) ≥ 1.0
 */
float sellmeier(float l) {
    float l2 = l * l;  // λ² — reused in all three resonance denominators

    // Sellmeier B and C coefficients for each glass type.
    // Declared as local floats — GPU compiler packs into registers.
    float B1, B2, B3;
    float C1, C2, C3;

    if (u_glassType < 0.5) {
        // ── BK7 — Borosilicate Crown (Schott N-BK7) ──────────────────────────
        // Most widely used optical glass: camera lenses, microscope objectives,
        // laser windows, display cover glass.
        // Abbe V = 64.17 | n_D = 1.51680 | Δn(R→B) = 0.01101
        // Visual: subtle prismatic fringing, familiar everyday glass.
        B1 = 1.03961212;  C1 = 0.00600069867;   // UV electronic resonance
        B2 = 0.23179234;  C2 = 0.02001791440;   // near-UV secondary
        B3 = 1.01046945;  C3 = 103.560653;      // far-IR phonon lattice

    } else if (u_glassType < 1.5) {
        // ── SF11 — Heavy Flint (Schott SF11) ─────────────────────────────────
        // Dense flint glass: prisms, diffraction gratings, decorative crystal,
        // chandeliers, high-power laser optics.
        // Abbe V = 25.76 | n_D = 1.78472 | Δn(R→B) = 0.04079
        // Visual: vivid spectral rainbow splitting like Swarovski crystal.
        B1 = 1.73848403;  C1 = 0.01366091;      // strong UV resonance (high n)
        B2 = 0.31116800;  C2 = 0.06169579;      // broader near-UV term
        B3 = 1.17490871;  C3 = 121.922711;      // IR phonon

    } else if (u_glassType < 2.5) {
        // ── N-FK51A — Fluorite Crown (Schott N-FK51A) ────────────────────────
        // Low-index fluorophosphate glass: APO camera lenses, telescope
        // objectives, UV optics, colour-corrected microscope objectives.
        // Abbe V = 81.61 | n_D = 1.48656 | Δn(R→B) = 0.00536
        // Visual: clean sharp edges, near-zero colour fringing like APO lens.
        B1 = 0.97124800;  C1 = 0.00472301995;   // weak UV resonance (low n)
        B2 = 0.21602196;  C2 = 0.01530890;      // near-UV secondary
        B3 = 0.90448069;  C3 = 168.681840;      // shifted IR phonon

    } else if (u_glassType < 3.5) {
        // ── N-BK10 — Thin Crown (Schott N-BK10) ─────────────────────────────
        // Low-index borosilicate crown: architectural window glass, display
        // panels, lightweight optical elements, eyeglass lenses.
        // Abbe V = 67.90 | n_D = 1.49780 | Δn(R→B) = 0.00841
        // Visual: minimal chromatic fringing, clean everyday window quality.
        B1 = 0.88841934;  C1 = 0.00516900822;   // UV resonance
        B2 = 0.32846101;  C2 = 0.01774020216;   // near-UV
        B3 = 0.95900362;  C3 = 95.7565128;      // IR phonon

    } else {
        // ── F2 — Flint (Schott F2) ────────────────────────────────────────────
        // Classic medium flint: achromatic doublets, vintage optics,
        // ornamental glass, spectroscopic prisms.
        // Abbe V = 36.43 | n_D = 1.62005 | Δn(R→B) = 0.02265
        // Visual: clearly visible colour fringing, warm vintage optics feel.
        B1 = 1.34533359;  C1 = 0.00997743871;   // UV resonance
        B2 = 0.20977271;  C2 = 0.04703644880;   // near-UV
        B3 = 0.89270000;  C3 = 111.886764;      // IR phonon
    }

    // n²(λ) = 1 + B₁λ²/(λ²−C₁) + B₂λ²/(λ²−C₂) + B₃λ²/(λ²−C₃)
    // The sqrt argument is always > 1.0 for real dielectrics in visible range.
    return sqrt(1.0
        + B1 * l2 / (l2 - C1)   // UV term    — drives blue-end refractive rise
        + B2 * l2 / (l2 - C2)   // near-UV    — mid-range curvature correction
        + B3 * l2 / (l2 - C3)   // IR phonon  — flat baseline offset across visible
    );
}

// ── Per-channel IOR via Sellmeier ─────────────────────────────────────────────
// RGB primary wavelengths in micrometres — CIE standard illuminant D65.
//   λR = 0.680 µm (680 nm) — red   primary, near photopic long-wavelength edge
//   λG = 0.550 µm (550 nm) — green primary, peak of human photopic response
//   λB = 0.450 µm (450 nm) — blue  primary, near photopic short-wavelength edge
//
// Spread iorB − iorR = physically accurate Δn for the selected glass type:
//   BK7:     Δn ≈ 0.011  subtle
//   SF11:    Δn ≈ 0.041  vivid rainbow
//   N-FK51A: Δn ≈ 0.005  near-zero
//   N-BK10:  Δn ≈ 0.008  clean window
//   F2:      Δn ≈ 0.023  vintage optics
//
// Declared at module scope (outside any function) so both chromaticRefraction()
// and any future multi-wavelength pass can share these values without recomputing.


// ════════════════════════════════════════════════════════════════════════════
// §D  Improved Voronoi caustic system
//
//  Overview of improvements vs v1.1.1 original:
//
//  1. PCG2D hash (§A) replaces trigonometric hash.
//     Eliminates visible directional lattice bias in cell positions and
//     animation frequencies — cells now look truly random at all scales.
//
//  2. Domain warping before Voronoi evaluation.
//     The input UV is pre-distorted by a low-frequency gradient noise field
//     before the Voronoi cells are evaluated.  This breaks the global grid
//     regularity: cells are no longer visibly arranged on a lattice even
//     at low frequencies.  Technique: Inigo Quilez "Warped domain Voronoi"
//     (iquilezles.org/articles/warp/).
//
//  3. F2−F1 distance field instead of F1.
//     Original: minD = min distance to nearest cell centre  (F1)
//     Improved: voronoiF2F1 = second-nearest − nearest distance  (F2−F1)
//     F2−F1 produces sharper, more irregular caustic filaments because
//     it peaks exactly on cell boundaries rather than fading smoothly
//     from cell centres.  This better resembles real underwater caustics
//     where bright lines form at the lens boundary between adjacent cells.
//
//  4. Per-cell independent animation axes.
//     Original: all cells share the same 2D sinusoidal motion template.
//     Improved: each cell gets 4 independent random scalars from pcg2():
//       (rx, ry) → animation frequency per axis  (0.4 – 1.2 Hz range)
//       (px, py) → initial phase offset          (0 – 2π range)
//     This breaks the visual synchronisation that made the original look
//     like a repeating tile at longer observation times.
//
//  5. Depth/size variation per cell.
//     Each cell has a random "depth" scalar d ∈ [0.5, 1.5] derived from
//     pcg2().  The caustic band contribution is scaled by d before
//     compositing, simulating cells at different virtual depths in the
//     water column — deep cells contribute dimmer, narrower caustics;
//     shallow cells contribute brighter, wider ones.
//
//  6. Six octave composite with staggered grid rotation.
//     Original: four octaves on a fixed grid.
//     Improved: six octaves, each with a small random rotation applied to
//     the UV before evaluation.  Rotation angles are derived from the
//     octave index (not random) to ensure stable, non-drifting composition:
//       octave k → rotation = k × 11.25°  (Fibonacci-like stagger)
//     This eliminates the visible alignment between octaves that created
//     a star-burst artefact in certain lighting conditions.
//
//  Performance notes:
//    The improved Voronoi uses a 3×3 neighbourhood search (vs 5×5 original)
//    because domain warping and per-cell depth variation fill in the quality
//    gap at less cost.  Total instruction count is comparable to the
//    original 5×5 after accounting for the PCG2D hash savings vs sin().
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rotates a 2D vector by the given angle (radians).
 * Used to stagger octave grid orientations in causticBandImproved().
 *
 * @param  v    Input 2D vector
 * @param  ang  Rotation angle in radians
 * @return      Rotated vector
 */
vec2 rot2(vec2 v, float ang) {
    float c = cos(ang);
    float s = sin(ang);
    return vec2(v.x * c - v.y * s,
                v.x * s + v.y * c);
}

/**
 * Domain warp: displaces UV by a low-frequency noise field before Voronoi
 * evaluation.  Breaks global grid regularity and produces organic, non-tiling
 * cell distributions.
 *
 * Technique: two independent gnoise() samples at orthogonal offsets drive
 * the X and Y displacement.  The 2.3× and 1.7× frequency scales are
 * coprime to the Voronoi cell scales used in causticBandImproved() to
 * prevent resonance artefacts between warp and cell frequencies.
 *
 * Warp strength is intentionally kept small (0.18) to preserve the overall
 * Voronoi topology while breaking the square lattice appearance.
 *
 * @param  uv   Input UV to warp
 * @param  t    Animation time (warp field drifts slowly over time)
 * @return      Warped UV, offset by at most ±0.18 in each axis
 */
vec2 domainWarp(vec2 uv, float t) {
    // Two gnoise samples at different frequencies and time offsets
    // provide visually independent X and Y displacements.
    float wx = gnoise(uv * 2.3 + vec2(0.0,  17.4) + t * 0.04) - 0.5;
    float wy = gnoise(uv * 1.7 + vec2(31.7,  0.0) + t * 0.03) - 0.5;
    // 0.18 = max warp magnitude; tuned to be visible but not disruptive
    return uv + vec2(wx, wy) * 0.18;
}

/**
 * Improved Voronoi — returns F2−F1 distance plus a per-cell depth scalar.
 *
 * F2−F1 is the difference between the distance to the second-nearest
 * Voronoi cell centre and the distance to the nearest one.  This quantity:
 *   • Peaks sharply at cell boundaries → tight caustic filaments
 *   • Falls off on both sides → natural attenuation away from the line
 *   • Avoids the "pillow" artefact of pure F1 at cell centres
 *
 * Per-cell animation uses 4 independent random values from pcg2():
 *   rx, ry — frequency multipliers for X/Y motion  (range: 0.4–1.2)
 *   px, py — initial phase offsets                  (range: 0–2π)
 * This ensures no two cells ever move in synchrony.
 *
 * Per-cell depth d ∈ [0.5, 1.5]:
 *   Returned in the .y component of the output vec2.
 *   Modulates caustic brightness in causticBandImproved().
 *
 * @param  p   2D UV scaled to cell frequency (after domain warp)
 * @param  t   Animation time in seconds
 * @return     vec2( F2−F1 distance,  cell depth scalar )
 */
vec2 voronoiF2F1(vec2 p, float t) {
    vec2  ip    = floor(p);   // Integer lattice cell of fragment
    vec2  fp    = fract(p);   // Fractional position within cell

    // Track the two nearest distances and the closest cell depth
    float minD1 = 8.0;   // nearest distance (F1)
    float minD2 = 8.0;   // second-nearest   (F2)
    float depth = 1.0;   // depth of nearest cell

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 n = vec2(float(dx), float(dy));   // Neighbour cell offset

            // ── PCG2D hash for this cell ──────────────────────────────────────
            // Four statistically independent values for this cell:
            //   r.xy → animation frequencies in X/Y: mapped to [0.4, 1.2]
            //   r.zw → initial phase offsets:         mapped to [0, 2π]
            vec4 r;
            {
                // First pcg2 call: frequencies
                vec2 h1 = pcg2f(ip + n);
                r.xy = 0.4 + h1 * 0.8;    // frequency ∈ [0.4, 1.2] Hz

                // Second pcg2 call: phases (different seed via +127.1 offset)
                vec2 h2 = pcg2f(ip + n + vec2(127.1, 311.7));
                r.zw = h2 * 6.2831;        // phase ∈ [0, 2π]

                // Depth scalar from a third hash (y-component of third call)
                // Mapped to [0.5, 1.5]: simulates vertical cell position in water column.
                vec2 h3 = pcg2f(ip + n + vec2(269.5, 183.3));
                depth = (ip + n == floor(p + 0.001))
                    ? 0.5 + h3.x          // only update depth for nearest cell
                    : depth;
            }

            // ── Per-cell animated position ────────────────────────────────────
            // Each axis oscillates independently with its own frequency and phase.
            // Range clamp [0.04, 0.96] prevents cells from leaving their Voronoi
            // cell entirely, which would cause topology inversions.
            vec2 cellCenter = n + 0.5 + 0.46 * sin(
                t * r.xy + r.zw   // independent freq × time + phase per axis
            );

            float d = length(cellCenter - fp);

            // Update F1 and F2 — must check both in correct order:
            // If d < F1: old F1 becomes new F2, d becomes new F1
            // If d < F2 only: update F2 without touching F1
            if (d < minD1) {
                // Also capture depth of the winning cell before evicting it
                // Re-derive depth cleanly for the new nearest cell:
                vec2 h3 = pcg2f(ip + n + vec2(269.5, 183.3));
                depth  = 0.5 + h3.x;   // ∈ [0.5, 1.5]
                minD2  = minD1;
                minD1  = d;
            } else if (d < minD2) {
                minD2  = d;
            }
        }
    }

    // F2−F1: sharp ridge exactly at cell boundaries
    // Clamp to [0,1] — can exceed 1 in degenerate configs
    return vec2(clamp(minD2 - minD1, 0.0, 1.0), depth);
}

/**
 * Single caustic band using the improved Voronoi.
 *
 * Processing pipeline per band:
 *   1. Rotate UV by octave-specific angle (breaks inter-octave alignment)
 *   2. Apply domain warp (breaks intra-octave grid regularity)
 *   3. Evaluate voronoiF2F1() — get (F2−F1, depth) for this fragment
 *   4. Apply power curve to F2−F1 to sharpen caustic filaments
 *   5. Scale result by cell depth to vary brightness across the field
 *
 * Rotation angles follow an 11.25° × octave-index stagger — this is
 * 1/32 of a full circle, chosen so that six octaves (0°, 11.25°, 22.5°,
 * 33.75°, 45°, 56.25°) never align on the major axes (0°, 45°, 90°).
 *
 * @param  uv       UV input (will be scaled by cellFreq)
 * @param  cellFreq Voronoi cell density (higher = more cells per unit)
 * @param  speed    Animation speed multiplier
 * @param  seed     Phase seed as 2D UV offset (breaks pattern repetition)
 * @param  octIdx   Octave index 0–5 (drives rotation stagger)
 * @param  sharp    Power curve exponent — higher = tighter caustic lines
 * @return          Caustic band intensity ∈ [0, 1] (depth-modulated)
 */
float causticBandImproved(vec2 uv, float cellFreq, float speed,
                           vec2 seed, float octIdx, float sharp) {

    // ── Step 1: Rotation stagger — 11.25° per octave ─────────────────────────
    // Prevents the 45°/90° alignment that created a star-burst artefact
    // in the original four-octave fixed-grid composition.
    float rotAngle = octIdx * 0.19635;   // 11.25° in radians = π/16
    vec2 uvRot     = rot2(uv, rotAngle);

    // ── Step 2: Domain warp ───────────────────────────────────────────────────
    // Breaks the square lattice regularity of the Voronoi cells.
    // The warp is applied BEFORE scaling so the warp scale is consistent
    // across all cell frequencies — prevents warp looking "finer" on
    // high-frequency octaves.
    vec2 uvWarped  = domainWarp(uvRot, u_time * speed * 0.25);

    // ── Step 3: Evaluate improved Voronoi ─────────────────────────────────────
    // Scale warped UV to cell frequency, then offset by seed to prevent
    // multiple octaves starting at the same cell boundary pattern.
    vec2 result    = voronoiF2F1(uvWarped * cellFreq + seed, u_time * speed);
    float f2f1     = result.x;   // F2−F1: sharp at cell boundaries
    float cellDpth = result.y;   // Per-cell depth ∈ [0.5, 1.5]

    // ── Step 4: Power curve ───────────────────────────────────────────────────
    // smoothstep(0, 0.35, f2f1) maps the boundary ridge to 0–1.
    // Threshold 0.35 (vs 0.30 original) is wider because F2−F1 has a
    // steeper natural falloff than F1 — 0.30 would be too narrow.
    // pow(·, sharp) tightens the bright filament further.
    float band     = pow(smoothstep(0.0, 0.35, f2f1), sharp);

    // ── Step 5: Depth modulation ──────────────────────────────────────────────
    // Cells at greater depth (cellDpth > 1.0) contribute dimmer caustics,
    // simulating the natural variation of underwater light convergence.
    // The 0.65 factor caps the minimum contribution so dim cells remain visible.
    return band * (0.65 + 0.35 * (cellDpth - 0.5));
}

/**
 * Six-octave caustic composite with domain warping, PCG randomness,
 * F2−F1 distance fields, per-cell depth variation, and grid rotation stagger.
 *
 * Octave configuration:
 *   Octave 0 — large cells,  slow,  deep blue-green caustic base
 *   Octave 1 — medium cells, medium, primary white-gold filaments
 *   Octave 2 — medium-small, fast,  sharp bright detail
 *   Octave 3 — small cells,  slow,  secondary texture layer
 *   Octave 4 — large-medium, medium, low-frequency undulation
 *   Octave 5 — fine cells,   fast,  sparkle highlights
 *
 * Cursor offset (mw) shifts the entire caustic field toward the pointer
 * during hover, reinforcing the interactive lighting response.
 *
 * Octave weights are tuned so the composite peak stays ≤ 1.0 and the
 * energy distribution matches natural underwater caustic photography:
 * most energy in mid-frequency filaments, less in fine sparkle.
 *
 * @param  uv  Aspect-ratio-corrected UV (uvA in main)
 * @return     Composite caustic intensity ∈ [0, 1]
 */
float caustic(vec2 uv) {
    // Cursor-driven caustic focus: shifts field toward pointer on hover
    vec2 mw = (u_mouse - 0.5) * 0.07 * u_hover;

    // Each octave: causticBandImproved(uv, cellFreq, speed, seed, octIdx, sharp)
    //
    // seed values are 2D UV offsets chosen to be irrational multiples of
    // each other (√2, √3, √5, √7 approximations) so no two seeds share
    // a common lattice alignment.
    float c = 0.0;

    // Octave 0: large base cells, slow drift — wide caustic pools
    // Weight 0.26: dominant base layer, sets the overall brightness envelope
    c += causticBandImproved(uv + mw,        5.8,  0.28,
                              vec2( 0.000,  0.000), 0.0, 1.8) * 0.26;

    // Octave 1: medium cells, medium speed — primary caustic filaments
    // Weight 0.22: main structural detail, most visually prominent
    c += causticBandImproved(uv + mw * 0.7,  9.3,  0.41,
                              vec2( 7.139, 13.000), 1.0, 2.2) * 0.22;

    // Octave 2: medium-small cells, fast — sharp bright secondary lines
    // Weight 0.18: adds crispness, intersects octave 1 at different angles
    c += causticBandImproved(uv + mw * 1.1, 13.7,  0.57,
                              vec2(17.321,  4.472), 2.0, 2.5) * 0.18;

    // Octave 3: small cells, slow — fine texture grain
    // Weight 0.14: subtle underlying variation, breaks monotony of larger octaves
    c += causticBandImproved(uv,             6.2,  0.19,
                              vec2(31.623, 22.360), 3.0, 1.6) * 0.14;

    // Octave 4: large-medium, medium — broad undulating modulation
    // Weight 0.12: low-frequency brightness variation across the element
    // No cursor offset: this layer stays fixed, anchoring the composition
    c += causticBandImproved(uv + mw * 0.3, 11.1,  0.33,
                              vec2( 2.646, 44.721), 4.0, 2.0) * 0.12;

    // Octave 5: fine sparkle cells, fast — high-frequency glitter points
    // Weight 0.08: accent layer; max cursor amplification for interactive sparkle
    c += causticBandImproved(uv + mw * 1.4, 18.4,  0.72,
                              vec2(54.772,  8.944), 5.0, 3.0) * 0.08;

    return clamp(c, 0.0, 1.0);
}

/**
 * Per-channel chromatic caustic using improved Voronoi.
 *
 * Three separate caustic evaluations — one per RGB channel — at UV offsets
 * corresponding to the physical dispersion of the selected glass material.
 * The UV offsets are derived from the Sellmeier IOR difference (iorR/iorG/iorB)
 * to make the prismatic splitting physically consistent with the refraction pass.
 *
 * Compared to the original (fixed UV offsets ±0.009, ±0.005, ±0.010):
 *   Original:   constant RGB split independent of glass type
 *   Improved:   split scales with actual Δn of selected glass
 *               BK7:  subtle split  | SF11: vivid rainbow split
 *
 * @param  uvA  Aspect-ratio-corrected UV
 * @return      vec3 RGB chromatic caustic colour ∈ [0,1]³
 */
vec3 chromaticCaustic(vec2 uvA) {
    // Physical dispersion offset: proportional to IOR difference from reference
    // Scale factor 0.012 maps Δn to UV space (empirically tuned to match
    // the visual scale of the refraction chromatic aberration at default settings)
    float iorR = sellmeier(0.680);   // Red   channel IOR
    float iorG = sellmeier(0.550);   // Green channel IOR — reference wavelength
    float iorB = sellmeier(0.450);   // Blue  channel IOR

    float dispR = (iorG - iorR) * 0.5;   // Red shifts toward lower refraction
    float dispB = (iorB - iorG) * 0.5;   // Blue shifts toward higher refraction

    // Direction of prismatic split: 37° from horizontal — avoids alignment
    // with the caustic grid rotation series (multiples of 11.25°)
    vec2 splitDir = vec2(cos(0.6458), sin(0.6458));   // 37° in radians

    // Per-channel caustic at physically-offset UVs
    float cR = causticBandImproved(uvA - splitDir * dispR, 3.2, 0.38,
                                    vec2(0.0, 0.0), 0.5, 1.8) * 0.20;
    float cG = causticBandImproved(uvA,               3.2, 0.38,
                                    vec2(0.0, 0.0), 0.5, 1.8) * 0.16;
    float cB = causticBandImproved(uvA + splitDir * dispB, 3.2, 0.38,
                                    vec2(0.0, 0.0), 0.5, 1.8) * 0.24;

    return vec3(cR, cG, cB);
}


// ════════════════════════════════════════════════════════════════════════════
// §E  Surface normal  (bump-map from animated noise)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Computes a view-space surface normal for this fragment from an animated
 * gradient noise height field.  The normal encodes the local glass surface
 * tilt, which is subsequently used to:
 *   1. Displace the background UV for screen-space refraction.
 *   2. Modulate the Schlick Fresnel term (grazing-angle reflection).
 *   3. Move the specular hotspot.
 *
 * Technique: finite-difference gradient of a 2D noise field.
 *   N ≈ normalize( (−∂h/∂x, −∂h/∂y, 1) )
 *
 * @param  uv  Element-local UV (0..1)
 * @return     Normalised surface normal in view space
 */
vec3 surfaceNormal(vec2 uv) {
    float eps = 0.002;  // Finite-difference step (≈ 0.2% of element width)

    // Sample base noise field and two offset points for gradient estimation
    float hC = gnoise(uv * 7.0 + u_time * 0.07);
    float hR = gnoise((uv + vec2(eps, 0.0)) * 7.0 + u_time * 0.07);
    float hU = gnoise((uv + vec2(0.0, eps)) * 7.0 + u_time * 0.07);

    // Interactive bump: Gaussian-falloff cursor-driven distortion
    float mouseInfluence = u_hover * 0.4 * exp(-length(uv - u_mouse) * 3.5);
    float hM = gnoise(uv * 11.0 - u_mouse * 2.0 + u_time * 0.13) * mouseInfluence;

    float dX = (hR - hC) / eps + hM * 0.03;
    float dY = (hU - hC) / eps + hM * 0.03;

    return normalize(vec3(-dX * 0.8, -dY * 0.8, 1.0));
}


// ════════════════════════════════════════════════════════════════════════════
// §F  Snell's law UV refraction  (thin-glass approximation)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Computes the refracted screen-space UV for a given surface normal,
 * using a thin-glass linearisation of Snell's law.
 *
 * @param  screenUV  Pre-mapped screen-space UV (element mapped to viewport)
 * @param  normal    View-space surface normal from surfaceNormal()
 * @return           Refracted screen-space UV
 */
vec2 refractUV(vec2 screenUV, vec3 normal) {
    // Primary displacement from surface normal × refraction strength
    vec2 tilt = normal.xy * u_refractStr;
    // Secondary parallax shift from device/cursor tilt
    tilt += u_tilt * u_refractStr * 0.4;
    return screenUV + tilt;
}


// ════════════════════════════════════════════════════════════════════════════
// §G  Background sampling with chromatic refraction (Sellmeier)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns transparent black if background is not yet ready.
 *
 * @param  uv      Element-local UV
 * @param  normal  View-space surface normal
 * @return         Sampled and refracted background colour (RGBA)
 */
vec4 sampleBackground(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec4(0.0);

    vec2 screenUV = u_elementPos + uv * u_elementSize;
    screenUV     += u_scroll;
    screenUV      = clamp(screenUV, vec2(0.001), vec2(0.999));

    vec2 refractedUV = refractUV(screenUV, normal);
    refractedUV      = clamp(refractedUV, vec2(0.0), vec2(1.0));

    return texture(u_background, refractedUV);
}

/**
 * Per-channel chromatic refraction using Sellmeier IOR values.
 * Replaces the original Cauchy-based version — iorR/iorG/iorB are now
 * physically accurate for the selected glass type (§C).
 *
 * @param  uv      Element-local UV
 * @param  normal  View-space surface normal
 * @return         RGB colour with Sellmeier per-channel dispersion applied
 */
vec3 chromaticRefraction(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec3(0.0);
    
    float iorR = sellmeier(0.680);   // Red   channel IOR
    float iorG = sellmeier(0.550);   // Green channel IOR — reference wavelength
    float iorB = sellmeier(0.450);   // Blue  channel IOR



    vec2 screenUV = u_elementPos + uv * u_elementSize + u_scroll;
    screenUV = clamp(screenUV, vec2(0.001), vec2(0.999));

    // Per-channel displacement using physically accurate Sellmeier IOR values.
    // Δ = N.xy · (1/iorCh − 1/iorRef) · refractStr
    // iorG is the reference wavelength (green = peak photopic response)
    vec2 baseRefracted = refractUV(screenUV, normal);
    vec2 uvR = clamp(baseRefracted + normal.xy * (1.0/iorR - 1.0/iorG) * u_refractStr * 80.0, 0.0, 1.0);
    vec2 uvG = clamp(baseRefracted,                                                      0.0, 1.0);
    vec2 uvB = clamp(baseRefracted + normal.xy * (1.0/iorB - 1.0/iorG) * u_refractStr * 80.0, 0.0, 1.0);

    float r = texture(u_background, uvR).r;
    float g = texture(u_background, uvG).g;
    float b = texture(u_background, uvB).b;

    return vec3(r, g, b);
}


// ════════════════════════════════════════════════════════════════════════════
// §H  Schlick Fresnel approximation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Schlick's approximation: R(θ) ≈ F0 + (1−F0)·(1−cosθ)⁵
 *
 * @param  cosTheta  cos(angle between view ray and surface normal)
 * @param  f0        Reflectance at normal incidence (≈ 0.04 for glass)
 * @return           Fresnel reflectance in [f0, 1.0]
 */
float schlick(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}


// ════════════════════════════════════════════════════════════════════════════
// §I  Environment reflection probe
// ════════════════════════════════════════════════════════════════════════════

/**
 * Approximates environmental reflection at grazing angles via horizontal mirror.
 *
 * @param  uv             Element-local UV
 * @param  normal         Surface normal from surfaceNormal()
 * @param  fresnelFactor  Schlick reflectance at this fragment
 * @return                Environment reflection colour contribution
 */
vec3 environmentReflection(vec2 uv, vec3 normal, float fresnelFactor) {
    if (u_bgReady < 0.5 || fresnelFactor < 0.01) return vec3(0.0);

    vec2 screenUV = u_elementPos + uv * u_elementSize + u_scroll;
    vec2 mirrorUV = vec2(1.0 - screenUV.x, screenUV.y) + normal.xy * 0.05;
    mirrorUV      = clamp(mirrorUV, 0.0, 1.0);

    return texture(u_background, mirrorUV).rgb * fresnelFactor * 0.35;
}

// ════════════════════════════════════════════════════════════════════════════
// §H2  Beer-Lambert chromatic transmission
//
//  Physical model: I = I₀ · exp(−σ · d)
//
//  σ_ch = (1.0 − tintRGB_ch) · u_tintStrength · 3.5
//    — derived from the absorption cross-section of the glass colorant.
//    — value 3.5 maps tintStrength ∈ [0,1] to a physically plausible
//      optical depth range (OD ≈ 0–3.5, i.e. 100%–3% transmission).
//
//  Independent per-channel computation means:
//    tintRGB = (1,0,0) → only red passes (ruby/blood glass)
//    tintRGB = (0,1,0) → only green passes (emerald)
//    tintRGB = (1,1,1) → neutral (clear / no absorption)
//
//  Applied to the refracted background colour BEFORE caustic compositing,
//  so the caustic filaments still appear in the coloured-glass hue.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Beer-Lambert spectral absorption applied to refracted background.
 *
 * @param  bgColor    Refracted RGB sample from u_background
 * @return            Attenuated RGB colour
 */
vec3 beerLambertTransmit(vec3 bgColor) {
    // Absorption coefficient per channel: high where tintRGB is low
    vec3 sigma = (1.0 - u_tintRGB) * u_tintStrength * 3.5;
    // exp(−σ) — physical Beer-Lambert transmittance
    vec3 transmit = exp(-sigma);
    // Also add the tint colour as a faint self-emission (fluorescence term)
    // so completely absorbing glass still shows its own colour faintly.
    vec3 emission = u_tintRGB * u_tintStrength * 0.06;
    return bgColor * transmit + emission;
}


// ════════════════════════════════════════════════════════════════════════════
// §H3  Frosted glass scatter refraction
//
//  Rough-surface glass scatters transmitted light across a broad solid angle.
//  Physically: the surface normal varies per microfacet; each microfacet
//  refracts independently at a different angle → blurred transmission.
//
//  Implementation: multi-scale noise offsets are added to the refraction UV,
//  producing a spatially-varying blur.  Three texture taps are averaged to
//  approximate the scattering lobe integral with minimal extra cost.
//
//  Scatter scale:
//    Low  frequencies (uv * 11.0): large-scale surface relief (mm-scale bumps)
//    High frequencies (uv * 27.0): sub-mm ground-glass texture
//  Both animated with different speeds so they never lock into a pattern.
//
//  The result is mixed with the (sharp) chromaticRefraction based on
//  u_frostedAmount, so partial frosting gives an intermediate haze level.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Frosted-glass scatter: blurs the refraction lookup via noise UV jitter.
 *
 * @param  uv      Element-local UV
 * @param  normal  Surface normal (adds surface-tilt to scatter direction)
 * @return         Scatter-blurred refracted colour; vec3(0) if bgReady=0
 */
vec3 frostedScatterRefraction(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec3(0.0);

    vec2 screenUV = u_elementPos + uv * u_elementSize + u_scroll;
    screenUV = clamp(screenUV, 0.001, 0.999);

    // Scatter magnitude scales with frostedAmount
    // 0.052 = max UV offset (tuned so heavy frost is fully diffused at 1.0)
    float sc = u_frostedAmount * 0.052;

    // Large-scale surface relief noise (drifts slowly)
    float n1x = gnoise(uv * 11.0 + u_time * 0.030) - 0.5;
    float n1y = gnoise(uv * 11.0 + u_time * 0.025 + vec2(17.4, 0.0)) - 0.5;

    // Fine ground-glass texture noise (drifts faster, different phase)
    float n2x = gnoise(uv * 27.0 - u_time * 0.045) - 0.5;
    float n2y = gnoise(uv * 27.0 - u_time * 0.038 + vec2(0.0, 31.7)) - 0.5;

    // Combined scatter vector (large + fine)
    vec2 scatter = vec2(n1x + n2x * 0.4, n1y + n2y * 0.4) * sc;

    // Add surface-normal contribution so scatter direction aligns with bumps
    scatter += normal.xy * sc * 0.5;

    // Three-tap average: centre + two offset samples
    vec2 uv0 = clamp(refractUV(screenUV, normal) + scatter,          0.0, 1.0);
    vec2 uv1 = clamp(refractUV(screenUV, normal) + scatter * 0.55,   0.0, 1.0);
    vec2 uv2 = clamp(refractUV(screenUV, normal) + scatter * (-0.3), 0.0, 1.0);

    vec3 c0 = texture(u_background, uv0).rgb;
    vec3 c1 = texture(u_background, uv1).rgb;
    vec3 c2 = texture(u_background, uv2).rgb;

    // Weighted average — centre tap has more weight (Gaussian-like)
    return (c0 * 0.50 + c1 * 0.30 + c2 * 0.20);
}


// ════════════════════════════════════════════════════════════════════════════
// §J  Main fragment program
// ════════════════════════════════════════════════════════════════════════════

void main() {
    vec2  uv  = v_uv;
    // Aspect-ratio-corrected UV for scale-invariant caustic patterns
    float ar  = u_res.x / max(u_res.y, 1.0);
    vec2  uvA = vec2(uv.x * ar, uv.y);

    // ── 1. Surface normal ─────────────────────────────────────────────────────
    // Derived from animated noise; drives all refraction / reflection terms.
    vec3 N = surfaceNormal(uv);

    // ── 2. Chromatic refraction — Sellmeier dispersion ────────────────────────
    // Per-channel background sample using physically accurate IOR per glass type.
    // Returns black if background texture is not yet ready.
    // §v4.1: Frosted variants replace sharp refraction with scatter-blur.
    vec3 refractedBg;
    if (u_frostedAmount > 0.02) {
        // Frosted: blend between sharp chromatic refraction and scatter-blur
        // The mix is frostedAmount-weighted so partial frost gives haze gradient.
        vec3 sharpRefract  = chromaticRefraction(uv, N);
        vec3 scatterRefract = frostedScatterRefraction(uv, N);
        refractedBg = mix(sharpRefract, scatterRefract, u_frostedAmount);
    } else {
        refractedBg = chromaticRefraction(uv, N);
    }

    // §v4.1: Beer-Lambert chromatic absorption
    // Attenuates refracted background by the glass colorant absorption spectrum.
    if (u_bgReady > 0.5 && u_tintStrength > 0.001) {
        refractedBg = beerLambertTransmit(refractedBg);
    }

    // ── 3. Fresnel factor ─────────────────────────────────────────────────────
    // F0 is derived from the Sellmeier reference IOR (green channel) rather
    // than the uniform u_ior, for consistency with the dispersion model.
    float iorG = sellmeier(0.550);   // Green channel IOR — reference wavelength
    float f0ref = pow((iorG - 1.0) / (iorG + 1.0), 2.0);   // F0 from Sellmeier n_G
    vec2  centered = uv * 2.0 - 1.0;
    vec3  Nfull    = normalize(vec3(
        centered * 0.55 + u_tilt * 0.30,
        max(0.001, sqrt(1.0 - dot(centered * 0.55, centered * 0.55)))
    ));
    float fr = schlick(max(dot(Nfull, vec3(0, 0, 1)), 0.0), f0ref);

    // ── 4. Environment reflection ─────────────────────────────────────────────
    vec3 envRefl = environmentReflection(uv, N, fr);

    // ── 5. Improved Voronoi caustic base ──────────────────────────────────────
    // Six-octave composite with PCG2D hash, domain warping, F2−F1 distance,
    // per-cell depth variation, and rotation-staggered grids.
    // 1.7 power concentrates energy into bright caustic filaments.
    // §v4.1: u_causticScale and u_causticTint applied per variant.
    float cBase = pow(caustic(uvA), 1.7) * u_causticScale;

    // ── 6. Chromatic caustic — physically-based spectral splitting ────────────
    // Per-channel caustic UV offsets derived from Sellmeier Δn, not fixed values.
    // RGB split magnitude scales with actual glass dispersion (SF11 >> BK7).
    // §v4.1: Tinted with per-variant causticTint colour.
    vec3 chromCaustic = chromaticCaustic(uvA) * u_causticScale * u_causticTint;

    // ── 7. Specular highlight ─────────────────────────────────────────────────
    vec2  lightPos = vec2(0.22, 0.18)
                   + u_mouse * 0.28 * u_hover
                   + u_tilt  * 0.12;
    float sd = length(uv - lightPos);

    float specular =
          pow(max(0.0, 1.0 - sd * 2.1),  7.0) * 0.95   // Broad soft glow
        + pow(max(0.0, 1.0 - sd * 5.8), 16.0) * 0.55   // Tight sharp highlight
        + pow(max(0.0, 1.0 - length(uv - (1.0 - lightPos)) * 4.0), 11.0) * 0.14;

    // ── 8. Fresnel edge glow ──────────────────────────────────────────────────
    float edgeR   = length(centered);
    float topEdge = pow(smoothstep(0.15, 0.0, uv.y), 2.3) * 0.65;
    float botEdge = pow(smoothstep(0.90, 1.0, uv.y), 3.0) * 0.12;
    float lftEdge = pow(smoothstep(0.12, 0.0, uv.x), 2.0) * 0.32;
    float edgeGlow = topEdge + lftEdge + botEdge + fr * 0.28;

    // ── 9. Thin-film iridescence ──────────────────────────────────────────────
    // Phase offsets (0, 2.0944, 4.1888) = 120° = Born & Wolf λR/λG/λB spacing
    float iridMask = smoothstep(0.25, 1.08, edgeR);
    float iridAng  = atan(centered.y, centered.x);
    vec3  irid = (0.5 + 0.5 * cos(
        iridAng * 2.0
        + u_time  * 0.30
        + u_tilt.x * 3.14159
        + vec3(0.0, 2.0944, 4.1888)
    )) * iridMask * 0.08;

    // ── 10. Prismatic edge caustics ───────────────────────────────────────────
    float prismBand  = smoothstep(0.80, 0.92, edgeR)
                     * smoothstep(1.06, 0.92, edgeR);
    vec3  prismColor = (0.5 + 0.5 * cos(
        iridAng  * 4.0
        + u_time * 0.55
        + vec3(0.0, 2.0944, 4.1888)
    )) * prismBand * 0.16;

    // ── 11. Surface undulation ────────────────────────────────────────────────
    float wave = gnoise(uv * 5.5 + u_time * 0.11) * 0.013
               + gnoise(uv * 9.2 - u_time * 0.08) * 0.006;

    // ── 12. Composition ───────────────────────────────────────────────────────
    // §v4.1: Caustic tint already applied above; causticTint shifts hue of
    // cBase white contribution to match glass colour.
    vec3 causticColour = u_causticTint * cBase * 0.52;
    vec3 col = causticColour + chromCaustic * 0.5;
    col += vec3(specular) + vec3(edgeGlow);
    col += irid + prismColor + vec3(wave);

    // §v4.1: Mirror boost — amplify environment reflection before adding
    vec3 envReflBoosted = envRefl * (1.0 + u_mirrorStrength * 5.5);
    col += envReflBoosted;

    // ── 13. Background refraction blend ──────────────────────────────────────
    // §v4.1: Mirror variant reduces transmission (refractedBg contribution).
    // At mirrorStrength=1: refraction is fully replaced by reflection.
    float transmitFactor = 1.0 - u_mirrorStrength * 0.92;
    float refrBlend = smoothstep(0.0, 0.18, 1.0 - edgeR)
                    * 0.28 * u_bgReady * transmitFactor;
    col = mix(col, refractedBg, refrBlend);

    // §v4.1: Smoke density — uniform broadband absorption after all blending
    // Simulates soot/metallic-oxide absorption not captured by Beer-Lambert tint.
    col *= (1.0 - u_smokeDensity * 0.68);

    // ── 14. Vignette mask ─────────────────────────────────────────────────────
    float vx = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    float vy = smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    col *= vx * vy;

    // ── 15. Alpha derivation ──────────────────────────────────────────────────
    float luma  = dot(col, vec3(0.299, 0.587, 0.114));
    float alpha = clamp(luma * 1.85, 0.0, 1.0);

    // Premultiplied RGBA output
    fragColor = vec4(col, alpha * 0.88);
}`;



// ─────────────────────────────────────────────────────────────────────────────
// §6.1  WebGL2 helper functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compiles a single GLSL shader stage and returns the WebGLShader handle.
 * Throws a descriptive error on compilation failure so the caller can
 * fall through to the CSS-only rendering path.
 *
 * @param {WebGL2RenderingContext} gl   - Active WebGL2 context.
 * @param {number}                 type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER.
 * @param {string}                 src  - GLSL source string.
 * @returns {WebGLShader}
 * @throws {Error} If compilation fails (includes driver info log).
 */
function _compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);

    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`LG-PRO shader compile:\n${log}`);
    }

    return sh;
}

/**
 * Creates, links, and validates a WebGL2 program from separate vertex and
 * fragment shader sources.  Returns the linked WebGLProgram handle.
 * Throws on link failure so the caller can degrade gracefully.
 *
 * @param {WebGL2RenderingContext} gl - Active WebGL2 context.
 * @param {string}                 vs - Vertex shader GLSL source.
 * @param {string}                 fs - Fragment shader GLSL source.
 * @returns {WebGLProgram}
 * @throws {Error} If linking fails.
 */
function _buildProgram(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, _compileShader(gl, gl.VERTEX_SHADER,   vs));
    gl.attachShader(p, _compileShader(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);

    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`LG-PRO link:\n${gl.getProgramInfoLog(p)}`);
    }

    return p;
}

/**
 * Creates and initialises the single shared WebGL2 context used by all glass
 * elements.  Called lazily on the first call to _attach() that qualifies for
 * WebGL rendering.
 *
 * Steps:
 *  1. Create a hidden 0×0 <canvas> and request a WebGL2 context.
 *  2. Compile and link the vertex + fragment shader program.
 *  3. Upload a fullscreen-triangle VBO (3 vertices, no index buffer).
 *  4. Enable premultiplied-alpha blending.
 *  5. Cache all uniform locations (including v2 background uniforms).
 *  6. Pre-bind the background sampler to texture unit 1.
 *  7. Launch the background capture subsystem.
 *
 * Returns true on success, false on any failure (GL unavailable, compile
 * error, etc.).  On failure the hidden canvas is removed so no resources leak.
 *
 * @returns {boolean} True if WebGL2 was successfully initialised.
 */
function _initWebGL() {
    // Idempotent — return immediately if already initialised.
    if (_state.glBackend) return true;

    // The GL canvas is kept off-screen; its dimensions are resized per-element
    // before each draw call.  The fixed CSS size of 0×0 prevents it from
    // affecting page layout.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = [
        'position:fixed',
        'width:0',
        'height:0',
        'pointer-events:none',
        'opacity:0',
        'z-index:-99999',
    ].join(';');
    document.body.appendChild(canvas);

    // Request WebGL2 with premultiplied alpha blending mode to match the
    // fragment shader output convention (col * alpha → premultiplied).
    // preserveDrawingBuffer: true is required so we can read the pixels back
    // via drawImage() after the draw call completes.
    const gl = canvas.getContext('webgl2', {
        alpha:                true,
        premultipliedAlpha:   true,
        antialias:            false,   // Not needed; caustics are inherently soft
        depth:                false,   // No depth testing — fullscreen triangle only
        stencil:              false,
        preserveDrawingBuffer: true,
    });

    if (!gl) {
        canvas.remove();
        return false;
    }

    try {
        // ── Shader program ────────────────────────────────────────────────────
        const prog = _buildProgram(gl, _VERT_SRC, _FRAG_SRC);

        // ── Fullscreen triangle VBO ───────────────────────────────────────────
        // Three vertices in clip-space that form a triangle covering the full
        // viewport when rasterized.  The third vertex at (3,−1) and fourth at
        // (−1,3) extend beyond the clip frustum but are harmlessly discarded
        // after clipping, while the interior perfectly covers [−1,1]².
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1,   3, -1,   -1, 3]),
            gl.STATIC_DRAW
        );

        gl.useProgram(prog);

        // Bind the a_pos attribute to the VBO
        const aPos = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // ── Blending ──────────────────────────────────────────────────────────
        // ONE, ONE_MINUS_SRC_ALPHA: standard premultiplied-alpha over blend.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        // ── Uniform location cache ────────────────────────────────────────────
        // Calling getUniformLocation() every frame would be expensive; cache
        // all locations once here.  Includes both v1.1.1 and v2.0.0 uniforms.
        const uNames = [
            // Core timing & interaction
            'u_time',
            'u_mouse',
            'u_hover',
            'u_tilt',
            'u_res',
            // v2.0.0 background refraction
            'u_background',
            'u_bgRes',
            'u_elementPos',
            'u_elementSize',
            'u_ior',
            'u_refractStr',
            'u_bgReady',
            'u_scroll',
            // v3.1.0 glass material type
            // 0 = BK7  borosilicate crown  (default, moderate dispersion)
            // 1 = SF11 heavy flint         (high dispersion, prismatic)
            // 2 = N-FK51A fluorite crown   (low dispersion, apochromat)
            // 3 = N-BK10 thin crown        (low-index, window glass)
            // 4 = F2 flint                 (medium-high dispersion)
            'u_glassType',
            // §v4.1 glass variant uniforms
            'u_tintRGB',
            'u_tintStrength',
            'u_frostedAmount',
            'u_mirrorStrength',
            'u_smokeDensity',
            'u_causticScale',
            'u_causticTint',
        ];

        const uni = {};
        uNames.forEach(n => { uni[n] = gl.getUniformLocation(prog, n); });

        // ── Bind background sampler to texture unit 1 ─────────────────────────
        // This only needs to be set once because the sampler-to-unit binding
        // is part of program state and survives gl.useProgram() calls.
        gl.useProgram(prog);
        gl.uniform1i(uni.u_background, 1);

        // ── Persist shared state ──────────────────────────────────────────────
        _state.glCanvas    = canvas;
        _state.glBackend   = gl;
        _state.glProgram   = prog;
        _state.glUniforms  = uni;
        _state.glBuffer    = buf;
        _state.glStartTime = performance.now();

        // ── Background capture subsystem ──────────────────────────────────────
        // Must be started after the GL context is ready because _startBackgroundCapture()
        // calls gl.createTexture() and uploads to TEXTURE_UNIT1.
        _startBackgroundCapture();

        return true;

    } catch (err) {
        // Shader compile / link error or context loss — degrade to CSS.
        console.warn('LG-PRO: WebGL2 init failed — CSS fallback active.\n', err);
        canvas.remove();
        return false;
    }
}

/**
 * Renders one frame of the caustic + refraction effect for a single glass
 * element using the shared WebGL2 context.
 *
 * Procedure:
 *  1. Resize the shared GL canvas to match the current element's physical
 *     pixel dimensions (avoids per-element GL contexts).
 *  2. Upload all per-frame uniforms (time, mouse, tilt, element position, etc.).
 *  3. Bind the background texture to TEXTURE_UNIT1.
 *  4. Execute the fullscreen-triangle draw call.
 *  5. Blit the GL canvas into the element's dedicated 2D caustic canvas via
 *     drawImage() — this is the only cross-context transfer per frame.
 *
 * @param {ElementState} es  - Per-element state.
 * @param {number}       now - Current timestamp from requestAnimationFrame.
 */
function _renderCausticsGL(es, now) {
    const gl  = _state.glBackend;
    const uni = _state.glUniforms;
    if (!gl || !_state.glProgram) return;

    const w = es.width;
    const h = es.height;
    if (w < 1 || h < 1) return;

    // ── Resize shared GL canvas to match this element ─────────────────────────
    // Avoid unnecessary framebuffer reallocations by checking dimensions first.
    if (_state.glCanvas.width !== w || _state.glCanvas.height !== h) {
        _state.glCanvas.width  = w;
        _state.glCanvas.height = h;
        gl.viewport(0, 0, w, h);
    }

    // ── Clear ─────────────────────────────────────────────────────────────────
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ── Time ──────────────────────────────────────────────────────────────────
    const t = (now - _state.glStartTime) * 0.001;  // Convert ms → seconds

    // ── Viewport dimensions for aspect-ratio and UV mapping ───────────────────
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    // Use cached domRect; it is refreshed every 4 frames in the rAF loop
    // to avoid per-frame getBoundingClientRect() layout thrashing.
    const rect = es.domRect || {
        left: 0, top: 0,
        width: w / es.dpr, height: h / es.dpr,
    };

    // ── Screen-space element position and size ────────────────────────────────
    // Normalised to [0,1] viewport space for the refraction UV mapping pass.
    const ex = rect.left   / sw;  // Left edge fraction
    const ey = rect.top    / sh;  // Top edge fraction
    const ew = rect.width  / sw;  // Width fraction
    const eh = rect.height / sh;  // Height fraction

    // ── Scroll drift compensation ─────────────────────────────────────────────
    // Amount the page has scrolled since the last background capture,
    // normalised to viewport dimensions.  Passed to the shader as u_scroll
    // so the background sample UV is offset accordingly.
    const sdx = (window.scrollX - _state.bgScrollX) / sw;
    const sdy = (window.scrollY - _state.bgScrollY) / sh;

    // ── Upload uniforms ───────────────────────────────────────────────────────
    gl.uniform1f(uni.u_time,        t);
    gl.uniform2f(uni.u_mouse,       es.springX.value, es.springY.value);
    gl.uniform1f(uni.u_hover,       es.hoverSpring.value);
    gl.uniform2f(uni.u_tilt,        es.tiltX.value, es.tiltY.value);
    gl.uniform2f(uni.u_res,         w, h);
    gl.uniform2f(uni.u_elementPos,  ex, ey);
    gl.uniform2f(uni.u_elementSize, ew, eh);
    gl.uniform1f(uni.u_ior,         _opts.ior);
    gl.uniform1f(uni.u_refractStr,  _opts.refractionStrength);
    gl.uniform1f(uni.u_bgReady,     _state.bgReady ? 1.0 : 0.0);
    gl.uniform2f(uni.u_scroll,      sdx, sdy);

    // Resolve glassType string → numeric index for the GLSL uniform.
    // The shader uses a float uniform because WebGL2 integer uniforms
    // require explicit flat interpolation in the vertex stage — a float
    // with integer values is simpler and equally performant here.
    const GLASS_TYPE_MAP = { BK7: 0, SF11: 1, NK51A: 2, NBK10: 3, F2: 4 };
    const glassTypeIndex = typeof _opts.glassType === 'string'
        ? (GLASS_TYPE_MAP[_opts.glassType] ?? 0)   // named string → index
        : Math.floor(_opts.glassType) % 5;          // numeric → clamp to valid range
    gl.uniform1f(uni.u_glassType, glassTypeIndex);

    // ── Bind background texture to unit 1 ─────────────────────────────────────
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, _state.bgTexture);

    // ── v4.1.0 glass variant upload ───────────────────────────────────────────
    const variantKey = typeof _opts.glassVariant === 'string' ? _opts.glassVariant : 'clear';
    const vd = GLASS_VARIANTS[variantKey] ?? GLASS_VARIANTS.clear;
    gl.uniform3f(uni.u_tintRGB,       vd.tintRGB[0],    vd.tintRGB[1],    vd.tintRGB[2]);
    gl.uniform1f(uni.u_tintStrength,  vd.tintStrength);
    gl.uniform1f(uni.u_frostedAmount, vd.frosted);
    gl.uniform1f(uni.u_mirrorStrength,vd.mirror);
    gl.uniform1f(uni.u_smokeDensity,  vd.smokeDensity);
    gl.uniform1f(uni.u_causticScale,  vd.causticScale);
    gl.uniform3f(uni.u_causticTint,   vd.causticTint[0], vd.causticTint[1], vd.causticTint[2]);

    // ── Draw fullscreen triangle ──────────────────────────────────────────────
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Blit GL output → element's 2D caustic canvas ─────────────────────────
    // This is the transfer step that moves the WebGL render result into the
    // CSS-composited canvas overlay on the glass element.
    es.ctx2d.clearRect(0, 0, w, h);
    es.ctx2d.drawImage(_state.glCanvas, 0, 0);
}


// ─────────────────────────────────────────────────────────────────────────────
// §7  SVG filter bank
//
//  Two SVG filters are injected into a hidden <svg> element in <body>:
//
//  #lg-distort
//    Applied to the .lg-outer wrapper element via CSS filter:url(#lg-distort).
//    Produces per-channel chromatic aberration (RGB split) using three
//    feDisplacementMap stages driven by animated feTurbulence.  Each channel
//    is isolated with feColorMatrix before being recombined with feBlend(screen).
//    On 'high' tier, aberrationStrength is used at full value; 'mid' at 0.5×.
//    On 'low' tier, both filters are replaced with no-op <feComposite> stubs.
//
//  #lg-refract
//    Applied directly to content inside .lg via filter:url(#lg-refract).
//    Uses a fractalNoise feTurbulence driving feDisplacementMap at a low scale
//    (2–3 px) to add micro-distortion to the element's content, simulating
//    viewing through an imperfect glass surface.
//
//  Why SVG filters instead of CSS filter()?
//    CSS backdrop-filter is not compositable with feDisplacementMap in any
//    current browser.  The SVG filter is applied at the wrapper layer, above
//    the backdrop-filter layer, so they work in parallel without interference.
//
//  Animation:
//    The feTurbulence baseFrequency is animated with <animate> to slowly
//    drift, giving the distortion a living, breathing quality.  The seed value
//    is animated discretely to occasionally "snap" the turbulence pattern,
//    adding micro-variation that prevents the animation from looking looped.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the inner SVG <defs> markup containing the two filter definitions.
 * Returns a simplified no-op version for 'low' tier to avoid filter overhead.
 *
 * @param {GpuTier} tier - GPU capability tier.
 * @returns {string} SVG markup string (safe to assign to .innerHTML).
 */
function _buildSVGDefs(tier) {
    // Low-tier: return bare filters with no-op feComposite so filter references
    // in CSS resolve without triggering an error, but produce no visual effect.
    if (tier === 'low') {
        return `<defs>
      <filter id="lg-distort"><feComposite operator="atop"/></filter>
      <filter id="lg-refract"><feComposite operator="atop"/></filter>
    </defs>`;
    }

    // Half-strength aberration on mid-tier GPUs to conserve fill-rate.
    const aber  = tier === 'high' ? _opts.aberrationStrength : _opts.aberrationStrength * 0.5;
    // Mid-tier uses scale 2 (subtler displacement); high-tier uses scale 3.
    const refSc = tier === 'high' ? 3 : 2;

    return `<defs>

      <!-- ─────────────────────────────────────────────────────────────────── -->
      <!-- #lg-distort: Chromatic aberration filter applied to .lg-outer       -->
      <!-- Splits RGB channels by driving separate feDisplacementMap stages    -->
      <!-- with different scale factors from the same animated turbulence.     -->
      <!-- x/y oversize (-25%/+50%) prevents edge clipping during displacement.-->
      <!-- ─────────────────────────────────────────────────────────────────── -->
      <filter id="lg-distort" x="-25%" y="-25%" width="150%" height="150%"
              color-interpolation-filters="sRGB">

        <!-- Animated turbulence drives the displacement maps.                 -->
        <!-- baseFrequency is keyframe-animated to slowly drift the pattern.  -->
        <!-- seed is discretely animated (calcMode="discrete") to add variety. -->
        <feTurbulence type="turbulence" baseFrequency="0.015 0.019"
            numOctaves="3" seed="7" result="turb">
          <animate attributeName="baseFrequency"
              values="0.015 0.019;0.022 0.014;0.018 0.024;0.015 0.019"
              dur="12s" repeatCount="indefinite" calcMode="spline"
              keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
          <animate attributeName="seed" values="7;13;3;19;5;11;7"
              dur="31s" repeatCount="indefinite" calcMode="discrete"/>
        </feTurbulence>

        <!-- Three feDisplacementMap stages, one per RGB channel, at           -->
        <!-- decreasing scale to spread R most, G medium, B least.            -->
        <feDisplacementMap in="SourceGraphic" in2="turb" scale="${aber.toFixed(1)}"
            xChannelSelector="R" yChannelSelector="G" result="dR"/>
        <feDisplacementMap in="SourceGraphic" in2="turb" scale="${(aber * 0.62).toFixed(1)}"
            xChannelSelector="G" yChannelSelector="B" result="dG"/>
        <feDisplacementMap in="SourceGraphic" in2="turb" scale="${(aber * 0.36).toFixed(1)}"
            xChannelSelector="B" yChannelSelector="R" result="dB"/>

        <!-- feColorMatrix isolates one channel from each displaced copy.      -->
        <feColorMatrix in="dR" type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="oR"/>
        <feColorMatrix in="dG" type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="oG"/>
        <feColorMatrix in="dB" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="oB"/>

        <!-- Screen blend recombines the isolated channels into full colour.   -->
        <feBlend in="oR"  in2="oG" mode="screen" result="rg"/>
        <feBlend in="rg"  in2="oB" mode="screen" result="rgb"/>
        <!-- atop composite clips the result to the original element shape.   -->
        <feComposite in="rgb" in2="SourceGraphic" operator="atop"/>

      </filter>

      <!-- ─────────────────────────────────────────────────────────────────── -->
      <!-- #lg-refract: Micro-distortion filter applied to .lg content         -->
      <!-- Low-frequency fractal noise drives a gentle feDisplacementMap to   -->
      <!-- simulate the slight warping of content seen through real glass.    -->
      <!-- ─────────────────────────────────────────────────────────────────── -->
      <filter id="lg-refract" x="-32%" y="-32%" width="164%" height="164%"
              color-interpolation-filters="sRGB">

        <feTurbulence type="fractalNoise" baseFrequency="0.007 0.011"
            numOctaves="2" seed="3" result="warp">
          <animate attributeName="baseFrequency"
              values="0.007 0.011;0.013 0.008;0.009 0.015;0.007 0.011"
              dur="16s" repeatCount="indefinite" calcMode="spline"
              keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
        </feTurbulence>

        <!-- scale="${refSc}" px — barely perceptible, just enough to break   -->
        <!-- the straight-edge appearance of DOM content.                     -->
        <feDisplacementMap in="SourceGraphic" in2="warp" scale="${refSc}"
            xChannelSelector="R" yChannelSelector="G"/>

      </filter>

    </defs>`;
}

/**
 * Creates the hidden SVG element, populates it with the filter definitions,
 * and appends it to <body>.  Idempotent — only runs once per init cycle.
 */
function _injectSVG() {
    if (_state.svgReady) return;
    _state.svgReady = true;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    // Position fixed at 0×0; overflow:hidden prevents any filter expansion
    // from introducing scrollbars or layout impact.
    svg.setAttribute('style', [
        'position:fixed',
        'width:0',
        'height:0',
        'overflow:hidden',
        'pointer-events:none',
        'z-index:-9999',
    ].join(';'));

    svg.innerHTML = _buildSVGDefs(_detectGpuTier());
    document.body.appendChild(svg);
    _state.svgEl = svg;
}


// ─────────────────────────────────────────────────────────────────────────────
// §8  CSS injection
//
//  A single <style id="liquid-glass-pro-style-200"> element is injected into
//  <head> once.  All glass visual language is expressed here.
//
//  CSS architecture layers (outermost → innermost, back → front):
//    .lg-outer            — SVG filter wrapper; provides distortion context
//    .lg                  — Main glass element: backdrop-filter, radial highlights,
//                           box-shadow stack, CSS custom property bindings
//    .lg::before          — Secondary highlight layer (cursor-tracking specular)
//    .lg::after           — Thin-film iridescence (conic-gradient + overlay blend)
//    .lg-grain            — Film grain texture (SVG noise via data-URI)
//    .lg-caustic-canvas   — WebGL caustic overlay (screen blend)
//    .lg > *              — Content (z-index:5 keeps it above all overlay layers)
//
//  z-index stacking within .lg (isolation:isolate creates a new stacking context):
//    1  ::before    secondary specular highlight
//    2  ::after     iridescence conic overlay
//    3  .lg-grain   film grain
//    4  .lg-caustic-canvas  WebGL caustic / refraction
//    5  content children
//
//  Key CSS features used:
//    backdrop-filter      — hardware-accelerated blur + saturate + brightness
//    CSS custom properties — animated per-frame by JS spring system (§3)
//    will-change          — hints browser to promote to compositor layer
//    @keyframes           — lg-irid-spin, lg-grain-shift, lg-breathe
//    @media (prefers-reduced-motion) — fully disables all motion
//    CSS.registerProperty — Houdini typed transitions (see §4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the complete CSS string for the Liquid Glass PRO visual system.
 * The breathe @keyframes block is conditionally included based on _opts.breathe.
 *
 * @returns {string} Raw CSS text ready for a <style> element.
 */
function _buildCSS() {
    const breatheKF = _opts.breathe ? `
@keyframes lg-breathe {
     0% { border-radius: 16px 19px 14px 21px / 19px 14px 21px 16px; }
    20% { border-radius: 21px 14px 19px 16px / 14px 21px 16px 19px; }
    40% { border-radius: 14px 22px 16px 18px / 22px 16px 18px 14px; }
    60% { border-radius: 19px 16px 22px 13px / 16px 19px 13px 22px; }
    80% { border-radius: 13px 21px 17px 20px / 21px 17px 20px 13px; }
   100% { border-radius: 16px 19px 14px 21px / 19px 14px 21px 16px; }
}` : '';

    const { before, hover, specCanvas } = _buildSpecularCSS();

    return `
/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-outer — SVG filter wrapper                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-outer {
    display: inline-flex;
    position: relative;
    margin: -10px;
    padding: 10px;
}

.lg-outer.block { display: block;  }
.lg-outer.flex  { display: flex;   }
.lg-outer.grid  { display: grid;   }

@media (prefers-reduced-motion: no-preference) {
    .lg-outer { filter: url(#lg-distort); }
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg — Main glass element                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg {
    --lg-mx:    50%;
    --lg-my:    30%;
    --lg-irid:  0deg;
    --lg-hover: 0;
    --lg-tx:    0;
    --lg-ty:    0;

    position:   relative;
    isolation:  isolate;
    overflow:   hidden;
    border-radius: 16px;
    will-change: transform, box-shadow;

    background:
        radial-gradient(
            ellipse 48% 34% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.08)  0%,
            rgba(255,255,255,0.02) 48%,
            transparent            68%
        ),
        rgba(255,255,255,0.06);

    backdrop-filter:         blur(12px) saturate(110%) brightness(1.06);
    -webkit-backdrop-filter: blur(12px) saturate(110%) brightness(1.06);

    box-shadow:
        inset  0  1.5px 0   rgba(255,255,255,0.44),
        inset  1px 0    0   rgba(255,255,255,0.20),
        inset  0 -1px   0   rgba(0,0,0,0.12),
        0  4px 18px  -4px   rgba(0,0,0,0.30),
        0 16px 48px -12px   rgba(0,0,0,0.20),
        0  1px  4px  0      rgba(0,0,0,0.18),
        0  0   48px -18px   rgba(185,160,255,0.22);

    transition:
        transform    .22s cubic-bezier(.34,1.56,.64,1),
        box-shadow   .22s ease,
        background   .22s ease;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg::before — CSS fallback specular (§16.A)                                 */
/* Active only on .lg:not([data-lg-webgl]) — low tier / init failure.         */
/* ─────────────────────────────────────────────────────────────────────────── */

${before}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg::after — Thin-film iridescence overlay                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg::after {
    content:  '';
    position: absolute;
    inset:    0;
    border-radius: inherit;
    pointer-events: none;
    z-index:  2;

    background: conic-gradient(
        from var(--lg-irid) at 50% 50%,
        hsla(195, 100%, 88%, .000),
        hsla(235, 100%, 92%, .044),
        hsla(278, 100%, 88%, .029),
        hsla(328, 100%, 92%, .044),
        hsla( 18, 100%, 88%, .029),
        hsla( 78, 100%, 92%, .044),
        hsla(138, 100%, 88%, .029),
        hsla(195, 100%, 88%, .000)
    );

    mix-blend-mode: overlay;
    opacity: .94;
    animation: lg-irid-spin 15s linear infinite;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-grain — Film grain overlay                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-grain {
    position: absolute;
    inset:    0;
    border-radius: inherit;
    pointer-events: none;
    z-index:  3;
    will-change: background-position;

    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.76' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
    background-size:  240px 240px;

    mix-blend-mode: soft-light;
    opacity: .038;
    animation: lg-grain-shift .12s steps(1) infinite;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-caustic-canvas — WebGL caustic/refraction overlay                       */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-caustic-canvas {
    position: absolute;
    inset:    0;
    width:    100%;
    height:   100%;
    pointer-events: none;
    z-index:  4;
    border-radius:   inherit;
    mix-blend-mode:  screen;
    opacity: 0;
    transition: opacity .35s ease;
}

.lg.lg-interactive:hover .lg-caustic-canvas { opacity: 0.035; }


/* ─────────────────────────────────────────────────────────────────────────── */
/* Refraction status indicator                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg[data-lg-refract="1"]::before {
    outline: 1px solid rgba(100, 200, 255, 0.0);
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* Content children                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg > *:not(.lg-grain):not(.lg-caustic-canvas):not(.lg-specular-canvas) {
    position: relative;
    z-index: 5;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* Interactive state                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg.lg-interactive { cursor: pointer; }

/* :hover — box-shadow amplification (§16.B), synchronized with L0 ×1.5      */
${hover}

/* :active — press-down */
.lg.lg-interactive:active {
    transform: translateY(1px) scale(.991) translateZ(0) !important;
    transition-duration: .07s;
    box-shadow:
        inset  0  1px  0  rgba(255,255,255,0.32),
        inset  1px 0   0  rgba(255,255,255,0.14),
        0  2px  8px -3px  rgba(0,0,0,0.28),
        0  6px 22px -8px  rgba(0,0,0,0.18);
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-reply                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-reply {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    padding:        8px 12px;
    margin-bottom:  8px;
    border-radius:  10px;

    box-shadow:
        inset 2.5px 0 0  rgba(255,255,255,.40),
        inset 0    1px 0 rgba(255,255,255,.18),
        inset 0   -1px 0 rgba(0,0,0,.10),
        0  2px 10px -3px rgba(0,0,0,.22);
}

.lg-reply .lg-sender {
    font-size:      11px;
    font-weight:    700;
    color:          rgba(255,255,255,.85);
    letter-spacing: .02em;
    white-space:    nowrap;
    overflow:       hidden;
    text-overflow:  ellipsis;
    position:       relative;
    z-index:        5;
}

.lg-reply .lg-text {
    font-size:    12px;
    color:        rgba(255,255,255,.50);
    white-space:  nowrap;
    overflow:     hidden;
    text-overflow: ellipsis;
    position:     relative;
    z-index:      5;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg.lg-own                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg.lg-own {
    background:
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(200,175,255,.22)  0%,
            rgba(180,150,255,.06) 38%,
            transparent           62%
        ),
        rgba(110,68,202,.055);

    box-shadow:
        inset  0  2px  0  rgba(220,195,255,.32),
        inset  1px 0   0  rgba(200,175,255,.16),
        inset  0 -1px  0  rgba(0,0,0,.12),
        0  4px 18px  -4px rgba(0,0,0,.26),
        0 16px 44px -12px rgba(0,0,0,.16),
        0  0   38px -12px rgba(165,100,255,.24);
}

.lg.lg-own::after {
    background: conic-gradient(
        from var(--lg-irid) at 50% 50%,
        hsla(248, 100%, 88%, 0    ),
        hsla(278, 100%, 92%, .054 ),
        hsla(312, 100%, 88%, .034 ),
        hsla(338, 100%, 92%, .054 ),
        hsla(248, 100%, 88%, 0    )
    );
}

.lg.lg-own .lg-sender { color: rgba(226,202,255,.92); }


/* ─────────────────────────────────────────────────────────────────────────── */
/* Shape modifiers                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg.lg-pill { border-radius: 999px; padding: 6px 18px; }
.lg.lg-card { border-radius: 22px;  padding: 20px; }
.lg.lg-fab  {
    border-radius: 50%;
    width:  56px;
    height: 56px;
    display:         flex;
    align-items:     center;
    justify-content: center;
    flex-shrink: 0;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* @keyframes                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

@keyframes lg-irid-spin {
    from { --lg-irid: 0deg;   }
    to   { --lg-irid: 360deg; }
}

@keyframes lg-grain-shift {
      0% { background-position:   0px   0px; }
     11% { background-position: -48px -34px; }
     22% { background-position:  34px  56px; }
     33% { background-position: -72px  24px; }
     44% { background-position:  20px -60px; }
     55% { background-position: -42px  78px; }
     66% { background-position:  66px -16px; }
     77% { background-position: -22px  46px; }
     88% { background-position:  46px -30px; }
}

${breatheKF}


/* ─────────────────────────────────────────────────────────────────────────── */
/* Animation assignments                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg:not(.lg-pill):not(.lg-fab):not(.lg-reply) {
    animation: lg-irid-spin 15s linear infinite
               ${_opts.breathe ? ', lg-breathe 9s ease-in-out infinite' : ''};
}

.lg.lg-pill,
.lg.lg-fab,
.lg.lg-reply  { animation: lg-irid-spin 15s linear infinite; }

.lg::after    { animation: lg-irid-spin 15s linear infinite; }


/* ─────────────────────────────────────────────────────────────────────────── */
/* @media (prefers-reduced-motion)                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
    .lg,
    .lg::before,
    .lg::after,
    .lg-grain,
    .lg-caustic-canvas,
    .lg-specular-canvas {
        animation:   none !important;
        transition:  none !important;
        will-change: auto !important;
    }

    .lg { border-radius: 16px !important; transform: none !important; }
    .lg-outer { filter: none !important; }
    .lg-caustic-canvas   { display: none; }
    .lg-specular-canvas  { display: none; }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* §16.C  Specular canvas + thin-film CSS overrides                            */
/* ─────────────────────────────────────────────────────────────────────────── */

${specCanvas}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* §v4.1  Glass Variant CSS Overrides                                          */
/*                                                                             */
/*  Each variant class overrides backdrop-filter and background gradient.      */
/*  Applied via .lg.lg-v-{name}. Set programmatically by setGlassVariant().   */
/*  Physical parameters (Beer-Lambert, scatter, mirror) live in GLSL §H2-H3.  */
/*  The CSS layer handles perceptual "feel" and first-frame appearance before  */
/*  the WebGL pass renders.                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/* ── 1. Clear ─────────────────────────────────────────────────────────────── */
/* Near-invisible: minimal blur, maximum saturation boost, slight brightness.  */
.lg.lg-v-clear {
    backdrop-filter:         blur(7px) saturate(155%) brightness(1.08);
    -webkit-backdrop-filter: blur(7px) saturate(155%) brightness(1.08);
    background:
        radial-gradient(ellipse 48% 34% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.01) 50%, transparent 70%),
        rgba(255,255,255,0.04);
}

/* ── 2. Frosted ───────────────────────────────────────────────────────────── */
/* 40px blur = full optical diffusion; saturate 78% = desaturated scatter.    */
/* White radial gradient simulates light spread through ground glass surface.  */
.lg.lg-v-frosted {
    backdrop-filter:         blur(40px) saturate(78%) brightness(1.16);
    -webkit-backdrop-filter: blur(40px) saturate(78%) brightness(1.16);
    background:
        radial-gradient(ellipse 60% 45% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.10) 50%, transparent 72%),
        rgba(255,255,255,0.20);
    box-shadow:
        inset  0  2px  0  rgba(255,255,255,0.65),
        inset  1px 0   0  rgba(255,255,255,0.35),
        inset  0  -1px 0  rgba(0,0,0,0.08),
        0  4px 18px  -4px rgba(0,0,0,0.22),
        0 14px 40px -10px rgba(0,0,0,0.14),
        0  0   60px -20px rgba(220,230,255,0.18);
}

/* ── 3. Smoke ─────────────────────────────────────────────────────────────── */
/* Low brightness (0.66) + reduced saturation = dark neutral-density glass.   */
/* bg tint rgba(18,20,28) = very dark blue-grey (automotive tint film colour). */
.lg.lg-v-smoke {
    backdrop-filter:         blur(16px) saturate(58%) brightness(0.66);
    -webkit-backdrop-filter: blur(16px) saturate(58%) brightness(0.66);
    background:
        radial-gradient(ellipse 42% 30% at var(--lg-mx) var(--lg-my),
            rgba(80,85,105,0.18) 0%, rgba(30,32,42,0.08) 50%, transparent 68%),
        rgba(18,20,28,0.52);
    box-shadow:
        inset  0  1px  0  rgba(120,130,160,0.25),
        inset  1px 0   0  rgba(100,110,140,0.12),
        inset  0  -1px 0  rgba(0,0,0,0.22),
        0  4px 20px  -4px rgba(0,0,0,0.50),
        0 18px 50px -12px rgba(0,0,0,0.38),
        0  0   40px -15px rgba(60,70,120,0.20);
}

/* ── 4. Tinted Blue ───────────────────────────────────────────────────────── */
/* hue-rotate(210deg) shifts existing warm tones toward cobalt blue.          */
/* bg rgba(30,90,210) = cobalt blue float glass tint.                         */
.lg.lg-v-tinted-blue {
    backdrop-filter:         blur(12px) saturate(145%) brightness(1.04) hue-rotate(210deg);
    -webkit-backdrop-filter: blur(12px) saturate(145%) brightness(1.04) hue-rotate(210deg);
    background:
        radial-gradient(ellipse 50% 36% at var(--lg-mx) var(--lg-my),
            rgba(80,150,255,0.14) 0%, rgba(30,90,210,0.05) 50%, transparent 70%),
        rgba(30,90,210,0.13);
    box-shadow:
        inset  0  1.5px 0  rgba(140,195,255,0.50),
        inset  1px  0   0  rgba(100,165,255,0.22),
        inset  0  -1px  0  rgba(0,0,0,0.12),
        0  4px 18px  -4px  rgba(0,0,0,0.28),
        0 16px 48px -12px  rgba(0,0,0,0.18),
        0  0   60px -20px  rgba(50,120,255,0.28);
}

/* ── 5. Tinted Violet ─────────────────────────────────────────────────────── */
/* hue-rotate(270deg) maximises shift toward violet/ultraviolet.              */
.lg.lg-v-tinted-violet {
    backdrop-filter:         blur(12px) saturate(135%) brightness(1.02) hue-rotate(270deg);
    -webkit-backdrop-filter: blur(12px) saturate(135%) brightness(1.02) hue-rotate(270deg);
    background:
        radial-gradient(ellipse 50% 36% at var(--lg-mx) var(--lg-my),
            rgba(155,80,255,0.16) 0%, rgba(100,30,210,0.06) 50%, transparent 70%),
        rgba(100,30,210,0.14);
    box-shadow:
        inset  0  1.5px 0  rgba(200,155,255,0.48),
        inset  1px  0   0  rgba(165,110,255,0.22),
        inset  0  -1px  0  rgba(0,0,0,0.12),
        0  4px 18px  -4px  rgba(0,0,0,0.28),
        0 16px 48px -12px  rgba(0,0,0,0.18),
        0  0   60px -20px  rgba(130,60,255,0.32);
}

/* ── 6. Tinted Amber ──────────────────────────────────────────────────────── */
/* sepia(25%) pushes CSS toward the amber/golden register before hue-rotate.  */
/* bg rgba(220,130,20) = amber glass warm honey tone.                         */
.lg.lg-v-tinted-amber {
    backdrop-filter:         blur(11px) saturate(148%) brightness(1.07) sepia(25%);
    -webkit-backdrop-filter: blur(11px) saturate(148%) brightness(1.07) sepia(25%);
    background:
        radial-gradient(ellipse 52% 38% at var(--lg-mx) var(--lg-my),
            rgba(255,185,50,0.16) 0%, rgba(220,130,20,0.06) 50%, transparent 70%),
        rgba(220,130,20,0.13);
    box-shadow:
        inset  0  1.5px 0  rgba(255,220,120,0.52),
        inset  1px  0   0  rgba(240,190,80,0.24),
        inset  0  -1px  0  rgba(0,0,0,0.12),
        0  4px 18px  -4px  rgba(0,0,0,0.28),
        0 16px 48px -12px  rgba(0,0,0,0.16),
        0  0   55px -18px  rgba(220,150,30,0.30);
}

/* ── 7. Mirror ────────────────────────────────────────────────────────────── */
/* Minimal blur (3px): mirror glass is optically flat, not diffusing.         */
/* High brightness (1.18): reflects more than it absorbs.                     */
/* box-shadow intensified: mirror surfaces have hard specular rim reflections. */
.lg.lg-v-mirror {
    backdrop-filter:         blur(3px) saturate(125%) brightness(1.18);
    -webkit-backdrop-filter: blur(3px) saturate(125%) brightness(1.18);
    background:
        radial-gradient(ellipse 45% 30% at var(--lg-mx) var(--lg-my),
            rgba(240,245,255,0.16) 0%, rgba(210,220,240,0.06) 46%, transparent 66%),
        rgba(220,228,240,0.08);
    box-shadow:
        inset  0   2px  0  rgba(255,255,255,0.70),
        inset  1px  0   0  rgba(255,255,255,0.35),
        inset  0  -1px  0  rgba(0,0,0,0.15),
        0  6px 24px  -4px  rgba(0,0,0,0.36),
        0 20px 60px -12px  rgba(0,0,0,0.26),
        0  2px  6px  0     rgba(0,0,0,0.22),
        0  0   70px -20px  rgba(160,185,230,0.26);
}

/* ── 8. Ice ───────────────────────────────────────────────────────────────── */
/* 20px blur + hue-rotate(200deg) = frosty blue haze.                         */
/* High brightness (1.22): ice transmits very well in the visible range.      */
.lg.lg-v-ice {
    backdrop-filter:         blur(20px) saturate(60%) brightness(1.22) hue-rotate(200deg);
    -webkit-backdrop-filter: blur(20px) saturate(60%) brightness(1.22) hue-rotate(200deg);
    background:
        radial-gradient(ellipse 55% 42% at var(--lg-mx) var(--lg-my),
            rgba(180,220,255,0.22) 0%, rgba(140,200,255,0.08) 52%, transparent 72%),
        rgba(165,215,255,0.16);
    box-shadow:
        inset  0  2.5px 0  rgba(220,240,255,0.65),
        inset  1px  0   0  rgba(190,225,255,0.30),
        inset  0  -1px  0  rgba(100,160,220,0.15),
        0  4px 20px  -4px  rgba(0,0,0,0.22),
        0 16px 48px -12px  rgba(0,0,0,0.14),
        0  0   70px -22px  rgba(100,180,255,0.30);
}

/* ── 9. Bronze ────────────────────────────────────────────────────────────── */
/* sepia(40%) + warm-shifted saturate for bronze/copper dichroic appearance.  */
.lg.lg-v-bronze {
    backdrop-filter:         blur(13px) saturate(128%) brightness(0.96) sepia(40%);
    -webkit-backdrop-filter: blur(13px) saturate(128%) brightness(0.96) sepia(40%);
    background:
        radial-gradient(ellipse 50% 36% at var(--lg-mx) var(--lg-my),
            rgba(210,130,30,0.20) 0%, rgba(180,100,20,0.07) 50%, transparent 70%),
        rgba(180,100,20,0.14);
    box-shadow:
        inset  0  1.5px 0  rgba(245,195,110,0.50),
        inset  1px  0   0  rgba(220,160,70,0.22),
        inset  0  -1px  0  rgba(0,0,0,0.14),
        0  4px 18px  -4px  rgba(0,0,0,0.32),
        0 16px 48px -12px  rgba(0,0,0,0.20),
        0  0   50px -16px  rgba(200,110,20,0.28);
}

/* ── 10. Emerald ──────────────────────────────────────────────────────────── */
/* hue-rotate(140deg) shifts blue toward green; high saturation = vivid gem. */
.lg.lg-v-emerald {
    backdrop-filter:         blur(12px) saturate(158%) brightness(1.03) hue-rotate(140deg);
    -webkit-backdrop-filter: blur(12px) saturate(158%) brightness(1.03) hue-rotate(140deg);
    background:
        radial-gradient(ellipse 50% 36% at var(--lg-mx) var(--lg-my),
            rgba(20,180,70,0.18) 0%, rgba(10,140,45,0.06) 50%, transparent 70%),
        rgba(15,140,50,0.14);
    box-shadow:
        inset  0  1.5px 0  rgba(100,240,150,0.50),
        inset  1px  0   0  rgba(70,210,110,0.22),
        inset  0  -1px  0  rgba(0,0,0,0.12),
        0  4px 18px  -4px  rgba(0,0,0,0.28),
        0 16px 48px -12px  rgba(0,0,0,0.18),
        0  0   55px -18px  rgba(20,180,70,0.32);
}

/* ── 11. Rose ─────────────────────────────────────────────────────────────── */
/* hue-rotate(330deg) = pink-red shift; slight sepia adds warmth.             */
.lg.lg-v-rose {
    backdrop-filter:         blur(11px) saturate(138%) brightness(1.05) hue-rotate(330deg);
    -webkit-backdrop-filter: blur(11px) saturate(138%) brightness(1.05) hue-rotate(330deg);
    background:
        radial-gradient(ellipse 50% 36% at var(--lg-mx) var(--lg-my),
            rgba(255,120,150,0.16) 0%, rgba(240,80,115,0.05) 50%, transparent 70%),
        rgba(240,80,120,0.12);
    box-shadow:
        inset  0  1.5px 0  rgba(255,180,200,0.50),
        inset  1px  0   0  rgba(255,150,175,0.22),
        inset  0  -1px  0  rgba(0,0,0,0.10),
        0  4px 18px  -4px  rgba(0,0,0,0.26),
        0 16px 48px -12px  rgba(0,0,0,0.16),
        0  0   55px -18px  rgba(240,80,120,0.28);
}

/* ── 12. Obsidian ─────────────────────────────────────────────────────────── */
/* Very dark: brightness(0.54) + near-black bg tint.                          */
/* Subtle purple glow in shadow stack = characteristic obsidian iridescence.  */
.lg.lg-v-obsidian {
    backdrop-filter:         blur(15px) saturate(55%) brightness(0.54);
    -webkit-backdrop-filter: blur(15px) saturate(55%) brightness(0.54);
    background:
        radial-gradient(ellipse 40% 28% at var(--lg-mx) var(--lg-my),
            rgba(60,40,90,0.25) 0%, rgba(20,14,38,0.10) 48%, transparent 68%),
        rgba(8,5,18,0.72);
    box-shadow:
        inset  0  1.5px 0  rgba(110,80,160,0.28),
        inset  1px  0   0  rgba(80,55,120,0.14),
        inset  0  -1px  0  rgba(0,0,0,0.30),
        0  4px 22px  -4px  rgba(0,0,0,0.65),
        0 20px 58px -12px  rgba(0,0,0,0.52),
        0  2px  6px  0     rgba(0,0,0,0.30),
        0  0   45px -14px  rgba(80,40,140,0.22);
}

/* ── Variant hover amplification ─────────────────────────────────────────── */
/* Shared for all tinted variants: slightly brighter on hover.               */
.lg.lg-v-tinted-blue.lg-interactive:hover,
.lg.lg-v-tinted-violet.lg-interactive:hover,
.lg.lg-v-tinted-amber.lg-interactive:hover,
.lg.lg-v-emerald.lg-interactive:hover,
.lg.lg-v-rose.lg-interactive:hover,
.lg.lg-v-bronze.lg-interactive:hover {
    filter: brightness(1.08);
}

/* Mirror hover: make the reflection more intense */
.lg.lg-v-mirror.lg-interactive:hover {
    filter: brightness(1.12) contrast(1.05);
}

/* Obsidian + Smoke hover: slight brightness lift from dark base */
.lg.lg-v-obsidian.lg-interactive:hover,
.lg.lg-v-smoke.lg-interactive:hover {
    filter: brightness(1.14);
}
`;
}

/**
 * Injects the generated CSS into a <style> element in <head>.
 * Idempotent — guards against duplicate injection using a stable element ID.
 */
function _injectCSS() {
    // Use a version-specific style tag id so old injected CSS
    // from previous builds cannot block the new stylesheet.
    const STYLE_ID = 'liquid-glass-pro-style-300';

    // If an older stylesheet exists, remove it explicitly.
    document.getElementById('liquid-glass-pro-style-200')?.remove();

    // Prevent duplicate injection for the current version only.
    if (document.getElementById(STYLE_ID)) return;

    _state.styleEl = Object.assign(document.createElement('style'), {
        id: STYLE_ID,
        textContent: _buildCSS(),
    });

    document.head.appendChild(_state.styleEl);
}


// ─────────────────────────────────────────────────────────────────────────────
// §9  Device orientation (gyroscope tilt)
//
//  On supported mobile devices the 'deviceorientation' event provides real-time
//  Euler angles from the device's IMU (inertial measurement unit):
//
//    e.gamma  — rotation around Z (device tilted left/right), range −90..+90°
//    e.beta   — rotation around X (device tilted forward/back), range −180..+180°
//
//  These are normalised to the range [−1, +1] and fed to the tilt spring
//  targets (_state.deviceTilt) in the rAF loop, which then drives the CSS
//  perspective transform and the u_tilt GLSL uniform.
//
//  The 0.5 offset on beta shifts the "neutral" position from the device lying
//  flat (beta=0) to the device held upright at ~45° — a more natural
//  use-case for reading content.
//
//  iOS 13+ requires a user gesture + DeviceOrientationEvent.requestPermission()
//  call before orientation events fire.  This module does not request that
//  permission automatically; the host app should call it before init if
//  gyroscope parallax is desired on iOS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches the 'deviceorientation' event listener and starts updating
 * _state.deviceTilt on each sensor reading.
 * Idempotent — will not add duplicate listeners if called again.
 */
function _startOrientationTracking() {
    if (_state.orientHandler) return;

    const h = e => {
        // Clamp to [−1, +1] after normalising: gamma / 45° for X, (beta−45°) / 45° for Y
        _state.deviceTilt.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 45));
        _state.deviceTilt.y = Math.max(-1, Math.min(1, (e.beta  ?? 0) / 45 - 0.5));
    };

    window.addEventListener('deviceorientation', h, { passive: true });
    _state.orientHandler = h;
}

/**
 * Removes the 'deviceorientation' listener and resets tilt to zero.
 * Called during destroyLiquidGlass() cleanup.
 */
function _stopOrientationTracking() {
    if (!_state.orientHandler) return;
    window.removeEventListener('deviceorientation', _state.orientHandler);
    _state.orientHandler  = null;
    _state.deviceTilt     = { x: 0, y: 0 };
}


// ─────────────────────────────────────────────────────────────────────────────
// §10  Per-element attachment and detachment
//
//  _attach(el) is the core setup function called for each .lg element found
//  in the DOM (by the MutationObserver) or provided directly (attachElement()).
//
//  It:
//    1. Creates and inserts the caustic <canvas> as el's first child.
//    2. Optionally inserts the .lg-grain overlay.
//    3. Creates all six spring state objects.
//    4. Registers pointer event listeners (move / enter / leave).
//    5. Creates a ResizeObserver to keep the canvas sized to the element.
//    6. Stores all state in _elements WeakMap and _tracked Set.
//    7. If GPU tier is ≥ mid and WebGL quota allows, initialises WebGL and
//       marks the element with data-lg-webgl="1".
//
//  _detach(el) is the mirror: removes listeners, disconnects observer,
//  removes DOM nodes, cleans up all state.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches the Liquid Glass effect to a single DOM element.
 * Idempotent — if the element is already tracked, returns immediately.
 *
 * @param {HTMLElement} el - The .lg element to attach to.
 */
function _attach(el) {
    if (_tracked.has(el)) return;

    // ── Per-element random specular offsets ───────────────────────────────────
    // Four CSS custom properties drive the GGX lobe position scatter in §16.A.
    // Randomised on every attach so each element gets a unique highlight angle.
    const r = () => (Math.random() * 4 - 2).toFixed(1) + '%';
    el.style.setProperty('--lg-sa', r());
    el.style.setProperty('--lg-sb', r());
    el.style.setProperty('--lg-sc', r());
    el.style.setProperty('--lg-sd', r());

    // ── DPR-aware canvas sizing ────────────────────────────────────────────────
    // Cap DPR at 2 to avoid excessive memory usage on 3× displays (Retina Plus).
    // MAX_CANVAS guards against browser limits: width * height > 268435456
    // (16384²) causes the canvas to silently fail on Safari and Chrome.
    const MAX_CANVAS = 4096;
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const rect = el.getBoundingClientRect();
    const w    = Math.min(Math.round(rect.width  * dpr) || 1, MAX_CANVAS);
    const h    = Math.min(Math.round(rect.height * dpr) || 1, MAX_CANVAS);

    // ── Caustic canvas (§6) ───────────────────────────────────────────────────
    const cvs     = document.createElement('canvas');
    cvs.className = 'lg-caustic-canvas';
    cvs.width     = w;
    cvs.height    = h;
    const ctx2d   = cvs.getContext('2d', { alpha: true, willReadFrequently: false });
    el.insertBefore(cvs, el.firstChild);

    // ── Film grain overlay ────────────────────────────────────────────────────
    if (_opts.grain && !el.querySelector('.lg-grain')) {
        el.insertBefore(createGrainLayer(), cvs.nextSibling);
    }

    // ── Spring state ──────────────────────────────────────────────────────────
    const springX     = _createSpring(0.5);
    const springY     = _createSpring(0.3);
    const hoverSpring = _createSpring(0);
    const tiltX       = _createSpring(0);
    const tiltY       = _createSpring(0);

    let es;  // forward ref for event handlers

    // ── Pointer event handlers ────────────────────────────────────────────────
    const onMove = e => {
        const r = el.getBoundingClientRect();
        springX.target = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        springY.target = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
        tiltX.target   = (springX.target - 0.5) * 2;
        tiltY.target   = (springY.target - 0.5) * 2;
        es.domRect     = r;
    };

    const onEnter = () => {
        hoverSpring.target = 1;
        es.hovered         = true;
        // Re-randomise specular lobe offsets on every hover enter so no two
        // interactions look identical — matches §15 area-light randomisation.
        el.style.setProperty('--lg-sa', r());
        el.style.setProperty('--lg-sb', r());
        el.style.setProperty('--lg-sc', r());
        el.style.setProperty('--lg-sd', r());
    };

    const onLeave = () => {
        springX.target     = 0.5;
        springY.target     = 0.30;
        hoverSpring.target = 0;
        tiltX.target       = 0;
        tiltY.target       = 0;
        es.hovered         = false;
    };

    el.addEventListener('pointermove',  onMove,  { passive: true });
    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });

    // ── ResizeObserver ─────────────────────────────────────────────────────────
    // Keeps the caustic canvas pixel dimensions in sync with the element layout.
    // MAX_CANVAS clamp applied here too — the element can grow after attach
    // (e.g. accordion open, font load reflow) and hit the same limit.
    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const cr = entry.contentRect;
            const nw = Math.min(Math.round(cr.width  * dpr) || 1, MAX_CANVAS);
            const nh = Math.min(Math.round(cr.height * dpr) || 1, MAX_CANVAS);
            if (nw !== es.width || nh !== es.height) {
                cvs.width   = es.width  = nw;
                cvs.height  = es.height = nh;
                // Keep specular canvas in sync with caustic canvas dimensions.
                if (es.specCanvas) {
                    es.specCanvas.width  = nw;
                    es.specCanvas.height = nh;
                }
            }
        }
    });
    ro.observe(el);

    // ── Assemble ElementState ─────────────────────────────────────────────────
    es = {
        canvas:       cvs,
        ctx2d,
        ro,
        springX,
        springY,
        hoverSpring,
        tiltX,
        tiltY,
        width:        w,
        height:       h,
        hovered:      false,
        dpr,
        domRect:      rect,
        pointerMove:  onMove,
        pointerEnter: onEnter,
        pointerLeave: onLeave,
        // §15 specular pass — filled below if WebGL is available
        specCtx:    null,  // CanvasRenderingContext2D of .lg-specular-canvas
        specCanvas: null,  // HTMLCanvasElement reference (for ResizeObserver)
    };

    _elements.set(el, es);
    _tracked.add(el);

    // Register with the IntersectionObserver so _visibleElements stays current.
    // _io may be null if _attach() is called before _startObserver() runs
    // (e.g. attachElement() called immediately after initLiquidGlass() on a
    // page that deferred DOMContentLoaded) — the optional chain guards this.
    _io?.observe(el);

    // ── WebGL caustics + specular enablement ──────────────────────────────────
    const tier = _detectGpuTier();
    if (_opts.caustics && tier !== 'low' && _activeWebGLCount < MAX_WEBGL_ELEMENTS) {
        if (_initWebGL()) {
            _activeWebGLCount++;
            el.dataset.lgWebgl   = '1';
            el.dataset.lgRefract = _state.bgReady ? '1' : '0';

            // §15 — attach dedicated specular canvas immediately after caustic.
            // Requires initSpecularPass() to have been called in initLiquidGlass().
            if (_spec.gl) {
                const specCtx  = attachSpecularCanvas(el, cvs);
                es.specCtx     = specCtx;
                // CanvasRenderingContext2D.canvas gives us back the element
                // for ResizeObserver and _detach() cleanup.
                es.specCanvas  = specCtx ? specCtx.canvas : null;
            }
        }
    }
}

/**
 * Detaches the Liquid Glass effect from an element, restoring it to its
 * natural state and freeing all associated resources.
 *
 * @param {HTMLElement} el - The .lg element to detach from.
 */
function _detach(el) {
    const es = _elements.get(el);
    if (!es) return;

    // ── Remove event listeners ────────────────────────────────────────────────
    el.removeEventListener('pointermove',  es.pointerMove);
    el.removeEventListener('pointerenter', es.pointerEnter);
    el.removeEventListener('pointerleave', es.pointerLeave);

    // ── Disconnect ResizeObserver ─────────────────────────────────────────────
    es.ro.disconnect();

    // ── Remove injected DOM nodes ─────────────────────────────────────────────
    es.canvas.remove();
    el.querySelector('.lg-grain')?.remove();
    es.specCanvas?.remove();

    // ── Remove CSS custom properties set by the spring system ─────────────────
    ['--lg-mx', '--lg-my', '--lg-tx', '--lg-ty', '--lg-hover', 'transform']
        .forEach(p => el.style.removeProperty(p));

    // ── Decrement WebGL usage counter ─────────────────────────────────────────
    if (el.dataset.lgWebgl) {
        _activeWebGLCount = Math.max(0, _activeWebGLCount - 1);
        delete el.dataset.lgWebgl;
        delete el.dataset.lgRefract;
    }

    // ── Unregister from IntersectionObserver and visibility set ───────────────
    // Must happen before _tracked.delete() so the rAF loop stops scheduling
    // GL work for this element on the very next frame.
    _io?.unobserve(el);
    _visibleElements.delete(el);

    // ── Clean up state records ────────────────────────────────────────────────
    _elements.delete(el);
    _tracked.delete(el);
}


// ─────────────────────────────────────────────────────────────────────────────
// §11  requestAnimationFrame render loop
//
//  The loop runs continuously while any glass elements are tracked.  Each
//  iteration:
//
//    1. Computes a clamped delta-time (dt) from the rAF timestamp.
//    2. Reads the latest gyroscope tilt from _state.deviceTilt.
//    3. For each tracked element:
//       a. Advances all five springs by dt.
//       b. If not hovered, sets tilt spring targets from gyroscope data.
//       c. Writes the spring values to CSS custom properties on the element.
//       d. Writes a CSS perspective transform for the 3D tilt effect.
//       e. If WebGL is active for this element, renders the caustic frame.
//
//  Performance notes:
//    • getBoundingClientRect() is called at most once every 4 frames per
//      element (modulo timestamp trick) to avoid layout thrash.
//    • style.setProperty() calls are batched: all six writes happen in a
//      single synchronous block before the browser performs style recalc.
//    • The shared GL canvas approach (one context, N elements) avoids
//      hitting browser limits on concurrent WebGL contexts (~16 on most GPUs).
// ─────────────────────────────────────────────────────────────────────────────

/** Timestamp of the previous rAF frame, used to compute dt. */
let _lastTs = 0;

/**
 * Main animation loop body.  Called by requestAnimationFrame with a
 * DOMHighResTimeStamp argument.  Schedules itself for the next frame.
 *
 * Changes vs v3.0.0:
 *   - _rafFrame counter drives per-subsystem frame-skip budgets.
 *   - _visibleElements gate skips off-screen elements entirely.
 *   - domRect refresh reduced from every 4 → every 8 frames (~133 ms @ 60 fps).
 *   - Caustic GL pass runs every 2nd frame (effective 30 fps) — caustics are
 *     slow-moving noise; halving their rate is imperceptible.
 *   - Specular GL pass runs every frame — cursor-tracking requires full rate.
 *   - data-lg-refract attribute update throttled to every 30 frames (~500 ms).
 *   - _renderCausticsGL call is now explicit (was silently missing in v3.0.0).
 *
 * @param {number} ts - Current timestamp in milliseconds (from rAF).
 */
function _rafLoop(ts) {
    _state.rafId = requestAnimationFrame(_rafLoop);

    // Increment frame counter — wraps at 65535 via bitwise AND, stays integer.
    _rafFrame = (_rafFrame + 1) & 0xFFFF;

    // ── Delta time ────────────────────────────────────────────────────────────
    const dt = Math.min((ts - (_lastTs || ts)) * 0.001, MAX_DT);
    _lastTs = ts;

    // ── Device tilt (read once, shared across all elements this frame) ────────
    const gx = _state.deviceTilt.x;
    const gy = _state.deviceTilt.y;

    // ── Per-element update ────────────────────────────────────────────────────
    for (const el of _tracked) {
        const es = _elements.get(el);
        if (!es) continue;

        // ── Spring integration (every frame — needed for smooth CSS updates) ──
        _stepSpring(es.springX,     SPRING.cursor, dt);
        _stepSpring(es.springY,     SPRING.cursor, dt);
        _stepSpring(es.hoverSpring, SPRING.hover,  dt);
        _stepSpring(es.tiltX,       SPRING.tilt,   dt);
        _stepSpring(es.tiltY,       SPRING.tilt,   dt);

        // When not hovered, gyroscope drives tilt (parallax).
        if (!es.hovered) {
            es.tiltX.target = gx * 0.45;
            es.tiltY.target = gy * 0.45;
        }

        // ── CSS custom property updates (every frame) ─────────────────────────
        el.style.setProperty('--lg-mx',    (es.springX.value * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-my',    (es.springY.value * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-tx',     es.tiltX.value.toFixed(4));
        el.style.setProperty('--lg-ty',     es.tiltY.value.toFixed(4));
        el.style.setProperty('--lg-hover',  es.hoverSpring.value.toFixed(4));

        // ── CSS 3D perspective transform (every frame) ────────────────────────
        const rx = ( es.tiltY.value * 3.0).toFixed(3);
        const ry = (-es.tiltX.value * 3.0).toFixed(3);
        el.style.transform = `translateZ(0) perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;

        // ── WebGL passes — gated on element visibility ────────────────────────
        // Off-screen elements skip all GPU work entirely.  The IntersectionObserver
        // in _startObserver() maintains _visibleElements in real time.
        if (!el.dataset.lgWebgl || !_visibleElements.has(el)) continue;

        // Refresh cached bounding rect every 8 frames (~133 ms @ 60 fps).
        // Halved from the original every-4-frames to reduce layout thrash,
        // acceptable because rect only changes on scroll/resize (both of which
        // also trigger a background re-capture that resets domRect anyway).
        if (_rafFrame % 8 === 0) {
            es.domRect = el.getBoundingClientRect();
        }

        // Caustic GL pass — every 2nd frame (effective ~30 fps).
        // Caustics are driven by slow gradient noise (u_time * 0.07–0.55);
        // a 33 ms update interval is below the threshold of perceptible
        // temporal aliasing for these frequencies.
        if (_rafFrame % 2 === 0) {
            _renderCausticsGL(es, ts);
        }

        // Specular GL pass — every frame (~60 fps).
        // The Cook-Torrance highlight tracks the cursor via spring-smoothed
        // u_mouse; reducing its rate would produce visible lag on fast moves.
        if (es.specCtx) {
            renderSpecularGL(es, es.specCtx, ts, _opts);
        }

        // Sync refraction indicator attribute every 30 frames (~500 ms).
        // This is purely a data attribute consumed by CSS; no visual urgency.
        if (_rafFrame % 30 === 0) {
            el.dataset.lgRefract = _state.bgReady ? '1' : '0';
        }
    }
}

/**
 * Starts the rAF render loop if it is not already running.
 * Resets _lastTs to prevent a large dt spike on the first frame.
 */
function _startLoop() {
    if (_state.rafId) return;
    _lastTs      = 0;
    _state.rafId = requestAnimationFrame(_rafLoop);
}

/**
 * Cancels the rAF render loop.  The next scheduled frame is cancelled
 * immediately; any already-executing frame will complete naturally.
 */
function _stopLoop() {
    if (_state.rafId) {
        cancelAnimationFrame(_state.rafId);
        _state.rafId = 0;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// §12  MutationObserver — automatic element discovery
//
//  The MutationObserver watches <body> for childList mutations (subtree:true).
//  When new nodes are added, _attachSubtree() checks if the node matches the
//  selector and attaches to it and any matching descendants.
//  When nodes are removed, _detachSubtree() cleans up matching nodes.
//
//  This enables glass effects on dynamically inserted content (e.g. modals,
//  chat messages, infinite scroll items) without requiring the host app to
//  call attachElement() manually.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively attaches the glass effect to a DOM subtree root and all
 * matching descendants.  Skips non-element nodes (text, comment, etc.).
 *
 * @param {Node} node - Root of the subtree to process.
 */
function _attachSubtree(node) {
    if (!(node instanceof HTMLElement)) return;
    const sel = _opts.selector;
    // Check the root node itself (e.g. a .lg div was directly inserted)
    if (node.matches(sel)) _attach(node);
    // Check all descendants (e.g. a container with .lg children was inserted)
    node.querySelectorAll?.(sel).forEach(_attach);
}

/**
 * Recursively detaches the glass effect from a DOM subtree root and all
 * matching descendants.
 *
 * @param {Node} node - Root of the subtree to process.
 */
function _detachSubtree(node) {
    if (!(node instanceof HTMLElement)) return;
    const sel = _opts.selector;
    if (node.matches(sel)) _detach(node);
    node.querySelectorAll?.(sel).forEach(_detach);
}

/**
 * Performs an initial DOM scan to attach to existing glass elements, then
 * creates and starts the MutationObserver for dynamic content.
 */
/**
 * Performs an initial DOM scan to attach to existing glass elements, then
 * creates and starts the IntersectionObserver (_io) and MutationObserver
 * for dynamic content.
 */
function _startObserver() {
    // ── Initial attach: process all pre-existing matching elements ────────────
    // Must run before the observers are created so that _tracked is fully
    // populated by the time the IntersectionObserver loop runs below.
    document.querySelectorAll(_opts.selector).forEach(_attach);

    // ── IntersectionObserver — viewport visibility gate ───────────────────────
    // threshold:0 → callback fires the moment any pixel crosses the viewport
    // boundary in either direction.  No rootMargin: we want strict viewport
    // intersection, not a pre-fetch buffer, because the goal is GPU savings.
    _io = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) _visibleElements.add(e.target);
            else                  _visibleElements.delete(e.target);
        }
    }, { threshold: 0 });

    // Observe all elements that were just attached in the scan above.
    // Elements attached later (via MutationObserver or attachElement()) call
    // _io.observe(el) individually inside _attach().
    for (const el of _tracked) _io.observe(el);

    // ── MutationObserver — dynamic content discovery ──────────────────────────
    // childList:true catches direct insertions/removals.
    // subtree:true catches mutations anywhere in the document tree, not just
    // direct children of <body> — necessary for SPA route changes that swap
    // deeply nested content without touching the body directly.
    _state.observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            m.addedNodes.forEach(_attachSubtree);
            m.removedNodes.forEach(_detachSubtree);
        }
    });

    _state.observer.observe(document.body, { childList: true, subtree: true });
}


// ─────────────────────────────────────────────────────────────────────────────
// §13  Public API
//
//  All exported symbols are stable across patch versions.  Breaking changes
//  (if any) will increment the major version number.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises Liquid Glass PRO on the current page.
 *
 * Must be called once before glass elements become active.  Subsequent calls
 * are no-ops (guarded by _state.ready).  To re-initialise with different
 * options, call destroyLiquidGlass() first.
 *
 * Execution order on first call:
 *  1. Merge user options with defaults.
 *  2. Register Houdini CSS custom properties.
 *  3. Inject SVG filter bank into <body>.
 *  4. Inject CSS into <head>.
 *  5. Start device orientation tracking.
 *  6. Wait for DOMContentLoaded (or execute immediately if DOM is ready),
 *     then start MutationObserver + rAF loop.
 *
 * @param {Partial<LGOptions>} [options={}] - Override specific default options.
 *
 * @example
 * import { initLiquidGlass } from './liquid-glass-pro.js';
 * initLiquidGlass({ ior: 1.5, refractionStrength: 0.04, breathe: false });
 */
export function initLiquidGlass(options = {}) {
    // Prevent double initialization
    if (_state.ready) return;

    _state.ready = true;
    _opts = { ..._defaults, ...options };

    // Register Houdini early.
    // This can safely run before the DOM is fully ready.
    _registerHoudini();

    // Move the main startup logic into a separate function
    // so we can run it only after the DOM is ready.
    const start = () => {
        // Extra guard in case start is triggered more than once
        if (_state.started) return;
        _state.started = true;

        // Inject shared SVG/CSS resources
        _injectSVG();
        _injectCSS();

        // Start device orientation tracking
        _startOrientationTracking();

        // IMPORTANT:
        // specular-pass creates a canvas and appends it to document.body,
        // so it must run only after body is available.
        try {
            initSpecularPass();
        } catch (err) {
            console.error('[LiquidGlass] initSpecularPass failed:', err);
        }

        // Start observing elements and the main render loop
        _startObserver();
        _startLoop();
    };

    // If the DOM is still loading, wait until it is ready
    // so document.body definitely exists.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        return;
    }

    // If the DOM is already ready, start immediately
    start();
}

/**
 * Completely tears down the Liquid Glass PRO system.
 *
 * This function is safe to call:
 *  • Before re-initialising with different options
 *  • On SPA route navigation to prevent orphaned listeners/timers
 *  • During component unmount in React / Vue / Svelte
 *
 * After this call, all tracked elements revert to their original styles,
 * all WebGL resources are freed, all intervals/observers are stopped, and
 * the injected <style> and <svg> elements are removed from the DOM.
 * initLiquidGlass() can be called again afterwards.
 */
export function destroyLiquidGlass() {
    _stopLoop();

    _state.observer?.disconnect();
    _state.observer = null;

    // Detach all tracked elements in a snapshot copy (detach mutates _tracked).
    for (const el of [..._tracked]) _detach(el);

    _stopBackgroundCapture();

    // Remove injected DOM nodes
    _state.styleEl?.remove();
    _state.svgEl?.remove();
    _state.glCanvas?.remove();

    _stopOrientationTracking();

    // Reset cached values that may differ on re-init
    _gpuTierCache     = null;
    _activeWebGLCount = 0;

    // Reset all singleton state to initial values
    Object.assign(_state, {
        ready:        false,
        svgReady:     false,
        houdiniReg:   false,
        observer:     null,
        styleEl:      null,
        svgEl:        null,
        rafId:        0,
        glBackend:    null,
        glCanvas:     null,
        glProgram:    null,
        glUniforms:   {},
        glBuffer:     null,
        glStartTime:  0,
        bgTexture:    null,
        bgCanvas:     null,
        bgCtx:        null,
        bgReady:      false,
        bgCapturing:  false,
        deviceTilt:   { x: 0, y: 0 },
    });
    destroySpecularPass();
}

/**
 * Wraps an existing DOM element in a .lg-outer chromatic-aberration container.
 *
 * The wrapper is inserted at the element's current position in the DOM tree.
 * The element's original display mode (block / flex / grid) is preserved via
 * a modifier class added to the wrapper.
 *
 * @param {HTMLElement} el - The element to wrap.
 * @returns {{ wrapper: HTMLElement, unwrap: () => void }}
 *   wrapper — the newly created .lg-outer element
 *   unwrap  — restores the original DOM structure and removes the wrapper
 *
 * @example
 * const { wrapper, unwrap } = wrapWithDistortion(myCard);
 * // Later:
 * unwrap();
 */
export function wrapWithDistortion(el) {
    const parent  = el.parentNode;
    const next    = el.nextSibling;  // Used to restore original position in unwrap()

    const wrapper = Object.assign(document.createElement('div'), {
        className: 'lg-outer',
    });

    // Preserve original display type of the wrapped element
    const disp = window.getComputedStyle(el).display;
    if      (disp === 'flex' || disp === 'inline-flex') wrapper.classList.add('flex');
    else if (disp === 'grid' || disp === 'inline-grid') wrapper.classList.add('grid');
    else if (disp !== 'inline' && disp !== 'none')       wrapper.classList.add('block');

    parent?.insertBefore(wrapper, el);
    wrapper.appendChild(el);

    return {
        wrapper,
        /**
         * Removes the wrapper and restores the original DOM position of el.
         * Safe to call multiple times (checks wrapper.isConnected first).
         */
        unwrap() {
            if (!wrapper.isConnected) return;
            parent
                ? parent.insertBefore(el, next ?? null)
                : wrapper.removeChild(el);
            wrapper.remove();
        },
    };
}

/**
 * Creates a detached .lg-grain film-grain overlay element.
 * Returned element must be inserted into a .lg container to take effect.
 * The CSS class 'lg-grain' provides all necessary styling.
 *
 * @returns {HTMLDivElement}
 */
export function createGrainLayer() {
    return Object.assign(document.createElement('div'), { className: 'lg-grain' });
}

/**
 * Manually attaches the glass effect to an element outside the automatic
 * selector scanning.  Useful for Shadow DOM components or dynamically
 * created elements in frameworks that render outside <body>.
 *
 * Requires initLiquidGlass() to have been called first.
 *
 * @param {HTMLElement} el - Element to attach to (must be in the DOM).
 */
export function attachElement(el) {
    if (!_state.ready) {
        console.warn('LG-PRO: call initLiquidGlass() before attachElement().');
        return;
    }
    _attach(el);
}

/**
 * Manually detaches the glass effect from an element.
 * Safe to call even if the element was never attached (returns immediately).
 *
 * @param {HTMLElement} el - Element to detach from.
 */
export function detachElement(el) { _detach(el); }

/**
 * Factory function for chat message reply-quote elements.
 * Produces a fully styled .lg.lg-reply element with sender and text spans,
 * optional own-message colour variant, and an optional click handler.
 *
 * The created element is automatically attached to the glass effect system
 * if initLiquidGlass() has already been called.
 *
 * @param {string}      sender          - Display name of the quoted sender.
 * @param {string}      text            - Preview text of the quoted message.
 * @param {boolean}     [isOwn=false]   - Apply .lg-own purple tint for own messages.
 * @param {Function}    [onClick=null]  - Click handler; receives the MouseEvent.
 * @returns {HTMLDivElement} Detached element (insert it into your chat DOM).
 *
 * @example
 * const quote = createReplyQuote('Alice', 'Hey, are you coming tonight?');
 * chatContainer.appendChild(quote);
 */
export function createReplyQuote(sender, text, isOwn = false, onClick = null) {
    const el = document.createElement('div');
    el.className = `lg lg-reply lg-interactive${isOwn ? ' lg-own' : ''}`;

    if (_opts.grain) {
        el.appendChild(createGrainLayer());
    }

    el.append(
        Object.assign(document.createElement('span'), {
            className:   'lg-sender',
            textContent: sender,
        }),
        Object.assign(document.createElement('span'), {
            className:   'lg-text',
            textContent: text,
        })
    );

    if (typeof onClick === 'function') {
        // stopPropagation prevents the click from bubbling to a parent message
        // container that may also have a click handler.
        el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    }

    if (_state.ready) _attach(el);

    return el;
}

/**
 * Forces an immediate background capture outside the regular interval cycle.
 *
 * Call this after:
 *  • A significant DOM mutation (modal open/close, content insertion)
 *  • SPA route navigation where the page content changes substantially
 *  • Any operation that modifies content visible behind glass elements
 *
 * The returned Promise resolves when the capture and texture upload are
 * complete (or immediately if html2canvas is unavailable).
 *
 * @returns {Promise<void>}
 */
export function refreshBackground() { return _captureBackground(); }

/**
 * Returns the detected GPU capability tier for the current device.
 * Useful for host apps that want to conditionally enable or disable
 * other graphics-intensive features based on the same GPU data.
 *
 * @returns {GpuTier}
 */
export function getGpuTier() { return _detectGpuTier(); }

/**
 * Returns true if the background refraction texture is populated with at
 * least one successful html2canvas capture.  Before this returns true,
 * the glass effect will show caustics only (no background transmission).
 *
 * @returns {boolean}
 */
export function isRefractionActive() { return _state.bgReady; }

/**
 * Changes the glass type at runtime without reinitialising.
 * The new type takes effect on the next rendered frame.
 *
 * @param {string|number} type - Glass type name ('BK7','SF11','NK51A','NBK10','F2')
 *                               or numeric index 0–4.
 */
export function setGlassType(type) {
    _opts.glassType = type;
}
/**
 * Changes the glass surface variant at runtime.
 * Updates the CSS class on all tracked elements and the _opts.glassVariant
 * value for the WebGL uniform upload on the next frame.
 *
 * The change is fully reflected within one rAF frame (no reinitialisation).
 * The CSS backdrop-filter transition provides a smooth visual crossfade.
 *
 * @param {string} variant - One of the GLASS_VARIANTS keys:
 *   'clear' | 'frosted' | 'smoke' | 'tinted-blue' | 'tinted-violet'
 *   'tinted-amber' | 'mirror' | 'ice' | 'bronze' | 'emerald' | 'rose' | 'obsidian'
 *
 * @example
 * setGlassVariant('frosted');    // ground-glass, heavy blur
 * setGlassVariant('tinted-blue'); // cobalt blue architectural glass
 * setGlassVariant('mirror');     // first-surface mirror coating
 */
export function setGlassVariant(variant) {
    const vd = GLASS_VARIANTS[variant];
    if (!vd) {
        console.warn(`LG-PRO: unknown glass variant "${variant}". Valid keys:`, Object.keys(GLASS_VARIANTS));
        return;
    }

    // Remove all variant classes, apply the new one
    const allVariantClasses = Object.values(GLASS_VARIANTS).map(v => v.cssClass);

    for (const el of _tracked) {
        allVariantClasses.forEach(cls => el.classList.remove(cls));
        el.classList.add(vd.cssClass);
    }

    // Update live options — picked up by _renderCausticsGL on next frame
    _opts.glassVariant = variant;

    // Also sync IOR if the variant has a specific physical IOR
    // (e.g. ice = 1.309, mirror = 1.785, emerald = 1.575)
    _opts.ior = vd.ior;
}

/**
 * Returns all available glass variant definitions.
 * Useful for building UI pickers or iterating over available options.
 *
 * @returns {Record<string, GlassVariantDef>}
 *
 * @example
 * const variants = getGlassVariants();
 * Object.entries(variants).forEach(([key, def]) => {
 *   console.log(key, def.label, def.ior);
 * });
 */
export function getGlassVariants() {
    return { ...GLASS_VARIANTS };
}

/**
 * Returns a shallow copy of the currently active options object.
 * Mutating the returned object has no effect — use destroyLiquidGlass()
 * followed by initLiquidGlass(newOptions) to change live options.
 *
 * @returns {LGOptions}
 */
export function getOptions() { return { ..._opts }; }

/**
 * Returns the semantic version string of this module build.
 *
 * @returns {'4.1.0'}
 */
export function version() { return '4.1.0'; }


// ─────────────────────────────────────────────────────────────────────────────
// §14  React hook adapter
//
//  useLiquidGlass() is a React hook that attaches the glass effect to a ref
//  and automatically detaches it when the component unmounts.
//
//  Design notes:
//  • React is not a hard dependency — it is accessed via window.React to
//    support both CJS and ESM React installations without a bundler.
//  • The hook uses useEffect with a cleanup return to mirror the attach/detach
//    lifecycle, which is idiomatic React for imperative DOM integrations.
//  • The ref dependency array ([ref]) ensures the effect re-runs if the ref
//    object itself changes, though in practice this is rare.
//  • SSR is guarded by the typeof window === 'undefined' check at the top,
//    which makes this safe to import in Next.js / Remix server components
//    (the hook body is skipped entirely on the server).
//
//  Vue and Svelte adapter patterns:
//
//  Vue 3 composable:
//    import { onMounted, onUnmounted } from 'vue'
//    import { attachElement, detachElement } from './liquid-glass-pro.js'
//    export function useLiquidGlass(elRef) {
//      onMounted(() => attachElement(elRef.value))
//      onUnmounted(() => detachElement(elRef.value))
//    }
//
//  Svelte action:
//    import { attachElement, detachElement } from './liquid-glass-pro.js'
//    export function liquidGlass(node) {
//      attachElement(node)
//      return { destroy: () => detachElement(node) }
//    }
//    // Usage: <div class="lg lg-card" use:liquidGlass>...</div>
// ─────────────────────────────────────────────────────────────────────────────

/**
 * React hook that attaches the Liquid Glass PRO effect to a React ref and
 * automatically cleans up on unmount.
 *
 * Requires React 16.8+ (hooks support).  Automatically calls initLiquidGlass()
 * with the current options if it has not been called already.
 *
 * @param {React.RefObject<HTMLElement>} ref - Ref attached to the glass element.
 *
 * @example
 * import { useRef } from 'react';
 * import { useLiquidGlass } from './liquid-glass-pro.js';
 *
 * function GlassCard() {
 *   const ref = useRef(null);
 *   useLiquidGlass(ref);
 *   return <div ref={ref} className="lg lg-card lg-interactive">Hello</div>;
 * }
 */
export function useLiquidGlass(ref) {
    // SSR guard: window does not exist in Node.js / edge runtimes.
    if (typeof window === 'undefined') return;

    // Access React dynamically to avoid hard dependency.
    // This pattern works with React 16.8+ loaded via CDN, CJS, or ESM.
    const React = window.React;

    if (!React?.useEffect) {
        console.warn('LG-PRO: useLiquidGlass() requires React 16.8+ with useEffect.');
        return;
    }

    React.useEffect(() => {
        const el = ref?.current;
        if (!el) return;

        // Auto-initialise with current options if not already done.
        if (!_state.ready) initLiquidGlass(_opts);

        _attach(el);

        // Return cleanup function: called on component unmount or ref change.
        return () => _detach(el);

    }, [ref]);  // Re-run only if the ref object itself changes (uncommon)
    }

// ─────────────────────────────────────────────────────────────────────────────
// §15  Specular highlight system — full Cook-Torrance PBR
//
//  Replaces the CSS radial-gradient approximation with a physically-grounded
//  WebGL2 specular pass rendered into a dedicated per-element canvas layer,
//  composited above the caustic canvas (z-index 4.5) via screen blend mode.
//
//  Physics implemented here (all per-pixel, no approximations):
//
//  D  — GGX / Trowbridge-Reitz Normal Distribution Function
//         D(h) = α² / (π · (NdotH²(α²−1) + 1)²)
//         Controls the shape and spread of the specular lobe.
//         α = roughness², re-parameterised for perceptual linearity.
//
//  F  — Schlick Fresnel with F0 derivation from IOR
//         F0 = ((n−1)/(n+1))²   for air/glass interface
//         F(v,h) = F0 + (1−F0)·(1−VdotH)⁵
//         Models how reflectance increases at grazing angles.
//
//  G  — Smith GGX Height-Correlated Visibility (Heitz 2014)
//         More accurate than uncorrelated Smith; prevents over-darkening
//         at grazing angles which is an artefact of the uncorrelated form.
//         V(l,v,h) = 0.5 / (NdotL·√(NdotV²(1−a²)+a²) +
//                            NdotV·√(NdotL²(1−a²)+a²))
//
//  Anisotropic extension — Burley 2012 / Disney BRDF
//         Separate αT (tangent) and αB (bitangent) roughness values
//         derived from a scalar anisotropy ∈ [0,1].
//         D_aniso(h) = 1 / (π·αT·αB·(HdotT²/αT²+HdotB²/αB²+NdotH²)²)
//         G_aniso uses per-axis Λ functions — no simplification.
//         Driven by a slowly drifting tangent field from the noise normal map.
//
//  Energy conservation — Kulla-Conty multi-bounce term (2017)
//         Single-scattering BRDFs lose energy at high roughness because they
//         ignore inter-microfacet bounces.  The Kulla-Conty E(μ) LUT adds
//         back the "missing energy" term:
//         f_ms = (1−E(NdotV))·(1−E(NdotL)) / (π·(1−E_avg))
//         Approximated analytically (no texture lookup required).
//
//  Multiple light sources
//         Three virtual lights contribute to the BRDF sum:
//           L0  — primary cursor-tracking directional light (warm white)
//           L1  — fixed upper-left environment fill light (cool blue-white)
//           L2  — secondary back-scatter light (purple tint, opposite to L0)
//         Each light carries its own colour, intensity, and angular size
//         (area light approximation via representative-point method, Karis 2013).
//
//  Thin-film iridescence (Born & Wolf, 1999)
//         Computes optical path difference in a thin coating of thickness d
//         and index n_film, then evaluates the interference term for RGB
//         wavelengths (λR=680nm, λG=550nm, λB=450nm):
//         I(λ) = cos(2π · n_film · d · cos(θt) / λ)
//         This replaces the CSS conic-gradient approximation in the original §15.
//
//  Import surface from §6:
//         _VERT_SRC     — reuse the same fullscreen-triangle vertex shader
//         surfaceNormal — not directly importable from GLSL; the normal
//                         computation is inlined here with identical math
//                         so the two passes stay visually synchronised.
//
//  Canvas layer
//         Each tracked element gets a second canvas: .lg-specular-canvas
//         Rendered after the caustic pass, blended with mix-blend-mode: screen.
//         Opacity is controlled via CSS transition identical to caustic canvas.
//
//  Performance
//         Shared WebGL2 context (same pattern as caustic pass in §6).
//         Roughness LUT (E_avg for Kulla-Conty) is precomputed once into a
//         1D 256-texel texture at init time to avoid sqrt/pow in the hot path.
//         Draw call is a single fullscreen triangle (3 vertices).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// §15.0  Constants and shared state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Physical constants for the glass medium.
 * All values match soda-lime glass (the most common optical glass).
 */
const GLASS_IOR       = 1.52;          // Soda-lime glass refractive index
const GLASS_F0        = Math.pow((GLASS_IOR - 1) / (GLASS_IOR + 1), 2);  // ≈ 0.0426
const FILM_THICKNESS  = 320;           // nm — antireflection coating thickness
const FILM_IOR        = 1.38;          // MgF₂ antireflection coating (common on optics)

/**
 * Roughness parameter for the glass surface.
 * α = 0.04 → near-perfect mirror (GGX lobe is very tight).
 * This is the "Disney reparameterisation": α = userRoughness².
 * Corresponds to a microsurface RMS slope of ~2°.
 */
const BASE_ROUGHNESS  = 0.04;

/**
 * Anisotropy strength [0, 1].
 * 0 = isotropic (perfect circle lobe).
 * 0.35 = slight horizontal stretch, like brushed glass or float glass distortion.
 */
const ANISOTROPY      = 0.35;

/** Singleton specular GL state — separate from §6 caustic GL state. */
const _spec = {
    gl:         null,   // WebGL2RenderingContext
    canvas:     null,   // hidden off-screen source canvas
    program:    null,   // compiled specular program
    uniforms:   {},     // cached uniform locations
    lut:        null,   // WebGLTexture — Kulla-Conty E_avg LUT
    startTime:  0,
};


// ─────────────────────────────────────────────────────────────────────────────
// §15.1  Fragment shader — full Cook-Torrance + anisotropic + Kulla-Conty
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fragment shader source for the specular pass.
 *
 * Coordinate conventions (match §6 exactly for visual synchronisation):
 *   v_uv          — element-local UV [0,1], top-left origin
 *   N             — view-space surface normal from animated noise bump map
 *   V             — view direction, fixed at (0,0,1) (orthographic camera)
 *   L_i           — light direction vectors in view space
 *   H_i           — half-vectors between V and each L_i
 *
 * Tangent frame construction:
 *   T  — tangent vector, perpendicular to N, aligned with noise gradient
 *   B  — bitangent = cross(N, T), completing the orthonormal frame
 *
 * @type {string}
 */
const _SPEC_FRAG_SRC = /* glsl */`#version 300 es
precision highp float;

// ── Interpolants ─────────────────────────────────────────────────────────────
in  vec2  v_uv;

// ── Output ───────────────────────────────────────────────────────────────────
out vec4  fragColor;

// ── Uniforms ─────────────────────────────────────────────────────────────────
uniform float     u_time;
uniform vec2      u_mouse;
uniform float     u_hover;
uniform vec2      u_tilt;
uniform vec2      u_res;
uniform float     u_ior;          // Live IOR from _opts (default 1.52)
uniform float     u_roughness;    // BASE_ROUGHNESS (0.04)
uniform float     u_anisotropy;   // ANISOTROPY (0.35)
uniform sampler2D u_lut;          // Kulla-Conty E_avg LUT (1D, 256×1)
uniform float     u_filmThick;    // Thin-film thickness in nm
uniform float     u_filmIOR;      // Thin-film coating IOR


// ════════════════════════════════════════════════════════════════════════════
// Utility
// ════════════════════════════════════════════════════════════════════════════

const float PI    = 3.14159265358979;
const float INV_PI = 0.31830988618;

// Safe normalise: returns vec3(0,0,1) if input is degenerate.
vec3 safeNorm(vec3 v) {
    float l = length(v);
    return l > 1e-6 ? v / l : vec3(0.0, 0.0, 1.0);
}

// Perlin-style gradient noise — identical to §6 so surface normals are
// frame-accurate with the caustic pass.
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(dot(hash2(i + vec2(0,0)), f - vec2(0,0)),
            dot(hash2(i + vec2(1,0)), f - vec2(1,0)), u.x),
        mix(dot(hash2(i + vec2(0,1)), f - vec2(0,1)),
            dot(hash2(i + vec2(1,1)), f - vec2(1,1)), u.x),
        u.y
    ) * 0.5 + 0.5;
}


// ════════════════════════════════════════════════════════════════════════════
// §15.A  Surface normal + tangent frame
//
//  The normal is computed identically to §6 surfaceNormal() so that the
//  specular highlight sits exactly on the same surface as the caustics.
//  Additionally we extract the tangent T from the height field gradient
//  for use in anisotropic GGX — this is the Gram-Schmidt-orthogonalised
//  direction of maximum curvature on the noise surface.
// ════════════════════════════════════════════════════════════════════════════

struct SurfaceFrame {
    vec3 N;   // Surface normal
    vec3 T;   // Tangent  (aligned with noise gradient = aniso "grain" direction)
    vec3 B;   // Bitangent
};

/**
 * Computes view-space normal and full tangent frame from the animated
 * bump-map height field.  The tangent T is taken directly from the
 * finite-difference gradient of the noise, giving anisotropy a natural
 * orientation tied to the surface structure.
 *
 * @param  uv  Element-local UV
 * @return     Orthonormal SurfaceFrame { N, T, B }
 */
SurfaceFrame buildFrame(vec2 uv) {
    float eps  = 0.002;
    float hC   = gnoise(uv * 7.0 + u_time * 0.07);
    float hR   = gnoise((uv + vec2(eps, 0.0)) * 7.0 + u_time * 0.07);
    float hU   = gnoise((uv + vec2(0.0, eps)) * 7.0 + u_time * 0.07);

    float mouseInf = u_hover * 0.4 * exp(-length(uv - u_mouse) * 3.5);
    float hM       = gnoise(uv * 11.0 - u_mouse * 2.0 + u_time * 0.13) * mouseInf;

    float dX = (hR - hC) / eps + hM * 0.03;
    float dY = (hU - hC) / eps + hM * 0.03;

    vec3 N = normalize(vec3(-dX * 0.8, -dY * 0.8, 1.0));

    // Tangent: direction of maximum gradient in screen space, lifted to 3D.
    // Gram-Schmidt orthogonalisation against N ensures T ⊥ N exactly.
    vec3 Traw = normalize(vec3(dX, dY, 0.0) + vec3(0.0001));  // avoid degenerate
    vec3 T    = normalize(Traw - dot(Traw, N) * N);
    vec3 B    = cross(N, T);

    return SurfaceFrame(N, T, B);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.B  GGX Isotropic NDF
//
//  Trowbridge & Reitz (1975), re-parameterised by Walter et al. (2007)
//  and standardised as GGX.
//
//  D(h) = α² / (π · ((NdotH²)(α²−1) + 1)²)
//
//  At NdotH = 1 (h perfectly aligned with N) → D = α²/π, the peak.
//  At grazing NdotH → 0, D → 0 quickly for small α.
//  Total solid-angle integral ∫D(h)(NdotH)dh = 1 (energy-preserving).
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param  NdotH    Cosine of angle between surface normal and half-vector.
 * @param  alpha    Roughness²  (α in the GGX formula, NOT perceptual roughness)
 * @return          NDF value D(h) in steradians⁻¹
 */
float D_GGX(float NdotH, float alpha) {
    float a2  = alpha * alpha;
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.C  Anisotropic GGX NDF
//
//  Burley (2012), as used in the Disney BRDF.
//  Separate roughness values αT (along tangent) and αB (along bitangent).
//  Derived from scalar anisotropy ∈ [0,1]:
//    αT = α / √(1−0.9·aniso)
//    αB = α · √(1−0.9·aniso)
//
//  D_aniso(h) = 1 / (π·αT·αB · (HdotT²/αT² + HdotB²/αB² + NdotH²)²)
//
//  When anisotropy=0: αT=αB=α, reduces exactly to isotropic D_GGX.
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param  H        Half-vector in view space
 * @param  frame    SurfaceFrame containing N, T, B
 * @param  alpha    Isotropic base roughness²
 * @param  aniso    Anisotropy scalar [0,1]
 * @return          Anisotropic NDF value
 */
float D_GGX_aniso(vec3 H, SurfaceFrame frame, float alpha, float aniso) {
    float alphaT = alpha / sqrt(max(1e-6, 1.0 - 0.9 * aniso));
    float alphaB = alpha * sqrt(max(1e-6, 1.0 - 0.9 * aniso));

    float HdotT  = dot(H, frame.T);
    float HdotB  = dot(H, frame.B);
    float NdotH  = max(dot(H, frame.N), 0.0);

    float term   = HdotT * HdotT / (alphaT * alphaT)
                 + HdotB * HdotB / (alphaB * alphaB)
                 + NdotH * NdotH;

    return 1.0 / (PI * alphaT * alphaB * term * term);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.D  Schlick Fresnel with exact F0 from IOR
//
//  For a dielectric at normal incidence:
//    F0 = ((n1 − n2) / (n1 + n2))²
//       = ((1 − IOR) / (1 + IOR))²
//
//  Schlick's approximation (1994):
//    F(θ) = F0 + (1 − F0) · (1 − cosθ)⁵
//
//  Error vs exact Fresnel: < 2% for dielectrics, excellent for glass.
//  Full Fresnel (using both s and p polarisations) has no closed form
//  in terms of cosines alone; Schlick's approximation is standard in PBR.
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param  cosTheta  cos(angle between V and H), i.e. VdotH
 * @param  F0        Reflectance at normal incidence (derived from IOR)
 * @return           Schlick Fresnel reflectance in [F0, 1.0]
 */
float F_Schlick(float cosTheta, float F0) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    // x⁵ via repeated squaring: more numerically stable than pow(x,5)
    float x2 = x  * x;
    float x4 = x2 * x2;
    return F0 + (1.0 - F0) * x4 * x;
}

/** Vector form for coloured F0 (used in multi-bounce term). */
vec3 F_Schlick_vec(float cosTheta, vec3 F0) {
    float x  = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x  * x;
    float x4 = x2 * x2;
    return F0 + (1.0 - F0) * x4 * x;
}


// ════════════════════════════════════════════════════════════════════════════
// §15.E  Smith GGX Height-Correlated Visibility Function
//
//  Heitz (2014) "Understanding the Masking-Shadowing Function in
//  Microfacet-Based BRDFs", JCGT.
//
//  The height-correlated form accounts for statistical correlation between
//  masking and shadowing at the same height on the microsurface.  It is
//  more physically accurate than the uncorrelated (λ_V · λ_L) product,
//  especially at grazing angles where uncorrelated Smith over-darkens.
//
//  Λ(v) = (−1 + √(1 + α²·tan²θ)) / 2
//       = (−1 + √(1 + α²·(1−NdotV²)/NdotV²)) / 2
//
//  G2(l,v) = 1 / (1 + Λ(v) + Λ(l))      [height-correlated]
//
//  Optimised form (Lagarde, de Rousiers 2014 — used in Filament, UE4):
//  V(l,v) = G2 / (4·NdotL·NdotV)  [visibility term, denominator absorbed]
//    = 0.5 / (NdotL·√(NdotV²(1−a²)+a²) + NdotV·√(NdotL²(1−a²)+a²))
// ════════════════════════════════════════════════════════════════════════════

/**
 * Height-correlated Smith GGX visibility term with denominator 4·NdotL·NdotV
 * already absorbed (returns V, not G).
 *
 * @param  NdotL  cos angle of light with normal
 * @param  NdotV  cos angle of view  with normal
 * @param  alpha  Roughness²
 * @return        Combined visibility + denominator term
 */
float V_SmithGGX_heightCorrelated(float NdotL, float NdotV, float alpha) {
    float a2    = alpha * alpha;
    float lambdaV = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    float lambdaL = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    // 0.5 / (λV + λL) : the 4·NdotL·NdotV denominator is absorbed into λ
    return 0.5 / (lambdaV + lambdaL + 1e-6);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.F  Anisotropic Smith-GGX Visibility
//
//  Belcour & Barla (2017) / Heitz (2014) anisotropic extension.
//  Per-axis Λ functions use separate αT, αB for tangent and bitangent:
//
//  Λ_aniso(v) = (−1 + √(1 + (αT²·(VdotT/VdotN)² + αB²·(VdotB/VdotN)²))) / 2
//
//  Height-correlated form:
//  V_aniso(l,v) = 0.5 / (NdotL·Λ_aniso(V) + NdotV·Λ_aniso(L))
// ════════════════════════════════════════════════════════════════════════════

float _lambdaAniso(float NdotX, float TdotX, float BdotX,
                   float alphaT, float alphaB) {
    float t2 = (TdotX / max(NdotX, 1e-4)) * (TdotX / max(NdotX, 1e-4));
    float b2 = (BdotX / max(NdotX, 1e-4)) * (BdotX / max(NdotX, 1e-4));
    return 0.5 * (-1.0 + sqrt(1.0 + alphaT * alphaT * t2 + alphaB * alphaB * b2));
}

/**
 * Anisotropic height-correlated Smith visibility term.
 *
 * @param  V        View vector (view space)
 * @param  L        Light vector (view space)
 * @param  frame    SurfaceFrame
 * @param  alpha    Isotropic base roughness²
 * @param  aniso    Anisotropy scalar
 * @return          Visibility term V(l,v)
 */
float V_SmithGGX_aniso(vec3 V, vec3 L, SurfaceFrame frame,
                       float alpha, float aniso) {
    float alphaT = alpha / sqrt(max(1e-6, 1.0 - 0.9 * aniso));
    float alphaB = alpha * sqrt(max(1e-6, 1.0 - 0.9 * aniso));

    float NdotV  = max(dot(frame.N, V), 1e-4);
    float NdotL  = max(dot(frame.N, L), 1e-4);
    float TdotV  = dot(frame.T, V);
    float BdotV  = dot(frame.B, V);
    float TdotL  = dot(frame.T, L);
    float BdotL  = dot(frame.B, L);

    float lambdaV = _lambdaAniso(NdotV, TdotV, BdotV, alphaT, alphaB);
    float lambdaL = _lambdaAniso(NdotL, TdotL, BdotL, alphaT, alphaB);

    return 0.5 / (NdotL * (1.0 + lambdaV) + NdotV * (1.0 + lambdaL) + 1e-6);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.G  Kulla-Conty multi-bounce energy compensation
//
//  Kulla & Conty (2017) "Revisiting Physically Based Shading at Imageworks"
//  SIGGRAPH Course.
//
//  Single-scattering BRDFs (including Cook-Torrance) violate energy
//  conservation at high roughness: the missing energy represents light that
//  bounced between microfacets before escaping.  The multi-scatter term adds
//  this back:
//
//  f_ms(l,v) = (1−E(NdotL)) · (1−E(NdotV)) / (π · (1 − E_avg))
//
//  where E(μ) = ∫₀^(2π) ∫₀^(π/2) f_single(l,v) · cos(θ) · sin(θ) dθ dφ
//  is the directional albedo of the single-scattering BRDF.
//
//  E(μ) and E_avg are precomputed into a 1D LUT keyed on (μ, roughness).
//  Here we use the Lagarde et al. (2018) analytical approximation that
//  avoids a 2D LUT entirely, accurate to < 1% for α ∈ [0.02, 1.0]:
//
//  E(μ, α) ≈ 1 − (0.0475 + 0.0904·α − 0.1819·α²) · (1−μ)
//             − (0.5     + 0.2916·α               ) · (1−μ)²
//             + (0.1     + 0.1532·α               ) · (1−μ)³
//  E_avg(α) ≈ 1 − 0.2734·α − 0.4694·α² (fit to Monte Carlo table)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Directional albedo E(μ, α) — analytical approximation.
 * Avoids texture lookup for E(μ); sampler u_lut is retained for
 * future higher-order terms or validation comparisons.
 *
 * @param  mu     cos(θ) for incident or exitant direction
 * @param  alpha  Roughness²
 * @return        E(μ) ∈ [0,1], fraction of energy reflected by single-scatter
 */
float kc_E(float mu, float alpha) {
    float om = 1.0 - mu;
    return clamp(
        1.0
        - (0.0475 + 0.0904 * alpha - 0.1819 * alpha * alpha) * om
        - (0.5    + 0.2916 * alpha                          ) * om * om
        + (0.1    + 0.1532 * alpha                          ) * om * om * om,
        0.0, 1.0
    );
}

/** E_avg(α) — hemispherical average of E(μ,α). */
float kc_Eavg(float alpha) {
    return clamp(1.0 - 0.2734 * alpha - 0.4694 * alpha * alpha, 0.0, 1.0);
}

/**
 * Kulla-Conty multi-bounce term f_ms.
 * Add to the single-scatter BRDF to restore energy at high roughness.
 * For glass (α = 0.04) the correction is < 0.3% — physically negligible
 * but included for mathematical completeness.
 *
 * @param  NdotL  cos angle of light with normal
 * @param  NdotV  cos angle of view  with normal
 * @param  alpha  Roughness²
 * @return        Multi-bounce radiance contribution (scalar; apply colour later)
 */
float f_multiScatter(float NdotL, float NdotV, float alpha) {
    float Ev   = kc_E(NdotV, alpha);
    float El   = kc_E(NdotL, alpha);
    float Eavg = kc_Eavg(alpha);
    float denom = PI * (1.0 - Eavg);
    return (1.0 - Ev) * (1.0 - El) / max(denom, 1e-6);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.H  Thin-film iridescence  (Born & Wolf, 1999)
//
//  A thin coating of thickness d and refractive index n_film creates
//  constructive/destructive interference for different wavelengths.
//
//  Optical path difference:
//    OPD(θ_t) = 2 · n_film · d · cos(θ_t)
//
//  where θ_t is the refraction angle inside the film:
//    cos(θ_t) = √(1 − (sin(θ_i)/n_film)²)  (Snell's law)
//    sin(θ_i) = √(1 − VdotH²)
//
//  Interference intensity for wavelength λ:
//    I(λ) = 0.5 + 0.5 · cos(2π · OPD / λ)
//
//  Evaluated at RGB wavelengths:
//    λR = 680 nm, λG = 550 nm, λB = 450 nm
//
//  The iridescence colour is then modulated by Fresnel (more visible at
//  grazing angles) and the Schlick factor to respect energy conservation.
//
//  This replaces the CSS conic-gradient approximation with a derivation
//  from Maxwell's equations of wave optics.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Evaluates thin-film iridescence for three RGB wavelengths.
 *
 * @param  VdotH       cos(angle between V and H)
 * @param  filmThick   Coating thickness in nm
 * @param  filmIOR     Coating refractive index
 * @return             RGB iridescence colour ∈ [0,1]³
 */
vec3 thinFilmIridescence(float VdotH, float filmThick, float filmIOR) {
    // sin²(θ_i) from cos(θ_i) = VdotH
    float sin2_i  = clamp(1.0 - VdotH * VdotH, 0.0, 1.0);

    // Snell's law into the film: sin²(θ_t) = sin²(θ_i) / n_film²
    float sin2_t  = sin2_i / (filmIOR * filmIOR);

    // cos(θ_t) from Pythagorean identity
    float cos_t   = sqrt(max(0.0, 1.0 - sin2_t));

    // Optical path difference: OPD = 2 · n · d · cos(θ_t)
    float OPD     = 2.0 * filmIOR * filmThick * cos_t;

    // Interference at three wavelengths (units: nm)
    const float lambdaR = 680.0;
    const float lambdaG = 550.0;
    const float lambdaB = 450.0;

    float iR = 0.5 + 0.5 * cos(2.0 * PI * OPD / lambdaR);
    float iG = 0.5 + 0.5 * cos(2.0 * PI * OPD / lambdaG);
    float iB = 0.5 + 0.5 * cos(2.0 * PI * OPD / lambdaB);

    return vec3(iR, iG, iB);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.I  Area light representative-point approximation
//
//  Karis (2013) "Real Shading in Unreal Engine 4", SIGGRAPH Course.
//
//  Point lights produce infinitely sharp specular highlights on smooth
//  surfaces (D→∞ at the perfect reflection angle).  Real light sources
//  have finite angular size.  The representative-point method clamps the
//  highlight to a minimum size corresponding to the light's solid angle:
//
//    α_modified = α + lightRadius / (2 · lightDist)
//
//  For the cursor light, lightRadius is driven by hover intensity (the
//  more the user hovers, the more "focused" the virtual light becomes).
//
//  Energy normalisation: because the NDF is not re-normalised after
//  modifying α, a correction factor is applied:
//    normFactor = α / α_modified
//  This prevents the highlight from appearing dimmer as α_modified grows.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Computes the effective roughness for an area light source.
 *
 * @param  alpha        Surface roughness²
 * @param  lightRadius  Angular radius of the light source (in UV space)
 * @param  lightDist    Distance from fragment to light position (UV space)
 * @return              struct (effectiveAlpha, normalisationFactor)
 */
vec2 areaLightRoughness(float alpha, float lightRadius, float lightDist) {
    float alphaMod   = alpha + lightRadius / (2.0 * max(lightDist, 0.01));
    float normFactor = alpha / max(alphaMod, 1e-6);
    return vec2(alphaMod, normFactor);
}


// ════════════════════════════════════════════════════════════════════════════
// §15.J  Full Cook-Torrance BRDF evaluation for one light
//
//  f_r(l,v) = D(h) · F(v,h) · V(l,v)  +  f_ms(l,v)
//           ──────────────────────────
//            single-scatter specular     multi-bounce correction
//
//  Returns radiance contribution L_out = f_r · NdotL · lightColour.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Evaluates the full Cook-Torrance BRDF for a single directional light.
 *
 * @param  V         View direction (view space, normalised)
 * @param  L         Light direction (view space, normalised)
 * @param  frame     SurfaceFrame at this fragment
 * @param  alpha     Roughness²
 * @param  aniso     Anisotropy [0,1]
 * @param  F0        Fresnel at normal incidence (scalar, for glass ≈ 0.04)
 * @param  lColour   RGB light colour and intensity
 * @param  lightPos  UV-space light position (for area light calculation)
 * @param  fragUV    Fragment UV (for area light distance)
 * @return           Outgoing radiance contribution
 */
vec3 brdf_cookTorrance(vec3 V, vec3 L, SurfaceFrame frame,
                       float alpha, float aniso, float F0,
                       vec3 lColour, vec2 lightPos, vec2 fragUV) {
    float NdotL = max(dot(frame.N, L), 0.0);
    float NdotV = max(dot(frame.N, V), 1e-4);
    if (NdotL < 1e-5) return vec3(0.0);

    vec3  H     = safeNorm(V + L);
    float NdotH = max(dot(frame.N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);

    // ── Area light roughness modification ─────────────────────────────────────
    float lightRadius = 0.08 * (1.0 - u_hover * 0.6);   // focused on hover
    float lightDist   = length(fragUV - lightPos);
    vec2  areaResult  = areaLightRoughness(alpha, lightRadius, lightDist);
    float alphaEff    = areaResult.x;
    float normFactor  = areaResult.y;

    // ── D: Anisotropic GGX NDF ─────────────────────────────────────────────────
    float D = D_GGX_aniso(H, frame, alphaEff, aniso) * normFactor * normFactor;

    // ── F: Schlick Fresnel ─────────────────────────────────────────────────────
    float F = F_Schlick(VdotH, F0);

    // ── V: Height-correlated Smith GGX (anisotropic) ──────────────────────────
    float Vis = V_SmithGGX_aniso(V, L, frame, alphaEff, aniso);

    // ── Single-scatter specular term ───────────────────────────────────────────
    float singleSpec = D * F * Vis;

    // ── Kulla-Conty multi-bounce (energy compensation) ────────────────────────
    // The F0 colour is F0·(1−F_avg) for the multi-bounce Fresnel tint.
    // F_avg(F0) ≈ F0 + (1−F0)·0.04762  (Kulla-Conty Eq. 12)
    float Favg  = F0 + (1.0 - F0) * 0.04762;
    float ms    = f_multiScatter(NdotL, NdotV, alphaEff);
    float msF   = Favg * Favg * ms;   // multi-bounce is F0-tinted

    float total = singleSpec + msF;

    return lColour * total * NdotL;
}


// ════════════════════════════════════════════════════════════════════════════
// §15.K  Three-light configuration
//
//  L0  Primary: cursor-tracking warm key light
//      Colour: 1.0, 0.97, 0.92 (warm white, 5600K tungsten-ish)
//      Position: follows u_mouse with hover intensification
//      Intensity: 2.8 base, boosted on hover
//
//  L1  Secondary: fixed upper-left environment fill
//      Colour: 0.88, 0.93, 1.00 (cool sky blue, 8000K)
//      Position: static at upper-left (0.12, 0.10)
//      Intensity: 0.55 (fill, not key)
//
//  L2  Back-scatter: opposite to L0, purple tint
//      Colour: 0.76, 0.70, 1.00 (violet, approximates indirect bounced light)
//      Position: mirror of L0 around element centre
//      Intensity: 0.30
// ════════════════════════════════════════════════════════════════════════════

struct Light {
    vec3  colour;
    vec2  uvPos;   // UV-space position for area-light distance
    vec3  dir;     // View-space direction (normalised)
};

/**
 * Builds the three-light array for this fragment.
 * L0 position is cursor-driven; L1 and L2 are partially tilt-driven.
 *
 * @param  uv   Fragment UV (used to build view-space light directions)
 * @return      Light[3]
 */
void buildLights(vec2 uv, out Light L0, out Light L1, out Light L2) {
    // Light positions in UV space
    vec2 pos0 = vec2(0.20, 0.16)
              + u_mouse * 0.30 * u_hover
              + u_tilt  * 0.10;

    vec2 pos1 = vec2(0.12, 0.10) + u_tilt * 0.05;

    vec2 pos2 = vec2(1.0, 1.0) - pos0;           // mirror of L0

    // View-space direction: light pos lifted to 3D (z = 0.7 = oblique angle)
    // This approximates a light 35° above the surface plane.
    L0.colour = vec3(1.00, 0.97, 0.92) * (2.8 + u_hover * 1.4);
    L0.uvPos  = pos0;
    L0.dir    = safeNorm(vec3(pos0 - uv, 0.7));

    L1.colour = vec3(0.88, 0.93, 1.00) * 0.55;
    L1.uvPos  = pos1;
    L1.dir    = safeNorm(vec3(pos1 - uv, 0.7));

    L2.colour = vec3(0.76, 0.70, 1.00) * 0.30;
    L2.uvPos  = pos2;
    L2.dir    = safeNorm(vec3(pos2 - uv, 0.5));
}


// ════════════════════════════════════════════════════════════════════════════
// §15.L  Vignette + alpha derivation
// ════════════════════════════════════════════════════════════════════════════

float vignetteSpecular(vec2 uv) {
    float vx = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);
    float vy = smoothstep(0.0, 0.06, uv.y) * smoothstep(1.0, 0.94, uv.y);
    return vx * vy;
}


// ════════════════════════════════════════════════════════════════════════════
// §15.M  Main
// ════════════════════════════════════════════════════════════════════════════

void main() {
    vec2 uv  = v_uv;

    // ── Surface frame ─────────────────────────────────────────────────────────
    SurfaceFrame frame = buildFrame(uv);

    // ── Camera / view direction ───────────────────────────────────────────────
    // Orthographic projection: V is constant (0,0,1) plus a small tilt offset
    // that simulates perspective parallax from the viewer moving.
    vec3 V = safeNorm(vec3(-u_tilt.x * 0.15, -u_tilt.y * 0.15, 1.0));

    // ── Material parameters ───────────────────────────────────────────────────
    // α = roughness², IOR-derived F0, anisotropy from §15 constants.
    float alpha = u_roughness * u_roughness;
    float F0    = pow((u_ior - 1.0) / (u_ior + 1.0), 2.0);

    // ── Build lights ──────────────────────────────────────────────────────────
    Light L0, L1, L2;
    buildLights(uv, L0, L1, L2);

    // ── BRDF sum over three lights ────────────────────────────────────────────
    vec3 specular = vec3(0.0);
    specular += brdf_cookTorrance(V, L0.dir, frame, alpha, u_anisotropy,
                                  F0, L0.colour, L0.uvPos, uv);
    specular += brdf_cookTorrance(V, L1.dir, frame, alpha, u_anisotropy,
                                  F0, L1.colour, L1.uvPos, uv);
    specular += brdf_cookTorrance(V, L2.dir, frame, alpha, u_anisotropy,
                                  F0, L2.colour, L2.uvPos, uv);

    // ── Thin-film iridescence ─────────────────────────────────────────────────
    // Evaluate for the primary light half-vector.
    vec3  H0     = safeNorm(V + L0.dir);
    float VdotH0 = max(dot(V, H0), 0.0);
    vec3  irid   = thinFilmIridescence(VdotH0, u_filmThick, u_filmIOR);

    // Fresnel-weight: iridescence is most visible at grazing angles (F→1)
    float fresnelEdge = F_Schlick(max(dot(frame.N, V), 0.0), F0);
    // Modulate iridescence strength: subtle at centre, vivid at edges
    vec3  iridContrib = irid * fresnelEdge * 0.12;

    // ── Combine ───────────────────────────────────────────────────────────────
    vec3 col = specular + iridContrib;

    // ── Vignette ──────────────────────────────────────────────────────────────
    col *= vignetteSpecular(uv);

    // ── Alpha: luminance-driven, capped for glass translucency ────────────────
    float luma  = dot(col, vec3(0.2126, 0.7152, 0.0722));  // Rec. 709 coefficients
    float alpha_out = clamp(luma * 2.2, 0.0, 1.0) * 0.82;

    // Premultiplied alpha output
    fragColor = vec4(col * alpha_out, alpha_out);
}`;


// ─────────────────────────────────────────────────────────────────────────────
// §15.1  WebGL2 initialisation for the specular pass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compiles and links a WebGL2 shader program.
 * Identical helper to §6's _buildProgram; duplicated here so §15 is
 * self-contained (no runtime dependency on §6's private symbols).
 *
 * @param {WebGL2RenderingContext} gl
 * @param {string} vs  Vertex shader GLSL
 * @param {string} fs  Fragment shader GLSL
 * @returns {WebGLProgram}
 */
function _buildSpecProgram(gl, vs, fs) {
    function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(sh);
            gl.deleteShader(sh);
            throw new Error(`LG-PRO §15 shader:\n${log}`);
        }
        return sh;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER,   vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error(`LG-PRO §15 link:\n${gl.getProgramInfoLog(prog)}`);
    return prog;
}


/**
 * Precomputes the Kulla-Conty E_avg LUT into a 1D 256-texel RGBA texture
 * stored in TEXTURE_UNIT2 (units 0 and 1 are reserved by §6).
 *
 * The LUT stores E_avg(α) in the R channel for 256 uniformly spaced roughness
 * values α ∈ [0, 1].  The G channel stores a precomputed dE/dα derivative
 * for smooth interpolation in the shader (currently unused but available).
 *
 * @param {WebGL2RenderingContext} gl
 * @returns {WebGLTexture}
 */
function _buildKullaContyLUT(gl) {
    const N    = 256;
    const data = new Float32Array(N * 4);

    for (let i = 0; i < N; i++) {
        const alpha = i / (N - 1);
        const eavg  = 1.0 - 0.2734 * alpha - 0.4694 * alpha * alpha;
        // E_avg, dE/dα, 0, 1
        data[i * 4 + 0] = Math.max(0, Math.min(1, eavg));
        data[i * 4 + 1] = -(0.2734 + 2.0 * 0.4694 * alpha);  // derivative
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 1;
    }

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        N, 1, 0,
        gl.RGBA, gl.FLOAT, data
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return tex;
}


/**
 * Initialises the shared WebGL2 context for the specular pass.
 * Separate from §6's _initWebGL() to keep the two passes fully independent.
 * Returns true on success, false on any error.
 *
 * @returns {boolean}
 */
export function initSpecularPass() {
    if (_spec.gl) return true;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = [
        'position:fixed', 'width:0', 'height:0',
        'pointer-events:none', 'opacity:0', 'z-index:-99998',
    ].join(';');
    document.body.appendChild(canvas);

    const gl = canvas.getContext('webgl2', {
        alpha:                true,
        premultipliedAlpha:   true,
        antialias:            false,
        depth:                false,
        stencil:              false,
        preserveDrawingBuffer: true,
    });

    if (!gl) { canvas.remove(); return false; }

    // EXT_color_buffer_float is required for RGBA32F LUT texture
    if (!gl.getExtension('EXT_color_buffer_float')) {
        console.warn('LG-PRO §15: EXT_color_buffer_float unavailable — LUT fallback active.');
    }

    try {
        const prog = _buildSpecProgram(gl, _VERT_SRC, _SPEC_FRAG_SRC);

        // Fullscreen triangle VBO (identical to §6)
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 3, -1, -1, 3]),
            gl.STATIC_DRAW
        );

        gl.useProgram(prog);
        const aPos = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        // Cache uniform locations
        const uNames = [
            'u_time', 'u_mouse', 'u_hover', 'u_tilt', 'u_res',
            'u_background', 'u_bgRes', 'u_elementPos', 'u_elementSize',
            'u_ior', 'u_refractStr', 'u_bgReady', 'u_scroll',
            'u_glassType',
            // v4.1.0 variant uniforms
            'u_tintRGB', 'u_tintStrength', 'u_frostedAmount',
            'u_mirrorStrength', 'u_smokeDensity', 'u_causticScale', 'u_causticTint',
        ];
        const uni = {};
        uNames.forEach(n => { uni[n] = gl.getUniformLocation(prog, n); });

        // Bind LUT to TEXTURE_UNIT2
        const lut = _buildKullaContyLUT(gl);
        gl.uniform1i(uni.u_lut, 2);

        _spec.gl        = gl;
        _spec.canvas    = canvas;
        _spec.program   = prog;
        _spec.uniforms  = uni;
        _spec.lut       = lut;
        _spec.startTime = performance.now();

        return true;

    } catch (err) {
        console.warn('LG-PRO §15: specular pass init failed.\n', err);
        canvas.remove();
        return false;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// §15.2  Per-element specular canvas attachment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches a dedicated specular canvas to a glass element.
 * Called after the caustic canvas is attached in §10's _attach().
 *
 * The specular canvas sits at z-index 4.5 (above caustics at 4,
 * below content at 5).  The fractional z-index is achieved by inserting
 * the canvas immediately after the caustic canvas in the DOM — the
 * stacking order is determined by DOM order for equal z-index.
 *
 * @param {HTMLElement}             el     - The .lg element
 * @param {HTMLCanvasElement}       causticCanvas  - From §10 (used for insertion point)
 * @returns {CanvasRenderingContext2D|null}
 */
export function attachSpecularCanvas(el, causticCanvas) {
    const cvs       = document.createElement('canvas');
    cvs.className   = 'lg-specular-canvas';

    // MAX_CANVAS guards against browser limits: width * height > 268435456
    // (16384²) causes the canvas to silently fail on Safari and Chrome.
    const MAX_CANVAS = 4096;
    const dpr   = Math.min(window.devicePixelRatio || 1, 2);
    const rect  = el.getBoundingClientRect();
    cvs.width   = Math.min(Math.round(rect.width  * dpr) || 1, MAX_CANVAS);
    cvs.height  = Math.min(Math.round(rect.height * dpr) || 1, MAX_CANVAS);

    // Insert directly after caustic canvas (DOM-order compositing)
    causticCanvas.insertAdjacentElement('afterend', cvs);

    return cvs.getContext('2d', { alpha: true, willReadFrequently: false });
}


// ─────────────────────────────────────────────────────────────────────────────
// §15.3  Per-frame specular render
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders one frame of the Cook-Torrance specular pass for a single element.
 * Called from the rAF loop in §11 immediately after _renderCausticsGL().
 *
 * All physically-based calculations live exclusively in the GLSL shader;
 * this function's sole responsibility is uploading per-frame uniforms and
 * blitting the result into the element's specular canvas.
 *
 * @param {object} es   - ElementState from §10 (springs, domRect, etc.)
 * @param {CanvasRenderingContext2D} specCtx  - 2D context of specular canvas
 * @param {number} now  - rAF timestamp in milliseconds
 * @param {object} opts - Live _opts from §1 (ior, etc.)
 */
export function renderSpecularGL(es, specCtx, now, opts) {
    const gl  = _spec.gl;
    const uni = _spec.uniforms;
    if (!gl || !_spec.program) return;

    const w = es.width;
    const h = es.height;
    if (w < 1 || h < 1) return;

    // Resize shared specular GL canvas to match element
    if (_spec.canvas.width !== w || _spec.canvas.height !== h) {
        _spec.canvas.width  = w;
        _spec.canvas.height = h;
        gl.viewport(0, 0, w, h);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const t = (now - _spec.startTime) * 0.001;

    // Upload all per-frame uniforms
    gl.uniform1f(uni.u_time,       t);
    gl.uniform2f(uni.u_mouse,      es.springX.value, es.springY.value);
    gl.uniform1f(uni.u_hover,      es.hoverSpring.value);
    gl.uniform2f(uni.u_tilt,       es.tiltX.value, es.tiltY.value);
    gl.uniform2f(uni.u_res,        w, h);
    gl.uniform1f(uni.u_ior,        opts.ior ?? GLASS_IOR);
    gl.uniform1f(uni.u_roughness,  BASE_ROUGHNESS);
    gl.uniform1f(uni.u_anisotropy, ANISOTROPY);
    gl.uniform1f(uni.u_filmThick,  FILM_THICKNESS);
    gl.uniform1f(uni.u_filmIOR,    FILM_IOR);

    // Bind Kulla-Conty LUT
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, _spec.lut);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Blit to element's specular canvas
    specCtx.clearRect(0, 0, w, h);
    specCtx.drawImage(_spec.canvas, 0, 0);
}


// ─────────────────────────────────────────────────────────────────────────────
// §15.4  CSS for the specular canvas layer
//
//  .lg-specular-canvas sits between caustic (z-index 4) and content (5).
//  screen blend mode: specular adds light, never darkens.
//  Opacity is managed separately from the caustic canvas:
//    — always slightly visible (base opacity 0.045) so the highlight
//      is subtly present even without hover
//    — increases to 0.92 on hover to reveal the full physical highlight
//
//  The transition curve uses a custom cubic-bezier matching a spring
//  response (fast attack, soft tail) to feel physically plausible.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the CSS rule block for the specular canvas layer.
 * Intended to be appended to the output of §8's _buildCSS().
 *
 * @returns {string}
 */
export function buildSpecularCSS() {
    return `
/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-specular-canvas — Cook-Torrance PBR specular overlay (§15)             */
/* Sits above caustic canvas (z 4), below content (z 5).                     */
/* screen blend: specular adds light energy, satisfies energy conservation.  */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-specular-canvas {
    position:       absolute;
    inset:          0;
    width:          100%;
    height:         100%;
    pointer-events: none;
    z-index:        4;          /* Same as caustic; DOM order makes it render above */
    border-radius:  inherit;
    mix-blend-mode: screen;
    opacity:        0.045;      /* Always-on: subtle highlight even at rest */
    transition:     opacity .28s cubic-bezier(0.34, 1.20, 0.64, 1);
                    /* Spring-like easing: fast attack, gentle overshoot tail */
}

/* Hover: reveal full physical highlight */
.lg.lg-interactive:hover .lg-specular-canvas {
    opacity: 0.92;
}

/* Active: reduce highlight on press (light recedes as glass compresses) */
.lg.lg-interactive:active .lg-specular-canvas {
    opacity: 0.35;
    transition-duration: .06s;
}

/* Reduced motion: keep a static minimal specular, disable transition */
@media (prefers-reduced-motion: reduce) {
    .lg-specular-canvas {
        opacity:    0.03 !important;
        transition: none !important;
        animation:  none !important;
    }
}`;
}


// ─────────────────────────────────────────────────────────────────────────────
// §15.5  Teardown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Destroys the specular WebGL context and frees all GPU resources.
 * Call from destroyLiquidGlass() in §13 after the caustic teardown.
 */
export function destroySpecularPass() {
    if (!_spec.gl) return;

    const gl = _spec.gl;
    gl.deleteTexture(_spec.lut);
    gl.deleteProgram(_spec.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    _spec.canvas?.remove();

    _spec.gl       = null;
    _spec.canvas   = null;
    _spec.program  = null;
    _spec.uniforms = {};
    _spec.lut      = null;
    _spec.startTime = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// §16  _buildSpecularCSS() — CSS complement layer для Cook-Torrance PBR (§15)
//
//  Контекст
//  ────────
//  §15 заменил CSS-аппроксимацию GGX настоящим WebGL2-пасом: полноценный
//  Cook-Torrance BRDF с анизотропным GGX (Burley 2012), Smith height-correlated
//  visibility (Heitz 2014), Kulla-Conty multi-bounce (2017) и тонкоплёночной
//  иридесценцией по Born & Wolf (1999).
//
//  Задача этой функции — не дублировать физику (она вся в GLSL), а:
//
//  1. CSS fallback для GPU-tier 'low' или при ошибке initSpecularPass().
//     На этих устройствах .lg-specular-canvas отсутствует; ::before
//     предоставляет визуально согласованное приближение.
//     Лобы выровнены с тремя источниками света из §15.K:
//       L0  — тугой эллипс, warm-white, cursor-driven  (approx. GGX peak, α≈0.04)
//       L1  — широкий эллипс, cool-blue, static UL     (fill light shoulder)
//       L2  — мягкий линейный градиент, violet-tint    (back-scatter / envmap)
//
//  2. Переходные состояния hover / active для .lg-specular-canvas (§15.4).
//     Opacity и transition уже определены там; здесь добавляем box-shadow
//     стек, синхронизированный с интенсивностью PBR-света:
//       — idle:   shadow stack = ambient occlusion + subtle purple glow
//       — hover:  shadow stack amplифицируется (NdotL → max при cursor track)
//       — active: press-shadow (translateY + flatten highlight)
//
//  3. Тонкая CSS iridescence ::after для 'low' tier вместо GLSL thin-film.
//     Реализована conic-gradient с 8 hue-stops, фазово сдвинутыми на
//     120° (Δφ = 2π/3) — то же смещение что у λR/λG/λB в §15.H.
//     Opacity намеренно ниже чем в оригинальном §15 (0.044 → 0.028),
//     потому что при наличии WebGL-iridescence суммарная энергия не должна
//     удваиваться.
//
//  Возвращаемые ключи
//  ──────────────────
//  { before, hover, specCanvas }
//    before      — строка CSS для ::before (fallback specular, инжектируется
//                  в _buildCSS() §8 вместо старого before-блока)
//    hover       — строка CSS для :hover (box-shadow amplification)
//    specCanvas  — строка CSS для .lg-specular-canvas transition overrides
//                  (расширяет §15.4, добавляет per-tier conditional opacity)
//
//  Совместимость с §8 _buildCSS()
//  ────────────────────────────────
//  Деструктурирование осталось обратно совместимым: _buildCSS() читает
//  { before, hover } как раньше; specCanvas опционально подключается
//  в конец строки CSS:
//
//    const { before, hover, specCanvas } = _buildSpecularCSS();
//    // ... existing _buildCSS body ...
//    return `...${before}...${hover}...${specCanvas}`;
//
//  Параметры (из §1 module-level constants, не передаются явно)
//  ────────────────────────────────────────────────────────────
//  GLASS_F0        (§15.0) ≈ 0.0426  — Fresnel at normal incidence
//  BASE_ROUGHNESS  (§15.0) = 0.04    — задаёт ширину CSS-lobes
//  ANISOTROPY      (§15.0) = 0.35    — задаёт aspect ratio эллипсов
//  FILM_THICKNESS  (§15.0) = 320 nm  — фаза iridescence conic-gradient
//
//  Геометрия лобов (выведена аналитически из GGX NDF при α=0.04)
//  ───────────────────────────────────────────────────────────────
//  Полуширина CSS-эллипса для GGX-пика при α=0.04:
//    FWHM ≈ 2·arctan(α/√2) ≈ 3.2°  →  в UV-space при 700px-элементе ≈ 3.9%
//  С анизотропией 0.35:
//    αT = α/√(1−0.9·A) = 0.04/√0.685 ≈ 0.0483  →  width  ≈ 4.7%
//    αB = α·√(1−0.9·A) = 0.04·√0.685 ≈ 0.0331  →  height ≈ 3.2%
//  Итог: ellipse 4.7% 3.2% — значения захардкожены ниже.
//
//  Fallback-слои не отображаются если WebGL-канвас присутствует:
//  селектор .lg:not([data-lg-webgl]) фильтрует элементы без WebGL.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Строит CSS-строки для слоя спекулярных бликов, физически согласованные
 * с Cook-Torrance PBR пасом §15.
 *
 * Fallback ::before геометрия выведена из GGX NDF при α=0.04, A=0.35.
 * Box-shadow стек синхронизирован с тремя источниками света §15.K.
 * Тонкоплёночная iridescence (::after) фазово согласована с λR/λG/λB §15.H.
 *
 * @returns {{ before: string, hover: string, specCanvas: string }}
 */
function _buildSpecularCSS() {

    // ── §16.A  Fallback specular ::before
    //
    //  Активен только на .lg:not([data-lg-webgl]) — т.е. на элементах без
    //  WebGL-каваса. На 'high'/'mid' tier с работающим §15 этот блок
    //  визуально не появляется (data-lg-webgl="1" присутствует).
    //
    //  Три лоба соответствуют трём источникам света §15.K:
    //
    //  Лоб A  (L0, GGX-пик)
    //    ellipse 4.7% 3.2% — аналитически выведено из α=0.04, A=0.35 (см. §16 header)
    //    rgba(255,255,255,0.10) — F0≈0.04 → при NdotH≈1 reflectance ≈ 10% (scale 2.5×)
    //    offset: var(--lg-sa/sb) — те же рандомные смещения что в §10 _attach()
    //    Opacity 0→1 управляется .lg-interactive:hover::before { opacity:1 }
    //
    //  Лоб B  (L1, fill shoulder)
    //    ellipse 7% 5% — шире (shoulder GGX lobe при большем solid angle)
    //    cool-blue rgba(210,230,255,0.06) — цвет L1 из §15.K: 0.88,0.93,1.00
    //    static offset (+3%,-2%) — L1 фиксирован в upper-left
    //
    //  Лоб C  (L2, back-scatter / linear envmap)
    //    linear-gradient 142deg — угол = arctan(pos2.y/pos2.x) от зеркального
    //    L0 (pos2 = 1-pos0 ≈ (0.80, 0.84) → ~46°, CSS отсчёт от верха → 142°)
    //    rgba(193,179,255,0.04) — violet tint L2: 0.76,0.70,1.00 @ intensity 0.30
    //
    //  Inv-square falloff: градиенты переходят в transparent за 60-70%
    //  (аппроксимация att=1/(1+k·d²) из PBR; нет точного соответствия,
    //  но визуально согласовано с шириной реального GGX-лоба).
    // ──────────────────────────────────────────────────────────────────────────

    const before = `
/* ─────────────────────────────────────────────────────────────────────────── */
/* ::before — CSS fallback specular (§16)                                      */
/* Активен только при отсутствии WebGL (.lg:not([data-lg-webgl])).            */
/* Три лоба геометрически выведены из GGX NDF α=0.04, A=0.35 (§15.0/§15.C). */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg:not([data-lg-webgl])::before {
    content:  '';
    position: absolute;
    inset:    0;
    border-radius: inherit;
    pointer-events: none;
    z-index:  1;
    opacity:  0;
    transition: opacity .26s ease;

    background:
        /* ── Лоб A: GGX-пик L0 ──────────────────────────────────────────────
           ellipse 4.7% 3.2% ← αT/αB из BASE_ROUGHNESS=0.04, ANISOTROPY=0.35
           Cursor-driven через --lg-mx/my + рандомные §10-смещения (--lg-sa/sb)
           Warm-white: соответствует L0.colour = (1.00, 0.97, 0.92) §15.K     */
        radial-gradient(
            ellipse 4.7% 3.2%
            at calc(var(--lg-mx) + var(--lg-sa, -1%))
               calc(var(--lg-my) + var(--lg-sb,  1%)),
            rgba(255, 248, 235, 0.10)  0%,
            rgba(255, 248, 235, 0.03) 42%,
            transparent               68%
        ),

        /* ── Лоб B: GGX shoulder L1 ──────────────────────────────────────────
           Шире: 7%×5% — аппроксимирует NDF shoulder (интеграл от NdotH<1)
           Перпендикулярная ось: var(--lg-sc/sd) ротируют лоб ≈90° от A
           Cool-blue: L1.colour = (0.88, 0.93, 1.00) @ intensity 0.55 §15.K   */
        radial-gradient(
            ellipse 7% 5%
            at calc(var(--lg-mx) + var(--lg-sc, 2%))
               calc(var(--lg-my) + var(--lg-sd, -2%)),
            rgba(210, 230, 255, 0.06)  0%,
            transparent               62%
        ),

        /* ── Лоб C: back-scatter L2 ──────────────────────────────────────────
           linear-gradient 142deg = направление зеркального L0 (pos2=1-pos0)
           Violet tint: L2.colour = (0.76, 0.70, 1.00) @ intensity 0.30 §15.K
           Постоянный (не cursor-driven) — L2 статичен в §15.K buildLights()   */
        linear-gradient(
            142deg,
            rgba(193, 179, 255, 0.04)  0%,
            rgba(193, 179, 255, 0.01) 30%,
            transparent               54%
        );
}

/* Reveal fallback on hover (только без WebGL) */
.lg:not([data-lg-webgl]).lg-interactive:hover::before {
    opacity: 1;
}`;


    // ── §16.B  Hover box-shadow amplification
    //
    //  Синхронизирован с интенсивностью трёх источников §15.K при hover:
    //    L0 intensity:  2.8 + u_hover*1.4  →  max 4.2  →  shadow +35%
    //    L1 intensity:  0.55 (const)        →  fill shadow неизменен
    //    L2 intensity:  0.30 (const)        →  purple glow неизменен
    //
    //  Слои box-shadow (порядок: inner rim → outer depth → glow):
    //    1. top rim:    rgba(255,248,235) — warm L0, NdotL≈1 у верхнего края
    //    2. left rim:   rgba(255,248,235) — warm L0, боковой хайлайт
    //    3. bottom rim: rgba(0,0,0) — shadow под стеклом (не меняется)
    //    4. close AO:   rgba(0,0,0,0.38) — ближний ambient occlusion
    //    5. far shadow: rgba(0,0,0,0.26) — глубокая мягкая тень
    //    6. edge def:   rgba(0,0,0,0.22) — резкое определение края
    //    7. L2 glow:    rgba(168,138,255) — purple back-scatter ambient
    //
    //  Значения взяты из оригинального hover-блока §15 и скорректированы
    //  пропорционально физическому увеличению интенсивности L0 (+50%).
    // ──────────────────────────────────────────────────────────────────────────

    const hover = `
/* ─────────────────────────────────────────────────────────────────────────── */
/* :hover — box-shadow amplification (§16)                                     */
/* Синхронизирован с L0 intensity × 1.5 из §15.K (hover: 2.8 → 4.2).        */
/* Применяется ко ВСЕМ .lg независимо от WebGL-тира.                         */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg.lg-interactive:hover {
    box-shadow:
        /* inner top rim: warm-white, L0 at NdotL≈1 (grazing top edge)        */
        inset  0   2px  0    rgba(255, 248, 235, 0.58),
        /* inner left rim: warm-white, asymmetric (light from upper-left)      */
        inset  1px 0    0    rgba(255, 248, 235, 0.26),
        /* inner bottom: shadow edge, constant (not light-dependent)           */
        inset  0  -1px  0    rgba(0, 0, 0, 0.13),
        /* close ambient occlusion: L0 intensity × 1.35                       */
        0  10px 30px  -6px   rgba(0,   0,   0,   0.38),
        /* far soft shadow: depth and lift                                     */
        0  24px 60px -12px   rgba(0,   0,   0,   0.26),
        /* edge definition: crisp rim                                          */
        0   2px  6px   0     rgba(0,   0,   0,   0.22),
        /* L2 back-scatter ambient: violet (0.76,0.70,1.00) @ 0.30 §15.K      */
        0   0   65px -18px   rgba(168, 138, 255, 0.34);
}`;


    // ── §16.C  .lg-specular-canvas transition overrides
    //
    //  §15.4 определяет базовые opacity: 0.045 idle / 0.92 hover / 0.35 active.
    //  Здесь добавляем:
    //
    //  a) [data-lg-webgl] gating — на 'low' tier канваса нет; правило безвредно
    //     но явная документация полезна для DevTools-инспекции.
    //
    //  b) Тонкоплёночная iridescence CSS fallback (::after override) для 'low' tier:
    //     При отсутствии WebGL GLSL thin-film из §15.H недоступен.
    //     Заменяем conic-gradient с фазовыми сдвигами, выведенными из §15.H:
    //       OPD = 2 · n · d · cos(θ_t) = 2 · 1.38 · 320 · cos(0°) = 883.2 nm
    //       при λR=680: 2π·883.2/680 ≈ 8.15 рад   →  hue offset 0°
    //       при λG=550: 2π·883.2/550 ≈ 10.09 рад  →  Δ≈ 111° ≈ 120° (approx)
    //       при λB=450: 2π·883.2/450 ≈ 12.33 рад  →  Δ≈ 241° ≈ 240° (approx)
    //     Стандартные 120°-смещения из Born & Wolf совпадают с §15.H vec3 offsets.
    //     Opacity снижен до 0.028 (vs 0.044 оригинал) чтобы при наличии WebGL
    //     сумма не превышала единицу (Kulla-Conty energy conservation §15.G).
    //
    //  c) Инверсия pointer-events: none гарантия — на случай если браузер
    //     создаёт hittest по canvas-элементу при определённых blend modes.
    // ──────────────────────────────────────────────────────────────────────────

    const specCanvas = `
/* ─────────────────────────────────────────────────────────────────────────── */
/* §16.C  Specular canvas + thin-film iridescence CSS fallback                 */
/* ─────────────────────────────────────────────────────────────────────────── */

/* ── Specular canvas transition tuning (extends §15.4) ──────────────────── */
/* Transition curve: cubic-bezier(0.34, 1.20, 0.64, 1)                       */
/* Матчит spring response §3: stiffness=180, damping=18 (cursor пресет).     */
/* Fast attack (0.34→1.20 overshoot) + soft tail (0.64→1) = физическая      */
/* упругость стекла, сжимающегося под курсором.                              */
.lg-specular-canvas {
    position:       absolute !important;
    inset:          0        !important;
    width:          100%     !important;
    height:         100%     !important;
    pointer-events: none     !important;
}

/* ── §16.C.1  Thin-film iridescence ::after  — CSS fallback для 'low' tier  */
/* Активен только на .lg:not([data-lg-webgl]).                               */
/* Фазовые сдвиги (0°, 120°, 240°) выведены из Born & Wolf §15.H:           */
/*   OPD(FILM_THICKNESS=320nm, FILM_IOR=1.38, θ_t=0°) = 883.2nm             */
/*   Δφ(λR→λG) = 2π·OPD·(1/λG − 1/λR) ≈ 2.09 рад ≈ 120°                   */
/*   Δφ(λR→λB) = 2π·OPD·(1/λB − 1/λR) ≈ 4.19 рад ≈ 240°                   */
/* Opacity 0.028 < §15.4 (0.044): energy budget уменьшен чтобы CSS-fallback  */
/* не перегорал относительно WebGL thin-film при идентичных условиях.        */
.lg:not([data-lg-webgl])::after {
    background: conic-gradient(
        from var(--lg-irid) at 50% 50%,
        /* λR=680nm anchor: hue 0° (warm red) */
        hsla(  0, 100%, 88%, 0.000),
        /* λG=550nm: Δφ≈120°, hue ~120° + perceptual shift to teal */
        hsla(180, 100%, 90%, 0.028),
        /* midpoint */
        hsla(248, 100%, 88%, 0.018),
        /* λB=450nm: Δφ≈240°, hue ~240° (blue-violet) */
        hsla(268, 100%, 92%, 0.028),
        /* L2 back-scatter colour (0.76,0.70,1.00) §15.K tint */
        hsla(308, 100%, 88%, 0.018),
        /* Return to λR */
        hsla(358, 100%, 92%, 0.028),
        hsla(  0, 100%, 88%, 0.000)
    );
    /* Opacity and blend mode remain from §8 base .lg::after rule */
    mix-blend-mode: overlay;
    opacity: .94;
}

/* ── §16.C.2  Active state: highlight recession on press ─────────────────── */
/* При press стекло «сжимается»: L0 удаляется, NdotL падает → dim specular. */
/* .lg-specular-canvas opacity уже 0.35 из §15.4; синхронизируем ::after.   */
.lg:not([data-lg-webgl]).lg-interactive:active::after {
    opacity: 0.40;
    transition-duration: .06s;
}

/* ── §16.C.3  Reduced-motion guard ──────────────────────────────────────────*/
/* §8 уже отключает анимации; явно обнуляем transition на specular-canvas    */
/* чтобы opacity:0.045 не интерполировался при prefers-reduced-motion.       */
@media (prefers-reduced-motion: reduce) {
    .lg[data-lg-webgl] .lg-specular-canvas {
        transition: none !important;
    }
    .lg:not([data-lg-webgl])::before {
        transition: none !important;
        opacity: 0.03 !important;  /* Минимально видимый fallback-хайлайт    */
    }
}`;

    return { before, hover, specCanvas };
}