# Builds the pick-and-place props (N19 E7, props/pick_place.py) into the collection 'props', each on a grid spot of its own so that they do
# not shade each other while their ambient occlusion is baked, the floor under each (as build_props.py does for N18's). Called by build.py
# (`n19`); scripts/build-robot-assets.mjs appends them to arena-props.glb.

import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name):
    spec = importlib.util.spec_from_file_location('prop_' + name, os.path.join(HERE, name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_all(lib, tex, kit):
    col = lib.collection('props')
    wood = _load('wood')
    props = _load('pick_place')
    roots = []
    for i, fn in enumerate(('build_cube', 'build_parcel', 'build_base', 'build_shelf')):
        root = getattr(props, fn)(lib, tex, kit, col, wood)
        root.location = lib.cm(i * 150.0, 0, 0)
        roots.append(root)
    import bpy
    bpy.context.view_layer.update()
    lib.bake_ao([o for r in roots for o in r.children_recursive if o.type == 'MESH'], distance_cm=4.0, samples=32, floor=0.55, ground=True)
    return roots
