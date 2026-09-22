import biomeConfig from "eslint-config-biome";
import jsdocPlugin from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

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
      "**/generated/**"
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
      // An example is required only where a game reads it: see block 6d.
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
    files: ["src/plugins/**/types.ts"],
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

  // 6b2. The asset scanner is build-time code: only its own entry file may import it.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/assets.ts", "src/plugins/assets/scan/**", "src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/assets/scan/**", "./scan/**", "../scan/**"],
              message: "The asset scanner is node-only. Only src/assets.ts imports it."
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
          paths: [
            {
              name: "pixi.js",
              allowTypeImports: true,
              message: "Load Pixi lazily with import() in renderer onStart. Types may be imported."
            },
            {
              name: "yoga-layout",
              allowTypeImports: true,
              message: "Load Yoga lazily with import() in ui onStart. Types may be imported."
            }
          ]
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
            "Program > :matches(VariableDeclaration, ExportNamedDeclaration) NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]",
          message: "No module-scope collections."
        }
      ]
    }
  },

  // 6d. L1 — a module of model or flow imports a sibling module only as `import type` from its types.ts.
  {
    files: [
      "src/plugins/model/*/**/*.ts",
      "src/plugins/flow/*/**/*.ts",
      "src/plugins/world/*/**/*.ts",
      "src/plugins/renderer/*/**/*.ts"
    ],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^\.\./(store|rng|features|fx|gate|inbox|runner|ecs|projection|host|sync|viewport)/(?!types$)`,
              message:
                "Modules do not import each other's run-time code. index.ts injects sibling APIs."
            },
            {
              regex: String.raw`^\.\./(store|rng|features|fx|gate|inbox|runner|ecs|projection|host|sync|viewport)/types$`,
              allowTypeImports: true,
              message: "Import a sibling module's types with `import type` only."
            }
          ]
        }
      ]
    }
  },

  // 6e. L3 — determinism: no device clock, timers or unseeded randomness in the logic set.
  {
    files: [
      "src/plugins/model/**/*.ts",
      "src/plugins/flow/**/*.ts",
      "src/plugins/world/**/*.ts",
      "src/plugins/renderer/**/*.ts",
      "src/plugins/clock/**/*.ts",
      "tests/integration/merge-game/rules/**/*.ts"
    ],
    ignores: [
      "src/plugins/clock/system.ts",
      "src/**/__tests__/**",
      "tests/integration/merge-game/rules/__tests__/**"
    ],
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
            "Program > :matches(VariableDeclaration, ExportNamedDeclaration) NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]",
          message: "No module-scope collections."
        }
      ]
    }
  },

  // 6f. L4 — the rules of the fixture merge game import nothing but their siblings, so they stay
  // a model of pure game rules.
  {
    files: ["tests/integration/merge-game/rules/**/*.ts"],
    ignores: ["tests/integration/merge-game/rules/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^(\.\./|@moku-labs/|pixi\.js$|yoga-layout$)`,
              message: "The fixture rules import only their siblings."
            }
          ]
        }
      ]
    }
  },

  // 7. Test files: relaxed rules
  {
    files: ["tests/**/*.ts", "src/plugins/**/__tests__/**/*.ts"],
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
