import cron from 'node-cron';
import logger from '../../utils/logger';

export interface CronJob {
    name: string;
    schedule: string;
    task: () => Promise<void> | void;
    enabled?: boolean;
}

export class CronService {
    private static instance: CronService;
    private jobs: Map<string, cron.ScheduledTask> = new Map();
    private jobStatus: Map<string, boolean> = new Map();
    private isRunning: boolean = false;

    private constructor() {
    }

    public static getInstance(): CronService {
        if (!CronService.instance) {
            CronService.instance = new CronService();
        }
        return CronService.instance;
    }

    /**
     * Register a cron job
     */
    public registerJob(job: CronJob): void {
        if (this.jobs.has(job.name)) {
            logger.warn(`Cron job "${job.name}" is already registered, skipping`);
            return;
        }

        if (job.enabled === false) {
            logger.info(`Cron job "${job.name}" is disabled, skipping registration`);
            return;
        }

        try {
            const task = cron.schedule(job.schedule, async () => {
                const startTime = Date.now();
                logger.info(`Starting cron job: ${job.name}`);

                try {
                    await job.task();
                    const duration = Date.now() - startTime;
                    logger.info(`Completed cron job: ${job.name}`, {
                        duration: `${duration}ms`,
                    });
                } catch (error) {
                    const duration = Date.now() - startTime;
                    logger.error(`Failed cron job: ${job.name}`, {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        duration: `${duration}ms`,
                    });
                }
            }, {
                scheduled: false, // Don't start immediately
            });

            this.jobs.set(job.name, task);
            this.jobStatus.set(job.name, false);
            logger.info(`Registered cron job: ${job.name}`, { schedule: job.schedule });
        } catch (error) {
            logger.error(`Failed to register cron job: ${job.name}`, {
                error: error instanceof Error ? error.message : String(error),
                schedule: job.schedule,
            });
        }
    }

    /**
     * Register multiple cron jobs
     */
    public registerJobs(jobs: CronJob[]): void {
        jobs.forEach(job => this.registerJob(job));
    }

    /**
     * Start all registered cron jobs
     */
    public start(): void {
        if (this.isRunning) {
            logger.warn('Cron service is already running');
            return;
        }

        this.jobs.forEach((task, name) => {
            task.start();
            this.jobStatus.set(name, true);
            logger.info(`Started cron job: ${name}`);
        });

        this.isRunning = true;
        logger.info(`✅ Cron service started with ${this.jobs.size} job(s)`);
    }

    /**
     * Stop all cron jobs
     */
    public stop(): void {
        if (!this.isRunning) {
            logger.warn('Cron service is not running');
            return;
        }

        this.jobs.forEach((task, name) => {
            task.stop();
            this.jobStatus.set(name, false);
            logger.info(`Stopped cron job: ${name}`);
        });

        this.isRunning = false;
        logger.info('✅ Cron service stopped');
    }

    /**
     * Stop a specific cron job
     */
    public stopJob(name: string): void {
        const task = this.jobs.get(name);
        if (task) {
            task.stop();
            this.jobStatus.set(name, false);
            logger.info(`Stopped cron job: ${name}`);
        } else {
            logger.warn(`Cron job "${name}" not found`);
        }
    }

    /**
     * Start a specific cron job
     */
    public startJob(name: string): void {
        const task = this.jobs.get(name);
        if (task) {
            task.start();
            this.jobStatus.set(name, true);
            logger.info(`Started cron job: ${name}`);
        } else {
            logger.warn(`Cron job "${name}" not found`);
        }
    }

    /**
     * Get status of all cron jobs
     */
    public getStatus(): { name: string; running: boolean }[] {
        return Array.from(this.jobs.keys()).map(name => ({
            name,
            running: this.jobStatus.get(name) || false,
        }));
    }

    /**
     * Check if cron service is running
     */
    public isServiceRunning(): boolean {
        return this.isRunning;
    }
}
