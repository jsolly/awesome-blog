const status = document.getElementById('recipe-offline-status');
const instructions = status?.textContent ?? '';
if (!import.meta.env.DEV && 'serviceWorker' in navigator && status) {
  const updateConnection = () => document.documentElement.classList.toggle('recipe-offline', !navigator.onLine);
  updateConnection();
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  const showReady = () => {
    status.textContent = navigator.onLine
      ? `Recipes saved for offline use. ${instructions}`
      : 'You are offline. Saved recipes, scaling and grocery lists are available. External links need a connection.';
  };
  navigator.serviceWorker.register('/recipe-service-worker.js', { scope: '/', updateViaCache: 'none' })
    .then(async registration => {
      const observeInstaller = () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (registration.waiting) {
            status.textContent = 'Updated recipes are downloaded. Close all recipe tabs and the recipe app, then reopen to use the update.';
          } else if (worker.state === 'redundant' && registration.active) {
            status.textContent = 'Update download failed. Previously saved recipes remain available offline. Reconnect and reload to retry the update.';
          }
        });
      };
      observeInstaller();
      registration.addEventListener('updatefound', observeInstaller);
      if (!registration.active && registration.installing) {
        const worker = registration.installing;
        await new Promise((resolve, reject) => {
          const check = () => {
            if (worker.state === 'activated') resolve();
            if (worker.state === 'redundant') reject(new Error('Offline download failed'));
          };
          worker.addEventListener('statechange', check);
          check();
        });
      }
      showReady();
      window.addEventListener('online', showReady);
      window.addEventListener('offline', showReady);
      const showUpdate = () => {
        status.textContent = 'Updated recipes are downloaded. Close all recipe tabs and the recipe app, then reopen to use the update.';
      };
      if (registration.waiting) showUpdate();
    })
    .catch(() => {
      status.textContent = `Recipes could not be saved offline. Reconnect and reload to try again. ${instructions}`;
    });
}
