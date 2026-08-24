(function () {
  'use strict';
  async function boot() {
    Scene3D.init(document.getElementById('scene'));
    UI.init();
    var state = await Store.init();
    if (state.loggedIn) {
      document.getElementById('searchBar').classList.remove('hidden');
      Scene3D.rebuildAll(true);
    } else {
      UI.showLogin();
    }
    window.__app = {
      Store: Store,
      Scene3D: Scene3D,
      UI: UI,
      search: function (q) {
        document.getElementById('searchInput').value = q || '';
        UI.doSearch();
      }
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
