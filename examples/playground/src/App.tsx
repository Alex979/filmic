import { useEffect } from "react";
import { createControls } from "./controls";
import { Demo } from "./Demo";
import { canvas2dDemo } from "./demos/canvas2d";
import { gradientDemo } from "./demos/gradient";
import { mediaDemo } from "./demos/media";
import { threeDemo } from "./demos/three";
import { videoDemo } from "./demos/video";

export default function App() {
  useEffect(() => {
    const gui = createControls();
    return () => gui.destroy();
  }, []);

  return (
    <main>
      <header>
        <h1>filmic playground</h1>
        <p>
          Different sources through the same film. Every card sizes with the
          window; the panel tunes them all at once.
        </p>
      </header>
      <div className="grid">
        <Demo
          wide
          title="Image"
          note="An <img> via elementSource. Drop your own photo or video on it."
          create={mediaDemo}
          fits
          droppable
        />
        <Demo
          title="Shader"
          note="A procedural shaderSource: renders at any size."
          create={gradientDemo}
        />
        <Demo
          title="2D canvas"
          note="Animated by its own loop, filmed with live: true."
          create={canvas2dDemo}
          fits
        />
        <Demo
          title="Video"
          note="A 4:3, 24 fps <video>: redraws once per video frame."
          create={videoDemo}
          fits
        />
        <Demo
          title="Three.js"
          note="A WebGL canvas (preserveDrawingBuffer), filmed live."
          create={threeDemo}
          fits
        />
      </div>
    </main>
  );
}
