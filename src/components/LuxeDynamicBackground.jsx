import { lazy, Suspense } from 'react';
import './GradientWaves.css';

const GradientWaves = lazy(() => import('./GradientWaves'));

export default function LuxeDynamicBackground({ className = '' }) {
  return (
    <Suspense fallback={<div className={`gradient-waves-container gradient-waves-fallback ${className}`.trim()} aria-hidden="true" />}>
      <GradientWaves
        className={className}
        horizonColor="#2B1F1A"
        waveColor="#D9B771"
        crestColor="#F9F1E3"
        speed={0.38}
        amplitude={2.8}
        waveScale={0.58}
        waveRatio={0.82}
        swell={26}
        turbulence={18}
        tilt={1.15}
        zoom={1.08}
        height={5.2}
        fogDepth={18}
        detail="medium"
        brightness={1.08}
        opacity={0.92}
        mouseInteraction
        parallaxStrength={0.42}
        grain
        grainIntensity={0.035}
      />
    </Suspense>
  );
}
