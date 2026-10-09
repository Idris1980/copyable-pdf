// Markdown to print-ready HTML. No dependency on VS Code, so it can be tested on its own.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");
const markdownit = require("./media/markdown-it.min.js");

const MEDIA = path.join(__dirname, "media");
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/;
const PROMPT = /^\s*(PS( [^>]*)?>|\$)\s/;

// The character that tells the shell a command continues on the next line, per code block language.
const CONTINUATION = {
  powershell: "`", pwsh: "`", ps1: "`", ps: "`",
  bash: "\\", sh: "\\", shell: "\\", zsh: "\\", azurecli: "\\", console: "\\",
  cmd: "^", bat: "^", batch: "^",
};

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function git(folder, ...args) {
  try {
    return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return "";
  }
}

/** GitHub address of the folder, so relative links still work in the PDF. */
function githubBase(folder) {
  const url = git(folder, "remote", "get-url", "origin");
  const root = git(folder, "rev-parse", "--show-toplevel");
  const branch = git(folder, "rev-parse", "--abbrev-ref", "HEAD");
  if (!url || !root || !branch) return null;
  const web = url.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  const rel = path.relative(path.resolve(root), path.resolve(folder)).split(path.sep).join("/");
  return `${web}/blob/${branch}/` + (rel ? rel + "/" : "");
}

function titleOf(text, file) {
  const heading = text.match(/^#\s+(.+)$/m);
  return heading ? heading[1].replace(/[*_`]/g, "").trim() : path.basename(file, path.extname(file));
}

/** A CSS string for content: "...", so the title can be shown in the footer. */
function cssString(text) {
  return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ") + '"';
}

/** Walks the lines and calls visit(line, index, language) for every line inside a code block. */
function eachCodeLine(lines, visit) {
  let fence = null, language = "";
  lines.forEach((line, i) => {
    const m = line.match(FENCE);
    if (m && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length && !m[2]))) {
      if (fence) { fence = null; language = ""; } else { fence = m[1]; language = m[2].toLowerCase(); }
      visit(line, i, null);
      return;
    }
    visit(line, i, fence ? language : null);
  });
}

function render(text, file, { footer = true, github = githubBase(path.dirname(file)) } = {}) {
  const md = markdownit({ html: true, linkify: true });

  // Mermaid is drawn in the page, all other code is shown as written.
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, i, opt, env, self) => {
    const t = tokens[i];
    if (t.info.trim().toLowerCase() === "mermaid") return `<pre class="mermaid">${escapeHtml(t.content)}</pre>\n`;
    return defaultFence(tokens, i, opt, env, self);
  };

  // Relative links point to the file on GitHub, since the PDF is read without the repository next to it.
  const defaultLink = md.renderer.rules.link_open || ((tokens, i, opt, env, self) => self.renderToken(tokens, i, opt));
  md.renderer.rules.link_open = (tokens, i, opt, env, self) => {
    const href = tokens[i].attrGet("href") || "";
    if (github && href && !/^(https?:|mailto:|#)/i.test(href)) tokens[i].attrSet("href", github + href.replace(/^\.\//, ""));
    return defaultLink(tokens, i, opt, env, self);
  };

  let html = md.render(text);
  // <!-- pagebreak --> starts a new page. The Swedish <!-- sidbrytning --> also works.
  html = html.replace(/<!--\s*(page-?break|sidbrytning)\s*-->/gi, '<div class="page-break"></div>');
  html = html.replace(/<li>(\s*<p>)?\[([ xX])\]\s/g, (_, p, x) => `<li class="task">${p || ""}${x.trim() ? "&#9745;" : "&#9744;"} `);

  const title = titleOf(text, file);
  const style = fs.readFileSync(path.join(MEDIA, "style.css"), "utf8");
  const footerCss = footer ? `@page {
  @bottom-left { content: ${cssString(title)}; font: 8pt "Segoe UI", Arial, sans-serif; color: #57606a; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt "Segoe UI", Arial, sans-serif; color: #57606a; }
}` : "";
  const mermaid = /<pre class="mermaid">/.test(html)
    ? `<script src="${pathToFileURL(path.join(MEDIA, "mermaid.min.js")).href}"></script>
<script>
mermaid.initialize({ startOnLoad: false, theme: "default",
  flowchart: { htmlLabels: true, useMaxWidth: true, nodeSpacing: 30, padding: 8 },
  themeVariables: { fontFamily: "Segoe UI, Arial, sans-serif", fontSize: "17px" } });
mermaid.run();
</script>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<base href="${pathToFileURL(path.dirname(file)).href}/"><title>${escapeHtml(title)}</title>
<style>${style}
${footerCss}</style></head><body>
${html}
${mermaid}
</body></html>`;
}

/** Code lines longer than max, with 0-based line numbers and the block's language. Mermaid is skipped. */
function longCodeLines(text, max) {
  const result = [];
  eachCodeLine(text.split(/\r?\n/), (line, i, language) => {
    if (language !== null && language !== "mermaid" && line.length > max) result.push({ line: i, length: line.length, language });
  });
  return result;
}

/** Splits a line into words, keeping quoted text together. */
function words(text) {
  return text.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g) || [];
}

/**
 * Splits a long command over several lines with the continuation character, so it can be copied
 * from the PDF. Prefers to split before parameters (-x, --name), keeping each parameter with its
 * value. Returns null if the line cannot be split, for example a comment or a long quoted string.
 */
function splitLine(line, char, max) {
  const indent = line.match(/^\s*/)[0];
  const text = line.trim();
  if (!text || text.startsWith("#") || text.startsWith("//") || /[`\\^]$/.test(text)) return null;
  const parts = words(text);
  if (parts.length < 2 || parts.join(" ") !== text.replace(/\s+/g, " ")) return null;

  // Groups: the command with its first words, then one group per parameter with its values.
  const groups = [];
  for (const p of parts) {
    if (!groups.length || /^--?[A-Za-z]/.test(p) || p === "|") groups.push([p]);
    else groups[groups.length - 1].push(p);
  }
  const contIndent = indent + "    ";
  const room = (first) => max - (first ? indent.length : contIndent.length) - 2;
  const lines = [];
  let current = [];
  const add = (bits) => {
    if (current.length && [...current, ...bits].join(" ").length > room(!lines.length)) { lines.push(current.join(" ")); current = [...bits]; }
    else current = [...current, ...bits];
  };
  for (const g of groups) {
    // A group that does not fit on a line of its own is split word by word.
    if (g.join(" ").length > room(false)) g.forEach((w) => add([w]));
    else add(g);
  }
  if (current.length) lines.push(current.join(" "));
  const result = lines.map((l, i) => (i ? contIndent : indent) + l + (i < lines.length - 1 ? " " + char : ""));
  // A long quoted string cannot be split without changing it. Then the line is left as it is.
  if (result.length < 2 || result.some((l) => l.length > max)) return null;
  return result;
}

/** The continuation character for a code block. Blocks without a language use the default shell. */
function charFor(language, defaultShell) {
  return CONTINUATION[language] || (language === "" ? CONTINUATION[defaultShell] : null) || null;
}

/** For each line: true if it is in a code block where at least one line starts with a prompt. */
function promptBlocks(lines) {
  const result = new Array(lines.length).fill(false);
  let start = -1, inBlock = false, hasPrompt = false;
  eachCodeLine(lines, (line, i, language) => {
    if (language === null) {
      if (line.match(FENCE) && inBlock) { if (hasPrompt) result.fill(true, start, i); inBlock = false; }
      else if (line.match(FENCE)) { inBlock = true; start = i + 1; hasPrompt = false; }
      return;
    }
    if (PROMPT.test(line)) hasPrompt = true;
  });
  return result;
}

/**
 * Prepares the text for the PDF without touching the original: long code lines are split with
 * the continuation character where possible. Returns the new text, which lines were split and
 * which could not be (1-based line numbers in the original), and every code line the PDF should
 * contain, so the verification compares against the right lines.
 */
function prepare(text, max, { split = true, defaultShell = "powershell" } = {}) {
  const out = [], splitLines = [], unsplittable = [], codeLines = [];
  const lines = text.split(/\r?\n/);
  const prompts = promptBlocks(lines);
  eachCodeLine(lines, (line, i, language) => {
    if (language === null || language === "mermaid") { out.push(line); return; }
    const nr = i + 1;
    // In a block with prompts (PS> or $), lines without a prompt are command output.
    // Output may wrap, since nobody runs it.
    const output = prompts[i] && !PROMPT.test(line);
    let result = [line];
    if (line.length > max && !output) {
      const char = charFor(language, defaultShell);
      const parts = split && char ? splitLine(line, char, max) : null;
      if (parts) { result = parts; splitLines.push({ line: nr, parts: parts.length, char }); }
      else unsplittable.push({ line: nr, length: line.length, noLanguage: !char });
    }
    out.push(...result);
    if (!output) result.filter((l) => l.trim()).forEach((l) => codeLines.push([nr, l.trim()]));
  });
  return { text: out.join("\n"), splitLines, unsplittable, codeLines };
}

module.exports = { render, prepare, longCodeLines, splitLine, charFor, CONTINUATION, titleOf, githubBase };
