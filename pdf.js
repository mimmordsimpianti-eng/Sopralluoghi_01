/* Generatore PDF minimale (nessuna libreria esterna): testo Helvetica + foto JPEG. Funziona anche offline. */
var PdfScheda = (function () {
  'use strict';
  var WR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  var CP = { 8364: 128, 8218: 130, 8222: 132, 8230: 133, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151 };
  function code(ch) { var c = ch.charCodeAt(0); if (c < 256) return c; return CP[c] || 63; }
  function larg(str, size, bold) {
    var w = bold ? WB : WR, t = 0;
    for (var i = 0; i < str.length; i++) { var c = code(str.charAt(i)); t += (c >= 32 && c <= 126) ? w[c - 32] : 556; }
    return t * size / 1000;
  }
  function esc(str) {
    var o = '';
    for (var i = 0; i < str.length; i++) {
      var c = code(str.charAt(i));
      if (c === 40 || c === 41 || c === 92) o += '\\' + String.fromCharCode(c);
      else if (c < 32) o += ' ';
      else if (c > 126) o += '\\' + ('00' + c.toString(8)).slice(-3);
      else o += String.fromCharCode(c);
    }
    return o;
  }
  function righe(str, size, bold, maxW) {
    var out = [];
    String(str).split(/\r?\n/).forEach(function (par) {
      var parole = par.split(/\s+/).filter(function (x) { return x; }), riga = '';
      if (!parole.length) { out.push(''); return; }
      parole.forEach(function (p) {
        while (larg(p, size, bold) > maxW) {               // parola più larga della riga: spezzala
          var k = p.length; while (k > 1 && larg(p.slice(0, k), size, bold) > maxW) k--;
          if (riga) { out.push(riga); riga = ''; }
          out.push(p.slice(0, k)); p = p.slice(k);
        }
        var prova = riga ? riga + ' ' + p : p;
        if (larg(prova, size, bold) <= maxW) riga = prova; else { out.push(riga); riga = p; }
      });
      out.push(riga);
    });
    return out;
  }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }
  var TEAL = '0.039 0.486 0.525', W = 595.28, H = 841.89, M = 40;

  function leggi(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(new Uint8Array(r.result)); }; r.onerror = rej; r.readAsArrayBuffer(blob); }); }

  /* modello: {titolo, sottotitolo, sezioni:[{titolo, righe:[[etichetta, valore]], testo}], foto:[{blob,w,h,didascalia}], logo:{blob,w,h}|null} */
  function genera(m) {
    var immagini = (m.foto || []).slice(); if (m.logo) immagini.push(m.logo);
    return Promise.all(immagini.map(function (f) { return leggi(f.blob).then(function (b) { f.bytes = b; }); })).then(function () {
      var pagine = [], cs = [], y = 0, usate = [];     // usate: immagini referenziate per pagina
      function nuova() { cs = []; usate = []; pagine.push({ cs: cs, img: usate }); y = H - M; }
      function t(x, yy, s, size, bold, rgb) { cs.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + (rgb || '0.1 0.13 0.19') + ' rg ' + num(x) + ' ' + num(yy) + ' Td (' + esc(s) + ') Tj ET'); }
      function serve(h) { if (y - h < M + 20) nuova(); }
      function img(f, x, yy, w, h) { var i = immagini.indexOf(f); if (usate.indexOf(i) < 0) usate.push(i); cs.push('q ' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(yy) + ' cm /Im' + i + ' Do Q'); }

      nuova();
      // fascia titolo
      cs.push(TEAL + ' rg 0 ' + num(H - 78) + ' ' + num(W) + ' 78 re f');
      t(M, H - 36, m.titolo || 'SCHEDA SOPRALLUOGO', 20, true, '1 1 1');
      if (m.sottotitolo) t(M, H - 56, m.sottotitolo, 10.5, false, '0.9 0.97 0.98');
      if (m.logo) { var lh = 44, lw = lh * m.logo.w / m.logo.h; img(m.logo, W - M - lw, H - 62, lw, lh); }
      y = H - 78 - 24;

      (m.sezioni || []).forEach(function (s) {
        serve(40);
        if (s.titolo) {
          t(M, y, s.titolo.toUpperCase(), 11, true, TEAL);
          cs.push(TEAL + ' RG 0.8 w ' + num(M) + ' ' + num(y - 4) + ' m ' + num(W - M) + ' ' + num(y - 4) + ' l S');
          y -= 20;
        }
        (s.righe || []).forEach(function (r) {
          var vl = righe(r[1], 10, false, W - M - 175), el = righe(r[0], 9, true, 125);
          var n = Math.max(vl.length, el.length);
          serve(n * 13 + 3);
          el.forEach(function (l, i) { t(M, y - i * 13, l, 9, true, '0.35 0.4 0.48'); });
          vl.forEach(function (l, i) { t(M + 135, y - i * 13, l, 10, false); });
          y -= n * 13 + 3;
        });
        if (s.testo) {
          righe(s.testo, 10, false, W - 2 * M).forEach(function (l) { serve(14); t(M, y, l, 10, false); y -= 13; });
        }
        y -= 10;
      });

      var fl = m.foto || [];
      if (fl.length) {
        serve(60); t(M, y, 'FOTO (' + fl.length + ')', 11, true, TEAL);
        cs.push(TEAL + ' RG 0.8 w ' + num(M) + ' ' + num(y - 4) + ' m ' + num(W - M) + ' ' + num(y - 4) + ' l S'); y -= 22;
        var cw = (W - 2 * M - 14) / 2, i = 0;
        while (i < fl.length) {
          var riga = fl.slice(i, i + 2), alt = 0;
          riga.forEach(function (f) { alt = Math.max(alt, Math.min(cw * f.h / f.w, 300)); });
          serve(alt + 30);
          riga.forEach(function (f, k) {
            var h = Math.min(cw * f.h / f.w, 300), w = h * f.w / f.h, x = M + k * (cw + 14);
            img(f, x, y - h, w, h);
            if (f.didascalia) { righe(f.didascalia, 8.5, false, cw).slice(0, 2).forEach(function (l, j) { t(x, y - h - 11 - j * 10, l, 8.5, false, '0.35 0.4 0.48'); }); }
          });
          y -= alt + 32; i += 2;
        }
      }

      // piè di pagina
      pagine.forEach(function (p, i) { p.cs.push('BT /F1 8 Tf 0.5 0.55 0.6 rg ' + num(M) + ' 22 Td (' + esc('RDS Impianti – scheda sopralluogo') + ') Tj ET'); p.cs.push('BT /F1 8 Tf 0.5 0.55 0.6 rg ' + num(W - M - 50) + ' 22 Td (' + esc('Pagina ' + (i + 1) + ' di ' + pagine.length) + ') Tj ET'); });

      /* ---- serializzazione ---- */
      var parti = [], off = [], len = 0;
      function puts(str) { var b = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255; parti.push(b); len += b.length; }
      function putb(b) { parti.push(b); len += b.length; }
      function obj(n, body) { off[n] = len; puts(n + ' 0 obj\n' + body + '\nendobj\n'); }
      var nImg = immagini.length, base = 5;                      // 1 catalogo, 2 pagine, 3 F1, 4 F2, immagini da 5
      var nPag = pagine.length, primaPag = base + nImg;           // pagina i: oggetto primaPag+2i, contenuto +1
      puts('%PDF-1.4\n');
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
      var kids = []; for (var i = 0; i < nPag; i++) kids.push((primaPag + 2 * i) + ' 0 R');
      obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nPag + ' >>');
      obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      immagini.forEach(function (f, i) {
        off[base + i] = len;
        puts((base + i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + f.w + ' /Height ' + f.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + f.bytes.length + ' >>\nstream\n');
        putb(f.bytes); puts('\nendstream\nendobj\n');
      });
      pagine.forEach(function (p, i) {
        var xo = p.img.map(function (k) { return '/Im' + k + ' ' + (base + k) + ' 0 R'; }).join(' ');
        obj(primaPag + 2 * i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(W) + ' ' + num(H) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ' + xo + ' >> >> /Contents ' + (primaPag + 2 * i + 1) + ' 0 R >>');
        var c = p.cs.join('\n');
        obj(primaPag + 2 * i + 1, '<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream');
      });
      var tot = primaPag + 2 * nPag, xref = len;
      puts('xref\n0 ' + tot + '\n0000000000 65535 f \n');
      for (var n = 1; n < tot; n++) puts(('0000000000' + off[n]).slice(-10) + ' 00000 n \n');
      puts('trailer\n<< /Size ' + tot + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
      return new Blob(parti, { type: 'application/pdf' });
    });
  }
  return { genera: genera };
})();
