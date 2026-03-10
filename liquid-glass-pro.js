// liquid-glass-pro.js · v2.0.1
//
// glass rendering for the web, built on top of webgl2 + css backdrop-filter.
//
// how it works:
//   1. html2canvas captures the page at reduced resolution → uploads to webgl2 texture
//   2. fragment shader displaces uvs using surface normals (snell's law approximation)
//   3. svg feDisplacementMap handles chromatic aberration at the wrapper level
//   4. spring physics drives cursor tracking and device tilt
//   5. houdini css custom properties animate the specular highlight
//
// what's new in v2.0.1:
//   - screen-space background refraction via html2canvas → sampler2D
//   - per-channel cauchy dispersion (different ior per rgb)
//   - environment reflection probe at grazing angles (fresnel-weighted)
//   - animated normal map from gradient noise
//   - react hook (useLiquidGlass), vue composable and svelte action patterns
//   - ssr-safe: no dom access at import time
//
// note: refraction is a snapshot, not a live compositor feed.
// html2canvas will fail on cross-origin content (iframes, cdn images, external fonts).
//
// depends on html2canvas ^1.4.1 — must be loaded before initLiquidGlass() is called.
//
// quick start:
//   import { initLiquidGlass } from './liquid-glass-pro.js'
//   initLiquidGlass({ ior: 1.5, refractionStrength: 0.04 })
//
//   <div class="lg lg-card lg-interactive">hello</div>
//
// license: apache 2.0



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
    refractionStrength:  0.035,  // UV displacement scale; tuned empirically
    aberrationStrength:  1.6,    // px magnitude of SVG feDisplacementMap on high tier
    bgCaptureInterval:   50,    // ms — balance freshness vs. html2canvas overhead
    bgCaptureScale:      0.65,   // 65% linear scale → ~8× pixel reduction
    caustics:            true,
    grain:               true,
    iridescence:         true,
    breathe:             true,
    selector:            '.lg',
    glassOpacity:    0.12,   // base white tint
    glassSaturation: 100,    // backdrop-filter saturation %
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
                el.classList?.contains('lg-caustic-canvas'),   // caustic overlays
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
    if (!gl) return;  // No WebGL context — capture is only useful with WebGL.

    // ── Create background texture on TEXTURE_UNIT1 ────────────────────────────
    // Unit 0 is implicitly used by the caustic sampler (u_caustics, future);
    // we permanently bind the background capture to unit 1.
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    // Seed with a 1×1 fully-transparent placeholder.  This prevents the shader
    // from sampling uninitialised GPU memory before the first capture completes.
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
    );

    // Filtering: LINEAR_MIPMAP_LINEAR (tri-linear) for smooth downscaling when
    // the glass element is smaller than the full-viewport texture.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Clamp to edge to prevent border-wrapping artefacts at the texture margins.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    _state.bgTexture = tex;

    // ── Kick off first capture immediately ───────────────────────────────────
    _captureBackground();

    // ── Periodic refresh ─────────────────────────────────────────────────────
    // setInterval is used (rather than chained setTimeout) so that missed
    // captures due to tab throttling do not compound the delay.
    _state.bgCaptureId = setInterval(_captureBackground, _opts.bgCaptureInterval);

    // ── Scroll-driven refresh (debounced) ─────────────────────────────────────
    // During active scrolling, captures would queue up faster than html2canvas
    // can complete them.  A 150 ms debounce fires once the scroll has settled.
    let scrollDebounce = 0;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(_captureBackground, 150);
    }, { passive: true });

    // ── Resize-driven refresh ────────────────────────────────────────────────
    // Layout reflows change what is visible behind the glass, so a new capture
    // is needed.  ResizeObserver fires only when dimensions actually change.
    new ResizeObserver(() => _captureBackground()).observe(document.body);
}

/**
 * Cancels the periodic capture interval and resets capture-related state.
 * Called by destroyLiquidGlass().  Does NOT delete the WebGL texture
 * (that happens when the GL context is freed).
 */
function _stopBackgroundCapture() {
    clearInterval(_state.bgCaptureId);
    _state.bgCaptureId = 0;
    _state.bgReady     = false;
    _state.bgCapturing = false;
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
 *   u_time         float    Seconds since GL context creation.
 *   u_mouse        vec2     Spring-smoothed cursor position in element UV space.
 *   u_hover        float    Spring-smoothed hover intensity (0–1).
 *   u_tilt         vec2     Spring-smoothed tilt angles (−1 to +1 per axis).
 *   u_res          vec2     Physical canvas dimensions in pixels.
 *   u_background   sampler2D  html2canvas background texture (unit 1).
 *   u_bgRes        vec2     Background texture dimensions (currently unused; reserved).
 *   u_elementPos   vec2     Element top-left corner in normalised screen space (0..1).
 *   u_elementSize  vec2     Element dimensions as fraction of viewport.
 *   u_ior          float    Index of refraction.
 *   u_refractStr   float    UV displacement scale for refraction.
 *   u_bgReady      float    1.0 if background texture contains valid data, 0.0 otherwise.
 *   u_scroll       vec2     Scroll drift since last capture, normalised to screen size.
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


// ════════════════════════════════════════════════════════════════════════════
// Utility functions
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gradient noise hash: maps a 2D lattice point to a pseudo-random 2D vector
 * in [−1, 1]².  The magic constants (127.1, 311.7, etc.) are chosen to
 * produce visually uncorrelated output across the lattice.
 *
 * @param  p  2D integer lattice coordinate
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
// Surface normal computation  (bump-map from animated noise)
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
 * An additional high-frequency mouse-driven warp layer adds interactive
 * surface detail near the cursor while the element is hovered.
 *
 * @param  uv  Element-local UV (0..1)
 * @return     Normalised surface normal in view space
 */
vec3 surfaceNormal(vec2 uv) {
    float eps = 0.002;  // Finite-difference step (≈ 0.2% of element width)

    // Sample base noise field and two offset points for gradient estimation
    float hC = gnoise(uv * 7.0 + u_time * 0.07);                     // centre
    float hR = gnoise((uv + vec2(eps, 0.0)) * 7.0 + u_time * 0.07);  // right
    float hU = gnoise((uv + vec2(0.0, eps)) * 7.0 + u_time * 0.07);  // up

    // Interactive bump: a faster noise layer that follows the cursor position.
    // Multiplied by hover intensity so it only activates when the user hovers.
    // Gaussian falloff (exp(−d²·k)) spatially limits the influence to the area
    // around the cursor, preventing full-surface distortion on hover.
    float mouseInfluence = u_hover * 0.4 * exp(-length(uv - u_mouse) * 3.5);
    float hM = gnoise(uv * 11.0 - u_mouse * 2.0 + u_time * 0.13) * mouseInfluence;

    // Finite differences give the gradient of the height field
    float dX = (hR - hC) / eps + hM * 0.03;  // ∂h/∂x
    float dY = (hU - hC) / eps + hM * 0.03;  // ∂h/∂y

    // Normal from gradient: N = normalize(−∂h/∂x, −∂h/∂y, 1)
    // The 0.8 scale dampens the tilt so the glass doesn't appear too rippled
    return normalize(vec3(-dX * 0.8, -dY * 0.8, 1.0));
}


// ════════════════════════════════════════════════════════════════════════════
// Snell's law UV refraction  (thin-glass approximation)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Computes the refracted screen-space UV for a given surface normal,
 * using a thin-glass linearisation of Snell's law:
 *
 *   n1 · sin(θ1) = n2 · sin(θ2)       (exact Snell's law)
 *
 * For thin glass the angle θ is small, so sin(θ) ≈ θ, and the lateral
 * displacement simplifies to:
 *
 *   Δuv ≈ (n1/n2 − 1) · N.xy · refractionStrength
 *
 * An additional tilt term (from cursor position and gyroscope) adds a
 * view-dependent parallax shift that makes the glass appear to have
 * physical thickness as the viewer moves relative to it.
 *
 * @param  screenUV  Pre-mapped screen-space UV (element mapped to viewport)
 * @param  normal    View-space surface normal from surfaceNormal()
 * @return           Refracted screen-space UV
 */
vec2 refractUV(vec2 screenUV, vec3 normal) {
    // Refraction ratio: n1/n2 where n1=1.0 (air), n2=u_ior (glass)
    float ratio = 1.0 / u_ior;

    // Primary displacement from surface normal tilt × user-specified strength
    vec2 tilt = normal.xy * u_refractStr;

    // Secondary parallax shift from device/cursor tilt at reduced strength
    tilt += u_tilt * u_refractStr * 0.4;

    return screenUV + tilt;
}


// ════════════════════════════════════════════════════════════════════════════
// Background sampling with refraction
// ════════════════════════════════════════════════════════════════════════════

/**
 * Maps from element-local UV to a viewport-space UV, compensates for scroll
 * drift since the last background capture, applies refraction displacement,
 * and returns the sampled background colour.
 *
 * Returns transparent black (vec4(0)) if the background texture is not yet
 * available (u_bgReady < 0.5), allowing the caustic layer to show through
 * cleanly during the first frame before html2canvas completes.
 *
 * @param  uv      Element-local UV
 * @param  normal  View-space surface normal
 * @return         Sampled and refracted background colour (RGBA)
 */
vec4 sampleBackground(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec4(0.0);  // Background not yet available

    // Step 1: Map element UV → viewport UV
    //   elementPos  = top-left corner of element in [0,1] screen space
    //   elementSize = element dimensions as fraction of viewport
    vec2 screenUV = u_elementPos + uv * u_elementSize;

    // Step 2: Compensate for scroll drift between capture and render time.
    //   u_scroll = (currentScroll − captureScroll) / viewportSize
    screenUV += u_scroll;
    screenUV  = clamp(screenUV, vec2(0.001), vec2(0.999));

    // Step 3: Apply Snell refraction
    vec2 refractedUV = refractUV(screenUV, normal);
    refractedUV      = clamp(refractedUV, vec2(0.0), vec2(1.0));

    return texture(u_background, refractedUV);
}


// ════════════════════════════════════════════════════════════════════════════
// Chromatic refraction  (per-channel Cauchy dispersion)  — NEW in v2.0.0
// ════════════════════════════════════════════════════════════════════════════

/**
 * Samples the background texture three times — once per RGB channel — at
 * slightly different refraction angles, simulating the wavelength-dependent
 * bending of light through a dispersive glass medium (Cauchy's equation).
 *
 * Physical basis: the Abbe number (V = (nD−1)/(nF−nC)) describes how much
 * a glass disperses light.  A typical borosilicate (V ≈ 64) splits red and
 * blue paths by ~1.5% of the refraction angle.  Here we approximate this
 * with empirically-tuned IOR offsets:
 *
 *   Red channel:    IOR − 0.010  (lowest refraction, longest wavelength)
 *   Green channel:  IOR           (reference)
 *   Blue channel:   IOR + 0.018  (highest refraction, shortest wavelength)
 *
 * The extra displacement for R and B is:
 *   Δ = N.xy · (1/IOR_channel − 1/IOR_ref) · refractionStrength
 *
 * Returns vec3(0) if the background texture is not ready yet.
 *
 * @param  uv      Element-local UV
 * @param  normal  View-space surface normal
 * @return         RGB colour with per-channel dispersion applied
 */
vec3 chromaticRefraction(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec3(0.0);

    // Build viewport-space UV with scroll compensation
    vec2 screenUV = u_elementPos + uv * u_elementSize + u_scroll;
    screenUV = clamp(screenUV, vec2(0.001), vec2(0.999));

    // Per-channel IOR values (Cauchy dispersion approximation)
    float iorR = u_ior - 0.010;   // Red   ≈ 1.440 (for u_ior = 1.45)
    float iorG = u_ior;            // Green ≈ 1.450 (reference wavelength)
    float iorB = u_ior + 0.018;   // Blue  ≈ 1.468

    // Additional per-channel displacement delta beyond the base refraction:
    //   Δ = N.xy · (1/iorCh − 1/iorRef) · refractStr
    vec2 baseRefracted = refractUV(screenUV, normal);
    vec2 uvR = clamp(baseRefracted + normal.xy * (1.0/iorR - 1.0/u_ior) * u_refractStr, 0.0, 1.0);
    vec2 uvG = clamp(baseRefracted,                                                       0.0, 1.0);
    vec2 uvB = clamp(baseRefracted + normal.xy * (1.0/iorB - 1.0/u_ior) * u_refractStr, 0.0, 1.0);

    // Sample each channel from its own refracted UV
    float r = texture(u_background, uvR).r;
    float g = texture(u_background, uvG).g;
    float b = texture(u_background, uvB).b;

    return vec3(r, g, b);
}


// ════════════════════════════════════════════════════════════════════════════
// Voronoi caustic simulation  (retained from v1.1.1)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Computes the minimum distance from the current UV to the nearest animated
 * Voronoi cell centre.  The cell centres oscillate in time using sinusoidal
 * motion with per-cell random frequencies and phases, producing the organic
 * swimming motion characteristic of underwater caustic light patterns.
 *
 * Implementation: 5×5 neighbourhood search to avoid missing nearby cell
 * centres at the domain boundaries.  Using a 5×5 window (dy/dx −2..+2)
 * rather than 3×3 is critical at high cell scales where centres can be
 * further than 1 unit from the fragment.
 *
 * @param  p  2D UV scaled to cell frequency
 * @param  t  Animation time in seconds
 * @return    Minimum distance to nearest Voronoi cell centre
 */
float voronoi(vec2 p, float t) {
    vec2  i    = floor(p);  // Integer lattice cell
    vec2  f    = fract(p);  // Fractional position
    float minD = 8.0;       // Initialise to a value larger than any possible distance

    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2 n  = vec2(float(dx), float(dy));   // Neighbour offset
            vec2 h  = hash2(i + n);                 // Pseudo-random seed for this cell

            // Animate cell centre: oscillates within [0.04, 0.96] of the cell
            // using two sinusoidal frequencies modulated by the hash value.
            vec2 pt = n + 0.5 + 0.46 * sin(
                t * (vec2(0.63, 0.91) + abs(h) * 0.35) + 6.2831 * h
            );

            minD = min(minD, length(pt - f));
        }
    }
    return minD;
}

/**
 * Produces one band (octave) of the caustic pattern by running voronoi(),
 * then applying a power curve to sharpen the bright caustic beams.
 *
 * smoothstep(0, 0.30, dist) maps the Voronoi distance to a smooth 0–1 ramp,
 * selecting only the narrow bright rim near each cell boundary.
 * pow(·, 1.5) further concentrates the brightness into tight caustic lines.
 *
 * @param  uv    UV input (will be scaled by 'scale')
 * @param  scale Cell frequency
 * @param  speed Animation speed multiplier
 * @param  seed  Phase seed for this octave (breaks pattern repetition)
 * @return       Caustic band intensity in [0, 1]
 */
float causticBand(vec2 uv, float scale, float speed, float seed) {
    return pow(smoothstep(0.0, 0.30, voronoi(uv * scale + seed, u_time * speed)), 1.5);
}

/**
 * Composites four caustic octaves at different scales and animation speeds
 * to produce a rich, multi-scale caustic pattern.
 *
 * The cursor offset (mw) shifts the caustic centre of mass toward the pointer
 * while the element is hovered, reinforcing the interactive feel.
 *
 * Octave weights sum to ~1.01, ensuring the composite stays in [0, 1].
 *
 * @param  uv  UV with aspect-ratio correction applied
 * @return     Composite caustic intensity in [0, 1]
 */
float caustic(vec2 uv) {
    // Shift caustic origin toward cursor, scaled by hover intensity
    vec2 mw = (u_mouse - 0.5) * 0.07 * u_hover;

    return causticBand(uv + mw,       3.4, 0.38,  0.00) * 0.48   // Low-frequency base
         + causticBand(uv + mw * 0.6, 5.9, 0.27, 17.30) * 0.26   // Mid-frequency detail
         + causticBand(uv,            2.1, 0.19, 31.70) * 0.17   // Very-low secondary
         + causticBand(uv + mw * 1.2, 8.1, 0.55,  5.53) * 0.10;  // High-frequency sparkle
}


// ════════════════════════════════════════════════════════════════════════════
// Schlick Fresnel approximation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Schlick's approximation to the Fresnel reflectance at an interface.
 *
 *   R(θ) ≈ F0 + (1 − F0) · (1 − cos θ)⁵
 *
 * where F0 is the reflectance at normal incidence:
 *   F0 = ((n1 − n2) / (n1 + n2))² ≈ 0.04 for air/glass
 *
 * At normal incidence (cosTheta = 1) the result is F0.
 * At grazing incidence (cosTheta = 0) the result approaches 1.0.
 *
 * @param  cosTheta  Cosine of the angle between the view ray and surface normal
 * @param  f0        Reflectance at normal incidence (≈ 0.04 for glass)
 * @return           Fresnel reflectance in [f0, 1.0]
 */
float schlick(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}


// ════════════════════════════════════════════════════════════════════════════
// Environment reflection probe  — NEW in v2.0.0
// ════════════════════════════════════════════════════════════════════════════

/**
 * Approximates environmental reflection at grazing angles by sampling the
 * background texture at a horizontally mirrored UV, weighted by the Fresnel
 * factor.
 *
 * Physical basis: at grazing angles the Fresnel reflectance approaches 1.0,
 * meaning the glass reflects rather than transmits.  A rigorous implementation
 * would require a separate reflection map; here we mirror the existing
 * background capture horizontally as a cheap approximation of a planar
 * reflection probe.  The surface normal perturbation adds a subtle
 * "distorted mirror" quality.
 *
 * The 0.35 scalar prevents the reflection from overwhelming the transmitted
 * light; it represents the fraction of the reflection that is visible over
 * the caustic + transmission composite.
 *
 * Returns vec3(0) if:
 *   • Background texture is not available (u_bgReady < 0.5)
 *   • Fresnel factor is negligibly small (< 0.01) to skip the texture lookup
 *
 * @param  uv             Element-local UV
 * @param  normal         Surface normal from surfaceNormal()
 * @param  fresnelFactor  Schlick reflectance at this fragment
 * @return                Environment reflection colour contribution
 */
vec3 environmentReflection(vec2 uv, vec3 normal, float fresnelFactor) {
    if (u_bgReady < 0.5 || fresnelFactor < 0.01) return vec3(0.0);

    // Map element UV to screen UV and compensate for scroll drift
    vec2 screenUV = u_elementPos + uv * u_elementSize + u_scroll;

    // Mirror horizontally: reflect around x = 0.5 of viewport
    // Normal perturbation adds surface roughness to the reflection
    vec2 mirrorUV = vec2(1.0 - screenUV.x, screenUV.y) + normal.xy * 0.05;
    mirrorUV      = clamp(mirrorUV, 0.0, 1.0);

    // Scale by fresnelFactor and an empirical 0.35 to keep reflection subtle
    return texture(u_background, mirrorUV).rgb * fresnelFactor * 0.35;
}


// ════════════════════════════════════════════════════════════════════════════
// Main fragment program
// ════════════════════════════════════════════════════════════════════════════

void main() {
    vec2  uv  = v_uv;
    // Aspect-ratio-corrected UV for scale-invariant caustic patterns
    float ar  = u_res.x / max(u_res.y, 1.0);
    vec2  uvA = vec2(uv.x * ar, uv.y);

    // ── 1. Surface normal ─────────────────────────────────────────────────────
    // Derived from animated noise; drives all refraction / reflection terms.
    vec3 N = surfaceNormal(uv);

    // ── 2. Chromatic refraction (v2 key feature) ──────────────────────────────
    // Per-channel background sample with Cauchy dispersion.
    // Returns black if background texture is not yet ready.
    vec3 refractedBg = chromaticRefraction(uv, N);

    // ── 3. Fresnel factor ─────────────────────────────────────────────────────
    // Map uv to centred coordinates [−1, 1] for the Fresnel computation.
    vec2 centered = uv * 2.0 - 1.0;
    // Reconstruct a view-space normal that includes tilt contributions.
    // The sqrt term approximates the z-component assuming a unit hemisphere.
    vec3 Nfull = normalize(vec3(
        centered * 0.55 + u_tilt * 0.30,
        max(0.001, sqrt(1.0 - dot(centered * 0.55, centered * 0.55)))
    ));
    // Schlick with F0 ≈ 0.04 (air/glass interface)
    float fr = schlick(max(dot(Nfull, vec3(0, 0, 1)), 0.0), 0.04);

    // ── 4. Environment reflection (v2) ────────────────────────────────────────
    vec3 envRefl = environmentReflection(uv, N, fr);

    // ── 5. Voronoi caustic base ───────────────────────────────────────────────
    // 1.7 power concentrates energy into bright caustic filaments.
    float cBase = pow(caustic(uvA), 1.7);

    // Per-channel chromatic caustic: three separate caustic bands offset
    // by small UV deltas to create prismatic colour splitting in the caustic.
    vec3 chromCaustic = vec3(
        pow(causticBand(uvA + vec2( 0.009,  0.004), 3.4, 0.38, 0.0), 1.8) * 0.20,  // Red
        pow(causticBand(uvA + vec2(-0.005, -0.006), 3.4, 0.38, 0.0), 1.8) * 0.16,  // Green
        pow(causticBand(uvA + vec2( 0.004, -0.010), 3.4, 0.38, 0.0), 1.8) * 0.24   // Blue
    );

    // ── 6. Specular highlight ─────────────────────────────────────────────────
    // A virtual light source at lightPos contributes two specular lobes of
    // different widths (soft glow + sharp highlight) plus a secondary bounce
    // light on the opposite side.
    vec2  lightPos = vec2(0.22, 0.18)
                   + u_mouse * 0.28 * u_hover   // Cursor tracking
                   + u_tilt  * 0.12;             // Tilt parallax
    float sd = length(uv - lightPos);

    float specular =
          pow(max(0.0, 1.0 - sd * 2.1),  7.0) * 0.95   // Broad soft glow
        + pow(max(0.0, 1.0 - sd * 5.8), 16.0) * 0.55   // Tight sharp highlight
        + pow(max(0.0, 1.0 - length(uv - (1.0 - lightPos)) * 4.0), 11.0) * 0.14;  // Bounce

    // ── 7. Fresnel edge glow ──────────────────────────────────────────────────
    // Edge-brightening at the glass perimeter, most pronounced at the top and
    // left edges (as if lit from upper-left), with a subtle bottom highlight.
    float edgeR   = length(centered);
    float topEdge = pow(smoothstep(0.15, 0.0, uv.y), 2.3) * 0.65;   // Top bright rim
    float botEdge = pow(smoothstep(0.90, 1.0, uv.y), 3.0) * 0.12;   // Bottom subtle rim
    float lftEdge = pow(smoothstep(0.12, 0.0, uv.x), 2.0) * 0.32;   // Left rim
    float edgeGlow = topEdge + lftEdge + botEdge + fr * 0.28;        // + Fresnel contribution

    // ── 8. Thin-film iridescence ──────────────────────────────────────────────
    // Approximates constructive/destructive interference in a thin film coating.
    // The conic colour pattern rotates with time and tilts with device orientation.
    // Masked to the outer rim (iridMask) to prevent oversaturation at centre.
    float iridMask = smoothstep(0.25, 1.08, edgeR);
    float iridAng  = atan(centered.y, centered.x);
    vec3  irid = (0.5 + 0.5 * cos(
        iridAng * 2.0
        + u_time  * 0.30
        + u_tilt.x * 3.14159
        + vec3(0.0, 2.0944, 4.1888)   // 120° phase offsets for R/G/B
    )) * iridMask * 0.08;

    // ── 9. Prismatic edge caustics ────────────────────────────────────────────
    // A narrow ring of prismatic colour at the very edge of the element,
    // simulating the rainbow fringe of a prism or thick glass edge.
    float prismBand  = smoothstep(0.80, 0.92, edgeR)   // Inner edge of ring
                     * smoothstep(1.06, 0.92, edgeR);  // Outer edge of ring
    vec3  prismColor = (0.5 + 0.5 * cos(
        iridAng  * 4.0
        + u_time * 0.55
        + vec3(0.0, 2.0944, 4.1888)
    )) * prismBand * 0.16;

    // ── 10. Surface undulation (micro-wave noise) ────────────────────────────
    // Two octaves of additive noise at different frequencies and opposing
    // phase directions create a subtle shimmering surface texture, similar
    // to the micro-ripple on a still water surface.
    float wave = gnoise(uv * 5.5 + u_time * 0.11) * 0.013
               + gnoise(uv * 9.2 - u_time * 0.08) * 0.006;

    // ── 11. Composition ───────────────────────────────────────────────────────
    // Additive blend of all terms into a single HDR-range RGB value.
    // The order is intentional: caustics form the base, then specular and
    // edge features are added, then the refracted background is mixed in.
    vec3 col = vec3(cBase * 0.52) + chromCaustic;  // Caustic base (scaled to avoid saturation)
    col += vec3(specular) + vec3(edgeGlow);          // Specular + edge glow
    col += irid + prismColor + vec3(wave);            // Iridescence + prism + micro-wave
    col += envRefl;                                   // Fresnel reflection contribution

    // ── 12. Background refraction blend (core v2 feature) ────────────────────
    // The refracted background is mixed into the glass colour with a mask that:
    //   • Is strongest at the element centre (glass is thick and refracts most)
    //   • Fades toward the edge (glass thins toward the rim)
    //   • Is zero if background is not available (graceful degradation)
    // 0.28 is the maximum blend weight, tuned so caustics remain visible.
    float refrBlend = smoothstep(0.0, 0.18, 1.0 - edgeR) * 0.28 * u_bgReady;
    col = mix(col, refractedBg, refrBlend);

    // ── 13. Vignette mask ─────────────────────────────────────────────────────
    // Smooth roll-off toward the four edges (5% inset on each axis) to avoid
    // hard rectangular clipping and to frame the caustic content naturally.
    float vx = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    float vy = smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    col *= vx * vy;

    // ── 14. Alpha derivation ──────────────────────────────────────────────────
    // Drive opacity from perceived luminance so bright caustic regions are
    // more opaque and dark voids are transparent.  The 1.85 multiplier
    // ensures full opacity is reached well before peak luminance.
    // Final 0.88 caps maximum opacity to preserve the translucent glass feel.
    float luma  = dot(col, vec3(0.299, 0.587, 0.114));
    float alpha = clamp(luma * 1.85, 0.0, 1.0);

    // Output premultiplied RGBA (premultiplied because blendFunc is ONE, ONE_MINUS_SRC_ALPHA)
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

    // ── Bind background texture to unit 1 ─────────────────────────────────────
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, _state.bgTexture);

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
    // ── Breathing border animation ────────────────────────────────────────────
    // Sixteen-sided polygon morphing via border-radius shorthand (H V / H V syntax).
    // The keyframe values are hand-tuned to produce smooth organic motion.
    const breatheKF = _opts.breathe ? `
@keyframes lg-breathe {
     0% { border-radius: 16px 19px 14px 21px / 19px 14px 21px 16px; }
    20% { border-radius: 21px 14px 19px 16px / 14px 21px 16px 19px; }
    40% { border-radius: 14px 22px 16px 18px / 22px 16px 18px 14px; }
    60% { border-radius: 19px 16px 22px 13px / 16px 19px 13px 22px; }
    80% { border-radius: 13px 21px 17px 20px / 21px 17px 20px 13px; }
   100% { border-radius: 16px 19px 14px 21px / 19px 14px 21px 16px; }
}` : '';

    return `
/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-outer — SVG filter wrapper                                              */
/* Provides the stacking context for the chromatic-aberration SVG filter.     */
/* The negative margin + padding trick expands the filter region beyond the   */
/* element bounds so displacement at the edges doesn't get hard-clipped.     */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-outer {
    display: inline-flex;
    position: relative;
    margin: -10px;   /* Expand outward to give filter room to displace pixels  */
    padding: 10px;   /* Compensate inward so content position is unchanged     */
}

/* Display-mode variants: JS reads the element's computed display and sets    */
/* one of these modifier classes to preserve its original layout role.        */
.lg-outer.block { display: block;  }
.lg-outer.flex  { display: flex;   }
.lg-outer.grid  { display: grid;   }

/* Only apply the SVG distortion filter when the user has not requested       */
/* reduced motion, since displacement filtering can cause visual discomfort.  */
@media (prefers-reduced-motion: no-preference) {
    .lg-outer { filter: url(#lg-distort); }
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg — Main glass element                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg {
    /* CSS custom properties (Houdini-registered for smooth transitions) */
    --lg-mx:    50%;   /* Cursor X position within element */
    --lg-my:    30%;   /* Cursor Y position (biased upward to match visual light) */
    --lg-irid:  0deg;  /* Iridescence rotation angle (driven by @keyframes) */
    --lg-hover: 0;     /* Hover intensity (0=idle, 1=hovered, spring-smoothed) */
    --lg-tx:    0;     /* Tilt X angle */
    --lg-ty:    0;     /* Tilt Y angle */

    position:   relative;
    isolation:  isolate;    /* New stacking context for z-index layering      */
    overflow:   hidden;     /* Clip caustic canvas and grain to border-radius */
    border-radius: 16px;

    /* Compositor hint: promotes element to its own GPU layer, preventing     */
    /* backdrop-filter from triggering unnecessary repaints of ancestors.     */
    will-change: transform, box-shadow;

    /* ── Glass body background ─────────────────────────────────────────────  */
    /* Two layers:                                                             */
    /*   1. Radial specular highlight at cursor position (--lg-mx, --lg-my)  */
    /*   2. Very faint white base tint for the glass body                     */
    background:
        radial-gradient(
            ellipse 48% 34% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.08)  0%,
            rgba(255,255,255,0.02) 48%,
            transparent            68%
        ),
        rgba(255,255,255,0.06);

    /* ── Backdrop filter ───────────────────────────────────────────────────  */
    /* blur(26px)      — softens background through glass                     */
    /* saturate(175%)  — increases colour vibrancy of background              */
    /* brightness(1.1) — makes glass feel luminous / bright                   */
    backdrop-filter:         blur(12px) saturate(110%) brightness(1.06);
    -webkit-backdrop-filter: blur(12px) saturate(110%) brightness(1.06);

    /* ── Box shadow stack (7 layers) ──────────────────────────────────────── */
    /* Layer 1: top inner white highlight (bright glass rim at top)           */
    /* Layer 2: left inner white highlight (bright glass rim at left)         */
    /* Layer 3: bottom inner dark edge (shadow under glass)                   */
    /* Layer 4: close drop shadow (near ambient occlusion)                   */
    /* Layer 5: far soft drop shadow (depth and lift)                         */
    /* Layer 6: tight drop shadow (crisp edge definition)                     */
    /* Layer 7: distant purple-tinted glow (iridescent ambient)               */
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
/* .lg::before — Cursor-tracking secondary specular highlight                  */
/* Moves with the cursor via --lg-mx / --lg-my to create a dynamic hotspot.   */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg::before {
    content:  '';
    position: absolute;
    inset:    0;
    border-radius: inherit;
    pointer-events: none;
    z-index:  1;   /* Behind iridescence (::after, z:2) and grain (z:3) */

    background:
        /* Tight primary specular at cursor */
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.28)  0%,
            rgba(255,255,255,0.08) 35%,
            transparent            60%
        ),
        /* Wider secondary bounce */
        radial-gradient(
            ellipse 82% 66% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.05) 0%,
            transparent           64%
        ),
        /* Fixed linear gradient to give a consistent upper-left light bias  */
        linear-gradient(
            142deg,
            rgba(255,255,255,0.16)  0%,
            rgba(255,255,255,0.04) 30%,
            transparent            58%,
            rgba(255,255,255,0.04) 100%
        );

    /* Fast update: the cursor can move quickly so we use a very short        */
    /* transition to keep the highlight snappy (spring physics in JS already   */
    /* smooth this out so CSS transition just removes any remaining stutter).  */
    transition: background .04s linear;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg::after — Thin-film iridescence overlay                                  */
/* A full-surface conic gradient that rotates continuously to simulate thin-   */
/* film interference in a glass surface coating.  overlay blend mode allows    */
/* underlying colours to show through while adding the rainbow tint.          */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg::after {
    content:  '';
    position: absolute;
    inset:    0;
    border-radius: inherit;
    pointer-events: none;
    z-index:  2;

    /* Conic gradient with 7 hue stops at low opacity.                        */
    /* --lg-irid is driven by @keyframes lg-irid-spin.                        */
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

    /* lg-irid-spin @keyframes animates --lg-irid: 0deg → 360deg over 15s.   */
    animation: lg-irid-spin 15s linear infinite;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-grain — Film grain overlay                                               */
/* Adds photographic grain to break up the smooth caustic gradient, reducing  */
/* banding artefacts and giving the glass a more tactile, material quality.   */
/* The grain texture is an inline SVG data-URI to avoid network requests.     */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-grain {
    position: absolute;
    inset:    0;
    border-radius: inherit;
    pointer-events: none;
    z-index:  3;

    will-change: background-position;  /* Promotes layer for position animation */

    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.76' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
    background-size:  240px 240px;

    mix-blend-mode: soft-light;   /* Preserves luminance of underlying layers */
    opacity: .038;                /* Very subtle — just enough to add texture  */

    /* 9-step animation jitters the grain tile position every 120ms to        */
    /* prevent the static noise from appearing as a fixed texture.            */
    animation: lg-grain-shift .12s steps(1) infinite;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* .lg-caustic-canvas — WebGL caustic/refraction overlay                       */
/* The hidden canvas receives drawImage() output from the shared GL context   */
/* each frame.  screen blend mode adds the caustic light to the glass body.   */
/* Opacity transitions from 0 to 0.035 on hover to reveal the effect.        */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-caustic-canvas {
    position: absolute;
    inset:    0;
    width:    100%;
    height:   100%;
    pointer-events: none;
    z-index:  4;
    border-radius:   inherit;
    mix-blend-mode:  screen;      /* Additive blend: caustic adds light, never darkens */
    opacity: 0;
    transition: opacity .35s ease;
}

/* Reveal caustic canvas on hover */
.lg.lg-interactive:hover .lg-caustic-canvas { opacity: 0.035; }


/* ─────────────────────────────────────────────────────────────────────────── */
/* Refraction status indicator (debug attribute — visually hidden)            */
/* data-lg-refract="1" is set when background texture is ready.               */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg[data-lg-refract="1"]::before {
    outline: 1px solid rgba(100, 200, 255, 0.0);  /* No visible effect; hook for DevTools */
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* Content children — must sit above all glass effect layers                  */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg > *:not(.lg-grain):not(.lg-caustic-canvas) {
    position: relative;
    z-index: 5;   /* Above caustic (4), grain (3), iridescence (2), highlight (1) */
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* Interactive state — .lg.lg-interactive                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg.lg-interactive { cursor: pointer; }

/* :hover — brighten specular, expand shadows, increase purple glow          */
.lg.lg-interactive:hover {
    background:
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.35)  0%,
            rgba(255,255,255,0.10) 38%,
            transparent            63%
        ),
        rgba(255,255,255,0.025);
    box-shadow:
        inset  0  2px  0   rgba(255,255,255,0.55),
        inset  1px 0   0   rgba(255,255,255,0.24),
        inset  0 -1px  0   rgba(0,0,0,0.12),
        0 10px 30px  -6px  rgba(0,0,0,0.38),
        0 24px 60px -12px  rgba(0,0,0,0.26),
        0  2px  6px  0     rgba(0,0,0,0.22),
        0  0   65px -18px  rgba(168,138,255,0.34);
}

/* :active — press-down effect via scale + translateY */
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
/* .lg-reply — Chat message reply-quote variant                                */
/* Compact padding, indented left border, sender/text sub-elements.           */
/* ─────────────────────────────────────────────────────────────────────────── */

.lg-reply {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    padding:        8px 12px;
    margin-bottom:  8px;
    border-radius:  10px;

    /* Prominent left-border highlight (chat quote convention) */
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
/* .lg.lg-own — "Own message" blue/purple tint variant                         */
/* Overrides the base glass colour with a violet-tinted gradient for messages  */
/* sent by the local user (as distinct from received messages).               */
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

/* Shift iridescence hue toward purple for lg-own */
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
/* Shape modifier classes                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

/* Pill: full border-radius, horizontal padding only */
.lg.lg-pill { border-radius: 999px; padding: 6px 18px; }

/* Card: larger radius and internal padding for content cards */
.lg.lg-card { border-radius: 22px; padding: 20px; }

/* FAB: circular floating action button */
.lg.lg-fab {
    border-radius: 50%;
    width:  56px;
    height: 56px;
    display:     flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* @keyframes                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/* Iridescence rotation: drives --lg-irid custom property (requires Houdini)  */
@keyframes lg-irid-spin {
    from { --lg-irid: 0deg;   }
    to   { --lg-irid: 360deg; }
}

/* Grain position jitter: 9 steps over 120ms, random-looking xy offsets      */
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
/* Animation assignment rules                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/* Default glass elements: irid-spin + breathe (if enabled)                  */
.lg:not(.lg-pill):not(.lg-fab):not(.lg-reply) {
    animation: lg-irid-spin 15s linear infinite
               ${_opts.breathe ? ', lg-breathe 9s ease-in-out infinite' : ''};
}

/* Shape variants use only irid-spin (their geometry should stay fixed)       */
.lg.lg-pill,
.lg.lg-fab,
.lg.lg-reply  { animation: lg-irid-spin 15s linear infinite; }

/* ::after pseudo-element (iridescence overlay) always spins independently    */
.lg::after    { animation: lg-irid-spin 15s linear infinite; }


/* ─────────────────────────────────────────────────────────────────────────── */
/* @media (prefers-reduced-motion)                                             */
/* Fully disables ALL motion for users who have requested reduced animation.  */
/* Also removes will-change hints to reduce GPU memory usage.                 */
/* ─────────────────────────────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
    .lg,
    .lg::before,
    .lg::after,
    .lg-grain,
    .lg-caustic-canvas {
        animation:   none          !important;
        transition:  none          !important;
        will-change: auto          !important;
    }

    /* Restore constant border-radius (lg-breathe would otherwise freeze mid-morph) */
    .lg { border-radius: 16px !important; transform: none !important; }

    /* Remove SVG distortion filter (motion-triggered by SVG <animate> too)    */
    .lg-outer { filter: none !important; }

    /* Hide WebGL caustic canvas entirely — content is static so no benefit   */
    .lg-caustic-canvas { display: none; }
}
`;
}

/**
 * Injects the generated CSS into a <style> element in <head>.
 * Idempotent — guards against duplicate injection using a stable element ID.
 */
function _injectCSS() {
    // Use a versioned ID so that deploying a new version alongside an old one
    // (e.g. during a rolling deploy) doesn't cause style conflicts.
    if (document.getElementById('liquid-glass-pro-style-200')) return;

    _state.styleEl = Object.assign(document.createElement('style'), {
        id:          'liquid-glass-pro-style-200',
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

    // ── DPR-aware canvas sizing ────────────────────────────────────────────────
    // Cap DPR at 2 to avoid excessive memory usage on 3× displays (Retina Plus).
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const rect = el.getBoundingClientRect();
    const w    = Math.round(rect.width  * dpr) || 1;  // Minimum 1px to avoid 0×0 context
    const h    = Math.round(rect.height * dpr) || 1;

    // ── Caustic canvas ─────────────────────────────────────────────────────────
    // The canvas has CSS class 'lg-caustic-canvas' so the injected stylesheet
    // applies position, blend mode, and opacity transition automatically.
    const cvs       = document.createElement('canvas');
    cvs.className   = 'lg-caustic-canvas';
    cvs.width       = w;
    cvs.height      = h;
    // willReadFrequently: false — we only write to this context (via drawImage),
    // never read back, so no CPU-readback optimisation is needed.
    const ctx2d = cvs.getContext('2d', { alpha: true, willReadFrequently: false });
    // Insert as the first child so it underlies all content children (z-index
    // stacking does the rest, but DOM order acts as a tiebreaker).
    el.insertBefore(cvs, el.firstChild);

    // ── Film grain overlay ─────────────────────────────────────────────────────
    if (_opts.grain && !el.querySelector('.lg-grain')) {
        const grain = createGrainLayer();
        el.insertBefore(grain, cvs.nextSibling);
    }

    // ── Spring state initialisation ────────────────────────────────────────────
    // All springs start at their natural resting position to avoid initial
    // pop/jolt when the element first renders.
    const springX     = _createSpring(0.5);   // Cursor X: 50% = centred
    const springY     = _createSpring(0.3);   // Cursor Y: 30% = upper-centre (light bias)
    const hoverSpring = _createSpring(0);     // Hover: 0 = not hovered
    const tiltX       = _createSpring(0);     // Tilt X: 0 = no tilt
    const tiltY       = _createSpring(0);     // Tilt Y: 0 = no tilt

    // Forward reference — es is used inside event handlers before the object literal.
    let es;

    // ── Pointer event handlers ────────────────────────────────────────────────
    const onMove = e => {
        const r = el.getBoundingClientRect();
        // Map clientX/Y to [0,1] element-local UV coordinates.
        springX.target = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        springY.target = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
        // Tilt is a signed [−1,+1] version of the cursor position offset from centre.
        tiltX.target   = (springX.target - 0.5) * 2;
        tiltY.target   = (springY.target - 0.5) * 2;
        // Keep domRect cache fresh during active pointer movement.
        es.domRect = r;
    };

    const onEnter = () => {
        // Signal transition to hovered state; spring will smoothly interpolate.
        hoverSpring.target = 1;
        es.hovered         = true;
    };

    const onLeave = () => {
        // Return spring targets to resting positions; springs will ease out naturally.
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
    // Uses contentRect (excludes padding and border) consistent with how we
    // size the canvas at attach time using getBoundingClientRect.
    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const cr = entry.contentRect;
            const nw = Math.round(cr.width  * dpr) || 1;
            const nh = Math.round(cr.height * dpr) || 1;
            if (nw !== es.width || nh !== es.height) {
                cvs.width   = es.width  = nw;
                cvs.height  = es.height = nh;
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
        domRect:      rect,          // Cached bounding rect (refreshed every 4 frames)
        pointerMove:  onMove,        // Stored refs for removeEventListener in _detach
        pointerEnter: onEnter,
        pointerLeave: onLeave,
    };

    _elements.set(el, es);
    _tracked.add(el);

    // ── WebGL caustics enablement ──────────────────────────────────────────────
    // Only enable WebGL if:
    //   1. caustics option is true
    //   2. GPU tier is mid or high (low tier → CSS-only)
    //   3. Active element count is under the hard cap
    //   4. WebGL context initialises successfully
    const tier = _detectGpuTier();
    if (_opts.caustics && tier !== 'low' && _activeWebGLCount < MAX_WEBGL_ELEMENTS) {
        if (_initWebGL()) {
            _activeWebGLCount++;
            el.dataset.lgWebgl   = '1';
            // Reflect current background readiness in a data attribute (useful
            // for debugging and for future CSS hooks).
            el.dataset.lgRefract = _state.bgReady ? '1' : '0';
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

    // ── Remove CSS custom properties set by the spring system ─────────────────
    ['--lg-mx', '--lg-my', '--lg-tx', '--lg-ty', '--lg-hover', 'transform']
        .forEach(p => el.style.removeProperty(p));

    // ── Decrement WebGL usage counter ─────────────────────────────────────────
    if (el.dataset.lgWebgl) {
        _activeWebGLCount = Math.max(0, _activeWebGLCount - 1);
        delete el.dataset.lgWebgl;
        delete el.dataset.lgRefract;
    }

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
 * @param {number} ts - Current timestamp in milliseconds.
 */
function _rafLoop(ts) {
    _state.rafId = requestAnimationFrame(_rafLoop);

    // ── Delta time ────────────────────────────────────────────────────────────
    // Convert ms → seconds and clamp to MAX_DT to prevent explosion after
    // the tab returns from being backgrounded/throttled.
    const dt = Math.min((ts - (_lastTs || ts)) * 0.001, MAX_DT);
    _lastTs = ts;

    // ── Device tilt (read once per frame, shared across all elements) ──────────
    const gx = _state.deviceTilt.x;
    const gy = _state.deviceTilt.y;

    // ── Per-element update ────────────────────────────────────────────────────
    for (const el of _tracked) {
        const es = _elements.get(el);
        if (!es) continue;  // Should never happen, but guard defensively

        // Advance all springs
        _stepSpring(es.springX,     SPRING.cursor, dt);
        _stepSpring(es.springY,     SPRING.cursor, dt);
        _stepSpring(es.hoverSpring, SPRING.hover,  dt);
        _stepSpring(es.tiltX,       SPRING.tilt,   dt);
        _stepSpring(es.tiltY,       SPRING.tilt,   dt);

        // When not hovered, let the gyroscope drive tilt (parallax effect).
        // 0.45 dampens the gyroscope influence to prevent extreme tilting
        // at large device angles.
        if (!es.hovered) {
            es.tiltX.target = gx * 0.45;
            es.tiltY.target = gy * 0.45;
        }

        // ── CSS custom property updates ───────────────────────────────────────
        // setProperty() is more efficient than modifying el.style.transform
        // for properties used in ::before / ::after pseudo-elements, since the
        // browser can recalc the pseudo-elements independently.
        el.style.setProperty('--lg-mx',    (es.springX.value * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-my',    (es.springY.value * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-tx',     es.tiltX.value.toFixed(4));
        el.style.setProperty('--lg-ty',     es.tiltY.value.toFixed(4));
        el.style.setProperty('--lg-hover',  es.hoverSpring.value.toFixed(4));

        // ── CSS 3D perspective transform ──────────────────────────────────────
        // rotateX is driven by tiltY (up/down tilt → tilt around horizontal axis)
        // rotateY is driven by tiltX (left/right tilt → tilt around vertical axis)
        // The sign inversion on ry (−tiltX) produces the correct "3D screen"
        // perspective where moving the cursor right tilts the right side away.
        const rx = ( es.tiltY.value * 3.0).toFixed(3);  // degrees (small angles)
        const ry = (-es.tiltX.value * 3.0).toFixed(3);
        el.style.transform = `translateZ(0) perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;

        // ── WebGL caustic render ───────────────────────────────────────────────
        if (el.dataset.lgWebgl) {
            // Refresh the cached bounding rect every 4 rAF frames.
            // (ts | 0) % 4 is a fast integer modulo using bitwise OR.
            if ((ts | 0) % 4 === 0) {
                es.domRect = el.getBoundingClientRect();
            }

            _renderCausticsGL(es, ts);

            // Sync the data-attribute refraction indicator with actual readiness.
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
function _startObserver() {
    // Initial attach: process all existing matching elements.
    document.querySelectorAll(_opts.selector).forEach(_attach);

    // Create observer: childList catches insertions/removals, subtree catches
    // changes anywhere in the document tree (not just direct children of body).
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
    if (_state.ready) return;
    _state.ready = true;

    // Shallow merge: user values override defaults, but unspecified keys
    // retain their default values.
    _opts = { ..._defaults, ...options };

    _registerHoudini();
    _injectSVG();
    _injectCSS();
    _startOrientationTracking();

    if (document.readyState === 'loading') {
        // DOM not yet available — defer until DOMContentLoaded.
        document.addEventListener('DOMContentLoaded', () => {
            _startObserver();
            _startLoop();
        }, { once: true });
    } else {
        // DOM already ready (e.g. script loaded deferred or after load event).
        _startObserver();
        _startLoop();
    }
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
 * @returns {'2.0.1'}
 */
export function version() { return '2.0.1'; }


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
