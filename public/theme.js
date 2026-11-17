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
  const switchTheme = (next) => {
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME, next);
    } catch {
      // Not saved, but it still changes for this page.
    }
    label();
  };

  // The new theme spreads out from the button like ink, or shrinks back into it when going light.
  // Browsers without view transitions, and people who ask for less motion, get an instant switch.
  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      switchTheme(next);
      return;
    }
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const circles = [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`];
    root.dataset.going = next;
    const transition = document.startViewTransition(() => switchTheme(next));
    transition.ready.then(() => {
      root.animate(
        { clipPath: next === 'dark' ? circles : circles.reverse() },
        {
          duration: 450,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: next === 'dark' ? '::view-transition-new(root)' : '::view-transition-old(root)'
        }
      );
    });
    transition.finished.finally(() => delete root.dataset.going);
  });
  systemDark.addEventListener('change', label);
  label();
});
