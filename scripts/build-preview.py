#!/usr/bin/env python3
"""
Build a single self-contained HTML file of the site, for sharing as a link.

Everything is inlined — CSS, JS, fonts, images and one video rung — because
the target viewer blocks external requests. Output is written to
build/n10s-preview.html and is typically ~7 MB.

  python3 scripts/build-preview.py

Differences from the deployed site, all deliberate:
  - one 1280-wide H.264 rung instead of the four-file tier ladder, since AV1
    support is patchy in Safari and a shared link has to play anywhere
  - photos downscaled and re-compressed for embedding
  - Oswald/Poppins woff2 inlined from scripts/preview-fonts/ rather than
    linked from Google Fonts
"""

import base64
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "scripts" / "preview-fonts"
BUILD = ROOT / "build"
TMP = BUILD / "tmp"
OUT = BUILD / "n10s-preview.html"

FONT_FACES = [("Oswald", "600"), ("Poppins", "400"), ("Poppins", "500"),
              ("Poppins", "600"), ("Poppins", "700")]

PREVIEW_VIDEO_WIDTH = 1280
PREVIEW_VIDEO_CRF = 27
SIZE_CAP_MB = 16


def find_ffmpeg():
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    for p in ROOT.glob(".venv/lib/*/site-packages/imageio_ffmpeg/binaries/ffmpeg*"):
        if os.access(p, os.X_OK):
            return str(p)
    sys.exit("ffmpeg not found (see README > Footage prep)")


def uri(path, mime):
    return "data:%s;base64,%s" % (mime, base64.b64encode(Path(path).read_bytes()).decode())


def main():
    from PIL import Image

    TMP.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()

    # --- one universally-playable video rung --------------------------------
    vid = TMP / "hero.mp4"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-i", str(ROOT / "assets" / "hero.h264.mp4"), "-an",
                    "-vf", f"scale={PREVIEW_VIDEO_WIDTH}:-2:flags=lanczos",
                    "-c:v", "libx264", "-crf", str(PREVIEW_VIDEO_CRF),
                    "-preset", "slow", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", str(vid)], check=True)

    def shrink(src, name, width, quality=80):
        dst = TMP / name
        im = Image.open(src).convert("RGB")
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
        return dst

    def shrink_png(src, name, box=480):
        dst = TMP / name
        im = Image.open(src)
        im.thumbnail((box, box), Image.LANCZOS)
        im.save(dst, optimize=True)
        return dst

    # Derive the embed list from the markup, so a photo added to the page can
    # never silently fall out of the build.
    html_src = (ROOT / "index.html").read_text()
    referenced = sorted(set(re.findall(r'(?:src|poster)="((?:img|assets)/[^"]+)"', html_src)))

    poster = shrink(ROOT / "assets/hero-poster.jpg", "poster.jpg", 1280)
    assets = {
        "assets/hero-poster.jpg":  uri(poster, "image/jpeg"),
        "assets/hero-poster.webp": uri(poster, "image/jpeg"),
    }
    for rel in referenced:
        if rel in assets or rel.endswith((".mp4", ".webm")):
            continue
        src = ROOT / rel
        if not src.exists():
            sys.exit(f"referenced but missing: {rel}")
        name = rel.replace("/", "_")
        if rel.endswith(".png"):
            assets[rel] = uri(shrink_png(src, name), "image/png")
        else:
            assets[rel] = uri(shrink(src, name + ".jpg", 1100), "image/jpeg")
        print(f"  embedded {rel}")

    video_uri = uri(vid, "video/mp4")

    # --- fonts ---------------------------------------------------------------
    faces = []
    for fam, wt in FONT_FACES:
        f = FONTS / f"{fam}-{wt}.woff2"
        if not f.exists():
            sys.exit(f"missing {f} — see the note at the top of this script")
        faces.append("@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
                     "font-display:swap;src:url(%s) format('woff2');}"
                     % (fam, wt, uri(f, "font/woff2")))
    font_css = "/* Inlined: the share target blocks font CDNs. */\n" + "\n".join(faces)

    css = (ROOT / "css/styles.css").read_text()
    html = (ROOT / "index.html").read_text()
    main_js = (ROOT / "js/main.js").read_text()
    hero_js = (ROOT / "js/hero-sequence.js").read_text()

    # --- swap the tier ladder for the single embedded rung -------------------
    html = re.sub(r'\s*<source src="assets/hero[^"]*"[^>]*>', "", html)
    html = html.replace('poster="assets/hero-poster.jpg"',
                        'poster="%s"' % assets["assets/hero-poster.jpg"])
    html = html.replace("</video>",
                        '  <source src="%s" type="video/mp4">\n        </video>' % video_uri)
    for k, v in assets.items():
        html = html.replace('src="%s"' % k, 'src="%s"' % v)

    hero_js, n = re.subn(r"const list = wide\s*\n.*?\n.*?\n.*?\n.*?;",
                         "const list = [[\"%s\", 'video/mp4']];  /* single embedded rung */" % video_uri,
                         hero_js, flags=re.S)
    if n != 1:
        sys.exit("could not patch the source list in hero-sequence.js")

    # --- strip the document shell; the share target supplies it --------------
    body = html[html.index("<body>") + len("<body>"):html.index("</body>")]
    body = re.sub(r'\s*<script src="js/[^"]+"></script>', "", body)

    # The `js` class is set in <head> on the real page; the shell is stripped
    # here, so re-emit it first or the hero copy flashes on load.
    OUT.write_text(
        "<title>N10s Rugby Championship</title>\n"
        "<script>document.documentElement.className += ' js';</script>\n"
        "<style>\n" + font_css + "\n\n" + css + "\n</style>\n"
        + body.strip() + "\n\n"
        "<script>\n" + main_js + "\n</script>\n"
        "<script>\n" + hero_js + "\n</script>\n")

    leftover = re.findall(
        r'(?:src|href)="(?!data:|#|mailto:|https://(?:montanainstituteofsport|www\.google))[^"]+"',
        OUT.read_text())
    mb = OUT.stat().st_size / 1048576
    print(f"{OUT.relative_to(ROOT)}  {mb:.2f} MB  (cap {SIZE_CAP_MB} MB)")
    print("external references:", leftover or "none")
    if leftover:
        sys.exit("external references would be blocked by the share target's CSP")
    if mb > SIZE_CAP_MB:
        sys.exit("over the size cap")


if __name__ == "__main__":
    main()
