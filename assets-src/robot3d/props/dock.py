# prop_dock: a loading dock's face (N18 R4.7), dressing for the wall behind a dock zone: a yellow and black hazard-striped board 40 cm
# long and two black rubber bumpers, at most 1.5 mm proud of the wall (fix round 1: the board's back sunk into the wall's face, so
# nothing of it stands where the robot drives before it meets the wall). Origin: the middle of its base, on the wall's face, facing +x.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_dock', col=col)
    hazard = lib.material('hazard', image=lib.image_from_array('hazard', lambda: tex.stripes(512, 64, '#ffc414', '#1d1f23', 10, slant=0.9)), roughness=0.45)
    rubber = lib.material('rubber', '#1b1c1f', roughness=0.84)
    board = lib.box('hazard_board', (0.15, 40.0, 4.0), at=(-0.05, 0, 6.0), material=hazard, bevel=0.04, col=col, parent=root)
    me = board.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            uv.data[li].uv = ((co.y + 20) / 40, (co.z + 2) / 4)
    bumpers = [lib.box('bumper', (0.3, 4.0, 3.2), at=(0.0, side * 12.0, 2.4), material=rubber, bevel=0.12, col=col, parent=root) for side in (-1, 1)]
    lib.join([board] + bumpers, 'dock')
    return root
