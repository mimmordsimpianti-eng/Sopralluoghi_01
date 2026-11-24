/* ZIP senza compressione (le foto JPEG sono già compresse): serve per inviare le foto su WhatsApp in un solo file. */
var ZipFoto = (function () {
  'use strict';
  var T = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function leggi(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(new Uint8Array(r.result)); }; r.onerror = rej; r.readAsArrayBuffer(blob); }); }
  function u16(v) { return [v & 255, (v >> 8) & 255]; }
  function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
  function ascii(s) { var b = []; for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 127); return b; }
  /* file: [{nome, blob}] → Blob zip */
  function crea(file) {
    var d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
    return Promise.all(file.map(function (f) { return leggi(f.blob); })).then(function (dati) {
      var parti = [], centrale = [], pos = 0;
      file.forEach(function (f, i) {
        var nome = ascii(f.nome), b = dati[i], c = crc(b);
        var loc = [0x50, 0x4B, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(c), u32(b.length), u32(b.length), u16(nome.length), u16(0), nome);
        parti.push(new Uint8Array(loc), b);
        centrale = centrale.concat([0x50, 0x4B, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(c), u32(b.length), u32(b.length), u16(nome.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(pos), nome);
        pos += loc.length + b.length;
      });
      var fine = [0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(file.length), u16(file.length), u32(centrale.length), u32(pos), u16(0));
      parti.push(new Uint8Array(centrale), new Uint8Array(fine));
      return new Blob(parti, { type: 'application/zip' });
    });
  }
  return { crea: crea };
})();
