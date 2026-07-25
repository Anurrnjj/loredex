import { createHighlighter, type Highlighter } from "shiki";

/**
 * Server-side syntax highlighting.
 *
 * Shiki runs at render time on the server, so no highlighting bundle ships to
 * the browser and code appears already coloured on first paint. The highlighter
 * is expensive to construct (it loads grammars and themes), so it is created
 * once and reused.
 */

const THEMES = { light: "github-light", dark: "github-dark" } as const;

const LANGS = [
  "typescript", "tsx", "javascript", "jsx", "python", "ruby", "go", "rust",
  "java", "kotlin", "swift", "c", "cpp", "csharp", "php", "bash", "sql",
  "html", "css", "scss", "json", "yaml", "toml", "ini", "xml", "graphql",
  "docker", "makefile", "markdown", "diff", "hcl", "lua", "r", "vue",
  "svelte", "astro", "protobuf", "fish", "less", "julia", "properties",
];

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: [THEMES.light, THEMES.dark],
    langs: LANGS,
  });
  return highlighterPromise;
}

const SUPPORTED = new Set(LANGS);

/**
 * Returns highlighted HTML, or null if the language is unknown — callers then
 * fall back to a plain `<pre>`, which is always better than throwing.
 */
export async function highlightCode(
  code: string,
  lang: string,
): Promise<string | null> {
  const language = SUPPORTED.has(lang) ? lang : null;
  if (!language) return null;

  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: THEMES,
      // Emits CSS variables for both themes so the theme toggle works without
      // re-highlighting on the client.
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
