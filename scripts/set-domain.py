#!/usr/bin/env python3
"""
Point the site at a custom domain.

    python3 scripts/set-domain.py n10srugby.org

Does the repo side only — writes CNAME and rewrites every absolute URL so
nothing still advertises the github.io address:

  CNAME          the bare domain, which is what GitHub Pages reads
  index.html     canonical, og:url, og:image, twitter:image
  sitemap.xml    <loc> and <lastmod>
  robots.txt     Sitemap line

DNS and the GitHub Pages setting are separate; the script prints both.
"""

import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GH_PAGES_IPS = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"]
GH_USER_SITE = "bengfreund-web.github.io"
REPO = "bengfreund-web/n10s-site"


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: set-domain.py <bare-domain>   e.g. n10srugby.org")

    domain = sys.argv[1].strip().lower().rstrip("/")
    domain = re.sub(r"^https?://", "", domain)
    if domain.startswith("www."):
        sys.exit("pass the bare domain (no www) — www is handled by a CNAME record")
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", domain):
        sys.exit(f"that does not look like a domain: {domain}")

    base = f"https://{domain}/"

    (ROOT / "CNAME").write_text(domain + "\n")

    p = ROOT / "index.html"
    s = p.read_text()
    s = re.sub(r'https://[a-z0-9.\-]+\.github\.io/n10s-site/', base, s)
    s = re.sub(r'https://[a-z0-9.\-]+/(?=img/og-image\.png)', base, s)
    p.write_text(s)

    p = ROOT / "sitemap.xml"
    s = p.read_text()
    s = re.sub(r'<loc>[^<]+</loc>', f'<loc>{base}</loc>', s)
    s = re.sub(r'<lastmod>[^<]+</lastmod>', f'<lastmod>{date.today().isoformat()}</lastmod>', s)
    p.write_text(s)

    p = ROOT / "robots.txt"
    s = p.read_text()
    s = re.sub(r'Sitemap: \S+', f'Sitemap: {base}sitemap.xml', s)
    p.write_text(s)

    left = re.findall(r'https://[a-z0-9.\-]*github\.io\S*', (ROOT / "index.html").read_text())
    print(f"repo updated for {domain}")
    print(f"  leftover github.io URLs: {left or 'none'}\n")

    print("DNS — in Squarespace, Settings > Domains > your domain > DNS Settings.")
    print("Remove Squarespace's default A / CNAME records for @ and www, then add:\n")
    print(f"  {'HOST':<8} {'TYPE':<7} VALUE")
    for ip in GH_PAGES_IPS:
        print(f"  {'@':<8} {'A':<7} {ip}")
    print(f"  {'www':<8} {'CNAME':<7} {GH_USER_SITE}")
    print("\nThis is exactly how varsityrugbymontana.org is already set up.\n")

    print("Then tell GitHub about it:")
    print(f"  gh api -X PUT repos/{REPO}/pages -f cname='{domain}'")
    print(f"  gh api -X PUT repos/{REPO}/pages -F https_enforced=true   # after the cert issues\n")
    print("Commit and push, then allow up to an hour for DNS and the TLS cert.")


if __name__ == "__main__":
    main()
