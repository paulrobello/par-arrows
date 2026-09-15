interface Window {
  render_game_to_text?: () => string;
  advanceTime?: (milliseconds: number) => void;
  __PAR_ARROWS_TEST__?: {
    loadLevel(levelId: number): Promise<void>;
    resetProgress(): void;
    getState(): string;
    getLevel(): import("./core/types").LevelDefinition;
    activate(arrowId: string): void;
  };
}

declare module "*.css";
