// Variant B: three's own OrbitControls (three/examples/jsm), wired by hand: ~20 lines, no drei.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function Controls() {
  const camera = useThree((state) => state.camera);
  const dom = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useMemo(() => {
    const created = new OrbitControls(camera, dom);
    created.enableDamping = true;
    created.minDistance = 0.6;
    created.maxDistance = 4;
    created.maxPolarAngle = Math.PI / 2.05;
    return created;
  }, [camera, dom]);
  useEffect(() => {
    // frameloop="demand": a drag or a damping step must request a frame.
    const onChange = () => invalidate();
    controls.addEventListener('change', onChange);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.dispose();
    };
  }, [controls, invalidate]);
  useFrame(() => controls.update(), -1);
  return null;
}
