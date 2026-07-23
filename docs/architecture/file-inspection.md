# Local file inspection

Switchboard uses a MarkItDown-inspired conversion pipeline implemented for the browser rather than embedding Python.

## Detection

Each file is evaluated using:

- Filename extension
- Browser-declared MIME type
- Leading magic bytes
- Text-likeness when no binary signature is present

Magic bytes take priority over misleading extensions. Office Open XML types require a ZIP signature and their expected package structure during extraction.

## Supported extraction

| Type | Behavior |
|---|---|
| Text, Markdown, CSV | UTF-8 decoding with bounded output |
| HTML | Script/style removal and structural text conversion |
| JSON | Local parse and normalized pretty-printing |
| PDF | Lightweight PDF text-operator extraction, page/image counting, and scanned-document warnings |
| DOCX | `word/document.xml`, headers, and footers |
| PPTX | Ordered slide text from `ppt/slides/` |
| XLSX | Shared strings and worksheet cell values |
| ZIP | Safe entry listing only |
| Images | Type detection and a required-vision capability |

PDF extraction is intentionally conservative. PDFs with compressed or unusual content streams may return a limited-extraction warning. A future packaged PDF.js worker can improve coverage without changing the file-inspection interface.

## Resource limits

Defaults:

- 25 MB input file
- 200,000 extracted characters
- 512 ZIP entries
- 50 MB aggregate ZIP expansion
- 200:1 per-entry compression ratio
- Only stored and deflate ZIP methods
- Path traversal rejection before extraction

These limits are checked before expanding archive entries wherever the file format permits.
