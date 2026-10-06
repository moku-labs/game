import biomeConfig from "eslint-config-biome";
import jsdocPlugin from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

// L2 — no static Pixi, Yoga, Playwright or TypeScript import. Blocks 6c and 6d2 both set
// `@typescript-eslint/no-restricted-imports`, and a later block replaces the whole rule, so both carry these paths.
const l2Paths = [
  {
    name: "pixi.js",
    allowTypeImports: true,
    message: "Load Pixi lazily with import() in renderer onStart. Types may be imported."
  },
  {
    name: "yoga-layout",
    allowTypeImports: true,
    message: "Load Yoga lazily with import() in ui onStart. Types may be imported."
  },
  {
    name: "playwright-core",
    message:
      "playwright-core is an optional peer. Load it with await import() in src/visual/leg-browser.ts only."
  },
  {
    name: "typescript",
    allowTypeImports: true,
    message:
      "typescript is an optional peer. Load it with await import() in src/project/typescript.ts only."
  }
];

export default [
  // 1. Global ignores
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "bun.lock",
      ".claude/**",
      ".planning/**",
      "node_modules/**",
      // Throwaway prototypes: outside lint, coverage and the published package.
      "spikes/**",
      "declarations.d.ts",
      // Tool output: the asset scanner and compileStrings write these files.
      "**/generated/**",
      // Build output of the mini game: the pack of `bun run mini:pack`.
      "tests/fixtures/mini-game/dist/**",
      // A v15-layout game for the project index and the lint e2e: its own tsconfig `paths`.
      "tests/fixtures/layout-game/**"
    ]
  },

  // 2. TypeScript parser for all TS files
  tseslint.configs.base,

  // 3. Unicorn recommended + abbreviation allowlist
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      "unicorn/prevent-abbreviations": [
        "error",
        {
          // Pre-expanded so builds don't have to widen this mid-flight. See references/glossary.md.
          allowList: {
            ctx: true,
            fn: true,
            cb: true,
            ref: true,
            args: true,
            params: true,
            props: true,
            env: true,
            i18n: true,
            l10n: true,
            spa: true,
            ssg: true,
            ssr: true,
            seo: true,
            api: true,
            dev: true,
            // The dev flag reader of the editor doors (delta D1 names it).
            isDev: true,
            prod: true,
            md: true,
            dir: true,
            doc: true,
            docs: true,
            db: true,
            util: true,
            utils: true,
            pkg: true,
            src: true,
            dist: true,
            config: true,
            cfg: true,
            e2e: true,
            cli: true,
            dom: true,
            css: true,
            html: true,
            url: true,
            uri: true,
            str: true,
            num: true,
            msg: true,
            err: true,
            req: true,
            res: true,
            opts: true,
            attr: true
          },
          // The allow list is case-sensitive: type names such as TimeCtx and SaveDoc need this.
          replacements: { ctx: false, doc: false }
        }
      ]
    }
  },

  // 4. SonarJS recommended
  // NOTE: The `!` non-null assertion is required because sonarjs types mark `configs` as
  // potentially undefined, but the `recommended` preset always exists at runtime.
  // biome-ignore lint/style/noNonNullAssertion: sonarjs types mark configs as possibly undefined but it exists at runtime
  sonarjs.configs!.recommended,

  // 5. JSDoc TypeScript preset
  jsdocPlugin.configs["flat/recommended-typescript-error"],

  // 5b. JSDoc style overrides
  {
    rules: {
      "jsdoc/no-types": "off",
      "jsdoc/tag-lines": ["error", "never", { startLines: 1 }]
    }
  },

  // 6. Source files: strict JSDoc requirements
  {
    files: ["src/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            // API methods are documented on the members of the public `Api` types, not on the
            // arrow functions that implement them.
            ArrowFunctionExpression: false,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true
          },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]
        }
      ],
      "jsdoc/require-description": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      // An example is required only where a game reads it: see block 6d (L7).
      "jsdoc/require-example": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "unicorn/require-module-specifiers": "off"
    }
  },

  // 6b. L6 — plugin wiring files: small inline arrows (events, onStop, composed api) need no JSDoc.
  {
    files: ["src/plugins/*/index.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            ArrowFunctionExpression: false,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true
          },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]
        }
      ]
    }
  },

  // 6d. L7 — the public contract carries the docs and a scenario example. Only `types.ts` ships in
  // the `.d.mts`, so a game reads the members of the `…Api` types, never the implementation. API means
  // public: a member another plugin calls gets an example from that plugin's point of view; a member
  // nobody can write an honest example for leaves the API (a plain function) or is deleted. Everywhere
  // else an example is allowed, never required: a required one becomes a copy of the signature.
  {
    files: ["src/plugins/**/types.ts", "src/project/types.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true },
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "TSTypeAliasDeclaration[id.name=/Api$/] > TSTypeLiteral > TSMethodSignature"
          ]
        }
      ],
      "jsdoc/require-example": [
        "error",
        {
          contexts: ["TSTypeAliasDeclaration[id.name=/Api$/] > TSTypeLiteral > TSMethodSignature"]
        }
      ]
    }
  },

  // 6e. L8 — no signature echo: an example whose whole body is one call with bare identifiers
  // (`shut(gate);`, `const api = createClockApi(ctx);`) tells the reader nothing.
  {
    files: ["src/**/*.ts"],
    rules: {
      "jsdoc/match-description": [
        "error",
        {
          mainDescription: false,
          // The default reads functions only: an echo on a member of an `Api` type would pass.
          contexts: ["any"],
          tags: {
            example:
              "^(?!\\s*```ts\\n\\s*(?:(?:const|let) \\w+(?:: [\\w.<>\\[\\]]+)? = )?(?:await )?[\\w.]+\\((?:[\\w.]+(?:, [\\w.]+)*)?\\);?\\s*```\\s*$)[\\s\\S]+$"
          }
        }
      ]
    }
  },

  // 6b2. The asset scanner and the string compiler are build-time code: only the node door
  // `src/assets.ts` (and the scanner's CLI, which chains the compiler) may import them (L10).
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/assets.ts",
      "src/plugins/assets/scan/**",
      "src/plugins/i18n/compile/**",
      "src/**/__tests__/**"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/assets/scan/**", "./scan/**", "../scan/**"],
              message: "The asset scanner is node-only. Only src/assets.ts imports it."
            },
            {
              group: ["**/i18n/compile/**", "./compile/**", "../compile/**"],
              message:
                "The string compiler is node-only. Only src/assets.ts and the assets CLI import it."
            }
          ]
        }
      ]
    }
  },

  // 6b5. L11 — `sharp` and `maxrects-packer`, the two packages of the production packer, are
  // imported only under `src/plugins/assets/scan/pack/**`, so no browser bundle can reach them.
  // A rule of its own: `no-restricted-imports` carries L9, L10 and L12, and a later block that
  // sets it again replaces their patterns as a whole.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/plugins/assets/scan/pack/**", "src/**/__tests__/**"],
    plugins: {
      l11: {
        rules: {
          "packer-imports": {
            meta: {
              type: "problem",
              schema: [],
              messages: {
                packer:
                  "sharp and maxrects-packer are build-time only. Import them under src/plugins/assets/scan/pack/."
              }
            },
            create: (
              context: import("eslint").Rule.RuleContext
            ): import("eslint").Rule.RuleListener => {
              const check = (
                node: import("estree").Node,
                source: import("estree").Node | null | undefined
              ): void => {
                const name = source?.type === "Literal" ? source.value : undefined;

                if (typeof name === "string" && /^(?:sharp|maxrects-packer)(?:\/|$)/.test(name)) {
                  context.report({ node, messageId: "packer" });
                }
              };

              return {
                ImportDeclaration: node => check(node, node.source),
                ImportExpression: node => check(node, node.source),
                ExportAllDeclaration: node => check(node, node.source),
                ExportNamedDeclaration: node => check(node, node.source)
              };
            }
          }
        }
      }
    },
    rules: { "l11/packer-imports": "error" }
  },

  // 6b6. L13 — the engine never imports a native package: `@moku-labs/system`, `@moku-labs/native`
  // and `@tauri-apps/*` are reached by the game through the `PlatformProvider` it builds in the
  // application layer. Every file under `src/`, tests included, and type imports too. A rule of its
  // own for the same reason as L11.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      l13: {
        rules: {
          "native-imports": {
            meta: {
              type: "problem",
              schema: [],
              messages: {
                native:
                  "The engine never imports @moku-labs/system, @moku-labs/native or @tauri-apps/*. The game passes a PlatformProvider in pluginConfigs.platform."
              }
            },
            create: (
              context: import("eslint").Rule.RuleContext
            ): import("eslint").Rule.RuleListener => {
              const check = (
                node: import("estree").Node,
                source: import("estree").Node | null | undefined
              ): void => {
                const name = source?.type === "Literal" ? source.value : undefined;

                if (
                  typeof name === "string" &&
                  /^(?:@moku-labs\/(?:system|native)(?:\/|$)|@tauri-apps\/)/.test(name)
                ) {
                  context.report({ node, messageId: "native" });
                }
              };

              return {
                ImportDeclaration: node => check(node, node.source),
                ImportExpression: node => check(node, node.source),
                ExportAllDeclaration: node => check(node, node.source),
                ExportNamedDeclaration: node => check(node, node.source)
              };
            }
          }
        }
      }
    },
    rules: { "l13/native-imports": "error" }
  },

  // 6b3. L9 — the JSX runtime module is reached only through the two entry files, and they
  // import nothing else.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/jsx-runtime.ts",
      "src/jsx-dev-runtime.ts",
      "src/plugins/ui/**",
      "src/**/__tests__/**"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ui/jsx/runtime", "./runtime", "../jsx/runtime"],
              message:
                "The JSX runtime is reached through src/jsx-runtime.ts and src/jsx-dev-runtime.ts only."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^(?!\./plugins/ui/jsx/runtime$).*`,
              message: "An entry file re-exports the runtime and nothing else."
            }
          ]
        }
      ]
    }
  },

  // 6b4. L12 — the visual test runner `src/visual/` is node-only and reaches the whole `/control`
  // catalogue: only the door `src/visual.ts` imports it. The project index `src/project/` is
  // node-only too: only the door `src/project.ts` imports it. A later block replaces the whole rule,
  // so the patterns these files carry now are repeated: L9's outside `ui`, L10's inside it.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/visual.ts",
      "src/visual/**",
      "src/project.ts",
      "src/project/**",
      "src/jsx-runtime.ts",
      "src/jsx-dev-runtime.ts",
      "src/plugins/ui/**",
      "src/**/__tests__/**"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ui/jsx/runtime", "./runtime", "../jsx/runtime"],
              message:
                "The JSX runtime is reached through src/jsx-runtime.ts and src/jsx-dev-runtime.ts only."
            },
            {
              group: ["**/visual/**"],
              message: "The visual test runner is node-only. Only src/visual.ts imports it."
            },
            {
              group: ["**/project/**"],
              message: "The project index is node-only. Only src/project.ts imports it."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/plugins/ui/**/*.ts"],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/assets/scan/**", "./scan/**", "../scan/**"],
              message: "The asset scanner is node-only. Only src/assets.ts imports it."
            },
            {
              group: ["**/i18n/compile/**", "./compile/**", "../compile/**"],
              message:
                "The string compiler is node-only. Only src/assets.ts and the assets CLI import it."
            },
            {
              group: ["**/visual/**"],
              message: "The visual test runner is node-only. Only src/visual.ts imports it."
            },
            {
              group: ["**/project/**"],
              message: "The project index is node-only. Only src/project.ts imports it."
            }
          ]
        }
      ]
    }
  },

  // 6c. L2 + L5 — no static Pixi or Yoga import; no module-scope state.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: l2Paths
        }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program > VariableDeclaration[kind='let']",
          message: "No module-scope state."
        },
        {
          selector:
            "Program > VariableDeclaration > VariableDeclarator > NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]",
          message: "No module-scope collections."
        },
        {
          selector:
            "Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]",
          message: "No module-scope collections."
        }
      ]
    }
  },

  // 6d2. L1 — a module of model or flow imports a sibling module only as `import type` from its types.ts.
  // It sets the rule 6c sets, so it carries the L2 paths again.
  {
    files: [
      "src/plugins/model/*/**/*.ts",
      "src/plugins/flow/*/**/*.ts",
      "src/plugins/world/*/**/*.ts",
      "src/plugins/renderer/*/**/*.ts",
      "src/plugins/anim/*/**/*.ts",
      "src/plugins/ui/*/**/*.ts",
      "src/plugins/effects/*/**/*.ts"
    ],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: l2Paths,
          patterns: [
            {
              regex: String.raw`^\.\./(store|rng|features|fx|gate|inbox|runner|ecs|projection|host|sync|viewport|tween|timeline|jsx|styles|layout)/(?!types$)`,
              message:
                "Modules do not import each other's run-time code. index.ts injects sibling APIs."
            },
            {
              regex: String.raw`^\.\./(store|rng|features|fx|gate|inbox|runner|ecs|projection|host|sync|viewport|tween|timeline|jsx|styles|layout)/types$`,
              allowTypeImports: true,
              message: "Import a sibling module's types with `import type` only."
            }
          ]
        }
      ]
    }
  },

  // 6e2. L3 — determinism: no device clock, timers or unseeded randomness in the logic set.
  {
    files: [
      "src/plugins/model/**/*.ts",
      "src/plugins/flow/**/*.ts",
      "src/plugins/world/**/*.ts",
      "src/plugins/renderer/**/*.ts",
      "src/plugins/anim/**/*.ts",
      "src/plugins/effects/**/*.ts",
      "src/plugins/clock/**/*.ts"
    ],
    ignores: ["src/plugins/clock/system.ts", "src/**/__tests__/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Use clock.now(), delivered as a node input." },
        { object: "performance", property: "now", message: "Use clock.now()." },
        { object: "Math", property: "random", message: "Use an rng stream." }
      ],
      "no-restricted-globals": [
        "error",
        { name: "setTimeout", message: "Use clock.scheduleAt through the schedule effect." },
        { name: "setInterval", message: "Use clock.scheduleAt through the schedule effect." }
      ],
      // A later block replaces the whole rule, so the two module-scope selectors of 6c are repeated.
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "Use clock.now()." },
        {
          selector: "Program > VariableDeclaration[kind='let']",
          message: "No module-scope state."
        },
        {
          selector:
            "Program > VariableDeclaration > VariableDeclarator > NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]",
          message: "No module-scope collections."
        },
        {
          selector:
            "Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]",
          message: "No module-scope collections."
        }
      ]
    }
  },

  // 7. Test files: relaxed rules
  {
    files: ["tests/**/*.{ts,tsx}", "src/plugins/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-example": "off",
      "unicorn/no-useless-undefined": "off",
      "sonarjs/no-duplicate-string": "off",
      "unicorn/prevent-abbreviations": "off"
    }
  },

  // 8. Config files: relaxed rules
  {
    files: ["*.config.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "unicorn/no-abusive-eslint-disable": "off"
    }
  },

  // 9. MUST be last: eslint-config-biome disables rules Biome handles
  biomeConfig
];
