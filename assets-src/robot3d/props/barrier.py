# prop_barrier: the gate (N18 R4.7), a road barricade that fills the scenario's gate box (6 × 60 × 12 cm, along y): two A-frame legs at
# its ends, two planks with red and white diagonal stripes, and an amber lamp on top. Origin: the middle of its base. The view scales
# it to the box.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_barrier', col=col)
    stripes = lib.material('barrier_stripes', image=lib.image_from_array('barrier_stripes', lambda: tex.stripes(512, 32, '#d9262c', '#f6f6f4', 8, slant=0.6)), roughness=0.3)
    frame = lib.material('barrier_frame', '#f4f4f2', roughness=0.45)
    lamp = lib.material('barrier_lamp', '#ffb21f', roughness=0.2, emission='#ffb21f', emission_strength=1.5)
    black = lib.material('abs_black', '#1d1f23', roughness=0.42)
    parts = []
    for z in (5.4, 9.4):
        plank = lib.box('plank', (0.8, 56, 3.0), at=(0, 0, z), material=stripes, bevel=0.15, col=col, parent=root)
        me = plank.data
        uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co / lib.CM
                uv.data[li].uv = ((co.y + 28) / 56, (co.z + 1.5) / 3.0)
        parts.append(plank)
    for side in (-1, 1):
        y = side * 27.5
        for lean in (-1, 1):
            leg = lib.box('leg', (0.8, 1.6, 12.4), at=(lean * 1.15, y, 6.0), material=frame, bevel=0.2, col=col, parent=root)
            leg.rotation_euler = (0, lean * 0.22, 0)
            parts.append(leg)
        parts.append(lib.box('foot', (6.0, 2.0, 0.6), at=(0, y, 0.3), material=black, bevel=0.2, col=col, parent=root))
    parts.append(lib.cylinder('lamp_base', 0.8, 0.5, at=(0, -26.5, 11.15), material=black, segments=16, col=col, parent=root))
    parts.append(lib.sphere('lamp', 0.75, at=(0, -26.5, 11.6), material=lamp, segments=20, rings=10, col=col, parent=root))
    lib.join(parts, 'barrier')
    return root
