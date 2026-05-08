/**
 * Prettier Configuration for Uptime Panda
 *
 * NOTE: Prettier is now scoped to .vue files ONLY.
 * All other file types (JS, TS, JSON, CSS, SCSS) are formatted by Biome.
 * Biome does not have stable .vue support yet, so Prettier handles .vue formatting.
 *
 * Usage:
 *   npm run fmt:vue              - Format .vue files (Prettier)
 *   npm run fmt                  - Format all files (Biome for JS/TS/CSS/JSON + Prettier for .vue)
 *
 * TIP: This formatter is automatically run in CI via the autofix workflow.
 */
module.exports = {
    // Core formatting options - must match Biome settings in biome.json
    semi: true,
    singleQuote: false,
    trailingComma: "es5",
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    endOfLine: "lf",
    arrowParens: "always",
    bracketSpacing: true,
    bracketSameLine: false,

    // Vue-specific settings
    vueIndentScriptAndStyle: false,
    singleAttributePerLine: false,
    htmlWhitespaceSensitivity: "ignore",

    // Override settings for specific file types
    overrides: [
        {
            files: "*.vue",
            options: {
                parser: "vue",
            },
        },
    ],
};
