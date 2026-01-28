import env from '../config/env';

export interface ConnectionRequestLimitsResult {
    canProceed: boolean;
    waitUntilMs?: number;
    requestsSentThisDay: number;
    requestsSentThisWeek: number;
}

export interface CampaignRequestCounts {
    requests_sent_this_day?: number | null;
    requests_sent_this_week?: number | null;
    last_daily_requests_reset?: string | null;
    last_weekly_requests_reset?: string | null;
}

function isNewDay(lastReset: Date, now: Date): boolean {
    return now.toDateString() > lastReset.toDateString();
}

function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function isNewWeek(lastReset: Date, now: Date): boolean {
    const lastWeek = getWeekNumber(lastReset);
    const nowWeek = getWeekNumber(now);
    return now.getFullYear() > lastReset.getFullYear() || (now.getFullYear() === lastReset.getFullYear() && nowWeek > lastWeek);
}

export function getNextDayReset(now: Date): Date {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next;
}

export function getNextWeekReset(now: Date): Date {
    const next = new Date(now);
    const daysUntilMonday = now.getDay() === 0 ? 1 : 8 - now.getDay();
    next.setDate(now.getDate() + daysUntilMonday);
    next.setHours(0, 0, 0, 0);
    return next;
}

/**
 * Check if connection request limits have been exceeded for a campaign.
 * Returns updated counts (after applying daily/weekly resets) and whether we can proceed.
 * Caller should persist reset/counts to campaign if updateData is non-empty.
 */
export function checkConnectionRequestLimits(campaign: CampaignRequestCounts | null): {
    result: ConnectionRequestLimitsResult;
    updateData: {
        requests_sent_this_day?: number;
        last_daily_requests_reset?: string;
        requests_sent_this_week?: number;
        last_weekly_requests_reset?: string;
    };
} {
    const dailyLimit = env.REQUESTS_PER_DAY;
    const weeklyLimit = env.REQUESTS_PER_WEEK;
    const now = new Date();

    let requestsSentThisDay = campaign?.requests_sent_this_day ?? 0;
    let requestsSentThisWeek = campaign?.requests_sent_this_week ?? 0;
    const lastDailyReset = campaign?.last_daily_requests_reset ? new Date(campaign.last_daily_requests_reset) : null;
    const lastWeeklyReset = campaign?.last_weekly_requests_reset ? new Date(campaign.last_weekly_requests_reset) : null;

    const updateData: {
        requests_sent_this_day?: number;
        last_daily_requests_reset?: string;
        requests_sent_this_week?: number;
        last_weekly_requests_reset?: string;
    } = {};

    if (!campaign) {
        return {
            result: { canProceed: false, requestsSentThisDay: 0, requestsSentThisWeek: 0 },
            updateData: {},
        };
    }

    if (!lastDailyReset || isNewDay(lastDailyReset, now)) {
        requestsSentThisDay = 0;
        updateData.requests_sent_this_day = 0;
        updateData.last_daily_requests_reset = now.toISOString();
    }

    if (!lastWeeklyReset || isNewWeek(lastWeeklyReset, now)) {
        requestsSentThisWeek = 0;
        updateData.requests_sent_this_week = 0;
        updateData.last_weekly_requests_reset = now.toISOString();
    }

    const dailyExceeded = requestsSentThisDay >= dailyLimit;
    const weeklyExceeded = requestsSentThisWeek >= weeklyLimit;

    if (dailyExceeded || weeklyExceeded) {
        const nextDailyReset = getNextDayReset(now);
        const nextWeeklyReset = getNextWeekReset(now);
        const waitUntilDaily = nextDailyReset.getTime() - now.getTime();
        const waitUntilWeekly = nextWeeklyReset.getTime() - now.getTime();
        const waitUntilMs = dailyExceeded && weeklyExceeded ? Math.max(waitUntilDaily, waitUntilWeekly) : dailyExceeded ? waitUntilDaily : waitUntilWeekly;
        return {
            result: { canProceed: false, waitUntilMs, requestsSentThisDay, requestsSentThisWeek },
            updateData,
        };
    }

    return {
        result: { canProceed: true, requestsSentThisDay, requestsSentThisWeek },
        updateData,
    };
}
