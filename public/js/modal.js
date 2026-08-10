const backdrop = document.getElementById('modal-backdrop');
const titleEl = document.getElementById('modal-title');
const contentEl = document.getElementById('modal-content');
const actionsEl = document.getElementById('modal-actions');

export function openModal(title, contentNodes, actions = []) {
  titleEl.textContent = title;
  contentEl.textContent = '';
  contentNodes.forEach((n) => contentEl.appendChild(n));
  actionsEl.textContent = '';
  actions.forEach(({ label, primary, onClick }) => {
    const btn = document.createElement('button');
    btn.className = primary ? 'btn btn-primary' : 'btn';
    btn.textContent = label;
    btn.addEventListener('click', () => onClick(closeModal));
    actionsEl.appendChild(btn);
  });
  backdrop.classList.remove('hidden');
}

export function closeModal() {
  backdrop.classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) closeModal();
});

let toastTimer = null;
export function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}
