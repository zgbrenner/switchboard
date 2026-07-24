# File handling and local inspection

Switchboard has two distinct file-handling boundaries.

## MCP file contract

The MCP server does **not** accept file paths, open arbitrary local files, or read the host filesystem through `route_request`.

An MCP host may provide up to 20 bounded file summaries containing:

- Name
- Detected type
- Media type
- Byte size
- Extracted-text length
- An excerpt of at most 4,000 characters
- Warnings
- Vision and long-context hints

Example:

```json
{
  "name": "agreement.pdf",
  "detectedType": "pdf",
  "mediaType": "application/pdf",
  "size": 820000,
  "textLength": 24000,
  "excerpt": "Termination and renewal provisions...",
  "warnings": ["OCR may be incomplete"],
  "capabilities": {
    "vision": true,
    "longContext": false
  }
}
```

The host is responsible for obtaining that metadata or excerpt and deciding whether it is appropriate to share with Switchboard. The MCP server uses it only for the current in-memory routing decision and does not persist it.

A file entry always implies the `files` capability. Vision and long-context requirements can be inferred from explicit hints, detected type, extracted-text length, and file size.

## Browser-extension inspection foundation

The retained Chromium extension includes a MarkItDown-inspired conversion pipeline implemented for browser workers rather than embedding Python.

This subsystem is separate from MCP operation. It exists so the extension can inspect user-selected attachments locally before choosing a visible ChatGPT or Claude model.

### Detection

Each selected file can be evaluated using:

- Filename extension
- Browser-declared MIME type
- Leading magic bytes
- Text-likeness when no binary signature is present
- Expected Open XML package structure for Office documents

Magic bytes take priority over misleading extensions. A mismatch is surfaced as a warning rather than silently trusted.

### Supported extraction

| Type | Extension behavior |
|---|---|
| Text, Markdown, CSV | UTF-8 decoding with bounded output |
| HTML | Script/style removal and structural text conversion |
| JSON | Local parsing and normalized text |
| PDF | Conservative embedded-text extraction with scanned-document warnings |
| DOCX | Bounded extraction from document and related text parts |
| PPTX | Ordered slide and note text where available |
| XLSX | Shared strings and worksheet values |
| ZIP | Safe bounded archive inspection and text-like members where supported |
| Images | Type detection and a required-vision capability |

PDF extraction is intentionally conservative. Compressed, encrypted, scanned, or unusual PDFs may produce limited text or metadata-only routing. Switchboard does not silently claim OCR coverage when OCR was not performed.

### Safety controls

The extension path uses bounded parsing and fail-safe fallback, including:

- Maximum input size
- Maximum extracted-text length
- Maximum archive-entry count
- Maximum aggregate expansion
- Per-entry size and compression-ratio limits
- Supported-compression allowlist
- Path traversal rejection
- Duplicate-entry and header-consistency checks
- Extraction timeout and worker recovery
- Metadata-only fallback after unsupported or failed extraction

The implementation is authoritative for exact numeric limits. Documentation should not be used to bypass or increase a runtime safety bound.

## Privacy boundary

For MCP, only host-supplied metadata and excerpts are processed in memory.

For the extension foundation, user-selected bytes and extracted text remain in extension-owned browser contexts and are not written to persistent settings storage. Unsupported or unsafe content falls back to metadata-only routing.

## Capability consequences

- Any supplied file requires file-capable handling.
- Images and scanned or image-dependent documents can require vision.
- Large extracted text or large files can require long-context support.
- A host-supplied model that explicitly lacks a required file, vision, or long-context capability is excluded from concrete model resolution.
