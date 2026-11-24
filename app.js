/* App tecnici RDS Sopralluoghi: login, giro del giorno, scheda con foto, invio con coda offline. */
(function () {
  'use strict';

  /* ---------- utilità ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return ('0' + n).slice(-2); }
  function isoData(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function daIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function giorniDopo(s, n) { var d = daIso(s); d.setDate(d.getDate() + n); return isoData(d); }
  var GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  function etichettaData(s) {
    var d = daIso(s), oggi = isoData(new Date());
    var base = GIORNI[d.getDay()] + ' ' + d.getDate() + '/' + pad(d.getMonth() + 1);
    return s === oggi ? 'Oggi · ' + base : base;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej; r.readAsDataURL(blob);
    });
  }

  /* ---------- archivio locale (IndexedDB) ---------- */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r = indexedDB.open('rds-sopralluoghi', 2);
      r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('coda')) d.createObjectStore('coda', { keyPath: 'codice' }); if (!d.objectStoreNames.contains('bozze')) d.createObjectStore('bozze', { keyPath: 'id' }); if (!d.objectStoreNames.contains('esiti')) d.createObjectStore('esiti', { keyPath: 'codice' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function dbOp(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), req = fn(t.objectStore(store));
        t.oncomplete = function () { res(req ? req.result : undefined); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var dbPut = function (s, o) { return dbOp(s, 'readwrite', function (st) { return st.put(o); }); };
  var dbGet = function (s, k) { return dbOp(s, 'readonly', function (st) { return st.get(k); }); };
  var dbDel = function (s, k) { return dbOp(s, 'readwrite', function (st) { return st.delete(k); }); };
  var dbAll = function (s) { return dbOp(s, 'readonly', function (st) { return st.getAll(); }); };

  /* ---------- stato ---------- */
  var S = {
    sess: null, data: isoData(new Date()), giro: null, offline: false,
    stop: null, bozza: null, inCoda: {}, esiti: {}, sync: false, urls: [], errore: '', ris: null
  };
  function leggiSess() { try { return JSON.parse(localStorage.getItem('rds_sess')); } catch (e) { return null; } }
  function chiaveGiro(d) { return 'rds_giro_' + d; }

  /* ---------- API ---------- */
  function api(azione, payload) {
    var corpo = Object.assign({ azione: azione, token: S.sess ? S.sess.token : '' }, payload || {});
    return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corpo), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { var e = new Error(j.errore || 'Errore del server'); e.auth = !!j.auth; throw e; }
        return j;
      });
  }
  function configurata() { return typeof API_URL === 'string' && /^https:\/\//.test(API_URL); }

  /* ---------- schermate ---------- */
  var app = $('#app');

  function mostraLogin(msg, emailPrec) {
    S.stop = null;
    app.innerHTML =
      '<div class="login"><h1>RDS Sopralluoghi</h1><div class="muto">Accedi con la tua email Gmail e il codice personale.</div>' +
      (configurata() ? '' : '<div class="errore">App non configurata: manca l\'indirizzo del server in config.js.</div>') +
      (msg ? '<div class="errore">' + esc(msg) + '</div>' : '') +
      '<label class="etic">Email</label><input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="off" value="' + esc(emailPrec || localStorage.getItem('rds_email') || '') + '">' +
      '<label class="etic">Codice</label><input id="co" type="password" autocomplete="current-password" inputmode="numeric">' +
      '<div style="height:16px"></div><button class="btn grande" id="entra">Accedi</button>' +
      '<div class="info" style="margin-top:18px">Per installare l\'app sul telefono: dal menu del browser scegli “Aggiungi a schermata Home”.</div></div>';
    $('#entra').onclick = function () {
      var em = $('#em').value.trim(), co = $('#co').value.trim();
      if (!em || !co) { toast('Inserisci email e codice'); return; }
      var b = $('#entra'); b.disabled = true; b.textContent = 'Accesso…';
      api('login', { email: em, codice: co }).then(function (r) {
        S.sess = { token: r.token, nome: r.nome, email: em };
        localStorage.setItem('rds_sess', JSON.stringify(S.sess)); localStorage.setItem('rds_email', em);
        avvia();
      }).catch(function (e) {
        mostraLogin(navigator.onLine ? e.message : 'Nessuna connessione: serve la rete per il primo accesso.', em);
      });
    };
  }

  function esci() {
    localStorage.removeItem('rds_sess'); S.sess = null; S.giro = null; mostraLogin();
  }

  function stopChiusa(t) {
    return !!(t.inviata || t.stato === 'Completato' || t.stato === 'Annullato' || S.inCoda[t.id]);
  }

  function urlNavigaTappa(t) {
    var dest = (t.lat !== null && t.lon !== null) ? t.lat + ',' + t.lon : encodeURIComponent([t.indirizzo, t.comune, t.prov, 'Italia'].join(', '));
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + dest;
  }
  function urlNavigaGiro(tappe) {
    var rimaste = tappe.filter(function (t) { return !stopChiusa(t); }).slice(0, 10);
    if (!rimaste.length) return null;
    function pt(t) { return (t.lat !== null && t.lon !== null) ? t.lat + ',' + t.lon : [t.indirizzo, t.comune, t.prov, 'Italia'].join(', '); }
    var dest = rimaste[rimaste.length - 1], way = rimaste.slice(0, -1).map(pt).join('|');
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(pt(dest)) + (way ? '&waypoints=' + encodeURIComponent(way) : '');
  }

  function mostraGiro() {
    S.stop = null; clearInterval(S.timer);
    var g = S.giro, tappe = g ? g.tappe : [];
    var fatte = tappe.filter(stopChiusa).length;
    var nCoda = Object.keys(S.inCoda).length;
    var html =
      '<div class="barra"><div style="flex:1"><h1>Il mio giro</h1><div class="sotto">' + esc(S.sess.nome) + (S.offline ? ' · offline' : '') + '</div></div>' +
      (nCoda ? '<span class="chip attenzione">' + nCoda + ' da inviare</span>' : '') +
      '<button class="btn-icona" id="agg" aria-label="Aggiorna">⟳</button><button class="btn-icona" id="esci">Esci</button></div>' +
      '<div class="contenuto"><div class="data-nav"><button class="btn sec" id="prec">◀</button><div class="d">' + esc(etichettaData(S.data)) + '</div><button class="btn sec" id="succ">▶</button></div>';
    if (S.errore) html += '<div class="errore">' + esc(S.errore) + '</div>';
    if (!g) html += '<div class="vuoto">Caricamento…</div>';
    else if (!tappe.length) html += '<div class="vuoto">Nessun sopralluogo in programma per questo giorno.</div>';
    else {
      html += '<div class="info"><b>' + fatte + ' fatti su ' + tappe.length + '</b></div>';
      var nav = urlNavigaGiro(tappe);
      if (nav) html += '<a class="btn grande sec" style="margin-bottom:10px" target="_blank" rel="noopener" href="' + nav + '">🧭 Naviga le tappe rimaste</a>';
      tappe.forEach(function (t, i) {
        var chiusa = stopChiusa(t), inCoda = !!S.inCoda[t.id];
        html += '<div class="card' + (chiusa ? ' fatta' : '') + '"><div class="riga"><div class="num">' + (chiusa ? '✓' : (t.ordine < 900 ? t.ordine : i + 1)) + '</div>' +
          '<div style="flex:1;min-width:0"><div class="titolo">' + esc(t.comune) + ' · ' + esc(t.indirizzo) + '</div>' +
          '<div class="muto">' + esc(t.soc) + ' · ' + esc(t.olo) + '</div></div></div>' +
          '<div style="margin-top:6px">' +
          (t.fascia && t.fascia !== 'Libera' ? '<span class="tag giallo">' + esc(t.fascia) + '</span>' : '') +
          (t.prio === 'SCADUTO' ? '<span class="tag scaduto">Scaduto</span>' : t.prio === 'URGENTE' ? '<span class="tag urgente">Urgente</span>' : '') +
          (inCoda ? '<span class="tag giallo">In invio</span>' : (chiusa ? '<span class="tag verde">' + esc(t.inviata || t.stato) + '</span>' : '')) + '</div>' +
          (t.noteUfficio ? '<div class="muto" style="margin-top:6px">📝 ' + esc(t.noteUfficio) + '</div>' : '') +
          '<div class="azioni"><a class="btn sec flex" target="_blank" rel="noopener" href="' + urlNavigaTappa(t) + '">🧭 Naviga</a>' +
          (t.tel ? '<a class="btn sec flex" href="tel:' + esc(String(t.tel).replace(/[^\d+]/g, '')) + '">📞 Chiama</a>' : '') +
          '<button class="btn flex' + (chiusa ? ' sec' : '') + '" data-id="' + esc(t.id) + '">' + (chiusa ? (S.esiti[t.id] ? '💬 Reinvia / Rivedi' : 'Rivedi') : 'Compila scheda') + '</button></div></div>';
      });
    }
    html += '</div>';
    app.innerHTML = html;
    $('#esci').onclick = function () { if (confirm('Uscire dall\'app? Le schede non ancora inviate restano salvate.')) esci(); };
    $('#agg').onclick = function () { caricaGiro(true); };
    $('#prec').onclick = function () { S.data = giorniDopo(S.data, -1); caricaGiro(); };
    $('#succ').onclick = function () { S.data = giorniDopo(S.data, 1); caricaGiro(); };
    app.querySelectorAll('button[data-id]').forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-id'); if (S.esiti[id]) mostraRisultato(S.esiti[id]); else apriScheda(id); }; });
  }

  function caricaGiro(forza) {
    S.giro = null; S.errore = ''; mostraGiro();
    var cache = null; try { cache = JSON.parse(localStorage.getItem(chiaveGiro(S.data))); } catch (e) { cache = null; }
    return aggiornaCoda().then(function () {
      if (!navigator.onLine) { S.offline = true; S.giro = cache || { tappe: [], campi: leggiCampiCache() }; if (!cache) S.errore = 'Sei offline e questo giorno non è stato ancora scaricato.'; mostraGiro(); return; }
      return api('giro', { data: S.data }).then(function (g) {
        S.offline = false; S.giro = g; localStorage.setItem(chiaveGiro(S.data), JSON.stringify(g)); localStorage.setItem('rds_campi', JSON.stringify(g.campi || [])); if (g.cfg) localStorage.setItem('rds_cfg', JSON.stringify(g.cfg));
        mostraGiro(); sincronizza();
      }).catch(function (e) {
        if (e.auth) { esci(); return; }
        S.offline = true; S.giro = cache || { tappe: [], campi: leggiCampiCache() };
        S.errore = cache ? 'Server non raggiungibile: mostro i dati salvati.' : 'Impossibile caricare il giro: ' + e.message;
        mostraGiro();
      });
    });
  }
  function leggiCampiCache() { try { return JSON.parse(localStorage.getItem('rds_campi')) || []; } catch (e) { return []; } }

  /* ---------- scheda ---------- */
  var CFG_DEF = { minSol: 2, posizioni: ['Palifica', 'Facciata edificio', 'Pozzetto', 'Locali tecnici'], esiti: ['Fattibile', 'Fattibile con opere civili', 'Non fattibile'] };
  function cfg() {
    var c = null; try { c = JSON.parse(localStorage.getItem('rds_cfg')); } catch (e) { c = null; }
    return Object.assign({}, CFG_DEF, c || {}, (S.giro && S.giro.cfg) || {});
  }
  function campiCfg() { return S.giro && S.giro.campi && S.giro.campi.length ? S.giro.campi : leggiCampiCache(); }

  function apriScheda(id) {
    var t = S.giro.tappe.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    S.stop = t;
    dbGet('bozze', id).then(function (b) {
      S.bozza = b || { id: id, esito: 'Completato', risposte: {}, sol: [], foto: [] };
      S.bozza.sol = S.bozza.sol || [];
      if (!stopChiusa(t)) { while (S.bozza.sol.length < cfg().minSol) nuovaSol(); }
      mostraScheda();
    });
  }
  function nuovaSol() {
    var n = S.bozza.sol.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1;
    S.bozza.sol.push({ id: n, pos: '', roe: '', cno: '', fea: '', scavo: '', int: '', note: '' });
  }
  var salvaBozzaDebounced = (function () { var tm; return function () { clearTimeout(tm); tm = setTimeout(function () { if (S.bozza) dbPut('bozze', S.bozza); }, 400); }; })();

  function campoVisibile(cf) {
    if (!cf.mostraSe) return true;
    var m = cf.mostraSe.split('='); if (m.length !== 2) return true;
    return String(S.bozza.risposte[m[0].trim()] || '') === m[1].trim();
  }

  function htmlCampo(cf) {
    var v = S.bozza.risposte[cf.k];
    var h = '<div data-campo="' + esc(cf.k) + '"><label class="etic">' + esc(cf.label) + (cf.obb ? ' <span class="obb">*</span>' : '') + '</label>';
    if (cf.tipo === 'sino' || cf.tipo === 'sinona') {
      var opz = cf.tipo === 'sino' ? ['Sì', 'No'] : ['Sì', 'No', 'N.A.'];
      h += '<div class="seg">' + opz.map(function (o) { return '<button type="button" data-k="' + esc(cf.k) + '" data-v="' + o + '" class="' + (v === o ? 'on' : '') + '">' + o + '</button>'; }).join('') + '</div>';
    } else if (cf.tipo === 'scelta') {
      h += '<select data-k="' + esc(cf.k) + '"><option value="">— scegli —</option>' + cf.opzioni.map(function (o) { return '<option' + (v === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (cf.tipo === 'testolungo') {
      h += '<textarea data-k="' + esc(cf.k) + '">' + esc(v || '') + '</textarea>';
    } else if (cf.tipo === 'numero') {
      h += '<input type="number" inputmode="decimal" data-k="' + esc(cf.k) + '" value="' + esc(v === undefined ? '' : v) + '">';
    } else {
      h += '<input type="text" data-k="' + esc(cf.k) + '" value="' + esc(v || '') + '">';
    }
    return h + '</div>';
  }

  function aggiornaVisibilita() {
    campiCfg().forEach(function (cf) {
      var el = app.querySelector('[data-campo="' + cf.k + '"]');
      if (el) el.classList.toggle('nascosto', !campoVisibile(cf));
    });
  }

  function htmlSel(opz, v) { return '<option value="">— scegli —</option>' + opz.map(function (o) { return '<option' + (v === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }

  function htmlSol(s, i, chiusa) {
    var c = cfg(), id = s.id;
    return '<div class="card sol" data-sol="' + id + '"><div class="riga"><div class="titolo" style="flex:1">Soluzione ' + (i + 1) + '</div>' +
      (chiusa ? '' : '<button class="btn-icona sm" data-delsol="' + id + '" aria-label="Elimina soluzione">🗑</button>') + '</div>' +
      '<label class="etic">Posizione <span class="obb">*</span></label><select data-s="' + id + '" data-f="pos">' + htmlSel(c.posizioni, s.pos) + '</select>' +
      '<div class="due"><div><label class="etic">ROE</label><input type="text" data-s="' + id + '" data-f="roe" value="' + esc(s.roe) + '"></div>' +
      '<div><label class="etic">CNO</label><input type="text" data-s="' + id + '" data-f="cno" value="' + esc(s.cno) + '"></div></div>' +
      '<label class="etic">Esito fattibilità <span class="obb">*</span></label><select data-s="' + id + '" data-f="fea">' + htmlSel(c.esiti, s.fea) + '</select>' +
      '<label class="etic">Scavo</label><input type="text" data-s="' + id + '" data-f="scavo" placeholder="es. 15 m su asfalto" value="' + esc(s.scavo) + '">' +
      '<label class="etic">Intervento</label><textarea data-s="' + id + '" data-f="int">' + esc(s.int) + '</textarea>' +
      '<label class="etic">Note</label><textarea data-s="' + id + '" data-f="note">' + esc(s.note) + '</textarea>' +
      htmlFoto(String(id), 'Foto della soluzione', chiusa) + '</div>';
  }
  function htmlFoto(target, titolo, chiusa) {
    return '<label class="etic">' + titolo + '</label>' + (chiusa ? '' : '<div class="azioni"><button class="btn flex" data-scatta="' + target + '">📷 Scatta</button><button class="btn sec flex" data-galleria="' + target + '">🖼 Galleria</button></div>') +
      '<div class="foto-griglia" data-grid="' + target + '"></div>';
  }

  function mostraScheda() {
    var t = S.stop, b = S.bozza, campi = campiCfg(), chiusa = stopChiusa(t);
    var y = window.scrollY || 0;
    app.innerHTML =
      '<div class="barra"><button class="btn-icona" id="indietro">← Giro</button><div style="flex:1"><h1>' + esc(t.comune) + '</h1><div class="sotto">' + esc(t.soc) + ' · ' + esc(t.olo) + '</div></div></div>' +
      '<div class="contenuto">' +
      '<div class="card"><div class="titolo">' + esc(t.indirizzo) + '</div><div class="muto">' + esc(t.comune) + ' (' + esc(t.prov) + ')</div>' +
      (t.cliente ? '<div style="margin-top:6px">👤 ' + esc(t.cliente) + '</div>' : '') +
      (t.tel ? '<div><a href="tel:' + esc(String(t.tel).replace(/[^\d+]/g, '')) + '">📞 ' + esc(t.tel) + '</a></div>' : '') +
      (t.noteUfficio ? '<div class="muto" style="margin-top:6px">📝 ' + esc(t.noteUfficio) + '</div>' : '') + '</div>' +
      (chiusa ? '<div class="info">Questo sopralluogo risulta già chiuso (' + esc(t.inviata || t.stato) + '). Puoi guardarlo, ma l\'invio è bloccato.</div>' : '') +
      '<label class="etic">Esito del sopralluogo</label><div class="seg" id="esito">' +
      ['Completato', 'Da rifare', 'Annullato'].map(function (o) { return '<button type="button" data-esito="' + o + '" class="' + (b.esito === o ? 'on' : '') + '">' + o + '</button>'; }).join('') + '</div>' +
      '<div id="campi">' + campi.map(htmlCampo).join('') + '</div>' +
      '<h2 class="sez">Soluzioni</h2>' + b.sol.map(function (s, i) { return htmlSol(s, i, chiusa); }).join('') +
      (chiusa ? '' : '<button class="btn sec grande" id="addsol">＋ Aggiungi soluzione</button>') +
      '<h2 class="sez">Foto generali</h2>' + htmlFoto('gen', 'Foto del sopralluogo', chiusa) +
      '<input type="file" id="fcam" accept="image/*" capture="environment" class="nascosto"><input type="file" id="fgal" accept="image/*" multiple class="nascosto">' +
      '<div id="errscheda"></div></div>' +
      '<div class="piede-fisso"><div class="in"><button class="btn verde grande" id="invia"' + (chiusa ? ' disabled' : '') + '>✓ Concludi sopralluogo</button></div></div>';
    aggiornaVisibilita(); disegnaGriglie();
    if (y) window.scrollTo(0, y);

    $('#indietro').onclick = function () { if (S.bozza) dbPut('bozze', S.bozza); S.urls.forEach(URL.revokeObjectURL); S.urls = []; mostraGiro(); };
    app.querySelectorAll('#esito button').forEach(function (x) { x.onclick = function () { b.esito = x.dataset.esito; app.querySelectorAll('#esito button').forEach(function (y2) { y2.classList.toggle('on', y2 === x); }); salvaBozzaDebounced(); }; });
    app.querySelectorAll('.seg button[data-k]').forEach(function (x) {
      x.onclick = function () {
        b.risposte[x.dataset.k] = (b.risposte[x.dataset.k] === x.dataset.v) ? '' : x.dataset.v;
        x.parentNode.querySelectorAll('button').forEach(function (y2) { y2.classList.toggle('on', b.risposte[x.dataset.k] === y2.dataset.v); });
        aggiornaVisibilita(); salvaBozzaDebounced();
      };
    });
    app.querySelectorAll('input[data-k],textarea[data-k],select[data-k]').forEach(function (x) {
      x.oninput = x.onchange = function () { b.risposte[x.dataset.k] = x.value; aggiornaVisibilita(); salvaBozzaDebounced(); };
    });
    app.querySelectorAll('[data-s][data-f]').forEach(function (x) {
      x.oninput = x.onchange = function () {
        var s = b.sol.filter(function (z) { return String(z.id) === x.dataset.s; })[0];
        if (s) { s[x.dataset.f] = x.value; salvaBozzaDebounced(); }
      };
    });
    app.querySelectorAll('[data-delsol]').forEach(function (x) {
      x.onclick = function () {
        if (!confirm('Eliminare questa soluzione e le sue foto?')) return;
        var id = +x.dataset.delsol;
        b.sol = b.sol.filter(function (z) { return z.id !== id; });
        b.foto = b.foto.filter(function (f) { return f.sol !== id; });
        dbPut('bozze', b); mostraScheda();
      };
    });
    if ($('#addsol')) $('#addsol').onclick = function () { nuovaSol(); dbPut('bozze', b); mostraScheda(); };
    app.querySelectorAll('[data-scatta]').forEach(function (x) { x.onclick = function () { S.target = x.dataset.scatta; $('#fcam').click(); }; });
    app.querySelectorAll('[data-galleria]').forEach(function (x) { x.onclick = function () { S.target = x.dataset.galleria; $('#fgal').click(); }; });
    $('#fcam').onchange = $('#fgal').onchange = function (e) { aggiungiFoto(Array.prototype.slice.call(e.target.files), S.target); e.target.value = ''; };
    $('#invia').onclick = concludi;
  }

  function disegnaGriglie() {
    S.urls.forEach(URL.revokeObjectURL); S.urls = [];
    app.querySelectorAll('.foto-griglia').forEach(function (g) {
      var tg = g.dataset.grid, html = '';
      S.bozza.foto.forEach(function (f, i) {
        if (String(f.sol || 'gen') !== tg) return;
        var u = URL.createObjectURL(f.ann || f.orig); S.urls.push(u);
        html += '<div class="foto"><img data-i="' + i + '" src="' + u + '" alt="foto ' + f.n + '">' + (f.ann ? '<span class="bollino">modificata</span>' : '') + '<button class="mod" data-mod="' + i + '">✎ Modifica</button><button class="x" data-del="' + i + '" aria-label="Elimina">×</button></div>';
      });
      g.innerHTML = html;
      g.querySelectorAll('img').forEach(function (im) { im.onclick = function () { modificaFoto(+im.dataset.i); }; });
      g.querySelectorAll('button[data-mod]').forEach(function (x) { x.onclick = function () { modificaFoto(+x.dataset.mod); }; });
      g.querySelectorAll('button[data-del]').forEach(function (x) {
        x.onclick = function () { if (confirm('Eliminare questa foto?')) { S.bozza.foto.splice(+x.dataset.del, 1); dbPut('bozze', S.bozza); mostraScheda(); } };
      });
    });
  }

  function comprimi(file) {
    var MAX = 1280, Q = 0.72;
    function dalBitmap(bmp) {
      var s = Math.min(1, MAX / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
      var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return new Promise(function (res) { c.toBlob(function (blob) { res({ blob: blob, w: w, h: h }); }, 'image/jpeg', Q); });
    }
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); }).then(dalBitmap);
    }
    return new Promise(function (res, rej) {
      var im = new Image(), u = URL.createObjectURL(file);
      im.onload = function () { URL.revokeObjectURL(u); res(dalBitmap(im)); };
      im.onerror = rej; im.src = u;
    });
  }

  function aggiungiFoto(files, target) {
    if (!files.length) return;
    var sol = (target && target !== 'gen') ? +target : null;
    toast('Preparo ' + files.length + ' foto…');
    files.reduce(function (p, f) {
      return p.then(function () {
        return comprimi(f).then(function (r) {
          var n = S.bozza.foto.reduce(function (m, x) { return Math.max(m, x.n); }, 0) + 1;
          S.bozza.foto.push({ n: n, orig: r.blob, ann: null, w: r.w, h: r.h, forme: [], sol: sol });
        });
      });
    }, Promise.resolve()).then(function () { return dbPut('bozze', S.bozza); }).then(mostraScheda).catch(function () { toast('Foto non leggibile'); });
  }

  function modificaFoto(i) {
    var f = S.bozza.foto[i];
    Editor.apri({
      blob: f.orig, forme: f.forme,
      onSalva: function (annBlob, forme) { f.ann = annBlob; f.forme = forme; dbPut('bozze', S.bozza); disegnaGriglie(); toast(annBlob ? 'Foto modificata' : 'Nessuna modifica'); }
    });
  }

  /* ---------- scheda finita: testo, PDF, zip ---------- */
  function dataOra(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function soloAscii(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) || 'ND'; }
  function etichettaFoto(b, f) {
    if (!f.sol) return 'Generale';
    var i = b.sol.map(function (s) { return s.id; }).indexOf(f.sol);
    return 'Soluzione ' + (i + 1) + (b.sol[i] && b.sol[i].pos ? ' - ' + b.sol[i].pos : '');
  }
  function fotoOrdinate(b) {
    var out = [];
    b.sol.forEach(function (s) { b.foto.forEach(function (f) { if (f.sol === s.id) out.push(f); }); });
    b.foto.forEach(function (f) { if (!f.sol) out.push(f); });
    return out;
  }
  function costruisciModello(t, b, campi, risposte, adesso) {
    var dati = [['OLO', t.olo], ['Società', t.soc], ['Cliente', t.cliente], ['Indirizzo', t.indirizzo + ', ' + t.comune + (t.prov ? ' (' + t.prov + ')' : '')],
      ['Tecnico', S.sess.nome], ['Data e ora', dataOra(adesso)], ['Esito', b.esito]].filter(function (r) { return r[1]; });
    var rilevati = [];
    campi.forEach(function (cf) { if (risposte[cf.k] !== undefined) rilevati.push([cf.label, risposte[cf.k]]); });
    var sezioni = [{ titolo: 'Dati sopralluogo', righe: dati }];
    if (rilevati.length) sezioni.push({ titolo: 'Verifiche e risposte', righe: rilevati });
    b.sol.forEach(function (s, i) {
      var nf = b.foto.filter(function (f) { return f.sol === s.id; }).length;
      var righe = [['Posizione', s.pos], ['ROE', s.roe], ['CNO', s.cno], ['Esito fattibilità', s.fea], ['Scavo', s.scavo], ['Intervento', s.int], ['Note', s.note]].filter(function (r) { return String(r[1] || '').trim(); });
      if (nf) righe.push(['Foto', String(nf)]);
      if (righe.length) sezioni.push({ titolo: 'Soluzione ' + (i + 1), righe: righe });
    });
    var ord = fotoOrdinate(b);
    return { titolo: 'SCHEDA SOPRALLUOGO', sottotitolo: (t.soc || '') + (t.olo ? ' · ' + t.olo : '') + ' · ' + t.comune, sezioni: sezioni,
      foto: ord.map(function (f) { return { blob: f.ann || f.orig, w: f.w, h: f.h, didascalia: 'Foto ' + f.n + ' – ' + etichettaFoto(b, f) }; }) };
  }
  function modelloATesto(m, nFoto) {
    var o = ['SOPRALLUOGO', ''];
    m.sezioni.forEach(function (s) {
      o.push(s.titolo.toUpperCase());
      s.righe.forEach(function (r) { o.push(r[0] + ': ' + r[1]); });
      o.push('');
    });
    o.push('Foto allegate: ' + nFoto);
    return o.join('\n');
  }
  function caricaLogo() {
    return fetch('logo.jpg').then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (blob) {
      return createImageBitmap(blob).then(function (bm) { return { blob: blob, w: bm.width, h: bm.height }; });
    }).catch(function () { return null; });
  }

  function concludi() {
    var t = S.stop, b = S.bozza, campi = campiCfg(), c = cfg();
    var mancanti = [];
    if (b.esito === 'Completato') {
      campi.forEach(function (cf) { if (cf.obb && campoVisibile(cf) && !String(b.risposte[cf.k] === undefined ? '' : b.risposte[cf.k]).trim()) mancanti.push(cf.label); });
      var compilate = b.sol.filter(function (s) { return s.pos || s.fea || s.roe || s.cno; });
      if (compilate.length < c.minSol) mancanti.push('Almeno ' + c.minSol + ' soluzioni (ne hai compilate ' + compilate.length + ')');
      b.sol.forEach(function (s, i) {
        if (!(s.pos || s.fea || s.roe || s.cno)) return;
        if (!s.pos) mancanti.push('Soluzione ' + (i + 1) + ': posizione');
        if (!s.fea) mancanti.push('Soluzione ' + (i + 1) + ': esito fattibilità');
      });
    }
    if (mancanti.length) { $('#errscheda').innerHTML = '<div class="errore">Compila:<br>• ' + mancanti.map(esc).join('<br>• ') + '</div>'; window.scrollTo(0, document.body.scrollHeight); return; }
    if (!confirm('Concludere il sopralluogo come “' + b.esito + '”?\nLa scheda viene salvata su Drive e potrai inviarla su WhatsApp.')) return;

    var btn = $('#invia'); btn.disabled = true; btn.textContent = 'Preparo scheda e PDF…';
    var risposte = {}; campi.forEach(function (cf) { if (campoVisibile(cf) && b.risposte[cf.k] !== undefined && b.risposte[cf.k] !== '') risposte[cf.k] = b.risposte[cf.k]; });
    var soluzioni = b.sol.filter(function (s) { return s.pos || s.fea || s.roe || s.cno; });
    b.sol = soluzioni;                      // numerazione definitiva senza schede vuote
    var adesso = new Date(), modello = costruisciModello(t, b, campi, risposte, adesso), ord = fotoOrdinate(b);
    var testo = modelloATesto(modello, b.foto.length), nomeBase = soloAscii(t.olo) + '_' + soloAscii(t.comune);
    var fotoMeta = {}; b.foto.forEach(function (f) { fotoMeta[f.n] = etichettaFoto(b, f); });
    var sintesi = soluzioni.map(function (s, i) { return (i + 1) + ') ' + [s.pos, s.fea].filter(Boolean).join(' – '); }).join('; ');
    if (risposte.civico_diverso === 'Sì' && risposte.civico_reale) sintesi = 'Civico corretto: ' + risposte.civico_reale + (sintesi ? ' | ' + sintesi : '');

    caricaLogo().then(function (logo) { modello.logo = logo; return PdfScheda.genera(modello); }).then(function (pdf) {
      return ZipFoto.crea(ord.map(function (f) {
        return { nome: 'foto_' + ('0' + f.n).slice(-2) + '_' + soloAscii(etichettaFoto(b, f)) + '.jpg', blob: f.ann || f.orig };
      })).then(function (zip) { return { pdf: pdf, zip: zip }; });
    }).then(function (r) {
      var codice = uuid();
      var item = {
        codice: codice, id: t.id, esito: b.esito, risposte: risposte, note: risposte.note || '', soluzioni: soluzioni, testo: testo, sintesi: sintesi, fotoMeta: fotoMeta,
        pdf: r.pdf, pdfCaricato: false,
        foto: b.foto.map(function (f) { return { n: f.n, orig: f.orig, ann: f.ann, w: f.w, h: f.h, caricata: { orig: false, ann: false } }; }),
        creato: new Date().toISOString(), tentativi: 0, errore: ''
      };
      var esito = { codice: codice, id: t.id, titolo: (t.olo || '') + ' · ' + t.comune, nomeBase: nomeBase, testo: testo, pdf: r.pdf, zip: b.foto.length ? r.zip : null, creato: item.creato };
      return dbPut('coda', item).then(function () { return dbPut('esiti', esito); }).then(function () { return dbDel('bozze', t.id); }).then(function () {
        S.inCoda[t.id] = true; S.esiti[t.id] = esito; S.bozza = null;
        return potaEsiti();
      }).then(function () { mostraRisultato(esito); sincronizza(); });
    }).catch(function (e) {
      toast('Errore nella preparazione: ' + (e && e.message ? e.message : e));
      var b2 = $('#invia'); if (b2) { b2.disabled = false; b2.textContent = '✓ Concludi sopralluogo'; }
    });
  }
  function potaEsiti() {
    return dbAll('esiti').then(function (es) {
      es.sort(function (a, b) { return a.creato < b.creato ? 1 : -1; });
      return es.slice(15).reduce(function (p, e) { return p.then(function () { return dbDel('esiti', e.codice); }); }, Promise.resolve());
    });
  }

  /* ---------- risultato: Drive + WhatsApp ---------- */
  function mostraRisultato(e) {
    S.stop = null; clearInterval(S.timer);
    app.innerHTML =
      '<div class="barra"><div style="flex:1"><h1>Sopralluogo concluso</h1><div class="sotto">' + esc(e.titolo) + '</div></div></div>' +
      '<div class="contenuto"><div class="ok-box">✓ Scheda pronta</div>' +
      '<div class="info" id="statoDrive">Controllo salvataggio su Drive…</div>' +
      '<button class="btn verde grande" id="wa">💬 Invia su WhatsApp (scheda PDF + testo)</button>' +
      (e.zip ? '<div style="height:8px"></div><button class="btn sec grande" id="waz">🖼 Invia su WhatsApp le foto (zip)</button>' : '') +
      '<div class="azioni"><button class="btn sec flex" id="copia">📋 Copia testo</button><button class="btn sec flex" id="scarica">⬇ Salva PDF</button></div>' +
      '<div style="height:12px"></div><button class="btn grande" id="giro">← Torna al giro</button></div>';
    function stato() {
      var el = $('#statoDrive'); if (!el) { clearInterval(S.timer); return; }
      dbGet('coda', e.codice).then(function (it) {
        el.className = 'info' + (it ? '' : ' ok');
        el.textContent = !it ? '✓ Salvato su Drive: cartella della società, con PDF, foto zippate e testo.'
          : it.errore ? 'Salvataggio su Drive non riuscito (' + it.errore + '). Riprovo appena possibile.'
          : navigator.onLine ? 'Salvataggio su Drive in corso…' : 'Nessuna rete: salverò su Drive appena possibile (puoi già inviare su WhatsApp).';
        if (!it) { clearInterval(S.timer); } else if (navigator.onLine && !S.sync) sincronizza();
      });
    }
    stato(); S.timer = setInterval(stato, 2500);
    function file(blob, nome, tipo) { return new File([blob], nome, { type: tipo }); }
    function condividi(files) {
      var dati = { files: files, text: e.testo, title: e.titolo };
      if (navigator.canShare && navigator.canShare({ files: files })) { navigator.share(dati).catch(function () { /* annullato */ }); return; }
      files.forEach(function (f) { var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); });
      window.open('https://wa.me/?text=' + encodeURIComponent(e.testo), '_blank');
      toast('Allega il file scaricato nella chat');
    }
    $('#wa').onclick = function () { condividi([file(e.pdf, 'Scheda_' + e.nomeBase + '.pdf', 'application/pdf')]); };
    if ($('#waz')) $('#waz').onclick = function () { condividi([file(e.zip, 'Foto_' + e.nomeBase + '.zip', 'application/zip')]); };
    $('#copia').onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(e.testo) : Promise.reject()).then(function () { toast('Testo copiato'); }, function () { toast('Copia non riuscita'); }); };
    $('#scarica').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(e.pdf); a.download = 'Scheda_' + e.nomeBase + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); };
    $('#giro').onclick = function () { clearInterval(S.timer); mostraGiro(); };
  }

  /* ---------- coda e sincronizzazione ---------- */
  function aggiornaCoda() {
    return dbAll('coda').then(function (items) { S.inCoda = {}; items.forEach(function (i) { S.inCoda[i.id] = true; }); })
      .then(function () { return dbAll('esiti'); }).then(function (es) { S.esiti = {}; es.forEach(function (e) { if (!S.esiti[e.id] || S.esiti[e.id].creato < e.creato) S.esiti[e.id] = e; }); });
  }

  function sincronizza() {
    if (S.sync || !navigator.onLine || !S.sess || !configurata()) return Promise.resolve();
    S.sync = true;
    return dbAll('coda').then(function (items) {
      return items.reduce(function (p, item) {
        return p.then(function () { return inviaItem(item); });
      }, Promise.resolve());
    }).catch(function (e) { if (e && e.auth) esci(); }).then(function () {
      S.sync = false; return aggiornaCoda();
    }).then(function () { if (!S.stop && S.sess && $('#agg')) mostraGiro(); });
  }

  function inviaItem(item) {
    var passi = [];
    item.foto.forEach(function (f) {
      ['orig', 'ann'].forEach(function (tipo) {
        if (f[tipo] && !f.caricata[tipo]) passi.push({ f: f, tipo: tipo });
      });
    });
    var inizio = Promise.resolve();
    if (item.pdf && !item.pdfCaricato) {
      inizio = blobToB64(item.pdf).then(function (b64) { return api('file', { codice: item.codice, nome: 'scheda.pdf', dati: b64 }); })
        .then(function () { item.pdfCaricato = true; return dbPut('coda', item); });
    }
    return inizio.then(function () { return passi.reduce(function (p, s) {
      return p.then(function () {
        return blobToB64(s.f[s.tipo]).then(function (b64) {
          return api('foto', { codice: item.codice, n: s.f.n, tipo: s.tipo, w: s.f.w, h: s.f.h, dati: b64 });
        }).then(function () { s.f.caricata[s.tipo] = true; return dbPut('coda', item); });
      });
    }, Promise.resolve()); }).then(function () {
      return api('chiudi', { codice: item.codice, id: item.id, esito: item.esito, risposte: item.risposte, note: item.note, nFoto: item.foto.length,
        testo: item.testo, soluzioni: item.soluzioni, sintesi: item.sintesi, fotoMeta: item.fotoMeta });
    }).then(function () {
      return dbDel('coda', item.codice).then(function () {
        if (S.giro) S.giro.tappe.forEach(function (t) { if (t.id === item.id) t.inviata = item.esito; });
        try { localStorage.setItem(chiaveGiro(S.data), JSON.stringify(S.giro)); } catch (e) { /* ignora */ }
        toast('Salvato su Drive ✓');
      });
    }).catch(function (e) {
      if (e && e.auth) throw e;
      item.tentativi++; item.errore = e && e.message ? e.message : 'errore';
      return dbPut('coda', item).then(function () { S.errore = 'Salvataggio non riuscito (' + item.errore + '). Riproverò appena possibile.'; });
    });
  }

  /* ---------- avvio ---------- */
  function avvia() {
    S.sess = leggiSess();
    if (!S.sess) { mostraLogin(); return; }
    caricaGiro();
  }

  window.addEventListener('online', function () { S.offline = false; sincronizza(); });
  window.addEventListener('offline', function () { S.offline = true; });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sincronizza(); });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* l'app funziona anche senza */ });
  }
  avvia();
})();
