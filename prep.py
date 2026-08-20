#!/usr/bin/env python3
"""
N10s 2027 — hero footage prep.

  python3 prep.py                 # probe + sharpness + loop candidates + poster + encodes
  python3 prep.py --analyze-only  # everything except the encoding ladder
  python3 prep.py --encode-only   # ladder only (uses cached analysis if present)
  python3 prep.py --ffmpeg /path/to/ffmpeg

Deliberately does NOT trim the source. Step 1b reports loop candidates for a
human to pick; trimming happens later, by hand, with the chosen in/out points.

Requires: opencv-python (cv2), Pillow, and an ffmpeg with libx264 + libsvtav1.
"""

import argparse
import csv
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# ----------------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "assets" / "flyover-source.mp4"
OUT = ROOT / "assets"
REPORTS = ROOT / "reports"

SAMPLE_INTERVAL = 0.25          # seconds between sharpness samples (Step 1b)
LOOP_MIN, LOOP_MAX = 8.0, 15.0  # candidate loop window length, seconds
LOOP_STEP = 0.25                # granularity of the window search
TOP_CANDIDATES = 6              # loop candidates to report
SHARPNESS_WEIGHT = 0.60         # score = w*sharpness_norm + (1-w)*(1 - shake_norm)
PHASECORR_WIDTH = 512           # downscale width for the shake/motion estimate

POSTER_JPEG_Q = 92
POSTER_WEBP_Q = 90

# --- CHOSEN HERO LOOP ------------------------------------------------------
# Picked from the Step 1b candidates (score 0.997: highest median sharpness,
# near-lowest shake). Set both to None to encode the full source again.
LOOP_IN, LOOP_OUT = 10.00, 18.75

# Where the poster frame comes from once a loop is set:
#   "loop-start"       first frame of the loop — no jump when playback starts
#   "sharpest-in-loop" sharpest sample inside the window
#   "sharpest-overall" sharpest sample anywhere in the source
# loop-start is the default: the poster is what a video client sees for the
# instant before playback, so matching frame one matters more than a marginal
# sharpness win. (Here it costs little: t=10.00 is rank 4 of 219 anyway.)
POSTER_MODE = "loop-start"

# Light sharpening applied to every rung; set to None to disable.
UNSHARP = "unsharp=5:5:0.45:5:5:0.0"

# Encoding ladder. `width=None` means "source resolution, no scale filter".
# Add a rung by adding a dict; nothing else needs to change.
LADDER = [
    {
        "name": "hero.av1.webm",
        "width": None,
        "args": ["-c:v", "libsvtav1", "-crf", "26", "-preset", "4",
                 "-pix_fmt", "yuv420p", "-svtav1-params", "tune=0"],
    },
    {
        "name": "hero.h264.mp4",
        "width": None,
        "args": ["-c:v", "libx264", "-crf", "18", "-preset", "slow",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    },
    {
        "name": "hero-1080.mp4",
        "width": 1920,
        "args": ["-c:v", "libx264", "-crf", "18", "-preset", "slow",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    },
    # --- small-viewport rung -------------------------------------------------
    # The three rungs above are all 1920 wide, because the source is 1920 wide
    # and we never upscale — so "hero-1080.mp4" is a same-resolution
    # re-encode and the <1280px tier saves a viewer nothing. These two are the
    # rung that tier actually needs. CRFs are higher than the spec's 28/18 on
    # purpose: at 18/28 every rung comes out LARGER than the source (see the
    # ladder report), which is the wrong trade for a muted background loop.
    {
        "name": "hero-1280.av1.webm",
        "width": 1280,
        "args": ["-c:v", "libsvtav1", "-crf", "32", "-preset", "4",
                 "-pix_fmt", "yuv420p"],
    },
    {
        "name": "hero-1280.mp4",
        "width": 1280,
        "args": ["-c:v", "libx264", "-crf", "22", "-preset", "slow",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    },
]


# ----------------------------------------------------------------------------
# tool discovery
# ----------------------------------------------------------------------------

def find_ffmpeg(explicit=None):
    if explicit:
        return explicit
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    # project-local venv fallback
    for p in ROOT.glob(".venv/lib/*/site-packages/imageio_ffmpeg/binaries/ffmpeg*"):
        if os.access(p, os.X_OK):
            return str(p)
    sys.exit("ffmpeg not found. Install one, or pass --ffmpeg /path/to/ffmpeg")


def find_ffprobe():
    return shutil.which("ffprobe")


# ----------------------------------------------------------------------------
# STEP 1a — probe
# ----------------------------------------------------------------------------

def probe(ffmpeg, ffprobe):
    """Real ffprobe when available; otherwise parse `ffmpeg -i` for the same fields."""
    info = {}

    if ffprobe:
        raw = subprocess.run(
            [ffprobe, "-v", "error", "-show_format", "-show_streams",
             "-of", "json", str(SRC)],
            capture_output=True, text=True).stdout
        data = json.loads(raw)
        v = next(s for s in data["streams"] if s["codec_type"] == "video")
        num, den = (v.get("r_frame_rate") or "0/1").split("/")
        info = {
            "source": "ffprobe",
            "codec": f'{v.get("codec_name")} ({v.get("profile")})',
            "width": int(v["width"]),
            "height": int(v["height"]),
            "fps": round(int(num) / int(den), 3) if int(den) else None,
            "duration_s": round(float(data["format"]["duration"]), 2),
            "bitrate_kbps": round(int(data["format"]["bit_rate"]) / 1000),
            "pix_fmt": v.get("pix_fmt"),
            "color_space": v.get("color_space"),
            "color_primaries": v.get("color_primaries"),
            "color_transfer": v.get("color_transfer"),
            "color_range": v.get("color_range"),
            "audio_streams": sum(1 for s in data["streams"] if s["codec_type"] == "audio"),
        }
    else:
        err = subprocess.run([ffmpeg, "-hide_banner", "-i", str(SRC)],
                             capture_output=True, text=True).stderr
        vline = next((l for l in err.splitlines() if "Stream #" in l and "Video:" in l), "")
        dline = next((l for l in err.splitlines() if l.strip().startswith("Duration:")), "")

        res = re.search(r"(\d{2,5})x(\d{2,5})", vline)
        fps = re.search(r"([\d.]+) fps", vline)
        vbr = re.search(r"(\d+) kb/s", vline)
        dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", dline)
        tbr = re.search(r"bitrate: (\d+) kb/s", dline)
        codec = re.search(r"Video: (\w+)(?: \(([^)]+)\))?", vline)
        pix = re.search(r"(yuv\w+|gbr\w+|nv\d+)\(([^)]*)\)", vline)

        colr = [c.strip() for c in (pix.group(2).split(",") if pix else [])]
        info = {
            "source": "ffmpeg -i (no ffprobe binary on this machine)",
            "codec": f"{codec.group(1)} ({codec.group(2)})" if codec and codec.group(2) else (codec.group(1) if codec else None),
            "width": int(res.group(1)) if res else None,
            "height": int(res.group(2)) if res else None,
            "fps": float(fps.group(1)) if fps else None,
            "duration_s": round(int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3)), 2) if dur else None,
            "bitrate_kbps": int(vbr.group(1)) if vbr else (int(tbr.group(1)) if tbr else None),
            "pix_fmt": pix.group(1) if pix else None,
            "color_space": next((c for c in colr if c.startswith("bt") or c.startswith("smpte")), None),
            "color_range": next((c for c in colr if c in ("tv", "pc", "limited", "full")), None),
            "audio_streams": sum(1 for l in err.splitlines() if "Stream #" in l and "Audio:" in l),
        }

    print("=" * 74)
    print("STEP 1a — SOURCE PROBE")
    print("=" * 74)
    for k, v in info.items():
        print(f"  {k:<18} {v}")
    print(f"\n  ceiling: no rung may exceed {info['width']}x{info['height']} @ {info['fps']}fps")
    if info["audio_streams"] == 0:
        print("  note: source has no audio track; -an is still passed on every rung")
    print()
    return info


# ----------------------------------------------------------------------------
# STEP 1b — sharpness + shake
# ----------------------------------------------------------------------------

def analyze(info):
    cap = cv2.VideoCapture(str(SRC))
    fps = info["fps"] or cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # frame indices on the sample grid
    times = np.arange(0.0, info["duration_s"], SAMPLE_INTERVAL)
    wanted = {int(round(t * fps)): float(t) for t in times}

    samples = []          # {t, frame, lapvar}
    prev_small = None
    motion = []           # per-sample (dx, dy) vs previous sample

    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx in wanted:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            lap = cv2.Laplacian(gray, cv2.CV_64F).var()

            h, w = gray.shape
            sw = PHASECORR_WIDTH
            sh = max(1, int(h * sw / w))
            small = cv2.resize(gray, (sw, sh)).astype(np.float32)
            if prev_small is not None:
                (dx, dy), _ = cv2.phaseCorrelate(prev_small, small)
                motion.append((dx / sw, dy / sw))     # normalised by width
            else:
                motion.append((0.0, 0.0))
            prev_small = small

            samples.append({"t": wanted[idx], "frame": idx, "lapvar": float(lap)})
        idx += 1
    cap.release()

    # shake = magnitude of the *change* in camera motion (jerk).
    # A smooth drone push has near-constant motion -> low jerk.
    # Hand shake / gusts show up as high-frequency direction changes.
    jerk = [0.0]
    for i in range(1, len(motion)):
        ddx = motion[i][0] - motion[i - 1][0]
        ddy = motion[i][1] - motion[i - 1][1]
        jerk.append(float(np.hypot(ddx, ddy)))
    for s, m, j in zip(samples, motion, jerk):
        s["motion_mag"] = float(np.hypot(*m))
        s["jerk"] = j

    REPORTS.mkdir(exist_ok=True)
    with open(REPORTS / "sharpness.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["t", "frame", "lapvar", "motion_mag", "jerk"])
        w.writeheader()
        w.writerows(samples)

    ranked = sorted(samples, key=lambda s: -s["lapvar"])

    print("=" * 74)
    print(f"STEP 1b — SHARPNESS  ({len(samples)} samples @ {SAMPLE_INTERVAL}s, Laplacian variance)")
    print("=" * 74)
    vals = [s["lapvar"] for s in samples]
    print(f"  min {min(vals):.1f}   median {statistics.median(vals):.1f}   "
          f"mean {statistics.mean(vals):.1f}   max {max(vals):.1f}")
    print(f"  full ranked list -> {REPORTS / 'sharpness.csv'}\n")
    print("  RANK    t(s)     frame    lapvar     jerk")
    for i, s in enumerate(ranked[:20], 1):
        print(f"  {i:>4}  {s['t']:>7.2f}  {s['frame']:>8}  {s['lapvar']:>9.1f}  {s['jerk']:>8.5f}")
    print("\n  softest 5:")
    for s in ranked[-5:]:
        print(f"        {s['t']:>7.2f}  {s['frame']:>8}  {s['lapvar']:>9.1f}")
    print()
    return samples, ranked


# ----------------------------------------------------------------------------
# STEP 1b — poster frame
# ----------------------------------------------------------------------------

def export_poster(ranked, samples=None):
    if LOOP_IN is not None and POSTER_MODE != "sharpest-overall" and samples:
        inwin = [s for s in samples if LOOP_IN <= s["t"] <= LOOP_OUT]
        if inwin:
            best = (min(inwin, key=lambda s: abs(s["t"] - LOOP_IN))
                    if POSTER_MODE == "loop-start"
                    else max(inwin, key=lambda s: s["lapvar"]))
        else:
            best = ranked[0]
    else:
        best = ranked[0]
    cap = cv2.VideoCapture(str(SRC))
    cap.set(cv2.CAP_PROP_POS_FRAMES, best["frame"])
    ok, frame = cap.read()
    cap.release()
    if not ok:
        sys.exit(f"could not read frame {best['frame']}")

    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    jpg = OUT / "hero-poster.jpg"
    webp = OUT / "hero-poster.webp"
    img.save(jpg, "JPEG", quality=POSTER_JPEG_Q, subsampling=0, optimize=True)
    img.save(webp, "WEBP", quality=POSTER_WEBP_Q, method=6)

    print("=" * 74)
    print("STEP 1b — POSTER FRAME (full source resolution, mode=%s)" % POSTER_MODE)
    print("=" * 74)
    print(f"  frame {best['frame']}  t={best['t']:.2f}s  lapvar={best['lapvar']:.1f}  {img.width}x{img.height}")
    print(f"  {webp.name:<24} {webp.stat().st_size/1024:>8.1f} KB   (q{POSTER_WEBP_Q})")
    print(f"  {jpg.name:<24} {jpg.stat().st_size/1024:>8.1f} KB   (q{POSTER_JPEG_Q})")
    print()
    return best


# ----------------------------------------------------------------------------
# STEP 1b — loop window candidates  (report only, no trimming)
# ----------------------------------------------------------------------------

def loop_candidates(samples, info):
    ts = [s["t"] for s in samples]
    sharp = [s["lapvar"] for s in samples]
    jerk = [s["jerk"] for s in samples]

    cands = []
    n = len(samples)
    dur = info["duration_s"]
    win_lens = np.arange(LOOP_MIN, LOOP_MAX + 1e-9, LOOP_STEP)

    for i in range(n):
        for L in win_lens:
            t0, t1 = ts[i], ts[i] + L
            if t1 > dur:
                break
            j = int(round(t1 / SAMPLE_INTERVAL))
            if j >= n:
                break
            seg_sharp = sharp[i:j + 1]
            seg_jerk = jerk[i + 1:j + 1]
            if len(seg_sharp) < 4 or not seg_jerk:
                continue
            cands.append({
                "in": round(t0, 2),
                "out": round(t1, 2),
                "len": round(L, 2),
                "median_sharpness": round(statistics.median(seg_sharp), 1),
                "min_sharpness": round(min(seg_sharp), 1),
                "mean_jerk": round(statistics.mean(seg_jerk), 6),
                "max_jerk": round(max(seg_jerk), 6),
            })

    if not cands:
        print("no loop candidates fit the duration constraints\n")
        return []

    sh = [c["median_sharpness"] for c in cands]
    jk = [c["mean_jerk"] for c in cands]
    sh_lo, sh_hi = min(sh), max(sh)
    jk_lo, jk_hi = min(jk), max(jk)

    def norm(v, lo, hi):
        return 0.0 if hi - lo < 1e-12 else (v - lo) / (hi - lo)

    for c in cands:
        s_n = norm(c["median_sharpness"], sh_lo, sh_hi)
        j_n = norm(c["mean_jerk"], jk_lo, jk_hi)
        c["score"] = round(SHARPNESS_WEIGHT * s_n + (1 - SHARPNESS_WEIGHT) * (1 - j_n), 4)

    cands.sort(key=lambda c: -c["score"])

    # de-overlap: keep the best, then only candidates overlapping it <50%
    picked = []
    for c in cands:
        if all(min(c["out"], p["out"]) - max(c["in"], p["in"]) < 0.5 * min(c["len"], p["len"])
               for p in picked):
            picked.append(c)
        if len(picked) >= TOP_CANDIDATES:
            break

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "loop-candidates.json").write_text(json.dumps(picked, indent=2))

    print("=" * 74)
    print(f"STEP 1b — HERO LOOP CANDIDATES  ({LOOP_MIN:.0f}-{LOOP_MAX:.0f}s, "
          f"score = {SHARPNESS_WEIGHT:.2f}*sharpness + {1-SHARPNESS_WEIGHT:.2f}*steadiness)")
    print("=" * 74)
    print("   #   IN      OUT     LEN    MED.SHARP   MIN.SHARP   MEAN JERK   MAX JERK   SCORE")
    for i, c in enumerate(picked, 1):
        print(f"  {i:>2}  {c['in']:>6.2f}  {c['out']:>6.2f}  {c['len']:>5.2f}  "
              f"{c['median_sharpness']:>10.1f}  {c['min_sharpness']:>10.1f}  "
              f"{c['mean_jerk']:>10.5f}  {c['max_jerk']:>9.5f}  {c['score']:>6.3f}")

    best = picked[0]
    print(f"\n  TOP CANDIDATE:  in={best['in']:.2f}s  out={best['out']:.2f}s  ({best['len']:.2f}s)")
    if LOOP_IN is None:
        print("  No loop selected. Set LOOP_IN / LOOP_OUT at the top of this file")
        print("  to trim the ladder and the poster to a window.")
    else:
        print(f"  SELECTED (LOOP_IN/LOOP_OUT):  in={LOOP_IN:.2f}s  out={LOOP_OUT:.2f}s  "
              f"({LOOP_OUT - LOOP_IN:.2f}s)")
        if abs(LOOP_IN - best["in"]) > 0.01 or abs(LOOP_OUT - best["out"]) > 0.01:
            print("  note: the selected window is not the top-scoring candidate")
    print(f"  candidates -> {REPORTS / 'loop-candidates.json'}\n")
    return picked


# ----------------------------------------------------------------------------
# STEP 1c — encoding ladder
# ----------------------------------------------------------------------------

def encode(ffmpeg, info):
    print("=" * 74)
    print("STEP 1c — ENCODING LADDER")
    print("=" * 74)
    if LOOP_IN is not None:
        print(f"  trimmed to the chosen loop: {LOOP_IN:.2f}s -> {LOOP_OUT:.2f}s "
              f"({LOOP_OUT - LOOP_IN:.2f}s)\n")
    src_w = info["width"]
    results = []

    for rung in LADDER:
        out = OUT / rung["name"]
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
        if LOOP_IN is not None:
            # -ss before -i for a fast seek, -t as a duration so the window is
            # unambiguous regardless of ffmpeg's -to timeline semantics.
            cmd += ["-ss", str(LOOP_IN), "-t", str(round(LOOP_OUT - LOOP_IN, 3))]
        cmd += ["-i", str(SRC), "-an"]

        target = rung["width"]
        chain = []
        if target is None:
            note = "source resolution"
        elif target >= src_w:
            note = f"requested {target}w >= source {src_w}w — no scale filter (never upscale)"
        else:
            chain.append(f"scale={target}:-2:flags=lanczos")
            note = f"scaled to {target}w"
        # A light unsharp pass. The master is a 4.5 Mbps delivery file, so extra
        # bitrate mostly preserves its existing artefacts; sharpening is what
        # actually reads as a crisper hero. Kept mild to avoid ringing on the
        # pitch lines.
        if UNSHARP:
            chain.append(UNSHARP)
            note += " + unsharp"
        if chain:
            cmd += ["-vf", ",".join(chain)]

        cmd += rung["args"] + [str(out)]
        print(f"  {rung['name']}  ({note})")
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"    FAILED: {r.stderr.strip()[:400]}")
            continue
        kb = out.stat().st_size / 1024
        results.append((rung["name"], kb, note))
        print(f"    {kb/1024:.2f} MB")

    print("\n  FILE                      SIZE       vs SOURCE   NOTE")
    src_kb = SRC.stat().st_size / 1024
    if LOOP_IN is not None:
        # Stream-copy the same window so the comparison is like-for-like.
        # Pro-rating by duration would misstate it: the source bitrate is not flat.
        tmp = OUT / ".loop-slice-ref.mp4"
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                        "-ss", str(LOOP_IN), "-t", str(round(LOOP_OUT - LOOP_IN, 3)),
                        "-i", str(SRC), "-an", "-c", "copy", str(tmp)],
                       capture_output=True)
        if tmp.exists():
            src_kb = tmp.stat().st_size / 1024
            tmp.unlink()
    label = 'source slice (stream copy)' if LOOP_IN is not None else 'flyover-source.mp4 (src)'
    print(f"  {label:<24} {src_kb/1024:>7.2f} MB      —        1920x1080 h264")
    for name, kb, note in results:
        print(f"  {name:<24} {kb/1024:>7.2f} MB   {kb/src_kb*100:>6.1f}%     {note}")
    print()


# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg")
    ap.add_argument("--analyze-only", action="store_true")
    ap.add_argument("--encode-only", action="store_true")
    args = ap.parse_args()

    if not SRC.exists():
        sys.exit(f"source not found: {SRC}")

    ffmpeg = find_ffmpeg(args.ffmpeg)
    ffprobe = find_ffprobe()
    print(f"\nffmpeg:  {ffmpeg}")
    print(f"ffprobe: {ffprobe or 'not installed — falling back to `ffmpeg -i` parsing'}\n")

    info = probe(ffmpeg, ffprobe)

    if not args.encode_only:
        samples, ranked = analyze(info)
        export_poster(ranked, samples)
        loop_candidates(samples, info)

    if not args.analyze_only:
        encode(ffmpeg, info)


if __name__ == "__main__":
    main()
