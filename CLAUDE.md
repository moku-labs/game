# @moku-labs/game

2D puzzle game engine on TypeScript and PixiJS v8, built on @moku-labs/core.

## Package Manager

Use `bun` exclusively — never npm, yarn, or pnpm.

## Scripts

- `bun run build` — Build with tsdown
- `bun run lint` — Biome check + ESLint
- `bun run lint:fix` — Auto-fix lint issues
- `bun run format` — Format with Biome
- `bun run test` — Run all tests (vitest)
- `bun run test:unit` — Unit tests only
- `bun run test:integration` — Integration tests only
- `bun run test:coverage` — Tests with coverage

## Code Style

- **Formatter:** Biome (2-space indent, double quotes, semicolons, no trailing commas)
- **Linter:** ESLint 9 flat config + Biome (biome-config-biome must be LAST)
- **TypeScript:** Strict mode with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
- **Imports:** Use `import type` enforced via `@typescript-eslint/consistent-type-imports`
- **JSDoc:** Required on all source exports with descriptions, params, returns, and examples

## Packaging

- ESM only, `"sideEffects": false`. No CJS output.
- `pixi.js` v8 is a peer dependency. Rendering is WebGPU only.
- Everything a game imports comes from the root `@moku-labs/game`.

## Architecture

Three-layer Moku model:
1. `src/config.ts` — `createCoreConfig` (Layer 1: config + events)
2. `src/index.ts` — `createCore` (Layer 2: framework + plugins)
3. Consumer apps use `createApp` (Layer 3)

Plugins go in `src/plugins/`.

## Testing

- Vitest with unit + integration projects
- Framework-level tests: `tests/unit/` and `tests/integration/` (cross-plugin scenarios, createApp validation)
- Plugin-specific tests: `src/plugins/[name]/__tests__/unit/` and `__tests__/integration/` (colocated inside each plugin)
- 90% coverage threshold
- Never put plugin-specific tests in root `tests/` — root tests are for framework-level integration only

## Moku Development Toolkit

This project uses the **moku** Claude Code plugin. Talk to it in plain words — the `moku` conductor
skill works out where the project stands and drives the lifecycle (intake, brainstorm, design, plan,
build, verify, e2e, release, close). You never need to remember a command.

Underneath the conversation, `moku-rails` enforces the order: a source file cannot be written before
the station that is allowed to write it. When a write is refused, the reason names the missing step.

Useful directly:

- `/moku:status` — where the project stands.
- `/moku:check` — diagnostics on the installation and the project.
- `/moku:verify` — the validator fan-out with the auto-fix loop.
- `/moku:upgrade` — move the toolchain to the current target stack.

Knowledge skills load themselves when the topic comes up: **moku-core** (architecture, factory
chain, lifecycle, events), **moku-plugin** (plugin structure and tiers), **moku-common** (`ctx.log`,
`ctx.env`, the branded CLI), **moku-testing**, **moku-readable-code**, plus the framework pack for
whatever this project uses.

## Specification

For questions about how things should be implemented, refer to the [Moku Core specification](https://github.com/moku-labs/core/tree/main/specification).
