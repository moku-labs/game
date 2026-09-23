/**
 * @file The dev flag of the fixture page. `web/main.ts` imports this module first, so the flag is
 * set before the engine runs: the `/control` commands of the editor and the e2e station work on
 * this page. The fixture never re-declares the global; the engine declares it.
 */
globalThis.__MOKU_GAME_DEV__ = true;
