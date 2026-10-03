(() => {
  const app = document.getElementById('app');
  let me = null;
  let pollTimer = null;

  // ---------- Utilità ----------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    clip: '<path d="M21 11.5l-8.6 8.6a5 5 0 01-7-7L14 4.5a3.3 3.3 0 014.7 4.7L10.1 17.8a1.7 1.7 0 01-2.4-2.4L15.3 7.8"/>',
    pin: '<path d="M12 16.5V22M8.5 3h7l-1 6 3 3.2V14H6.5v-1.8L9.5 9z"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
    send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 010 5.6M18 14.3c1.8.8 3 2.6 3 4.7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    out: '<path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M15 8l4 4-4 4M19 12H9"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  };
  function icon(name, size = 18) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'i');
    s.innerHTML = ICONS[name]; // solo costanti definite qui sopra
    return s;
  }

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

  function btn(name, label, onclick, extra = '') {
    return h('button', { class: 'btn ' + extra, type: 'button', onclick, 'aria-label': label, title: label },
      icon(name, 18), h('span', { class: 'label' }, label));
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
  function hue(name) {
    let n = 0;
    for (const ch of name) n = (n * 31 + ch.codePointAt(0)) % 360;
    return n;
  }
  function initial(name) {
    return (name.trim()[0] || '?').toUpperCase();
  }
  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  // ---------- Accesso ----------
  function showAuth(startMode = 'login') {
    stopPolling();
    app.replaceChildren();
    let mode = startMode;

    const err = h('div', { class: 'err', role: 'alert' });
    const user = h('input', { type: 'text', autocomplete: 'username', required: true, autocapitalize: 'words', spellcheck: 'false' });
    const pass = h('input', { type: 'password', required: true });
    const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const passHint = h('small', {}, 'Almeno 6 caratteri.');
    const codeWrap = h('div', { class: 'collapse' },
      h('div', {}, h('label', { class: 'field' }, h('span', {}, 'Codice classe'), code, h('small', {}, 'Te lo dà la prof.'))));
    const submit = h('button', { class: 'btn primary wide', type: 'submit' });
    const tabLogin = h('button', { type: 'button', onclick: () => setMode('login') }, 'Accedi');
    const tabRegister = h('button', { type: 'button', onclick: () => setMode('register') }, 'Registrati');
    const seg = h('div', { class: 'seg' }, tabLogin, tabRegister);

    function setMode(m) {
      mode = m;
      seg.dataset.on = m === 'login' ? '0' : '1';
      tabLogin.classList.toggle('on', m === 'login');
      tabRegister.classList.toggle('on', m === 'register');
      submit.textContent = m === 'login' ? 'Entra' : 'Crea account';
      passHint.hidden = m === 'login';
      pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      codeWrap.classList.toggle('open', m === 'register');
      codeWrap.inert = m !== 'register';
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
          shake(err);
        }
        submit.disabled = false;
      },
    },
      seg,
      h('label', { class: 'field' }, h('span', {}, 'Nome utente'), user),
      h('label', { class: 'field' }, h('span', {}, 'Password'), pass, passHint),
      codeWrap,
      submit,
      err
    );

    app.append(h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'mark', 'aria-hidden': 'true' }, 'Φ'),
        h('h1', {}, 'Aula di Filosofia'),
        h('p', { class: 'sub' }, 'Discussioni, appunti e file della classe.'),
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
    const seen = new Set();
    const seenPins = new Set();
    const isAdmin = me.role === 'admin';
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    const feed = h('div', { id: 'feed' });
    const jump = h('button', { class: 'jump', type: 'button', onclick: () => scrollEnd(true) }, icon('down', 16), 'Nuovi messaggi');
    const pins = h('section', { class: 'pins', hidden: true, 'aria-label': 'Messaggi fissati' });

    feed.addEventListener('scroll', () => {
      if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80) jump.classList.remove('show');
    });
    function scrollEnd(smooth) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }

    // ----- scrittura -----
    const text = h('textarea', { rows: '1', placeholder: 'Scrivi un messaggio…', maxlength: '4000', 'aria-label': 'Messaggio' });
    const fileInput = h('input', { type: 'file', hidden: true });
    const chosen = h('div', { class: 'chosen', hidden: true });
    const err = h('div', { class: 'err', role: 'alert' });
    const sendBtn = h('button', { class: 'send', type: 'submit', 'aria-label': 'Invia', title: 'Invia' }, icon('send', 22));

    function refreshChosen() {
      chosen.replaceChildren();
      chosen.hidden = !pickedFile;
      if (pickedFile) {
        chosen.append(icon('file', 16), h('span', { class: 'nm' }, pickedFile.name), h('small', {}, fmtSize(pickedFile.size)),
          h('button', {
            class: 'act', type: 'button', 'aria-label': 'Rimuovi il file',
            onclick: () => { pickedFile = null; fileInput.value = ''; refreshChosen(); },
          }, icon('x', 16)));
      }
    }
    fileInput.addEventListener('change', () => {
      pickedFile = fileInput.files[0] || null;
      if (pickedFile && pickedFile.size > 8 * 1024 * 1024) {
        err.textContent = 'File troppo grande (massimo 8 MB).';
        shake(err);
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
      // Sui telefoni "Invio" va a capo; si invia col pulsante.
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
          shake(err);
        }
        sendBtn.disabled = false;
        if (!coarse) text.focus();
      },
    },
      chosen,
      h('div', { class: 'row' },
        h('div', { class: 'box' },
          h('button', { class: 'act', type: 'button', title: 'Allega un file', 'aria-label': 'Allega un file', onclick: () => fileInput.click() }, icon('clip', 20)),
          text, fileInput),
        sendBtn
      ),
      err
    );

    const header = h('header', { class: 'top' },
      h('div', { class: 'mark sm', 'aria-hidden': 'true' }, 'Φ'),
      h('h2', {}, h('span', { class: 'pre' }, 'Aula di '), 'Filosofia'),
      h('span', { class: 'who' }, me.username, isAdmin ? h('span', { class: 'badge' }, 'prof') : null),
      isAdmin ? btn('users', 'Classe', openUsers) : null,
      btn('key', 'Password', openPassword),
      btn('out', 'Esci', logout)
    );

    app.append(h('div', { class: 'shell' }, header, pins, h('div', { class: 'feed-wrap' }, feed, jump), form));

    // ----- messaggi -----
    function goTo(id) {
      const el = document.getElementById('m-' + id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }

    function plaque(m, fresh) {
      return h('div', {
        class: 'plaque' + (fresh ? ' fresh' : ''), role: 'button', tabindex: '0',
        'aria-label': `Messaggio fissato di ${m.username}`,
        onclick: () => goTo(m.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(m.id); } },
      },
        h('span', { class: 'disc' }, icon('pin', 16)),
        h('div', { class: 'p-body' },
          h('div', { class: 'who' }, m.username),
          m.text ? h('div', { class: 'txt' }, m.text) : null,
          m.file_id ? h('div', { class: 'p-file' }, icon('file', 14), h('span', {}, m.file_name)) : null),
        isAdmin ? h('button', {
          class: 'act unpin', type: 'button', title: 'Stacca', 'aria-label': 'Stacca dai fissati',
          onclick: (e) => { e.stopPropagation(); pin(m.id, false); },
        }, icon('x', 15)) : null
      );
    }

    function msgNode(m, isNew) {
      const mine = m.user_id === me.id;
      const prof = m.role === 'admin';

      const files = m.file_id ? h('div', { class: 'files' },
        /^image\/(png|jpeg|gif|webp)$/.test(m.file_mime)
          ? h('a', { href: `/api/files/${m.file_id}`, target: '_blank', rel: 'noopener' },
              h('img', { class: 'preview', src: `/api/files/${m.file_id}?inline=1`, alt: m.file_name, loading: 'lazy' }))
          : null,
        h('a', { class: 'attach', href: `/api/files/${m.file_id}`, download: m.file_name },
          icon('file', 16), h('span', { class: 'nm' }, m.file_name), h('small', {}, fmtSize(m.file_size)))
      ) : null;

      const acts = isAdmin ? h('span', { class: 'acts' },
        h('button', {
          class: 'act' + (m.pinned ? ' on' : ''), type: 'button',
          title: m.pinned ? 'Stacca' : 'Fissa', 'aria-label': m.pinned ? 'Stacca il messaggio' : 'Fissa il messaggio',
          onclick: () => pin(m.id, !m.pinned),
        }, icon('pin', 16)),
        h('button', {
          class: 'act del', type: 'button', title: 'Elimina', 'aria-label': 'Elimina il messaggio',
          onclick: () => remove(m.id),
        }, icon('trash', 16))
      ) : null;

      const avatar = h('div', { class: 'avatar' + (prof ? ' prof' : ''), 'aria-hidden': 'true' }, initial(m.username));
      avatar.style.setProperty('--h', hue(m.username));

      return h('div', { class: 'msg' + (mine ? ' mine' : '') + (m.pinned ? ' is-pinned' : '') + (isNew ? ' enter' : ''), id: 'm-' + m.id },
        avatar,
        h('div', { class: 'bubble' },
          h('div', { class: 'meta' },
            m.pinned ? h('span', { class: 'pin-flag', title: 'Messaggio fissato' }, icon('pin', 14)) : null,
            h('span', { class: 'name' }, m.username),
            prof ? h('span', { class: 'badge' }, 'prof') : null,
            h('time', { datetime: m.created_at }, fmtTime(m.created_at)),
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
        feed.append(h('div', { class: 'empty' },
          h('div', { class: 'mark', 'aria-hidden': 'true' }, 'Φ'),
          h('p', { class: 'big' }, 'Nessun messaggio, per ora.'),
          h('p', {}, 'Scrivi il primo spunto di discussione.')));
      }
      let lastDay = '';
      data.messages.forEach((m) => {
        const day = new Date(m.created_at).toDateString();
        if (day !== lastDay) {
          feed.append(h('div', { class: 'day' }, h('span', {}, fmtDay(m.created_at))));
          lastDay = day;
        }
        const isNew = !first && !seen.has(m.id);
        if (isNew && m.user_id !== me.id) newFromOthers = true;
        seen.add(m.id);
        feed.append(msgNode(m, isNew));
      });

      if (first || toBottom || nearBottom) scrollEnd(false);
      else {
        feed.scrollTop = prevTop;
        if (newFromOthers) jump.classList.add('show');
      }

      pins.replaceChildren();
      pins.hidden = !data.pinned.length;
      if (data.pinned.length) {
        const row = h('div', { class: 'pins-row' });
        data.pinned.forEach((m) => {
          row.append(plaque(m, !first && !seenPins.has(m.id)));
          seenPins.add(m.id);
        });
        pins.append(
          h('div', { class: 'pins-head' }, icon('pin', 15), 'Messaggi fissati', h('span', { class: 'count' }, String(data.pinned.length))),
          row
        );
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
    function openModal(title, ...content) {
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      const close = () => {
        document.removeEventListener('keydown', onKey);
        overlay.classList.add('out');
        setTimeout(() => overlay.remove(), 180);
      };
      const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { class: 'modal-head' },
            h('h3', {}, title),
            h('button', { class: 'act', type: 'button', 'aria-label': 'Chiudi', onclick: close }, icon('x', 20))),
          content));
      document.addEventListener('keydown', onKey);
      document.body.append(overlay);
      return { overlay, close };
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
              shake(msg);
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
    pollTimer = setInterval(() => { if (!document.hidden) load(); }, 4000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // ---------- Avvio ----------
  api('/api/me').then((d) => { me = d.user; showMain(); }).catch(() => showAuth());
})();
