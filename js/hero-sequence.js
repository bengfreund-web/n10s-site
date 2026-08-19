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
    A_START: 0.00, A_END: 0.08,   /* short: the footage plays, then a nudge */
    B_START: 0.08, B_END: 0.34,
    C_START: 0.34, C_END: 0.62,
    D_START: 0.62, D_END: 1.00
  };

  /* Track length in vh. Must match --track-vh and the 767px media query
     in css/styles.css. */
  const TRACK_VH        = 200;
  const TRACK_VH_MOBILE = 150;

  /* Entrance stagger between lines. Roughly 80ms at a typical scroll rate,
     expressed as scroll progress so it tracks scroll speed, not a timer. */
  const LINE_STAGGER    = 0.018;

  const ENTER_SCALE     = 0.96;   /* lines scale from this to 1.0 */
  const ENTER_DRIFT_PX  = 26;     /* upward drift distance on entry */
  const HEADING_LIFT_PX = 34;     /* how far the heading shifts up in stage C */

  const EXIT_SCALE      = 0.92;   /* hero scales down to this in stage D */
  const MAIN_RISE_PX    = 40;     /* extra rise applied to the page content */

  const MOBILE_BP            = 768;    /* "small screen" threshold */
  const POSTER_ONLY_UNDER_BP = false;  /* true = poster still below MOBILE_BP */

  /* ====================================================================== */

  const track   = document.getElementById("heroTrack");
  if (!track) {
    /* CSS hides the hero copy while `js` is present, on the promise that this
       script will animate it back. If the hero is not here, drop the promise
       so the copy is never left invisible. */
    document.documentElement.classList.remove("js");
    return;
  }

  const pin     = document.getElementById("heroPin");
  const media   = document.getElementById("heroMedia");
  const video   = document.getElementById("heroVideo");
  const scrim   = document.getElementById("heroScrim");
  const content = document.getElementById("heroContent");
  const cue     = document.getElementById("scrollCue");
  const main    = document.getElementById("top");
  const lines   = Array.from(document.querySelectorAll(".hero-line"));
  /* The hero used to carry its own nav row; it duplicated the sticky header,
     so it was removed. Stage C now only lifts the heading. */
  const linkEls = Array.from(document.querySelectorAll("#heroLinks a"));


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

  let heroVisible = true, currentP = 0;

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
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
    }, { threshold: 0 });
    io.observe(pin);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
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
