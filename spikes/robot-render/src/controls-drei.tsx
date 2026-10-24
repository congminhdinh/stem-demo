// Variant A: OrbitControls from @react-three/drei (it wraps three-stdlib's OrbitControls).
import { OrbitControls } from '@react-three/drei';

export function Controls() {
  return <OrbitControls makeDefault enableDamping target={[0, 0, 0]} minDistance={0.6} maxDistance={4} maxPolarAngle={Math.PI / 2.05} />;
}
