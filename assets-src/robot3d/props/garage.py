# prop_garage_roof and prop_sign_p: the garage's dressing (N18 R4.7). The roof is a carport's: a clear corrugated polycarbonate sheet
# on a light aluminium frame that rests on top of the garage's two walls (58 cm long, 28 cm apart in the reference scenario; the view
# scales it to the walls). Nothing of it stands on the mat: the robot drives under it as the physics lets it. The sign is a blue square
# with a white P (drawn as a stem and a bowl, not a font) on a short post that stands on a wall's end.

import math

import bmesh


def build_roof(lib, tex, kit, col, wood):
    root = lib.empty('prop_garage_roof', col=col)
    alu = lib.material('aluminium', '#c9ced6', metallic=1.0, roughness=0.32)
    clear = lib.material('polycarbonate', '#d8eef7', roughness=0.08, alpha=0.32, double_sided=True)
    L, D = 62.0, 30.0
    frame = []
    for side in (-1, 1):
        frame.append(lib.box('rail', (L, 1.0, 0.8), at=(0, side * 14.0, 0.4), material=alu, bevel=0.1, col=col, parent=root))
    for x in (-L / 2 + 1, -L / 6, L / 6, L / 2 - 1):
        frame.append(lib.box('purlin', (0.8, D, 0.6), at=(x, 0, 1.4), material=alu, bevel=0.1, col=col, parent=root))
        for side in (-1, 1):
            frame.append(lib.box('bracket', (0.6, 0.6, 1.2), at=(x, side * 14.0, 0.9), material=alu, col=col, parent=root))
    lib.join(frame, 'roof_frame')
    bm = bmesh.new()
    nx, ny = 4, 96
    grid = [[bm.verts.new(lib.cm(-L / 2 - 1 + (L + 2) * i / nx, -D / 2 - 1 + (D + 2) * j / ny, 1.9 + 0.35 * math.sin(j / ny * math.pi * 2 * 12))) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    sheet = lib.mesh_from_bmesh('roof_sheet', bm, clear, col, root)
    lib.smooth_by_angle(sheet, 80)
    return root


def build_sign(lib, tex, kit, col, wood):
    root = lib.empty('prop_sign_p', col=col)
    blue = lib.material('sign_blue', '#1f5fd6', roughness=0.32)
    white = lib.material('sign_white', '#f7f8fa', roughness=0.35)
    alu = lib.material('aluminium', '#c9ced6', metallic=1.0, roughness=0.32)
    post = lib.cylinder('sign_post', 0.35, 12.0, at=(0, 0, 6.0), material=alu, segments=14, col=col, parent=root)
    clamp = lib.box('sign_clamp', (3.0, 2.6, 0.8), at=(0, 0, 0.4), material=alu, bevel=0.15, col=col, parent=root)
    plate = lib.box('sign_plate', (0.3, 6.0, 6.0), at=(0.4, 0, 15.0), material=blue, bevel=0.5, segments=3, col=col, parent=root)
    stem = lib.box('p_stem', (0.08, 0.9, 4.0), at=(0.58, -1.05, 15.0), material=white, col=col, parent=root)
    bowl = lib.lathe('p_bowl', [(0.62, -0.04), (1.32, -0.04), (1.32, 0.04), (0.62, 0.04)], material=white, segments=24, col=col, parent=root, angle=math.pi)
    bowl.rotation_euler = (0, math.pi / 2, 0)
    bowl.location = lib.cm(0.58, -0.6, 16.0)
    bowl.rotation_euler = (math.pi / 2 + 0.0, 0, 0)
    bowl.rotation_mode = 'XYZ'
    bowl.rotation_euler = (0, math.pi / 2, math.pi / 2)
    top = lib.box('p_top', (0.08, 0.5, 0.7), at=(0.58, -0.6, 16.0 + 0.97), material=white, col=col, parent=root)
    bottom = lib.box('p_mid', (0.08, 0.5, 0.7), at=(0.58, -0.6, 16.0 - 0.97), material=white, col=col, parent=root)
    lib.join([post, clamp, plate, stem, bowl, top, bottom], 'sign')
    return root
