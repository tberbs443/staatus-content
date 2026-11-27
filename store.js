// Saving for the content page: plan, favorites and tags.
// Always saves in this browser first. When config.js has a database and you are signed in,
// the same changes are uploaded to it, and everyone signed in sees them.
(function () {
  var KEY = 'staatus-content-local-db', SKEY = 'staatus-content-session';
  var COLS = ['items', 'favorites', 'tags'];
  var cfg = window.__DB_CONFIG || {};
  var url = String(cfg.url || '').replace(/\/+$/, ''), key = String(cfg.key || '');
  var on = !!(url && key);
  var data = {}, subs = {}, n = Date.now(), session = null, member = null, problem = '', busy = null, again = false;
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { }
  if (!data.items) data.items = JSON.parse(JSON.stringify(window.__SEED_ITEMS || []));
  if (!data._pending) {
    // first run of this version: whatever was already saved here still needs uploading later
    data._pending = {};
    COLS.forEach(function (c) { (data[c] || []).forEach(function (d) { data._pending[c + '/' + d.id] = n++; }); });
  }
  try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { }

  // the sign-in email link comes back with the login in the address; keep it and clean the address
  if (/(^#|&)(access_token|error_description)=/.test(location.hash)) {
    var q = new URLSearchParams(location.hash.slice(1));
    if (q.get('access_token')) {
      session = { access: q.get('access_token'), refresh: q.get('refresh_token'), until: Date.now() + (+q.get('expires_in') || 3600) * 1000, email: '' };
      saveSession();
    } else problem = 'Sign-in failed: ' + q.get('error_description');
    history.replaceState(null, '', location.pathname + location.search + '#content');
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { problem = 'This browser is not letting the page save.'; } }
  function saveSession() { try { if (session) localStorage.setItem(SKEY, JSON.stringify(session)); else localStorage.removeItem(SKEY); } catch (e) { } }
  function rows(c) { return data[c] = data[c] || []; }
  function find(c, id) { return rows(c).filter(function (x) { return x.id === id; })[0]; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function emit(c) { (subs[c] || []).forEach(function (f) { f({ docs: rows(c).map(function (d) { return { id: d.id, data: function () { return copy(d); } }; }) }); }); }
  function changed(c, id) { data._pending[c + '/' + id] = n++; save(); emit(c); changedStatus(); flush(); }
  function changedStatus() { if (STORE.onStatus) STORE.onStatus(); }

  function call(path, opt, auth) {
    opt = opt || {};
    var h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, opt.headers || {});
    if (auth && session) h.Authorization = 'Bearer ' + session.access;
    return fetch(url + path, Object.assign({}, opt, { headers: h })).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
        if (!r.ok) { var err = new Error((j && (j.msg || j.message || j.error_description)) || 'Error ' + r.status); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  // keeps the login fresh, and finds out who it is and whether they may save
  function ready() {
    if (!session) return Promise.resolve(false);
    var p = Promise.resolve();
    if (Date.now() > session.until - 60000) {
      p = call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh }) }).then(function (j) {
        session = { access: j.access_token, refresh: j.refresh_token, until: Date.now() + j.expires_in * 1000, email: (j.user && j.user.email) || session.email };
        saveSession();
      }, function (e) { if (e.status === 400 || e.status === 401 || e.status === 403) { session = null; member = null; saveSession(); } throw e; });
    }
    return p.then(function () {
      if (session.email) return;
      return call('/auth/v1/user', {}, true).then(function (u) { session.email = u.email; saveSession(); });
    }).then(function () {
      if (member !== null) return;
      return call('/rest/v1/rpc/is_member', { method: 'POST', body: '{}' }, true).then(function (v) { member = v === true; });
    }).then(function () { return member === true; });
  }
  function push(canWrite) {
    if (!canWrite) return Promise.resolve();
    return Object.keys(data._pending).reduce(function (chain, k) {
      return chain.then(function () {
        var cut = k.indexOf('/'), c = k.slice(0, cut), id = k.slice(cut + 1), mark = data._pending[k], d = find(c, id);
        var done = function () { if (data._pending[k] === mark) delete data._pending[k]; save(); };
        if (!d) return call('/rest/v1/docs?collection=eq.' + c + '&id=eq.' + encodeURIComponent(id), { method: 'DELETE' }, true).then(done);
        return call('/rest/v1/docs?on_conflict=collection,id', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{ collection: c, id: id, data: d, updated_at: new Date().toISOString() }])
        }, true).then(done);
      });
    }, Promise.resolve());
  }
  function pull(canWrite) {
    // signed out (or not on the list): only tags are readable, so leave the plan and favorites alone
    var cols = canWrite ? COLS : ['tags'];
    return call('/rest/v1/docs?select=collection,id,data' + (canWrite ? '' : '&collection=eq.tags'), {}, canWrite).then(function (list) {
      cols.forEach(function (c) {
        var next = list.filter(function (r) { return r.collection === c && !((c + '/' + r.id) in data._pending); })
          .map(function (r) { return Object.assign({}, r.data, { id: r.id }); });
        rows(c).forEach(function (d) { if ((c + '/' + d.id) in data._pending) next.push(d); });
        var order = function (a) { return JSON.stringify(a.slice().sort(function (x, y) { return String(x.id) < String(y.id) ? -1 : 1; })); };
        if (order(next) !== order(rows(c))) { data[c] = next; save(); emit(c); }
      });
    });
  }
  // upload what is waiting, then download; one run at a time
  function flush() {
    if (!on) return Promise.resolve();
    if (busy) { again = true; return busy; }
    busy = ready().then(function (w) { return push(w).then(function () { return pull(w); }); })
      .then(function () { if (!/^Sign-in/.test(problem)) problem = ''; }, function (e) { problem = 'Could not reach the database (' + e.message + ').'; })
      .then(function () { busy = null; changedStatus(); if (again) { again = false; return flush(); } });
    return busy;
  }

  var STORE = window.STORE = {
    onStatus: null,
    status: function () {
      var wait = Object.keys(data._pending).length, w = wait ? wait + (wait === 1 ? ' change' : ' changes') : '';
      if (!on) return { text: problem || 'Saved in this browser only.', signedIn: false, canSignIn: false };
      if (!session) return { text: problem || (w ? w + ' waiting. Sign in to save for everyone.' : 'Sign in to save for everyone.'), signedIn: false, canSignIn: true };
      if (member === false) return { text: (session.email || 'This email') + ' is not on the list of people who can save.', signedIn: true, canSignIn: false };
      return { text: problem || (w ? 'Saving ' + w + '…' : 'Saved to the database' + (session.email ? ' · ' + session.email : '') + '.'), signedIn: true, canSignIn: false };
    },
    signIn: function (email) {
      var back = location.origin + location.pathname;
      return call('/auth/v1/otp?redirect_to=' + encodeURIComponent(back), { method: 'POST', body: JSON.stringify({ email: email, create_user: true }) });
    },
    signOut: function () { session = null; member = null; problem = ''; saveSession(); changedStatus(); }
  };

  var db = { collection: function (c) { return {
    onSnapshot: function (f) { (subs[c] = subs[c] || []).push(f); setTimeout(function () { save(); emit(c); }, 10); },
    add: function (o) { o = copy(o); o.id = 'l' + (n++) + '-' + Math.random().toString(36).slice(2, 7); rows(c).push(o); changed(c, o.id); return Promise.resolve(); },
    doc: function (id) { return {
      set: function (o) { o = copy(o); o.id = id; var d = find(c, id); if (d) { Object.keys(d).forEach(function (k) { delete d[k]; }); Object.assign(d, o); } else rows(c).push(o); changed(c, id); return Promise.resolve(); },
      update: function (o) { var d = find(c, id); if (d) Object.assign(d, copy(o)); else { o = copy(o); o.id = id; rows(c).push(o); } changed(c, id); return Promise.resolve(); },
      delete: function () { data[c] = rows(c).filter(function (x) { return x.id !== id; }); changed(c, id); return Promise.resolve(); } }; } }; } };
  window.claude = { use: function (k) { return k === 'db' ? Promise.resolve(db) : Promise.reject(new Error('not available')); } };

  if (on) {
    setTimeout(flush, 50);
    window.addEventListener('focus', flush);
    window.addEventListener('online', flush);
    setInterval(function () { if (!document.hidden) flush(); }, 60000);
  }
})();
if (!location.hash) location.hash = 'content';
