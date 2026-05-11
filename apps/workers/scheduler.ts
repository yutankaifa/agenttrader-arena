/**
 * Internal Scheduler
 *
 * Runs the existing app cron routes from the market worker so we don't rely on
 * Vercel Cron configuration. This keeps the business logic in the app and uses
 * the worker only as a scheduler/trigger.
 */

type ScheduledTask = {
  name: string;
  path: string;
  intervalMs: number;
};

const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_TASKS: ScheduledTask[] = [
  {
    name: 'market-refresh',
    path: '/api/cron/market-refresh',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'leaderboard-snapshot',
    path: '/api/cron/leaderboard-snapshot',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'account-snapshot',
    path: '/api/cron/account-snapshot',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'prediction-settlement',
    path: '/api/cron/prediction-settlement',
    intervalMs: 5 * 60 * 1000,
  },
];

export class InternalScheduler {
  private appUrl: string;
  private cronSecret: string | null;
  private timers = new Map<string, NodeJS.Timeout>();
  private tasks: ScheduledTask[];
  private enabled: boolean;

  constructor(tasks: ScheduledTask[] = DEFAULT_TASKS) {
    this.appUrl =
      process.env.WORKER_APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      DEFAULT_APP_URL;
    this.cronSecret = process.env.CRON_SECRET || null;
    this.tasks = tasks;
    this.enabled = process.env.WORKER_ENABLE_SCHEDULER === 'true';
  }

  start(): void {
    if (!this.enabled) {
      console.log('[scheduler] Disabled (set WORKER_ENABLE_SCHEDULER=true to enable)');
      return;
    }

    if (!this.cronSecret) {
      console.warn('[scheduler] Disabled because CRON_SECRET is missing');
      return;
    }

    console.log(`[scheduler] Enabled, target app: ${this.appUrl}`);

    for (const task of this.tasks) {
      void this.runTask(task);
      const timer = setInterval(() => void this.runTask(task), task.intervalMs);
      this.timers.set(task.name, timer);
      console.log(
        `[scheduler] ${task.name} every ${Math.round(task.intervalMs / 60000)}m`
      );
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    const url = new URL(task.path, this.appUrl).toString();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.cronSecret}`,
        },
      });

      const text = await res.text();
      if (!res.ok) {
        console.error(
          `[scheduler] ${task.name} failed: ${res.status} ${res.statusText} ${text}`
        );
        return;
      }

      console.log(`[scheduler] ${task.name} ok: ${text}`);
    } catch (err) {
      console.error(`[scheduler] ${task.name} error:`, err);
    }
  }
}
