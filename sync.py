#!/usr/bin/env python3
"""Turns one person's content-idea notes into this site's data file.

Teo:    python3 sync.py --author teo   --notes "/path/to/Vault/Brand/Content"
Conor:  python3 sync.py --author conor --notes "/path/to/his/notes/folder"
Add --push to commit the new data file and publish it (the site updates in about a minute).

Each person only ever writes their own file (data/ideas-<author>.js), so Teo and Conor
never overwrite each other. The page loads every data/ideas-*.js file and merges them.

A note is an idea if it has text, an Instagram link, or tags. The tags are read from the
note's front matter: themes, micro_themes, status, location, collection (each a list of [[links]]).
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys

SKIP_DIRS = ('zThemes', 'zzMicro Themes', 'zzStatus', 'zzzLocations', 'zzCollections', 'Utility', 'Captions')
SKIP_NAMES = ('MAIN CONTENT FILE', 'Content Picker', 'social_daily_notes_transfer')
FIELDS = ('themes', 'micro_themes', 'status', 'location', 'collection')
HERE = os.path.dirname(os.path.abspath(__file__))

def parse(text):
    fm, body = {}, text
    m = re.match(r'^---\n(.*?)\n---\n?(.*)$', text, re.S)
    if m:
        block, body = m.group(1), m.group(2)
        for f in FIELDS:
            mm = re.search(r'^' + f + r':[ \t]*\n((?:[ \t]+- .*\n?)+)', block + '\n', re.M)
            fm[f] = re.findall(r'\[\[(.*?)\]\]', mm.group(1)) if mm else []
    return fm, body

def clean_body(body):
    b = re.sub(r'https?://\S+', '', body)
    b = re.sub(r'\[\[(.*?)\]\]', r'\1', b)
    b = re.sub(r'^[-_=*#> ]{3,}$', '', b, flags=re.M)
    return re.sub(r'\n{2,}', '\n', b).strip()

def ig_clean(u):
    m = re.match(r'(https?://(?:www\.)?instagram\.com/(?:[\w.]+/)?(p|reel|reels|tv)/([\w-]+))', u)
    if not m:
        return u
    kind = 'reel' if m.group(2) in ('reel', 'reels') else m.group(2)
    return 'https://www.instagram.com/%s/%s/' % (kind, m.group(3))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--author', required=True, help='teo or conor (a short lowercase name)')
    ap.add_argument('--notes', required=True, help='folder holding the idea notes (Teo: Vault/Brand/Content)')
    ap.add_argument('--prefix', default='Brand/Content/', help='text shown before each note path')
    ap.add_argument('--push', action='store_true', help='commit and push the data file')
    a = ap.parse_args()
    author = re.sub(r'[^a-z0-9-]', '', a.author.lower())
    root = os.path.abspath(os.path.expanduser(a.notes))
    if not os.path.isdir(root):
        sys.exit('Notes folder not found: ' + root)
    ideas = []
    for r, dirs, files in os.walk(root):
        rel = os.path.relpath(r, root)
        if rel != '.' and rel.split(os.sep)[0] in SKIP_DIRS:
            continue
        for f in files:
            if not f.endswith('.md'):
                continue
            name = f[:-3]
            if name in SKIP_NAMES or name.startswith('a_Template'):
                continue
            p = os.path.join(r, f)
            try:
                text = open(p, errors='ignore').read()
            except Exception:
                continue
            fm, body = parse(text)
            urls = re.findall(r'https?://[^\s)>\]"]+', body)
            links = [ig_clean(u) for u in urls if 'instagram.com' in u]
            other = [u for u in urls if 'instagram.com' not in u]
            txt = clean_body(body)
            if not (txt or links or any(fm.get(k) for k in FIELDS)):
                continue
            h = hashlib.md5(os.path.relpath(p, root).encode()).hexdigest()[:10]
            parts = [] if rel == '.' else rel.split(os.sep)
            ideas.append({
                'id': h if author == 'teo' else author + '-' + h,
                'name': name,
                'path': a.prefix + os.path.relpath(p, root),
                'folder': parts[0] if parts else '',
                'themes': fm.get('themes', []), 'micro': fm.get('micro_themes', []),
                'status': (fm.get('status') or ['Idea'])[0],
                'location': fm.get('location', []), 'collection': fm.get('collection', []),
                'refs': links[:4], 'other': other[:2], 'text': txt[:420],
                'tagged': bool(fm.get('themes')),
            })
    ideas.sort(key=lambda x: x['name'].lower())
    blob = json.dumps(ideas, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    out = os.path.join(HERE, 'data', 'ideas-%s.js' % author)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w').write('(window.__IDEAS = window.__IDEAS || []).push.apply(window.__IDEAS, ' + blob + ');\n')
    print('%d ideas (%d with an Instagram link) -> %s' % (len(ideas), sum(bool(i['refs']) for i in ideas), out))
    if a.push:
        rel = os.path.relpath(out, HERE)
        subprocess.run(['git', 'add', rel], cwd=HERE, check=True)
        if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=HERE).returncode == 0:
            print('No changes to publish.')
            return
        subprocess.run(['git', 'commit', '-m', 'Update %s ideas' % author], cwd=HERE, check=True)
        subprocess.run(['git', 'pull', '--rebase', '--quiet'], cwd=HERE)
        # use the GitHub CLI login when there is one (the Mac keychain may hold a different account)
        helper = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'] if shutil.which('gh') else []
        subprocess.run(['git'] + helper + ['push'], cwd=HERE, check=True)
        print('Published. The site updates in about a minute.')

if __name__ == '__main__':
    main()
