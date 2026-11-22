# Markdown to Copyable PDF

Turns a Markdown file into an A4 PDF with Microsoft Edge or Google Chrome, where every code line can be copied from the PDF exactly as written, even double dashes.

Most Markdown PDF tools break long commands at the page edge. When someone copies such a command from the PDF, the line break comes along, and the terminal runs half a command. This extension splits long commands with the shell's continuation character instead, so they still work when pasted.

## Install

In VS Code, open the Extensions view (`Ctrl+Shift+X`), search for **Markdown to Copyable PDF** and click **Install**, or in a terminal:

```
code --install-extension idris1980.copyable-pdf
```

Each version is also on [Releases](https://github.com/Idris1980/copyable-pdf/releases) as a signed `.vsix` file, which can be installed with **Install from VSIX...** in the Extensions view's `...` menu.

## Usage

- Open a `.md` file and click the PDF icon in the top right corner, or
- right-click one or more `.md` files in the Explorer and choose **Create Copyable PDF**.

The PDF is saved next to the Markdown file with the same name, for example `README.pdf`. Add `*.pdf` to `.gitignore` if it should not be committed.

## Requirements

| | Windows | macOS | Linux |
|---|---|---|---|
| **PDF** | Edge, preinstalled | Edge, Chrome, Chromium or Brave | Edge, Chrome, Chromium or Brave |
| **Verification** | Python | Python and `pip install pypdfium2` | Python and `pip install pypdfium2` |

The extension looks for Edge first, then Chrome, Chromium and Brave. All of them print the PDF the same way. Without Python, the PDF is still created and long commands are still split, only the verification afterwards is skipped.

Tested on Windows with Edge and Chrome. macOS and Linux are supported in the code but not yet tested.

## Features

- **Long commands are split automatically in the PDF** with the right continuation character: `` ` `` for PowerShell, `\` for Bash and `^` for cmd. Lines are split before parameters such as `--name`, so each parameter stays with its value. The Markdown file is not changed, and the message afterwards tells you how many lines were split. Code blocks without a language are split as PowerShell (setting `copyablePdf.defaultShell`).
- **Code that cannot be split is printed smaller:** some languages have no continuation character, for example YAML, JSON and SQL, and a long quoted string cannot be split either. Such a code block is printed in a smaller font, just small enough for its longest line, so every line still fits and can be copied. The smallest size is 6 pt by default, which fits about 136 characters (setting `copyablePdf.minCodeFontSize`). Lines that are longer still get a warning.
- **Command output is left alone:** if a code block has lines starting with `PS>` or `$`, only those lines count as commands. The other lines are output and may wrap.
- **Markers while typing:** lines that will be split automatically or printed smaller get a blue marker. Lines that are too long even at the smallest size get a yellow warning with advice that fits the language, for example to write YAML in block style instead of `{...}` on one line. They show up under Problems.
- **Verification afterwards:** the finished PDF is read with PDFium, the same engine Edge and Chrome use when you copy text. Code lines that cannot be copied in full are marked red.
- **Split in the file too:** to change the Markdown file itself, put the cursor on the line and press `Ctrl+.`.
- **Footer** with the document title and "Page 3 of 12".
- **Mermaid diagrams** are drawn without an internet connection.
- **Page breaks:** write `<!-- pagebreak -->` on a line of its own to start the next section on a new page.
- **Links** to other files in the repository point to GitHub, since the PDF is read without the repository next to it.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `copyablePdf.maxCodeLine` | 95 | Longest code line before it is split or flagged |
| `copyablePdf.autoSplit` | on | Split long commands in the PDF |
| `copyablePdf.defaultShell` | powershell | How code blocks without a language are split: powershell, bash, cmd or none |
| `copyablePdf.shrinkLongLines` | on | Print a code block smaller when it has lines that cannot be split |
| `copyablePdf.minCodeFontSize` | 6 | Smallest font size in points for such a block. The normal size is 8.6 pt |
| `copyablePdf.footer` | on | Title and page numbers in the footer |
| `copyablePdf.openAfter` | on | Open the PDF when it is ready |
| `copyablePdf.verify` | on | Verify the PDF afterwards (requires Python) |
| `copyablePdf.python` | `python` | Python command used for the verification. python3, python and py are also tried |
| `copyablePdf.browserPath` | empty | Path to Edge, Chrome, Chromium or Brave if none is found automatically |

## Build from source

No Node.js is needed. The extension is plain JavaScript, and `build.py` packages it as a `.vsix` file.

```powershell
git clone https://github.com/Idris1980/copyable-pdf.git
cd copyable-pdf
python build.py
code --install-extension copyable-pdf-2.3.2.vsix
```

## Changes

**2.3.2**

- Easier to find on the Marketplace: more search words and the Formatters category.

**2.3.1**

- Published on the Visual Studio Marketplace. Each release is built, signed and published by GitHub Actions.

**2.3.0**

- Code blocks with lines that cannot be split, for example YAML or JSON, are printed in a smaller font so the lines can still be copied.
- New settings `copyablePdf.shrinkLongLines` and `copyablePdf.minCodeFontSize`.
- Better advice for long lines. Code blocks in a language without a continuation character no longer get the advice to add a language.

## License

MIT, see [LICENSE](LICENSE). Bundled open source libraries are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
