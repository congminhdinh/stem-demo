# prop_tin: a tin can (N18 R4.7), radius 4 cm (its rims and label; fix round 1: the cylinder the physics builds), 10 cm tall: tinplate with rolled rims and ribs, a red and white paper label. The view
# scales it to a cylinder of the scenario.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_tin', col=col)
    tin = lib.material('tinplate', '#d6dae0', metallic=1.0, roughness=0.26)
    label = lib.material('tin_label', image=lib.image_from_array('tin_label', lambda: tex.bands(8, 128, ['#d8392f', '#f5efe4', '#d8392f', '#2b4ea2', '#d8392f'], [3, 1, 2, 1, 3])), roughness=0.38)
    can = lib.lathe('tin', [(0.0, 0.25), (3.7, 0.25), (3.85, 0.0), (4.0, 0.15), (3.97, 0.6), (3.97, 9.4), (4.0, 9.85), (3.85, 10.0), (3.7, 9.75), (0.0, 9.75)], material=tin, segments=48, col=col, parent=root)
    sleeve = lib.lathe('tin_label', [(4.0, 1.4), (4.0, 8.6)], material=label, segments=48, col=col, parent=root)
    me = sleeve.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    import math
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            uv.data[li].uv = ((math.atan2(co.y, co.x) / (2 * math.pi)) % 1, (co.z - 1.4) / 7.2)
    lib.join([can, sleeve], 'tin_can')
    return root
