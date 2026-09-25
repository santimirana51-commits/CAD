import pathlib
replacements = {
    'â€¦': '…',
    'â€”': '—',
    'â€“': '–',
    'Ã©': 'é',
    'Openâ€¦': 'Open…',
}
files = list(pathlib.Path('.').glob('*.js')) + list(pathlib.Path('src').rglob('*.js')) + [pathlib.Path('app.css')]
fixed=0
for p in files:
    if 'node_modules' in str(p) or 'dist' in str(p) or 'archive' in str(p):
        continue
    try:
        t=p.read_text(encoding='utf-8')
    except:
        t=p.read_text(encoding='utf-8', errors='ignore')
    orig=t
    for k,v in replacements.items():
        t=t.replace(k,v)
    if t!=orig:
        p.write_text(t, encoding='utf-8')
        print(f'fixed {p}')
        fixed+=1
print(f'done {fixed}')
# also check raw app.js line
import pathlib as pl
t=pl.Path('app.js').read_text(encoding='utf-8', errors='ignore')
for line in t.splitlines():
    if 'Open' in line and '…' in line:
        print(repr(line[:200]))
        break
