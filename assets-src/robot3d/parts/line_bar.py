# part_line_bar: a three-channel line sensor bar (N18 R4.7), for line sensors 1.5 cm apart as in the reference kit: a black board on
# two brass standoffs under the lower plate's nose, three reflective IR pairs (a black housing with a blue emitter and a black receiver
# looking down) at the eyes, a blue trimmer per channel, a header, and per eye the indicator LED the view lights when that sensor sees
# dark: `line_led_0` (the leftmost, +y), `line_led_1`, `line_led_2`. Origin: the middle eye's mount (its height above the floor).


def build(lib, tex, kit, col):
    eyes = kit['line']['eyes']  # robot-frame y of each eye, left to right (cm)
    up = kit['line']['to_plate']  # from the eyes up to the lower plate's underside (cm)
    root = lib.empty('part_line_bar', col=col)
    black_pcb = lib.material('pcb_black', image=lib.image_from_array('pcb_black', lambda: tex.pcb(256, 128, '#1b1d21', '#2c3036', '#d2c08a', '#d9dde2', 53, traces=26)), roughness=0.4, coat=0.2)
    housing = lib.material('abs_black', '#1d1f23', roughness=0.42)
    emitter = lib.material('ir_emitter', '#3b6fd8', roughness=0.12)
    receiver = lib.material('ir_receiver', '#0c0d10', roughness=0.12)
    trimmer = lib.material('trimmer_blue', '#2a6fe8', roughness=0.4)
    white = lib.material('abs_white', '#f4f4f1', roughness=0.45)
    brass = lib.material('brass', '#d2a94c', metallic=1.0, roughness=0.3)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    led_off = lib.material('line_led', '#5a1010', roughness=0.25)

    span = max(eyes) - min(eyes) + 2.2
    board_z = 0.2
    statics = []
    pcb = lib.box('line_pcb', (1.4, span, 0.16), at=(0.15, 0, board_z + 0.08), material=black_pcb, bevel=0.03, segments=1, col=col, parent=root)
    lib.planar_uv(pcb, (1.4, span), origin=(0.15, 0))
    statics.append(pcb)
    for k, y in enumerate(eyes):
        statics.append(lib.box(f'ir_housing_{k}', (0.58, 1.0, 0.2), at=(0, y, 0.1), material=housing, bevel=0.03, col=col, parent=root))
        statics.append(lib.cylinder(f'ir_emit_{k}', 0.15, 0.06, at=(0, y + 0.24, 0.0), material=emitter, segments=14, col=col, parent=root))
        statics.append(lib.cylinder(f'ir_recv_{k}', 0.15, 0.06, at=(0, y - 0.24, 0.0), material=receiver, segments=14, col=col, parent=root))
        statics.append(lib.box(f'trim_{k}', (0.32, 0.32, 0.22), at=(-0.25, y, board_z + 0.16 + 0.11), material=trimmer, bevel=0.03, col=col, parent=root))
        statics.append(lib.box(f'trim_slot_{k}', (0.24, 0.05, 0.02), at=(-0.25, y, board_z + 0.16 + 0.23), material=white, col=col, parent=root))
        lib.box(f'line_led_{k}', (0.22, 0.16, 0.08), at=(0.6, y, board_z + 0.16 + 0.04), material=led_off, col=col, parent=root)
    for side in (-1, 1):
        statics.append(lib.cylinder('line_standoff', 0.17, up - board_z - 0.16, at=(-0.2, side * (span / 2 - 0.35), board_z + 0.16 + (up - board_z - 0.16) / 2), material=brass, segments=6, col=col, parent=root))
    statics.append(lib.box('line_header', (0.25, 1.27, 0.25), at=(-0.45, 0, board_z + 0.16 + 0.125), material=housing, col=col, parent=root))
    pin = lib.box('line_pin', (0.06, 0.06, 0.5), at=(-0.45, -0.508, board_z + 0.16 + 0.35), material=gold, col=col, parent=root)
    lib.add_array(pin, 5, (0, 0.254, 0))
    statics.append(pin)
    lib.join(statics, 'line_static')
    return root
