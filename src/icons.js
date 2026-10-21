// SVG-иконки вставляем прямо в разметку, чтобы они брали цвет текста (currentColor)
const files = import.meta.glob('./assets/icons/*.svg', { query: '?raw', import: 'default', eager: true });

const icons = {};
for (const [path, svg] of Object.entries(files)) {
  const name = path.split('/').pop().replace('.svg', '');
  icons[name] = svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" class="icon" ');
}

export function icon(name) {
  return icons[name] || '';
}
