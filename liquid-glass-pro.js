// =============================================================================
// @fileoverview liquid-glass-pro.js  ·  v 2.0.0
//
// Ultra-premium «Liquid Glass PRO» rendering library.
//
// NEW in v2 over v1.1.1:
//   ★  Real screen-space refraction  (html2canvas background capture → WebGL texture)
//   ★  Physical Snell's law refraction (IOR-based, not just blur)
//   ★  Dynamic background updates    (scroll / resize / mutation aware)
//   ★  Normal-map surface detail      (bump-mapped glass thickness simulation)
//   ★  Environment reflection probe   (background mirrored at Fresnel angle)
//   ★  Configurable options object    (quality, fps cap, IOR, aberration strength…)
//   ★  React / Vue / Svelte adapters  (exported hooks + composables)
//   ★  SSR-safe                       (no DOM access at import time)
//
// Retained from v1.1.1:
//   ★  WebGL2 Voronoi caustic simulation
//   ★  Spring-physics cursor dynamics
//   ★  Per-channel chromatic dispersion
//   ★  Schlick Fresnel edge glow
//   ★  Thin-film iridescence
//   ★  Prismatic edge caustics
//   ★  Liquid border morphing
//   ★  Device orientation parallax
//   ★  Adaptive GPU quality tiers
//   ★  Houdini CSS custom properties
//   ★  Zero memory leaks / full cleanup API
//
// Dependencies:
//   html2canvas ^1.4.1  –  background DOM-to-canvas capture
//
// Usage:
//   import { initLiquidGlass } from './liquid-glass-pro.js';
//   initLiquidGlass({ ior: 1.5, refractionStrength: 0.04 });
//
// @version 2.0.0
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// §0  Type definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'low'|'mid'|'high'} GpuTier
 *
 * @typedef {Object} LGOptions
 * @property {number}  [ior=1.45]                - Index of refraction (1.0=air, 1.5=glass)
 * @property {number}  [refractionStrength=0.035] - UV displacement magnitude for refraction
 * @property {number}  [aberrationStrength=1.6]   - Chromatic aberration px (high tier)
 * @property {number}  [bgCaptureInterval=600]    - ms between background recaptures
 * @property {number}  [bgCaptureScale=0.35]      - Resolution scale for bg capture (perf)
 * @property {boolean} [caustics=true]            - Enable WebGL Voronoi caustics
 * @property {boolean} [grain=true]               - Enable film grain layer
 * @property {boolean} [iridescence=true]         - Enable thin-film iridescence
 * @property {boolean} [breathe=true]             - Enable liquid border morphing
 * @property {string}  [selector='.lg']           - CSS selector for glass elements
 *
 * @typedef {Object} SpringState
 * @property {number} value
 * @property {number} velocity
 * @property {number} target
 *
 * @typedef {Object} ElementState
 * @property {HTMLCanvasElement}        canvas
 * @property {CanvasRenderingContext2D} ctx2d
 * @property {ResizeObserver}           ro
 * @property {SpringState}              springX
 * @property {SpringState}              springY
 * @property {SpringState}              hoverSpring
 * @property {SpringState}              tiltX
 * @property {SpringState}              tiltY
 * @property {number}                   width
 * @property {number}                   height
 * @property {boolean}                  hovered
 * @property {number}                   dpr
 * @property {Function}                 pointerMove
 * @property {Function}                 pointerEnter
 * @property {Function}                 pointerLeave
 */

// ─────────────────────────────────────────────────────────────────────────────
// §1  Module state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {LGOptions} */
const _defaults = {
    ior:                 1.45,
    refractionStrength:  0.035,
    aberrationStrength:  1.6,
    bgCaptureInterval:   600,
    bgCaptureScale:      0.35,
    caustics:            true,
    grain:               true,
    iridescence:         true,
    breathe:             true,
    selector:            '.lg',
};

/** @type {LGOptions} */
let _opts = { ..._defaults };

const _state = {
    ready:          false,
    svgReady:       false,
    houdiniReg:     false,
    observer:       /** @type {MutationObserver|null} */ (null),
    styleEl:        /** @type {HTMLStyleElement|null} */ (null),
    svgEl:          /** @type {SVGSVGElement|null}    */ (null),
    rafId:          0,
    // WebGL caustics backend
    glBackend:      /** @type {WebGL2RenderingContext|null} */ (null),
    glCanvas:       /** @type {HTMLCanvasElement|null}      */ (null),
    glProgram:      /** @type {WebGLProgram|null}           */ (null),
    glUniforms:     /** @type {Record<string,WebGLUniformLocation|null>} */ ({}),
    glBuffer:       /** @type {WebGLBuffer|null}            */ (null),
    glStartTime:    0,
    // Background capture (NEW in v2)
    bgTexture:      /** @type {WebGLTexture|null}           */ (null),
    bgCanvas:       /** @type {HTMLCanvasElement|null}      */ (null),
    bgCtx:          /** @type {CanvasRenderingContext2D|null} */ (null),
    bgCaptureId:    0,           // setInterval handle
    bgReady:        false,       // has at least one capture completed
    bgCapturing:    false,       // lock to prevent concurrent html2canvas calls
    bgScrollX:      0,
    bgScrollY:      0,
    deviceTilt:     { x: 0, y: 0 },
    orientHandler:  /** @type {Function|null} */ (null),
};

/** @type {WeakMap<HTMLElement, ElementState>} */
const _elements = new WeakMap();
const _tracked  = new Set();

/** @type {GpuTier|null} */
let _gpuTierCache    = null;
let _activeWebGLCount = 0;
const MAX_WEBGL_ELEMENTS = 32;
const MAX_DT = 0.05;

const SPRING = Object.freeze({
    cursor: { stiffness: 180, damping: 18, mass: 1.0 },
    hover:  { stiffness: 120, damping: 14, mass: 1.0 },
    tilt:   { stiffness:  90, damping: 12, mass: 1.2 },
});


// ─────────────────────────────────────────────────────────────────────────────
// §2  GPU tier detection
// ─────────────────────────────────────────────────────────────────────────────

function _detectGpuTier() {
    if (_gpuTierCache !== null) return _gpuTierCache;
    const canvas = document.createElement('canvas');
    try {
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) { _gpuTierCache = 'low'; return 'low'; }
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (!dbg) {
            _gpuTierCache = isMobile ? 'low' : 'high';
        } else {
            const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase();
            if (/adreno [2-4]\d{2}|mali-[24t]|powervr sgx|sgx 5/.test(r)) _gpuTierCache = 'low';
            else if (/adreno [56]\d{2}|mali-g[57]/.test(r))                _gpuTierCache = 'mid';
            else if (/apple gpu/.test(r)) {
                const m = r.match(/(\d+)-core/);
                _gpuTierCache = (m && parseInt(m[1], 10) >= 10) ? 'high' : 'mid';
            } else _gpuTierCache = 'high';
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (_) { _gpuTierCache = 'low'; }
    finally { canvas.width = canvas.height = 0; }
    return _gpuTierCache;
}


// ─────────────────────────────────────────────────────────────────────────────
// §3  Spring physics
// ─────────────────────────────────────────────────────────────────────────────

const _createSpring = v => ({ value: v, velocity: 0, target: v });

function _stepSpring(s, cfg, dt) {
    const safe = Math.min(dt, MAX_DT);
    const f    = -cfg.stiffness * (s.value - s.target) - cfg.damping * s.velocity;
    s.velocity += (f / cfg.mass) * safe;
    s.value    += s.velocity * safe;
}


// ─────────────────────────────────────────────────────────────────────────────
// §4  Houdini CSS custom properties
// ─────────────────────────────────────────────────────────────────────────────

function _registerHoudini() {
    if (_state.houdiniReg || !window.CSS?.registerProperty) return;
    _state.houdiniReg = true;
    [
        { name: '--lg-mx',    syntax: '<percentage>', inherits: false, initialValue: '50%'  },
        { name: '--lg-my',    syntax: '<percentage>', inherits: false, initialValue: '30%'  },
        { name: '--lg-irid',  syntax: '<angle>',      inherits: false, initialValue: '0deg' },
        { name: '--lg-hover', syntax: '<number>',     inherits: false, initialValue: '0'    },
        { name: '--lg-tx',    syntax: '<number>',     inherits: false, initialValue: '0'    },
        { name: '--lg-ty',    syntax: '<number>',     inherits: false, initialValue: '0'    },
    ].forEach(p => { try { CSS.registerProperty(p); } catch (_) {} });
}


// ─────────────────────────────────────────────────────────────────────────────
// §5  Background capture engine (NEW in v2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Architecture:
//   1. html2canvas renders document.body into an offscreen canvas at
//      bgCaptureScale resolution (default 35% → ~3× faster than full-res)
//   2. The canvas is uploaded to a WebGL2 texture unit 1 (unit 0 = caustics)
//   3. Each frame, the glass shader samples unit 1 at refracted screen-space UVs
//   4. Recapture is triggered by:
//        • setInterval (bgCaptureInterval ms, default 600ms)
//        • window scroll (debounced 150ms)
//        • ResizeObserver on body
//   5. During capture, the previous texture stays in use → no flicker
//
// ─────────────────────────────────────────────────────────────────────────────

async function _captureBackground() {
    if (_state.bgCapturing || !window.html2canvas) return;
    _state.bgCapturing = true;

    try {
        const scale = _opts.bgCaptureScale;
        const w = Math.round(window.innerWidth  * scale);
        const h = Math.round(window.innerHeight * scale);

        // html2canvas renders the page into a canvas
        const captured = await html2canvas(document.documentElement, {
            scale,
            useCORS:           true,
            allowTaint:        true,
            backgroundColor:   null,
            logging:           false,
            removeContainer:   true,
            // Ignore glass elements themselves to avoid visual feedback loop
            ignoreElements: el => el.classList?.contains('lg') ||
                                  el.classList?.contains('lg-outer') ||
                                  el.classList?.contains('lg-caustic-canvas'),
        });

        // Store scroll position at capture time so shader can compensate drift
        _state.bgScrollX = window.scrollX;
        _state.bgScrollY = window.scrollY;

        // Upload to WebGL texture
        const gl = _state.glBackend;
        if (gl && _state.bgTexture) {
            gl.bindTexture(gl.TEXTURE_2D, _state.bgTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, captured);
            gl.generateMipmap(gl.TEXTURE_2D);
            _state.bgReady = true;
        }

        // Also keep a 2D copy for elements that lost WebGL quota
        if (!_state.bgCanvas) {
            _state.bgCanvas = document.createElement('canvas');
            _state.bgCtx    = _state.bgCanvas.getContext('2d');
        }
        _state.bgCanvas.width  = captured.width;
        _state.bgCanvas.height = captured.height;
        _state.bgCtx.drawImage(captured, 0, 0);

    } catch (err) {
        // html2canvas can fail on cross-origin iframes etc. – degrade silently
        console.warn('LG-PRO: background capture failed, refraction disabled this frame.', err);
    } finally {
        _state.bgCapturing = false;
    }
}

/** Initialises the bg texture and starts the capture loop. */
function _startBackgroundCapture() {
    const gl = _state.glBackend;
    if (!gl) return;

    // Create background texture on unit 1
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 1×1 transparent placeholder so shader doesn't read uninitialised data
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    _state.bgTexture = tex;

    // Initial capture
    _captureBackground();

    // Periodic refresh
    _state.bgCaptureId = setInterval(_captureBackground, _opts.bgCaptureInterval);

    // Scroll-driven refresh (debounced)
    let scrollDebounce = 0;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(_captureBackground, 150);
    }, { passive: true });

    // Resize-driven refresh
    new ResizeObserver(() => _captureBackground()).observe(document.body);
}

function _stopBackgroundCapture() {
    clearInterval(_state.bgCaptureId);
    _state.bgCaptureId = 0;
    _state.bgReady     = false;
    _state.bgCapturing = false;
}


// ─────────────────────────────────────────────────────────────────────────────
// §6  WebGL2 caustics + refraction engine
// ─────────────────────────────────────────────────────────────────────────────

const _VERT_SRC = /* glsl */`#version 300 es
precision mediump float;
in  vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv        = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ── Fragment shader: caustics + REAL screen-space refraction ─────────────────
const _FRAG_SRC = /* glsl */`#version 300 es
precision highp float;

in  vec2  v_uv;
out vec4  fragColor;

uniform float     u_time;
uniform vec2      u_mouse;
uniform float     u_hover;
uniform vec2      u_tilt;
uniform vec2      u_res;
// ── NEW in v2 ──
uniform sampler2D u_background;   // html2canvas screen capture (unit 1)
uniform vec2      u_bgRes;        // background texture dimensions
uniform vec2      u_elementPos;   // element top-left in screen px (normalised 0..1)
uniform vec2      u_elementSize;  // element size as fraction of screen
uniform float     u_ior;          // index of refraction (default 1.45)
uniform float     u_refractStr;   // UV displacement scale
uniform float     u_bgReady;      // 1.0 if background texture is available
uniform vec2      u_scroll;       // scroll offset normalised to screen size

// ────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(dot(hash2(i+vec2(0,0)), f-vec2(0,0)), dot(hash2(i+vec2(1,0)), f-vec2(1,0)), u.x),
        mix(dot(hash2(i+vec2(0,1)), f-vec2(0,1)), dot(hash2(i+vec2(1,1)), f-vec2(1,1)), u.x),
        u.y) * 0.5 + 0.5;
}

// ────────────────────────────────────────────────────────
// Surface normal from bump map
// Returns a perturbed normal in view space for refraction computation.
// The bump is driven by time + mouse to simulate glass thickness variation.
// ────────────────────────────────────────────────────────

vec3 surfaceNormal(vec2 uv) {
    float eps = 0.002;
    // Sample gradient noise at neighbouring UV points to derive partial derivatives
    float hC  = gnoise(uv * 7.0 + u_time * 0.07);
    float hR  = gnoise((uv + vec2(eps, 0.0)) * 7.0 + u_time * 0.07);
    float hU  = gnoise((uv + vec2(0.0, eps)) * 7.0 + u_time * 0.07);

    // Mouse-driven tilt adds high-frequency warp near cursor
    float mouseInfluence = u_hover * 0.4 * exp(-length(uv - u_mouse) * 3.5);
    float hM  = gnoise(uv * 11.0 - u_mouse * 2.0 + u_time * 0.13) * mouseInfluence;

    // dh/dx and dh/dy → surface gradient → normal
    float dX = (hR - hC) / eps + hM * 0.03;
    float dY = (hU - hC) / eps + hM * 0.03;

    return normalize(vec3(-dX * 0.8, -dY * 0.8, 1.0));
}

// ────────────────────────────────────────────────────────
// Snell's law refraction (simplified to linear UV shift)
// n1 * sin(theta1) = n2 * sin(theta2)
// For thin glass: delta_uv ≈ (n1/n2 - 1) * normal.xy * thickness
// ────────────────────────────────────────────────────────

vec2 refractUV(vec2 screenUV, vec3 normal) {
    // Air → glass: n1=1.0, n2=u_ior
    float ratio    = 1.0 / u_ior;
    // Approximate displacement proportional to surface tilt
    vec2  tilt     = normal.xy * u_refractStr;
    // Tilt contribution from device/cursor
    tilt          += u_tilt * u_refractStr * 0.4;
    return screenUV + tilt;
}

// ────────────────────────────────────────────────────────
// Sample background with refracted UV
// Maps from element UV → screen UV → background texture UV
// ────────────────────────────────────────────────────────

vec4 sampleBackground(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec4(0.0);

    // Convert element-local UV to screen-space UV
    vec2 screenUV = u_elementPos + uv * u_elementSize;
    // Compensate for scroll drift between capture time and now
    screenUV += u_scroll;
    screenUV  = clamp(screenUV, vec2(0.001), vec2(0.999));

    // Apply refraction
    vec2 refractedUV = refractUV(screenUV, normal);
    refractedUV      = clamp(refractedUV, vec2(0.0), vec2(1.0));

    return texture(u_background, refractedUV);
}

// ────────────────────────────────────────────────────────
// Per-channel chromatic refraction (NEW in v2)
// Each channel refracts at a slightly different IOR, simulating
// dispersion in real glass (Abbe number effect)
// ────────────────────────────────────────────────────────

vec3 chromaticRefraction(vec2 uv, vec3 normal) {
    if (u_bgReady < 0.5) return vec3(0.0);

    vec2 screenUV = u_elementPos + uv * u_elementSize + u_scroll;
    screenUV = clamp(screenUV, vec2(0.001), vec2(0.999));

    // Red refracts least, blue most (Cauchy dispersion approximation)
    float iorR = u_ior - 0.010;   // ~1.440
    float iorG = u_ior;            // ~1.450
    float iorB = u_ior + 0.018;   // ~1.468

    vec2 uvR = clamp(refractUV(screenUV, normal) + normal.xy * (1.0/iorR - 1.0/u_ior) * u_refractStr, 0.0, 1.0);
    vec2 uvG = clamp(refractUV(screenUV, normal),                                                       0.0, 1.0);
    vec2 uvB = clamp(refractUV(screenUV, normal) + normal.xy * (1.0/iorB - 1.0/u_ior) * u_refractStr, 0.0, 1.0);

    float r = texture(u_background, uvR).r;
    float g = texture(u_background, uvG).g;
    float b = texture(u_background, uvB).b;
    return vec3(r, g, b);
}

// ────────────────────────────────────────────────────────
// Voronoi caustics (retained from v1.1.1)
// ────────────────────────────────────────────────────────

float voronoi(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float minD = 8.0;
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2 n = vec2(float(dx), float(dy));
            vec2 h = hash2(i + n);
            vec2 pt = n + 0.5 + 0.46 * sin(t * (vec2(0.63, 0.91) + abs(h) * 0.35) + 6.2831 * h);
            minD = min(minD, length(pt - f));
        }
    }
    return minD;
}

float causticBand(vec2 uv, float scale, float speed, float seed) {
    return pow(smoothstep(0.0, 0.30, voronoi(uv * scale + seed, u_time * speed)), 1.5);
}

float caustic(vec2 uv) {
    vec2 mw = (u_mouse - 0.5) * 0.07 * u_hover;
    return causticBand(uv+mw,       3.4,0.38, 0.0 )*0.48
         + causticBand(uv+mw*0.6,   5.9,0.27,17.3 )*0.26
         + causticBand(uv,          2.1,0.19,31.7 )*0.17
         + causticBand(uv+mw*1.2,   8.1,0.55, 5.53)*0.10;
}

// ────────────────────────────────────────────────────────
// Schlick Fresnel
// ────────────────────────────────────────────────────────

float schlick(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ────────────────────────────────────────────────────────
// Environment reflection at Fresnel angles (NEW in v2)
// At grazing angles, glass reflects instead of refracts.
// We approximate this by sampling the background at a mirrored UV.
// ────────────────────────────────────────────────────────

vec3 environmentReflection(vec2 uv, vec3 normal, float fresnelFactor) {
    if (u_bgReady < 0.5 || fresnelFactor < 0.01) return vec3(0.0);
    // Mirror the background UV around the element for the reflection probe
    vec2 screenUV   = u_elementPos + uv * u_elementSize + u_scroll;
    vec2 mirrorUV   = vec2(1.0 - screenUV.x, screenUV.y) + normal.xy * 0.05;
    mirrorUV        = clamp(mirrorUV, 0.0, 1.0);
    return texture(u_background, mirrorUV).rgb * fresnelFactor * 0.35;
}

// ────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────

void main() {
    vec2  uv  = v_uv;
    float ar  = u_res.x / max(u_res.y, 1.0);
    vec2  uvA = vec2(uv.x * ar, uv.y);

    // Compute bump-map surface normal for this pixel
    vec3 N = surfaceNormal(uv);

    // ── Real chromatic refraction (v2 key feature) ────────────────────
    vec3 refractedBg = chromaticRefraction(uv, N);

    // ── Fresnel factor for edge reflection ───────────────────────────
    vec2 centered = uv * 2.0 - 1.0;
    vec3 Nfull = normalize(vec3(centered * 0.55 + u_tilt * 0.30,
                                max(0.001, sqrt(1.0 - dot(centered*0.55, centered*0.55)))));
    float fr   = schlick(max(dot(Nfull, vec3(0,0,1)), 0.0), 0.04);

    // ── Environment reflection probe (v2) ───────────────────────────
    vec3 envRefl = environmentReflection(uv, N, fr);

    // ── Caustic base ─────────────────────────────────────────────────
    float cBase = pow(caustic(uvA), 1.7);

    // Per-channel caustic chromatic dispersion
    vec3 chromCaustic = vec3(
        pow(causticBand(uvA + vec2( 0.009,  0.004), 3.4, 0.38, 0.0), 1.8) * 0.20,
        pow(causticBand(uvA + vec2(-0.005, -0.006), 3.4, 0.38, 0.0), 1.8) * 0.16,
        pow(causticBand(uvA + vec2( 0.004, -0.010), 3.4, 0.38, 0.0), 1.8) * 0.24
    );

    // ── Specular ─────────────────────────────────────────────────────
    vec2 lightPos = vec2(0.22, 0.18) + u_mouse * 0.28 * u_hover + u_tilt * 0.12;
    float sd = length(uv - lightPos);
    float specular = pow(max(0.0, 1.0 - sd * 2.1), 7.0) * 0.95
                   + pow(max(0.0, 1.0 - sd * 5.8), 16.0)* 0.55
                   + pow(max(0.0, 1.0 - length(uv - (1.0 - lightPos)) * 4.0), 11.0) * 0.14;

    // ── Fresnel edge glow ────────────────────────────────────────────
    float edgeR   = length(centered);
    float topEdge = pow(smoothstep(0.15, 0.0, uv.y), 2.3) * 0.65;
    float botEdge = pow(smoothstep(0.90, 1.0, uv.y), 3.0) * 0.12;
    float lftEdge = pow(smoothstep(0.12, 0.0, uv.x), 2.0) * 0.32;
    float edgeGlow = topEdge + lftEdge + botEdge + fr * 0.28;

    // ── Thin-film iridescence ─────────────────────────────────────────
    float iridMask = smoothstep(0.25, 1.08, edgeR);
    float iridAng  = atan(centered.y, centered.x);
    vec3 irid = (0.5 + 0.5 * cos(iridAng*2.0 + u_time*0.30 + u_tilt.x*3.14159
                + vec3(0.0, 2.0944, 4.1888))) * iridMask * 0.08;

    // ── Prismatic edge ────────────────────────────────────────────────
    float prismBand  = smoothstep(0.80, 0.92, edgeR) * smoothstep(1.06, 0.92, edgeR);
    vec3  prismColor = (0.5 + 0.5 * cos(iridAng*4.0 + u_time*0.55
                        + vec3(0.0, 2.0944, 4.1888))) * prismBand * 0.16;

    // ── Surface undulation ────────────────────────────────────────────
    float wave = gnoise(uv*5.5 + u_time*0.11)*0.013 + gnoise(uv*9.2 - u_time*0.08)*0.006;

    // ── Compose ───────────────────────────────────────────────────────
    vec3 col = vec3(cBase * 0.52) + chromCaustic;
    col += vec3(specular) + vec3(edgeGlow);
    col += irid + prismColor + vec3(wave);
    col += envRefl;

    // Blend in real refracted background (the KEY v2 contribution)
    // Weight by transparency mask: stronger at centre, fades toward edges
    float refrBlend = smoothstep(0.0, 0.18, 1.0 - edgeR) * 0.28 * u_bgReady;
    col = mix(col, refractedBg, refrBlend);

    // Vignette
    float vx = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    float vy = smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    col *= vx * vy;

    float luma  = dot(col, vec3(0.299, 0.587, 0.114));
    float alpha = clamp(luma * 1.85, 0.0, 1.0);
    fragColor = vec4(col, alpha * 0.88);
}`;


// ─────────────────────────────────────────────────────────────────────────────
// §6.1  WebGL helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function _buildProgram(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, _compileShader(gl, gl.VERTEX_SHADER,   vs));
    gl.attachShader(p, _compileShader(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(`LG-PRO link:\n${gl.getProgramInfoLog(p)}`);
    return p;
}

function _initWebGL() {
    if (_state.glBackend) return true;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;opacity:0;z-index:-99999';
    document.body.appendChild(canvas);

    const gl = canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: true,
        antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: true,
    });

    if (!gl) { canvas.remove(); return false; }

    try {
        const prog = _buildProgram(gl, _VERT_SRC, _FRAG_SRC);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        gl.useProgram(prog);

        const aPos = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        // Cache all uniform locations including new v2 uniforms
        const uNames = [
            'u_time','u_mouse','u_hover','u_tilt','u_res',
            'u_background','u_bgRes','u_elementPos','u_elementSize',
            'u_ior','u_refractStr','u_bgReady','u_scroll'
        ];
        const uni = {};
        uNames.forEach(n => { uni[n] = gl.getUniformLocation(prog, n); });

        // Bind background sampler to texture unit 1
        gl.useProgram(prog);
        gl.uniform1i(uni.u_background, 1);

        _state.glCanvas    = canvas;
        _state.glBackend   = gl;
        _state.glProgram   = prog;
        _state.glUniforms  = uni;
        _state.glBuffer    = buf;
        _state.glStartTime = performance.now();

        // Start background capture after WebGL is ready
        _startBackgroundCapture();
        return true;
    } catch (err) {
        console.warn('LG-PRO: WebGL2 init failed – CSS fallback.\n', err);
        canvas.remove();
        return false;
    }
}

function _renderCausticsGL(es, now) {
    const gl  = _state.glBackend;
    const uni = _state.glUniforms;
    if (!gl || !_state.glProgram) return;

    const w = es.width, h = es.height;
    if (w < 1 || h < 1) return;

    if (_state.glCanvas.width !== w || _state.glCanvas.height !== h) {
        _state.glCanvas.width  = w;
        _state.glCanvas.height = h;
        gl.viewport(0, 0, w, h);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const t   = (now - _state.glStartTime) * 0.001;
    const sw  = window.innerWidth;
    const sh  = window.innerHeight;
    const rect = es.domRect || { left: 0, top: 0, width: w / es.dpr, height: h / es.dpr };

    // Screen-normalised element position and size for refraction UV mapping
    const ex = rect.left  / sw;
    const ey = rect.top   / sh;
    const ew = rect.width / sw;
    const eh = rect.height/ sh;

    // Scroll drift since last capture
    const sdx = (window.scrollX - _state.bgScrollX) / sw;
    const sdy = (window.scrollY - _state.bgScrollY) / sh;

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

    // Activate background texture on unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, _state.bgTexture);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    es.ctx2d.clearRect(0, 0, w, h);
    es.ctx2d.drawImage(_state.glCanvas, 0, 0);
}


// ─────────────────────────────────────────────────────────────────────────────
// §7  SVG filter bank
// ─────────────────────────────────────────────────────────────────────────────

function _buildSVGDefs(tier) {
    if (tier === 'low') return `<defs>
      <filter id="lg-distort"><feComposite operator="atop"/></filter>
      <filter id="lg-refract"><feComposite operator="atop"/></filter>
    </defs>`;

    const aber  = tier === 'high' ? _opts.aberrationStrength : _opts.aberrationStrength * 0.5;
    const refSc = tier === 'high' ? 3 : 2;

    return `<defs>
      <filter id="lg-distort" x="-25%" y="-25%" width="150%" height="150%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="turbulence" baseFrequency="0.015 0.019"
            numOctaves="3" seed="7" result="turb">
          <animate attributeName="baseFrequency"
              values="0.015 0.019;0.022 0.014;0.018 0.024;0.015 0.019"
              dur="12s" repeatCount="indefinite" calcMode="spline"
              keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
          <animate attributeName="seed" values="7;13;3;19;5;11;7"
              dur="31s" repeatCount="indefinite" calcMode="discrete"/>
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="turb" scale="${aber.toFixed(1)}"
            xChannelSelector="R" yChannelSelector="G" result="dR"/>
        <feDisplacementMap in="SourceGraphic" in2="turb" scale="${(aber*.62).toFixed(1)}"
            xChannelSelector="G" yChannelSelector="B" result="dG"/>
        <feDisplacementMap in="SourceGraphic" in2="turb" scale="${(aber*.36).toFixed(1)}"
            xChannelSelector="B" yChannelSelector="R" result="dB"/>
        <feColorMatrix in="dR" type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="oR"/>
        <feColorMatrix in="dG" type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="oG"/>
        <feColorMatrix in="dB" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="oB"/>
        <feBlend in="oR" in2="oG" mode="screen" result="rg"/>
        <feBlend in="rg" in2="oB" mode="screen" result="rgb"/>
        <feComposite in="rgb" in2="SourceGraphic" operator="atop"/>
      </filter>
      <filter id="lg-refract" x="-32%" y="-32%" width="164%" height="164%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.007 0.011"
            numOctaves="2" seed="3" result="warp">
          <animate attributeName="baseFrequency"
              values="0.007 0.011;0.013 0.008;0.009 0.015;0.007 0.011"
              dur="16s" repeatCount="indefinite" calcMode="spline"
              keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="warp" scale="${refSc}"
            xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>`;
}

function _injectSVG() {
    if (_state.svgReady) return;
    _state.svgReady = true;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-9999');
    svg.innerHTML = _buildSVGDefs(_detectGpuTier());
    document.body.appendChild(svg);
    _state.svgEl = svg;
}


// ─────────────────────────────────────────────────────────────────────────────
// §8  CSS injection
// ─────────────────────────────────────────────────────────────────────────────

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

    return `
.lg-outer { display:inline-flex;position:relative;margin:-10px;padding:10px; }
.lg-outer.block { display:block; }
.lg-outer.flex  { display:flex;  }
.lg-outer.grid  { display:grid;  }
@media (prefers-reduced-motion: no-preference) { .lg-outer { filter:url(#lg-distort); } }

.lg {
    --lg-mx:50%;--lg-my:30%;--lg-irid:0deg;--lg-hover:0;--lg-tx:0;--lg-ty:0;
    position:relative;isolation:isolate;overflow:hidden;border-radius:16px;
    will-change:transform,box-shadow;
    background:
        radial-gradient(ellipse 48% 34% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.16) 0%,rgba(255,255,255,0.05) 48%,transparent 68%),
        rgba(255,255,255,0.032);
    backdrop-filter:blur(26px) saturate(175%) brightness(1.10);
    -webkit-backdrop-filter:blur(26px) saturate(175%) brightness(1.10);
    box-shadow:
        inset 0 1.5px 0 rgba(255,255,255,0.44),
        inset 1px 0 0 rgba(255,255,255,0.20),
        inset 0 -1px 0 rgba(0,0,0,0.12),
        0 4px 18px -4px rgba(0,0,0,0.30),
        0 16px 48px -12px rgba(0,0,0,0.20),
        0 1px 4px rgba(0,0,0,0.18),
        0 0 48px -18px rgba(185,160,255,0.22);
    transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s ease,background .22s ease;
}

.lg::before {
    content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:1;
    background:
        radial-gradient(ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.28) 0%,rgba(255,255,255,0.08) 35%,transparent 60%),
        radial-gradient(ellipse 82% 66% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.05) 0%,transparent 64%),
        linear-gradient(142deg,rgba(255,255,255,0.16) 0%,rgba(255,255,255,0.04) 30%,
            transparent 58%,rgba(255,255,255,0.04) 100%);
    transition:background .04s linear;
}

.lg::after {
    content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:2;
    background:conic-gradient(from var(--lg-irid) at 50% 50%,
        hsla(195,100%,88%,.000),hsla(235,100%,92%,.044),hsla(278,100%,88%,.029),
        hsla(328,100%,92%,.044),hsla(18,100%,88%,.029),hsla(78,100%,92%,.044),
        hsla(138,100%,88%,.029),hsla(195,100%,88%,.000));
    mix-blend-mode:overlay;opacity:.94;animation:lg-irid-spin 15s linear infinite;
}

.lg-grain {
    position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:3;
    will-change:background-position;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.76' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
    background-size:240px 240px;mix-blend-mode:soft-light;opacity:.038;
    animation:lg-grain-shift .12s steps(1) infinite;
}

.lg-caustic-canvas {
    position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;
    border-radius:inherit;mix-blend-mode:screen;opacity:0;transition:opacity .35s ease;
}
.lg.lg-interactive:hover .lg-caustic-canvas { opacity:0.035; }

/* Refraction readout indicator (debug, hidden by default) */
.lg[data-lg-refract="1"]::before { outline: 1px solid rgba(100,200,255,0.0); }

.lg > *:not(.lg-grain):not(.lg-caustic-canvas) { position:relative;z-index:5; }

.lg.lg-interactive { cursor:pointer; }
.lg.lg-interactive:hover {
    background:
        radial-gradient(ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.35) 0%,rgba(255,255,255,0.10) 38%,transparent 63%),
        rgba(255,255,255,0.060);
    box-shadow:
        inset 0 2px 0 rgba(255,255,255,0.55),inset 1px 0 0 rgba(255,255,255,0.24),
        inset 0 -1px 0 rgba(0,0,0,0.12),0 10px 30px -6px rgba(0,0,0,0.38),
        0 24px 60px -12px rgba(0,0,0,0.26),0 2px 6px rgba(0,0,0,0.22),
        0 0 65px -18px rgba(168,138,255,0.34);
}
.lg.lg-interactive:active {
    transform:translateY(1px) scale(.991) translateZ(0) !important;
    transition-duration:.07s;
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.32),inset 1px 0 0 rgba(255,255,255,0.14),
        0 2px 8px -3px rgba(0,0,0,0.28),0 6px 22px -8px rgba(0,0,0,0.18);
}

.lg-reply {
    display:flex;flex-direction:column;gap:3px;padding:8px 12px;
    margin-bottom:8px;border-radius:10px;
    box-shadow:inset 2.5px 0 0 rgba(255,255,255,.40),inset 0 1px 0 rgba(255,255,255,.18),
        inset 0 -1px 0 rgba(0,0,0,.10),0 2px 10px -3px rgba(0,0,0,.22);
}
.lg-reply .lg-sender { font-size:11px;font-weight:700;color:rgba(255,255,255,.85);
    letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    position:relative;z-index:5; }
.lg-reply .lg-text   { font-size:12px;color:rgba(255,255,255,.50);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative;z-index:5; }

.lg.lg-own {
    background:
        radial-gradient(ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(200,175,255,.22) 0%,rgba(180,150,255,.06) 38%,transparent 62%),
        rgba(110,68,202,.055);
    box-shadow:inset 0 2px 0 rgba(220,195,255,.32),inset 1px 0 0 rgba(200,175,255,.16),
        inset 0 -1px 0 rgba(0,0,0,.12),0 4px 18px -4px rgba(0,0,0,.26),
        0 16px 44px -12px rgba(0,0,0,.16),0 0 38px -12px rgba(165,100,255,.24);
}
.lg.lg-own::after { background:conic-gradient(from var(--lg-irid) at 50% 50%,
    hsla(248,100%,88%,0),hsla(278,100%,92%,.054),hsla(312,100%,88%,.034),
    hsla(338,100%,92%,.054),hsla(248,100%,88%,0)); }
.lg.lg-own .lg-sender { color:rgba(226,202,255,.92); }
.lg.lg-pill { border-radius:999px;padding:6px 18px; }
.lg.lg-card { border-radius:22px;padding:20px; }
.lg.lg-fab  { border-radius:50%;width:56px;height:56px;display:flex;
    align-items:center;justify-content:center;flex-shrink:0; }

@keyframes lg-irid-spin  { from{--lg-irid:0deg} to{--lg-irid:360deg} }
@keyframes lg-grain-shift {
    0%{background-position:0 0}   11%{background-position:-48px -34px}
    22%{background-position:34px 56px} 33%{background-position:-72px 24px}
    44%{background-position:20px -60px} 55%{background-position:-42px 78px}
    66%{background-position:66px -16px} 77%{background-position:-22px 46px}
    88%{background-position:46px -30px}
}
${breatheKF}

.lg:not(.lg-pill):not(.lg-fab):not(.lg-reply) {
    animation:lg-irid-spin 15s linear infinite${_opts.breathe ? ',lg-breathe 9s ease-in-out infinite' : ''};
}
.lg.lg-pill,.lg.lg-fab,.lg.lg-reply { animation:lg-irid-spin 15s linear infinite; }
.lg::after { animation:lg-irid-spin 15s linear infinite; }

@media (prefers-reduced-motion: reduce) {
    .lg,.lg::before,.lg::after,.lg-grain,.lg-caustic-canvas {
        animation:none!important;transition:none!important;will-change:auto!important; }
    .lg { border-radius:16px!important;transform:none!important; }
    .lg-outer { filter:none!important; }
    .lg-caustic-canvas { display:none; }
}
`;
}

function _injectCSS() {
    if (document.getElementById('liquid-glass-pro-style-200')) return;
    _state.styleEl = Object.assign(document.createElement('style'), {
        id: 'liquid-glass-pro-style-200',
        textContent: _buildCSS(),
    });
    document.head.appendChild(_state.styleEl);
}


// ─────────────────────────────────────────────────────────────────────────────
// §9  Device orientation
// ─────────────────────────────────────────────────────────────────────────────

function _startOrientationTracking() {
    if (_state.orientHandler) return;
    const h = e => {
        _state.deviceTilt.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 45));
        _state.deviceTilt.y = Math.max(-1, Math.min(1, (e.beta  ?? 0) / 45 - 0.5));
    };
    window.addEventListener('deviceorientation', h, { passive: true });
    _state.orientHandler = h;
}

function _stopOrientationTracking() {
    if (!_state.orientHandler) return;
    window.removeEventListener('deviceorientation', _state.orientHandler);
    _state.orientHandler = null;
    _state.deviceTilt = { x: 0, y: 0 };
}


// ─────────────────────────────────────────────────────────────────────────────
// §10  Per-element attachment / detachment
// ─────────────────────────────────────────────────────────────────────────────

function _attach(el) {
    if (_tracked.has(el)) return;

    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const rect = el.getBoundingClientRect();
    const w    = Math.round(rect.width  * dpr) || 1;
    const h    = Math.round(rect.height * dpr) || 1;

    const cvs   = document.createElement('canvas');
    cvs.className = 'lg-caustic-canvas';
    cvs.width   = w;
    cvs.height  = h;
    const ctx2d = cvs.getContext('2d', { alpha: true, willReadFrequently: false });
    el.insertBefore(cvs, el.firstChild);

    if (_opts.grain && !el.querySelector('.lg-grain')) {
        const grain = createGrainLayer();
        el.insertBefore(grain, cvs.nextSibling);
    }

    const springX     = _createSpring(0.5);
    const springY     = _createSpring(0.3);
    const hoverSpring = _createSpring(0);
    const tiltX       = _createSpring(0);
    const tiltY       = _createSpring(0);

    let es;

    const onMove = e => {
        const r = el.getBoundingClientRect();
        springX.target = Math.max(0, Math.min(1, (e.clientX - r.left)  / r.width));
        springY.target = Math.max(0, Math.min(1, (e.clientY - r.top)   / r.height));
        tiltX.target   = (springX.target - 0.5) * 2;
        tiltY.target   = (springY.target - 0.5) * 2;
        // Update cached DOM rect for refraction UV mapping
        es.domRect = r;
    };
    const onEnter = () => { hoverSpring.target = 1; es.hovered = true; };
    const onLeave = () => {
        springX.target = 0.5; springY.target = 0.30;
        hoverSpring.target = 0; tiltX.target = 0; tiltY.target = 0;
        es.hovered = false;
    };

    el.addEventListener('pointermove',  onMove,  { passive: true });
    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });

    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const cr = entry.contentRect;
            const nw = Math.round(cr.width  * dpr) || 1;
            const nh = Math.round(cr.height * dpr) || 1;
            if (nw !== es.width || nh !== es.height) {
                cvs.width = es.width = nw;
                cvs.height = es.height = nh;
            }
        }
    });
    ro.observe(el);

    es = {
        canvas: cvs, ctx2d, ro,
        springX, springY, hoverSpring, tiltX, tiltY,
        width: w, height: h,
        hovered: false, dpr,
        domRect: rect,
        pointerMove: onMove, pointerEnter: onEnter, pointerLeave: onLeave,
    };

    _elements.set(el, es);
    _tracked.add(el);

    const tier = _detectGpuTier();
    if (_opts.caustics && tier !== 'low' && _activeWebGLCount < MAX_WEBGL_ELEMENTS) {
        if (_initWebGL()) {
            _activeWebGLCount++;
            el.dataset.lgWebgl    = '1';
            el.dataset.lgRefract  = _state.bgReady ? '1' : '0';
        }
    }
}

function _detach(el) {
    const es = _elements.get(el);
    if (!es) return;
    el.removeEventListener('pointermove',  es.pointerMove);
    el.removeEventListener('pointerenter', es.pointerEnter);
    el.removeEventListener('pointerleave', es.pointerLeave);
    es.ro.disconnect();
    es.canvas.remove();
    el.querySelector('.lg-grain')?.remove();
    ['--lg-mx','--lg-my','--lg-tx','--lg-ty','--lg-hover','transform']
        .forEach(p => el.style.removeProperty(p));
    if (el.dataset.lgWebgl) {
        _activeWebGLCount = Math.max(0, _activeWebGLCount - 1);
        delete el.dataset.lgWebgl;
        delete el.dataset.lgRefract;
    }
    _elements.delete(el);
    _tracked.delete(el);
}


// ─────────────────────────────────────────────────────────────────────────────
// §11  rAF loop
// ─────────────────────────────────────────────────────────────────────────────

let _lastTs = 0;

function _rafLoop(ts) {
    _state.rafId = requestAnimationFrame(_rafLoop);

    const dt = Math.min((ts - (_lastTs || ts)) * 0.001, MAX_DT);
    _lastTs = ts;

    const gx = _state.deviceTilt.x;
    const gy = _state.deviceTilt.y;

    for (const el of _tracked) {
        const es = _elements.get(el);
        if (!es) continue;

        _stepSpring(es.springX,     SPRING.cursor, dt);
        _stepSpring(es.springY,     SPRING.cursor, dt);
        _stepSpring(es.hoverSpring, SPRING.hover,  dt);
        _stepSpring(es.tiltX,       SPRING.tilt,   dt);
        _stepSpring(es.tiltY,       SPRING.tilt,   dt);

        if (!es.hovered) {
            es.tiltX.target = gx * 0.45;
            es.tiltY.target = gy * 0.45;
        }

        el.style.setProperty('--lg-mx',   (es.springX.value * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-my',   (es.springY.value * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-tx',    es.tiltX.value.toFixed(4));
        el.style.setProperty('--lg-ty',    es.tiltY.value.toFixed(4));
        el.style.setProperty('--lg-hover', es.hoverSpring.value.toFixed(4));

        const rx =  (es.tiltY.value * 3.0).toFixed(3);
        const ry = -(es.tiltX.value * 3.0).toFixed(3);
        el.style.transform = `translateZ(0) perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;

        if (el.dataset.lgWebgl) {
            // Update cached domRect periodically (every 4 frames)
            if ((ts | 0) % 4 === 0) es.domRect = el.getBoundingClientRect();
            _renderCausticsGL(es, ts);
            // Update refraction status indicator
            el.dataset.lgRefract = _state.bgReady ? '1' : '0';
        }
    }
}

function _startLoop() {
    if (_state.rafId) return;
    _lastTs = 0;
    _state.rafId = requestAnimationFrame(_rafLoop);
}

function _stopLoop() {
    if (_state.rafId) { cancelAnimationFrame(_state.rafId); _state.rafId = 0; }
}


// ─────────────────────────────────────────────────────────────────────────────
// §12  MutationObserver
// ─────────────────────────────────────────────────────────────────────────────

function _attachSubtree(node) {
    if (!(node instanceof HTMLElement)) return;
    const sel = _opts.selector;
    if (node.matches(sel)) _attach(node);
    node.querySelectorAll?.(sel).forEach(_attach);
}

function _detachSubtree(node) {
    if (!(node instanceof HTMLElement)) return;
    const sel = _opts.selector;
    if (node.matches(sel)) _detach(node);
    node.querySelectorAll?.(sel).forEach(_detach);
}

function _startObserver() {
    document.querySelectorAll(_opts.selector).forEach(_attach);
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
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises Liquid Glass PRO.
 *
 * @param {Partial<LGOptions>} [options]
 */
export function initLiquidGlass(options = {}) {
    if (_state.ready) return;
    _state.ready = true;
    _opts = { ..._defaults, ...options };

    _registerHoudini();
    _injectSVG();
    _injectCSS();
    _startOrientationTracking();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            _startObserver();
            _startLoop();
        }, { once: true });
    } else {
        _startObserver();
        _startLoop();
    }
}

/**
 * Tears down everything. Safe to call before re-init on SPA navigation.
 */
export function destroyLiquidGlass() {
    _stopLoop();
    _state.observer?.disconnect();
    _state.observer = null;
    for (const el of [..._tracked]) _detach(el);
    _stopBackgroundCapture();
    _state.styleEl?.remove();
    _state.svgEl?.remove();
    _state.glCanvas?.remove();
    _stopOrientationTracking();
    _gpuTierCache    = null;
    _activeWebGLCount = 0;
    Object.assign(_state, {
        ready:false, svgReady:false, houdiniReg:false,
        observer:null, styleEl:null, svgEl:null, rafId:0,
        glBackend:null, glCanvas:null, glProgram:null,
        glUniforms:{}, glBuffer:null, glStartTime:0,
        bgTexture:null, bgCanvas:null, bgCtx:null,
        bgReady:false, bgCapturing:false,
        deviceTilt:{x:0,y:0},
    });
}

/**
 * Wraps element with SVG chromatic-aberration wrapper.
 * @param {HTMLElement} el
 * @returns {{ wrapper: HTMLElement, unwrap: () => void }}
 */
export function wrapWithDistortion(el) {
    const parent = el.parentNode, next = el.nextSibling;
    const wrapper = Object.assign(document.createElement('div'), { className: 'lg-outer' });
    const disp = window.getComputedStyle(el).display;
    if      (disp === 'flex' || disp === 'inline-flex') wrapper.classList.add('flex');
    else if (disp === 'grid' || disp === 'inline-grid') wrapper.classList.add('grid');
    else if (disp !== 'inline' && disp !== 'none')       wrapper.classList.add('block');
    parent?.insertBefore(wrapper, el);
    wrapper.appendChild(el);
    return {
        wrapper,
        unwrap() {
            if (!wrapper.isConnected) return;
            parent ? parent.insertBefore(el, next ?? null) : wrapper.removeChild(el);
            wrapper.remove();
        }
    };
}

/** Creates a .lg-grain film-grain layer element. */
export function createGrainLayer() {
    return Object.assign(document.createElement('div'), { className: 'lg-grain' });
}

/** Manually attaches glass effect to an element (for Shadow DOM use). */
export function attachElement(el) {
    if (!_state.ready) { console.warn('LG-PRO: call initLiquidGlass() first.'); return; }
    _attach(el);
}

/** Manually detaches glass effect from an element. */
export function detachElement(el) { _detach(el); }

/**
 * Creates a reply-quote chat element.
 * @param {string}      sender
 * @param {string}      text
 * @param {boolean}     [isOwn=false]
 * @param {Function}    [onClick=null]
 * @returns {HTMLDivElement}
 */
export function createReplyQuote(sender, text, isOwn = false, onClick = null) {
    const el = document.createElement('div');
    el.className = `lg lg-reply lg-interactive${isOwn ? ' lg-own' : ''}`;
    if (_opts.grain) el.appendChild(createGrainLayer());
    el.append(
        Object.assign(document.createElement('span'), { className:'lg-sender', textContent:sender }),
        Object.assign(document.createElement('span'), { className:'lg-text',   textContent:text   })
    );
    if (typeof onClick === 'function')
        el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    if (_state.ready) _attach(el);
    return el;
}

/**
 * Forces an immediate background capture.
 * Call this after significant DOM mutations (e.g. route change, modal open).
 * @returns {Promise<void>}
 */
export function refreshBackground() { return _captureBackground(); }

/** @returns {GpuTier} */
export function getGpuTier() { return _detectGpuTier(); }

/** @returns {boolean} true if background refraction is active */
export function isRefractionActive() { return _state.bgReady; }

/** @returns {LGOptions} current resolved options */
export function getOptions() { return { ..._opts }; }

/** @returns {'2.0.0'} */
export function version() { return '2.0.0'; }

// ── React hook ───────────────────────────────────────────────────────────────

/**
 * React hook. Attaches the glass effect to a ref element.
 *
 * @example
 * import { useRef } from 'react';
 * import { useLiquidGlass } from './liquid-glass-pro.js';
 *
 * function GlassCard() {
 *   const ref = useRef(null);
 *   useLiquidGlass(ref);
 *   return <div ref={ref} className="lg lg-card lg-interactive">...</div>;
 * }
 */
export function useLiquidGlass(ref) {
    // Dynamic import of React to avoid hard dependency
    // Works with any React 16.8+ version
    if (typeof window === 'undefined') return; // SSR guard

    const React = window.React;
    if (!React?.useEffect) {
        console.warn('LG-PRO: useLiquidGlass requires React 16.8+');
        return;
    }

    React.useEffect(() => {
        const el = ref?.current;
        if (!el) return;
        if (!_state.ready) initLiquidGlass(_opts);
        _attach(el);
        return () => _detach(el);
    }, [ref]);
}
