"""Reads the PDF the way the browser does when copying, and checks that every code line is there in full.

Usage: python verify.py <code-lines.json> <file.pdf>
code-lines.json is a list of [line number, line], the code lines the PDF should contain.
Prints JSON: {"pages": 12, "missing": [[line number, "line"], ...]},
or {"missingModule": true} if pypdfium2 is not available.
"""
import json
import pathlib
import sys

# The extension ships pypdfium2 built for Windows. On macOS and Linux it is installed with pip.
if sys.platform == "win32":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
try:
    import pypdfium2
except (ImportError, OSError):
    print(json.dumps({"missingModule": True}))
    sys.exit(0)


def main():
    code_lines = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    doc = pypdfium2.PdfDocument(sys.argv[2])
    lines = {" ".join(l.split()) for i in range(len(doc)) for l in doc[i].get_textpage().get_text_range().splitlines()}
    missing = [[nr, line] for nr, line in code_lines if " ".join(line.split()) not in lines]
    print(json.dumps({"pages": len(doc), "missing": missing}, ensure_ascii=False))


if __name__ == "__main__":
    main()
