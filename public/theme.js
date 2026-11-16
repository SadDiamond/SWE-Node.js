const THEME = 'theme';
const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

try {
  const saved = localStorage.getItem(THEME);
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
} catch {
  // Storage can be blocked. The page then follows the device setting.
}

function isDark() {
  return root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches;
}

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('theme-button');
  const label = () => {
    button.textContent = isDark() ? 'Light mode' : 'Dark mode';
  };
  button.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME, root.dataset.theme);
    } catch {
      // Not saved, but it still changes for this page.
    }
    label();
  });
  systemDark.addEventListener('change', label);
  label();
});
