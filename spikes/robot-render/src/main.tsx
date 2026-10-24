// Spike entry (N18 R0.2). The 3D code is a separate chunk behind React.lazy, like the real lab's.
//   ?tier=high|low  &aa=0|1 (default: 1 for high, 0 for low)  &run=1 (replay at once; otherwise idle, frameloop="demand")
//   &extra=N (stress test: N extra robots)
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import type { Tier } from './Lab';

const params = new URLSearchParams(location.search);
const tier: Tier = params.get('tier') === 'low' ? 'low' : 'high';
const antialias = params.has('aa') ? params.get('aa') === '1' : tier === 'high';
const extra = Number(params.get('extra') ?? 0);
const controlsName = __CONTROLS__;

const Lab = lazy(() => {
  window.__spikeMarks = { importStart: performance.now() };
  return import('./Lab').then((module) => {
    window.__spikeMarks!.importEnd = performance.now();
    return module;
  });
});

document.getElementById('label')!.textContent = `tier: ${tier} · aa: ${antialias ? 'on' : 'off'} · controls: ${controlsName} · extra: ${extra}`;

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={null}>
    <Lab tier={tier} antialias={antialias} autoRun={params.get('run') === '1'} controlsName={controlsName} extra={extra} />
  </Suspense>,
);
