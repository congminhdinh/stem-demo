# prop_banner: the finish banner (N18 R4.7) that hangs from the gantry over a target zone: a black and white chequered cloth 30 × 7 cm
# with a gentle sag and two grommets, no lettering. Origin: the middle of the beam it hangs from (z = 0), the cloth below it.

import math

import bmesh


def build(lib, tex, kit, col, wood):
    import numpy as np
    root = lib.empty('prop_banner', col=col)

    def chequer():
        h, w = 64, 256
        y, x = np.mgrid[0:h, 0:w]
        on = ((x // 32) + (y // 32)) % 2 == 0
        out = np.ones((h, w, 4))
        out[..., :3] = np.where(on[..., None], 0.95, 0.08)
        return out

    cloth = lib.material('banner_cloth', image=lib.image_from_array('chequer', chequer), roughness=0.75, double_sided=True)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    bm = bmesh.new()
    cols, rows = 24, 4
    grid = []
    for i in range(cols + 1):
        u = i / cols
        line = []
        for j in range(rows + 1):
            v = j / rows
            sag = 0.6 * math.sin(u * math.pi)
            line.append(bm.verts.new(lib.cm(0.0, (u - 0.5) * 30.0, -1.2 - v * 7.0 - sag * (0.4 + v * 0.6))))
        grid.append(line)
    uv_faces = []
    for i in range(cols):
        for j in range(rows):
            face = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            uv_faces.append((face, i, j))
    layer = bm.loops.layers.uv.new('UVMap')
    for face, i, j in uv_faces:
        for loop, (di, dj) in zip(face.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
            loop[layer].uv = ((i + di) / cols, 1 - (j + dj) / rows)
    banner = lib.mesh_from_bmesh('banner', bm, cloth, col, root)
    rings = [lib.lathe('grommet', [(0.25, -0.05), (0.45, -0.05), (0.45, 0.05), (0.25, 0.05), (0.25, -0.05)], at=(0, side * 13.5, -1.6), axis='X', material=steel, segments=16, col=col, parent=root) for side in (-1, 1)]
    hooks = [lib.cylinder('hook', 0.08, 1.4, at=(0, side * 13.5, -0.7), material=steel, segments=8, col=col, parent=root) for side in (-1, 1)]
    lib.join(rings + hooks, 'banner_hooks')
    return root
