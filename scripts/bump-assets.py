#!/usr/bin/env python3
"""
Bump the ?v= cache-busting query on css/js in index.html.

GitHub Pages serves CSS and JS with caching that outlives a push, so a visitor
who has been on the site before can keep running the old files — which is
exactly how a broken build looks like a working one. Run this before pushing
any change to css/ or js/:

    python3 scripts/bump-assets.py
"""
import re
import time
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "index.html"

def main():
    s = INDEX.read_text()
    v = str(int(time.time()))
    s, n1 = re.subn(r'(src="js/[a-z-]+\.js)(\?v=\d+)?', r'\1?v=' + v, s)
    s, n2 = re.subn(r'(href="css/[a-z-]+\.css)(\?v=\d+)?', r'\1?v=' + v, s)
    INDEX.write_text(s)
    print(f"bumped {n1} script(s) and {n2} stylesheet(s) to v={v}")

if __name__ == "__main__":
    main()
