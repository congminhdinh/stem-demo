# part_line_bar: a three-channel line sensor bar (N18 R4.7), for line sensors 1.5 cm apart as in the reference kit: a black board on
# two brass standoffs under the lower plate's nose, three reflective IR pairs (a black housing with a blue emitter and a black receiver
# looking down) at the eyes, a blue trimmer per channel and a header. Origin: the middle eye's mount (its height above the floor).
# part_line_leds (fix round 1): the bar's indicator board on the top deck's front edge, where the lamps show from behind and above (under
# the nose they never did, and the bar cannot stick out past the nose: the physics' body ends there): a small black board on two nylon
# spacers with a 3 mm red LED per eye, in line with it: `line_led_0` (the leftmost, +y), `line_led_1`, `line_led_2`,
# which the view lights when that sensor sees dark. Origin: the middle of its front edge on the deck's top.


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
    for side in (-1, 1):
        statics.append(lib.cylinder('line_standoff', 0.17, up - board_z - 0.16, at=(-0.2, side * (span / 2 - 0.35), board_z + 0.16 + (up - board_z - 0.16) / 2), material=brass, segments=6, col=col, parent=root))
    statics.append(lib.box('line_header', (0.25, 1.27, 0.25), at=(-0.45, 0, board_z + 0.16 + 0.125), material=housing, col=col, parent=root))
    pin = lib.box('line_pin', (0.06, 0.06, 0.5), at=(-0.45, -0.508, board_z + 0.16 + 0.35), material=gold, col=col, parent=root)
    lib.add_array(pin, 5, (0, 0.254, 0))
    statics.append(pin)
    lib.join(statics, 'line_static')
    return root


def build_leds(lib, tex, kit, col):
    eyes = kit['line']['eyes']
    root = lib.empty('part_line_leds', col=col)
    black_pcb = lib.material('pcb_black', image=lib.image_from_array('pcb_black', lambda: tex.pcb(256, 128, '#1b1d21', '#2c3036', '#d2c08a', '#d9dde2', 53, traces=26)), roughness=0.4, coat=0.2)
    nylon = lib.material('abs_white', '#f4f4f1', roughness=0.45)
    housing = lib.material('abs_black', '#1d1f23', roughness=0.42)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    led_off = lib.material('line_led', '#3a0e0e', roughness=0.18)
    span = max(eyes) - min(eyes) + 2.0
    depth = 1.2
    lift = 0.3
    statics = []
    pcb = lib.box('leds_pcb', (depth, span, 0.16), at=(-depth / 2, 0, lift + 0.08), material=black_pcb, bevel=0.03, segments=1, col=col, parent=root)
    lib.planar_uv(pcb, (depth, span), origin=(-depth / 2, 0))
    statics.append(pcb)
    for side in (-1, 1):
        statics.append(lib.cylinder('leds_spacer', 0.17, lift, at=(-depth / 2, side * (span / 2 - 0.4), lift / 2), material=nylon, segments=10, col=col, parent=root))
    top = lift + 0.16
    for k, y in enumerate(eyes):
        led = lib.lathe(f'line_led_{k}', [(0.0, 0.0), (0.18, 0.0), (0.18, 0.06), (0.15, 0.06), (0.15, 0.24), (0.13, 0.32), (0.07, 0.37), (0.0, 0.38)], at=(-0.32, y, top), material=led_off, segments=20, col=col, parent=root)
        led.name = f'line_led_{k}'
    # The header at the board's right end, out of the way of the LEDs as the chase camera sees them from behind.
    side = -(span / 2 - 0.3)
    statics.append(lib.box('leds_header', (0.76, 0.25, 0.25), at=(-0.6, side, top + 0.125), material=housing, col=col, parent=root))
    pin = lib.box('leds_pin', (0.06, 0.06, 0.4), at=(-0.6 - 0.254, side, top + 0.35), material=gold, col=col, parent=root)
    lib.add_array(pin, 3, (0.254, 0, 0))
    statics.append(pin)
    lib.join(statics, 'line_leds_static')
    return root
