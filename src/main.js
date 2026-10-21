import './styles/fonts.css';
import './styles/tokens.css';

const VIEWS = ['build', 'catalog', 'saved'];

function getViewFromHash() {
  const view = location.hash.replace('#', '');
  return VIEWS.includes(view) ? view : 'build';
}

function showView(view) {
  for (const section of document.querySelectorAll('[data-view]')) {
    section.hidden = section.dataset.view !== view;
  }
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', () => showView(getViewFromHash()));
showView(getViewFromHash());
