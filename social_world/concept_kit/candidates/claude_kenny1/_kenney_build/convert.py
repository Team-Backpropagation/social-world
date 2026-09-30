# Kenney OBJ(+MTL, colormap) → 삼각형 위치(int16 양자화) + 정점색(uint8) → base64 JSON
import os, sys, json, base64, re
import numpy as np
from PIL import Image
KA = os.path.expanduser('~/mnt/SSTeamProject/social_world/kenney_asset')
SEL = {
 'kenney_city-kit-suburban_20': ['building-type-a', 'building-type-g', 'building-type-r', 'tree-large', 'tree-small', 'planter'],
 'kenney_furniture-kit': ['bedSingle', 'desk', 'chairDesk', 'bookcaseOpen', 'lampRoundTable', 'pottedPlant', 'rugRound', 'sideTable', 'laptop', 'books', 'plantSmall2'],
 'kenney_cube-pets_1.0': ['animal-cat', 'animal-bunny', 'animal-chick', 'animal-dog'],
 'kenney_food-kit': ['cup-coffee', 'cupcake', 'croissant', 'cabbage', 'pumpkin', 'watermelon'],
 'kenney_holiday-kit': ['bench', 'lantern', 'rocks-large', 'rocks-medium', 'rocks-small'],
}
tex_cache = {}
def load_tex(path):
    if path not in tex_cache:
        tex_cache[path] = np.asarray(Image.open(path).convert('RGB'))
    return tex_cache[path]
def parse_mtl(path, objdir, kitdir):
    mats, cur = {}, None
    for line in open(path, encoding='utf-8', errors='ignore'):
        t = line.strip().split()
        if not t: continue
        if t[0] == 'newmtl': cur = t[1]; mats[cur] = {'kd': (1, 1, 1), 'map': None}
        elif t[0] == 'Kd' and cur: mats[cur]['kd'] = tuple(float(x) for x in t[1:4])
        elif t[0] == 'map_Kd' and cur:
            rel = ' '.join(t[1:]); cands = [os.path.join(objdir, rel), os.path.join(kitdir, 'Models', 'Textures', os.path.basename(rel)), os.path.join(objdir, 'Textures', os.path.basename(rel))]
            mats[cur]['map'] = next((c for c in cands if os.path.exists(c)), None)
    return mats
def convert(kit, name):
    kitdir = os.path.join(KA, kit); objdir = os.path.join(kitdir, 'Models', 'OBJ format')
    objp = os.path.join(objdir, name + '.obj')
    V, VT, mats, cur = [], [], {}, None
    pos, col = [], []
    for line in open(objp, encoding='utf-8', errors='ignore'):
        t = line.strip().split()
        if not t: continue
        if t[0] == 'mtllib': mats = parse_mtl(os.path.join(objdir, ' '.join(t[1:])), objdir, kitdir)
        elif t[0] == 'v': V.append([float(x) for x in t[1:4]])
        elif t[0] == 'vt': VT.append([float(x) for x in t[1:3]])
        elif t[0] == 'usemtl': cur = mats.get(t[1], {'kd': (1, 1, 1), 'map': None})
        elif t[0] == 'f':
            idx = []
            for f in t[1:]:
                p = f.split('/'); vi = int(p[0]); ti = int(p[1]) if len(p) > 1 and p[1] else None
                idx.append((vi - 1 if vi > 0 else len(V) + vi, (ti - 1 if ti > 0 else len(VT) + ti) if ti else None))
            m = cur or {'kd': (1, 1, 1), 'map': None}
            for k in range(1, len(idx) - 1):
                tri = [idx[0], idx[k], idx[k + 1]]
                c = np.array(m['kd'])
                if m['map'] and all(x[1] is not None for x in tri):
                    tx = load_tex(m['map']); h, w, _ = tx.shape
                    uv = np.mean([VT[x[1]] for x in tri], axis=0) % 1.0
                    c = c * tx[min(h - 1, int((1 - uv[1]) * h)), min(w - 1, int(uv[0] * w))] / 255.0
                for x in tri: pos.append(V[x[0]]); col.append(c)
    P = np.array(pos, dtype=np.float64); C = np.clip(np.array(col) * 255 + 0.5, 0, 255).astype(np.uint8)
    mn, mx = P.min(0), P.max(0); ext = float((mx - mn).max()) or 1.0
    Q = np.round((P - mn) / ext * 32767).astype(np.int16)
    return {'n': len(P), 'min': [round(float(v), 5) for v in mn], 'ext': round(ext, 5), 'size': [round(float(v), 4) for v in (mx - mn)],
            'p': base64.b64encode(Q.tobytes()).decode(), 'c': base64.b64encode(C.tobytes()).decode()}
out = {}
for kit, names in SEL.items():
    for n in names:
        try: out[n] = convert(kit, n); print(n, out[n]['n'] // 3, 'tris', out[n]['size'])
        except Exception as e: print('FAIL', n, e)
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'kenney_models.json'), 'w'))
print('bytes', os.path.getsize(os.path.join(os.path.dirname(__file__), 'kenney_models.json')))
