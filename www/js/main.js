(function () {
  'use strict';
  function blockNativeZoom() {
    // 阻止 WebView 双击/手势缩放（APK 三维场景内不允许系统级放大）
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
  }

  async function boot() {
    blockNativeZoom();
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
