import pathlib
replacements = {
    'faÃ§ade': 'façade',
    'FaÃ§ade': 'Façade',
    'â€”': '—',
    'â€“': '–',
    'Ã©': 'é',
}
files = list(pathlib.Path('.').glob('*.js')) + list(pathlib.Path('src').rglob('*.js'))
fixed=0
for p in files:
    if 'node_modules' in str(p) or 'dist' in str(p):
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
for f in ['app.js','agent-panel.js']:
    t=pathlib.Path(f).read_text(encoding='utf-8', errors='ignore')
    print(f, t.count('pixelbay CAD V'))
