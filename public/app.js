(() => {
  const app = document.getElementById('app');
  let me = null;
  let pollTimer = null;
  let lastSnapshot = '';
  let pickedFile = null;

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
  function fmtDate(iso) {
    return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Schermata di accesso ----------
  function showAuth(mode = 'login') {
    stopPolling();
    app.replaceChildren();
    const err = h('div', { class: 'err' });
    const user = h('input', { type: 'text', autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
    const code = h('input', { type: 'text', autocomplete: 'off' });

    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          const body = { username: user.value, password: pass.value };
          if (mode === 'register') body.code = code.value;
          const data = await api(mode === 'login' ? '/api/login' : '/api/register', { json: body });
          me = data.user;
          showMain();
        } catch (ex) { err.textContent = ex.message; }
      },
    },
      h('label', {}, 'Nome utente'), user,
      h('label', {}, 'Password' + (mode === 'register' ? ' (almeno 6 caratteri)' : '')), pass,
      mode === 'register' ? [h('label', {}, 'Codice classe (te lo dà la prof, se richiesto)'), code] : null,
      h('button', { class: 'primary', type: 'submit' }, mode === 'login' ? 'Entra' : 'Crea account'),
      err
    );

    app.append(h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-card' },
        h('h1', {}, 'Aula di Filosofia'),
        h('p', { class: 'sub' }, 'Lo spazio della nostra classe'),
        h('div', { class: 'tabs' },
          h('button', { class: mode === 'login' ? 'on' : '', type: 'button', onclick: () => showAuth('login') }, 'Accedi'),
          h('button', { class: mode === 'register' ? 'on' : '', type: 'button', onclick: () => showAuth('register') }, 'Registrati')
        ),
        form
      )
    ));
    user.focus();
  }

  // ---------- Schermata principale ----------
  function showMain() {
    app.replaceChildren();
    lastSnapshot = '';
    pickedFile = null;

    const isAdmin = me.role === 'admin';
    const feed = h('div', { id: 'feed' });
    const pinnedBox = h('div', { class: 'pinned', hidden: true });

    const text = h('textarea', { rows: '1', placeholder: 'Scrivi un messaggio…', maxlength: '4000' });
    const fileInput = h('input', { type: 'file', hidden: true });
    const chosen = h('div', { class: 'chosen', hidden: true });
    const err = h('div', { class: 'err' });
    const sendBtn = h('button', { class: 'send', type: 'submit' }, 'Invia');

    function refreshChosen() {
      chosen.replaceChildren();
      if (pickedFile) {
        chosen.hidden = false;
        chosen.append(`📎 ${pickedFile.name} (${fmtSize(pickedFile.size)})`,
          h('button', { type: 'button', onclick: () => { pickedFile = null; fileInput.value = ''; refreshChosen(); } }, 'rimuovi'));
      } else chosen.hidden = true;
    }
    fileInput.addEventListener('change', () => {
      pickedFile = fileInput.files[0] || null;
      if (pickedFile && pickedFile.size > 8 * 1024 * 1024) {
        err.textContent = 'File troppo grande (massimo 8 MB).';
        pickedFile = null; fileInput.value = '';
      } else err.textContent = '';
      refreshChosen();
    });
    text.addEventListener('input', () => {
      text.style.height = 'auto';
      text.style.height = Math.min(text.scrollHeight, 140) + 'px';
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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
          text.value = ''; text.style.height = 'auto';
          pickedFile = null; fileInput.value = ''; refreshChosen();
          await load(true);
        } catch (ex) { err.textContent = ex.message; }
        sendBtn.disabled = false;
        text.focus();
      },
    },
      chosen,
      h('div', { class: 'row' },
        h('button', { class: 'ghost clip', type: 'button', title: 'Allega un file', onclick: () => fileInput.click() }, '📎'),
        text, fileInput, sendBtn
      ),
      err
    );

    const header = h('header', { class: 'top' },
      h('h2', {}, 'Aula di Filosofia'),
      h('span', { class: 'who' }, me.username, isAdmin ? h('span', { class: 'badge' }, 'prof') : null),
      isAdmin ? h('button', { class: 'ghost', onclick: openUsers }, 'Classe') : null,
      h('button', { class: 'ghost', onclick: openPassword }, 'Password'),
      h('button', { class: 'ghost', onclick: logout }, 'Esci')
    );

    app.append(h('div', { class: 'shell' }, header, pinnedBox, feed, form));

    // ----- rendering messaggi -----
    function msgNode(m, { compact = false } = {}) {
      const attach = m.file_id ? [
        /^image\/(png|jpeg|gif|webp)$/.test(m.file_mime)
          ? h('a', { href: `/api/files/${m.file_id}`, target: '_blank', rel: 'noopener' },
              h('img', { class: 'preview', src: `/api/files/${m.file_id}?inline=1`, alt: m.file_name, loading: 'lazy' }))
          : null,
        h('a', { class: 'attach', href: `/api/files/${m.file_id}`, download: m.file_name },
          '📄 ', m.file_name, h('small', {}, fmtSize(m.file_size))),
      ] : null;

      const actions = isAdmin && !compact ? h('span', { class: 'actions' },
        h('button', { onclick: () => pin(m.id, !m.pinned) }, m.pinned ? 'stacca' : 'fissa'),
        h('button', { class: 'del', onclick: () => remove(m.id) }, 'elimina')
      ) : null;

      return h('div', { class: 'msg' + (m.pinned ? ' is-pinned' : '') },
        h('div', { class: 'meta' },
          m.pinned ? '📌' : null,
          h('span', { class: 'name' + (m.role === 'admin' ? ' admin' : '') }, m.username),
          m.role === 'admin' ? h('span', { class: 'badge' }, 'prof') : null,
          h('span', {}, fmtDate(m.created_at)),
          actions
        ),
        h('div', { class: 'body' }, m.text || null, m.text && attach ? h('br') : null, attach)
      );
    }

    function render(data) {
      const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      feed.replaceChildren();
      if (!data.messages.length) {
        feed.append(h('div', { class: 'empty' }, 'Ancora nessun messaggio. Inizia tu la discussione.'));
      }
      data.messages.forEach((m) => feed.append(msgNode(m)));
      if (nearBottom || !feed.dataset.init) {
        feed.scrollTop = feed.scrollHeight;
        feed.dataset.init = '1';
      }

      pinnedBox.replaceChildren();
      pinnedBox.hidden = !data.pinned.length;
      if (data.pinned.length) {
        pinnedBox.append(h('strong', {}, '📌 Messaggi fissati'));
        data.pinned.forEach((m) => {
          pinnedBox.append(h('div', { class: 'p-item' },
            h('b', {}, m.username + ': '),
            (m.text || '').slice(0, 200),
            m.file_id ? h('a', { class: 'attach', href: `/api/files/${m.file_id}`, download: m.file_name, style: 'margin-left:6px' }, '📄 ' + m.file_name) : null,
            isAdmin ? h('button', { class: 'ghost', style: 'margin-left:8px;padding:0 6px;font-size:12px', onclick: () => pin(m.id, false) }, 'stacca') : null
          ));
        });
      }
    }

    async function load(force = false) {
      try {
        const data = await api('/api/messages');
        const snap = JSON.stringify(data);
        if (force || snap !== lastSnapshot) {
          lastSnapshot = snap;
          render(data);
        }
      } catch (ex) {
        if (ex.status === 401) { me = null; showAuth(); }
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
    function openModal(content) {
      const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
        h('div', { class: 'modal' },
          h('button', { class: 'ghost close', onclick: () => overlay.remove() }, '✕'),
          content
        ));
      document.body.append(overlay);
      return overlay;
    }

    async function openUsers() {
      const list = h('div', {}, 'Caricamento…');
      openModal([h('h3', {}, 'Studenti della classe'), list,
        h('p', { class: 'note' }, 'Rimuovere uno studente cancella anche i suoi messaggi e i suoi file.')]);
      async function refresh() {
        try {
          const { users } = await api('/api/users');
          list.replaceChildren(...users.map((u) => h('div', { class: 'user-row' },
            h('div', { class: 'info' }, u.username, u.role === 'admin' ? h('span', { class: 'badge' }, 'prof') : null,
              h('small', {}, `${u.messages} messaggi · iscritto il ${new Date(u.created_at).toLocaleDateString('it-IT')}`)),
            u.role === 'admin' ? null : h('button', {
              class: 'ghost danger',
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
      const msg = h('div', { class: 'err' });
      const overlay = openModal([
        h('h3', {}, 'Cambia password'),
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            msg.style.color = ''; msg.textContent = '';
            try {
              await api('/api/password', { json: { oldPassword: oldPw.value, newPassword: newPw.value } });
              msg.style.color = 'inherit'; msg.textContent = 'Password cambiata ✓';
              oldPw.value = ''; newPw.value = '';
            } catch (ex) { msg.textContent = ex.message; }
          },
        },
          h('label', {}, 'Password attuale'), oldPw,
          h('label', {}, 'Nuova password'), newPw,
          h('button', { class: 'primary', type: 'submit' }, 'Salva'),
          msg)
      ]);
      oldPw.focus();
    }

    async function logout() {
      try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
      me = null;
      showAuth();
    }

    load(true);
    stopPolling();
    pollTimer = setInterval(() => { if (!document.hidden) load(); }, 4000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // ---------- Avvio ----------
  api('/api/me').then((d) => { me = d.user; showMain(); }).catch(() => showAuth());
})();
