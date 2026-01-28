import { CronJob } from '../services/crons/CronService';
import logger from '../utils/logger';
import { CampaignManager } from '../services/crons/CampaignWorkflows';

const campaignManager = new CampaignManager();

/**
 * Cron job that runs every 15 minutes to check and start scheduled campaigns
 * Checks if campaign start_date has passed and starts the campaign if so
 */
async function checkAndStartScheduledCampaigns(): Promise<void> {
    logger.info('Running scheduled campaigns check');
    await campaignManager.checkAndStartScheduledCampaigns();
}

/**
 * Cron job that runs once per day to process daily leads for campaigns in progress
 * Starts daily leads workflow for all campaigns with IN_PROGRESS status
 */
async function startDailyLeadsForCampaigns(): Promise<void> {
    logger.info('Running daily leads start for campaigns');
    await campaignManager.startDailyLeadsForAllCampaigns();
}

async function processDailyLeads(): Promise<void> {
    logger.info('Processing daily leads every 1 hour');
    await campaignManager.processDailyLeads();
}

async function retryFailedSteps(): Promise<void> {
    logger.info('Retrying failed steps');
    await campaignManager.retryFailedStepsForAllCampaigns();
}

export const cronJobs: CronJob[] = [
    {
        name: 'check-scheduled-campaigns',
        // schedule: '0 * * * *', // Every 1 hour, at minute 0
        schedule: '* * * * *', // For Testing run every minute
        task: checkAndStartScheduledCampaigns,
        enabled: true,
    },
    {
        name: 'start-daily-leads',
        schedule: '0 0 * * *', // Every day at midnight
        // schedule: '* * * * *', // For Testing run every minute
        task: startDailyLeadsForCampaigns,
        enabled: true,
    },
    {
        name: 'process-daily-leads',
        //schedule: '*/15 * * * *', // Every 15 minutes
        schedule: '* * * * *', // For Testing run every minute
        task: processDailyLeads,
        enabled: true
    },
    {
        name: 'retry-failed-steps',
        schedule: '0 * * * *', // Every 1 hour, at minute 0
        // schedule: '* * * * *', // For Testing run every minute
        task: retryFailedSteps,
        enabled: true
    }
];
