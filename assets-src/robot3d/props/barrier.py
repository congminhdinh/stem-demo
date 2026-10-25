# prop_barrier: the gate (N18 R4.7), a solid road barrier that fills the scenario's gate box (6 × 60 × 12 cm, along y): a moulded
# plastic block, red and white in diagonal stripes on both faces, a white top with a groove, two reflectors on each face and black
# rubber feet tucked under it. Solid as its collider is (fix round 1: the barricade of planks before had gaps where the body has none).
# Origin: the middle of its base. The view scales it to the box.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_barrier', col=col)
    stripes = lib.material('barrier_stripes', image=lib.image_from_array('barrier_stripes', lambda: tex.stripes(1024, 128, '#d9262c', '#f6f6f4', 10, slant=0.6)), roughness=0.38)
    white = lib.material('barrier_white', '#f4f4f2', roughness=0.42)
    black = lib.material('rubber', '#1b1c1f', roughness=0.84)
    amber = lib.material('reflector_amber', '#ffb21f', roughness=0.15, emission='#ffb21f', emission_strength=0.6)
    body = lib.box('barrier_body', (6.0, 60.0, 10.7), at=(0, 0, 0.5 + 5.35), material=stripes, bevel=0.4, segments=2, col=col, parent=root)
    body.data.materials.append(white)
    lib.apply_modifiers(body)
    me = body.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        poly.material_index = 1 if poly.normal.z > 0.5 or abs(poly.normal.y) > 0.5 else 0
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            uv.data[li].uv = ((co.y + 30) / 60, (co.z - 0.5) / 10.7)
    cap = lib.box('barrier_cap', (6.0, 59.0, 0.8), at=(0, 0, 11.6), material=white, bevel=0.3, segments=2, col=col, parent=root)
    groove = lib.box('barrier_groove', (1.2, 54.0, 0.1), at=(0, 0, 11.98), material=black, col=col, parent=root)
    parts = [body, cap, groove]
    for y in (-18.0, 18.0):
        for x in (-3.0, 3.0):
            parts.append(lib.box('reflector', (0.06, 2.4, 1.2), at=(x * 0.995, y, 9.2), material=amber, bevel=0.03, col=col, parent=root))
    for y in (-24.0, 0.0, 24.0):
        parts.append(lib.box('barrier_foot', (5.6, 6.0, 0.5), at=(0, y, 0.25), material=black, bevel=0.15, col=col, parent=root))
    lib.join(parts, 'barrier')
    return root
