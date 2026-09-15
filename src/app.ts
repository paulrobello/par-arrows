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

interface Hint {
  readonly arrowId: string;
  phase: "rotating" | "flashing";
  elapsed: number;
  lit: boolean;
}

const CELEBRATION_DURATION = 2080;
const CONFETTI_COUNT = 56;
const HINT_FOCUS_DURATION = 600;
const HINT_FLASH_DURATION = 2400;
const HINT_FLASH_HALF_PULSE = 400;

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
  private readonly hintButton: HTMLButtonElement;
  private readonly hintStatus: HTMLElement;
  private readonly reducedMotion: HTMLInputElement;
  private readonly themeSelect: HTMLSelectElement;
  private readonly celebrationLayer: HTMLElement;
  private readonly systemMotionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly systemThemePreference = window.matchMedia(
    "(prefers-color-scheme: dark)",
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
  private hint: Hint | undefined;
  private demoStage: "observe" | "pause" | "ready" = "observe";
  private demoElapsed = 0;
  private animationFrame = 0;
  private lastTimestamp = 0;
  private appliedTheme: "light" | "dark" | undefined;

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
          <button class="dock-button" id="hint-button" data-action="hint" type="button" aria-label="Hint">✦<span>Hint</span></button>
          <button class="dock-button" data-action="retry" type="button">↻<span>Retry</span></button>
          <label class="level-picker"><span>Cube</span><select id="level-select" aria-label="Choose an unlocked cube"></select></label>
          <button class="dock-button" id="settings-button" type="button" aria-expanded="false">☼<span>Settings</span></button>
        </nav>
        <aside class="settings-panel" id="settings-panel" hidden>
          <label><input id="reduced-motion" type="checkbox" /> Reduce movement</label>
          <label>Theme<select id="theme-select"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <button id="install-button" type="button" hidden>Install app</button>
          <p id="install-hint" hidden></p>
        </aside>
        <p class="gesture-help">Drag to orbit · <span class="zoom-help-mouse">Mouse wheel to zoom</span><span class="zoom-help-touch">Pinch to zoom</span> · press an exposed arrow to move it</p>
        <p class="screenreader-status" id="hint-status" aria-live="polite"></p>
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
    this.hintButton = this.requireElement("hint-button") as HTMLButtonElement;
    this.hintStatus = this.requireElement("hint-status");
    this.reducedMotion = this.requireElement(
      "reduced-motion",
    ) as HTMLInputElement;
    this.themeSelect = this.requireElement("theme-select") as HTMLSelectElement;
    this.celebrationLayer = this.requireElement("celebration-layer");
    this.reducedMotion.checked = this.settings.reducedMotion;
    this.themeSelect.value = this.settings.theme;
    this.renderer = new PuzzleRenderer(this.stage);
    this.applyTheme();
    this.input = new PointerInput(this.renderer.canvas, {
      pick: (x, y) => this.renderer.pick(x, y),
      onPress: (id) => {
        this.cancelHint();
        this.renderer.setSelected(id);
      },
      onTap: (id) => this.attempt(id),
      onOrbit: (x, y) => {
        this.cancelHint();
        this.renderer.orbit(x, y);
      },
      onZoom: (amount) => {
        this.cancelHint();
        this.renderer.zoom(amount);
      },
    });
    this.bindControls();
    this.systemMotionPreference.addEventListener(
      "change",
      this.handleMotionPreference,
    );
    this.systemThemePreference.addEventListener(
      "change",
      this.handleThemePreference,
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
    this.systemThemePreference.removeEventListener(
      "change",
      this.handleThemePreference,
    );
    this.clearCelebration();
    this.cancelHint();
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
      hint: this.hint
        ? {
            arrowId: this.hint.arrowId,
            phase: this.hint.phase,
            elapsed: Math.round(this.hint.elapsed),
            lit: this.hint.lit,
          }
        : null,
      theme: {
        preference: this.settings.theme,
        resolved: this.resolvedTheme(),
      },
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
    this.cancelHint();
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
    this.cancelHint();
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
    if (this.hint) {
      this.updateHint(delta);
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
    this.cancelHint();
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
    this.hintButton.disabled = true;
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
    this.cancelHint();
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
    this.cancelHint();
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
    this.hintButton.disabled =
      this.mode !== "campaign" ||
      this.motion !== undefined ||
      this.hint !== undefined ||
      this.state.status !== "playing";
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
      if (action === "reset") this.cancelHint();
      if (action === "hint") this.beginHint();
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
      this.settings = {
        ...this.settings,
        reducedMotion: this.reducedMotion.checked,
      };
      saveSettings(this.settings);
      if (this.shouldReduceMotion()) {
        this.clearCelebration();
        this.snapHintForReducedMotion();
        this.renderUi();
      }
    });
    this.themeSelect.addEventListener("change", () => {
      const theme = this.themeSelect.value;
      if (theme !== "system" && theme !== "light" && theme !== "dark") {
        this.themeSelect.value = this.settings.theme;
        return;
      }
      this.settings = { ...this.settings, theme };
      saveSettings(this.settings);
      this.applyTheme();
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
      this.snapHintForReducedMotion();
      this.renderUi();
    }
  };

  private readonly handleThemePreference = (): void => {
    if (this.settings.theme === "system") {
      this.applyTheme();
    }
  };

  private resolvedTheme(): "light" | "dark" {
    if (this.settings.theme === "system") {
      return this.systemThemePreference.matches ? "dark" : "light";
    }
    return this.settings.theme;
  }

  private applyTheme(): void {
    const theme = this.resolvedTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (themeColor) {
      themeColor.content = theme === "dark" ? "#101820" : "#e9f4f7";
    }
    if (this.appliedTheme !== theme) {
      this.renderer.setTheme(theme);
      this.appliedTheme = theme;
    }
  }

  private shouldReduceMotion(): boolean {
    return this.settings.reducedMotion || this.systemMotionPreference.matches;
  }

  private beginHint(): void {
    if (
      this.mode !== "campaign" ||
      this.motion ||
      this.hint ||
      this.state.status !== "playing"
    ) {
      return;
    }
    const arrowId = this.state.remainingIds.find(
      (id) => simulateMove(this.level, this.state, id).kind === "exit",
    );
    if (!arrowId || !this.renderer.beginHint(arrowId)) {
      return;
    }
    this.hint = {
      arrowId,
      phase: this.shouldReduceMotion() ? "flashing" : "rotating",
      elapsed: 0,
      lit: this.shouldReduceMotion(),
    };
    if (this.shouldReduceMotion()) {
      this.renderer.animateHintFocus(1);
      this.renderer.flashHint(true);
    }
    this.hintStatus.textContent = "Showing a safe arrow.";
    this.renderUi();
  }

  private updateHint(delta: number): void {
    const hint = this.hint;
    if (!hint) return;
    hint.elapsed += delta;
    if (hint.phase === "rotating") {
      const progress = Math.min(1, hint.elapsed / HINT_FOCUS_DURATION);
      this.renderer.animateHintFocus(progress);
      if (progress < 1) return;
      hint.phase = "flashing";
      hint.elapsed = 0;
    }
    const lit = this.shouldReduceMotion()
      ? true
      : Math.floor(hint.elapsed / HINT_FLASH_HALF_PULSE) % 2 === 0;
    if (lit !== hint.lit) {
      hint.lit = lit;
      this.renderer.flashHint(lit);
    }
    if (hint.elapsed >= HINT_FLASH_DURATION) {
      this.cancelHint();
    }
  }

  private snapHintForReducedMotion(): void {
    if (!this.hint) return;
    this.hint.phase = "flashing";
    this.hint.elapsed = 0;
    this.hint.lit = true;
    this.renderer.animateHintFocus(1);
    this.renderer.flashHint(true);
  }

  private cancelHint(): void {
    if (!this.hint) return;
    this.hint = undefined;
    this.renderer.clearHint();
    this.hintStatus.textContent = "";
    this.renderUi();
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
      piece.style.setProperty("--confetti-delay", `${(index % 7) * 19.2}ms`);
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
