# part_board: the UNO-compatible controller board (N18 R4.7), the lab's own drawing of a generic board of that format: a 68.6 × 53.3
# mm teal board with rounded corners and four mounting holes on nylon standoffs, black female headers with real sockets (an array of
# socket cutters and a boolean) along both long edges, the USB-B socket and the barrel jack on one short edge, the MCU in its DIP-28
# package with its legs, the crystal, two capacitors, the regulator, the reset button, the ICSP pins and the four LEDs. No logo, name
# or wordmark of any vendor (plan D-R7): the silkscreen is outlines only. Origin: the middle of the board, on the deck it stands on
# (the bottom of the standoffs); its long side along y, its USB edge at +y. `board_led_l` is the "L" LED on D13, which the view lights.

LONG, SHORT, T, STANDOFF = 6.86, 5.33, 0.16, 0.6


def header(lib, name, pins, at, material, col, parent):
    body = lib.box(name, (0.25, pins * 0.254, 0.85), at=at, material=material, bevel=0.02, segments=1, col=col)
    lib.apply_modifiers(body)
    cutter = lib.box(name + '_sockets', (0.1, 0.1, 0.7), at=(at[0], at[1] - (pins - 1) * 0.127, at[2] + 0.4), col=col)
    lib.add_array(cutter, pins, (0, 0.254, 0))
    lib.apply_modifiers(cutter)
    lib.boolean(body, cutter)
    body.parent = parent
    return body


def build(lib, tex, kit, col):
    root = lib.empty('part_board', col=col)
    z0 = STANDOFF
    top = z0 + T
    # Board coordinates (cm): a along x (the front edge +), b along y (the USB edge +); the texture's u along a, v along b.
    def uv_of(a, b):
        # Image coordinates (x, row) of a board point: planar_uv puts v = b / LONG + 0.5, and the image's first row is at v = 1.
        return (a / SHORT + 0.5, 0.5 - b / LONG)

    edge = SHORT / 2 - 0.17
    headers = [(10, edge, -1.9), (8, edge, 0.85), (8, -edge, -1.35), (6, -edge, 1.3)]
    pad_rows = []
    for pins, a, b in headers:
        (u0, v0), (u1, v1) = uv_of(a, b - (pins - 1) * 0.127), uv_of(a, b + (pins - 1) * 0.127)
        pad_rows.append((u0, v0, u1, v1, pins))
    outlines = [(*uv_of(-1.25, -2.85), *uv_of(-0.25, 1.05)), (*uv_of(0.35, 2.45), *uv_of(1.8, 3.4)), (*uv_of(-2.15, 2.3), *uv_of(-1.05, 3.4)), (*uv_of(-0.25, -3.35), *uv_of(0.45, -2.6))]
    outlines = [(min(a, c), min(b, d), max(a, c), max(b, d)) for a, b, c, d in outlines]
    image = lib.image_from_array('pcb_teal', tex.pcb(400, 512, '#007a82', '#159aa1', '#d8c48c', '#eef3f3', 51, traces=90, pad_rows=pad_rows, outlines=outlines, pads=[(0.2, 0.15, 0.012), (0.85, 0.85, 0.012)]))
    teal = lib.material('pcb_teal', image=image, roughness=0.36, coat=0.3)
    header_black = lib.material('header_black', '#17181b', roughness=0.5)
    black = lib.material('abs_black', '#1d1f23', roughness=0.42)
    chip = lib.material('chip_black', '#18191c', roughness=0.62)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    nylon = lib.material('nylon', '#ece6d6', roughness=0.55)
    red = lib.material('button_red', '#d7262b', roughness=0.4)
    led_green = lib.material('led_power_green', '#35d46a', roughness=0.3, emission='#35d46a', emission_strength=4.0)
    led_amber = lib.material('led_amber', '#ffb020', roughness=0.3)

    pcb = lib.polygon_prism('board_pcb', lib.rounded_rect(SHORT, LONG, 0.3), T, at=(0, 0, z0), material=teal, col=col, parent=root)
    holes = [(-SHORT / 2 + 0.35, -LONG / 2 + 1.4), (SHORT / 2 - 0.25, -LONG / 2 + 1.5), (-SHORT / 2 + 0.35, LONG / 2 - 0.4), (SHORT / 2 - 0.25, LONG / 2 - 1.25)]
    for a, b in holes:
        lib.boolean(pcb, lib.cylinder('hole', 0.16, 1.0, at=(a, b, z0), segments=12, col=col))
    lib.planar_uv(pcb, (SHORT, LONG))
    statics = [pcb]
    for a, b in holes:
        statics.append(lib.cylinder('standoff', 0.24, STANDOFF, at=(a, b, STANDOFF / 2), material=nylon, segments=12, col=col, parent=root))
        statics.append(lib.lathe('screw', [(0, 0), (0.25, 0), (0.25, 0.04), (0.18, 0.1), (0, 0.11)], at=(a, b, top), material=steel, segments=14, col=col, parent=root))
    for i, (pins, a, b) in enumerate(headers):
        statics.append(header(lib, f'header_{i}', pins, (a, b, top + 0.425), header_black, col, root))

    # USB-B socket and the barrel jack on the +y edge.
    usb = lib.box('usb', (1.2, 1.6, 1.08), at=(1.05, LONG / 2 - 0.55, top + 0.54), material=steel, bevel=0.05, col=col, parent=root)
    lib.apply_modifiers(usb)
    lib.boolean(usb, lib.box('usb_mouth', (0.85, 0.6, 0.75), at=(1.05, LONG / 2 + 0.05, top + 0.56), col=col))
    statics += [usb, lib.box('usb_tongue', (0.55, 0.5, 0.25), at=(1.05, LONG / 2 - 0.05, top + 0.56), material=black, col=col, parent=root)]
    jack = lib.box('jack', (0.9, 1.4, 1.1), at=(-1.6, LONG / 2 - 0.45, top + 0.55), material=black, bevel=0.08, col=col, parent=root)
    lib.apply_modifiers(jack)
    lib.boolean(jack, lib.cylinder('jack_mouth', 0.28, 0.8, at=(-1.6, LONG / 2 + 0.1, top + 0.62), axis='Y', segments=16, col=col))
    statics.append(jack)

    # The MCU (DIP-28, its notch and legs), the crystal, capacitors, regulator, USB-serial chip.
    statics.append(lib.box('mcu', (0.75, 3.56, 0.34), at=(-0.75, -0.9, top + 0.12 + 0.17), material=chip, bevel=0.03, col=col, parent=root))
    statics.append(lib.cylinder('mcu_dot', 0.07, 0.02, at=(-0.75, -0.9 - 1.53, top + 0.47), material=steel, segments=10, col=col, parent=root))
    leg = lib.box('mcu_leg', (0.16, 0.08, 0.28), at=(-0.75 - 0.42, -0.9 - 1.651, top + 0.14), material=steel, col=col, parent=root)
    lib.add_array(leg, 14, (0, 0.254, 0))
    leg2 = lib.box('mcu_leg2', (0.16, 0.08, 0.28), at=(-0.75 + 0.42, -0.9 - 1.651, top + 0.14), material=steel, col=col, parent=root)
    lib.add_array(leg2, 14, (0, 0.254, 0))
    statics += [leg, leg2]
    statics.append(lib.box('crystal', (0.45, 1.1, 0.36), at=(0.35, 0.4, top + 0.18), material=steel, bevel=0.2, segments=4, col=col, parent=root))
    for b in (0.95, 1.55):
        statics.append(lib.cylinder('cap', 0.3, 0.55, at=(-1.6, b, top + 0.275), material=black, segments=20, col=col, parent=root, bevel=0.03))
        statics.append(lib.cylinder('cap_top', 0.28, 0.02, at=(-1.6, b, top + 0.56), material=steel, segments=20, col=col, parent=root))
    statics.append(lib.box('regulator', (0.4, 0.65, 0.15), at=(-1.95, 0.0, top + 0.075), material=chip, col=col, parent=root))
    statics.append(lib.box('usb_chip', (0.5, 0.5, 0.1), at=(1.25, 1.75, top + 0.05), material=chip, col=col, parent=root))

    # Reset button, the ICSP block.
    statics.append(lib.box('reset_base', (0.6, 0.6, 0.3), at=(1.95, -LONG / 2 + 0.7, top + 0.15), material=steel, bevel=0.03, col=col, parent=root))
    statics.append(lib.cylinder('reset_cap', 0.17, 0.16, at=(1.95, -LONG / 2 + 0.7, top + 0.38), material=red, segments=16, col=col, parent=root, bevel=0.03))
    statics.append(lib.box('icsp', (0.5, 0.75, 0.25), at=(0.1, -LONG / 2 + 0.55, top + 0.125), material=black, col=col, parent=root))
    for i in range(6):
        statics.append(lib.box('icsp_pin', (0.06, 0.06, 0.6), at=(0.1 + (-0.127 if i % 2 == 0 else 0.127), -LONG / 2 + 0.55 + (i // 2 - 1) * 0.254, top + 0.3), material=gold, col=col, parent=root))
    statics.append(lib.box('led_power', (0.12, 0.2, 0.08), at=(0.95, -2.25, top + 0.04), material=led_green, col=col, parent=root))
    for k, b in enumerate((0.3, 0.55)):
        statics.append(lib.box(f'led_txrx_{k}', (0.12, 0.2, 0.08), at=(1.25, b, top + 0.04), material=led_amber, col=col, parent=root))
    lib.join(statics, 'board_static')
    lib.box('board_led_l', (0.12, 0.2, 0.08), at=(1.6, 0.0, top + 0.04), material=lib.material('led_l', '#ffb020', roughness=0.3), col=col, parent=root)
    return root
