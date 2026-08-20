/* PlantUML Studio — a minimal, dependency-free ZIP writer (STORE method,
   i.e. no compression — the generated projects are small text files, so
   there's nothing to gain from DEFLATE and a lot of complexity to avoid).
   Pure JS, no DOM; only needs TextEncoder, which every target environment
   here (browsers + Node's test runner) provides globally. */
'use strict';
(function (P) {

var CRC_TABLE = (function () {
  var t = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
P.crc32 = crc32;

function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

/* files: [{name, data: string|Uint8Array}] — name uses '/' as the path
   separator regardless of platform, per the ZIP spec. Returns a Uint8Array
   of the complete archive. Timestamps are fixed at the MS-DOS epoch
   (1980-01-01): the exact time a generated file was zipped has no meaning
   here, and a fixed stamp keeps the output byte-identical for identical
   input, which is easier to test and to diff. */
P.makeZip = function (files) {
  var enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
  function toBytes(s) {
    if (s instanceof Uint8Array) return s;
    if (enc) return enc.encode(String(s));
    /* Node < 11 fallback, not expected to be hit in practice */
    return new Uint8Array(Buffer.from(String(s), 'utf8'));
  }
  var DOS_TIME = 0, DOS_DATE = 0x21;
  var localChunks = [], centralChunks = [], offset = 0, count = 0;

  files.forEach(function (f) {
    var name = String(f.name).replace(/\\/g, '/').replace(/^\/+/, '');
    var nameBytes = toBytes(name);
    var dataBytes = toBytes(f.data);
    var crc = crc32(dataBytes);
    var size = dataBytes.length;

    var local = [].concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)
    );
    var localBytes = new Uint8Array(local.length + nameBytes.length + dataBytes.length);
    localBytes.set(local, 0);
    localBytes.set(nameBytes, local.length);
    localBytes.set(dataBytes, local.length + nameBytes.length);
    localChunks.push(localBytes);

    var central = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset)
    );
    var centralBytes = new Uint8Array(central.length + nameBytes.length);
    centralBytes.set(central, 0);
    centralBytes.set(nameBytes, central.length);
    centralChunks.push(centralBytes);

    offset += localBytes.length;
    count++;
  });

  var centralStart = offset, centralSize = 0;
  centralChunks.forEach(function (c) { centralSize += c.length; });

  var eocd = new Uint8Array(u32(0x06054b50).concat(
    u16(0), u16(0), u16(count), u16(count), u32(centralSize), u32(centralStart), u16(0)
  ));

  var total = offset + centralSize + eocd.length;
  var out = new Uint8Array(total);
  var pos = 0;
  localChunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
  centralChunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
  out.set(eocd, pos);
  return out;
};

})(PUML);
