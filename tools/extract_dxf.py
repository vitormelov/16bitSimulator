"""
Gera js/maps/<setor>.js a partir da planta em DXF (medidas reais, em metros).

Uso:
    pip install ezdxf opencv-python-headless numpy
    python tools/extract_dxf.py azul
    python tools/extract_dxf.py laranja

Cada setor é configurado em SECTORS (arquivo DXF, cor e entradas).

Pipeline:
  1. Rasteriza o desenho numa grade de RES metros por tile (padrão 10 cm).
     Linhas das camadas de alvenaria/estrutura viram "parede"; as demais
     linhas (portas, escadas, equipamentos) viram "linha fina". Ambas bloqueiam.
  2. Separa as regiões livres (componentes conexos):
       - a que contém o rótulo de um corredor  -> piso andável
       - as que contêm um número de box         -> boxes (número real do CAD)
       - as que tocam a borda                   -> área externa
       - o resto                                -> salas / áreas técnicas
  3. Cada box recebe o corredor que o atende (corredor mais próximo pelo piso).
  4. Exporta tiles, boxes, rótulos e entradas como JS.
"""
import sys, re, json
from collections import Counter, deque
import numpy as np
import cv2
import ezdxf

RES = 0.10  # metros por tile

# --- Configuração dos setores ------------------------------------------------------
# Entradas em coordenadas do CAD (metros); w = chance relativa de alguém chegar por ali.
SECTORS = {
    "azul": {
        "dxf": "setor-azul.dxf", "name": "Azul",
        "color": {"base": "#3d86e0", "hi": "#86bdf2", "lo": "#24508f"},
        "entrances": [
            {"name": "Escada rolante", "x": 95.3, "y": 69.8, "w": 3},
            {"name": "Escada rolante", "x": 95.3, "y": 73.6, "w": 3},
            {"name": "Escada 8",       "x": 68.6, "y": 56.7, "w": 1},
            {"name": "Escada 6",       "x": 103.3, "y": 54.6, "w": 1},
            {"name": "Hall",           "x": 93.0, "y": 77.3, "w": 1},
        ],
    },
    "laranja": {
        "dxf": "setor-laranja.dxf", "name": "Laranja",
        "color": {"base": "#e8872e", "hi": "#f7b56e", "lo": "#a8561a"},
        "entrances": [
            {"name": "Escada rolante", "x": 127.4, "y": 79.4, "w": 3},
            {"name": "Escada rolante", "x": 127.4, "y": 75.9, "w": 3},
            {"name": "Hall",           "x": 127.0, "y": 81.5, "w": 1},
            {"name": "Escada 6",       "x": 117.9, "y": 62.6, "w": 1},
            {"name": "Escada 7",       "x": 113.2, "y": 41.5, "w": 1},
        ],
    },
    "vermelho": {
        "dxf": "setor-vermelho.dxf", "name": "Vermelho",
        "color": {"base": "#d9453b", "hi": "#f08a7e", "lo": "#8f2620"},
        "entrances": [
            {"name": "Escada rolante", "x": 101.8, "y": 69.7, "w": 3},
            {"name": "Escada rolante", "x": 101.8, "y": 67.1, "w": 2},
            {"name": "Hall",           "x": 101.0, "y": 74.0, "w": 1},
            {"name": "Escada 6",       "x": 92.5,  "y": 53.3, "w": 1},
            {"name": "Escada 7",       "x": 87.0,  "y": 31.0, "w": 1},
        ],
    },
}
SECTOR = sys.argv[1] if len(sys.argv) > 1 else "azul"
CFG = SECTORS[SECTOR]
DXF = CFG["dxf"]
OUT = f"js/maps/{SECTOR}.js"
ENTRANCES = CFG["entrances"]

BOX_TEXT_LAYER = "ARQ-AN-TEX-1"       # números dos boxes
ROOM_TEXT_LAYER = "ARQ-AN-ambiente"   # nomes de ambientes (corredores, hall, escadas)
WALL_LAYERS = ("ARQ-OB-ALV", "ARQ-OB-EST", "Estrutura", "Contornos", "ARQ-OB-LIM")
IGNORE_LAYERS = ("ARQ-AN-",)          # anotações não bloqueiam passagem
MARGIN = 1.0
MAX_BOX_AREA = 150  # m²; lojas maiores (ex.: praça de alimentação) também contam
# ---------------------------------------------------------------------------------

doc = ezdxf.readfile(DXF)
msp = doc.modelspace()

# limites do desenho útil (ignora textos soltos muito longe)
xs, ys = [], []
for e in msp.query("LINE"):
    xs += [e.dxf.start.x, e.dxf.end.x]; ys += [e.dxf.start.y, e.dxf.end.y]
X0, X1 = min(xs) - MARGIN, max(xs) + MARGIN
Y0, Y1 = min(ys) - MARGIN, max(ys) + MARGIN
GW, GH = int((X1 - X0) / RES) + 1, int((Y1 - Y0) / RES) + 1


def P(x, y):
    return int(round((x - X0) / RES)), int(round((Y1 - y) / RES))


wall = np.zeros((GH, GW), np.uint8)
fine = np.zeros((GH, GW), np.uint8)


def target(layer):
    if layer.startswith(IGNORE_LAYERS):
        return None
    return wall if layer.startswith(WALL_LAYERS) else fine


def draw(e, layer_override=None):
    t = e.dxftype()
    if t in ("MTEXT", "TEXT", "DIMENSION", "ATTRIB", "ATTDEF"):
        return
    layer = e.dxf.layer if e.dxf.layer != "0" or not layer_override else layer_override
    if t == "INSERT":
        try:
            for v in e.virtual_entities():
                draw(v, layer)
        except Exception:
            pass
        return
    img = target(layer)
    if img is None:
        return
    try:
        if t == "LINE":
            cv2.line(img, P(e.dxf.start.x, e.dxf.start.y), P(e.dxf.end.x, e.dxf.end.y), 1, 1)
        elif t == "LWPOLYLINE":
            pts = [P(x, y) for x, y in e.get_points("xy")]
            cv2.polylines(img, [np.array(pts, np.int32)], bool(e.closed), 1, 1)
        elif t in ("ARC", "CIRCLE", "POLYLINE", "SPLINE", "ELLIPSE"):
            pts = [P(p[0], p[1]) for p in e.flattening(0.03)]
            if len(pts) > 1:
                cv2.polylines(img, [np.array(pts, np.int32)], False, 1, 1)
        elif t == "HATCH":
            for bp in e.paths:
                if hasattr(bp, "vertices"):
                    pts = [P(v[0], v[1]) for v in bp.vertices]
                else:
                    pts = []
                    for ed in bp.edges:
                        if ed.EDGE_TYPE == "LineEdge":
                            pts += [P(*ed.start), P(*ed.end)]
                if len(pts) > 2:
                    cv2.fillPoly(img, [np.array(pts, np.int32)], 1)
    except Exception:
        pass


for e in msp:
    draw(e)

block = (wall | fine).astype(np.uint8)
free = (1 - block).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(free, connectivity=4)


def label_near(px, py, avoid=(), r=5):
    """rótulo da região livre no ponto (ou o mais próximo, se o ponto cair numa linha)"""
    best = None
    for rr in range(r + 1):
        for dy in range(-rr, rr + 1):
            for dx in range(-rr, rr + 1):
                x, y = px + dx, py + dy
                if 0 <= x < GW and 0 <= y < GH and lab[y, x] and lab[y, x] not in avoid:
                    return lab[y, x]
    return best


# textos de ambiente -> corredores e rótulos
rooms = []
for t in msp.query(f'MTEXT[layer=="{ROOM_TEXT_LAYER}"]'):
    s = t.plain_text().strip()
    if s.startswith("A=") or not s:
        continue
    rooms.append((s, t.dxf.insert.x, t.dxf.insert.y))
corr_pts = [(s, x, y) for s, x, y in rooms if s.upper().startswith("CORREDOR")]
corr_labels = Counter()
for s, x, y in corr_pts:
    l = label_near(*P(x, y))
    if l:
        corr_labels[l] += 1
walk_label = corr_labels.most_common(1)[0][0]
walk = lab == walk_label

# boxes
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
box_of_label = {}
for t in msp.query(f'MTEXT[layer=="{BOX_TEXT_LAYER}"]'):
    s = t.plain_text().strip()
    if not re.fullmatch(r"\d{1,3}", s):
        continue
    h = t.dxf.char_height or 0.25
    # desloca do ponto de inserção (que depende do alinhamento do texto) para o centro
    ap = t.dxf.get("attachment_point", 1)
    col, row = (ap - 1) % 3, (ap - 1) // 3   # col: esq/centro/dir, row: topo/meio/base
    cx = t.dxf.insert.x + (0.6 - 0.6 * col) * h * len(s) / 2
    cy = t.dxf.insert.y + (-0.5 + 0.5 * row) * h
    l = label_near(*P(cx, cy), avoid={walk_label} | border)
    if not l:
        continue
    area = st[l, 4] * RES * RES
    if area < 1.0 or area > MAX_BOX_AREA:
        print(f"  número {s} ignorado: região de {area:.1f} m²")
        continue
    box_of_label.setdefault(l, s)

# área de cada corredor (divisão geodésica do piso entre os rótulos de corredor)
corr_id = np.full((GH, GW), -1, np.int32)
q = deque()
corr_names = []
for s, x, y in corr_pts:
    px, py = P(x, y)
    l = label_near(px, py)
    if l != walk_label:
        continue
    # encontra um pixel de piso perto do rótulo
    for rr in range(6):
        found = False
        for dy in range(-rr, rr + 1):
            for dx in range(-rr, rr + 1):
                xx, yy = px + dx, py + dy
                if walk[yy, xx] and corr_id[yy, xx] < 0:
                    corr_id[yy, xx] = len(corr_names); q.append((xx, yy)); found = True; break
            if found: break
        if found: break
    corr_names.append(s.replace("CORREDOR", "").strip())
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        xx, yy = x + dx, y + dy
        if 0 <= xx < GW and 0 <= yy < GH and walk[yy, xx] and corr_id[yy, xx] < 0:
            corr_id[yy, xx] = corr_id[y, x]; q.append((xx, yy))

# tiles: 0 externo, 1 piso, 2 parede, 3 linha fina, 4 sala/área técnica, 6 box
tiles = np.full((GH, GW), 4, np.uint8)
for l in border:
    tiles[lab == l] = 0
tiles[walk] = 1
tiles[fine == 1] = 3
tiles[wall == 1] = 2
boxgrid = np.zeros((GH, GW), np.int32)
boxes = []
for l, num in box_of_label.items():
    m = lab == l
    tiles[m] = 6
    ys_, xs_ = np.nonzero(m)
    # anel crescente em volta do box até encontrar o piso do corredor
    cids = np.array([], np.int32)
    for k in (5, 9, 13, 17, 25):
        ring = (cv2.dilate(m.astype(np.uint8), np.ones((k, k), np.uint8)) > 0) & walk
        cids = corr_id[ring]
        cids = cids[cids >= 0]
        if len(cids) > 3:
            break
    corr = corr_names[Counter(cids.tolist()).most_common(1)[0][0]] if len(cids) else "?"
    boxes.append({
        "num": num, "corr": corr, "area": round(float(m.sum()) * RES * RES, 2),
        "x": int(xs_.min()), "y": int(ys_.min()), "w": int(xs_.max() - xs_.min() + 1), "h": int(ys_.max() - ys_.min() + 1),
        "cx": round(float(xs_.mean()), 1), "cy": round(float(ys_.mean()), 1), "_mask": m,
    })
boxes.sort(key=lambda b: (b["corr"], int(b["num"])))
seen = Counter()
for i, b in enumerate(boxes):
    b["id"] = f"{b['corr']}-{b['num']}"
    seen[b["id"]] += 1
    if seen[b["id"]] > 1:
        b["id"] += "-" + str(seen[b["id"]])
    boxgrid[b.pop("_mask")] = i + 1

ents = []
for e in ENTRANCES:
    x, y = P(e["x"], e["y"])
    ents.append({"name": e["name"], "x": x, "y": y, "w": e["w"]})

labels, seenl = [], set()
for s, x, y in rooms:
    px, py = P(x, y)
    if any(l["t"] == s.upper() and abs(l["x"] - px) < 60 and abs(l["y"] - py) < 60 for l in labels):
        continue
    labels.append({"t": s.upper(), "x": px, "y": py + 2})


# objetos desenhados com arte própria: escadas rolantes e pilares (blocos do CAD)
from ezdxf import bbox as _bbox
objects = []
for e in msp.query("INSERT"):
    name = e.dxf.name.upper()
    kind = "escalator" if "ESCADA ROLANTE" in name else "pillar" if "PILAR" in name else None
    if not kind:
        continue
    b = _bbox.extents([e])
    x0, y0 = P(b.extmin.x, b.extmax.y)
    x1, y1 = P(b.extmax.x, b.extmin.y)
    objects.append({"kind": kind, "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0})


def rle(arr):
    flat = arr.ravel()
    idx = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], idx])
    lens = np.diff(np.concatenate([starts, [len(flat)]]))
    return ",".join(f"{flat[s]}:{n}" for s, n in zip(starts, lens))


data = {
    "sector": SECTOR, "name": CFG["name"], "color": CFG["color"], "res": RES, "w": GW, "h": GH,
    "tiles": rle(tiles), "boxgrid": rle(boxgrid),
    "boxes": boxes, "entrances": ents, "labels": labels, "objects": objects,
    "walkArea": round(float(walk.sum()) * RES * RES, 1),
}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Gerado por tools/extract_dxf.py — não editar à mão\n")
    f.write("(window.MALL_MAPS = window.MALL_MAPS || {})." + SECTOR + " = "
            + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")

# prévia para conferência
pal = np.array([[60, 40, 40], [205, 235, 215], [40, 30, 30], [120, 110, 110], [170, 170, 170], [0, 0, 0],
                [240, 170, 60]], np.uint8)
prev = pal[tiles]
for e in ents:
    cv2.circle(prev, (e["x"], e["y"]), 4, (0, 0, 255), -1)
cv2.imwrite(f"tools/map-preview-{SECTOR}.png", cv2.resize(prev, (GW * 2, GH * 2), interpolation=cv2.INTER_NEAREST))
print(f"grade {GW}x{GH} ({GW*RES:.1f} x {GH*RES:.1f} m), boxes={len(boxes)}, "
      f"piso={data['walkArea']} m², corredores={sorted(set(corr_names))}")
dups = [k for k, v in seen.items() if v > 1]
if dups:
    print("ids repetidos:", dups)
