# part_wheel: a drive wheel (N18 R4.7), for the kit's wheelRadiusCm and wheelWidthCm (3.3 and 2.6 for the reference kit): a black
# rubber tyre (a lathe of its rounded section) with chunky tread blocks, two rows offset by half a pitch, each row one curved block
# (a partial spin) repeated round the wheel by an array; a white rim (a lathe barrel and a spoked face cut by an arrayed window and a
# boolean), the hub boss, an orange hub cap and its screw. Origin: the axle's centre; the axle is y, the outer face +y (a left wheel;
# the view mirrors it for the right one). Everything that turns is under `wheel_spin`. The tread tops are exactly the radius.

import math

LUGS = 18


def radial_array(lib, obj, count, axis='Y'):
    """Repeats `obj` `count` times round the origin about `axis` (an array with a turned offset empty), applied."""
    import bpy
    pivot = bpy.data.objects.new(obj.name + '_pivot', None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.rotation_euler = {'X': (2 * math.pi / count, 0, 0), 'Y': (0, 2 * math.pi / count, 0), 'Z': (0, 0, 2 * math.pi / count)}[axis]
    pivot.location = obj.location
    mod = obj.modifiers.new('Radial', 'ARRAY')
    mod.count = count
    mod.use_relative_offset = False
    mod.use_object_offset = True
    mod.offset_object = pivot
    lib.apply_modifiers(obj)
    bpy.data.objects.remove(pivot)
    return obj


def build(lib, tex, kit, col):
    R, W = kit['wheel']['R'], kit['wheel']['W']
    root = lib.empty('part_wheel', col=col)
    spin = lib.empty('wheel_spin', parent=root, col=col)
    rubber = lib.material('rubber', '#1b1c1f', roughness=0.84)
    rim = lib.material('rim_white', '#f2f3f5', roughness=0.32)
    cap = lib.material('anodised_orange', '#f26419', metallic=0.65, roughness=0.34)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)

    depth = 0.26
    inner = R * 0.72
    sh = 0.42
    half = W / 2
    # The carcass: bead, sidewall, shoulder, tread base; (radius, along the axle).
    arc = [(R - depth - sh + math.sin(a) * sh, -half + sh - math.cos(a) * sh) for a in [i * math.pi / 12 for i in range(1, 6)]]
    profile = [(inner, -half * 0.86), (inner + 0.3, -half), (R - depth - sh, -half)] + arc + [(R - depth, -half + sh), (R - depth, half - sh)]
    profile += [(r, -z) for r, z in reversed(arc)] + [(R - depth - sh, half), (inner + 0.3, half), (inner, half * 0.86)]
    carcass = lib.lathe('tyre_carcass', profile, axis='Y', material=rubber, segments=56, col=col, parent=spin)

    # One tread block per row: a partial spin of its section (so its top is round, exactly R), bevelled, then arrayed round.
    pitch = 2 * math.pi / LUGS
    blocks = []
    for side, phase in ((-1, 0.0), (1, 0.5)):
        z0, z1 = (-half + 0.12, -0.16) if side < 0 else (0.16, half - 0.12)
        section = [(R - depth - 0.02, z0), (R, z0 + 0.06 * (1 if side < 0 else 0)), (R, z1 - 0.06 * (0 if side < 0 else 1)), (R - depth - 0.02, z1)]
        block = lib.lathe(f'tread_{side}', section + [section[0]], axis='Y', material=rubber, segments=3, col=col, parent=spin, angle=pitch * 0.58)
        block.rotation_euler = (0, pitch * phase, 0)
        lib.add_bevel(block, 0.05, 1, angle=30)
        lib.apply_modifiers(block)
        radial_array(lib, block, LUGS)
        blocks.append(block)
    lib.join([carcass] + blocks, 'tyre')

    # The rim: barrel, the spoked outer face, the hub boss.
    barrel = lib.lathe('rim_barrel', [(inner - 0.18, -half * 0.8), (inner + 0.02, -half * 0.84), (inner + 0.02, half * 0.84), (inner - 0.18, half * 0.8)], axis='Y', material=rim, segments=64, col=col, parent=spin)
    face = lib.cylinder('rim_face', inner - 0.1, 0.32, at=(0, half * 0.42, 0), axis='Y', material=rim, segments=64, col=col, parent=spin)
    window = lib.polygon_prism('rim_window', [(math.cos(a) * r, math.sin(a) * r) for r, a in
                                             [(0.95, -0.42), (inner - 0.42, -0.36), (inner - 0.42, 0.36), (0.95, 0.42)]], 2.0, at=(0, 0, -1.0), col=col)
    window.rotation_euler = (math.pi / 2, 0, 0)
    window.location = lib.cm(0, half * 0.42 + 1.0, 0)
    lib.apply_modifiers(window)
    import bpy
    bpy.context.view_layer.update()
    window.data.transform(window.matrix_basis)
    window.matrix_basis.identity()
    radial_array(lib, window, 5)
    lib.boolean(face, window)
    lib.add_bevel(face, 0.05, 2, angle=30)
    hub = lib.cylinder('rim_hub', 0.7, W * 0.72, axis='Y', material=rim, segments=32, col=col, parent=spin, bevel=0.06)
    lib.join([barrel, face, hub], 'rim')
    hub_cap = lib.lathe('hub_cap', [(0.0, 0.0), (0.62, 0.0), (0.62, 0.08), (0.52, 0.22), (0.0, 0.26)], at=(0, half * 0.62, 0), axis='Y', material=cap, segments=40, col=col, parent=spin)
    hub_cap.rotation_euler = (0, 0, 0)
    screw = lib.lathe('hub_screw', [(0.0, 0.0), (0.2, 0.0), (0.2, 0.05), (0.12, 0.11), (0.0, 0.12)], at=(0, half * 0.62 + 0.25, 0), axis='Y', material=steel, segments=20, col=col, parent=spin)
    lib.join([hub_cap, screw], 'hub_cap')
    return root
