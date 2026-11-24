/* Editor foto: linee dritte, cerchi, quadrati, scelta colore e spessore, selezione/modifica/eliminazione. */
var Editor = (function () {
  'use strict';

  var COLORI = ['#E53935', '#FFC000', '#43A047', '#1E88E5', '#FFFFFF', '#000000'];
  var SPESSORI = [{ n: 'Sottile', v: 3 }, { n: 'Medio', v: 6 }, { n: 'Spesso', v: 10 }];

  function distSegmento(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function distanzaDaForma(s, x, y) {
    if (s.t === 'linea') return distSegmento(x, y, s.x1, s.y1, s.x2, s.y2);
    if (s.t === 'cerchio') return Math.abs(Math.hypot(x - s.x1, y - s.y1) - Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
    var xa = Math.min(s.x1, s.x2), xb = Math.max(s.x1, s.x2), ya = Math.min(s.y1, s.y2), yb = Math.max(s.y1, s.y2);
    return Math.min(distSegmento(x, y, xa, ya, xb, ya), distSegmento(x, y, xb, ya, xb, yb),
                    distSegmento(x, y, xb, yb, xa, yb), distSegmento(x, y, xa, yb, xa, ya));
  }

  function disegnaForma(ctx, s, k, evidenzia) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var passi = evidenzia ? [{ c: 'rgba(255,255,255,.85)', w: s.lw * k + 8 }, { c: s.c, w: s.lw * k }] : [{ c: s.c, w: s.lw * k }];
    passi.forEach(function (p) {
      ctx.strokeStyle = p.c; ctx.lineWidth = p.w; ctx.beginPath();
      if (s.t === 'linea') { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
      else if (s.t === 'cerchio') { ctx.arc(s.x1, s.y1, Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0, Math.PI * 2); }
      else { ctx.rect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)); }
      ctx.stroke();
    });
    ctx.restore();
  }

  /**
   * opts: { blob, forme (array o null), onSalva(annBlob|null, forme), onChiudi() }
   */
  function apri(opts) {
    var forme = JSON.parse(JSON.stringify(opts.forme || []));
    var strumento = 'linea', colore = COLORI[0], spessore = 1, selezionata = -1, anteprima = null, trascina = false;
    var img = new Image(), url = URL.createObjectURL(opts.blob);

    var el = document.createElement('div');
    el.className = 'editor';
    el.innerHTML =
      '<div class="alto"><button class="t" data-a="chiudi">✕ Chiudi</button><b>Modifica foto</b><button class="t on" data-a="salva">✓ Salva</button></div>' +
      '<div class="tela"><canvas></canvas></div>' +
      '<div class="strumenti">' +
        '<div class="fila" data-g="strumenti">' +
          '<button class="t" data-s="seleziona">☝ Seleziona</button><button class="t on" data-s="linea">／ Linea</button>' +
          '<button class="t" data-s="cerchio">◯ Cerchio</button><button class="t" data-s="quadrato">▢ Quadrato</button></div>' +
        '<div class="fila" data-g="colori">' + COLORI.map(function (c, i) {
          return '<button class="col' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="colore"></button>'; }).join('') + '</div>' +
        '<div class="fila" data-g="spessori">' + SPESSORI.map(function (s, i) {
          return '<button class="t' + (i === 1 ? ' on' : '') + '" data-w="' + i + '">' + s.n + '</button>'; }).join('') +
          '<button class="t" data-a="annulla">↶ Annulla</button><button class="t" data-a="elimina">🗑 Elimina</button><button class="t" data-a="svuota">Cancella tutto</button></div>' +
      '</div>';
    document.body.appendChild(el);
    var cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
    spessore = 1;

    function chiudi() { URL.revokeObjectURL(url); document.body.removeChild(el); window.removeEventListener('resize', adatta); }

    function k() { return Math.max(1, img.naturalWidth / 900); }

    function ridisegna() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      var kk = k();
      forme.forEach(function (s, i) { disegnaForma(ctx, s, kk, i === selezionata); });
      if (anteprima) disegnaForma(ctx, anteprima, kk, false);
    }

    function adatta() {
      var tela = el.querySelector('.tela');
      var maxW = tela.clientWidth - 8, maxH = tela.clientHeight - 8;
      var sc = Math.min(maxW / cv.width, maxH / cv.height);
      cv.style.width = Math.floor(cv.width * sc) + 'px';
      cv.style.height = Math.floor(cv.height * sc) + 'px';
    }

    function punto(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
    }

    img.onload = function () {
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      adatta(); ridisegna();
    };
    img.src = url;
    window.addEventListener('resize', adatta);

    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var p = punto(e);
      cv.setPointerCapture(e.pointerId);
      if (strumento === 'seleziona') {
        var tol = 22 * k(), migliore = -1, dMin = tol;
        forme.forEach(function (s, i) { var d = distanzaDaForma(s, p.x, p.y); if (d <= dMin) { dMin = d; migliore = i; } });
        selezionata = migliore; ridisegna(); return;
      }
      trascina = true; selezionata = -1;
      anteprima = { t: strumento === 'quadrato' ? 'quadrato' : strumento, x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: colore, lw: SPESSORI[spessore].v };
    });
    cv.addEventListener('pointermove', function (e) {
      if (!trascina || !anteprima) return;
      var p = punto(e); anteprima.x2 = p.x; anteprima.y2 = p.y; ridisegna();
    });
    function fine(e) {
      if (!trascina || !anteprima) return;
      trascina = false;
      var p = punto(e); anteprima.x2 = p.x; anteprima.y2 = p.y;
      if (Math.hypot(anteprima.x2 - anteprima.x1, anteprima.y2 - anteprima.y1) > 8 * k()) forme.push(anteprima);
      anteprima = null; ridisegna();
    }
    cv.addEventListener('pointerup', fine);
    cv.addEventListener('pointercancel', function () { trascina = false; anteprima = null; ridisegna(); });

    function evidenziaPulsanti(gruppo, attr, valore) {
      el.querySelectorAll('[data-g="' + gruppo + '"] button').forEach(function (b) {
        if (b.hasAttribute(attr)) b.classList.toggle('on', b.getAttribute(attr) === String(valore));
      });
    }

    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.s) { strumento = b.dataset.s; if (strumento !== 'seleziona') selezionata = -1; evidenziaPulsanti('strumenti', 'data-s', strumento); ridisegna(); }
      else if (b.dataset.c) {
        colore = b.dataset.c; evidenziaPulsanti('colori', 'data-c', colore);
        if (selezionata >= 0) { forme[selezionata].c = colore; ridisegna(); }
      }
      else if (b.dataset.w !== undefined) {
        spessore = Number(b.dataset.w); evidenziaPulsanti('spessori', 'data-w', spessore);
        if (selezionata >= 0) { forme[selezionata].lw = SPESSORI[spessore].v; ridisegna(); }
      }
      else if (b.dataset.a === 'annulla') { forme.pop(); selezionata = -1; ridisegna(); }
      else if (b.dataset.a === 'elimina') { if (selezionata >= 0) { forme.splice(selezionata, 1); selezionata = -1; ridisegna(); } }
      else if (b.dataset.a === 'svuota') { if (forme.length && confirm('Cancellare tutti i disegni?')) { forme = []; selezionata = -1; ridisegna(); } }
      else if (b.dataset.a === 'chiudi') { chiudi(); if (opts.onChiudi) opts.onChiudi(); }
      else if (b.dataset.a === 'salva') {
        selezionata = -1;
        if (!forme.length) { chiudi(); opts.onSalva(null, []); return; }
        var out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
        var octx = out.getContext('2d'); octx.drawImage(img, 0, 0, out.width, out.height);
        var kk = k(); forme.forEach(function (s) { disegnaForma(octx, s, kk, false); });
        out.toBlob(function (blob) { chiudi(); opts.onSalva(blob, forme); }, 'image/jpeg', 0.82);
      }
    });
  }

  return { apri: apri, _distanzaDaForma: distanzaDaForma };
})();
