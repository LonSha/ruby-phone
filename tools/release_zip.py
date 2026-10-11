#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""release_zip.py - build the offline runtime package for this repo.

Why this exists: the repo's own docs claim a release ships an offline zip, and
the reviewer flagged that (a) there were 0 tags / 0 releases, and (b) the claim
had no artifact behind it. This script makes the artifact real, and derives its
member set from `git ls-files` so the package can never drift from the tracked
sources (no hand-written file list).

What goes in: every tracked file EXCEPT the development-only surfaces
(tests / tools / scripts / docs / .agents / archive + repo metadata).
What comes out: dist/<name>-v<version>.zip  (name/version from manifest.json).

Usage:
  python3 tools/release_zip.py            # build only
  python3 tools/release_zip.py --print    # print member list and exit
"""
import io
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# development-only top-level dirs (kept out of the shipped package)
EXCLUDE_DIRS = {'tests', 'tools', 'scripts', 'docs', '.agents', 'archive',
                'dist', 'node_modules', '.git', '.git-msgs', '.sourcematerial'}
# repo metadata never needed at runtime
EXCLUDE_FILES = {'.gitignore', 'package.json'}


def tracked():
    out = subprocess.run(['git', '-C', ROOT, 'ls-files'],
                         capture_output=True, text=True, check=True).stdout
    return [l for l in out.splitlines() if l.strip()]


def members():
    keep = []
    for rel in tracked():
        parts = rel.split('/')
        if parts[0] in EXCLUDE_DIRS:
            continue
        if rel in EXCLUDE_FILES:
            continue
        if not os.path.isfile(os.path.join(ROOT, rel)):
            continue
        keep.append(rel)
    return sorted(keep)


def main():
    man = json.load(io.open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8'))
    name = os.path.basename(ROOT)
    ver = str(man.get('version') or '')
    assert ver, 'manifest.json has no version'
    ms = members()
    # fail-closed sanity: a package without its entry points is not a package
    assert 'manifest.json' in ms, 'manifest.json missing from members'
    assert any(m in ms for m in ('index.js',)), 'index.js missing from members'
    if '--print' in sys.argv:
        print('\n'.join(ms))
        print('--- %d files, version %s ---' % (len(ms), ver))
        return 0
    dist = os.path.join(ROOT, 'dist')
    os.makedirs(dist, exist_ok=True)
    out = os.path.join(dist, '%s-v%s.zip' % (name, ver))
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in ms:
            z.write(os.path.join(ROOT, rel), '%s/%s' % (name, rel))
    size = os.path.getsize(out)
    print('[release-zip] %s  files=%d  bytes=%d' % (out, len(ms), size))
    return 0


if __name__ == '__main__':
    sys.exit(main())
