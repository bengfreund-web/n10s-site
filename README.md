# N10s Rugby Championship

Single-page site for the National 10s Rugby Championship — May 15–16, 2027, Bozeman Sports Park,
Bozeman, Montana. An event of the Montana Institute of Sport.

Built on the same static pattern as `varsity-rugby-site`: plain HTML/CSS/JS, no build step,
deployed from the repo root via GitHub Pages.

Page order is built for one reader: a coach deciding whether to enter. The
first thing under the hero is a four-fact row — **format, age groups, cost,
location** — and each card links to the section that answers it in full.
Depth increases as you scroll:

`Basics → Divisions → venue photo → Squad and Cost → Expression of Interest → Plan Your Trip → FAQ`

"Get Started" is deliberately a shallow block of its own: a heading and one
button, nothing else, on white so it reads as separate from Plan Your Trip
below it. The button opens the Google Form in a new tab.

Divisions run U16 first, then middle school, in every place the pair appears —
the section, the Basics card, the form's select, the FAQ and the meta
descriptions.

**Age bands are a draft.** They were derived from the usual USA Rugby
convention of taking age at 1 September preceding the season (1 September 2026
for a May 2027 event): U16 born on or after 1 September 2010, middle school
born on or after 1 September 2012. The page says so and marks them provisional
until registration opens. Confirm the cutoff convention before that changes.

Squad size and entry fee share one row — the two numbers that decide whether a
program can come, read together.

Two photo placements remain: the venue shot after Divisions, and a landscape
pair closing the page. The two Wranglers shots (scrum under the Basics row,
ball carrier beside the interest form) were removed; `img/scrum.jpg` and
`img/carry.jpg` are deleted and recoverable from git history.

Match photos are boys sides only. The 2027 divisions are boys, so girls'
fixtures on the page would misrepresent the event — worth remembering when
pulling more from the Gallatin Wranglers album, which is mostly the girls' side.

**Deleting CSS rules by string index has bitten twice.** A selector that is
part of a comma-separated group leaves its neighbours attached to the *next*
rule — once merging `.js .hero-line` with `.hero-mark` and swallowing an
`opacity: 0`, once attaching `.photo-wide` to `.photo-pair`. Remove the whole
selector group, and check the file for merged groups afterwards. There is also
accumulated dead CSS from removed sections (`card-grid`, `step-grid`,
`reason-list`, `hero-actions`, `step-num`, `card-note`) worth one careful pass.

```
index.html            the whole page
css/styles.css        brand tokens + all styles
js/main.js            nav, scroll progress, reveal-on-scroll, interest form
js/hero-sequence.js   pinned video hero: stages, scan reveal, HUD
prep.py               footage analysis + encoding ladder
scripts/              Apps Script form endpoint; build-preview.py; preview fonts
img/                  logo, icons, OG image, photos
assets/               hero footage, poster stills, encodes (large ones gitignored)
reports/              sharpness.csv, loop-candidates.json from prep.py
```

## Hero scroll sequence

A 200vh track (150vh under 768px) with a sticky 100svh pin. One normalised
progress value drives four stages, all thresholds named at the top of
`js/hero-sequence.js`:

| Stage | p | What happens |
|---|---|---|
| A | 0.00–0.08 | Footage only. Scroll cue, no text, no scrim. |
| B | 0.08–0.34 | Scrim fades up, heading lines enter staggered. |
| C | 0.34–0.62 | Heading lifts slightly. |
| D | 0.62–1.00 | Hero fades and scales down, page rises over it, pin releases. |

Stage A is deliberately short — roughly 8vh of scroll — so the footage plays
clean for a moment and the type arrives on the first nudge.

The hero used to carry its own row of nav links across the top. It duplicated
the sticky header sitting directly above it, so it was removed; the header
covers that navigation at every scroll position.

**The page always starts at the top.** Browsers restore the previous scroll
position on reload and on back/forward, which with a pinned sequence drops you
into the middle of it — type already revealed, footage paused, looking broken.
`scrollRestoration` is set to `manual` and the page is scrolled to 0 on load,
plus again on `pageshow` for back/forward-cache restores. A URL with a hash is
honoured instead, jumped to with `behavior: "instant"` (`"auto"` defers to the
CSS `scroll-behavior: smooth`, which is the animation being avoided).

**The pin is `100svh`, so the hero copy has to fit it.** On a short window it
outgrows the pin and gets clipped from the top — the mark disappears first,
which looks like a broken layout. Two media queries handle it: below 700px
tall the mark is dropped and the type tightens, below 520px the standfirst goes
too. Check a short window after any change to the hero copy.

The scrim also drops its left-to-right gradient below 900px wide. That gradient
reaches 58% across, which on a narrow viewport covered almost the whole frame
and hid the footage entirely.

**First-paint state matters here.** The hero copy is hidden by CSS behind a
`js` class set in `<head>` before first paint, and `--main-pull` is seeded in
CSS to the value `measure()` computes. Without those two, the copy painted
fully opaque over an unscrimmed frame and then snapped to zero, and the page
content jumped up ~38vh, the moment JS took over — the flash on load. If
`D_START` or the track length changes, update the seeded `--main-pull` to
match, and `hero-sequence.js` drops the `js` class if the hero is absent so
the copy is never stranded invisible.

Only `transform` and `opacity` are animated. Scroll is throttled through
requestAnimationFrame and layout is never read in the handler — geometry is
cached in `measure()` on resize.

**Scan reveal: removed.** The hero previously ran a canvas duotone + Sobel
treatment with an SVG HUD over one region of the frame. It read as a glitchy
box over the grass and was cut, along with its canvas, HUD and render loop.
It is in git history (`4de8e1c` and earlier) if it is ever wanted back.

**Budgets.** The video pauses once fully covered, when the tab is hidden, or
when the hero leaves the viewport.

**Fallbacks.** `prefers-reduced-motion` and Save-Data / 2g-3g get the poster
still. The small-screen gate is off by default (`POSTER_ONLY_UNDER_BP`), so
phones play the video too — on the smaller `hero-1280` rung. Flip it to `true`
to save mobile data. In poster-only mode: the `<source>` elements are detached so nothing
downloads at all. Hero copy is in the DOM at all times and only ever
transformed, so keyboard and screen reader users get everything without
scrolling; there is a skip link, and focused hero links are forced visible
regardless of stage.

## Loading screen

The hero is held behind a full-screen loader — mark, progress bar, percentage —
until the footage has actually buffered, so the first thing anyone sees is the
full-resolution film rather than a poster snapping to video. Progress is read
from `video.buffered`, not faked.

It can never trap anyone: it dismisses on `LOADER_TIMEOUT_MS` (20s), on a video
error, and immediately for poster-only clients who fetch no video at all. It is
shown by CSS only when the `js` class is present, so a no-JS visitor never sees
it. Because quality now takes priority over load speed, `FULLRES_MIN_WIDTH` was
lowered from 1280 to 1024 — more viewports get the full-res rung.

## Cache busting

**Run `python3 scripts/bump-assets.py` before pushing any change to `css/` or
`js/`.** GitHub Pages caches those files beyond a push, so a returning visitor
keeps running the old ones. This cost real debugging time once: the loader
looked completely broken in the browser while the served file was correct — it
was a stale cached `hero-sequence.js`.

## Footage prep

```bash
python3 prep.py                 # probe + sharpness + loop candidates + poster + ladder
python3 prep.py --analyze-only  # no encoding
```

Needs `cv2`, `Pillow`, and an ffmpeg with libx264 + libsvtav1. If `ffprobe` is
not installed it falls back to parsing `ffmpeg -i` for the same fields.

Source is 1920x1080, 29.97fps, h264 High, yuv420p, bt709, 54.65s, no audio.

**Hero loop: 10.00s → 18.75s** (8.75s), the top-scoring candidate — highest
median sharpness of the window search and near-lowest shake. It is set as
`LOOP_IN` / `LOOP_OUT` at the top of `prep.py`, so the ladder and the poster
both trim to it; set them to `None` to go back to the full source.

The poster is the loop's **first** frame, not the sharpest frame overall, so
there is no jump when playback starts (`POSTER_MODE`, which also accepts
`sharpest-in-loop` and `sharpest-overall`). It costs almost nothing here —
t=10.00 ranks 4th of 219 samples anyway.

Encoded ladder, against a stream copy of the same window (7.62 MB):

| file | size | vs slice | served to |
|---|---|---|---|
| `hero.av1.webm` | 16.28 MB | 214% | ≥1280px, first choice |
| `hero.h264.mp4` | 18.26 MB | 239% | ≥1280px, fallback |
| `hero-1280.av1.webm` | 5.32 MB | 70% | <1280px, first choice |
| `hero-1280.mp4` | 6.45 MB | 85% | <1280px, fallback |
| `hero-1080.mp4` | 18.26 MB | 239% | nothing — gitignored |

Every rung gets a light `unsharp=5:5:0.45` pass. The master is a 4.5 Mbps
delivery file, so extra bitrate mostly preserves its existing artefacts —
sharpening is what actually reads as a crisper hero. Measured on a hero frame,
Laplacian variance goes 914 → 1637. It is not free: sharpening adds
high-frequency detail that costs bitrate, so the CRFs were raised to
compensate. At `unsharp 0.7` with CRF 20/14 the h264 rung hit 29 MB, which
would have hurt first load more than the sharpness helped.

CRFs are AV1 26 / x264 18 at full res, AV1 32 / x264 22 at 1280. The 1280
rung was lifted hardest because the hero now plays on small screens too, so
that tier is what most viewports actually see. Quality is capped by the master
(a 4.5 Mbps 1080p delivery file) — lowering CRF further mostly preserves its
existing compression artifacts rather than adding detail. A sharper hero needs
a better master, not a lower CRF.

`hero-1080.mp4` is byte-for-byte identical to `hero.h264.mp4`: the source is
1920 wide, the rung asks for 1920 wide, and we never upscale. Nothing loads it
and it is gitignored; the sub-1280px tier uses `hero-1280.*`.

Encoded durations come out at 8.78s rather than 8.75s — frame quantisation at
29.97fps (263 frames).

## Shareable preview build

```bash
python3 scripts/build-preview.py    # -> build/n10s-preview.html (~7 MB)
```

Inlines CSS, JS, fonts, images and one video rung into a single file for
sharing as a link, since the share target blocks external requests. It
deliberately differs from the deployed site: one 1280-wide H.264 rung instead
of the four-file ladder (AV1 is patchy in Safari and a shared link has to play
anywhere), downscaled photos, and Oswald/Poppins woff2 inlined from
`scripts/preview-fonts/` rather than linked from Google Fonts. The script
fails loudly if any external reference survives or the file exceeds 16 MB.

Note the mailto CTA may not fire inside an embedded frame — the preview is for
reviewing design and content, not a working signup.

## Local preview

```bash
cd ~/n10s-site && python3 -m http.server 8765
```

Then open http://localhost:8765.

## Brand tokens

Sampled from the logo, defined at the top of `css/styles.css`:

| Token | Value | Use |
|---|---|---|
| `--primary` | `#1B3D00` | forest green: headings, primary button fill, footer |
| `--primary-dark` | `#102600` | hero gradient end, footer, statement band |
| `--accent` | `#53C400` | bright green: swoosh, rules, icons, large display type, on-dark text |
| `--accent-text` | `#367B00` | darkened accent for small text/links on white (passes AA; `#53C400` does not) |
| `--gray` | `#60655F` | body copy |
| `--off-white` | `#F5F6F7` | page background |

`#53C400` on white is a 2.3:1 contrast ratio, so it is never used for body or small text —
`--accent-text` exists for that. Primary buttons are forest fill / white text with a bright-green
inset left border; the reverse (bright green fill, white text) does not pass and is not used.

Type: Oswald (condensed, upright) for display/headings and eyebrows, Poppins for body.

## Wiring up the interest form

The form is live in the markup but **not connected**. While `FORM_ENDPOINT` at the top of
`js/main.js` is empty, `main.js` hides the form and shows an email fallback instead, so the page
never collects submissions that go nowhere.

To connect it:

1. Create a Google Sheet for submissions.
2. Extensions → Apps Script, paste `scripts/form-endpoint.gs` over `Code.gs`, save.
3. Deploy → New deployment → Web app; execute as **Me**, access **Anyone**.
4. Copy the `/exec` URL into `FORM_ENDPOINT` in `js/main.js`.

Submissions post as `application/x-www-form-urlencoded` in `no-cors` mode — Apps Script does not
send CORS headers, so the browser cannot read the response. The POST lands and the confirmation
shows optimistically; check the sheet to confirm a submission arrived. A hidden honeypot field
(`website`) drops bots silently.

Alternative: swap the form for a Google Form embed, as the varsity site does with its
Express Interest link.

## Deploy

Live at **https://n10srugby.org** — GitHub Pages from the repo root on `main`, same pattern as
`varsity-rugby-site`.

DNS is on Squarespace: four A records on the apex to the GitHub Pages IPs
(185.199.108–111.153) and `www` CNAME to `bengfreund-web.github.io`. GitHub
redirects `www` and the old `bengfreund-web.github.io/n10s-site` URL to the
apex, and Let's Encrypt covers both names with HTTPS enforced.

**Never edit the domain by hand** — canonical, `og:url`, `og:image`,
`twitter:image`, `CNAME`, `sitemap.xml` and `robots.txt` all have to move
together or link previews and search results end up split across two hosts:

```bash
python3 scripts/set-domain.py <bare-domain>
```

## Assets

- `img/n10s-logo.png` — full-colour mark, background knocked out, 700px wide
- `img/n10s-logo-white.png` — reversed mark for dark backgrounds (forest green → white, bright
  green kept), 1000px wide
- `img/og-image.png` — 1200×630 share card, mark on forest green with date and location
- `img/favicon-*.png`, `apple-touch-icon.png`, `icon-512.png`, `favicon.ico` — cropped to the
  "10" numerals on forest green; the full lockup is illegible at 32px
- `img/action-1.jpg` — youth match action

All generated from `~/Downloads/National 10s Logo.png`. Regenerating them needs Pillow.

## Known gaps

- **Photos.** The venue stills are frames pulled from the flyover (hero poster t=10.00s, the
  Bozeman Sports Park photo t=50.00s) because every venue image in Downloads carries GNC
  branding. Only one match photo shipped. The other two in the varsity/TRY libraries show
  girls' teams, which conflicts with boys-only 2027 divisions. Needs 3–5 boys middle school /
  U16 match and sideline shots, plus a Bozeman or mountain backdrop.
- **Analytics.** No tag on the page. The varsity site has none to carry over, so a property has
  to be created first.
- **Socials.** Footer has no social links — no accounts identified yet.
- **Contact email.** Using `jd@sportmontana.org` per the plan; swap if a dedicated address is set up.
- **GNC cross-promo.** The About section now mentions the Great Northwest Challenge by name (same
  valley, each summer). If that link should be stronger — a footer link to
  greatnorthwestchallenge.com, or a "sister event" band — say so; if it should be weaker, that one
  sentence is the only reference.
- **FAQ answers** for cost, format, and sanctioning are placeholders pending confirmed details
  (Phase 2).
- **Encoding ladder CRFs.** The two full-res rungs are still ~1.5x the source slice at CRF 28 /
  18. See the ladder table above for the one-line fix if you want them smaller.
- **`assets/flyover-source.mp4` is gitignored** (29 MB, only an input to `prep.py`). Original is
  `~/Downloads/GNC Flyover.mp4.txt` — a real MP4 despite the extension. Keep a durable copy.
- **HUD label** reads "BOZEMAN SPORTS PARK / BOZEMAN, MONTANA". Swap in exact coordinates in
  `HUD_LABEL_2` if you want them — I did not invent a lat/long.
