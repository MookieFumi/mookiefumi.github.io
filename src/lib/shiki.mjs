// Resaltado de código con Shiki usando la paleta de ~/mookie. Los bloques de
// código usan fondo de terminal en
// los dos temas, así que basta un solo juego de colores: lima para palabras
// clave, violeta para tipos, cian para cadenas, ámbar para números y gris
// para comentarios.
export const mookieTheme = {
  name: 'mookie',
  type: /** @type {const} */ ('dark'),
  colors: {
    'editor.background': '#05070A',
    'editor.foreground': '#E6EDF3',
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6B7688', fontStyle: 'italic' } },
    { scope: ['invalid'], settings: { foreground: '#FF6B7A' } },
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.word'], settings: { foreground: '#B8F25B' } },
    { scope: ['keyword.type', 'constant.language', 'support.type', 'entity.name.type', 'entity.name.class', 'entity.name.namespace', 'entity.other.inherited-class'], settings: { foreground: '#B39CFF' } },
    { scope: ['entity.name.function', 'support.function', 'meta.attribute', 'support.function.builtin'], settings: { foreground: '#8FB0FF' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#FFB547' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#B8F25B' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#5CC8FF' } },
    { scope: ['constant.character.escape', 'punctuation.definition.string'], settings: { foreground: '#9BDEFF' } },
    { scope: ['constant.numeric'], settings: { foreground: '#FFB547' } },
    { scope: ['markup.deleted'], settings: { foreground: '#FF6B7A' } },
    { scope: ['markup.inserted'], settings: { foreground: '#B8F25B' } },
    { scope: ['markup.heading'], settings: { foreground: '#B39CFF', fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
  ],
};

// Envuelve cada bloque en `<div class="language-xxx code-block">`: `site.css`
// pinta con esas clases la barra de ventana con el lenguaje, y `site.js` añade
// el botón de copiar.
export function codeBlockWrapper() {
  return {
    name: 'mookie:code-block',
    root(root) {
      const lang = this.options.lang;
      const className = !lang || lang === 'plaintext' ? ['code-block'] : [`language-${lang}`, 'code-block'];
      return {
        type: 'root',
        children: [{ type: 'element', tagName: 'div', properties: { className }, children: root.children }],
      };
    },
  };
}
