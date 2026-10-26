import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { ExtrudeGeometry, Shape, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { robot3dColors as colors } from './colors';
import { createGripperPose, gripperPoseInto, gripperStateOf } from './gripper-pose';
import { buttonPressed, lineSeesDark, toneHzOf, type RobotModel } from './robot-model';
import { servoArmYawRad, wheelSpin, writePose } from './scene-math';

// The robot in the 3D view (N18 R4.2): low-poly, the lab's own artwork (no logo), built from the kit (robot-model.ts) so every part is
// where the physics has it. Its pose, its wheels, its servo arm and what its LED, line sensors, buzzer and button show are read from the
// world in the frame callback (`view()`), never through a React render: a run re-renders nothing here. N19 E6: the gripper as boxes, the
// physics' own (the boom's plates and bar, the carriage, the fingers), posed from robot.gripper as the modelled one is (gripper-pose.ts).

type RobotViewProps = {
  model: RobotModel;
  /** The world to draw now (the run's latest, what a stopped run left, or the scenario's start). */
  view: () => RobotSnapshot;
  shadows: boolean;
};

/** Small parts of the robot that are not in the kit's data: their size in m (a decoration, never a collider). */
const PCB = 0.0016;
const BEVEL = 0.004;
const CORNER = 0.016;

/** The chassis: a rounded box seen from above, its edges bevelled, standing `bottom` above the floor. */
function chassisGeometry({ lengthM, widthM, heightM }: RobotModel['body']): ExtrudeGeometry {
  const [hx, hy] = [lengthM / 2 - BEVEL, widthM / 2 - BEVEL];
  const r = Math.min(CORNER, hx, hy);
  const shape = new Shape();
  shape.moveTo(-hx + r, -hy);
  shape.lineTo(hx - r, -hy);
  shape.quadraticCurveTo(hx, -hy, hx, -hy + r);
  shape.lineTo(hx, hy - r);
  shape.quadraticCurveTo(hx, hy, hx - r, hy);
  shape.lineTo(-hx + r, hy);
  shape.quadraticCurveTo(-hx, hy, -hx, hy - r);
  shape.lineTo(-hx, -hy + r);
  shape.quadraticCurveTo(-hx, -hy, -hx + r, -hy);
  const geometry = new ExtrudeGeometry(shape, { depth: heightM - 2 * BEVEL, bevelEnabled: true, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: 2, curveSegments: 4 });
  // The shape is drawn in the robot's (x, y) and extruded along +Z: turned so that it is extruded upwards, with robot y along −Z.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, BEVEL, 0);
  return geometry;
}

export function RobotView({ model, view, shadows }: RobotViewProps) {
  const robot = useRef<Group>(null);
  const wheels = useRef<(Group | null)[]>([]);
  const arms = useRef<(Group | null)[]>([]);
  const ledLamps = useRef<(MeshStandardMaterial | null)[]>([]);
  const ledHalos = useRef<(Mesh | null)[]>([]);
  const lineLamps = useRef<(MeshStandardMaterial | null)[]>([]);
  const buzzerWaves = useRef<(Group | null)[]>([]);
  const buttonCaps = useRef<(Mesh | null)[]>([]);
  const gripperBoom = useRef<Group>(null);
  const gripperCarriage = useRef<Group>(null);
  const gripperJaws = useRef<(Group | null)[]>([]);
  const gripperPose = useMemo(createGripperPose, []);
  const chassis = useMemo(() => chassisGeometry(model.body), [model.body]);
  useEffect(() => () => chassis.dispose(), [chassis]);

  const { body } = model;
  const deck = body.bottomM + body.heightM;

  useFrame(() => {
    const world = view();
    if (robot.current) writePose(robot.current, world.robot);
    model.wheels.forEach((wheel, i) => {
      const spin = wheels.current[i];
      if (spin) spin.rotation.z = wheelSpin(world.robot.wheelRad[wheel.role === 'motorRight' ? 1 : 0]);
    });
    model.servos.forEach((servo, i) => {
      const arm = arms.current[i];
      if (arm) arm.rotation.y = servoArmYawRad(servo.mountYawDeg, world.robot.servoDeg[servo.role] ?? 0);
    });
    model.leds.forEach((led, i) => {
      const lit = world.leds[led.role] === true;
      const lamp = ledLamps.current[i];
      if (lamp) {
        lamp.color.set(lit ? colors.ledOn : colors.ledOff);
        lamp.emissive.set(lit ? colors.ledOn : colors.ledOff);
        lamp.emissiveIntensity = lit ? 2.2 : 0;
      }
      const halo = ledHalos.current[i];
      if (halo) halo.visible = lit;
    });
    model.lineSensors.forEach((sensor, i) => {
      const lamp = lineLamps.current[i];
      if (lamp) {
        const dark = lineSeesDark(world, sensor.sensorIndex);
        lamp.color.set(dark ? colors.lineSensorDark : colors.lineSensorLight);
        lamp.emissive.set(dark ? colors.lineSensorDark : colors.lineSensorLight);
        lamp.emissiveIntensity = dark ? 1.8 : 0;
      }
    });
    model.buzzers.forEach((buzzer, i) => {
      const waves = buzzerWaves.current[i];
      if (waves) waves.visible = toneHzOf(world, buzzer.pinIndex) !== null;
    });
    model.buttons.forEach((button, i) => {
      const cap = buttonCaps.current[i];
      if (cap) cap.position.y = buttonPressed(world, button.pinIndex) ? 0.0042 : 0.006;
    });
    if (model.gripper) {
      // Written into one pose and the nodes: nothing is made a frame (N19 E6 fix round 1, review M1).
      const { tip, jawLeft, jawRight, elevationRad, betaRad } = gripperPoseInto(gripperPose, model.gripper, gripperStateOf(world));
      if (gripperBoom.current) gripperBoom.current.rotation.z = elevationRad;
      gripperCarriage.current?.position.set(tip[0], tip[1], tip[2]);
      const [left, right] = gripperJaws.current;
      if (left) {
        left.position.set(jawLeft[0], jawLeft[1], jawLeft[2]);
        left.rotation.y = betaRad;
      }
      if (right) {
        right.position.set(jawRight[0], jawRight[1], jawRight[2]);
        right.rotation.y = 0 - betaRad;
      }
    }
  });

  const lineXs = model.lineSensors.map((sensor) => sensor.position[0]);
  const lineZs = model.lineSensors.map((sensor) => sensor.position[2]);
  const bar =
    model.lineSensors.length === 0
      ? null
      : {
          x0: Math.min(...lineXs) - 0.008,
          x1: Math.max(body.lengthM / 2 + 0.007, Math.max(...lineXs) + 0.008),
          z0: Math.min(...lineZs) - 0.009,
          z1: Math.max(...lineZs) + 0.009,
          y: Math.min(body.bottomM - 0.002, Math.max(...model.lineSensors.map((sensor) => sensor.position[1])) + 0.004),
        };

  return (
    <group ref={robot} name="robot">
      {/* Chassis, with a darker deck on top. */}
      <mesh geometry={chassis} position={[0, body.bottomM, 0]} castShadow={shadows}>
        <meshStandardMaterial color={colors.chassis} roughness={0.55} />
      </mesh>
      <mesh position={[0, deck + 0.0006, 0]} receiveShadow={shadows}>
        <boxGeometry args={[body.lengthM - 0.014, 0.0012, body.widthM - 0.014]} />
        <meshStandardMaterial color={colors.chassisTrim} roughness={0.7} />
      </mesh>

      {/* The controller board on the rear of the deck, with its chips and pin headers: decoration, no vendor's look. */}
      <group position={[-body.lengthM / 4, deck + 0.0012, 0]}>
        <mesh position={[0, PCB / 2, 0]} castShadow={shadows}>
          <boxGeometry args={[body.lengthM / 2 - 0.006, PCB, body.widthM - 0.024]} />
          <meshStandardMaterial color={colors.board} roughness={0.6} />
        </mesh>
        <mesh position={[0.012, PCB + 0.0015, 0]}>
          <boxGeometry args={[0.012, 0.003, 0.009]} />
          <meshStandardMaterial color={colors.chip} roughness={0.4} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0.006, PCB + 0.002, side * (body.widthM / 2 - 0.017)]}>
            <boxGeometry args={[body.lengthM / 2 - 0.02, 0.004, 0.0025]} />
            <meshStandardMaterial color={colors.pinHeader} roughness={0.5} />
          </mesh>
        ))}
      </group>

      {/* Wheels: a tyre, a hub and three spokes on the outer face, so that a turn of the wheel shows. */}
      {model.wheels.map((wheel, i) => (
        <group key={wheel.role} position={wheel.position as [number, number, number]}>
          <group
            ref={(group) => {
              wheels.current[i] = group;
            }}
          >
            <mesh rotation-x={Math.PI / 2} castShadow={shadows}>
              <cylinderGeometry args={[wheel.radiusM, wheel.radiusM, wheel.widthM, 22]} />
              <meshStandardMaterial color={colors.tyre} roughness={0.92} />
            </mesh>
            <mesh rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[wheel.radiusM * 0.6, wheel.radiusM * 0.6, wheel.widthM + 0.001, 16]} />
              <meshStandardMaterial color={colors.hub} roughness={0.45} metalness={0.1} />
            </mesh>
            {[0, 1, 2].map((spoke) => (
              <mesh key={spoke} rotation-z={(spoke * 2 * Math.PI) / 3} position={[0, 0, wheel.outward * (wheel.widthM / 2 + 0.0008)]}>
                <boxGeometry args={[wheel.radiusM * 1.1, 0.0035, 0.0012]} />
                <meshStandardMaterial color={colors.spoke} roughness={0.5} />
              </mesh>
            ))}
          </group>
        </group>
      ))}

      {/* The ball caster under the nose, in its holder. */}
      {model.caster && (
        <group position={model.caster.position as [number, number, number]}>
          <mesh castShadow={shadows}>
            <sphereGeometry args={[model.caster.radiusM, 12, 8]} />
            <meshStandardMaterial color={colors.caster} roughness={0.3} metalness={0.5} />
          </mesh>
          <mesh position={[0, (body.bottomM - model.caster.position[1]) / 2 + model.caster.radiusM / 4, 0]}>
            <cylinderGeometry args={[model.caster.radiusM * 1.15, model.caster.radiusM * 1.15, Math.max(0.001, body.bottomM - model.caster.position[1] - model.caster.radiusM / 2), 10]} />
            <meshStandardMaterial color={colors.chip} roughness={0.6} />
          </mesh>
        </group>
      )}

      {/* The ultrasonic ranger on the front: its board and its two "eyes". */}
      {model.ultrasonics.map((sensor) => (
        <group key={sensor.role} position={sensor.position as [number, number, number]} rotation-y={sensor.yawRad}>
          <mesh position={[PCB / 2, 0, 0]} castShadow={shadows}>
            <boxGeometry args={[PCB, 0.02, 0.045]} />
            <meshStandardMaterial color={colors.sensorBoard} roughness={0.5} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[PCB + 0.006, 0, side * 0.013]} rotation-z={Math.PI / 2} castShadow={shadows}>
              <cylinderGeometry args={[0.008, 0.008, 0.012, 16]} />
              <meshStandardMaterial color={colors.sensorEye} roughness={0.35} metalness={0.4} />
            </mesh>
          ))}
        </group>
      ))}

      {/* The line sensors under the nose, on a bar whose front edge carries a lamp for each: lit red while it sees the line. */}
      {bar && (
        <mesh position={[(bar.x0 + bar.x1) / 2, bar.y, (bar.z0 + bar.z1) / 2]}>
          <boxGeometry args={[bar.x1 - bar.x0, PCB, bar.z1 - bar.z0]} />
          <meshStandardMaterial color={colors.board} roughness={0.6} />
        </mesh>
      )}
      {model.lineSensors.map((sensor, i) => (
        <group key={sensor.role}>
          <mesh position={[sensor.position[0], sensor.position[1] + 0.002, sensor.position[2]]}>
            <boxGeometry args={[0.009, 0.004, 0.007]} />
            <meshStandardMaterial color={colors.lineSensor} roughness={0.6} />
          </mesh>
          {bar && (
            <mesh position={[bar.x1 - 0.003, bar.y + PCB / 2 + 0.0012, sensor.position[2]]}>
              <sphereGeometry args={[0.0022, 10, 6]} />
              <meshStandardMaterial
                ref={(material) => {
                  lineLamps.current[i] = material;
                }}
                color={colors.lineSensorLight}
                roughness={0.3}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* Each servo: its hub on the deck and its arm, turned by the arm's angle. */}
      {model.servos.map((servo, i) => (
        <group key={servo.role} position={servo.position as [number, number, number]}>
          <mesh position={[0, (deck - servo.position[1]) / 2 + servo.arm.heightM / 4, 0]} castShadow={shadows}>
            <cylinderGeometry args={[0.006, 0.0068, Math.max(0.002, servo.position[1] + servo.arm.heightM / 2 - deck), 16]} />
            <meshStandardMaterial color={colors.servoBody} roughness={0.5} />
          </mesh>
          <group
            ref={(group) => {
              arms.current[i] = group;
            }}
          >
            <mesh position={[servo.arm.lengthM / 2, 0, 0]} castShadow={shadows}>
              <boxGeometry args={[servo.arm.lengthM, servo.arm.heightM, servo.arm.widthM]} />
              <meshStandardMaterial color={colors.servoArm} roughness={0.45} />
            </mesh>
            <mesh position={[servo.arm.lengthM, 0, 0]} castShadow={shadows}>
              <cylinderGeometry args={[servo.arm.widthM / 2, servo.arm.widthM / 2, servo.arm.heightM, 12]} />
              <meshStandardMaterial color={colors.servoArm} roughness={0.45} />
            </mesh>
          </group>
        </group>
      ))}

      {/* LEDs: a dome that lights up, with a glow around it. */}
      {model.leds.map((led, i) => (
        <group key={led.role} position={[led.position[0], deck + 0.0012 + PCB, led.position[2]]}>
          <mesh>
            <sphereGeometry args={[0.0042, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial
              ref={(material) => {
                ledLamps.current[i] = material;
              }}
              color={colors.ledOff}
              roughness={0.25}
            />
          </mesh>
          <mesh
            ref={(mesh) => {
              ledHalos.current[i] = mesh;
            }}
            visible={false}
          >
            <sphereGeometry args={[0.009, 14, 10]} />
            <meshBasicMaterial color={colors.ledOn} transparent opacity={0.28} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {/* Buzzers: a round can, with rings above it while it plays. */}
      {model.buzzers.map((buzzer, i) => (
        <group key={buzzer.role} position={[buzzer.position[0], deck + 0.0012 + PCB, buzzer.position[2]]}>
          <mesh position={[0, 0.004, 0]} castShadow={shadows}>
            <cylinderGeometry args={[0.0075, 0.0075, 0.008, 18]} />
            <meshStandardMaterial color={colors.buzzer} roughness={0.5} />
          </mesh>
          <group
            ref={(group) => {
              buzzerWaves.current[i] = group;
            }}
            visible={false}
            position={[0, 0.011, 0]}
          >
            {[0.011, 0.016].map((radius, ring) => (
              <mesh key={radius} rotation-x={-Math.PI / 2} position={[0, ring * 0.003, 0]}>
                <ringGeometry args={[radius - 0.0012, radius, 28]} />
                <meshBasicMaterial color={colors.buzzerWave} transparent opacity={ring === 0 ? 0.85 : 0.5} depthWrite={false} side={2} />
              </mesh>
            ))}
          </group>
        </group>
      ))}

      {/* N19 E6: the gripper: the boom's two plates and its bar, the level carriage with its claw servo, the two fingers. */}
      {model.gripper && (
        <>
          <group ref={gripperBoom} position={model.gripper.position as [number, number, number]}>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[model.gripper!.boomLengthM / 2, 0, side * model.gripper!.boomHalfSpanM]} castShadow={shadows}>
                <boxGeometry args={[model.gripper!.boomLengthM, 0.01, 0.004]} />
                <meshStandardMaterial color={colors.gripperMetal} roughness={0.35} metalness={0.6} />
              </mesh>
            ))}
            <mesh position={[model.gripper.boomLengthM, 0, 0]} rotation-x={Math.PI / 2} castShadow={shadows}>
              <cylinderGeometry args={[0.003, 0.003, 2 * model.gripper.boomHalfSpanM + 0.004, 12]} />
              <meshStandardMaterial color={colors.gripperMetal} roughness={0.35} metalness={0.6} />
            </mesh>
          </group>
          <group ref={gripperCarriage}>
            <mesh castShadow={shadows}>
              <boxGeometry args={[0.01, 0.012, 0.052]} />
              <meshStandardMaterial color={colors.chip} roughness={0.5} />
            </mesh>
            <mesh position={[-0.0012, 0.006 + 0.0114, 0]} castShadow={shadows}>
              <boxGeometry args={[0.0122, 0.0227, 0.0228]} />
              <meshStandardMaterial color={colors.gripperServo} roughness={0.4} />
            </mesh>
          </group>
          {[1, -1].map((side, i) => (
            <group
              key={side}
              ref={(group) => {
                gripperJaws.current[i] = group;
              }}
            >
              <mesh position={[model.gripper!.finger.lengthM / 2, 0, 0]} castShadow={shadows}>
                <boxGeometry args={[model.gripper!.finger.lengthM, model.gripper!.finger.heightM, model.gripper!.finger.thicknessM]} />
                <meshStandardMaterial color={colors.gripperMetal} roughness={0.35} metalness={0.6} />
              </mesh>
              <mesh position={[model.gripper!.finger.lengthM / 2 + 0.0005, 0, side * model.gripper!.finger.thicknessM * 0.3]}>
                <boxGeometry args={[model.gripper!.finger.lengthM - 0.01, model.gripper!.finger.heightM - 0.002, model.gripper!.finger.thicknessM * 0.45]} />
                <meshStandardMaterial color={colors.gripperPad} roughness={0.9} />
              </mesh>
            </group>
          ))}
        </>
      )}

      {/* Buttons: a base and a cap that goes down while the button is held. */}
      {model.buttons.map((button, i) => (
        <group key={button.role} position={[button.position[0], deck + 0.0012 + PCB, button.position[2]]}>
          <mesh position={[0, 0.002, 0]} castShadow={shadows}>
            <boxGeometry args={[0.012, 0.004, 0.012]} />
            <meshStandardMaterial color={colors.buttonBase} roughness={0.6} />
          </mesh>
          <mesh
            ref={(mesh) => {
              buttonCaps.current[i] = mesh;
            }}
            position={[0, 0.006, 0]}
          >
            <cylinderGeometry args={[0.0042, 0.0042, 0.003, 16]} />
            <meshStandardMaterial color={colors.buttonCap} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
