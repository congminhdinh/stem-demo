# Builds the robot lab's 3D assets (N18 R4.7): run by `pnpm build:robot-assets` (scripts/build-robot-assets.mjs) as
#
#   Blender -b --factory-startup -P assets-src/robot3d/build.py -- <repo root> <out dir> [robot|props|all]
#
# It reads the reference kit (src/core/hardware/kits/ref-uno-rover.kit.json) for every size it models, runs each part script of
# parts/ and each prop script of props/, puts the parts where the reference kit mounts them, bakes ambient occlusion with every part in
# place (so the lower plate is darker under the battery, the board's headers shade the board), and exports two binary glTFs:
# robot-kit.glb (every robot part, each a root node `part_*` whose origin is its kit mount) and arena-props.glb (every prop,
# `prop_*`). The 3D view places and scales them from the kit and the scenario at run time.

import importlib.util
import json
import math
import os
import sys
import time

sys.dont_write_bytecode = True  # no __pycache__ beside the committed scripts

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = os.path.abspath(argv[0] if argv else os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(argv[1] if len(argv) > 1 else os.path.join(ROOT, 'public', 'robot3d'))
WHAT = argv[2] if len(argv) > 2 else 'all'
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import lib  # noqa: E402
import tex  # noqa: E402


def load(relative):
    spec = importlib.util.spec_from_file_location(relative.replace('/', '_')[:-3], os.path.join(HERE, relative))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def reference_kit():
    """The reference kit's numbers the models are drawn to (cm, robot frame), from the kit file the physics reads."""
    with open(os.path.join(ROOT, 'src/core/hardware/kits/ref-uno-rover.kit.json')) as f:
        kit = json.load(f)
    ch = kit['chassis']
    L, W, H = ch['bodyCm']
    bottom = ch['clearanceCm']
    top = bottom + H
    mods = {m['role']: m for m in kit['modules']}
    by_kind = lambda kind: [m for m in kit['modules'] if m['kind'] == kind]
    motor = by_kind('dc-motor')[0]
    servo = by_kind('servo')[0]
    lines = by_kind('line-sensor')
    us = by_kind('ultrasonic')[0]
    plate = 0.2
    return {
        'raw': kit,
        'body': {'L': L, 'W': W, 'bottom': bottom, 'top': top},
        'wheel': {'R': motor['spec']['wheelRadiusCm'], 'W': motor['spec']['wheelWidthCm'], 'axle_above_plate': motor['mount']['posCm'][2] - bottom - plate},
        'servo': {'x': servo['mount']['posCm'][0], 'y': servo['mount']['posCm'][1], 'z': servo['mount']['posCm'][2], 'arm_len': servo['spec']['armLengthCm'], 'arm_w': servo['spec']['armWidthCm'],
                  'arm_h': servo['spec']['armHeightCm'], 'deck_rel': top - servo['mount']['posCm'][2], 'yaw': servo['mount']['yawDeg'], 'rest': servo['spec']['restDeg']},
        'caster': {'r': ch['casterRadiusCm'], 'to_plate': bottom - ch['casterCm'][2], 'at': ch['casterCm']},
        'ultrasonic': {'to_plate': us['mount']['posCm'][2] - bottom - plate, 'at': us['mount']['posCm']},
        'line': {'eyes': sorted([m['mount']['posCm'][1] for m in lines], reverse=True), 'to_plate': bottom - lines[0]['mount']['posCm'][2], 'at': lines[len(lines) // 2]['mount']['posCm']},
        'mods': mods,
        'motors': by_kind('dc-motor'),
    }


def place(root, at, yaw_deg=0.0, mirror=False):
    root.location = lib.cm(*at)
    root.rotation_euler = (0, 0, math.radians(yaw_deg))
    if mirror:
        root.scale = (1, -1, 1)


def duplicate_tree(root, suffix):
    copies = {}
    for obj in [root, *root.children_recursive]:
        dup = obj.copy()
        dup.name = obj.name + suffix
        bpy.context.scene.collection.objects.link(dup)
        copies[obj] = dup
    for obj, dup in copies.items():
        if obj.parent in copies:
            dup.parent = copies[obj.parent]
    return copies[root], list(copies.values())


def build_robot(kit):
    col = lib.collection('robot')
    parts = {}
    for name, script, fn in [
        ('chassis', 'parts/chassis.py', 'build'),
        ('board', 'parts/board.py', 'build'),
        ('tt_motor', 'parts/tt_motor.py', 'build'),
        ('wheel', 'parts/wheel.py', 'build'),
        ('caster', 'parts/caster.py', 'build'),
        ('ultrasonic', 'parts/ultrasonic.py', 'build'),
        ('line_bar', 'parts/line_bar.py', 'build'),
        ('line_leds', 'parts/line_bar.py', 'build_leds'),
        ('servo', 'parts/servo.py', 'build'),
        ('led', 'parts/modules.py', 'build_led'),
        ('buzzer', 'parts/modules.py', 'build_buzzer'),
        ('button', 'parts/modules.py', 'build_button'),
    ]:
        started = time.time()
        parts[name] = getattr(load(script), fn)(lib, tex, kit, col)
        print(f'part {name}: {time.time() - started:.1f} s')
    # Every part where the reference kit has it, for the ambient occlusion; the right wheel and motor as mirrored copies.
    b = kit['body']
    left = next(m for m in kit['motors'] if m['mount']['posCm'][1] > 0)
    place(parts['tt_motor'], left['mount']['posCm'])
    place(parts['wheel'], left['mount']['posCm'])
    place(parts['board'], (-1.685, 0, b['top']))
    place(parts['caster'], kit['caster']['at'])
    place(parts['ultrasonic'], kit['ultrasonic']['at'])
    place(parts['line_bar'], kit['line']['at'])
    place(parts['line_leds'], (b['L'] / 2 - 0.05, 0, b['top']))
    place(parts['servo'], (kit['servo']['x'], kit['servo']['y'], kit['servo']['z']))
    bpy.data.objects['servo_horn'].rotation_euler = (0, 0, math.radians(kit['servo']['yaw'] + kit['servo']['rest']))
    for role, name in (('led1', 'led'), ('buzzer', 'buzzer'), ('button1', 'button')):
        place(parts[name], kit['mods'][role]['mount']['posCm'])
    temporary = []
    for name in ('tt_motor', 'wheel'):
        copy, objects = duplicate_tree(parts[name], '__mirror')
        place(copy, (left['mount']['posCm'][0], -left['mount']['posCm'][1], left['mount']['posCm'][2]), mirror=True)
        temporary += objects
    bpy.context.view_layer.update()
    meshes = [o for o in col.all_objects if o.type == 'MESH']
    started = time.time()
    lib.bake_ao(meshes, distance_cm=1.6, samples=32, floor=0.5)
    print(f'robot ao: {time.time() - started:.1f} s, {len(meshes)} meshes')
    for obj in temporary:
        bpy.data.objects.remove(obj)
    return list(parts.values())


def main():
    kit = reference_kit()
    os.makedirs(OUT, exist_ok=True)
    # Each file twice: the high tier's, and the low tier's level of detail (`-low`).
    for detail, suffix in (('high', ''), ('low', '-low')):
        lib.DETAIL = detail
        if WHAT in ('robot', 'all'):
            lib.reset()
            roots = build_robot(kit)
            lib.export_glb(os.path.join(OUT, f'robot-kit{suffix}.glb'), roots)
        if WHAT in ('props', 'all'):
            lib.reset()
            roots = load('props/build_props.py').build_all(lib, tex, kit)
            lib.export_glb(os.path.join(OUT, f'arena-props{suffix}.glb'), roots)


main()
