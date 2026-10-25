"""Erzeugt die Farb-Variablen für Hell und Dunkel in src/index.css.

Paletten als Hex-Listen (Stufen 50 … 950). Aufruf: python scripts/theme_vars.py
Schreibt zwischen die Marker @@VARS-BEGIN@@ / @@VARS-END@@ in index.css.
"""
steps=[50,100,200,300,400,500,600,700,800,900,950]
def rgb(h):
    h=h.lstrip('#'); return f"{int(h[0:2],16):>3} {int(h[2:4],16):>3} {int(h[4:6],16):>3}"
light = {
 # Flächen: 950 Seite · 900 Mulde/Kopfzeile · 800 Block · 700 Linie · 600 kräftige Linie
 #          500 Beschriftung · 400 still · 300 Text2 · 200/100 Text · 50 tiefstes Schwarz
 's':     ['#111417','#1d2125','#2b3238','#3b434b','#5e6872','#6f7882','#b9bfc5','#d5d9dd','#ffffff','#f6f7f8','#f2f3f4'],
 # Status/Akzent hell: 950–700 helle Tönung (Hintergründe, Rahmen), 600 Vollton (Knopf
 # mit weißer Schrift), 500 Hover dunkler, 400–50 Schrift auf heller Fläche.
 'akzent':['#10283d','#163652','#1b4064','#23507a','#2a5b88','#1b4064','#23507a','#a9c2da','#c9d8e6','#e6eef5','#f0f5f9'],
 'rot':   ['#4f120d','#6e1912','#8a1f16','#a6261b','#b4362b','#8e2017','#a6261b','#e6a69f','#f2c9c4','#fbe9e7','#fdf3f2'],
 'gruen': ['#15331b','#1e4626','#265830','#2f6b3a','#367a43','#285c32','#2f6b3a','#a3cca9','#c6e0ca','#e7f2e8','#f1f8f2'],
 'gelb':  ['#3d2a00','#523800','#664500','#7a5300','#8a5f00','#694700','#7a5300','#e8c97a','#f3dea6','#fcf1d4','#fdf8ea'],
 'lila':  ['#2a1846','#3a2260','#4a2c7a','#5a3690','#6a44a3','#4f3086','#5a3690','#c4b2e2','#ddd1f0','#efe9f8','#f6f3fb'],
}
# Schrift (text-surface-*): wie 's', nur 600/700 lesbar — siehe tailwind.config.js.
light['t'] = light['s'][:6] + ['#858e97', '#9aa2a9'] + light['s'][8:]
dark_t_mid = ['#6f7a85', '#5f6a74']
dark = {
 's':     ['#f3f5f7','#e2e6ea','#d2d8de','#c9d0d6','#9aa5b0','#87929d','#4a545e','#3a434c','#1d2228','#181d22','#14181c'],
 'akzent':['#eef5fc','#dbe9f7','#b9d4ee','#9cc3ea','#82b4e6','#4f8fcf','#2f6aa3','#275a8a','#22446a','#1d3550','#172636'],
 'rot':   ['#fff1f0','#ffe0dd','#ffc1bb','#ffa59d','#ff8f85','#e5675d','#b8433a','#9a362f','#6e2a25','#4a2420','#2f1a18'],
 'gruen': ['#eefaf0','#d8f1dc','#b6e3bf','#a2dbaf','#8fd19e','#5fae72','#3f8a51','#337144','#2a5536','#1f3a27','#16281c'],
 'gelb':  ['#fdf7e8','#faecc8','#f6dc9a','#f3d083','#f0c46b','#d9a441','#a87a1f','#8a641a','#614716','#3f3118','#2a2112'],
 'lila':  ['#f4effc','#e6dcf8','#d0bff0','#bba3e8','#a78bdf','#8a6bc8','#6b4fa6','#58418a','#3f3164','#2c2446','#1f1a31'],
}
dark['t'] = dark['s'][:6] + dark_t_mid + dark['s'][8:]

def block(sel, pal, extra=''):
    out=[f"{sel} {{"]
    for name, vals in pal.items():
        out.append("  " + "  ".join(f"--{name}-{s}: {rgb(v)};" for s,v in zip(steps,vals[:6])))
        out.append("  " + "  ".join(f"--{name}-{s}: {rgb(v)};" for s,v in zip(steps[6:],vals[6:])))
    if extra: out.append(extra)
    out.append("}")
    return "\n".join(out)

if __name__ == '__main__':
    import pathlib, re
    css = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'index.css'
    gen = (block(':root,\n[data-theme="light"]', light, '  color-scheme: light;') + '\n\n'
           + block('[data-theme="dark"]', dark, '  color-scheme: dark;'))
    text = css.read_text(encoding='utf-8')
    new = re.sub(r'/\* @@VARS-BEGIN@@ \*/.*?/\* @@VARS-END@@ \*/',
                 lambda m: '/* @@VARS-BEGIN@@ */\n' + gen + '\n/* @@VARS-END@@ */', text, flags=re.S)
    if new == text and '@@VARS-BEGIN@@' not in text:
        raise SystemExit('Marker @@VARS-BEGIN@@ fehlt in index.css')
    css.write_text(new, encoding='utf-8')
    print('index.css aktualisiert')
