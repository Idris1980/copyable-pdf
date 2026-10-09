"""Packages the extension as a .vsix file, without Node or vsce.

A .vsix is a zip file with a manifest, a list of content types and the extension files in the
folder extension/. Usage: python build.py
"""
import json
import pathlib
import zipfile
from xml.sax.saxutils import escape

HERE = pathlib.Path(__file__).resolve().parent
INCLUDE = ["package.json", "extension.js", "render.js", "print.js", "verify.py", "README.md", "LICENSE",
           "THIRD-PARTY-NOTICES.md", "media", "lib"]

package = json.loads((HERE / "package.json").read_text(encoding="utf-8"))
files = []
for name in INCLUDE:
    path = HERE / name
    for f in ([path] if path.is_file() else sorted(path.rglob("*"))):
        if f.is_file() and "__pycache__" not in f.parts:
            files.append(f)

types = sorted({f.suffix.lower() for f in files if f.suffix} | {".vsixmanifest", ".json"})
content_types = "".join(f'<Default Extension="{t}" ContentType="application/octet-stream"/>' for t in types)
manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{package['name']}" Version="{package['version']}" Publisher="{package['publisher']}"/>
    <DisplayName>{escape(package['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(package['description'])}</Description>
    <Tags>{escape(','.join(package.get('keywords', [])))}</Tags>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{package['engines']['vscode']}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true"/>
  </Assets>
</PackageManifest>"""

out = HERE / f"{package['name']}-{package['version']}.vsix"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", f'<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{content_types}</Types>')
    z.writestr("extension.vsixmanifest", manifest)
    for f in files:
        z.write(f, "extension/" + f.relative_to(HERE).as_posix())
print(f"{out.name}: {len(files)} files, {out.stat().st_size / 1024 / 1024:.1f} MB")
