# The robot's small output and input modules (N18 R4.7), each on its own little black board on the deck, its origin at the board's
# underside on the deck (the kit's mount): part_led, a 5 mm red LED on its legs (`led_dome`, which the view lights); part_buzzer, an
# active buzzer can; part_button, a 12 mm tactile switch and its cap (`button_cap`, which the view presses by `extras.travel` m).

import math


def module_board(lib, name, size, material, col, parent):
    pcb = lib.box(name, (size, size, 0.16), at=(0, 0, 0.08), material=material, bevel=0.03, segments=1, col=col, parent=parent)
    lib.planar_uv(pcb, (size, size))
    return pcb


def build_led(lib, tex, kit, col):
    root = lib.empty('part_led', col=col)
    pcb_mat = lib.material('pcb_black', image=lib.image_from_array('pcb_black', lambda: tex.pcb(256, 128, '#1b1d21', '#2c3036', '#d2c08a', '#d9dde2', 53, traces=26)), roughness=0.4, coat=0.2)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    dark = lib.material('abs_black', '#1d1f23', roughness=0.42)
    red = lib.material('led_red', '#c8171c', roughness=0.12, alpha=1.0)
    statics = [module_board(lib, 'led_board', 1.6, pcb_mat, col, root)]
    for side in (-1, 1):
        statics.append(lib.cylinder('led_leg', 0.025, 0.3, at=(0, side * 0.127, 0.31), material=steel, segments=6, col=col, parent=root))
    statics.append(lib.box('led_header', (0.25, 0.76, 0.25), at=(-0.62, 0, 0.285), material=dark, col=col, parent=root))
    pin = lib.box('led_pin', (0.06, 0.06, 0.4), at=(-0.62, -0.254, 0.5), material=gold, col=col, parent=root)
    lib.add_array(pin, 3, (0, 0.254, 0))
    statics.append(pin)
    lib.join(statics, 'led_static')
    dome = lib.lathe('led_dome', [(0.0, 0.46), (0.29, 0.46), (0.29, 0.56), (0.25, 0.56), (0.25, 0.92)] + [(0.25 * math.cos(a), 0.92 + 0.25 * math.sin(a)) for a in [i * math.pi / 16 for i in range(1, 9)]], material=red, segments=28, col=col, parent=root)
    lib.smooth_by_angle(dome, 50)
    return root


def build_buzzer(lib, tex, kit, col):
    root = lib.empty('part_buzzer', col=col)
    pcb_mat = lib.material('pcb_black', image=lib.image_from_array('pcb_black', lambda: tex.pcb(256, 128, '#1b1d21', '#2c3036', '#d2c08a', '#d9dde2', 53, traces=26)), roughness=0.4, coat=0.2)
    black = lib.material('buzzer_black', '#121316', roughness=0.55)
    dark = lib.material('abs_black', '#1d1f23', roughness=0.42)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    statics = [module_board(lib, 'buzzer_board', 2.0, pcb_mat, col, root)]
    can = lib.lathe('buzzer_can', [(0.0, 0.16), (0.6, 0.16), (0.6, 1.05), (0.56, 1.11), (0.14, 1.11), (0.14, 1.0), (0.0, 1.0)], material=black, segments=40, col=col, parent=root)
    statics.append(can)
    statics.append(lib.box('buzzer_header', (0.25, 0.76, 0.25), at=(-0.82, 0, 0.285), material=dark, col=col, parent=root))
    pin = lib.box('buzzer_pin', (0.06, 0.06, 0.4), at=(-0.82, -0.254, 0.5), material=gold, col=col, parent=root)
    lib.add_array(pin, 3, (0, 0.254, 0))
    statics.append(pin)
    lib.join(statics, 'buzzer_static')
    return root


def build_button(lib, tex, kit, col):
    root = lib.empty('part_button', col=col)
    pcb_mat = lib.material('pcb_black', image=lib.image_from_array('pcb_black', lambda: tex.pcb(256, 128, '#1b1d21', '#2c3036', '#d2c08a', '#d9dde2', 53, traces=26)), roughness=0.4, coat=0.2)
    body = lib.material('abs_black', '#1d1f23', roughness=0.42)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    cap_mat = lib.material('button_cap', '#1fa4e0', roughness=0.35)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    statics = [module_board(lib, 'button_board', 1.8, pcb_mat, col, root)]
    statics.append(lib.box('switch_body', (1.2, 1.2, 0.33), at=(0, 0, 0.16 + 0.165), material=body, bevel=0.03, col=col, parent=root))
    statics.append(lib.box('switch_cover', (1.2, 1.2, 0.03), at=(0, 0, 0.16 + 0.345), material=steel, col=col, parent=root))
    statics.append(lib.cylinder('switch_stem', 0.36, 0.06, at=(0, 0, 0.16 + 0.39), material=body, segments=24, col=col, parent=root))
    for sx in (-1, 1):
        for sy in (-1, 1):
            statics.append(lib.box('switch_leg', (0.08, 0.2, 0.12), at=(sx * 0.64, sy * 0.42, 0.22), material=steel, col=col, parent=root))
    statics.append(lib.box('button_header', (0.25, 0.76, 0.25), at=(-0.72, 0, 0.285), material=body, col=col, parent=root))
    pin = lib.box('button_pin', (0.06, 0.06, 0.4), at=(-0.72, -0.254, 0.5), material=gold, col=col, parent=root)
    lib.add_array(pin, 3, (0, 0.254, 0))
    statics.append(pin)
    lib.join(statics, 'button_static')
    cap = lib.lathe('button_cap', [(0.0, 0.42), (0.36, 0.42), (0.36, 0.72), (0.32, 0.8), (0.0, 0.83)], material=cap_mat, segments=32, col=col, parent=root)
    cap['travel'] = lib.cm(0.15)
    return root


def build_dupont(lib, tex, kit, col):
    """part_dupont: a jumper wire's plug housing, 2.54 mm square, its long axis z; the view puts one at each end of a wire."""
    root = lib.empty('part_dupont', col=col)
    body = lib.material('abs_black', '#1d1f23', roughness=0.42)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    housing = lib.box('dupont_housing', (0.25, 0.25, 1.4), at=(0, 0, 0.7), material=body, bevel=0.02, segments=1, col=col, parent=root)
    tip = lib.box('dupont_tip', (0.08, 0.08, 0.3), at=(0, 0, -0.15), material=steel, col=col, parent=root)
    lib.join([housing, tip], 'dupont')
    return root
