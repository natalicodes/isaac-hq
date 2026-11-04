// Talks to the Apps Script API. Replaces google.script.run so the rest of the
// app works unchanged. The passcode and the name live only in this phone's
// browser (localStorage); nothing secret is in this file.
(function () {
  // The Apps Script web app URL lives in config.js, so this file can be
  // replaced without losing it.
  var API_URL = window.ISAAC_API_URL || 'PASTE_YOUR_WEB_APP_URL_HERE';

  var K_PASS = 'isaac-hq-pass', K_WHO = 'isaac-hq-who', K_CACHE = 'isaac-hq-cache';
  var NAMES = ['Natali', 'Steve'];
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function $(id) { return document.getElementById(id); }

  var queue = [];          // calls waiting for a valid passcode
  var gateWho = get(K_WHO) || null;

  function post(fn, args, pass, who) {
    if (API_URL.indexOf('PASTE_') === 0) {
      return Promise.reject(new Error('This site is not connected to its server yet (API_URL is not set).'));
    }
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 30000);
    return fetch(API_URL, {
      method: 'POST',                       // no custom headers: avoids a CORS preflight
      body: JSON.stringify({ fn: fn, args: args, pass: pass, who: who }),
      redirect: 'follow', credentials: 'omit', signal: ctl.signal
    }).then(function (r) { return r.text(); }).then(function (txt) {
      clearTimeout(timer);
      try { return JSON.parse(txt); } catch (e) { throw new Error('Unexpected reply from the server.'); }
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('That took too long. Check your connection.');
      if (err instanceof TypeError) throw new Error('No connection to the server.');
      throw err;
    });
  }

  function send(job) {
    var pass = get(K_PASS), who = get(K_WHO);
    if (!pass || !who) { enqueue(job); openGate(''); return; }
    post(job.fn, job.args, pass, who).then(function (res) {
      if (res && res.ok) { job.ok(res.result); return; }
      if (res && res.code === 'AUTH') { set(K_PASS, null); set(K_CACHE, null); enqueue(job); openGate("that passcode didn't work"); return; }
      job.bad(new Error((res && res.message) || 'Something went wrong.'));
    }, function (err) { job.bad(err); });
  }

  function enqueue(job) {
    // Background refreshes are replaced rather than piled up.
    if (job.fn === 'getRecentEvents' || job.fn === 'getAllEvents') {
      queue = queue.filter(function (j) { return j.fn !== job.fn; });
    }
    queue.push(job);
  }

  function flush() { var q = queue; queue = []; q.forEach(send); }

  // ── Passcode screen ──
  function paintWho() {
    var els = document.querySelectorAll('#gate-who button');
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('active', els[i].dataset.v === gateWho);
  }
  function openGate(msg) {
    $('gate').classList.remove('gate-off');
    $('gate-msg').textContent = msg || '';
    $('gate-pass').value = '';
    gateWho = get(K_WHO) || gateWho;
    paintWho();
    setTimeout(function () { try { $('gate-pass').focus(); } catch (e) {} }, 50);
  }
  function closeGate() { $('gate').classList.add('gate-off'); $('gate-pass').blur(); }

  function submit(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var pass = $('gate-pass').value, msg = $('gate-msg'), go = $('gate-go');
    if (!gateWho) { msg.textContent = "pick who's logging"; return false; }
    if (!pass) { msg.textContent = 'enter the passcode'; return false; }
    go.disabled = true; msg.textContent = '';
    post('ping', [], pass, gateWho).then(function (res) {
      go.disabled = false;
      if (res && res.ok) { set(K_PASS, pass); set(K_WHO, gateWho); closeGate(); flush(); return; }
      if (res && res.code === 'LOCKED') { msg.textContent = 'too many tries, wait about 10 minutes'; return; }
      msg.textContent = "that passcode didn't work"; $('gate-pass').select();
    }, function (err) { go.disabled = false; msg.textContent = err.message.toLowerCase(); });
    return false;
  }

  window.IsaacAuth = {
    submit: submit,
    who: function () { return get(K_WHO); },
    setWho: function (n) { if (NAMES.indexOf(n) !== -1) set(K_WHO, n); },
    forget: function () { set(K_PASS, null); set(K_CACHE, null); location.reload(); },
    // Last copy of the recent entries, kept on this phone only, so the app can
    // draw instantly while the fresh copy loads. Only used once signed in.
    readCache: function () {
      if (!get(K_PASS) || !get(K_WHO)) return null;
      try { var c = JSON.parse(get(K_CACHE) || 'null'); return (c && Array.isArray(c.data)) ? c.data : null; } catch (e) { return null; }
    },
    writeCache: function (data) {
      if (Array.isArray(data)) set(K_CACHE, JSON.stringify({ t: Date.now(), data: data }));
    }
  };

  // ── google.script.run lookalike ──
  function runner(ok, bad) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, bad); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        send({ fn: String(name), args: Array.prototype.slice.call(arguments),
               ok: ok || function () {}, bad: bad || function (e) { console.error(e); } });
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };

  document.addEventListener('DOMContentLoaded', function () {
    var btns = document.querySelectorAll('#gate-who button');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () { gateWho = this.dataset.v; paintWho(); });
    if (!get(K_PASS) || !get(K_WHO)) openGate('');
  });
})();
