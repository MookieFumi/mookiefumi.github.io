// Csharpeando# · modo oscuro y botón de copiar código

(function () {
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var toggle = document.querySelector('[data-theme-toggle]');

  function currentTheme() {
    return root.getAttribute('data-theme') || (media.matches ? 'dark' : 'light');
  }

  function syncToggle() {
    if (!toggle) return;
    var dark = currentTheme() === 'dark';
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    toggle.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    toggle.setAttribute('title', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      syncToggle();
      // Disqus toma los colores al cargar; se recarga para que siga al tema
      if (window.DISQUS) window.DISQUS.reset({ reload: true });
    });
  }

  if (media.addEventListener) media.addEventListener('change', syncToggle);
  syncToggle();

  // Portapapeles moderno si está disponible (https); si no, selección + execCommand
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(area);
      ok ? resolve() : reject();
    });
  }

  // Botón "Copiar" en cada bloque de código
  var blocks = document.querySelectorAll('.prose div.highlighter-rouge, .prose figure.highlight');
  Array.prototype.forEach.call(blocks, function (block) {
    var code = block.querySelector('pre code') || block.querySelector('pre');
    if (!code) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = 'Copiar';
    button.addEventListener('click', function () {
      copyText(code.innerText).then(function () {
        button.textContent = 'Copiado';
      }, function () {
        button.textContent = 'No se pudo copiar';
      });
      setTimeout(function () { button.textContent = 'Copiar'; }, 1600);
    });
    block.appendChild(button);
  });
})();
