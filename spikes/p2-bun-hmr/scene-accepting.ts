import { Container, Graphics, type Application } from "pixi.js";
import { cycleA } from "./cycle-a";
import { pulse } from "./data-only";

const COLOR = 0xff3366;

type G = { __spike?: { app: Application; frames: number; bootId: string } };
let root: Container | undefined;
let tick: (() => void) | undefined;
let mountedApp: Application | undefined;

export function mountAccepting(app: Application): void {
  mountedApp = app;
  root = new Container();
  root.label = "accepting-root";
  for (let i = 0; i < 3; i++) {
    const gfx = new Graphics().rect(0, 0, 60, 60).fill(COLOR);
    gfx.position.set(40 + i * 90, 40);
    root.addChild(gfx);
  }
  app.stage.addChild(root);
  let t = 0;
  tick = () => {
    t += 1 / pulse.durationFrames;
    root!.alpha = pulse.from + (pulse.to - pulse.from) * Math.abs(Math.sin(t * Math.PI));
  };
  app.ticker.add(tick);
  const s = (globalThis as G).__spike;
  console.log(
    `[p2] accepting mounted color=${COLOR.toString(16)} cycle=${cycleA()} pulse=${JSON.stringify(pulse)} frames=${s?.frames} boot=${s?.bootId} stageChildren=${app.stage.children.length}`,
  );
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    if (mountedApp && root) {
      if (tick) mountedApp.ticker.remove(tick);
      mountedApp.stage.removeChild(root);
      root.destroy({ children: true });
      console.log("[p2] accepting disposed");
    }
    import.meta.hot.data.wasMounted = Boolean(mountedApp);
  });
  if (import.meta.hot.data.wasMounted) {
    const s = (globalThis as G).__spike;
    if (s) mountAccepting(s.app);
  }
}
