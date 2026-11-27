/* App tecnici RDS Sopralluoghi: login, giro del giorno, scheda con foto, invio con coda offline. */
(function () {
  'use strict';

  /* ---------- utilità ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  // più numeri nello stesso campo (separati da ; , / | a capo, " e ", "-" o spazio): ciascuno ha il suo pulsante
  function numeriTel(raw) {
    var parti = String(raw || '').split(/[;,\/|\n\r]+|\s+e\s+|\s+-\s+|\s{2,}/i), out = [];
    parti.forEach(function (p) {
      var cifre = p.replace(/[^\d+]/g, '');
      if (cifre.replace(/\D/g, '').length >= 16) {                       // due numeri attaccati da un solo spazio
        p.trim().split(/\s+/).reduce(function (acc, w) {
          var l = acc.length ? acc[acc.length - 1] : null;
          if (l !== null && (l.replace(/\D/g, '').length < 8)) acc[acc.length - 1] = l + w; else acc.push(w);
          return acc;
        }, []).forEach(function (w) { var c = w.replace(/[^\d+]/g, ''); if (c.replace(/\D/g, '').length >= 6) out.push(c); });
      } else if (cifre.replace(/\D/g, '').length >= 6) out.push(cifre);
    });
    return out.filter(function (n, i) { return out.indexOf(n) === i; });
  }
  function tastiChiama(raw, classe) {
    var n = numeriTel(raw);
    return n.map(function (num, i) {
      return '<a class="' + classe + '" href="tel:' + esc(num) + '">📞 Chiama' + (n.length > 1 ? ' ' + (i + 1) + ' · ' + esc(num.slice(-4)) : '') + '</a>';
    }).join('');
  }
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
      '<button class="btn-icona" id="agg" aria-label="Aggiorna">⟳</button><button class="btn-icona" id="assenze">Ferie</button><button class="btn-icona" id="esci">Esci</button></div>' +
      '<div class="contenuto"><div class="data-nav"><button class="btn sec" id="prec">◀</button><div class="d">' + esc(etichettaData(S.data)) + '</div><button class="btn sec" id="succ">▶</button></div>';
    if (S.errore) html += '<div class="errore">' + esc(S.errore) + '</div>';
    var oggiOk = S.data === isoData(new Date()), gg = giornata();
    if (S.aperta) html += htmlAperta();
    if (oggiOk && gg.inizio) html += htmlGiornata();
    if (oggiOk && !gg.inizio) html += htmlGiornata();                       // prima si timbra l'entrata, poi compare il giro
    else if (!g) html += '<div class="vuoto">Caricamento…</div>';
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
          tastiChiama(t.tel, 'btn sec flex') +
          '<button class="btn flex' + (chiusa ? ' sec' : '') + '" data-id="' + esc(t.id) + '">' + (chiusa ? (S.esiti[t.id] ? '💬 Reinvia / Rivedi' : 'Rivedi') : 'Compila scheda') + '</button></div></div>';
      });
    }
    html += '</div>';
    app.innerHTML = html;
    var ggI = $('#gg-inizio'), ggF = $('#gg-fine'), apI = $('#ap-invia');
    if (ggI) ggI.onclick = timbraEntrata;
    if (ggF) ggF.onclick = timbraUscita;
    if (apI) apI.onclick = correggiUscita;
    trkRiprendi();
    $('#assenze').onclick = mostraAssenze;
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
        mostraGiro(); sincronizza(); sincTimbratura();
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
    S.stop = t; S.ppVerbale = false;
    (function () { var k = 'rds_posap_' + t.id + '_' + isoData(new Date()); if (!localStorage.getItem(k)) { try { localStorage.setItem(k, '1'); } catch (e) { /* ignora */ } registraPos('Apertura tappa', t); } })();
    if (!S.ppAgg) { S.ppAgg = true; api('ppTesti').then(function (j) { if (j.testi) Dich.salvaTesti(j.testi); }).catch(function () { /* usa i testi già presenti */ }); }
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
    if (typeof disegnaPP === 'function' && app.querySelector('#blocco-pp')) { var gia = !app.querySelector('#blocco-pp').classList.contains('nascosto'); if (gia !== ppVisibile()) disegnaPP(); }
    campiCfg().forEach(function (cf) {
      var el = app.querySelector('[data-campo="' + cf.k + '"]');
      if (el) el.classList.toggle('nascosto', !campoVisibile(cf));
    });
  }



  /* ---- posizione registrata solo in momenti precisi (inizio/fine giornata, apertura e chiusura di una tappa) ---- */
  var POS_KEY = 'rds_pos';
  function posCoda() { try { return JSON.parse(localStorage.getItem(POS_KEY)) || []; } catch (e) { return []; } }
  function posSalva(c) { try { localStorage.setItem(POS_KEY, JSON.stringify(c.slice(-300))); } catch (e) { /* ignora */ } }
  function inviaPos() {
    var c = posCoda();
    if (!c.length || !navigator.onLine || !S.sess || !configurata() || S.posInvio) return Promise.resolve();
    S.posInvio = true;
    var lotto = c.slice(0, 40);
    return api('pos', { eventi: lotto }).then(function () {
      var fatti = {}; lotto.forEach(function (x) { fatti[x.id] = 1; });
      posSalva(posCoda().filter(function (x) { return !fatti[x.id]; }));
    }).catch(function () { /* riprova al prossimo invio */ }).then(function () { S.posInvio = false; });
  }
  function registraPos(ev, t) {
    var e = { id: uuid(), ev: ev, sopr: t ? t.id : '', ts: new Date().toISOString() };
    Dich.gps().then(function (g) { if (g) { e.lat = g.lat; e.lon = g.lon; e.acc = g.acc; } }).catch(function () { /* senza posizione */ })
      .then(function () { var c = posCoda(); c.push(e); posSalva(c); return inviaPos(); });
  }
  function giornata() { try { return JSON.parse(localStorage.getItem('rds_gg_' + isoData(new Date()))) || {}; } catch (e) { return {}; } }
  function oraBreve(iso) { var d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function htmlGiornata() {
    var g = giornata();
    if (!g.inizio) return '<div class="card"><h2 style="margin:0 0 6px">Timbratura</h2><button type="button" class="btn verde grande" id="gg-inizio">▶ Timbra entrata</button>' +
      '<div class="muto" style="margin-top:8px">Dopo la timbratura vedi il giro. Da quel momento, e fino alla timbratura di uscita, l\'app registra la tua posizione ogni pochi minuti finché è aperta. ' +
      'Fuori dall\'orario timbrato non viene registrato nulla. Informativa completa in ufficio.</div></div>';
    if (!g.fine) {
      var n = trkCoda().length;
      return '<div class="card"><div class="riga"><div style="flex:1"><b>Entrata timbrata alle ' + oraBreve(g.inizio) + '</b>' +
        '<div class="muto">📍 Tracciamento attivo' + (S.trkOk === false ? ' · <b style="color:var(--rosso)">posizione non disponibile: controlla i permessi</b>' : '') + (n ? ' · ' + n + ' punti da inviare' : '') + '</div></div>' +
        '<button type="button" class="btn rosso" id="gg-fine">■ Timbra uscita</button></div></div>';
    }
    return '<div class="card fatta"><b>Giornata conclusa</b> · dalle ' + oraBreve(g.inizio) + ' alle ' + oraBreve(g.fine) + '</div>';
  }
  function salvaGiornata(g) { try { localStorage.setItem('rds_gg_' + isoData(new Date()), JSON.stringify(g)); } catch (e) { /* ignora */ } }
  function timbraEntrata() {
    var g = giornata(); if (g.inizio) return;
    g.inizio = new Date().toISOString(); salvaGiornata(g);
    registraPos('Inizio giornata'); trkAvvia(); mostraGiro(); toast('Entrata timbrata. Buon lavoro!');
  }
  function timbraUscita() {
    var g = giornata(); if (!g.inizio || g.fine) return;
    var aperte = S.giro ? S.giro.tappe.filter(function (t) { return !stopChiusa(t); }).length : 0;
    var msg = aperte ? 'Hai ancora ' + aperte + (aperte === 1 ? ' scheda' : ' schede') + ' non chiusa/e. Timbrare comunque l\'uscita?' : 'Timbrare l\'uscita e concludere la giornata?';
    if (!confirm(msg)) return;
    trkCampiona(); g.fine = new Date().toISOString(); salvaGiornata(g);
    registraPos('Fine giornata'); trkFerma(); setTimeout(inviaTraccia, 1500); mostraGiro(); toast('Uscita timbrata. A domani!');
  }

  /* ---- tracciamento GPS tra entrata e uscita: un punto ogni pochi minuti, solo con l'app aperta ---- */
  var TRK_KEY = 'rds_trk', TRK_MS = 3 * 60000;
  function trkCoda() { try { return JSON.parse(localStorage.getItem(TRK_KEY)) || []; } catch (e) { return []; } }
  function trkSalva(c) { try { localStorage.setItem(TRK_KEY, JSON.stringify(c.slice(-600))); } catch (e) { /* ignora */ } }
  function trkAttivo() { var g = giornata(); return !!g.inizio && !g.fine && !!S.sess; }
  function trkCampiona() {
    if (!trkAttivo() || S.trkBusy || !navigator.geolocation) return;
    S.trkBusy = true;
    navigator.geolocation.getCurrentPosition(function (p) {
      S.trkBusy = false; S.trkOk = true; S.trkUlt = Date.now();
      var c = trkCoda(); c.push({ id: uuid(), ts: new Date().toISOString(), lat: Math.round(p.coords.latitude * 1e6) / 1e6, lon: Math.round(p.coords.longitude * 1e6) / 1e6, acc: Math.round(p.coords.accuracy) });
      trkSalva(c); if (c.length >= 5) inviaTraccia();
    }, function () { S.trkBusy = false; S.trkOk = false; }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 25000 });
  }
  function trkAvvia() { trkRiprendi(); trkCampiona(); }
  function trkRiprendi() {
    if (trkAttivo()) {
      if (!S.trkTimer) {
        S.trkTimer = setInterval(trkCampiona, TRK_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden && trkAttivo() && (!S.trkUlt || Date.now() - S.trkUlt > 60000)) trkCampiona(); });
      }
      if (!S.trkUlt) trkCampiona();
    } else trkFerma();
  }
  function trkFerma() { if (S.trkTimer) { clearInterval(S.trkTimer); S.trkTimer = null; } }
  function inviaTraccia() {
    var c = trkCoda();
    if (!c.length || !navigator.onLine || !S.sess || !configurata() || S.trkInvio) return Promise.resolve();
    S.trkInvio = true;
    var lotto = c.slice(0, 50);
    return api('traccia', { punti: lotto }).then(function () {
      var fatti = {}; lotto.forEach(function (x) { fatti[x.id] = 1; });
      trkSalva(trkCoda().filter(function (x) { return !fatti[x.id]; }));
    }).catch(function () { /* riprova al prossimo invio */ }).then(function () { S.trkInvio = false; });
  }

  /* ---- sincronizza con il server (app reinstallata, altro telefono) e gestisce l'uscita dimenticata ---- */
  function sincTimbratura() {
    if (!navigator.onLine || !S.sess || !configurata()) return;
    api('timbraStato').then(function (j) {
      var g = giornata();
      if (j.oggi && j.oggi.inizio && !g.inizio) { g.inizio = j.oggi.inizio; if (j.oggi.fine) g.fine = j.oggi.fine; salvaGiornata(g); }
      else if (j.oggi && j.oggi.fine && !g.fine) { g.fine = j.oggi.fine; salvaGiornata(g); }
      var ap = j.aperta || null;
      if (JSON.stringify(ap) !== JSON.stringify(S.aperta)) { S.aperta = ap; if (!S.stop && $('#agg')) mostraGiro(); }
      else if (j.oggi && !S.stop && $('#agg') && ((j.oggi.inizio && !g.inizio) || false)) mostraGiro();
    }).catch(function () { /* senza rete: vale lo stato locale */ });
  }
  function htmlAperta() {
    var a = S.aperta, d = new Date(a.data + 'T12:00:00');
    return '<div class="card" style="border-left:4px solid var(--rosso)"><b>Uscita non timbrata</b><div class="muto">Il ' + d.getDate() + '/' + (d.getMonth() + 1) + ' hai timbrato l\'entrata alle ' + oraBreve(a.inizio) + ' ma non l\'uscita. A che ora hai finito?</div>' +
      '<div class="riga" style="margin-top:8px"><input type="time" id="ap-ora" value="18:00" style="flex:1"><button type="button" class="btn" id="ap-invia">Invia</button></div>' +
      '<input type="text" id="ap-motivo" placeholder="Motivo (es. batteria scarica, dimenticanza)" style="margin-top:6px;width:100%"><div class="muto">L\'ufficio controllerà l\'orario.</div></div>';
  }
  function correggiUscita() {
    var ora = ($('#ap-ora').value || '').trim(), motivo = ($('#ap-motivo').value || '').trim();
    if (!/^\d{2}:\d{2}$/.test(ora)) { toast('Indica l\'ora di uscita'); return; }
    if (!motivo) { toast('Scrivi il motivo'); return; }
    api('timbraCorreggi', { data: S.aperta.data, ora: ora, motivo: motivo }).then(function () { S.aperta = null; toast('Inviato all\'ufficio'); mostraGiro(); })
      .catch(function (e) { toast('Non inviato: ' + e.message); });
  }

  /* ---------- ferie, permessi, malattia ---------- */
  function dataIt(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function mostraAssenze() {
    S.stop = null; clearInterval(S.timer);
    var oggi = isoData(new Date());
    app.innerHTML =
      '<div class="barra"><button class="btn-icona" id="as-indietro">◀</button><div style="flex:1"><h1>Ferie e permessi</h1><div class="sotto">' + esc(S.sess.nome) + '</div></div></div>' +
      '<div class="contenuto"><div class="card"><b>Nuova richiesta</b>' +
      '<label class="etic">Tipo</label><select id="as-tipo"><option>Ferie</option><option>Permesso</option><option>Malattia</option><option>Altro</option></select>' +
      '<label class="etic">Dal</label><input type="date" id="as-dal" value="' + oggi + '">' +
      '<label class="etic" id="as-al-e">Al</label><input type="date" id="as-al" value="' + oggi + '">' +
      '<div id="as-ore-b" style="display:none"><label class="etic">Quante ore di permesso? (es. 2 oppure 1.5)</label><input type="number" id="as-ore" step="0.5" min="0.5" max="12" inputmode="decimal"></div>' +
      '<label class="etic">Note (facoltative)</label><input type="text" id="as-note" maxlength="200">' +
      '<div class="azioni"><button type="button" class="btn flex" id="as-invia">Invia richiesta</button></div><div id="as-err" class="errore" style="display:none"></div></div>' +
      '<h2 class="sez">Le mie richieste</h2><div id="as-lista" class="muto">Caricamento…</div></div>';
    $('#as-indietro').onclick = mostraGiro;
    $('#as-tipo').onchange = function () { var p = $('#as-tipo').value === 'Permesso'; $('#as-ore-b').style.display = p ? '' : 'none'; };
    $('#as-invia').onclick = function () {
      var e = $('#as-err'), tipo = $('#as-tipo').value, dal = $('#as-dal').value, al = $('#as-al').value, ore = $('#as-ore').value;
      e.style.display = 'none';
      var err = !dal || !al ? 'Indica le date.' : al < dal ? 'La data di fine è prima di quella di inizio.' : '';
      if (!err && tipo === 'Permesso' && ore !== '' && !(Number(ore) > 0 && Number(ore) <= 12)) err = 'Ore non valide.';
      if (err) { e.textContent = err; e.style.display = ''; return; }
      if (!navigator.onLine) { e.textContent = 'Serve la connessione per inviare la richiesta.'; e.style.display = ''; return; }
      $('#as-invia').disabled = true;
      api('assenzaRichiedi', { tipo: tipo, dal: dal, al: al, ore: tipo === 'Permesso' ? ore : '', note: $('#as-note').value }).then(function () { toast('Richiesta inviata'); mostraAssenze(); })
        .catch(function (x) { $('#as-invia').disabled = false; e.textContent = x.message; e.style.display = ''; });
    };
    if (!navigator.onLine) { $('#as-lista').textContent = 'Sei offline: le richieste non sono disponibili.'; return; }
    api('assenzeLista').then(function (j) {
      var l = j.assenze || [];
      if (!l.length) { $('#as-lista').textContent = 'Nessuna richiesta.'; return; }
      $('#as-lista').innerHTML = l.map(function (a) {
        var cl = a.stato === 'Approvata' ? 'verde' : a.stato === 'Rifiutata' ? 'scaduto' : a.stato === 'Annullata' ? '' : 'giallo';
        return '<div class="card"><div class="riga"><div style="flex:1"><b>' + esc(a.tipo) + '</b> · ' + dataIt(a.dal) + (a.al !== a.dal ? ' → ' + dataIt(a.al) : '') + (a.ore ? ' · ' + a.ore + ' h' : '') +
          '<div><span class="tag ' + cl + '">' + esc(a.stato) + '</span></div>' + (a.noteUfficio ? '<div class="muto">Ufficio: ' + esc(a.noteUfficio) + '</div>' : '') + '</div>' +
          (a.stato === 'Richiesta' ? '<button type="button" class="btn sec" data-an="' + esc(a.id) + '">Annulla</button>' : '') + '</div></div>';
      }).join('');
      $('#as-lista').querySelectorAll('button[data-an]').forEach(function (b) {
        b.onclick = function () { if (!confirm('Annullare la richiesta?')) return; api('assenzaAnnulla', { id: b.getAttribute('data-an') }).then(mostraAssenze).catch(function (x) { toast(x.message); }); };
      });
    }).catch(function (x) { if (x.auth) { esci(); return; } $('#as-lista').textContent = 'Non riesco a caricare le richieste: ' + x.message; });
  }

  /* ---- dichiarazione del cliente (scavi in proprietà privata) ---- */
  function ppVisibile() { var b = S.bozza; return !!b && b.esito === 'Completato' && !!b.risposte && b.risposte.scavi_pp === 'Sì'; }
  function ppDati(t, nome) { return { nome: nome || t.cliente || '', indirizzo: t.indirizzo, comune: t.comune, olo: t.olo, soc: t.soc }; }
  function waNumero(n) {
    var c = String(n).replace(/[^\d+]/g, '');
    if (c.indexOf('+') === 0) return c.slice(1);
    if (c.indexOf('00') === 0) return c.slice(2);
    if (c.length === 10 && c.charAt(0) === '3') return '39' + c;
    if (c.charAt(0) === '0') return '39' + c;
    return c;
  }
  function ppSincronizza() {          // la scelta del cliente riempie "Cliente accetta" della checklist
    var b = S.bozza, p = b && b.pp;
    if (!p || !p.scelta) return;
    b.risposte.cliente_accetta = p.scelta === 'Accetta' ? 'Sì' : 'No';
  }
  function htmlPP(t, b, chiusa) {
    var p = b.pp, h = '<h2 class="sez">Dichiarazione del cliente – proprietà privata <span class="obb">*</span></h2>';
    var scelta = function (v) { return v === 'Non accetta' ? '<b style="color:var(--rosso)">NON ACCETTA</b>' : '<b style="color:var(--verde)">ACCETTA</b>'; };
    if (S.ppVerbale && !p) {
      return h + '<div class="card"><div class="info">Prova più debole: la dichiarazione è solo tua. Usala solo se il cliente non può firmare né aprire il link.</div>' +
        '<label class="etic">Cosa ha dichiarato il cliente?</label><div class="seg" id="ppv-sc"><button type="button" data-v="Accetta">ACCETTA</button><button type="button" data-v="Non accetta">NON ACCETTA</button></div>' +
        '<label class="etic">Motivo per cui non c\'è la firma <span class="obb">*</span></label><textarea id="ppv-motivo" placeholder="es. cliente al telefono, senza WhatsApp; rifiuta di firmare…"></textarea>' +
        '<div class="azioni"><button type="button" class="btn sec flex" data-pp="annulla">Annulla</button><button type="button" class="btn flex" data-pp="verbale-salva">Salva</button></div><div id="ppv-err"></div></div>';
    }
    if (!p) {
      var nn = numeriTel(t.tel);
      return h + '<div class="info">È obbligatorio lasciare una traccia della scelta del cliente sugli scavi in proprietà privata. Come l\'hai raccolta?</div>' +
        '<div class="azioni" style="flex-direction:column">' +
        '<button type="button" class="btn grande" data-pp="persona"' + (chiusa ? ' disabled' : '') + '>✍ Il cliente firma qui, adesso</button>' +
        (nn.length ? nn.map(function (n) { return '<button type="button" class="btn grande" data-pp="link" data-n="' + esc(n) + '"' + (chiusa ? ' disabled' : '') + '>📲 Invia il link su WhatsApp' + (nn.length > 1 ? ' · ' + esc(n.slice(-4)) : '') + '</button>'; }).join('')
          : '<div class="errore">Manca il telefono del cliente: non posso inviare il link.</div>') +
        '<button type="button" class="btn sec grande" data-pp="verbale"' + (chiusa ? ' disabled' : '') + '>🗣 Solo verbale (senza firma)</button></div>';
    }
    var corpo;
    if (p.modalita === 'Di persona') corpo = '<div class="ok-box" style="font-size:16px">✓ Firmata di persona</div><div>' + esc(p.nome) + ' · ' + scelta(p.scelta) + '</div><div class="muto">' + esc(p.dataOra || '') + (p.gps ? ' · posizione registrata' : ' · posizione non disponibile') + '</div>';
    else if (p.modalita === 'A distanza') {
      var st = p.stato || 'In attesa';
      corpo = '<div class="' + (st === 'Firmata' ? 'ok-box' : 'info') + '" style="font-size:16px">' + (st === 'Firmata' ? '✓ Il cliente ha firmato' : st === 'Scaduto' ? '⚠ Link scaduto' : '⏳ Link inviato, in attesa del cliente') + '</div>' +
        (p.scelta ? '<div>' + esc(p.firmatario || '') + ' · ' + scelta(p.scelta) + '</div>' : '') +
        '<div class="azioni"><button type="button" class="btn sec flex" data-pp="stato">↻ Controlla stato</button>' + (st !== 'Firmata' ? '<button type="button" class="btn sec flex" data-pp="reinvia">📲 Reinvia</button>' : '') + '</div>' +
        (st !== 'Firmata' ? '<div class="muto" style="margin-top:6px">Puoi concludere il sopralluogo anche se il cliente non ha ancora firmato: l\'ufficio vedrà “in attesa” e non chiuderà la pratica come rinuncia.</div>' : '');
    } else corpo = '<div class="info" style="border-left:4px solid var(--arancio)"><b>⚠ Solo verbale</b> – ' + scelta(p.scelta) + '<br>' + esc(p.motivo || '') + '</div>';
    return h + '<div class="card">' + corpo + (chiusa ? '' : '<div class="azioni"><button type="button" class="btn sec flex" data-pp="reset">Cambia modalità</button></div>') + '</div>';
  }
  function disegnaPP() {
    var el = $('#blocco-pp'); if (!el) return;
    var vis = ppVisibile();
    el.classList.toggle('nascosto', !vis);
    if (!vis) return;
    el.innerHTML = htmlPP(S.stop, S.bozza, stopChiusa(S.stop));
    el.querySelectorAll('[data-pp]').forEach(function (x) { x.onclick = function () { azionePP(x.dataset.pp, x); }; });
    var sc = el.querySelector('#ppv-sc');
    if (sc) sc.querySelectorAll('button').forEach(function (x) { x.onclick = function () { sc.dataset.v = x.dataset.v; sc.querySelectorAll('button').forEach(function (y) { y.classList.toggle('on', y === x); }); }; });
  }
  function aggiornaCampiPP() {          // cambia la risposta "Cliente accetta" mostrata
    var b = S.bozza;
    app.querySelectorAll('.seg button[data-k="cliente_accetta"]').forEach(function (x) { x.classList.toggle('on', b.risposte.cliente_accetta === x.dataset.v); });
  }
  function azionePP(a, el) {
    var b = S.bozza, t = S.stop;
    if (a === 'persona') return apriFirmaPP();
    if (a === 'verbale') { S.ppVerbale = true; return disegnaPP(); }
    if (a === 'annulla') { S.ppVerbale = false; return disegnaPP(); }
    if (a === 'verbale-salva') {
      var v = ($('#ppv-sc') || {}).dataset ? $('#ppv-sc').dataset.v : '', mot = ($('#ppv-motivo') || {}).value || '';
      if (!v || !mot.trim()) { $('#ppv-err').innerHTML = '<div class="errore">Scegli cosa ha dichiarato il cliente e scrivi il motivo.</div>'; return; }
      b.pp = { modalita: 'Solo verbale', scelta: v, motivo: mot.trim(), ts: new Date().toISOString() };
      S.ppVerbale = false; ppSincronizza(); aggiornaCampiPP(); dbPut('bozze', b); return disegnaPP();
    }
    if (a === 'reset') {
      if (!confirm('Vuoi cambiare modalità? La dichiarazione attuale non verrà usata.')) return;
      b.pp = null; dbPut('bozze', b); return disegnaPP();
    }
    if (a === 'link' || a === 'reinvia') return inviaLinkPP(a === 'link' ? el.dataset.n : (b.pp && b.pp.numero));
    if (a === 'stato') return statoPP();
  }
  function inviaLinkPP(numero) {
    var b = S.bozza, t = S.stop;
    if (!numero) { toast('Numero del cliente mancante'); return; }
    toast('Preparo il link…');
    api('ppCrea', { id: t.id }).then(function (j) {
      var link = new URL('dichiarazione.html?t=' + j.token, location.href).href;
      b.pp = { modalita: 'A distanza', token: j.token, numero: numero, stato: 'In attesa', creato: new Date().toISOString() };
      dbPut('bozze', b); disegnaPP();
      var msg = 'Buongiorno, sono ' + (S.sess ? S.sess.nome : 'il tecnico') + ' di RDS Impianti. Come da nostra telefonata, la prego di aprire questo link per confermare se ACCETTA o NON ACCETTA che l\'infrastruttura in fibra ottica venga predisposta nella sua proprietà privata in ' + t.indirizzo + ', ' + t.comune + '. Richiede un minuto: legga, scelga e firmi con il dito.\n' + link + '\nGrazie.';
      window.open('https://wa.me/' + waNumero(numero) + '?text=' + encodeURIComponent(msg), '_blank');
    }).catch(function (e) { toast('Link non creato: ' + e.message); });
  }
  function statoPP() {
    var b = S.bozza, t = S.stop;
    api('ppStato', { id: t.id }).then(function (j) {
      if (!b.pp || b.pp.modalita !== 'A distanza') return;
      b.pp.stato = j.stato || 'In attesa';
      if (j.stato === 'Firmata') { b.pp.scelta = j.scelta; b.pp.firmatario = j.firmatario; ppSincronizza(); aggiornaCampiPP(); }
      dbPut('bozze', b); disegnaPP(); toast(j.stato === 'Firmata' ? 'Il cliente ha firmato ✓' : 'Ancora in attesa');
    }).catch(function (e) { toast('Controllo non riuscito: ' + e.message); });
  }
  function apriFirmaPP() {
    var t = S.stop, b = S.bozza, tt = Dich.testi(), scelta = '', ov = document.createElement('div');
    ov.className = 'pp-over';
    ov.innerHTML = '<div class="pp-in"><h1 style="font-size:19px;color:#4A4F57;margin:0 0 6px">Dichiarazione del cliente</h1>' +
      '<div class="info">Passa il telefono al cliente: deve leggere, scegliere e firmare.</div>' +
      '<div class="muto">' + esc(Dich.riempi(tt.intro, ppDati(t))) + '</div>' +
      '<label class="etic">Scelta del cliente</label><div class="seg" id="pps"><button type="button" data-v="Accetta">ACCETTA</button><button type="button" data-v="Non accetta">NON ACCETTA</button></div>' +
      '<div class="pp-testo" id="pptesto">Scegli una delle due opzioni per leggere la dichiarazione.</div>' +
      '<label class="etic">Nome e cognome del firmatario <span class="obb">*</span></label><input type="text" id="ppnome" value="' + esc(t.cliente || '') + '">' +
      '<details><summary>Informativa privacy (tocca per leggere)</summary><div class="pp-testo">' + esc(tt.privacy) + '</div></details>' +
      '<label class="chk"><input type="checkbox" id="pppriv"><span>' + esc(tt.consenso_privacy) + '</span></label>' +
      '<label class="etic">Firma con il dito <span class="obb">*</span></label><canvas class="firma" id="ppfirma"></canvas>' +
      '<div class="azioni"><button type="button" class="btn sec" id="ppclear">Cancella firma</button></div><div id="pperr"></div>' +
      '<div class="azioni" style="margin-top:14px"><button type="button" class="btn sec flex" id="ppannulla">Annulla</button><button type="button" class="btn verde flex" id="ppok">✓ Conferma e salva</button></div></div>';
    document.body.appendChild(ov);
    var fm = Dich.firma($('#ppfirma', ov));
    function agg() { var d = ppDati(t, $('#ppnome', ov).value.trim()); $('#pptesto', ov).textContent = scelta ? Dich.testoDichiarazione(tt, scelta, d) + '\n\n' + tt.conferma : 'Scegli una delle due opzioni per leggere la dichiarazione.'; }
    ov.querySelectorAll('#pps button').forEach(function (x) { x.onclick = function () { scelta = x.dataset.v; ov.querySelectorAll('#pps button').forEach(function (y) { y.classList.toggle('on', y === x); }); agg(); }; });
    $('#ppnome', ov).oninput = agg;
    $('#ppclear', ov).onclick = function () { fm.pulisci(); };
    $('#ppannulla', ov).onclick = function () { ov.remove(); };
    $('#ppok', ov).onclick = function () {
      var errs = [], nome = $('#ppnome', ov).value.trim(), er = $('#pperr', ov);
      if (!scelta) errs.push('Scegli ACCETTA oppure NON ACCETTA');
      if (nome.length < 3) errs.push('Scrivi nome e cognome');
      if (!$('#pppriv', ov).checked) errs.push('Conferma di aver letto l\'informativa privacy');
      if (fm.vuota()) errs.push('Firma nello spazio tratteggiato');
      if (errs.length) { er.innerHTML = '<div class="errore">Per continuare:<br>• ' + errs.map(esc).join('<br>• ') + '</div>'; return; }
      var btn = $('#ppok', ov); btn.disabled = true; btn.textContent = 'Salvo…';
      var adesso = new Date(), png = fm.png(), d = ppDati(t, nome), gpsRes = null;
      Dich.gps().then(function (g) { gpsRes = g; return fm.jpeg(); }).then(function (fj) {
        return Dich.pdf({ tt: tt, d: d, scelta: scelta, modalita: 'Di persona (firma sul telefono del tecnico)', dataOra: Dich.dataOra(adesso), raccoltaDa: S.sess ? S.sess.nome : '',
          posizione: gpsRes ? 'GPS ' + gpsRes.lat.toFixed(5) + ', ' + gpsRes.lon.toFixed(5) + ' (±' + Math.round(gpsRes.acc) + ' m)' : 'non disponibile', firmaJpeg: fj });
      }).then(function (pdf) {
        b.pp = { modalita: 'Di persona', scelta: scelta, nome: nome, firmaPng: png, pdf: pdf, gps: gpsRes, ts: adesso.toISOString(), dataOra: Dich.dataOra(adesso) };
        ppSincronizza(); aggiornaCampiPP(); return dbPut('bozze', b);
      }).then(function () { ov.remove(); disegnaPP(); toast('Dichiarazione salvata ✓'); })
        .catch(function (e) { btn.disabled = false; btn.textContent = '✓ Conferma e salva'; er.innerHTML = '<div class="errore">Non riesco a salvare: ' + esc(e && e.message ? e.message : 'errore') + '</div>'; });
    };
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
      (t.tel ? '<div class="azioni" style="margin-top:6px">' + numeriTel(t.tel).map(function (n) { return '<a class="btn sec" href="tel:' + esc(n) + '">📞 ' + esc(n) + '</a>'; }).join('') + '</div>' : '') +
      (t.noteUfficio ? '<div class="muto" style="margin-top:6px">📝 ' + esc(t.noteUfficio) + '</div>' : '') + '</div>' +
      (chiusa ? '<div class="info">Questo sopralluogo risulta già chiuso (' + esc(t.inviata || t.stato) + '). Puoi guardarlo, ma l\'invio è bloccato.</div>' : '') +
      '<label class="etic">Esito del sopralluogo</label><div class="seg" id="esito">' +
      ['Completato', 'Da rimodulare', 'Annullato'].map(function (o) { return '<button type="button" data-esito="' + o + '" class="' + (b.esito === o ? 'on' : '') + '">' + o + '</button>'; }).join('') + '</div>' +
      '<div id="blocco-rim" class="nascosto"><div class="info" style="border-left:4px solid var(--arancio)"><b>DA RIMODULARE</b><br>Scrivi il motivo e scatta una foto che dimostri che sei presente al civico: senza foto non puoi chiudere. Il sopralluogo torna in “Da fare” per l\'ufficio (la SLA continua a salire).</div>' +
      '<label class="etic">Motivo del rimodulo <span class="obb">*</span></label><textarea id="motivo-rim" placeholder="es. cliente assente, accesso non possibile, indirizzo errato…">' + esc(b.motivo || '') + '</textarea></div>' +
      '<div id="campi">' + campi.map(htmlCampo).join('') + '</div>' +
      '<div id="blocco-pp" class="nascosto"></div>' +
      '<div id="blocco-sol"><h2 class="sez">Soluzioni</h2>' + b.sol.map(function (s, i) { return htmlSol(s, i, chiusa); }).join('') +
      (chiusa ? '' : '<button class="btn sec grande" id="addsol">＋ Aggiungi soluzione</button>') + '</div>' +
      '<h2 class="sez" id="tit-foto">Foto generali</h2>' + htmlFoto('gen', 'Foto del sopralluogo', chiusa) +
      '<input type="file" id="fcam" accept="image/*" capture="environment" class="nascosto"><input type="file" id="fgal" accept="image/*" multiple class="nascosto">' +
      '<div id="errscheda"></div></div>' +
      '<div class="piede-fisso"><div class="in"><button class="btn verde grande" id="invia"' + (chiusa ? ' disabled' : '') + '>✓ Concludi sopralluogo</button></div></div>';
    function mostraPerEsito() {
      var rim = b.esito === 'Da rimodulare';
      $('#blocco-rim').classList.toggle('nascosto', !rim);
      $('#campi').classList.toggle('nascosto', rim);
      $('#blocco-sol').classList.toggle('nascosto', rim);
      $('#tit-foto').textContent = rim ? 'Foto al civico (obbligatoria)' : 'Foto generali';
      disegnaPP();
    }
    aggiornaVisibilita(); disegnaGriglie(); mostraPerEsito(); disegnaPP();
    $('#motivo-rim').oninput = function () { b.motivo = this.value; salvaBozzaDebounced(); };
    if (y) window.scrollTo(0, y);

    $('#indietro').onclick = function () { if (S.bozza) dbPut('bozze', S.bozza); S.urls.forEach(URL.revokeObjectURL); S.urls = []; mostraGiro(); };
    app.querySelectorAll('#esito button').forEach(function (x) { x.onclick = function () { b.esito = x.dataset.esito; mostraPerEsito(); app.querySelectorAll('#esito button').forEach(function (y2) { y2.classList.toggle('on', y2 === x); }); salvaBozzaDebounced(); }; });
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
    if (b.esito === 'Da rimodulare') sezioni.push({ titolo: 'Da rimodulare', righe: [['Motivazione', String(b.motivo || '').trim()], ['Foto al civico', String(b.foto.length)]] });
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
  // cerca logo.png o logo.jpg nella cartella dell'app; lo converte in JPEG su fondo bianco (il PDF accetta JPEG)
  function caricaLogo() {
    function prova(nome) {
      return fetch(nome).then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (blob) {
        return createImageBitmap(blob).then(function (bm) {
          var w = Math.min(bm.width, 600), h = Math.round(bm.height * w / bm.width), cv = document.createElement('canvas');
          cv.width = w; cv.height = h; var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bm, 0, 0, w, h);
          return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res({ blob: b, w: w, h: h }) : rej(); }, 'image/jpeg', 0.92); });
        });
      });
    }
    return prova('logo.png').catch(function () { return prova('logo.jpg'); }).catch(function () { return null; });
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
    if (ppVisibile()) {
      if (!b.pp) mancanti.push('Dichiarazione del cliente sugli scavi in proprietà privata (firma, link o solo verbale)');
      else if (b.pp.modalita === 'A distanza' && b.pp.stato === 'Scaduto') mancanti.push('Il link per il cliente è scaduto: reinvialo o scegli un\'altra modalità');
    }
    if (b.esito === 'Da rimodulare') {
      if (!String(b.motivo || '').trim()) mancanti.push('Motivo del rimodulo');
      if (!b.foto.length) mancanti.push('Foto al civico (obbligatoria per rimodulare)');
    }
    if (mancanti.length) { $('#errscheda').innerHTML = '<div class="errore">Compila:<br>• ' + mancanti.map(esc).join('<br>• ') + '</div>'; window.scrollTo(0, document.body.scrollHeight); return; }
    registraPos('Chiusura tappa', S.stop);
    if (!confirm('Concludere il sopralluogo come “' + b.esito + '”?\nLa scheda viene salvata su Drive e potrai inviarla su WhatsApp.')) return;

    var btn = $('#invia'); btn.disabled = true; btn.textContent = 'Preparo scheda e PDF…';
    var rimodulo = b.esito === 'Da rimodulare';
    if (rimodulo) { b.sol = []; }
    var risposte = {}; if (!rimodulo) campi.forEach(function (cf) { if (campoVisibile(cf) && b.risposte[cf.k] !== undefined && b.risposte[cf.k] !== '') risposte[cf.k] = b.risposte[cf.k]; });
    var soluzioni = b.sol.filter(function (s) { return s.pos || s.fea || s.roe || s.cno; });
    b.sol = soluzioni;                      // numerazione definitiva senza schede vuote
    var adesso = new Date(), modello = costruisciModello(t, b, campi, risposte, adesso), ord = fotoOrdinate(b);
    var testo = modelloATesto(modello, b.foto.length), nomeBase = soloAscii(t.olo) + '_' + soloAscii(t.comune);
    var fotoMeta = {}; b.foto.forEach(function (f) { fotoMeta[f.n] = etichettaFoto(b, f); });
    var sintesi = rimodulo ? 'RIMODULO: ' + String(b.motivo || '').trim() : soluzioni.map(function (s, i) { return (i + 1) + ') ' + [s.pos, s.fea].filter(Boolean).join(' – '); }).join('; ');
    if (!rimodulo && risposte.civico_diverso === 'Sì' && risposte.civico_reale) sintesi = 'Civico corretto: ' + risposte.civico_reale + (sintesi ? ' | ' + sintesi : '');

    caricaLogo().then(function (logo) { modello.logo = logo; return PdfScheda.genera(modello); }).then(function (pdf) {
      return ZipFoto.crea(ord.map(function (f) {
        return { nome: 'foto_' + ('0' + f.n).slice(-2) + '_' + soloAscii(etichettaFoto(b, f)) + '.jpg', blob: f.ann || f.orig };
      })).then(function (zip) { return { pdf: pdf, zip: zip }; });
    }).then(function (r) {
      var codice = uuid();
      var item = {
        codice: codice, id: t.id, esito: b.esito, risposte: risposte, pp: (!rimodulo && ppVisibile() && b.pp && b.pp.modalita !== 'A distanza') ? b.pp : null, ppInviato: false,
        note: rimodulo ? String(b.motivo || '').trim() : (risposte.note || ''), motivo: rimodulo ? String(b.motivo || '').trim() : '', soluzioni: soluzioni, testo: testo, sintesi: sintesi, fotoMeta: fotoMeta,
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
    S.sync = true; inviaPos(); inviaTraccia();
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
    return inizio.then(function () {
      if (!item.pp || item.ppInviato) return;
      var p = item.pp;
      return (p.pdf ? Dich.blobB64(p.pdf) : Promise.resolve('')).then(function (b64) {
        return api('ppPersona', { codice: item.codice, id: item.id, modalita: p.modalita, scelta: p.scelta, nome: p.nome || '', firma: p.firmaPng || '', pdf: b64, gps: p.gps || null, ts: p.ts || '', motivo: p.motivo || '' });
      }).then(function () { item.ppInviato = true; return dbPut('coda', item); });
    }).then(function () { return passi.reduce(function (p, s) {
      return p.then(function () {
        return blobToB64(s.f[s.tipo]).then(function (b64) {
          return api('foto', { codice: item.codice, n: s.f.n, tipo: s.tipo, w: s.f.w, h: s.f.h, dati: b64 });
        }).then(function () { s.f.caricata[s.tipo] = true; return dbPut('coda', item); });
      });
    }, Promise.resolve()); }).then(function () {
      return api('chiudi', { codice: item.codice, id: item.id, esito: item.esito, risposte: item.risposte, note: item.note, nFoto: item.foto.length,
        testo: item.testo, soluzioni: item.soluzioni, sintesi: item.sintesi, fotoMeta: item.fotoMeta, motivo: item.motivo || '' });
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
