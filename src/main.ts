import "./styles.css";

import { ParArrowsApp } from "./app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Par Arrows could not find its application root.");
}

try {
  new ParArrowsApp(root);
} catch (error) {
  console.warn("Par Arrows could not initialize its 3D view", error);
  root.innerHTML = `<main class="app-shell"><section class="tutorial-card" role="alert">
    <h1>The 3D view could not start.</h1>
    <p>Try updating your browser or enabling graphics acceleration, then reload.</p>
    <button class="primary-button" type="button" id="reload-game">Reload game</button>
  </section></main>`;
  root
    .querySelector("#reload-game")
    ?.addEventListener("click", () => location.reload());
  window.render_game_to_text = () => JSON.stringify({ mode: "unavailable" });
}
