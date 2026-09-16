import "@fontsource-variable/manrope";

import {
  DEMO_BLOCKED_ID,
  DEMO_LEVEL,
  DEMO_SUCCESS_ID,
  LEVEL_ONE,
  WRAP_INTRO_LEVEL,
} from "./content/intro";
import { LevelLoader } from "./content/level-loader";
import { OVERLAP_INTRO_LEVEL } from "./content/overlap-intro";
import { STOP_INTRO_LEVEL } from "./content/stop-intro";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "./content/level-preview";
import {
  GENERATOR_VERSION,
  MAX_LEVEL_ID,
  seedForLevel,
} from "./content/procedural";
import { applyMove, createGameState, simulateMove } from "./core/game-state";
import { resolvePick } from "./pick";
import { overlappingArrowIds } from "./core/overlap";
import { cellKey } from "./core/topology";
import type { GameState, LevelDefinition, MoveResult } from "./core/types";
import { PointerInput } from "./input";
import { PwaInstallPrompt } from "./pwa";
import { arrowMotionDuration, PuzzleRenderer } from "./render/renderer";
import {
  clearCampaign,
  type LoadedCampaign,
  loadCampaign,
  loadSettings,
  type PlayerSettings,
  type StorageResult,
  saveCampaign,
  saveSettings,
} from "./storage";

type AppMode = "demo" | "campaign";

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
const MOUSE_PICK_MARGIN_PX = 6;
const TOUCH_PICK_MARGIN_PX = 18;

export class ParArrowsApp {
  private readonly root: HTMLElement;
  private readonly renderer: PuzzleRenderer;
  private readonly input: PointerInput;
  private readonly stage: HTMLElement;
  private readonly levelLabel: HTMLElement;
  private readonly livesLabel: HTMLElement;
  private readonly arrowsLabel: HTMLElement;
  private readonly message: HTMLElement;
  private readonly levelForm: HTMLFormElement;
  private readonly levelInput: HTMLInputElement;
  private readonly levelSubmit: HTMLButtonElement;
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
  private readonly loadingLayer: HTMLElement;
  private readonly previewBanner: HTMLElement;
  private readonly previewStatus: HTMLElement;
  private readonly previewExit: HTMLAnchorElement;
  private readonly loader = new LevelLoader();
  private readonly preview = resolveLevelPreview(
    parseLevelPreview(window.location.search),
  );
  private readonly systemMotionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly systemThemePreference = window.matchMedia(
    "(prefers-color-scheme: dark)",
  );
  private mode: AppMode = "campaign";
  private level: LevelDefinition = LEVEL_ONE;
  private state: GameState = createGameState(LEVEL_ONE);
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
  private loading = true;
  private loadingError: string | undefined;
  private requestedLevelId = 1;
  private previewResolvedLevelId: number | undefined;
  private loadRequest = 0;
  private disposed = false;
  private retryPurpose: "restore" | "level" | undefined;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <main class="app-shell">
        <aside class="preview-banner" id="preview-banner" hidden>
          <span id="preview-status">Test mode · Campaign progress is unchanged.</span>
          <a id="preview-exit" href="/">Return to campaign</a>
        </aside>
        <p class="wrap-intro" id="wrap-intro" hidden>Yellow edges carry arrows onto the next face. Try an arrow pointing toward the yellow line.</p>
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
          <div class="generation-layer" id="generation-layer" role="status" aria-live="polite" aria-atomic="true" hidden>
            <div class="generation-card"><strong id="generation-status">Preparing cube…</strong><button class="primary-button" data-action="generation-retry" type="button" hidden>Try again</button></div>
          </div>
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
          <form class="level-picker" id="level-form"><label for="level-input">Cube</label><div><input id="level-input" aria-label="Choose an unlocked cube" inputmode="numeric" min="1" step="1" type="number" /><button type="submit">Go</button></div></form>
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
    this.levelForm = this.requireElement("level-form") as HTMLFormElement;
    this.levelInput = this.requireElement("level-input") as HTMLInputElement;
    this.levelSubmit = this.levelForm.querySelector(
      "button",
    ) as HTMLButtonElement;
    if (!this.levelSubmit)
      throw new Error("Missing cube picker submit button.");
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
    this.loadingLayer = this.requireElement("generation-layer");
    this.previewBanner = this.requireElement("preview-banner");
    this.previewStatus = this.requireElement("preview-status");
    this.previewExit = this.requireElement("preview-exit") as HTMLAnchorElement;
    this.reducedMotion.checked = this.settings.reducedMotion;
    this.themeSelect.value = this.settings.theme;
    this.renderer = new PuzzleRenderer(this.stage);
    this.applyTheme();
    this.input = new PointerInput(this.renderer.canvas, {
      pick: (x, y, pointerType) =>
        this.loading ||
        this.loadingError ||
        this.motion ||
        this.mode !== "campaign"
          ? undefined
          : this.resolvePick(x, y, pointerType),
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
    this.renderer.setLevel(this.level, this.state);
    if (this.preview.active) {
      this.mode = "campaign";
      this.tutorialComplete = true;
      this.unlockedLevelId = MAX_LEVEL_ID;
      this.requestedLevelId =
        this.preview.requestedLevelId ?? this.preview.resolvedLevelId ?? 1;
      if (this.preview.error || this.preview.resolvedLevelId === undefined) {
        this.showPreviewError(
          this.preview.error ?? "No matching test cube was found.",
          this.requestedLevelId,
        );
      } else {
        void this.loadLevel(this.preview.resolvedLevelId);
      }
    } else {
      void this.restore();
    }
    this.installPrompt = new PwaInstallPrompt((available, ios) =>
      this.updateInstallPrompt(available, ios),
    );
    this.installDebugApi();
    this.renderUi();
    this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    this.loadRequest += 1;
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
    this.loader.dispose();
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
      selectedArrowId: this.renderer.selectedArrowId(),
      preview: {
        active: this.preview.active,
        ...(this.preview.active
          ? {
              requestedLevelId: this.requestedLevelId,
              ...(this.previewResolvedLevelId === undefined
                ? {}
                : { resolvedLevelId: this.previewResolvedLevelId }),
              ...(this.preview.feature
                ? { feature: this.preview.feature }
                : {}),
              ...(this.preview.wraps === undefined
                ? {}
                : { wraps: this.preview.wraps }),
              ...(this.loadingError ? { error: this.loadingError } : {}),
            }
          : {}),
      },
      wrappingEdges: this.renderer.wrappingEdgeCount(),
      wrappingEdgeOpacities: this.renderer.wrappingEdgeOpacities(),
      stops: (this.level.stops ?? []).map((cell) => cellKey(cell)),
      parkedOffsets: Object.fromEntries(
        Object.entries(this.displayedState.offsets).filter(
          ([, offset]) => offset > 0,
        ),
      ),
      lives: this.displayedState.lives,
      remainingIds: this.displayedState.remainingIds,
      failedIds: this.displayedState.failedIds,
      overlappingGroups: this.level.arrows
        .map((arrow) => overlappingArrowIds(this.level, arrow.id))
        .filter(
          (ids, index) =>
            ids.length > 1 && ids[0] === this.level.arrows[index]?.id,
        ),
      moving: this.motion
        ? {
            arrowId: this.motion.result.arrowId,
            kind: this.motion.result.kind,
            members: (this.motion.result.members ?? [this.motion.result]).map(
              (member) => ({
                arrowId: member.arrowId,
                headFace: this.renderer.arrowHeadFace(member.arrowId),
                headPosition: this.renderer.arrowHeadPosition(member.arrowId),
              }),
            ),
            headFace: this.renderer.arrowHeadFace(this.motion.result.arrowId),
            headPosition: this.renderer.arrowHeadPosition(
              this.motion.result.arrowId,
            ),
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
      loading: this.loading,
      loadingError: this.loadingError,
      generation:
        this.level.id >= 1
          ? {
              version: GENERATOR_VERSION,
              seed: seedForLevel(this.level.id),
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

  async loadLevel(levelId: number): Promise<void> {
    if (
      !Number.isSafeInteger(levelId) ||
      levelId < 1 ||
      levelId > MAX_LEVEL_ID
    ) {
      if (this.preview.active) {
        this.showPreviewError(
          `Level must be a whole number from 1 through ${MAX_LEVEL_ID}.`,
          levelId,
        );
      }
      return;
    }
    let targetLevelId = levelId;
    if (this.preview.active) {
      const selection = resolveLevelPreview(this.preview, levelId);
      if (selection.resolvedLevelId === undefined || selection.error) {
        this.showPreviewError(
          selection.error ?? "No matching test cube was found.",
          levelId,
        );
        return;
      }
      targetLevelId = selection.resolvedLevelId;
    }
    const request = ++this.loadRequest;
    this.requestedLevelId = levelId;
    this.retryPurpose = "level";
    this.settleMotion();
    this.loading = true;
    this.loadingError = undefined;
    this.motion = undefined;
    this.cancelHint();
    this.clearCelebration();
    this.renderUi();
    try {
      const level = await this.loader.load(targetLevelId);
      if (this.disposed || request !== this.loadRequest) return;
      this.mode = "campaign";
      this.level = level;
      this.state = createGameState(level);
      this.displayedState = this.state;
      this.tutorialComplete = true;
      this.unlockedLevelId = Math.max(this.unlockedLevelId, level.id);
      this.renderer.setLevel(level, this.state);
      if (this.preview.active) {
        this.previewResolvedLevelId = level.id;
        this.updatePreviewUrl(level.id);
      }
      this.persist();
    } catch (error) {
      if (this.disposed || request !== this.loadRequest) return;
      this.loadingError =
        error instanceof Error ? error.message : "Could not prepare this cube.";
    } finally {
      if (!this.disposed && request === this.loadRequest) {
        this.loading = false;
        this.renderUi();
      }
    }
  }

  resetProgress(): void {
    if (this.preview.active) {
      void this.loadLevel(this.previewResolvedLevelId ?? this.requestedLevelId);
      return;
    }
    this.loadRequest += 1;
    this.retryPurpose = undefined;
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
    this.loading = false;
    this.loadingError = undefined;
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
    if (!this.loading && this.mode === "demo" && this.demoStage !== "ready") {
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
    if (
      this.loading ||
      this.loadingError ||
      this.motion ||
      (this.mode === "demo" && !scripted)
    ) {
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
          Math.min(MAX_LEVEL_ID, this.level.id + 1),
        );
      }
      this.persist();
    }
    this.motion = {
      result,
      elapsed: 0,
      impactShown: false,
      duration: arrowMotionDuration(
        this.renderer.motionDistance(arrowId, result),
        result.kind,
        this.settings.reducedMotion,
      ),
    };
    this.hintButton.disabled = true;
    this.renderer.setSelected(undefined);
    this.renderer.animate(arrowId, result, 0);
  }

  private finishMotion(arrowId: string): void {
    this.motion = undefined;
    this.renderer.updateState(this.state);
    this.renderer.settle(arrowId);
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
        Math.min(MAX_LEVEL_ID, this.level.id + 1),
      );
      this.persist();
      this.startCelebration();
    }
    this.renderUi();
  }

  private async restore(): Promise<void> {
    if (this.preview.active) return;
    const request = ++this.loadRequest;
    this.retryPurpose = "restore";
    this.loading = true;
    this.loadingError = undefined;
    this.renderUi();
    let saved: StorageResult<LoadedCampaign>;
    try {
      saved = await loadCampaign((levelId) => {
        this.requestedLevelId = levelId;
        return this.loader.load(levelId);
      });
    } catch (error) {
      if (this.disposed || request !== this.loadRequest) return;
      this.loading = false;
      this.loadingError =
        error instanceof Error
          ? error.message
          : "Saved progress could not be loaded.";
      this.renderUi();
      return;
    }
    if (this.disposed || request !== this.loadRequest) return;
    if (saved.contentUpdated) {
      this.message.textContent =
        "Puzzle layouts were updated. This cube restarted, and your unlocked cubes are still available.";
    } else if (saved.recovered) {
      this.message.textContent =
        "Saved progress was unavailable, so this puzzle started fresh.";
    }
    if (saved.value) {
      this.level = saved.value.level;
      this.state = saved.value.state;
      this.displayedState = this.state;
      this.unlockedLevelId = saved.value.unlockedLevelId;
      this.tutorialComplete = saved.value.tutorialComplete;
      this.mode = this.tutorialComplete ? "campaign" : "demo";
      if (this.tutorialComplete) this.persist();
    }
    if (!this.tutorialComplete) {
      this.mode = "demo";
      this.level = DEMO_LEVEL;
      this.state = createGameState(DEMO_LEVEL);
      this.displayedState = this.state;
    }
    this.renderer.setLevel(this.level, this.state);
    this.loading = false;
    this.renderUi();
  }

  private beginCampaign(): void {
    if (this.mode !== "demo" || this.demoStage !== "ready") {
      return;
    }
    this.tutorialComplete = true;
    this.mode = "campaign";
    this.level = LEVEL_ONE;
    this.state = createGameState(this.level);
    this.displayedState = this.state;
    this.cancelHint();
    this.unlockedLevelId = Math.max(this.unlockedLevelId, 1);
    this.renderer.setLevel(this.level, this.state);
    this.persist();
    this.renderUi();
  }

  private retry(): void {
    if (this.mode !== "campaign" || this.loading || this.loadingError) {
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
    if (this.preview.active) {
      if (this.loading) return;
      void this.loadLevel(levelId);
      return;
    }
    if (
      this.mode !== "campaign" ||
      this.loading ||
      this.loadingError !== undefined ||
      !Number.isSafeInteger(levelId) ||
      levelId < 1 ||
      levelId > this.unlockedLevelId
    ) {
      return;
    }
    void this.loadLevel(levelId);
  }

  private persist(): void {
    if (this.preview.active) return;
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

  private showPreviewError(error: string, requestedLevelId: number): void {
    this.loadRequest += 1;
    this.requestedLevelId = requestedLevelId;
    this.previewResolvedLevelId = undefined;
    this.retryPurpose = undefined;
    this.loading = false;
    this.loadingError = error;
    this.settleMotion();
    this.cancelHint();
    this.clearCelebration();
    this.renderUi();
  }

  private updatePreviewUrl(levelId: number): void {
    const url = new URL(window.location.href);
    url.searchParams.set("level", String(levelId));
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  private previewReturnHref(): string {
    const url = new URL(window.location.href);
    url.searchParams.delete("level");
    url.searchParams.delete("feature");
    url.searchParams.delete("wraps");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  private renderUi(): void {
    this.levelLabel.textContent =
      this.mode === "demo" ? "First flight" : this.level.title;
    this.livesLabel.textContent = String(this.displayedState.lives);
    this.arrowsLabel.textContent = `${this.displayedState.remainingIds.length} arrows`;
    this.tutorial.hidden = this.mode !== "demo";
    const mechanicIntro = this.requireElement("wrap-intro");
    mechanicIntro.textContent =
      this.level.id === OVERLAP_INTRO_LEVEL.id
        ? "Overlapping tails move together. Tap any part. If one is blocked, the whole group returns red."
        : this.level.id === STOP_INTRO_LEVEL.id
          ? "An arrow parks on a green circle until you tap it again. Park one to clear a lane, and it rebounds to the circle if the way ahead is blocked."
          : "Yellow edges carry arrows onto the next face. Try an arrow pointing toward the yellow line.";
    mechanicIntro.hidden =
      this.mode !== "campaign" ||
      (this.level.id !== WRAP_INTRO_LEVEL.id &&
        this.level.id !== STOP_INTRO_LEVEL.id &&
        this.level.id !== OVERLAP_INTRO_LEVEL.id) ||
      this.loading ||
      this.loadingError !== undefined ||
      this.preview.error !== undefined ||
      this.state.status !== "playing";
    const pickerDisabled =
      this.mode !== "campaign" ||
      this.loading ||
      this.preview.error !== undefined ||
      (this.loadingError !== undefined && !this.preview.active);
    this.levelInput.disabled = pickerDisabled;
    this.levelSubmit.disabled = pickerDisabled;
    this.hintButton.disabled =
      this.mode !== "campaign" ||
      this.loading ||
      this.loadingError !== undefined ||
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
    this.levelInput.value = String(this.level.id);
    this.levelInput.max = String(
      this.preview.active ? MAX_LEVEL_ID : this.unlockedLevelId,
    );
    this.levelInput.setAttribute(
      "aria-label",
      this.preview.active ? "Choose a test cube" : "Choose an unlocked cube",
    );
    this.previewBanner.hidden = !this.preview.active;
    this.previewStatus.textContent =
      "Test mode · Campaign progress is unchanged.";
    this.previewExit.href = this.previewReturnHref();
    const generationStatus = this.requireElement("generation-status");
    const generationRetry = this.root.querySelector<HTMLButtonElement>(
      '[data-action="generation-retry"]',
    );
    this.loadingLayer.hidden = !this.loading && !this.loadingError;
    generationStatus.textContent = this.loading
      ? "Preparing cube…"
      : (this.loadingError ?? "Could not prepare this cube.");
    if (generationRetry) {
      generationRetry.hidden = this.loading || this.retryPurpose === undefined;
    }
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
      this.loading ||
      this.loadingError !== undefined ||
      this.motion !== undefined ||
      this.state.status === "playing";
    if (won) {
      this.requireElement("state-kicker").textContent = "NICE WORK";
      title.textContent = "Cube cleared!";
      copy.textContent = "Every arrow is free. Your next cube is ready.";
      button.textContent = "Next cube";
      button.dataset.action = "next";
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
        this.selectLevel(Math.min(this.level.id + 1, MAX_LEVEL_ID));
      if (action === "generation-retry") this.retryGeneration();
    });
    this.levelForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.selectLevel(Number(this.levelInput.value));
    });
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

  /**
   * Resolves a press to an arrow, widening the target for finger input. When
   * the zone covers several arrows, one that clears without a collision wins;
   * otherwise the closest arrow does.
   */
  private resolvePick(
    x: number,
    y: number,
    pointerType: string,
  ): string | undefined {
    return resolvePick(
      this.renderer.pickCandidates(
        x,
        y,
        pointerType === "touch" ? TOUCH_PICK_MARGIN_PX : MOUSE_PICK_MARGIN_PX,
      ),
      (arrowId) => this.isSafeMove(arrowId),
    );
  }

  /** True when tapping this arrow costs no life. */
  private isSafeMove(arrowId: string): boolean {
    return ["exit", "paused"].includes(
      simulateMove(this.level, this.state, arrowId).kind,
    );
  }

  private beginHint(): void {
    if (
      this.mode !== "campaign" ||
      this.loading ||
      this.loadingError !== undefined ||
      this.motion ||
      this.hint ||
      this.state.status !== "playing"
    ) {
      return;
    }
    const arrowId = this.state.remainingIds.find((id) => this.isSafeMove(id));
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
        getLevel: () => this.level,
        activate: (id) => this.attempt(id, true),
      };
    }
  }

  private retryGeneration(): void {
    if (this.loading || !this.loadingError) return;
    if (this.retryPurpose === "restore") {
      void this.restore();
      return;
    }
    void this.loadLevel(this.requestedLevelId);
  }

  private settleMotion(): void {
    if (!this.motion) return;
    const arrowId = this.motion.result.arrowId;
    this.motion = undefined;
    this.renderer.updateState(this.state);
    this.renderer.settle(arrowId);
    this.displayedState = this.state;
  }

  private requireElement(id: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`Missing required interface element: ${id}`);
    return element;
  }
}
