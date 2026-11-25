/* Pagina del cliente: conferma a distanza (accetta / non accetta) con firma sullo schermo. */
(function () {
  'use strict';
  var box = document.getElementById('cl'), token = (location.search.match(/[?&]t=([a-f0-9]{40})/) || [])[1] || '';
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(azione, payload) {
    return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ azione: azione }, payload || {})), redirect: 'follow' })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.errore || 'Errore'); return j; });
  }
  var LOGO = '<img class="logo" src="logo.png" alt="RDS Impianti" onerror="this.style.display=\'none\'">';
  function messaggio(titolo, testo) { box.innerHTML = LOGO + '<div class="fin"><h1>' + esc(titolo) + '</h1><div class="muto">' + esc(testo) + '</div></div>'; }

  if (!token) { messaggio('Link non valido', 'Chiedi al tecnico di inviarti di nuovo il link.'); return; }
  api('ppInfo', { t: token }).then(function (j) {
    if (j.stato === 'Scaduto') return messaggio('Link scaduto', 'Chiedi al tecnico di inviarti un nuovo link.');
    if (j.stato && j.stato !== 'In attesa') return messaggio('Dichiarazione già registrata', 'Questa dichiarazione è già stata compilata. Grazie.');
    modulo(j);
  }).catch(function (e) { messaggio('Impossibile aprire il link', e.message + ' Controlla la connessione e riprova.'); });

  function modulo(j) {
    var tt = Object.assign({}, Dich.DEF, j.testi || {}), scelta = '', d = { nome: j.cliente || '', indirizzo: j.indirizzo, comune: j.comune, olo: j.olo, soc: j.soc };
    box.innerHTML = LOGO + '<h1>Dichiarazione sulla proprietà privata</h1>' +
      '<div class="intro">' + esc(Dich.riempi(tt.intro, d)) + '</div>' +
      '<label class="etic">Scegli</label><div class="seg grande-seg" id="sc"><button type="button" class="acc" data-v="Accetta">ACCETTO</button><button type="button" class="no" data-v="Non accetta">NON ACCETTO</button></div>' +
      '<div class="pp-testo" id="testo">Scegli una delle due opzioni per leggere la dichiarazione.</div>' +
      '<label class="etic">Nome e cognome <span class="obb">*</span></label><input type="text" id="nome" autocomplete="name" value="' + esc(j.cliente || '') + '">' +
      '<details><summary>Informativa privacy (tocca per leggere)</summary><div class="pp-testo">' + esc(tt.privacy) + '</div></details>' +
      '<label class="chk"><input type="checkbox" id="priv"><span>' + esc(tt.consenso_privacy) + '</span></label>' +
      '<label class="etic">Firma con il dito <span class="obb">*</span></label><canvas class="firma" id="firma"></canvas>' +
      '<div class="azioni"><button type="button" class="btn sec" id="pulisci">Cancella firma</button></div>' +
      '<div id="err"></div><button type="button" class="btn verde grande" id="invia" style="margin-top:16px">✓ Conferma e invia</button>';
    var fm = Dich.firma(document.getElementById('firma'));
    function aggiorna() {
      d.nome = document.getElementById('nome').value.trim();
      document.getElementById('testo').textContent = scelta ? Dich.testoDichiarazione(tt, scelta, d) + '\n\n' + tt.conferma : 'Scegli una delle due opzioni per leggere la dichiarazione.';
    }
    document.querySelectorAll('#sc button').forEach(function (b) {
      b.onclick = function () { scelta = b.dataset.v; document.querySelectorAll('#sc button').forEach(function (x) { x.classList.toggle('on', x === b); }); aggiorna(); };
    });
    document.getElementById('nome').oninput = aggiorna;
    document.getElementById('pulisci').onclick = function () { fm.pulisci(); };
    document.getElementById('invia').onclick = function () {
      var errs = [], nome = document.getElementById('nome').value.trim();
      if (!scelta) errs.push('Scegli ACCETTO oppure NON ACCETTO');
      if (nome.length < 3) errs.push('Scrivi nome e cognome');
      if (!document.getElementById('priv').checked) errs.push('Conferma di aver letto l\'informativa privacy');
      if (fm.vuota()) errs.push('Firma nello spazio tratteggiato');
      var er = document.getElementById('err');
      if (errs.length) { er.innerHTML = '<div class="errore">Per continuare:<br>• ' + errs.map(esc).join('<br>• ') + '</div>'; er.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      er.innerHTML = '';
      var btn = document.getElementById('invia'); btn.disabled = true; btn.textContent = 'Invio in corso…';
      d.nome = nome;
      var adesso = new Date(), png = fm.png();
      fm.jpeg().then(function (fj) {
        return Dich.pdf({ tt: tt, d: d, scelta: scelta, modalita: 'A distanza (link inviato al cliente)', dataOra: Dich.dataOra(adesso), firmaJpeg: fj });
      }).then(function (pdf) {
        return Dich.blobB64(pdf).then(function (b64) {
          return api('ppFirma', { t: token, scelta: scelta, nome: nome, privacy: true, firma: png, pdf: b64, ua: navigator.userAgent, tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') })
            .then(function () { return pdf; });
        });
      }).then(function (pdf) {
        var url = URL.createObjectURL(pdf);
        box.innerHTML = LOGO + '<div class="fin"><div class="ok-box">✓ Dichiarazione registrata</div><div class="muto">Grazie. La tua scelta è stata registrata e inviata a RDS Impianti.</div>' +
          '<p><a class="btn sec" href="' + url + '" download="Dichiarazione_' + esc(j.olo || 'RDS') + '.pdf">Scarica la tua copia (PDF)</a></p></div>';
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '✓ Conferma e invia';
        er.innerHTML = '<div class="errore">Non è stato possibile inviare: ' + esc(e.message) + '. Riprova.</div>';
      });
    };
  }
})();
