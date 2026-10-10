// ~/mookie · terminal de la página 404
// Muestra la ruta pedida, sugiere los posts más parecidos y responde a unos pocos comandos.
// Todo lo que escribe el usuario se pinta con textContent, nunca como HTML.

(function () {
  var posts = window.NF_POSTS || [];
  var base = window.NF_BASE || '';
  var log = document.getElementById('nf-log');
  var form = document.getElementById('nf-form');
  var input = document.getElementById('nf-cmd');
  if (!log || !form || !input) return;

  var path = location.pathname;
  try { path = decodeURIComponent(path); } catch (e) {}
  Array.prototype.forEach.call(document.querySelectorAll('[data-nf-path]'), function (el) { el.textContent = path; });

  // --- ¿Quisiste decir? -------------------------------------------------
  // Palabras de la URL (sin fecha ni extensión) frente a las del slug y el título de cada post.
  // Palabras que aparecen en casi cualquier URL o título y no ayudan a encontrar el post
  var STOP = ['posts', 'post', 'blog', 'html', 'www', 'mookiefumi', 'com', 'con', 'los', 'las', 'del', 'una', 'para'];

  function words(text) {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9#]+/).filter(function (w) { return w.length > 2 && !/^\d+$/.test(w) && STOP.indexOf(w) < 0; });
  }

  function score(wanted, post) {
    var have = words(post.u + ' ' + post.t);
    return wanted.reduce(function (total, w) {
      var hit = have.some(function (h) { return h === w || (w.length > 3 && (h.indexOf(w) === 0 || w.indexOf(h) === 0) && h.length > 3); });
      return total + (hit ? 1 : 0);
    }, 0);
  }

  var wanted = words(path.replace(/\.html?$/, ''));
  var matches = posts
    .map(function (p) { return { post: p, score: score(wanted, p) }; })
    .filter(function (m) { return m.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 3);

  if (matches.length) {
    document.getElementById('nf-grep').textContent = wanted[0] || '';
    var list = document.getElementById('nf-suggest-list');
    matches.forEach(function (m) { list.appendChild(postItem(m.post)); });
    document.getElementById('nf-suggest').hidden = false;
  }

  // --- Terminal -----------------------------------------------------------
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function postItem(post) {
    var li = el('li');
    var a = el('a', null, '→ ' + post.t);
    a.href = post.u;
    li.appendChild(a);
    return li;
  }

  function promptLine(cmd) {
    var p = el('p', 'prompt-line');
    [['p-user', 'mookie'], ['p-sep', '@'], ['p-host', 'dev'], ['p-sep', ':'], ['p-path', '~'], ['p-sep', '$']].forEach(function (part) {
      p.appendChild(el('span', part[0], part[1]));
    });
    p.appendChild(document.createTextNode(' ' + cmd));
    return p;
  }

  function print(text, cls) { log.appendChild(el('p', cls || 'nf-muted', text)); }

  function go(url, label) {
    print('→ ' + label + '…');
    location.href = base + url;
  }

  var routes = { '~': '/', '/': '/', '': '/', 'temas': '/temas', '~/temas': '/temas', 'recursos': '/recursos', '~/recursos': '/recursos', 'sobre-mi': '/aboutme', '~/sobre-mi': '/aboutme' };

  var commands = {
    help: function () {
      var dl = el('dl', 'nf-help');
      [['ls', 'últimos posts'], ['cd ~', 'volver a la portada'], ['cd temas | recursos | sobre-mi', 'ir a esa sección'], ['cat sobre-mi.md', 'quién escribe esto'], ['tree ~/temas', 'todos los temas'], ['whoami', 'quién eres aquí'], ['clear', 'limpiar la terminal'], ['sudo …', 'no lo intentes']].forEach(function (row) {
        dl.appendChild(el('dt', null, row[0]));
        dl.appendChild(el('dd', null, row[1]));
      });
      log.appendChild(dl);
    },
    ls: function () {
      var ul = el('ul', 'nf-list');
      posts.slice(0, 5).forEach(function (p) { ul.appendChild(postItem(p)); });
      log.appendChild(ul);
    },
    cd: function (args) {
      var target = (args[0] || '~').replace(/\/$/, '');
      if (Object.prototype.hasOwnProperty.call(routes, target)) return go(routes[target], 'cd ' + (args[0] || '~'));
      print('bash: cd: ' + args.join(' ') + ': No such file or directory', 'nf-err');
    },
    cat: function (args) {
      if (/sobre-?mi(\.md)?$/.test(args[0] || '')) return go('/aboutme', 'abriendo sobre-mi.md');
      print('cat: ' + (args[0] || '') + ': No such file or directory', 'nf-err');
    },
    tree: function () { go('/temas', 'tree ~/temas'); },
    whoami: function () { print('mookie (bueno, tú eres el que se ha perdido)'); },
    pwd: function () { print(path); },
    clear: function () { log.textContent = ''; },
    exit: function () { go('/', 'exit'); },
    sudo: function () { print('mookie no está en el fichero sudoers. Este incidente será reportado.', 'nf-warn'); }
  };

  form.hidden = false;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var raw = input.value.trim();
    input.value = '';
    if (!raw) return;
    log.appendChild(promptLine(raw));
    var parts = raw.split(/\s+/);
    var name = parts[0].toLowerCase();
    var run = Object.prototype.hasOwnProperty.call(commands, name) ? commands[name] : null;
    if (run) run(parts.slice(1));
    else print('bash: ' + parts[0] + ': command not found · prueba con help', 'nf-err');
    input.scrollIntoView({ block: 'nearest' });
  });
})();
