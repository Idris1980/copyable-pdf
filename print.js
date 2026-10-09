// HTML to PDF with a Chromium browser (Edge, Chrome, Chromium or Brave), and the check that the
// code can be copied from the PDF.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");

// Edge first, since it is preinstalled on Windows. All of them print PDFs the same way.
const BROWSERS = {
  win32: [
    "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
    "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
    "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
    "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
    "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
    "%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "%LOCALAPPDATA%\\Chromium\\Application\\chrome.exe",
  ],
  darwin: [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ],
  // On Linux the browsers are usually on PATH under these names.
  linux: ["microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser"],
};

function expand(p) {
  return p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || "").replace(/^~(?=\/)/, os.homedir());
}

/** A program name looked up on PATH, or null. On Windows .exe, .cmd and so on are added. */
function onPath(name) {
  const endings = process.platform === "win32" && !path.extname(name)
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const ending of endings) {
      const full = path.join(dir, name + ending);
      if (dir && fs.existsSync(full)) return full;
    }
  }
  return null;
}

/** The browser to print with: the user's own setting, otherwise the first one found. */
function findBrowser(custom) {
  if (custom) return fs.existsSync(expand(custom)) ? expand(custom) : onPath(custom);
  for (const candidate of BROWSERS[process.platform] || BROWSERS.linux) {
    const full = candidate.includes(path.sep) || candidate.includes("/") ? expand(candidate) : onPath(candidate);
    if (full && fs.existsSync(full)) return full;
  }
  return null;
}

// VS Code is built on Chromium and sets environment variables that the browser also reads. If it
// inherits CHROME_CRASHPAD_PIPE_NAME, for example, it exits at once without writing a PDF.
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CHROME_|ELECTRON_|VSCODE_)/i.test(k)));
}

function run(program, args, timeout) {
  return new Promise((done) => {
    execFile(program, args, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: cleanEnv() },
      (error, stdout, stderr) => done({ error, stdout, stderr }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until the file exists and its size has stopped changing. */
async function waitForFile(file, timeout) {
  const end = Date.now() + timeout;
  let previous = -1;
  while (Date.now() < end) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === previous) return true;
    previous = size;
    await sleep(400);
  }
  return false;
}

/** Prints the HTML to pdfFile. Throws an error with a readable message if something goes wrong. */
async function printPdf(html, pdfFile, browser) {
  try {
    fs.rmSync(pdfFile, { force: true });
  } catch {
    throw new Error(`${path.basename(pdfFile)} is open in another program. Close it and try again.`);
  }
  const htmlFile = path.join(os.tmpdir(), `copyable-pdf-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(htmlFile, html, "utf8");
  // A separate profile, so printing does not clash with a browser window that is already open.
  const profile = path.join(os.tmpdir(), "copyable-pdf-browser");
  try {
    await run(browser, ["--headless", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
      `--user-data-dir=${profile}`, "--virtual-time-budget=15000", `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href], 120000);
    // On Windows msedge.exe hands over to another process and exits at once, so the PDF arrives a moment later.
    if (!(await waitForFile(pdfFile, 90000))) throw new Error(`${path.basename(browser)} did not create a PDF.`);
  } finally {
    fs.rmSync(htmlFile, { force: true });
  }
}

// The Python found the first time, per setting, so the search is done once per VS Code session.
const pythonCache = new Map();

/**
 * Finds a working Python 3: the user's command first, then python3, python and py.
 * Commands that are not on the computer are skipped at once. The others get a short question
 * (at most 10 seconds) and must answer as Python 3. On Windows this also skips the placeholder
 * that only points to the Microsoft Store.
 */
async function findPython(custom) {
  if (pythonCache.has(custom)) return pythonCache.get(custom);
  let found = null;
  for (const cmd of [...new Set([custom, "python3", "python", "py"].filter(Boolean))]) {
    const full = fs.existsSync(expand(cmd)) ? expand(cmd) : onPath(cmd);
    if (!full) continue;
    const { stdout } = await run(full, ["-c", "import sys; print(sys.version_info[0])"], 10000);
    if ((stdout || "").trim() === "3") { found = full; break; }
  }
  pythonCache.set(custom, found);
  return found;
}

/**
 * Reads the PDF with PDFium through Python and looks for the code lines.
 * Returns null if no Python was found, or { missingModule: true } if pypdfium2 is missing.
 */
async function verify(python, codeLines, pdfFile) {
  const cmd = await findPython(python);
  if (!cmd) return null;
  const list = path.join(os.tmpdir(), `copyable-pdf-lines-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(list, JSON.stringify(codeLines), "utf8");
  try {
    const { stdout } = await run(cmd, [path.join(__dirname, "verify.py"), list, pdfFile], 60000);
    return JSON.parse(stdout);
  } catch {
    return null;
  } finally {
    fs.rmSync(list, { force: true });
  }
}

module.exports = { findBrowser, printPdf, verify };
