import { expectTypeOf } from "vitest";
import type { Json } from "../../../model/types";
import { guide, schedule } from "../../fx/descriptors";
import { defineEffect } from "../../fx/effect";
import type { Descriptor, FxApi, NodeFx } from "../../fx/types";
import type { Answer } from "../../gate/types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. `fx` is the `fx` of a node context.
// ---------------------------------------------------------------------------

declare const fx: NodeFx;
declare const gateway: FxApi;

type EnvRead = { reducedMotion: boolean; saveFallback: boolean };

// ─── a descriptor written by hand stays unknown ───────────────

expectTypeOf(fx({ kind: "drop", payload: { cell: "c3" } })).toEqualTypeOf<Promise<unknown>>();

// ─── the flow helpers resolve nothing ─────────────────────────

expectTypeOf(fx(schedule(1))).toEqualTypeOf<Promise<void>>();
expectTypeOf(fx(guide({ allow: { intent: "ok" } }))).toEqualTypeOf<Promise<void>>();

// ─── defineEffect: the awaited type follows the declaration ───

const envRead = defineEffect<{ notice: boolean }, EnvRead>("view-env.read", { fast: "run" });
const skipped = defineEffect<{ notice: boolean }, EnvRead>("view-env.skip", { fast: "skip" });
const undeclared = defineEffect<{ notice: boolean }, EnvRead>("view-env.plain");
const cosmetic = defineEffect<{ notice: boolean }, EnvRead>("view-env.cosmetic", {
  fast: "run",
  cosmetic: true
});

expectTypeOf(fx(envRead({ notice: true }))).toEqualTypeOf<Promise<EnvRead>>();
expectTypeOf(fx(skipped({ notice: true }))).toEqualTypeOf<Promise<EnvRead | undefined>>();
expectTypeOf(fx(undeclared({ notice: true }))).toEqualTypeOf<Promise<EnvRead | undefined>>();
expectTypeOf(fx(cosmetic({ notice: true }))).toEqualTypeOf<Promise<EnvRead | undefined>>();
expectTypeOf(envRead.kind).toEqualTypeOf<string>();

// @ts-expect-error — the payload is { notice: boolean }, so a string does not fit.
envRead({ notice: "yes" });

// @ts-expect-error — an effect with a payload needs it.
envRead();

// ─── an effect without a payload takes no argument ────────────

const ping = defineEffect<void, number>("view-env.ping", { fast: "run" });

expectTypeOf(fx(ping())).toEqualTypeOf<Promise<number>>();
expectTypeOf<Parameters<typeof ping>>().toEqualTypeOf<[]>();

// @ts-expect-error — a void effect takes no payload.
ping({ at: 1 });

// ─── the payload is JSON: a descriptor crosses the journal ────

/** Not JSON: an interface has no index signature, and a function is no value of a save. */
interface NotJson {
  notice: boolean;
}

// @ts-expect-error — an interface is not a JSON payload.
defineEffect<NotJson, EnvRead>("view-env.interface");

// ─── the handler returns the declared result ──────────────────

envRead.handle(gateway, payload => ({ reducedMotion: payload.notice, saveFallback: false }));
envRead.handle(gateway, async () => ({ reducedMotion: false, saveFallback: true }));
ping.handle(gateway, (payload, { mode }) => {
  expectTypeOf(payload).toEqualTypeOf<void>();

  return mode === "fast" ? 0 : 1;
});

// @ts-expect-error — the result is a number, not a string.
ping.handle(gateway, () => "one");

// ─── a typed descriptor goes wherever a descriptor goes ───────

fx.start(envRead({ notice: true }));
gateway.dispatch(envRead({ notice: true }));

const loose: Descriptor = envRead({ notice: true });

expectTypeOf(loose).toEqualTypeOf<Descriptor<unknown>>();

// @ts-expect-error — a descriptor of one result is not a descriptor of another.
const wrongResult: Descriptor<string> = envRead({ notice: true });

expectTypeOf(wrongResult).toEqualTypeOf<Descriptor<string>>();

// ─── Answer keeps its default ─────────────────────────────────

expectTypeOf<Answer>().toEqualTypeOf<{ intent: string; payload?: Json }>();
expectTypeOf<Answer<"again">["intent"]>().toEqualTypeOf<"again">();
