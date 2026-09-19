interface Window {
  render_game_to_text?: () => string;
  advanceTime?: (milliseconds: number) => void;
  get_tutorial_state?: () =>
    | {
        active: true;
        levelId: number;
        stepIndex: number;
        copy: string;
        highlightId?: string;
      }
    | { active: false };
  __PAR_ARROWS_TEST__?: {
    loadLevel(levelId: number): Promise<void>;
    resetProgress(): void;
    getState(): string;
    getLevel(): import("./core/types").LevelDefinition;
    activate(arrowId: string): void;
    render(): void;
  };
}

interface WEBGL_lose_context {
  loseContext(): void;
  restoreContext(): void;
}

declare module "*.css";
