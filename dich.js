/* Dichiarazione del cliente (scavi in proprietà privata): testi, firma sullo schermo, PDF. Usato dall'app e dalla pagina del cliente. */
var Dich = (function () {
  'use strict';
  var DEF = {
    titolo: 'DICHIARAZIONE DEL CLIENTE – PREDISPOSIZIONE IN PROPRIETÀ PRIVATA',
    intro: 'Sopralluogo per la realizzazione del collegamento in fibra ottica – OLO {OLO} – {INDIRIZZO}, {COMUNE}.',
    testo_accetta: 'Il sottoscritto {NOME}, in qualità di proprietario o avente titolo dell\'unità immobiliare sita in {INDIRIZZO}, {COMUNE}, DICHIARA di ACCETTARE che l\'infrastruttura necessaria al collegamento in fibra ottica (scavi, posa di tubazioni, pozzetti e opere accessorie) venga predisposta all\'interno della propria proprietà privata, secondo quanto illustrato dal tecnico incaricato, e di aver compreso il tipo di intervento previsto.',
    testo_rifiuta: 'Il sottoscritto {NOME}, in qualità di proprietario o avente titolo dell\'unità immobiliare sita in {INDIRIZZO}, {COMUNE}, DICHIARA di NON ACCETTARE che l\'infrastruttura necessaria al collegamento in fibra ottica (scavi, posa di tubazioni, pozzetti e opere accessorie) venga predisposta all\'interno della propria proprietà privata, e di essere stato informato che in tal caso il collegamento potrebbe non essere realizzabile e la richiesta potrebbe essere chiusa come rinuncia.',
    conferma: 'Il sottoscritto dichiara che la presente dichiarazione è resa liberamente e che i dati forniti sono veritieri.',
    privacy: 'INFORMATIVA SUL TRATTAMENTO DEI DATI PERSONALI (artt. 13 e 14 del Regolamento UE 2016/679 – GDPR)\nTitolare del trattamento: RDS Impianti.\nFinalità: documentare la scelta espressa dal cliente sulla predisposizione dell\'infrastruttura in proprietà privata e gestire la relativa pratica.\nDati trattati: nome e cognome, indirizzo, telefono, scelta espressa, firma, data e ora e dati tecnici del dispositivo.\nDiritti: accesso, rettifica, cancellazione (nei limiti di legge), limitazione, opposizione, portabilità; reclamo al Garante per la protezione dei dati personali.',
    consenso_privacy: 'Ho letto l\'informativa sul trattamento dei dati personali.'
  };
  function testi() {
    try { var s = JSON.parse(localStorage.getItem('rds_pptesti') || 'null'); if (s) return Object.assign({}, DEF, s); } catch (e) { /* ignora */ }
    return DEF;
  }
  function salvaTesti(t) { try { localStorage.setItem('rds_pptesti', JSON.stringify(t)); } catch (e) { /* ignora */ } }
  function riempi(txt, d) {
    return String(txt || '').replace(/\{NOME\}/g, d.nome || '____________').replace(/\{INDIRIZZO\}/g, d.indirizzo || '').replace(/\{COMUNE\}/g, d.comune || '')
      .replace(/\{OLO\}/g, d.olo || '').replace(/\{SOCIETA\}/g, d.soc || '');
  }
  function testoDichiarazione(tt, scelta, d) { return riempi(scelta === 'Non accetta' ? tt.testo_rifiuta : tt.testo_accetta, d); }

  /* ---- firma con il dito ---- */
  function firma(canvas) {
    var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    var cx = canvas.getContext('2d'), giu = false, ultimo = null, punti = 0;
    cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.lineWidth = 2.6 * dpr; cx.strokeStyle = '#111';
    function pos(e) { var b = canvas.getBoundingClientRect(); return { x: (e.clientX - b.left) * dpr, y: (e.clientY - b.top) * dpr }; }
    canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); giu = true; ultimo = pos(e); try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignora */ } cx.beginPath(); cx.arc(ultimo.x, ultimo.y, cx.lineWidth / 2, 0, 6.3); cx.fillStyle = '#111'; cx.fill(); punti++; });
    canvas.addEventListener('pointermove', function (e) { if (!giu) return; e.preventDefault(); var p = pos(e); cx.beginPath(); cx.moveTo(ultimo.x, ultimo.y); cx.lineTo(p.x, p.y); cx.stroke(); ultimo = p; punti++; });
    function su() { giu = false; }
    canvas.addEventListener('pointerup', su); canvas.addEventListener('pointercancel', su); canvas.addEventListener('pointerleave', su);
    return {
      pulisci: function () { cx.clearRect(0, 0, canvas.width, canvas.height); punti = 0; },
      vuota: function () { return punti < 25; },
      png: function () { return canvas.toDataURL('image/png').split(',')[1]; },
      jpeg: function () {
        var t = document.createElement('canvas'); t.width = canvas.width; t.height = canvas.height;
        var c = t.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, t.width, t.height); c.drawImage(canvas, 0, 0);
        return new Promise(function (res, rej) { t.toBlob(function (b) { b ? res({ blob: b, w: t.width, h: t.height }) : rej(new Error('firma')); }, 'image/jpeg', 0.9); });
      }
    };
  }

  function logo() {
    return fetch('logo.png').then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (blob) {
      return createImageBitmap(blob).then(function (bm) {
        var w = Math.min(bm.width, 600), h = Math.round(bm.height * w / bm.width), cv = document.createElement('canvas');
        cv.width = w; cv.height = h; var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bm, 0, 0, w, h);
        return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res({ blob: b, w: w, h: h }) : rej(); }, 'image/jpeg', 0.92); });
      });
    }).catch(function () { return null; });
  }

  /* p: {tt, d:{nome,indirizzo,comune,olo,soc}, scelta, modalita, dataOra, raccoltaDa, posizione, firmaJpeg:{blob,w,h}} → Promise<Blob PDF> */
  function pdf(p) {
    var dich = riempi(p.tt.intro, p.d) + '\n\n' + testoDichiarazione(p.tt, p.scelta, p.d) + '\n\n' + p.tt.conferma;
    var firmaRighe = [['Firmatario', p.d.nome], ['Scelta del cliente', p.scelta === 'Non accetta' ? 'NON ACCETTA' : 'ACCETTA'], ['Data e ora', p.dataOra], ['Modalità', p.modalita]];
    if (p.raccoltaDa) firmaRighe.push(['Raccolta da', p.raccoltaDa]);
    if (p.posizione) firmaRighe.push(['Posizione', p.posizione]);
    firmaRighe.push(['Privacy', 'Informativa letta e confermata dal firmatario']);
    var modello = {
      titolo: 'DICHIARAZIONE DEL CLIENTE', sottotitolo: 'Predisposizione in proprietà privata · OLO ' + (p.d.olo || '') + (p.d.soc ? ' · ' + p.d.soc : ''),
      sezioni: [
        { titolo: 'Dichiarazione', testo: dich },
        { titolo: 'Firma e dati della dichiarazione', righe: firmaRighe },
        { titolo: 'Informativa privacy', testo: p.tt.privacy }
      ],
      foto: [{ blob: p.firmaJpeg.blob, w: p.firmaJpeg.w, h: p.firmaJpeg.h, didascalia: 'Firma di ' + p.d.nome }],
      titoloFoto: 'FIRMA DEL CLIENTE', piede: 'RDS Impianti – dichiarazione del cliente'
    };
    return logo().then(function (lg) { modello.logo = lg; return PdfScheda.genera(modello); });
  }

  function blobB64(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); });
  }
  function gps() {
    return new Promise(function (res) {
      if (!navigator.geolocation) return res(null);
      var fatto = false, fine = function (v) { if (!fatto) { fatto = true; res(v); } };
      setTimeout(function () { fine(null); }, 7000);
      navigator.geolocation.getCurrentPosition(function (p) { fine({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); }, function () { fine(null); }, { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
    });
  }
  function dataOra(d) {
    function z(n) { return ('0' + n).slice(-2); }
    return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }
  return { DEF: DEF, testi: testi, salvaTesti: salvaTesti, riempi: riempi, testoDichiarazione: testoDichiarazione, firma: firma, pdf: pdf, blobB64: blobB64, gps: gps, dataOra: dataOra };
})();
