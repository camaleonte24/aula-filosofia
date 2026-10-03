(() => {
  const app = document.getElementById('app');
  let me = null;
  let pollTimer = null;

  // ---------- Utilità ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  async function api(url, opts = {}) {
    const init = { credentials: 'same-origin', ...opts };
    if (opts.json) {
      init.method = init.method || 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.json);
      delete init.json;
    }
    const res = await fetch(url, init);
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || 'Errore imprevisto.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Oggi';
    if (d.toDateString() === yesterday.toDateString()) return 'Ieri';
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  }

  // ---------- Accesso ----------
  function showAuth(startMode = 'login', notice = '') {
    stopPolling();
    app.replaceChildren();
    let mode = startMode;

    const err = h('div', { class: 'err', role: 'alert' });
    const user = h('input', { type: 'text', autocomplete: 'username', required: true, spellcheck: 'false' });
    const pass = h('input', { type: 'password', required: true });
    const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const passHint = h('small', {}, 'Almeno 6 caratteri.');
    const codeField = h('label', { class: 'field' }, h('span', {}, 'Codice classe'), code, h('small', {}, 'Te lo dà la prof.'));
    const submit = h('button', { class: 'btn primary wide', type: 'submit' });
    const tabLogin = h('button', { class: 'btn', type: 'button', onclick: () => setMode('login') }, 'Accedi');
    const tabRegister = h('button', { class: 'btn', type: 'button', onclick: () => setMode('register') }, 'Registrati');

    function setMode(m) {
      mode = m;
      tabLogin.classList.toggle('on', m === 'login');
      tabRegister.classList.toggle('on', m === 'register');
      submit.textContent = m === 'login' ? 'Entra' : 'Crea account';
      passHint.hidden = m === 'login';
      codeField.hidden = m === 'login';
      pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      err.textContent = '';
    }

    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        submit.disabled = true;
        try {
          const body = { username: user.value, password: pass.value };
          if (mode === 'register') body.code = code.value;
          const data = await api(mode === 'login' ? '/api/login' : '/api/register', { json: body });
          me = data.user;
          showMain();
        } catch (ex) {
          err.textContent = ex.message;
        }
        submit.disabled = false;
      },
    },
      h('div', { class: 'tabs' }, tabLogin, tabRegister),
      notice ? h('div', { class: 'notice', role: 'status' }, notice) : null,
      h('label', { class: 'field' }, h('span', {}, 'Nome utente'), user),
      h('label', { class: 'field' }, h('span', {}, 'Password'), pass, passHint),
      codeField,
      submit,
      err
    );

    app.append(h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-card' },
        h('h1', {}, 'Aula di Filosofia'),
        h('p', { class: 'sub' }, 'IV DS 2026/27'),
        form
      )
    ));
    setMode(startMode);
    user.focus();
  }

  // ---------- Schermata principale ----------
  function showMain() {
    app.replaceChildren();
    let lastSnapshot = '';
    let pickedFile = null;
    let first = true;
    let hiddenTicks = 0;
    const seen = new Set();
    const isAdmin = me.role === 'admin';
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    const feed = h('div', { id: 'feed' });
    const jump = h('button', { class: 'btn primary sm jump', type: 'button', hidden: true, onclick: () => { scrollEnd(true); jump.hidden = true; } }, 'Nuovi messaggi ↓');
    const pins = h('section', { class: 'pins', hidden: true, 'aria-label': 'Messaggi fissati' });

    feed.addEventListener('scroll', () => {
      if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80) jump.hidden = true;
    });
    function scrollEnd(smooth) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }

    // ----- scrittura -----
    const text = h('textarea', { rows: '1', placeholder: 'Scrivi un messaggio…', maxlength: '4000', 'aria-label': 'Messaggio' });
    const fileInput = h('input', { type: 'file', hidden: true });
    const chosen = h('div', { class: 'chosen', hidden: true });
    const err = h('div', { class: 'err', role: 'alert' });
    const sendBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Invia');

    function refreshChosen() {
      chosen.replaceChildren();
      chosen.hidden = !pickedFile;
      if (pickedFile) {
        chosen.append(
          h('span', { class: 'nm' }, pickedFile.name),
          h('small', {}, fmtSize(pickedFile.size)),
          h('button', { class: 'link', type: 'button', onclick: () => { pickedFile = null; fileInput.value = ''; refreshChosen(); } }, 'Rimuovi')
        );
      }
    }
    fileInput.addEventListener('change', () => {
      pickedFile = fileInput.files[0] || null;
      if (pickedFile && pickedFile.size > 8 * 1024 * 1024) {
        err.textContent = 'File troppo grande (massimo 8 MB).';
        pickedFile = null;
        fileInput.value = '';
      } else err.textContent = '';
      refreshChosen();
    });
    text.addEventListener('input', () => {
      text.style.height = 'auto';
      text.style.height = Math.min(text.scrollHeight, 140) + 'px';
    });
    text.addEventListener('keydown', (e) => {
      // Sul computer "Invio" invia (Shift+Invio va a capo). Sul telefono "Invio" va a capo.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    const form = h('form', {
      class: 'composer',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (!text.value.trim() && !pickedFile) return;
        sendBtn.disabled = true;
        try {
          const fd = new FormData();
          fd.append('text', text.value);
          if (pickedFile) fd.append('file', pickedFile);
          await api('/api/messages', { method: 'POST', body: fd });
          text.value = '';
          text.style.height = 'auto';
          pickedFile = null;
          fileInput.value = '';
          refreshChosen();
          await load(true, true);
        } catch (ex) {
          err.textContent = ex.message;
          if (ex.status === 401) kicked();
        }
        sendBtn.disabled = false;
        if (!coarse) text.focus();
      },
    },
      chosen,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Allega'),
        text, fileInput, sendBtn
      ),
      err
    );

    const header = h('header', { class: 'top' },
      h('div', { class: 'title' },
        h('h2', {}, 'Aula di Filosofia'),
        h('span', { class: 'who' }, me.username, isAdmin ? [' ', h('span', { class: 'badge' }, 'prof')] : null)),
      isAdmin ? h('button', { class: 'btn', type: 'button', onclick: openUsers }, 'Classe') : null,
      h('button', { class: 'btn', type: 'button', onclick: openPassword }, 'Password'),
      h('button', { class: 'btn', type: 'button', onclick: logout }, 'Esci')
    );

    app.append(h('div', { class: 'shell' }, header, pins, h('div', { class: 'feed-wrap' }, feed, jump), form));

    function kicked() {
      me = null;
      showAuth('login', 'Sei stato disconnesso: la sessione è scaduta oppure l\'account è stato aperto su un altro dispositivo.');
    }

    // ----- messaggi -----
    function goTo(id) {
      const el = document.getElementById('m-' + id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1500);
    }

    function pinItem(m) {
      return h('div', {
        class: 'pin-item', role: 'button', tabindex: '0',
        onclick: () => goTo(m.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(m.id); } },
      },
        h('div', { class: 'body' },
          h('div', { class: 'who' }, m.username),
          m.text ? h('div', { class: 'txt' }, m.text) : null,
          m.file_id ? h('div', { class: 'pfile' }, 'File: ' + m.file_name) : null),
        isAdmin ? h('button', { class: 'link', type: 'button', onclick: (e) => { e.stopPropagation(); pin(m.id, false); } }, 'Stacca') : null
      );
    }

    function msgNode(m) {
      const mine = m.user_id === me.id;
      const prof = m.role === 'admin';

      const files = m.file_id ? h('div', { class: 'files' },
        /^image\/(png|jpeg|gif|webp)$/.test(m.file_mime)
          ? h('a', { href: `/api/files/${m.file_id}`, target: '_blank', rel: 'noopener' },
              h('img', { class: 'preview', src: `/api/files/${m.file_id}?inline=1`, alt: m.file_name, loading: 'lazy' }))
          : null,
        h('a', { class: 'attach', href: `/api/files/${m.file_id}`, download: m.file_name },
          m.file_name, h('small', {}, fmtSize(m.file_size)))
      ) : null;

      const canDelete = isAdmin || mine;
      const acts = (isAdmin || canDelete) ? h('span', { class: 'acts' },
        isAdmin ? h('button', { class: 'link', type: 'button', onclick: () => pin(m.id, !m.pinned) }, m.pinned ? 'Stacca' : 'Fissa') : null,
        canDelete ? h('button', { class: 'link del', type: 'button', onclick: () => remove(m.id) }, 'Elimina') : null
      ) : null;

      return h('div', { class: 'msg' + (mine ? ' mine' : '') + (m.pinned ? ' is-pinned' : ''), id: 'm-' + m.id },
        h('div', { class: 'bubble' },
          h('div', { class: 'meta' },
            h('span', { class: 'name' }, m.username),
            prof ? h('span', { class: 'badge' }, 'prof') : null,
            h('time', { datetime: m.created_at }, fmtTime(m.created_at)),
            m.pinned ? h('span', { class: 'flag' }, 'Fissato') : null,
            acts),
          m.text ? h('div', { class: 'text' }, m.text) : null,
          files)
      );
    }

    function render(data, toBottom) {
      const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      const prevTop = feed.scrollTop;
      let newFromOthers = false;

      feed.replaceChildren();
      if (!data.messages.length) {
        feed.append(h('div', { class: 'empty' }, h('strong', {}, 'Nessun messaggio, per ora.'), 'Scrivi il primo spunto di discussione.'));
      }
      let lastDay = '';
      data.messages.forEach((m) => {
        const day = new Date(m.created_at).toDateString();
        if (day !== lastDay) {
          feed.append(h('div', { class: 'day' }, fmtDay(m.created_at)));
          lastDay = day;
        }
        if (!first && !seen.has(m.id) && m.user_id !== me.id) newFromOthers = true;
        seen.add(m.id);
        feed.append(msgNode(m));
      });

      if (first || toBottom || nearBottom) scrollEnd(false);
      else {
        feed.scrollTop = prevTop;
        if (newFromOthers) jump.hidden = false;
      }

      pins.replaceChildren();
      pins.hidden = !data.pinned.length;
      if (data.pinned.length) {
        pins.append(h('h3', {}, data.pinned.length === 1 ? 'Messaggio fissato' : 'Messaggi fissati'));
        data.pinned.forEach((m) => pins.append(pinItem(m)));
      }
      first = false;
    }

    async function load(force = false, toBottom = false) {
      try {
        const data = await api('/api/messages');
        const snap = JSON.stringify(data);
        if (force || snap !== lastSnapshot) {
          lastSnapshot = snap;
          render(data, toBottom);
        }
      } catch (ex) {
        if (ex.status === 401) kicked();
      }
    }

    async function pin(id, pinned) {
      try { await api(`/api/messages/${id}/pin`, { json: { pinned } }); await load(true); }
      catch (ex) { alert(ex.message); }
    }
    async function remove(id) {
      if (!confirm('Eliminare questo messaggio?')) return;
      try { await api(`/api/messages/${id}`, { method: 'DELETE' }); await load(true); }
      catch (ex) { alert(ex.message); }
    }

    // ----- finestre -----
    function openModal(title, ...content) {
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      const close = () => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
      };
      const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { class: 'modal-head' },
            h('h3', {}, title),
            h('button', { class: 'btn sm', type: 'button', onclick: close }, 'Chiudi')),
          content));
      document.addEventListener('keydown', onKey);
      document.body.append(overlay);
      return close;
    }

    function openUsers() {
      const list = h('div', {}, 'Caricamento…');
      openModal('Studenti della classe', list,
        h('p', { class: 'note' }, 'Rimuovere uno studente cancella anche i suoi messaggi e i suoi file.'));
      async function refresh() {
        try {
          const { users } = await api('/api/users');
          list.replaceChildren(...users.map((u) => h('div', { class: 'user-row' },
            h('div', { class: 'info' },
              u.username, u.role === 'admin' ? [' ', h('span', { class: 'badge' }, 'prof')] : null,
              h('small', {}, `${u.messages} messaggi · iscritto il ${new Date(u.created_at).toLocaleDateString('it-IT')}`)),
            u.role === 'admin' ? null : h('button', {
              class: 'btn sm danger', type: 'button',
              onclick: async () => {
                if (!confirm(`Rimuovere ${u.username} dalla classe? Verranno cancellati anche i suoi messaggi.`)) return;
                try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); await refresh(); await load(true); }
                catch (ex) { alert(ex.message); }
              },
            }, 'Rimuovi')
          )));
        } catch (ex) { list.textContent = ex.message; }
      }
      refresh();
    }

    function openPassword() {
      const oldPw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
      const newPw = h('input', { type: 'password', autocomplete: 'new-password', required: true });
      const msg = h('div', { class: 'err', role: 'status' });
      openModal('Cambia password',
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            msg.className = 'err';
            msg.textContent = '';
            try {
              await api('/api/password', { json: { oldPassword: oldPw.value, newPassword: newPw.value } });
              msg.className = 'err ok';
              msg.textContent = 'Password cambiata.';
              oldPw.value = '';
              newPw.value = '';
            } catch (ex) {
              msg.textContent = ex.message;
            }
          },
        },
          h('label', { class: 'field' }, h('span', {}, 'Password attuale'), oldPw),
          h('label', { class: 'field' }, h('span', {}, 'Nuova password'), newPw),
          h('button', { class: 'btn primary wide', type: 'submit' }, 'Salva password'),
          msg));
      oldPw.focus();
    }

    async function logout() {
      try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
      me = null;
      showAuth();
    }

    load(true);
    stopPolling();
    // Ogni 4 secondi se la pagina è aperta, ogni ~20 secondi se è in background (serve anche a segnalare che l'account è in uso).
    pollTimer = setInterval(() => {
      if (!document.hidden) { hiddenTicks = 0; load(); }
      else if (++hiddenTicks % 5 === 0) load();
    }, 4000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // ---------- Avvio ----------
  api('/api/me').then((d) => { me = d.user; showMain(); }).catch(() => showAuth());
})();
