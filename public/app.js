// Oberfläche der Dokumentenverwaltung. Vanilla JS, Rendering per Template-Strings.
// Alles, was von Nutzern, Dateien oder Claude kommt, läuft durch esc().

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { eingang: 'Eingang', rueckfrage: 'Rückfrage', eingeordnet: 'Eingeordnet' };
const BILD = ['image/jpeg', 'image/png', 'image/webp'];

const zustand = { ich: null, bereich: '', status: '', q: '', dokumente: [], weiter: null, laedt: false };

function merke(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }
function hole(k) { try { return localStorage.getItem(k); } catch { return null; } }

class AnmeldeFehler extends Error {}

async function api(pfad, optionen = {}) {
  let res;
  try {
    res = await fetch(`/api/${pfad}`, { credentials: 'same-origin', ...optionen });
  } catch {
    // Läuft die Access-Sitzung ab, leitet Cloudflare auf die Anmeldeseite um, und fetch scheitert.
    throw new AnmeldeFehler('Keine Verbindung oder Anmeldung abgelaufen.');
  }
  if (res.status === 401) throw new AnmeldeFehler('Anmeldung abgelaufen.');
  const daten = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(daten.fehler || `Fehler ${res.status}`);
  return daten;
}

const bereichName = (id) => zustand.ich?.person.bereiche.find((b) => b.id === id)?.name ?? id;
const euro = (cent) => (cent == null ? '' : (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const tag = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const groesse = (b) => (b > 1e6 ? `${(b / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

function hinweis(text, art = '') {
  const el = document.createElement('div');
  el.className = `hinweis ${art}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

function zeigeAnmeldung() {
  $('#inhalt').innerHTML = `<div class="leer"><p>Deine Anmeldung ist abgelaufen.</p>
    <button class="knopf" data-act="neu-laden">Neu anmelden</button></div>`;
}

// ---------- Liste ----------

function chip(gruppe, wert, text, aktiv) {
  return `<button class="chip${aktiv ? ' an' : ''}" data-act="filter" data-gruppe="${gruppe}" data-wert="${esc(wert)}" aria-pressed="${aktiv}">${esc(text)}</button>`;
}

function renderFilter() {
  const bereiche = zustand.ich.person.bereiche;
  $('#filter').innerHTML = [
    chip('bereich', '', 'Alle', !zustand.bereich),
    ...bereiche.map((b) => chip('bereich', b.id, b.name, zustand.bereich === b.id)),
    '<span class="trenner" aria-hidden="true"></span>',
    ...Object.entries(STATUS).map(([k, t]) => chip('status', k, t, zustand.status === k)),
  ].join('');
}

function karte(d) {
  const titel = d.dateiname || d.original_name;
  const zeile = [bereichName(d.bereich), d.absender, tag(d.datum || d.hochgeladen_am), euro(d.betrag_cent)].filter(Boolean);
  return `<li><a class="karte" href="#/d/${esc(d.id)}">
    <span class="art">${d.mime === 'application/pdf' ? 'PDF' : d.mime === 'text/plain' ? 'Mail' : 'Bild'}</span>
    <span class="text"><strong>${esc(titel)}</strong><small>${zeile.map(esc).join(' · ')}</small></span>
    ${d.status !== 'eingeordnet' ? `<span class="status ${esc(d.status)}">${esc(STATUS[d.status])}</span>` : ''}
  </a></li>`;
}

function renderListe() {
  const el = $('#inhalt');
  if (!zustand.dokumente.length && !zustand.laedt) {
    el.innerHTML = `<div class="leer"><p>${zustand.q || zustand.status || zustand.bereich
      ? 'Nichts gefunden. Ändere die Suche oder die Filter.'
      : 'Noch keine Dokumente. Fotografiere einen Brief oder wähle ein PDF mit „Dokument hinzufügen“.'}</p></div>`;
    return;
  }
  el.innerHTML = `<ul class="liste">${zustand.dokumente.map(karte).join('')}</ul>
    ${zustand.weiter ? '<button class="knopf leise mehr" data-act="mehr">Weitere laden</button>' : ''}`;
}

async function ladeListe(anhaengen = false) {
  const p = new URLSearchParams();
  if (zustand.bereich) p.set('bereich', zustand.bereich);
  if (zustand.status) p.set('status', zustand.status);
  if (zustand.q) p.set('q', zustand.q);
  if (anhaengen && zustand.weiter) p.set('vor', zustand.weiter);
  zustand.laedt = true;
  try {
    const daten = await api(`dokumente?${p}`);
    zustand.dokumente = anhaengen ? [...zustand.dokumente, ...daten.dokumente] : daten.dokumente;
    zustand.weiter = daten.weiter;
  } finally { zustand.laedt = false; }
  renderListe();
}

// ---------- Hochladen ----------

async function pruefsumme(datei) {
  if (!crypto.subtle || datei.size > 25 * 1024 * 1024) return '';
  const hash = await crypto.subtle.digest('SHA-256', await datei.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sendeDatei(datei, bereich, sha, fortschritt) {
  return new Promise((ok, nein) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/dokumente');
    xhr.setRequestHeader('content-type', datei.type || 'application/octet-stream');
    xhr.setRequestHeader('x-bereich', bereich);
    xhr.setRequestHeader('x-dateiname', encodeURIComponent(datei.name));
    if (sha) xhr.setRequestHeader('x-sha256', sha);
    xhr.upload.onprogress = (e) => e.lengthComputable && fortschritt(e.loaded / e.total);
    xhr.onload = () => {
      let daten = {};
      try { daten = JSON.parse(xhr.responseText); } catch { /* bleibt leer */ }
      if (xhr.status === 401) nein(new AnmeldeFehler('Anmeldung abgelaufen.'));
      else if (xhr.status >= 400) nein(new Error(daten.fehler || `Fehler ${xhr.status}`));
      else ok(daten);
    };
    xhr.onerror = () => nein(new AnmeldeFehler('Keine Verbindung oder Anmeldung abgelaufen.'));
    xhr.send(datei);
  });
}

function oeffneBlatt(html) {
  const blatt = $('#blatt');
  blatt.innerHTML = `<div class="blatt-innen" role="dialog" aria-modal="true">${html}</div>`;
  blatt.hidden = false;
  blatt.querySelector('button, input, a')?.focus();
}
function schliesseBlatt() { $('#blatt').hidden = true; $('#blatt').innerHTML = ''; }

let wartendeDateien = [];

function frageBereich(dateien) {
  wartendeDateien = dateien;
  const letzter = hole('bereich');
  const bereiche = zustand.ich.person.bereiche;
  oeffneBlatt(`<h2>${dateien.length === 1 ? 'Wohin gehört das Dokument?' : `Wohin gehören die ${dateien.length} Dokumente?`}</h2>
    <div class="wahl">${bereiche.map((b) => `<button class="knopf${b.id === letzter ? '' : ' leise'}" data-act="hochladen" data-bereich="${esc(b.id)}">${esc(b.name)}</button>`).join('')}</div>
    <button class="knopf leise" data-act="schliessen">Abbrechen</button>`);
}

async function hochladen(bereich) {
  const dateien = wartendeDateien;
  wartendeDateien = [];
  merke('bereich', bereich);
  oeffneBlatt(`<h2>Wird hochgeladen</h2><ul class="laden">${dateien.map((f, i) => `<li id="up-${i}">
    <span>${esc(f.name)} <small>${groesse(f.size)}</small></span><progress max="1" value="0"></progress><small class="ergebnis"></small></li>`).join('')}</ul>
    <button class="knopf" data-act="schliessen" disabled>Fertig</button>`);
  let fehler = 0;
  for (const [i, f] of dateien.entries()) {
    const li = $(`#up-${i}`);
    try {
      const sha = await pruefsumme(f);
      const r = await sendeDatei(f, bereich, sha, (x) => { li.querySelector('progress').value = x; });
      li.querySelector('progress').value = 1;
      li.querySelector('.ergebnis').textContent = r.doppelt ? 'War schon da, nicht doppelt gespeichert.' : 'Gespeichert, wartet auf Einordnung.';
    } catch (e) {
      fehler++;
      li.classList.add('fehler');
      li.querySelector('.ergebnis').textContent = e.message;
      if (e instanceof AnmeldeFehler) break;
    }
  }
  $('#blatt [data-act="schliessen"]').disabled = false;
  if (!fehler) setTimeout(schliesseBlatt, 900);
  zustand.bereich = ''; zustand.status = ''; zustand.q = ''; $('#q').value = '';
  renderFilter();
  await ladeListe().catch(fehlerAnzeigen);
}

// ---------- Detail ----------

function feld(name, label, wert, typ = 'text', extra = '') {
  return `<label class="feld"><span>${label}</span><input name="${name}" type="${typ}" value="${esc(wert)}" ${extra}></label>`;
}

async function zeigeDetail(id) {
  const { dokument: d } = await api(`dokumente/${encodeURIComponent(id)}`);
  const url = `/api/dokumente/${encodeURIComponent(d.id)}/datei`;
  const vorschau = BILD.includes(d.mime)
    ? `<a href="${url}" target="_blank" rel="noopener"><img class="vorschau" src="${url}" alt="Vorschau von ${esc(d.original_name)}"></a>`
    : '';
  const bereiche = zustand.ich.person.bereiche;
  $('#inhalt').innerHTML = `<article class="detail">
    <a class="zurueck" href="#/">Zurück</a>
    <h2>${esc(d.dateiname || d.original_name)}</h2>
    <p class="meta">${esc(STATUS[d.status])} · ${d.quelle === 'mail' ? 'per Mail am' : 'hochgeladen am'} ${esc(tag(d.hochgeladen_am))} · ${esc(groesse(d.groesse))}</p>
    ${d.status === 'rueckfrage' && d.rueckfrage ? `<p class="frage"><strong>Rückfrage:</strong> ${esc(d.rueckfrage)}</p>` : ''}
    ${d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : ''}
    ${vorschau}
    <div class="aktionen">
      <a class="knopf" href="${url}" target="_blank" rel="noopener">Öffnen</a>
      <a class="knopf leise" href="${url}?herunterladen">Herunterladen</a>
    </div>
    <form data-form="speichern" data-id="${esc(d.id)}" class="formular">
      <label class="feld"><span>Bereich</span><select name="bereich">${bereiche.map((b) => `<option value="${esc(b.id)}"${b.id === d.bereich ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      ${feld('dateiname', 'Name', d.dateiname || '', 'text', `placeholder="${esc(d.original_name)}" maxlength="200"`)}
      ${feld('kategorie', 'Kategorie', d.kategorie || '', 'text', 'maxlength="80"')}
      ${feld('absender', 'Absender', d.absender || '', 'text', 'maxlength="160"')}
      ${feld('datum', 'Datum des Dokuments', d.datum || '', 'date')}
      ${feld('betrag', 'Betrag in Euro', d.betrag_cent == null ? '' : (d.betrag_cent / 100).toFixed(2).replace('.', ','), 'text', 'inputmode="decimal" placeholder="0,00"')}
      ${feld('tags', 'Tags, mit Komma getrennt', d.tags.join(', '))}
      <label class="feld check"><input type="checkbox" name="eingeordnet" ${d.status === 'eingeordnet' ? 'checked' : ''}> <span>Fertig eingeordnet</span></label>
      <button class="knopf" type="submit">Änderungen speichern</button>
    </form>
  </article>`;
}

function betragInCent(text) {
  const t = String(text).trim().replace(/\s|€/g, '');
  if (!t) return null;
  const zahl = Number(t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(zahl)) throw new Error('Den Betrag bitte als Zahl eingeben, z. B. 12,50.');
  return Math.round(zahl * 100);
}

async function speichern(form) {
  const f = new FormData(form);
  const felder = {
    bereich: f.get('bereich'),
    dateiname: f.get('dateiname'),
    kategorie: f.get('kategorie'),
    absender: f.get('absender'),
    datum: f.get('datum') || null,
    betrag_cent: betragInCent(f.get('betrag')),
    tags: String(f.get('tags')).split(',').map((t) => t.trim()).filter(Boolean),
  };
  if (f.get('eingeordnet')) felder.status = 'eingeordnet';
  await api(`dokumente/${encodeURIComponent(form.dataset.id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(felder),
  });
  hinweis('Gespeichert.');
  location.hash = '#/';
}

// ---------- Ablauf ----------

function fehlerAnzeigen(e) {
  if (e instanceof AnmeldeFehler) zeigeAnmeldung();
  else hinweis(e.message, 'fehler');
}

async function route() {
  const m = location.hash.match(/^#\/d\/([\w-]+)$/);
  document.body.classList.toggle('im-detail', !!m);
  try {
    if (m) await zeigeDetail(m[1]);
    else await ladeListe();
  } catch (e) {
    fehlerAnzeigen(e);
    if (m && !(e instanceof AnmeldeFehler)) location.hash = '#/';
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === 'filter') {
    const { gruppe, wert } = el.dataset;
    zustand[gruppe] = zustand[gruppe] === wert ? '' : wert;
    renderFilter();
    ladeListe().catch(fehlerAnzeigen);
  } else if (act === 'mehr') ladeListe(true).catch(fehlerAnzeigen);
  else if (act === 'hochladen') hochladen(el.dataset.bereich).catch(fehlerAnzeigen);
  else if (act === 'schliessen') schliesseBlatt();
  else if (act === 'neu-laden') location.reload();
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.id === 'suche') {
    zustand.q = $('#q').value.trim();
    if (location.hash.startsWith('#/d/')) location.hash = '#/';
    else ladeListe().catch(fehlerAnzeigen);
  } else if (form.dataset.form === 'speichern') speichern(form).catch(fehlerAnzeigen);
});

let suchTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(suchTimer);
  suchTimer = setTimeout(() => {
    zustand.q = $('#q').value.trim();
    if (!location.hash.startsWith('#/d/')) ladeListe().catch(fehlerAnzeigen);
  }, 300);
});

$('#datei').addEventListener('change', (e) => {
  const dateien = [...e.target.files];
  e.target.value = '';
  if (dateien.length) frageBereich(dateien);
});

$('#blatt').addEventListener('click', (e) => { if (e.target.id === 'blatt' && !$('#blatt [data-act="schliessen"][disabled]')) schliesseBlatt(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#blatt').hidden) schliesseBlatt(); });
window.addEventListener('hashchange', route);

(async function start() {
  try {
    zustand.ich = await api('ich');
    document.title = zustand.ich.instanz;
    $('#titel').textContent = zustand.ich.instanz;
    $('#wer').textContent = zustand.ich.person.name;
    renderFilter();
    await route();
  } catch (e) {
    if (e instanceof AnmeldeFehler) zeigeAnmeldung();
    else $('#inhalt').innerHTML = `<div class="leer"><p>${esc(e.message)}</p><button class="knopf" data-act="neu-laden">Neu laden</button></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
