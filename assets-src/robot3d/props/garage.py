# prop_garage_roof and prop_sign_p: the garage's dressing (N18 R4.7). The roof is a carport's: a clear corrugated polycarbonate sheet
# on a light aluminium frame that rests on top of the garage's two walls (58 cm long, 28 cm apart in the reference scenario; the view
# scales it to the walls). Nothing of it stands on the mat: the robot drives under it as the physics lets it. The sign is a blue square
# with a white P (drawn into its face's image as a stem and a bowl, not a font; fix round 1: the modelled bowl read as an I) on a short
# post that stands on a wall's end.

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
    face = lib.material('sign_face', image=lib.image_from_array('sign_p', lambda: tex.parking_sign(128, '#f7f8fa', '#1f5fd6', '#f7f8fa')), roughness=0.32)
    alu = lib.material('aluminium', '#c9ced6', metallic=1.0, roughness=0.32)
    post = lib.cylinder('sign_post', 0.35, 12.0, at=(0, 0, 6.0), material=alu, segments=14, col=col, parent=root)
    clamp = lib.box('sign_clamp', (3.0, 2.6, 0.8), at=(0, 0, 0.4), material=alu, bevel=0.15, col=col, parent=root)
    plate = lib.box('sign_plate', (0.3, 6.0, 6.0), at=(0.4, 0, 15.0), material=face, bevel=0.3, segments=2, col=col, parent=root)
    lib.apply_modifiers(plate)
    # The P on the face towards +x (u along +y, the viewer's right), the plate's back and edges plain blue (a corner of the image).
    me = plate.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        front = poly.normal.x > 0.5
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            uv.data[li].uv = ((co.y + 3.0) / 6.0, (co.z - 12.0) / 6.0) if front else (0.02, 0.5)
    lib.join([post, clamp, plate], 'sign')
    return root
