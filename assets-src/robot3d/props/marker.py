# prop_marker: a traffic marker block (N18 R4.7 fix round 1), the scenario's small obstacle box (8 × 8 × 12 cm): an orange foam block with
# two white reflective bands and a darker scuffed foot, its edges eased. A box, as its collider is: the robot touches it where it shows
# (a cone stood in before, narrower than the box at the sensors' height). Origin: the middle of its base; the view scales it to the box.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_marker', col=col)
    paint = lib.material('marker_bands', image=lib.image_from_array('marker_bands', lambda: tex.bands(8, 192, ['#ff6a14', '#f5f6f7', '#ff6a14', '#f5f6f7', '#ff6a14', '#d4500e'], [3.0, 1.2, 2.2, 1.2, 3.8, 0.6])), roughness=0.5)
    body = lib.box('marker_body', (8, 8, 12), at=(0, 0, 6), material=paint, bevel=0.35, segments=2, col=col, parent=root)
    lib.apply_modifiers(body)
    me = body.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            # The bands go round the block by height; the top is the cap's orange.
            uv.data[li].uv = ((co.x + co.y + 8) / 16, min(0.995, max(0.005, co.z / 12)))
    return root
