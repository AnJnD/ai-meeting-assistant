// docx.js — tạo file .docx tối giản (ZIP STORE + OOXML), không cần thư viện ngoài.
// Dùng chung cho popup.html (biên bản họp) và recordings.html (thư viện bản ghi).

// ─────────────────────────────────────────────────────────────────
// DOCX GENERATOR (minimal ZIP + OOXML, no external deps)
// ─────────────────────────────────────────────────────────────────

function escXml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildDocxBlob(text) {
  // Strip control chars invalid in XML 1.0
  const safe  = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const paras = safe.split('\n').map(line => {
    if (!line.trim()) return '<w:p/>';
    return '<w:p>' +
      '<w:r><w:rPr><w:rFonts w:eastAsia="Meiryo" w:cs="Meiryo"/></w:rPr>' +
      '<w:t xml:space="preserve">' + escXml(line) + '</w:t></w:r>' +
      '</w:p>';
  }).join('');

  const docXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"' +
    ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"' +
    ' mc:Ignorable="w14">' +
    '<w:body>' + paras +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>' +
    '</w:sectPr></w:body></w:document>';

  const settingsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:defaultTabStop w:val="720"/></w:settings>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/settings.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '</Types>';

  const pkgRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1"' +
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"' +
    ' Target="word/document.xml"/></Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1"' +
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings"' +
    ' Target="settings.xml"/></Relationships>';

  return zipToBlob([
    { name: '[Content_Types].xml',          text: contentTypes },
    { name: '_rels/.rels',                  text: pkgRels      },
    { name: 'word/document.xml',            text: docXml       },
    { name: 'word/settings.xml',            text: settingsXml  },
    { name: 'word/_rels/document.xml.rels', text: docRels      }
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// Lazy CRC-32 table
let _crcTable = null;
function getCrcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    _crcTable[i] = c;
  }
  return _crcTable;
}

function crc32bytes(data) {
  const t   = getCrcTable();
  let   crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

function zipToBlob(files, mimeType) {
  const enc     = new TextEncoder();
  const entries = files.map(f => {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.text);
    return { nameBytes, dataBytes, crc: crc32bytes(dataBytes) };
  });

  const parts   = [];
  const offsets = [];
  let offset    = 0;

  for (const e of entries) {
    offsets.push(offset);
    const hdr = new Uint8Array([
      0x50,0x4b,0x03,0x04,
      20,0, 0,0, 0,0, 0,0,0,0,
      ...u32(e.crc),
      ...u32(e.dataBytes.length),
      ...u32(e.dataBytes.length),
      ...u16(e.nameBytes.length),
      0,0,
      ...e.nameBytes
    ]);
    parts.push(hdr, e.dataBytes);
    offset += hdr.length + e.dataBytes.length;
  }

  const cdOffset = offset;
  for (let i = 0; i < entries.length; i++) {
    const e  = entries[i];
    const cd = new Uint8Array([
      0x50,0x4b,0x01,0x02,             // central dir signature
      20,0,                             // version made by
      20,0,                             // version needed
      0,0,                              // general purpose flags
      0,0,                              // compression method (STORE)
      0,0,0,0,                         // last mod time + date
      ...u32(e.crc),                    // CRC-32
      ...u32(e.dataBytes.length),       // compressed size
      ...u32(e.dataBytes.length),       // uncompressed size
      ...u16(e.nameBytes.length),       // file name length
      0,0,                              // extra field length
      0,0,                              // file comment length
      0,0,                              // disk number start
      0,0,                              // internal file attributes  ← 2 bytes, not 4
      0,0,0,0,                         // external file attributes
      ...u32(offsets[i]),               // relative offset of local header
      ...e.nameBytes
    ]);
    parts.push(cd);
    offset += cd.length;
  }

  const cdSize = offset - cdOffset;
  const eocd   = new Uint8Array([
    0x50,0x4b,0x05,0x06,
    0,0, 0,0,
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(cdSize),
    ...u32(cdOffset),
    0,0
  ]);
  parts.push(eocd);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf   = new Uint8Array(total);
  let   pos   = 0;
  for (const p of parts) { buf.set(p, pos); pos += p.length; }

  return new Blob([buf], { type: mimeType });
}
