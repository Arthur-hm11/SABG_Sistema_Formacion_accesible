import re
from pathlib import Path

INDEX = Path("index.html")
REF   = Path("SABG_Sistema_Formacion_accesible.html")

idx = INDEX.read_text(encoding="utf-8", errors="ignore")
ref = REF.read_text(encoding="utf-8", errors="ignore")

def extract_region(html: str):
    m_start = re.search(r'<!--\s*TAB:\s*INSTRUCTIVO\s*-->\s*<div\s+id="instructivo"\s+class="tab-content[^"]*">', html, flags=re.I)
    if not m_start:
        raise SystemExit("No encontré: <!-- TAB: INSTRUCTIVO --> + <div id=\"instructivo\" ...>")
    m_end = re.search(r'<!--\s*TAB:\s*FORMULARIO\s*-->', html[m_start.end(0):], flags=re.I)
    if not m_end:
        raise SystemExit("No encontré: <!-- TAB: FORMULARIO -->")
    start = m_start.start(0)
    end = m_start.end(0) + m_end.start(0)
    return start, end, html[start:end]

s_i, e_i, _ = extract_region(idx)
s_r, e_r, block_ref = extract_region(ref)

new_idx = idx[:s_i] + block_ref + idx[e_i:]

if "INSTRUCTIVO" not in new_idx:
    raise SystemExit("Falló validación: no quedó el instructivo en el index resultante.")

INDEX.write_text(new_idx, encoding="utf-8")
print("OK: Instructivo+Ejemplo reemplazados en index.html usando el archivo referencia.")
