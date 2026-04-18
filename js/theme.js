// ProCyberWall — Theme (light / dark)
// Applied immediately to prevent flash
(function () {
  const saved = localStorage.getItem('cw-theme');
  const pref  = saved || 'dark';
  document.documentElement.setAttribute('data-theme', pref);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next    = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cw-theme', next);
  _syncThemeIcons();
}

function _syncThemeIcons() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('.theme-toggle-icon').forEach(el => {
    el.textContent = isDark ? '☀️' : '🌙';
  });
  document.querySelectorAll('.theme-toggle-label').forEach(el => {
    el.textContent = isDark ? 'Light mode' : 'Dark mode';
  });
}

// Sync icons once DOM is ready
document.addEventListener('DOMContentLoaded', _syncThemeIcons);
