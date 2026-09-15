interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export class PwaInstallPrompt {
  private deferred: InstallPromptEvent | undefined;

  constructor(
    private readonly update: (available: boolean, ios: boolean) => void,
  ) {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferred = event as InstallPromptEvent;
      this.update(true, this.isIos());
    });
    this.update(false, this.isIos());
  }

  async prompt(): Promise<void> {
    if (!this.deferred) {
      return;
    }
    await this.deferred.prompt();
    await this.deferred.userChoice;
    this.deferred = undefined;
    this.update(false, this.isIos());
  }

  private isIos(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }
}
