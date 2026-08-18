/* ==========================================================================
   N10s — hero scroll sequence

   A tall track with a sticky pin. One normalised progress value `p` (0..1)
   across the track drives every stage:

     Stage A  p 0.00 - 0.20   footage only, scroll cue, no text or scrim
     Stage B  p 0.20 - 0.45   scrim + heading enter, scan reveal runs
     Stage C  p 0.45 - 0.75   info links enter, heading shifts up
     Stage D  p 0.75 - 1.00   hero fades and scales down, page rises over it

   Only transform and opacity are ever animated. Everything tunable is in the
   CONFIG block below.
   ========================================================================== */

(function () {
  "use strict";

  /* ======================================================================
     CONFIG
     ====================================================================== */

  /* Stage thresholds, as normalised scroll progress across the track. */
  const STAGE = {
    A_START: 0.00, A_END: 0.20,
    B_START: 0.20, B_END: 0.45,
    C_START: 0.45, C_END: 0.75,
    D_START: 0.75, D_END: 1.00
  };

  /* Track length in vh. Must match --track-vh and the 767px media query
     in css/styles.css. */
  const TRACK_VH        = 400;
  const TRACK_VH_MOBILE = 200;

  /* Entrance stagger between lines. Roughly 80ms at a typical scroll rate,
     expressed as scroll progress so it tracks scroll speed, not a timer. */
  const LINE_STAGGER    = 0.018;

  const ENTER_SCALE     = 0.96;   /* lines scale from this to 1.0 */
  const ENTER_DRIFT_PX  = 26;     /* upward drift distance on entry */
  const HEADING_LIFT_PX = 34;     /* how far the heading shifts up in stage C */

  const EXIT_SCALE      = 0.92;   /* hero scales down to this in stage D */
  const MAIN_RISE_PX    = 40;     /* extra rise applied to the page content */

  /* ---- SCAN REVEAL -------------------------------------------------------
     Focus regions in normalised 0..1 coordinates of the displayed
     (cover-cropped) frame. They cycle in sequence across stage B.
     Add, remove or reorder freely. */
  const FOCUS_REGIONS = [
    { x: 0.30, y: 0.30, w: 0.34, h: 0.34 },   /* centre pitches */
    { x: 0.58, y: 0.22, w: 0.30, h: 0.30 },   /* far touchline and tents */
    { x: 0.12, y: 0.38, w: 0.30, h: 0.32 }    /* near posts and car park */
  ];

  const HUD_LABEL_1 = "BOZEMAN SPORTS PARK";
  const HUD_LABEL_2 = "BOZEMAN, MONTANA // 10s";

  const SCAN_ENABLED    = true;   /* false = footage only, HUD still draws */
  const SCAN_OPACITY    = 0.55;   /* peak strength of the treated region */
  const CANVAS_FPS      = 30;     /* hard cap on the canvas loop */
  const CANVAS_SCALE    = 0.5;    /* internal render res; CSS upscales */
  const SCAN_CONTRAST   = 1.25;   /* pre-duotone contrast */
  const SCAN_BRIGHT     = -6;     /* pre-duotone brightness offset */
  const SOBEL_GAIN      = 0.55;   /* edge strength */
  const SOBEL_FLOOR     = 96;     /* edges weaker than this are discarded */
  const SOBEL_MAX_MIX   = 0.5;    /* edges never fully replace the base colour */

  const MOBILE_BP            = 768;    /* "small screen" threshold */
  const POSTER_ONLY_UNDER_BP = false;  /* true = poster still below MOBILE_BP */

  /* ====================================================================== */

  const track   = document.getElementById("heroTrack");
  if (!track) return;

  const pin     = document.getElementById("heroPin");
  const media   = document.getElementById("heroMedia");
  const video   = document.getElementById("heroVideo");
  const canvas  = document.getElementById("scanCanvas");
  const hud     = document.getElementById("hud");
  const scrim   = document.getElementById("heroScrim");
  const content = document.getElementById("heroContent");
  const cue     = document.getElementById("scrollCue");
  const main    = document.getElementById("top");
  const lines   = Array.from(document.querySelectorAll(".hero-line"));
  const linkEls = Array.from(document.querySelectorAll("#heroLinks a"));

  const hudBrackets = document.getElementById("hudBrackets");
  const hudTicks    = document.getElementById("hudTicks");
  const hudScan     = document.getElementById("hudScan");
  const hudLabel    = document.getElementById("hudLabel");

  const SVGNS = "http://www.w3.org/2000/svg";

  /* ---- capability gates ------------------------------------------------- */

  const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function saveData() {
    const c = navigator.connection;
    if (!c) return false;
    if (c.saveData) return true;
    return ["slow-2g", "2g", "3g"].indexOf(c.effectiveType) !== -1;
  }

  /* Poster-only is now reserved for genuine constraints. The width gate is
     off by default (POSTER_ONLY_UNDER_BP = false) so the hero plays on phones
     and narrow windows too — they get the smaller hero-1280 rung, not the
     full-res pair. Flip it back to true to save mobile data. */
  function posterOnly() {
    return mqReduce.matches || saveData() ||
           (POSTER_ONLY_UNDER_BP && window.innerWidth < MOBILE_BP);
  }

  /* Reduced motion also flattens every stage to a plain opacity fade. */
  function flatMode() { return mqReduce.matches; }

  /* ---- geometry cache — layout is never read inside the scroll handler --- */

  let trackTop = 0, trackRange = 1, vh = 0, vw = 0;

  function measure() {
    const r = track.getBoundingClientRect();
    trackTop   = r.top + window.scrollY;
    vh         = window.innerHeight;
    vw         = window.innerWidth;
    trackRange = Math.max(1, track.offsetHeight - vh);

    /* Pull the page content up so it starts covering the pin at D_START. */
    const trackVh = vw < MOBILE_BP ? TRACK_VH_MOBILE : TRACK_VH;
    const pull = (1 - STAGE.D_START) * (trackVh - 100);
    document.documentElement.style.setProperty("--main-pull", pull.toFixed(2));

    sizeCanvas();
    layoutHudStatic();
  }

  /* ---- helpers ---------------------------------------------------------- */

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const seg = (p, a, b) => clamp01((p - a) / (b - a));
  const ease = t => t * t * t * (t * (t * 6 - 15) + 10);   /* smootherstep */

  /* ---- source selection -------------------------------------------------
     The `media` attribute on <source> inside <video> is specced but ignored
     by shipping browsers, so the list is rebuilt here from matchMedia. */

  function pickSources() {
    if (posterOnly()) {
      /* Detach every <source> and reload so nothing is fetched. A bare
         removeAttribute("src") is a no-op: the element only has children. */
      if (video.dataset.tier !== "poster") {
        video.dataset.tier = "poster";
        video.innerHTML = "";
        video.removeAttribute("src");
        video.preload = "none";
        try { video.load(); } catch (e) {}
      }
      return;
    }

    const wide = window.matchMedia("(min-width: 1280px)").matches;
    const list = wide
      ? [["assets/hero.av1.webm",      'video/webm; codecs="av01.0.05M.08"'],
         ["assets/hero.h264.mp4",      'video/mp4; codecs="avc1.640028"']]
      : [["assets/hero-1280.av1.webm", 'video/webm; codecs="av01.0.05M.08"'],
         ["assets/hero-1280.mp4",      'video/mp4; codecs="avc1.640028"']];

    const want = list.map(s => s[0]).join("|");
    if (video.dataset.tier === want) return;
    video.dataset.tier = want;

    video.innerHTML = "";
    list.forEach(function (pair) {
      const el = document.createElement("source");
      el.src = pair[0]; el.type = pair[1];
      video.appendChild(el);
    });
    video.preload = "auto";
    video.load();
    const play = video.play();
    if (play && play.catch) play.catch(function () {});
  }

  /* ======================================================================
     SCAN REVEAL
     One video + one canvas. The canvas mirrors the video's object-fit:cover
     crop so the treated region lines up with the footage underneath.
     ====================================================================== */

  let ctx = null, cw = 0, ch = 0;

  function sizeCanvas() {
    if (!canvas || !pin) return;
    const w = Math.max(1, Math.round(pin.clientWidth  * CANVAS_SCALE));
    const h = Math.max(1, Math.round(pin.clientHeight * CANVAS_SCALE));
    if (w === cw && h === ch) return;
    cw = canvas.width = w;
    ch = canvas.height = h;
    ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  }

  function coverRect() {
    const vwid = video.videoWidth || 1920;
    const vhei = video.videoHeight || 1080;
    const scale = Math.max(cw / vwid, ch / vhei);
    const dw = vwid * scale, dh = vhei * scale;
    return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw: dw, dh: dh };
  }

  function regionRect(region) {
    return {
      x: Math.round(region.x * cw),
      y: Math.round(region.y * ch),
      w: Math.round(region.w * cw),
      h: Math.round(region.h * ch)
    };
  }

  function hexToRgb(h) {
    h = String(h).trim().replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const css     = getComputedStyle(document.documentElement);
  const DUO_LO  = hexToRgb(css.getPropertyValue("--scan-shadow") || "#0a1a00");
  const DUO_MID = hexToRgb(css.getPropertyValue("--scan-mid")    || "#1b3d00");
  const DUO_HI  = hexToRgb(css.getPropertyValue("--scan-hi")     || "#f5f6f7");
  const EDGE_C  = hexToRgb(css.getPropertyValue("--scan-edge")   || "#ffffff");

  function duotone(t) {
    if (t < 0.5) {
      const k = t * 2;
      return [DUO_LO[0] + (DUO_MID[0] - DUO_LO[0]) * k,
              DUO_LO[1] + (DUO_MID[1] - DUO_LO[1]) * k,
              DUO_LO[2] + (DUO_MID[2] - DUO_LO[2]) * k];
    }
    const k = (t - 0.5) * 2;
    return [DUO_MID[0] + (DUO_HI[0] - DUO_MID[0]) * k,
            DUO_MID[1] + (DUO_HI[1] - DUO_MID[1]) * k,
            DUO_MID[2] + (DUO_HI[2] - DUO_MID[2]) * k];
  }

  function drawScan(region, reveal) {
    if (!ctx || video.readyState < 2) return;

    ctx.clearRect(0, 0, cw, ch);
    const r  = regionRect(region);
    const cr = coverRect();
    if (r.w < 2 || r.h < 2) return;

    /* map the canvas-space region back into video source pixels */
    const sx = (r.x - cr.dx) / cr.dw * video.videoWidth;
    const sy = (r.y - cr.dy) / cr.dh * video.videoHeight;
    const sw = r.w / cr.dw * video.videoWidth;
    const sh = r.h / cr.dh * video.videoHeight;

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    try {
      ctx.drawImage(video, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
    } catch (e) { ctx.restore(); return; }
    ctx.restore();

    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    const d = img.data;
    const W = img.width, H = img.height;

    /* pass 1 — luminance + contrast */
    const lum = new Float32Array(W * H);
    for (let i = 0, q = 0; i < d.length; i += 4, q++) {
      let l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      l = (l - 128) * SCAN_CONTRAST + 128 + SCAN_BRIGHT;
      lum[q] = l < 0 ? 0 : l > 255 ? 255 : l;
    }

    /* pass 2 — Sobel on the contrasted luminance */
    const edge = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const o = y * W + x;
        const tl = lum[o - W - 1], tt = lum[o - W], tr = lum[o - W + 1];
        const ll = lum[o - 1],                     rr = lum[o + 1];
        const bl = lum[o + W - 1], bb = lum[o + W], br = lum[o + W + 1];
        const gx = (tr + 2 * rr + br) - (tl + 2 * ll + bl);
        const gy = (bl + 2 * bb + br) - (tl + 2 * tt + tr);
        const m = Math.sqrt(gx * gx + gy * gy) * SOBEL_GAIN;
        edge[o] = m > SOBEL_FLOOR ? (m > 255 ? 255 : m) : 0;
      }
    }

    /* pass 3 — duotone + edge composite, wiped in with the scan line */
    const wipeY = reveal * H;
    for (let y = 0; y < H; y++) {
      const on = y <= wipeY;
      for (let x = 0; x < W; x++) {
        const o = y * W + x, i = o * 4;
        if (!on) { d[i + 3] = 0; continue; }
        const c = duotone(lum[o] / 255);
        const e = (edge[o] / 255) * SOBEL_MAX_MIX;
        d[i]     = c[0] + (EDGE_C[0] - c[0]) * e;
        d[i + 1] = c[1] + (EDGE_C[1] - c[1]) * e;
        d[i + 2] = c[2] + (EDGE_C[2] - c[2]) * e;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, r.x, r.y);
  }

  /* ---- HUD -------------------------------------------------------------- */

  function el(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function layoutHudStatic() {
    if (!hud || !pin) return;
    hud.setAttribute("viewBox", "0 0 " + pin.clientWidth + " " + pin.clientHeight);
  }

  function drawHud(region, reveal) {
    const W = pin.clientWidth, H = pin.clientHeight;
    const x = region.x * W, y = region.y * H, w = region.w * W, h = region.h * H;
    const armX = Math.min(38, w * 0.28), armY = Math.min(38, h * 0.28);

    hudBrackets.innerHTML = "";
    [
      "M" + x + " " + (y + armY) + " L" + x + " " + y + " L" + (x + armX) + " " + y,
      "M" + (x + w - armX) + " " + y + " L" + (x + w) + " " + y + " L" + (x + w) + " " + (y + armY),
      "M" + (x + w) + " " + (y + h - armY) + " L" + (x + w) + " " + (y + h) + " L" + (x + w - armX) + " " + (y + h),
      "M" + (x + armX) + " " + (y + h) + " L" + x + " " + (y + h) + " L" + x + " " + (y + h - armY)
    ].forEach(function (dPath) {
      hudBrackets.appendChild(el("path", { d: dPath, "class": "hud-stroke" }));
    });

    hudTicks.innerHTML = "";
    const N = 6, TICK = 9;
    for (let i = 1; i < N; i++) {
      const tx = x + (w * i / N), ty = y + (h * i / N);
      hudTicks.appendChild(el("line", { x1: tx, y1: y, x2: tx, y2: y + TICK, "class": "hud-tick" }));
      hudTicks.appendChild(el("line", { x1: tx, y1: y + h - TICK, x2: tx, y2: y + h, "class": "hud-tick" }));
      hudTicks.appendChild(el("line", { x1: x, y1: ty, x2: x + TICK, y2: ty, "class": "hud-tick" }));
      hudTicks.appendChild(el("line", { x1: x + w - TICK, y1: ty, x2: x + w, y2: ty, "class": "hud-tick" }));
    }

    /* scan line sweeps top to bottom once per region */
    hudScan.innerHTML = "";
    const sy = y + h * reveal;
    hudScan.appendChild(el("rect", { x: x, y: y, width: w, height: Math.max(0, sy - y), "class": "hud-scan-glow" }));
    hudScan.appendChild(el("line", { x1: x, y1: sy, x2: x + w, y2: sy, "class": "hud-scan" }));

    /* label block under the region, flipping above it near the base */
    hudLabel.innerHTML = "";
    const lw = 268, lh = 44;
    const lx = Math.min(Math.max(8, x), W - lw - 8);
    const ly = (y + h + 14 + lh > H) ? (y - lh - 14) : (y + h + 14);
    hudLabel.appendChild(el("rect", { x: lx, y: ly, width: lw, height: lh, rx: 3, "class": "hud-label-bg" }));
    const t1 = el("text", { x: lx + 12, y: ly + 18 }); t1.textContent = HUD_LABEL_1;
    const t2 = el("text", { x: lx + 12, y: ly + 34 }); t2.textContent = HUD_LABEL_2;
    hudLabel.appendChild(t1);
    hudLabel.appendChild(t2);
  }

  /* ======================================================================
     CANVAS LOOP — 30fps cap, alive only during stage B
     ====================================================================== */

  let rafScan = 0, lastDraw = 0, loopAlive = false;
  let heroVisible = true, currentP = 0;

  function scanLoop(ts) {
    if (!loopAlive) return;
    rafScan = requestAnimationFrame(scanLoop);
    if (ts - lastDraw < 1000 / CANVAS_FPS) return;
    lastDraw = ts;

    const bp = seg(currentP, STAGE.B_START, STAGE.B_END);
    const n = FOCUS_REGIONS.length;
    const idx = Math.min(n - 1, Math.floor(bp * n));
    const local = clamp01(bp * n - idx);
    const region = FOCUS_REGIONS[idx];

    if (SCAN_ENABLED) drawScan(region, ease(local));
    drawHud(region, ease(local));
  }

  function startLoop() {
    if (loopAlive || posterOnly()) return;
    loopAlive = true;
    lastDraw = 0;
    rafScan = requestAnimationFrame(scanLoop);
  }

  function stopLoop() {
    loopAlive = false;
    if (rafScan) cancelAnimationFrame(rafScan);
    rafScan = 0;
    if (ctx) ctx.clearRect(0, 0, cw, ch);
  }

  /* ======================================================================
     STAGE RENDER — transform and opacity only, no layout properties
     ====================================================================== */

  function render(p) {
    const flat = flatMode();

    /* Stage A — footage only; the cue fades as B approaches */
    cue.style.opacity = String(1 - seg(p, STAGE.A_END * 0.6, STAGE.A_END));

    /* Stage B — scrim + staggered heading entrance */
    const bp = seg(p, STAGE.B_START, STAGE.B_END);
    scrim.style.opacity = String(ease(bp));

    const cp = seg(p, STAGE.C_START, STAGE.C_END);

    lines.forEach(function (line, i) {
      const t = ease(clamp01((bp - i * LINE_STAGGER) / (1 - LINE_STAGGER * lines.length)));
      line.style.opacity = String(t);
      if (flat) { line.style.transform = ""; return; }
      const scale = ENTER_SCALE + (1 - ENTER_SCALE) * t;
      const drift = (1 - t) * ENTER_DRIFT_PX;
      line.style.transform =
        "translate3d(0," + drift.toFixed(2) + "px,0) scale(" + scale.toFixed(4) + ")";
    });

    /* Stage C — info links, same stagger rhythm */
    linkEls.forEach(function (a, i) {
      const t = ease(clamp01((cp - i * LINE_STAGGER) / (1 - LINE_STAGGER * linkEls.length)));
      a.style.opacity = String(t);
      a.style.pointerEvents = t > 0.6 ? "auto" : "none";
      if (flat) { a.style.transform = ""; return; }
      const scale = ENTER_SCALE + (1 - ENTER_SCALE) * t;
      const drift = (1 - t) * ENTER_DRIFT_PX;
      a.style.transform =
        "translate3d(0," + drift.toFixed(2) + "px,0) scale(" + scale.toFixed(4) + ")";
    });

    /* heading block shifts up to make room for the links */
    content.style.transform = flat
      ? ""
      : "translate3d(0," + (-cp * HEADING_LIFT_PX).toFixed(2) + "px,0)";

    /* Stage D — handoff */
    const dp = ease(seg(p, STAGE.D_START, STAGE.D_END));

    if (flat) {
      media.style.transform = "";
      media.style.opacity = String(1 - dp);
      content.style.opacity = String(1 - dp);
      main.style.transform = "";
    } else {
      const exitScale = 1 - (1 - EXIT_SCALE) * dp;
      media.style.transform = "scale(" + exitScale.toFixed(4) + ")";
      media.style.opacity = String(1 - dp * 0.85);
      content.style.opacity = String(1 - dp);
      main.style.transform = "translate3d(0," + ((1 - dp) * MAIN_RISE_PX).toFixed(2) + "px,0)";
    }

    /* scan layers exist in stage B only */
    const scanOn = p >= STAGE.B_START && p < STAGE.B_END && !posterOnly();
    const scanFade = scanOn ? Math.min(1, bp * 6) * Math.min(1, (1 - bp) * 6) : 0;
    canvas.style.opacity = String(SCAN_ENABLED ? scanFade * SCAN_OPACITY : 0);
    hud.style.opacity = String(scanFade);

    if (scanOn && heroVisible && !document.hidden) startLoop();
    else stopLoop();

    /* pause the footage once it is fully covered */
    if (!posterOnly()) {
      if (dp >= 1 || !heroVisible || document.hidden) {
        if (!video.paused) video.pause();
      } else if (video.paused) {
        const pl = video.play();
        if (pl && pl.catch) pl.catch(function () {});
      }
    }
  }

  /* ======================================================================
     SCROLL — the handler only flags; reads and writes happen in the rAF tick
     ====================================================================== */

  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      currentP = clamp01((window.scrollY - trackTop) / trackRange);
      render(currentP);
    });
  }

  /* ======================================================================
     INIT
     ====================================================================== */

  function applyMode() {
    document.body.classList.toggle("poster-only", posterOnly());
    pickSources();
    if (posterOnly()) stopLoop();
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
      if (!heroVisible) stopLoop();
    }, { threshold: 0 });
    io.observe(pin);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopLoop();
      if (!video.paused) video.pause();
    } else {
      onScroll();
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      applyMode();
      measure();
      onScroll();
    }, 120);
  });

  if (mqReduce.addEventListener) {
    mqReduce.addEventListener("change", function () { applyMode(); onScroll(); });
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  /* The first play() often rejects because it fires before the element is
     ready, or because the UA wants a gesture. Retry as the media becomes
     playable, and once more on the first interaction, so the hero can never
     sit frozen on the poster frame. */
  ["loadedmetadata", "loadeddata", "canplay"].forEach(function (evt) {
    video.addEventListener(evt, onScroll);
  });

  function retryPlayOnce() {
    ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
      window.removeEventListener(evt, retryPlayOnce);
    });
    if (!posterOnly() && video.paused && currentP < STAGE.D_END) {
      const pl = video.play();
      if (pl && pl.catch) pl.catch(function () {});
    }
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
    window.addEventListener(evt, retryPlayOnce, { passive: true, once: true });
  });

  applyMode();
  measure();
  onScroll();
})();
