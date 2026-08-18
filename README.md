# N10s Rugby Championship

Single-page site for the National 10s Rugby Championship — May 15–16, 2027, Bozeman Sports Park,
Bozeman, Montana. An event of the Montana Institute of Sport.

Built on the same static pattern as `varsity-rugby-site`: plain HTML/CSS/JS, no build step,
deployed from the repo root via GitHub Pages.

Copy and page structure follow the GNC 2027 page (`~/Downloads/GNC_2027.html`) — big date/location
hero block over a divider and one-line positioning statement, a four-stat bar, section
label + Title Case headline pairs, three about badges, arrow-link action cards, a
"Resources / Plan Your Trip" block, and an event line + link columns in the footer.

```
index.html            the whole page
css/styles.css        brand tokens + all styles
js/main.js            nav, scroll progress, reveal-on-scroll, interest form
js/hero-sequence.js   pinned video hero: stages, scan reveal, HUD
prep.py               footage analysis + encoding ladder
scripts/              Google Apps Script endpoint for the form (not served)
img/                  logo, icons, OG image, photos
assets/               hero footage, poster stills, encodes (large ones gitignored)
reports/              sharpness.csv, loop-candidates.json from prep.py
```

## Hero scroll sequence

A 400vh track (200vh under 768px) with a sticky 100svh pin. One normalised
progress value drives four stages, all thresholds named at the top of
`js/hero-sequence.js`:

| Stage | p | What happens |
|---|---|---|
| A | 0.00–0.20 | Footage only. Scroll cue, no text, no scrim. |
| B | 0.20–0.45 | Scrim fades up, heading lines enter staggered; scan reveal runs. |
| C | 0.45–0.75 | Info links enter on the same rhythm; heading lifts to make room. |
| D | 0.75–1.00 | Hero fades and scales down, page rises over it, pin releases. |

Only `transform` and `opacity` are animated. Scroll is throttled through
requestAnimationFrame and layout is never read in the handler — geometry is
cached in `measure()` on resize.

**Scan reveal.** One `<video>` plus one `<canvas>` (never two stacked videos —
they drift). Per frame the canvas draws the video, clips to a focus region,
and applies contrast → duotone → Sobel edges; everything outside the region
stays transparent. An SVG HUD adds corner brackets, edge ticks, a scan line
tied to scroll position, and a monospace label. `FOCUS_REGIONS` is an array of
normalised `{x,y,w,h}` rects that cycle across stage B.

**Budgets.** Canvas loop capped at 30fps, rendered at half resolution and
upscaled by CSS, and killed entirely outside stage B, when the tab is hidden,
or when the hero leaves the viewport. The video pauses once fully covered.

**Fallbacks.** `prefers-reduced-motion`, Save-Data / 2g-3g, and viewports under
768px all get the poster still: the `<source>` elements are detached so nothing
downloads at all. Hero copy is in the DOM at all times and only ever
transformed, so keyboard and screen reader users get everything without
scrolling; there is a skip link, and focused hero links are forced visible
regardless of stage.

## Footage prep

```bash
python3 prep.py                 # probe + sharpness + loop candidates + poster + ladder
python3 prep.py --analyze-only  # no encoding
```

Needs `cv2`, `Pillow`, and an ffmpeg with libx264 + libsvtav1. If `ffprobe` is
not installed it falls back to parsing `ffmpeg -i` for the same fields.

Source is 1920x1080, 29.97fps, h264 High, yuv420p, bt709, 54.65s, no audio.

**The hero footage is not trimmed yet.** `prep.py` reports loop candidates
rather than cutting one, and the full-length encodes are gitignored because
they are 15–67 MB. Pick a window from `reports/loop-candidates.json`, trim, and
commit the small result. The recommended window is 10.00s → 18.75s.

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

Type: Barlow Condensed italic for display/headings and eyebrows, Poppins for body.

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

GitHub Pages from the repo root on the default branch, same as `varsity-rugby-site`.

Before going live, replace the placeholder URL `https://n10srugby.github.io/` in:

- `index.html` — `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`
- `sitemap.xml`
- `robots.txt`

If a custom domain is used, add a `CNAME` file at the repo root with the bare domain. There is
deliberately no `CNAME` in the repo yet — an unregistered domain in that file breaks the site.

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

- **Photos.** Only one usable photo shipped. The other two in the varsity/TRY libraries show
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
- **Hero footage is untrimmed.** Full-length encodes are gitignored; the site will fall back to
  the poster still until a trimmed loop is committed.
- **Encoding ladder CRFs.** At the specified CRF 28 (AV1) / CRF 18 (x264) every rung comes out
  larger than the source, which is already a 4.5 Mbps delivery file. See the ladder report.
- **HUD label** reads "BOZEMAN SPORTS PARK / BOZEMAN, MONTANA". Swap in exact coordinates in
  `HUD_LABEL_2` if you want them — I did not invent a lat/long.
