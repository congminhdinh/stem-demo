# Builds the robot lab's 3D assets (N18 R4.7): run by `pnpm build:robot-assets` (scripts/build-robot-assets.mjs) as
#
#   Blender -b --factory-startup -P assets-src/robot3d/build.py -- <repo root> <out dir> [robot|props|all|n19|n19-robot|n19-props]
#
# It reads the reference kit (src/core/hardware/kits/ref-uno-rover.kit.json) for every size it models, runs each part script of
# parts/ and each prop script of props/, puts the parts where the reference kit mounts them, bakes ambient occlusion with every part in
# place (so the lower plate is darker under the battery, the board's headers shade the board), and exports two binary glTFs:
# robot-kit.glb (every robot part, each a root node `part_*` whose origin is its kit mount) and arena-props.glb (every prop,
# `prop_*`). The 3D view places and scales them from the kit and the scenario at run time.
#
# N19 E6/E7 (`n19`): the gripper car's parts (parts/gripper.py), every size from the gripper kit as well
# (src/core/hardware/kits/ref-uno-gripper.kit.json), baked on the gripper car (the rover's parts round them, posed on its mounts, only
# to shade them), exported alone as robot-kit-n19.glb; and the pick-and-place props (props/build_props_n19.py) as arena-props-n19.glb.
# scripts/build-robot-assets.mjs appends them to robot-kit.glb and arena-props.glb, whose N18 roots it keeps byte for byte
# (scripts/lib/glb-splice.ts: Cycles' bake is not the same from one run to the next, so the rover's parts are not built again).

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


def gripper_kit(reference):
    """The gripper kit's numbers the gripper's parts are drawn to (cm, robot frame), from the kit file the physics reads (N19 E6)."""
    with open(os.path.join(ROOT, 'src/core/hardware/kits/ref-uno-gripper.kit.json')) as f:
        kit = json.load(f)
    ch = kit['chassis']
    L, W, H = ch['bodyCm']
    bottom = ch['clearanceCm']
    by_kind = lambda kind: [m for m in kit['modules'] if m['kind'] == kind]
    gripper = by_kind('gripper')[0]
    us = by_kind('ultrasonic')[0]
    ref_us = reference['ultrasonic']
    # The ultrasonic part is modelled to the reference kit's height over the lower plate; a kit that mounts it higher stands its bracket
    # on standoffs (part_ultrasonic_riser): their height, and the drop from the mount to the bracket's foot.
    riser = (us['mount']['posCm'][2] - bottom) - (ref_us['at'][2] - reference['body']['bottom'])
    return {
        'raw': kit,
        'body': {'L': L, 'W': W, 'bottom': bottom, 'top': bottom + H},
        'gripper': {'mount': gripper['mount']['posCm'], 'spec': gripper['spec']},
        'ir': by_kind('ir-obstacle')[0]['mount']['posCm'],
        'color': by_kind('color-sensor')[0]['mount']['posCm'],
        'ultrasonic': {'at': us['mount']['posCm']},
        'riser': {'height': riser, 'drop': ref_us['to_plate']},
        'mods': {m['role']: m for m in kit['modules']},
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


def gripper_pose(grip, roots, lift_deg, claw_deg):
    """Puts the gripper's moving parts where the view does for a lift and a claw angle (robot frame, cm): world/robot/gripper.ts's."""
    spec = grip['gripper']['spec']
    mx, my, mz = grip['gripper']['mount']
    e = math.radians(lift_deg + spec['boomElevationAtLift0Deg'])
    L = spec['boomLengthCm']
    tip = (mx + L * math.cos(e), my, mz + L * math.sin(e))
    beta = spec['fingerOpenDeg'] - spec['fingerDegPerServoDeg'] * claw_deg
    roots['boom'].location = lib.cm(mx, my, mz)
    roots['boom'].rotation_euler = (0, -e, 0)
    roots['bracket'].location = lib.cm(mx, my, mz)
    bpy.data.objects['gripper_link'].rotation_euler = (0, -e, 0)
    roots['carriage'].location = lib.cm(*tip)
    for name, side in (('jaw_l', 1), ('jaw_r', -1)):
        hinge = (tip[0] + spec['fingerHingeUCm'], tip[1] + side * spec['fingerHingeVCm'], tip[2])
        roots[name].location = lib.cm(*hinge)
        roots[name].rotation_euler = (0, 0, math.radians(side * beta))
    for name in ('ir', 'color'):
        u, v, w = grip[name]
        roots[name].location = lib.cm(tip[0] + u, tip[1] + v, tip[2] + w)
    bpy.context.view_layer.update()


def build_gripper(kit, grip):
    """N19 E6: the gripper's parts on the gripper car, baked there, returned alone (the rover's parts round them are only shade)."""
    col = lib.collection('robot')
    context = []
    # The car's other parts where the view puts them on the gripper kit: what shades the bracket.
    for name, script, fn in [
        ('chassis', 'parts/chassis.py', 'build'),
        ('board', 'parts/board.py', 'build'),
        ('tt_motor', 'parts/tt_motor.py', 'build'),
        ('wheel', 'parts/wheel.py', 'build'),
        ('caster', 'parts/caster.py', 'build'),
        ('ultrasonic', 'parts/ultrasonic.py', 'build'),
        ('line_bar', 'parts/line_bar.py', 'build'),
        ('line_leds', 'parts/line_bar.py', 'build_leds'),
    ]:
        root = getattr(load(script), fn)(lib, tex, kit, col)
        context.append((name, root))
    b = grip['body']
    shade = dict(context)
    left = next(m for m in grip['motors'] if m['mount']['posCm'][1] > 0)
    place(shade['tt_motor'], left['mount']['posCm'])
    place(shade['wheel'], left['mount']['posCm'])
    place(shade['board'], (b['L'] / 2 - 0.05 - 1.2 - 0.12 - 5.33 / 2, 0, b['top']))
    place(shade['caster'], grip['raw']['chassis']['casterCm'])
    place(shade['ultrasonic'], grip['ultrasonic']['at'])
    place(shade['line_bar'], kit['line']['at'])
    place(shade['line_leds'], (b['L'] / 2 - 0.05, 0, b['top']))
    gripper = load('parts/gripper.py')
    started = time.time()
    roots = {
        'bracket': gripper.build_bracket(lib, tex, grip, col),
        'boom': gripper.build_boom(lib, tex, grip, col),
        'carriage': gripper.build_carriage(lib, tex, grip, col),
        'jaw_l': gripper.build_jaw(lib, tex, grip, col, 1),
        'jaw_r': gripper.build_jaw(lib, tex, grip, col, -1),
        'ir': gripper.build_ir(lib, tex, grip, col),
        'color': gripper.build_color(lib, tex, grip, col),
        'riser': gripper.build_riser(lib, tex, grip, col),
    }
    print(f'part gripper: {time.time() - started:.1f} s')
    us = grip['ultrasonic']['at']
    place(roots['riser'], (us[0], us[1], us[2] - grip['riser']['drop']))
    meshes = lambda root: [o for o in [root, *root.children_recursive] if o.type == 'MESH']
    moving = [o for name in ('boom', 'carriage', 'jaw_l', 'jaw_r', 'ir', 'color') for o in meshes(roots[name])] + [o for o in bpy.data.objects['gripper_link'].children_recursive if o.type == 'MESH']
    static = [o for o in meshes(roots['bracket']) + meshes(roots['riser']) if o not in moving]
    # The bracket and the riser shaded by the car round them and by the arm at setup()'s pose (lift 90°, claw open), the floor under all.
    gripper_pose(grip, roots, 90, 0)
    started = time.time()
    lib.bake_ao(static, distance_cm=1.6, samples=32, floor=0.5)
    # What moves shaded by the gripper alone, the arm halfway up: no shade of the car or the floor that would stay on a part as it moves.
    hidden = [o for _, root in context for o in [root, *root.children_recursive]]
    for obj in hidden:
        obj.hide_render = True
    gripper_pose(grip, roots, 45, 0)
    lib.bake_ao(moving, distance_cm=1.6, samples=32, floor=0.5, ground=False)
    print(f'gripper ao: {time.time() - started:.1f} s, {len(static) + len(moving)} meshes')
    for _, root in context:
        for obj in [root, *root.children_recursive]:
            bpy.data.objects.remove(obj)
    # Exported at the pose the view starts from (it puts every part itself): every joint at rest.
    bpy.data.objects['gripper_link'].rotation_euler = (0, 0, 0)
    for root in roots.values():
        root.rotation_euler = (0, 0, 0)
    return list(roots.values())


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
        # N19 E6/E7: the gripper car's parts and the pick-and-place props, each file of its own (build-robot-assets.mjs splices them).
        if WHAT in ('n19', 'n19-robot'):
            lib.reset()
            roots = build_gripper(kit, gripper_kit(kit))
            lib.export_glb(os.path.join(OUT, f'robot-kit-n19{suffix}.glb'), roots)
        if WHAT in ('n19', 'n19-props'):
            lib.reset()
            roots = load('props/build_props_n19.py').build_all(lib, tex, kit)
            lib.export_glb(os.path.join(OUT, f'arena-props-n19{suffix}.glb'), roots)


main()
