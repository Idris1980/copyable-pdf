// Markdown to Copyable PDF: the button in VS Code, the markers while typing and the messages afterwards.
const path = require("path");
const vscode = require("vscode");
const { render, prepare, longCodeLines, splitLine, charFor } = require("./render");
const { findBrowser, printPdf, verify } = require("./print");

const SOURCE = "Copyable PDF";
const SHELL_NAME = { "`": "PowerShell", "\\": "Bash", "^": "cmd" };
let diagnostics, log;
// Line numbers that could not be copied from the latest PDF, per file. Cleared when the file changes.
const notCopyable = new Map();

function setting(name) {
  return vscode.workspace.getConfiguration("copyablePdf").get(name);
}

function options() {
  return { split: setting("autoSplit"), defaultShell: setting("defaultShell") };
}

function plural(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * Long code lines are marked while typing. Lines that are split automatically in the PDF get a
 * discreet blue marker, lines that cannot be split a yellow warning, or red if the latest PDF
 * showed that they cannot be copied.
 */
function updateDiagnostics(doc) {
  if (doc.languageId !== "markdown") return;
  const max = setting("maxCodeLine");
  const { splitLines, unsplittable } = prepare(doc.getText(), max, options());
  const failed = new Set(notCopyable.get(doc.uri.toString()) || []);
  const mark = (nr, text, severity) => {
    const line = doc.lineAt(nr - 1);
    const d = new vscode.Diagnostic(new vscode.Range(nr - 1, Math.min(max, line.text.length), nr - 1, line.text.length), text, severity);
    d.source = SOURCE;
    d.code = "long-code-line";
    return d;
  };
  const list = [
    ...splitLines.map(({ line, parts, char }) => mark(line,
      `Code line too long for A4. It is split automatically over ${parts} lines with ${char} in the PDF. The Markdown file is not changed.`,
      vscode.DiagnosticSeverity.Information)),
    ...unsplittable.map(({ line, length, noLanguage }) => {
      const reason = noLanguage
        ? "Add a language to the code block (for example powershell) so it can be split automatically."
        : `It cannot be split automatically, probably because of a long quoted string. Shorten it to at most ${max} characters.`;
      return failed.has(line)
        ? mark(line, `Code line is ${length} characters and cannot be copied in full from the PDF. ${reason}`, vscode.DiagnosticSeverity.Error)
        : mark(line, `Code line is ${length} characters and wraps in the PDF. ${reason}`, vscode.DiagnosticSeverity.Warning);
    }),
  ];
  // Other lines that could not be copied, for example with characters the PDF does not reproduce.
  const longOnes = new Set(unsplittable.map((u) => u.line));
  for (const nr of failed) {
    if (longOnes.has(nr) || nr > doc.lineCount) continue;
    const d = new vscode.Diagnostic(doc.lineAt(nr - 1).range, "This line cannot be copied in full from the PDF. Check its characters.",
      vscode.DiagnosticSeverity.Error);
    d.source = SOURCE;
    list.push(d);
  }
  diagnostics.set(doc.uri, list);
}

/** Quick fix "Split line", for those who want to change the Markdown file and not only the PDF. */
const splitFix = {
  provideCodeActions(doc, range, context) {
    const max = setting("maxCodeLine");
    const shell = setting("defaultShell");
    const long = longCodeLines(doc.getText(), max);
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const actions = [];
    for (const diag of context.diagnostics.filter((d) => d.code === "long-code-line")) {
      const item = long.find((l) => l.line === diag.range.start.line);
      if (!item) continue;
      // Code block without a language: the default shell first, then the others.
      const first = charFor(item.language, shell);
      const chars = item.language ? [first].filter(Boolean) : [...new Set([first, "`", "\\"].filter(Boolean))];
      chars.forEach((c, i) => {
        const parts = splitLine(doc.lineAt(item.line).text, c, max);
        if (!parts) return;
        const a = new vscode.CodeAction(`Split line in the file for ${SHELL_NAME[c]} (${c})`, vscode.CodeActionKind.QuickFix);
        a.edit = new vscode.WorkspaceEdit();
        a.edit.replace(doc.uri, doc.lineAt(item.line).range, parts.join(eol));
        a.diagnostics = [diag];
        a.isPreferred = i === 0;
        actions.push(a);
      });
    }
    const all = long.map((l) => ({ l, c: charFor(l.language, shell) }))
      .map(({ l, c }) => ({ l, parts: c && splitLine(doc.lineAt(l.line).text, c, max) })).filter((x) => x.parts);
    if (actions.length && all.length > 1) {
      const a = new vscode.CodeAction(`Split all ${all.length} long code lines in the file`, vscode.CodeActionKind.QuickFix);
      a.edit = new vscode.WorkspaceEdit();
      all.forEach(({ l, parts }) => a.edit.replace(doc.uri, doc.lineAt(l.line).range, parts.join(eol)));
      actions.push(a);
    }
    return actions;
  },
};

async function createPdf(uri) {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.isDirty) await doc.save();
  const mdFile = uri.fsPath;
  const pdfFile = path.join(path.dirname(mdFile), path.basename(mdFile, path.extname(mdFile)) + ".pdf");
  const browser = findBrowser(setting("browserPath"));
  if (!browser) {
    throw new Error("No Chromium browser was found (Edge, Chrome, Chromium or Brave). Install one, or set its path in the setting Copyable PDF: Browser Path.");
  }

  // Long code lines are split only in the PDF, the original is left untouched.
  const prepared = prepare(doc.getText(), setting("maxCodeLine"), options());
  await printPdf(render(prepared.text, mdFile, { footer: setting("footer") }), pdfFile, browser);
  log.appendLine(`PDF: ${pdfFile} (printed with ${browser})`);
  prepared.splitLines.forEach(({ line, parts }) => log.appendLine(`  line ${line}: split over ${parts} lines in the PDF`));
  prepared.unsplittable.forEach(({ line, length }) => log.appendLine(`  line ${line}: ${length} characters, could not be split`));

  let result = null, skipped = "";
  if (setting("verify")) {
    result = await verify(setting("python"), prepared.codeLines, pdfFile);
    if (result && result.missingModule) {
      skipped = "Verification skipped: install pypdfium2 with  pip install pypdfium2";
      result = null;
    } else if (!result) {
      skipped = "Verification skipped: Python was not found.";
    }
    if (skipped) log.appendLine(skipped);
  }
  const missing = [...new Set((result ? result.missing : []).map(([nr]) => nr))];
  notCopyable.set(uri.toString(), missing);
  updateDiagnostics(doc);
  return { pdfFile, result, prepared, missing, skipped };
}

/** The message shown when the PDF is done. */
function summary(pdfName, result, prepared, missing, skipped) {
  const parts = [`${pdfName} is ready${result ? ` (${plural(result.pages, "page", "pages")})` : ""}.`];
  if (prepared.splitLines.length) {
    parts.push(`${plural(prepared.splitLines.length, "long code line was", "long code lines were")} split in the PDF, the Markdown file is unchanged.`);
  }
  if (missing.length) parts.push(`${plural(missing.length, "code line", "code lines")} cannot be copied in full: line ${missing.join(", ")}.`);
  else if (result) parts.push("All code lines can be copied.");
  if (skipped) parts.push(skipped.replace(/\s+/g, " ") + ".");
  return parts.join(" ");
}

async function command(uri, selected) {
  const files = (selected && selected.length ? selected : [uri || vscode.window.activeTextEditor?.document.uri])
    .filter((u) => u && u.fsPath.toLowerCase().endsWith(".md"));
  if (!files.length) return vscode.window.showWarningMessage("Open or select a .md file first.");

  for (const file of files) {
    const name = path.basename(file.fsPath);
    try {
      const { pdfFile, result, prepared, missing, skipped } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating PDF from ${name}…` }, () => createPdf(file));
      if (setting("openAfter")) vscode.env.openExternal(vscode.Uri.file(pdfFile));
      const text = summary(path.basename(pdfFile), result, prepared, missing, skipped);
      const buttons = ["Open PDF", "Reveal in File Explorer"];
      const choice = missing.length
        ? await vscode.window.showWarningMessage(text, "Show Problems", ...buttons)
        : await vscode.window.showInformationMessage(text, ...buttons);
      if (choice === "Open PDF") vscode.env.openExternal(vscode.Uri.file(pdfFile));
      if (choice === "Reveal in File Explorer") vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(pdfFile));
      if (choice === "Show Problems") vscode.commands.executeCommand("workbench.actions.view.problems");
    } catch (error) {
      log.appendLine(`${name}: ${error.message}`);
      vscode.window.showErrorMessage(`${name}: ${error.message}`);
    }
  }
}

function activate(ctx) {
  diagnostics = vscode.languages.createDiagnosticCollection("copyablePdf");
  log = vscode.window.createOutputChannel(SOURCE);
  ctx.subscriptions.push(
    diagnostics, log,
    vscode.commands.registerCommand("copyablePdf.create", command),
    vscode.languages.registerCodeActionsProvider({ language: "markdown" }, splitFix,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => {
      notCopyable.delete(e.document.uri.toString());
      updateDiagnostics(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => { diagnostics.delete(d.uri); notCopyable.delete(d.uri.toString()); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("copyablePdf")) vscode.workspace.textDocuments.forEach(updateDiagnostics);
    }),
  );
  vscode.workspace.textDocuments.forEach(updateDiagnostics);
}

function deactivate() {}

module.exports = { activate, deactivate };
