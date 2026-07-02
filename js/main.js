/* =========================================================
   FINAL FRONT — main.js  (Spielschleife & Start)
   ========================================================= */

window.game = null;

let lastFrame = performance.now();

function loop(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (window.game) {
    keyboardPan(Math.min(dt, 0.1));
    game.tick(dt);
    render();
    drainToasts();
    renderOffers();
    if (now - UI.lastPanelUpdate > 400) {
      UI.lastPanelUpdate = now;
      updateTopbar();
      if (UI.activeTab === 'armeen' && !document.querySelector('#panel-content select:focus, #panel-content input:focus')) refreshPanel();
      else if (UI.activeTab === 'info') refreshPanel();
      updateUnitbar();   // Balken/Status der ausgewählten Divisionen live halten
      if (now - (UI._lastRankT || 0) > 2000) {
        UI._lastRankT = now;
        renderRanking();
      }
    }
    updateLog();
    checkGameOver();
  }
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', () => {
  uiInit();
  showStartScreen();
  requestAnimationFrame(loop);

  // Debug-/Test-API
  window.FF = {
    get game() { return window.game; },
    startGame,
    validate() { return validateMap(buildMap()); },
  };
  document.getElementById('gameover-restart').addEventListener('click', showStartScreen);
});
