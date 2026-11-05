import { APPS } from '/config/apps.js';
import { waitFor } from '/tests/browser/host-stub.mjs';
const click = el => el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
/** Follow the current desktop's actual core icon or category folder, then click its member. */
export async function desktopIcon(id) {
  let icon = document.querySelector('.home-screen [data-app="' + id + '"]');
  if (icon) return icon;
  const app = APPS.find(a => a.id === id);
  const folder = document.querySelector('[data-cluster="' + (app?.libraryCategory || 'system') + '"]');
  if (!folder) return null;
  click(folder);
  await waitFor(() => document.querySelector('.cluster-modal [data-app="' + id + '"]'), { timeoutMs: 3000 });
  return document.querySelector('.cluster-modal [data-app="' + id + '"]');
}
export async function desktopIconByName(name) {
  const app = APPS.find(a => a.name === name);
  return app ? desktopIcon(app.id) : null;
}
