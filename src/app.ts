import "@fontsource-variable/manrope";

import {
  DEMO_BLOCKED_ID,
  DEMO_LEVEL,
  DEMO_SUCCESS_ID,
  LEVELS,
} from "./content/levels";
import { applyMove, createGameState, simulateMove } from "./core/game-state";
import type { GameState, LevelDefinition, MoveResult } from "./core/types";
import { PointerInput } from "./input";
import { PwaInstallPrompt } from "./pwa";
import { PuzzleRenderer } from "./render/renderer";
import {
  clearCampaign,
  loadCampaign,
  loadSettings,
  type PlayerSettings,
  saveCampaign,
  saveSettings,
} from "./storage";

type AppMode = "demo" | "campaign" | "complete";

const ARROW_SPEED_MULTIPLIER = 1.5625;

interface Motion {
  readonly result: MoveResult;
  readonly duration: number;
  elapsed: number;
  impactShown: boolean;
}

interface Celebration {
  elapsed: number;
}

const CELEBRATION_DURATION = 2600;
const CONFETTI_COUNT = 56;

export class ParArrowsApp {
  private readonly root: HTMLElement;
  private readonly renderer: PuzzleRenderer;
  private readonly input: PointerInput;
  private readonly stage: HTMLElement;
  private readonly levelLabel: HTMLElement;
  private readonly livesLabel: HTMLElement;
  private readonly arrowsLabel: HTMLElement;
  private readonly message: HTMLElement;
  private readonly levelSelect: HTMLSelectElement;
  private readonly tutorial: HTMLElement;
  private readonly tutorialCopy: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly installButton: HTMLButtonElement;
  private readonly installHint: HTMLElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly reducedMotion: HTMLInputElement;
  private readonly celebrationLayer: HTMLElement;
  private readonly systemMotionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private mode: AppMode = "campaign";
  private level: LevelDefinition = LEVELS[0] as LevelDefinition;
  private state: GameState = createGameState(LEVELS[0] as LevelDefinition);
  private displayedState: GameState = this.state;
  private unlockedLevelId = 1;
  private tutorialComplete = false;
  private settings: PlayerSettings = loadSettings();
  private motion: Motion | undefined;
  private celebration: Celebration | undefined;
  private demoStage: "observe" | "pause" | "ready" = "observe";
  private demoElapsed = 0;
  private animationFrame = 0;
  private lastTimestamp = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <main class="app-shell">
        <header class="hud" aria-label="Puzzle status">
          <div class="brand"><span class="brand-mark">↗</span><span>Par Arrows</span></div>
          <div class="status-chip"><span id="level-label">Cube 1</span><span class="separator">·</span><span id="arrows-label">0 arrows</span></div>
          <div class="lives" aria-live="polite"><span class="lives-caption">LIVES</span><strong id="lives-label">5</strong></div>
        </header>
        <section class="game-stage" id="game-stage" aria-label="Interactive cube puzzle">
          <div class="tutorial-card" id="tutorial" aria-live="polite">
            <div class="tutorial-kicker">HOW IT WORKS</div>
            <h1>Find the open way.</h1>
            <p id="tutorial-copy">A blocked arrow returns and turns red.</p>
            <button class="primary-button" id="start-button" type="button" hidden>Start level 1</button>
          </div>
          <div class="touch-cue" id="touch-cue" aria-hidden="true"><span></span></div>
          <div class="celebration-layer" id="celebration-layer" aria-hidden="true"></div>
          <div class="state-card" id="state-card" hidden>
            <div class="tutorial-kicker" id="state-kicker">CLEAR</div>
            <div class="victory-emblem" aria-hidden="true">★</div>
            <h2 id="state-title">Path complete</h2>
            <p id="state-copy">The next cube is ready.</p>
            <button class="primary-button" id="state-button" type="button">Next cube</button>
          </div>
        </section>
        <nav class="control-dock" aria-label="Puzzle controls">
          <button class="dock-button" data-action="reset" type="button" aria-label="Reset camera view">⌖<span>View</span></button>
          <button class="dock-button" data-action="retry" type="button">↻<span>Retry</span></button>
          <label class="level-picker"><span>Cube</span><select id="level-select" aria-label="Choose an unlocked cube"></select></label>
          <button class="dock-button" id="settings-button" type="button" aria-expanded="false">☼<span>Settings</span></button>
        </nav>
        <aside class="settings-panel" id="settings-panel" hidden>
          <label><input id="reduced-motion" type="checkbox" /> Reduce movement</label>
          <button id="install-button" type="button" hidden>Install app</button>
          <p id="install-hint" hidden></p>
        </aside>
        <p class="gesture-help">Drag to orbit · <span class="zoom-help-mouse">Mouse wheel to zoom</span><span class="zoom-help-touch">Pinch to zoom</span> · press an exposed arrow to move it</p>
        <div class="storage-note" id="storage-note" role="status"></div>
      </main>`;
    this.stage = this.requireElement("game-stage");
    this.levelLabel = this.requireElement("level-label");
    this.livesLabel = this.requireElement("lives-label");
    this.arrowsLabel = this.requireElement("arrows-label");
    this.message = this.requireElement("storage-note");
    this.levelSelect = this.requireElement("level-select") as HTMLSelectElement;
    this.tutorial = this.requireElement("tutorial");
    this.tutorialCopy = this.requireElement("tutorial-copy");
    this.startButton = this.requireElement("start-button") as HTMLButtonElement;
    this.installButton = this.requireElement(
      "install-button",
    ) as HTMLButtonElement;
    this.installHint = this.requireElement("install-hint");
    this.settingsButton = this.requireElement(
      "settings-button",
    ) as HTMLButtonElement;
    this.reducedMotion = this.requireElement(
      "reduced-motion",
    ) as HTMLInputElement;
    this.celebrationLayer = this.requireElement("celebration-layer");
    this.reducedMotion.checked = this.settings.reducedMotion;
    this.renderer = new PuzzleRenderer(this.stage);
    this.input = new PointerInput(this.renderer.canvas, {
      pick: (x, y) => this.renderer.pick(x, y),
      onPress: (id) => this.renderer.setSelected(id),
      onTap: (id) => this.attempt(id),
      onOrbit: (x, y) => this.renderer.orbit(x, y),
      onZoom: (amount) => this.renderer.zoom(amount),
    });
    this.bindControls();
    this.systemMotionPreference.addEventListener(
      "change",
      this.handleMotionPreference,
    );
    this.restore();
    this.installPrompt = new PwaInstallPrompt((available, ios) =>
      this.updateInstallPrompt(available, ios),
    );
    this.installDebugApi();
    this.renderUi();
    this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.systemMotionPreference.removeEventListener(
      "change",
      this.handleMotionPreference,
    );
    this.clearCelebration();
    this.input.dispose();
    this.renderer.dispose();
  }

  advanceTime(milliseconds: number): void {
    const steps = Math.max(1, Math.ceil(milliseconds / (1000 / 60)));
    for (let index = 0; index < steps; index += 1) {
      this.update(milliseconds / steps);
    }
  }

  diagnosticText(): string {
    return JSON.stringify({
      mode: this.mode,
      level: { id: this.level.id, title: this.level.title },
      lives: this.displayedState.lives,
      remainingIds: this.displayedState.remainingIds,
      failedIds: this.displayedState.failedIds,
      moving: this.motion
        ? {
            arrowId: this.motion.result.arrowId,
            kind: this.motion.result.kind,
            elapsed: Math.round(this.motion.elapsed),
            duration: this.motion.duration,
          }
        : null,
      celebration: this.celebration
        ? {
            active: true,
            elapsed: Math.round(this.celebration.elapsed),
            duration: CELEBRATION_DURATION,
          }
        : { active: false, elapsed: 0, duration: CELEBRATION_DURATION },
      camera: this.renderer.cameraDiagnostics(),
      visibleProjectedArrowPositions: this.renderer
        .projectedArrows()
        .filter((arrow) => arrow.visible),
      coordinateSystem:
        "screen x grows right and y grows down from the canvas top-left",
    });
  }

  loadLevel(levelId: number): void {
    const level = LEVELS.find((candidate) => candidate.id === levelId);
    if (!level) {
      return;
    }
    this.mode = "campaign";
    this.level = level;
    this.state = createGameState(level);
    this.displayedState = this.state;
    this.motion = undefined;
    this.clearCelebration();
    this.tutorialComplete = true;
    this.unlockedLevelId = Math.max(this.unlockedLevelId, level.id);
    this.renderer.setLevel(level, this.state);
    this.renderUi();
  }

  resetProgress(): void {
    clearCampaign();
    this.mode = "demo";
    this.level = DEMO_LEVEL;
    this.state = createGameState(DEMO_LEVEL);
    this.displayedState = this.state;
    this.tutorialComplete = false;
    this.unlockedLevelId = 1;
    this.demoStage = "observe";
    this.demoElapsed = 0;
    this.motion = undefined;
    this.clearCelebration();
    this.renderer.setLevel(DEMO_LEVEL, this.state);
    this.renderUi();
  }

  private readonly tick = (timestamp: number): void => {
    const delta =
      this.lastTimestamp === 0
        ? 0
        : Math.min(50, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    this.update(delta);
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private update(delta: number): void {
    if (this.celebration) {
      this.celebration.elapsed += delta;
      if (this.celebration.elapsed >= CELEBRATION_DURATION) {
        this.clearCelebration();
        this.renderUi();
      }
    }
    if (this.motion) {
      this.motion.elapsed += delta;
      const progress = Math.min(1, this.motion.elapsed / this.motion.duration);
      this.renderer.animate(
        this.motion.result.arrowId,
        this.motion.result,
        progress,
      );
      if (
        this.motion.result.kind === "blocked" &&
        !this.motion.impactShown &&
        progress >= 0.5
      ) {
        this.motion.impactShown = true;
        this.displayedState = this.state;
        this.renderer.updateState(this.state);
        this.renderUi();
      }
      if (progress === 1) {
        this.finishMotion(this.motion.result.arrowId);
      }
      return;
    }
    if (this.mode === "demo" && this.demoStage !== "ready") {
      this.demoElapsed += delta;
      if (this.demoStage === "observe" && this.demoElapsed >= 800) {
        this.demoElapsed = 0;
        this.attempt(DEMO_BLOCKED_ID, true);
      } else if (this.demoStage === "pause" && this.demoElapsed >= 500) {
        this.demoElapsed = 0;
        this.attempt(DEMO_SUCCESS_ID, true);
      }
    }
  }

  private attempt(arrowId: string, scripted = false): void {
    if (this.motion || (this.mode === "demo" && !scripted)) {
      return;
    }
    const result = simulateMove(this.level, this.state, arrowId);
    const next = applyMove(this.level, this.state, result);
    if (result.kind === "invalid" || next === this.state) {
      return;
    }
    this.state = next;
    if (this.mode === "campaign") {
      if (next.status === "won") {
        this.unlockedLevelId = Math.max(
          this.unlockedLevelId,
          Math.min(LEVELS.at(-1)?.id ?? this.level.id, this.level.id + 1),
        );
      }
      this.persist();
    }
    this.motion = {
      result,
      elapsed: 0,
      impactShown: false,
      duration:
        (this.settings.reducedMotion
          ? 110
          : result.kind === "blocked"
            ? 740
            : 880) / ARROW_SPEED_MULTIPLIER,
    };
    this.renderer.setSelected(undefined);
    this.renderer.animate(arrowId, result, 0);
  }

  private finishMotion(arrowId: string): void {
    this.motion = undefined;
    this.renderer.settle(arrowId);
    this.renderer.updateState(this.state);
    this.displayedState = this.state;
    if (this.mode === "demo") {
      if (arrowId === DEMO_BLOCKED_ID) {
        this.demoStage = "pause";
      } else if (arrowId === DEMO_SUCCESS_ID) {
        this.demoStage = "ready";
      }
    } else if (this.state.status === "won") {
      this.unlockedLevelId = Math.max(
        this.unlockedLevelId,
        Math.min(LEVELS.at(-1)?.id ?? this.level.id, this.level.id + 1),
      );
      this.persist();
      this.startCelebration();
    }
    this.renderUi();
  }

  private restore(): void {
    const saved = loadCampaign(LEVELS);
    if (saved.contentUpdated) {
      this.message.textContent =
        "Puzzle layouts were updated. This cube restarted, and your unlocked cubes are still available.";
    } else if (saved.recovered) {
      this.message.textContent =
        "Saved progress was unavailable, so this puzzle started fresh.";
    }
    if (saved.value) {
      this.level =
        LEVELS.find(
          (candidate) => candidate.id === saved.value?.currentLevelId,
        ) ?? (LEVELS[0] as LevelDefinition);
      this.state = saved.value.state;
      this.displayedState = this.state;
      this.unlockedLevelId = saved.value.unlockedLevelId;
      this.tutorialComplete = saved.value.tutorialComplete;
    }
    if (!this.tutorialComplete) {
      this.mode = "demo";
      this.level = DEMO_LEVEL;
      this.state = createGameState(DEMO_LEVEL);
      this.displayedState = this.state;
    }
    this.renderer.setLevel(this.level, this.state);
  }

  private beginCampaign(): void {
    if (this.mode !== "demo" || this.demoStage !== "ready") {
      return;
    }
    this.tutorialComplete = true;
    this.mode = "campaign";
    this.level = LEVELS[0] as LevelDefinition;
    this.state = createGameState(this.level);
    this.displayedState = this.state;
    this.unlockedLevelId = Math.max(this.unlockedLevelId, 1);
    this.renderer.setLevel(this.level, this.state);
    this.persist();
    this.renderUi();
  }

  private retry(): void {
    if (this.mode !== "campaign") {
      return;
    }
    this.motion = undefined;
    this.clearCelebration();
    this.state = createGameState(this.level);
    this.displayedState = this.state;
    this.renderer.setLevel(this.level, this.state);
    this.persist();
    this.renderUi();
  }

  private selectLevel(levelId: number): void {
    if (this.mode !== "campaign" || levelId > this.unlockedLevelId) {
      return;
    }
    this.loadLevel(levelId);
    this.persist();
  }

  private persist(): void {
    const stored = saveCampaign({
      currentLevelId: this.level.id,
      unlockedLevelId: this.unlockedLevelId,
      state: this.state,
      tutorialComplete: this.tutorialComplete,
    });
    if (!stored) {
      this.message.textContent =
        "Progress cannot be saved in this browser session.";
    }
  }

  private renderUi(): void {
    this.levelLabel.textContent =
      this.mode === "demo" ? "First flight" : this.level.title;
    this.livesLabel.textContent = String(this.displayedState.lives);
    this.arrowsLabel.textContent = `${this.displayedState.remainingIds.length} arrows`;
    this.tutorial.hidden = this.mode !== "demo";
    this.levelSelect.disabled = this.mode !== "campaign";
    if (this.mode === "demo") {
      this.tutorialCopy.textContent =
        this.demoStage === "observe"
          ? "Watch a blocked arrow return, then find the open way."
          : this.demoStage === "pause"
            ? "That arrow stays red. Now watch its blocker leave."
            : "You have seen both outcomes.";
      this.startButton.hidden = this.demoStage !== "ready";
      const cue = this.requireElement("touch-cue");
      const targetId =
        this.demoStage === "observe"
          ? DEMO_BLOCKED_ID
          : this.demoStage === "pause"
            ? DEMO_SUCCESS_ID
            : undefined;
      const target = this.renderer
        .projectedArrows()
        .find((arrow) => arrow.id === targetId && arrow.visible);
      cue.hidden = !target;
      if (target) {
        cue.style.left = `${target.x}px`;
        cue.style.top = `${target.y}px`;
      }
    } else {
      this.requireElement("touch-cue").hidden = true;
    }
    this.levelSelect.replaceChildren(
      ...LEVELS.map((level) => {
        const option = document.createElement("option");
        option.value = String(level.id);
        option.textContent = `${level.id} · ${level.title}`;
        option.disabled = level.id > this.unlockedLevelId;
        option.selected = level.id === this.level.id;
        return option;
      }),
    );
    const card = this.requireElement("state-card");
    const title = this.requireElement("state-title");
    const copy = this.requireElement("state-copy");
    const button = this.requireElement("state-button") as HTMLButtonElement;
    const won = this.mode === "campaign" && this.state.status === "won";
    card.classList.toggle("is-won", won);
    card.classList.toggle(
      "is-celebrating",
      won && this.celebration !== undefined,
    );
    card.hidden =
      this.mode !== "campaign" ||
      this.motion !== undefined ||
      this.state.status === "playing";
    if (won) {
      const final = this.level.id === LEVELS.at(-1)?.id;
      this.requireElement("state-kicker").textContent = final
        ? "ALL CUBES CLEARED"
        : "NICE WORK";
      title.textContent = final ? "Campaign complete!" : "Cube cleared!";
      copy.textContent = final
        ? `You found every open way. All ${LEVELS.length} cubes are complete.`
        : "Every arrow is free. Your next cube is ready.";
      button.textContent = final ? "Replay this cube" : "Next cube";
      button.dataset.action = final ? "retry" : "next";
    } else if (this.state.status === "lost") {
      this.requireElement("state-kicker").textContent = "TRY AGAIN";
      title.textContent = "Try that cube again";
      copy.textContent = "A retry restores its full set of lives.";
      button.textContent = "Retry cube";
      button.dataset.action = "retry";
    }
  }

  private bindControls(): void {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.id === "start-button") {
        this.beginCampaign();
      }
      const action =
        target.closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "reset") this.renderer.resetView();
      if (action === "retry") this.retry();
      if (action === "next")
        this.selectLevel(
          Math.min(this.level.id + 1, LEVELS.at(-1)?.id ?? this.level.id),
        );
    });
    this.levelSelect.addEventListener("change", () =>
      this.selectLevel(Number(this.levelSelect.value)),
    );
    this.settingsButton.addEventListener("click", () => {
      const panel = this.requireElement("settings-panel");
      panel.hidden = !panel.hidden;
      this.settingsButton.setAttribute("aria-expanded", String(!panel.hidden));
    });
    this.reducedMotion.addEventListener("change", () => {
      this.settings = { reducedMotion: this.reducedMotion.checked };
      saveSettings(this.settings);
      if (this.shouldReduceMotion()) {
        this.clearCelebration();
        this.renderUi();
      }
    });
    this.installButton.addEventListener(
      "click",
      () => void this.installPrompt?.prompt(),
    );
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "f") {
        void (document.fullscreenElement
          ? document.exitFullscreen()
          : this.root.requestFullscreen());
      }
    });
  }

  private readonly handleMotionPreference = (): void => {
    if (this.shouldReduceMotion()) {
      this.clearCelebration();
      this.renderUi();
    }
  };

  private shouldReduceMotion(): boolean {
    return this.settings.reducedMotion || this.systemMotionPreference.matches;
  }

  private startCelebration(): void {
    this.clearCelebration();
    if (this.shouldReduceMotion()) {
      return;
    }
    this.celebration = { elapsed: 0 };
    const colors = [
      "#f05c62",
      "#f4b942",
      "#30a8a1",
      "#496be3",
      "#ca5fbe",
      "#ef7c43",
    ];
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < CONFETTI_COUNT; index += 1) {
      const piece = document.createElement("span");
      const angle = (index * 137.508) % 360;
      const distance = 15 + ((index * 29) % 42);
      piece.className = "confetti-piece";
      piece.style.setProperty("--confetti-angle", `${angle}deg`);
      piece.style.setProperty("--confetti-distance", `${distance}vmin`);
      piece.style.setProperty("--confetti-delay", `${(index % 7) * 24}ms`);
      piece.style.setProperty(
        "--confetti-color",
        colors[index % colors.length] as string,
      );
      fragment.append(piece);
    }
    this.celebrationLayer.replaceChildren(fragment);
  }

  private clearCelebration(): void {
    this.celebration = undefined;
    this.celebrationLayer.replaceChildren();
    this.requireElement("state-card").classList.remove("is-celebrating");
  }

  private installPrompt: PwaInstallPrompt | undefined;

  private updateInstallPrompt(available: boolean, ios: boolean): void {
    this.installButton.hidden = !available;
    this.installHint.hidden = !(ios && !available);
    this.installHint.textContent =
      ios && !available
        ? "On iPhone or iPad, use Share, then Add to Home Screen."
        : "";
  }

  private installDebugApi(): void {
    window.render_game_to_text = () => this.diagnosticText();
    window.advanceTime = (milliseconds) => this.advanceTime(milliseconds);
    if (
      import.meta.env.DEV ||
      new URLSearchParams(window.location.search).has("test")
    ) {
      window.__PAR_ARROWS_TEST__ = {
        loadLevel: (id) => this.loadLevel(id),
        resetProgress: () => this.resetProgress(),
        getState: () => this.diagnosticText(),
        activate: (id) => this.attempt(id, true),
      };
    }
  }

  private requireElement(id: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`Missing required interface element: ${id}`);
    return element;
  }
}
