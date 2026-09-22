/**
 * @file ui/jsx — `lint()`: three rules read off the live screen. It never throws and answers an
 * empty list when nothing is mounted.
 */
import type { Message, Part } from "../../i18n/types";
import { Tappable } from "../../input/components";
import { LocalWrite } from "../components";
import type { UiCtx } from "../types";
import type { Element, Finding } from "./types";

/**
 * The name a finding reports an element under: its key, or its type when it has none.
 *
 * @param element - The element the rule fired on.
 * @returns The name for the finding.
 * @example
 * ```ts
 * nameOf({ key: "claim", type: "button" } as Element); // "claim"
 * ```
 */
export function nameOf(element: Element): string {
  return element.key ?? element.type;
}

/**
 * Checks the smallest side of a tappable element against the config.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element to check.
 * @param scale - CSS pixels per reference unit.
 * @returns The finding, or `undefined`.
 */
function tapTarget(ctx: UiCtx, element: Element, scale: number): Finding | undefined {
  const ecs = ctx.deps.world.ecs;
  const tappable = ecs.has(element.entity, Tappable) || ecs.has(element.entity, LocalWrite);

  if (!tappable) return undefined;

  const width = element.rect.w * scale;
  const height = element.rect.h * scale;

  if (width >= ctx.config.tapTargetPt && height >= ctx.config.tapTargetPt) return undefined;

  return {
    rule: "tap-target",
    key: nameOf(element),
    detail: `${Math.round(width)} x ${Math.round(height)} pt`
  };
}

/**
 * Formats a message in one locale, when that locale can be read now.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param message - The message of the text.
 * @param locale - A registered locale.
 * @returns The parts, or `undefined` while the locale is registered but not loaded yet.
 */
function formatIfLoaded(ctx: UiCtx, message: Message, locale: string): readonly Part[] | undefined {
  try {
    return ctx.deps.i18n.format(message, locale);
  } catch {
    return undefined;
  }
}

/**
 * Measures a text in every loaded locale and reports the widest one that does not fit. A lazy
 * locale the player has not picked yet cannot be measured, so it is skipped.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The text element.
 * @returns The finding, or `undefined`.
 */
function textOverflow(ctx: UiCtx, element: Element): Finding | undefined {
  if (element.type !== "text") return undefined;

  const content = element.node.props.content;
  const style = typeof element.node.props.style === "string" ? element.node.props.style : "body";

  if (typeof content !== "object" || content === null) return undefined;

  for (const locale of ctx.deps.i18n.locales()) {
    const parts = formatIfLoaded(ctx, content as Message, locale);

    if (parts === undefined) continue;

    const joined = parts.map(part => (part.kind === "text" ? part.text : "")).join("");
    const size = ctx.deps.text.measure(joined, style);

    if (size.width <= element.rect.w && size.height <= element.rect.h) continue;

    return {
      rule: "text-overflow",
      key: nameOf(element),
      detail: `${locale}: ${Math.round(size.width)} x ${Math.round(size.height)}`
    };
  }

  return undefined;
}

/**
 * Reports an absolute element with no `reason` next to it.
 *
 * @param element - The element to check.
 * @returns The finding, or `undefined`.
 */
function absoluteWithoutReason(element: Element): Finding | undefined {
  if (element.style.position !== "absolute") return undefined;
  if (typeof element.style.reason === "string" && element.style.reason.length > 0) return undefined;

  return { rule: "absolute-without-reason", key: nameOf(element), detail: element.type };
}

/**
 * Runs the three rules over every live element.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns One finding per rule and element, in element order.
 */
export function runLint(ctx: UiCtx): readonly Finding[] {
  const findings: Finding[] = [];
  const scale = ctx.deps.renderer.viewport.size().scale;

  for (const element of ctx.state.jsx.elements.values()) {
    if (!element.live) continue;

    for (const finding of [
      tapTarget(ctx, element, scale),
      textOverflow(ctx, element),
      absoluteWithoutReason(element)
    ]) {
      if (finding !== undefined) findings.push(finding);
    }
  }

  return findings;
}
