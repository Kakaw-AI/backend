import { Injectable } from '@nestjs/common';
import { CopilotClient } from '@github/copilot-sdk';

const COPILOT_VALIDATION_TIMEOUT_MS = 20_000;

@Injectable()
export class GithubCopilotSdkService {
  async validateAccessToken(accessToken: string, model: string) {
    const models = await this.withClient(accessToken, async (client) => {
      const availableModels = await client.listModels();
      return availableModels.map((item) => item.id);
    });

    if (!models.includes(model)) {
      throw new Error(
        `GitHub Copilot cannot access model "${model}".`,
      );
    }
  }

  private async withClient<T>(
    accessToken: string,
    callback: (client: CopilotClient) => Promise<T>,
  ) {
    const client = new CopilotClient({
      autoStart: false,
      githubToken: accessToken,
      logLevel: 'error',
      useLoggedInUser: false,
    });

    let started = false;

    try {
      await this.withTimeout(client.start(), COPILOT_VALIDATION_TIMEOUT_MS);
      started = true;
      return await this.withTimeout(
        callback(client),
        COPILOT_VALIDATION_TIMEOUT_MS,
      );
    } finally {
      if (started) {
        const errors = await client.stop().catch(() => []);
        if (errors.length > 0) {
          await client.forceStop().catch(() => undefined);
        }
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('GitHub Copilot SDK request timed out.'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
