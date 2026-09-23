/**
 * @file ui/jsx — `lint()`: five rules read off the live screen. It never throws and answers an
 * empty list when nothing is mounted.
 */
import type { Message, Part } from "../../i18n/types";
import { Tappable } from "../../input/components";
import { LocalWrite } from "../components";
import type { UiCtx } from "../types";
import { fitScaleOf } from "../visual";
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
 * Checks the smallest side of a tappable element against the config, at the size it is drawn:
 * a `fit: "contain"` on the element or above it shrinks the target.
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

  const drawn = scale * fitScaleOf(element, entity => ctx.state.jsx.elements.get(entity));
  const width = element.rect.w * drawn;
  const height = element.rect.h * drawn;

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
 * Reports a clipping element (`scroll`, `overflow: "hidden"`) whose style names a nine-slice. The
 * clip is carried by the rectangle, so the nine-slice is never drawn: put it on the parent.
 *
 * @param element - The element to check.
 * @returns The finding, or `undefined`.
 * @example
 * ```ts
 * nineSliceClipped({ key: "list", type: "scroll", style: { nineSlice: "ui.strip" } } as Element);
 * // { rule: "nine-slice-clipped", key: "list", detail: "scroll" }
 * ```
 */
export function nineSliceClipped(element: Element): Finding | undefined {
  if (element.style.nineSlice === undefined) return undefined;
  if (element.type !== "scroll" && element.style.overflow !== "hidden") return undefined;

  return { rule: "nine-slice-clipped", key: nameOf(element), detail: element.type };
}

/**
 * Reports a root element whose style sets a `zIndex`: a root draws at the order of its layer,
 * so the value is ignored.
 *
 * @param element - The element to check.
 * @returns The finding, or `undefined`.
 * @example
 * ```ts
 * zIndexOnRoot({ key: "board", parent: undefined, style: { zIndex: 2 } } as Element);
 * // { rule: "z-index-on-root", key: "board", detail: "zIndex 2" }
 * ```
 */
export function zIndexOnRoot(element: Element): Finding | undefined {
  if (element.parent !== undefined || element.style.zIndex === undefined) return undefined;

  return {
    rule: "z-index-on-root",
    key: nameOf(element),
    detail: `zIndex ${element.style.zIndex}`
  };
}

/**
 * Runs the five rules over every live element.
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
      absoluteWithoutReason(element),
      nineSliceClipped(element),
      zIndexOnRoot(element)
    ]) {
      if (finding !== undefined) findings.push(finding);
    }
  }

  return findings;
}
