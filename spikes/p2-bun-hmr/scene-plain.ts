import { Graphics, type Application } from "pixi.js";

const PLAIN_COLOR = 0x33cc66;

export function mountPlain(app: Application): void {
  const gfx = new Graphics().circle(0, 0, 40).fill(PLAIN_COLOR);
  gfx.label = "plain-circle";
  gfx.position.set(320, 240);
  app.stage.addChild(gfx);
  console.log(`[p2] plain mounted color=${PLAIN_COLOR.toString(16)}`);
}
