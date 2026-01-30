import { ConnectedAccountResponseDto } from '../../dto/accounts.dto';
import { CampaignResponseDto, CampaignStatus } from '../../dto/campaigns.dto';
import { LeadInsertDto, LeadListResponseDto, LeadResponseDto } from '../../dto/leads.dto';
import { CreateWorkflowStepDto, EWorkflowStepStatus, EWorkflowType, UpdateWorkflowStepDto, WorkflowStepResponseDto } from '../../dto/workflowSteps.dto';
import { DisplayError } from '../../errors/AppError';
import { LeadRepository } from '../../repositories/LeadRepository';
import { WorkflowStepsRepository } from '../../repositories/WorkflowStepsRepository';
import { EAction, EWorkflowNodeType, WorkflowEdge, WorkflowJson, WorkflowNode } from '../../types/workflow.types';
import { CheckNever } from '../../utils/apiUtil';
import { extractLinkedInPublicIdentifier } from '../../utils/general';
import logger from '../../utils/logger';
import Slack from '../../utils/slack';
import { CampaignService } from '../CampaignService';
import { ConnectedAccountService } from '../ConnectedAccountService';
import { CsvLead, CsvParseResult } from '../CsvService';
import { LeadListService } from '../LeadListService';
import { LeadService } from '../LeadService';
import { UnipileService } from '../UnipileService';
import { checkConnectionRequestLimits } from '../connectionRequestLimits';

interface NextWorkflowStep {
    targetNode: WorkflowNode;
    edge: WorkflowEdge;
    delayMs: number;
    isConditional: boolean;
    conditionalType?: 'accepted' | 'not_accepted';
}

export enum EProviderError {
    InvalidAccount = 'errors/invalid_account',
    InvalidRecipient = 'errors/invalid_recipient',
    NoConnectionWithRecipient = 'errors/no_connection_with_recipient',
    BlockedRecipient = 'errors/blocked_recipient',
    UserUnreachable = 'errors/user_unreachable',
    UnprocessableEntity = 'errors/unprocessable_entity',
    PaymentError = 'errors/payment_error',
    ActionAlreadyPerformed = 'errors/action_already_performed',
    InvalidMessage = 'errors/invalid_message',
    InvalidPost = 'errors/invalid_post',
    NotAllowedInmail = 'errors/not_allowed_inmail',
    InsufficientCredits = 'errors/insufficient_credits',
    CannotResendYet = 'errors/cannot_resend_yet',
    CannotResendWithin24hrs = 'errors/cannot_resend_within_24hrs',
    LimitExceeded = 'errors/limit_exceeded',
    AlreadyInvitedRecently = 'errors/already_invited_recently',
    AlreadyConnected = 'errors/already_connected',
    CannotInviteAttendee = 'errors/cannot_invite_attendee',
    ParentMailNotFound = 'errors/parent_mail_not_found',
    InvalidReplySubject = 'errors/invalid_reply_subject',
    InvalidHeaders = 'errors/invalid_headers',
    SendAsDenied = 'errors/send_as_denied',
    InvalidFolder = 'errors/invalid_folder',
    InvalidThread = 'errors/invalid_thread',
    LimitTooHigh = 'errors/limit_too_high',
    Unauthorized = 'errors/unauthorized',
    SenderRejected = 'errors/sender_rejected',
    RecipientRejected = 'errors/recipient_rejected',
    IpRejectedByServer = 'errors/ip_rejected_by_server',
    ProviderUnreachable = 'errors/provider_unreachable',
    AccountConfigurationError = 'errors/account_configuration_error',
    CantSendMessage = 'errors/cant_send_message',
    RealtimeClientNotInitialized = 'errors/realtime_client_not_initialized',
    CommentsDisabled = 'errors/comments_disabled',
    InsufficientJobSlot = 'errors/insufficient_job_slot',
}

export class CampaignManager {
    private campaignService = new CampaignService();
    private unipileService = new UnipileService();
    private connectedAccountService = new ConnectedAccountService();
    private leadListService = new LeadListService();
    private leadService = new LeadService();
    private leadRepository = new LeadRepository();
    private workflowStepsRepository = new WorkflowStepsRepository();


    public async getLeadListData(leadListId: string, organizationId: string): Promise<{ csvData: CsvParseResult; leadList: LeadListResponseDto }> {
        logger.info('Getting lead list data', { leadListId, organizationId });
        const leadListService = new LeadListService();
        const leadList = await leadListService.getLeadListDataById(leadListId, organizationId);
        logger.info('Lead list retrieved', { leadListId, leadsCount: leadList?.csvData?.data?.length || 0 });
        return leadList;
    }

    public async verifyUnipileAccount(sender_account: string) {
        const account = await this.connectedAccountService.getAccountById(sender_account);

        if (!account) {
            logger.error('Account not found', { sender_account });
            return null;
        }
        const unipileAccount = await this.unipileService.getOwnProfile(account.provider_account_id);
        if (!unipileAccount) {
            logger.error('Unipile Account not found', { sender_account });
            return null;
        }
        return account.provider_account_id;
    }

    public async startCampaign(campaignId: string) {
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new DisplayError('Campaign not found');
        }
        if (!campaign.organization_id) {
            throw new DisplayError('Organization not found');
        }
        if (!campaign.sender_account) {
            throw new DisplayError('Sender account not found');
        }
        if (!campaign.prospect_list) {
            throw new DisplayError('Prospect list not found');
        }

        if (campaign.status === CampaignStatus.IN_PROGRESS) {
            logger.warn('Campaign is already in progress', { campaignId });
            throw new DisplayError('Campaign is already running');
        }

        if (campaign.status === CampaignStatus.PAUSED) {
            logger.info('Starting paused campaign', { campaignId });
        }

        if (campaign.is_deleted) {
            throw new DisplayError('Cannot start a deleted campaign');
        }

        if (campaign.status === CampaignStatus.COMPLETED) {
            throw new DisplayError('Cannot start a completed campaign');
        }

        if (campaign.status === CampaignStatus.FAILED) {
            logger.info('Restarting failed campaign', { campaignId });
        }

        const leadList = await this.getLeadListData(campaign.prospect_list, campaign.organization_id!);
        const leads = leadList?.csvData?.data || [];

        if (leads.length === 0) {
            logger.warn('No leads found in prospect list', { campaignId });
            return;
        }

        await this.entryLeadsIntoDb(leads, campaign.organization_id!, campaignId);
        const dbLeads = await this.leadService.getAllByCampaignId(campaignId);
        const totalLeadsToProcess = dbLeads.length;

        const now = new Date().toISOString();
        await this.campaignService.updateCampaign(campaignId, { status: CampaignStatus.IN_PROGRESS });

        logger.info('Campaign started successfully', {
            campaignId,
            status: CampaignStatus.IN_PROGRESS,
            totalLeadsToProcess,
            startedAt: now,
        });
    }

    private async entryLeadsIntoDb(leads: CsvLead[], organization_id: string, campaign_id: string) {
        const leadService = new LeadService();
        logger.info('Entering leads into database');
        await leads.chunked(5).forEachAsyncOneByOne(async chunk => {
            await chunk.forEachAsyncParallel(async lead => {
                const leadDto: LeadInsertDto = {
                    first_name: lead.first_name,
                    last_name: lead.last_name,
                    full_name: lead.first_name + ' ' + lead.last_name,
                    organization_id: organization_id,
                    campaign_id: campaign_id,
                    source: 'CSV',
                    linkedin_url: lead.linkedin_url,
                    company: lead.company,
                    title: lead.title,
                    phone: lead.phone,
                };
                await leadService.createLead(leadDto);
            });
        });
    }

    public async pauseCampaign(campaignId: string): Promise<void> {
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new DisplayError('Campaign not found');
        }
        if (campaign.status !== CampaignStatus.IN_PROGRESS && campaign.status !== CampaignStatus.PAUSED) {
            throw new DisplayError(`Cannot pause campaign with status ${campaign.status}`);
        }
        await this.campaignService.updateCampaign(campaignId, { status: CampaignStatus.PAUSED });
        logger.info('Campaign paused', { campaignId });
    }

    public async resumeCampaign(campaignId: string): Promise<void> {
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new DisplayError('Campaign not found');
        }
        if (campaign.status !== CampaignStatus.PAUSED) {
            throw new DisplayError(`Cannot resume campaign with status ${campaign.status}`);
        }
        await this.campaignService.updateCampaign(campaignId, { status: CampaignStatus.IN_PROGRESS });
        logger.info('Campaign resumed', { campaignId });
    }

    public async getCampaignStatus(campaignId: string): Promise<{
        status: string;
        isRunning: boolean;
        isPaused: boolean;
    }> {
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new DisplayError('Campaign not found');
        }
        const status = campaign.status;
        return {
            status,
            isRunning: status === CampaignStatus.IN_PROGRESS,
            isPaused: status === CampaignStatus.PAUSED,
        };
    }

    public async startDailyLeads(campaignId: string, options?: { runFailed?: boolean }) {
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }
        if (!campaign.organization_id) {
            throw new Error('Organization not found');
        }

        const allLeads = await this.leadService.getAllByCampaignId(campaignId);
        if (allLeads.length === 0) {
            logger.info('No leads left for campaign, marking as completed', { campaignId });
            await this.campaignService.updateCampaign(campaignId, { status: CampaignStatus.COMPLETED });
            return;
        }

        const leadIds = allLeads.map(lead => lead.id);

        if (options?.runFailed) {
            const failedSteps = await this.workflowStepsRepository.findFailedStepsByLeadIds(leadIds);
            if (failedSteps.length === 0) {
                logger.info('No failed steps to retry', { campaignId });
                return;
            }
            logger.info('Retrying failed steps', { campaignId, count: failedSteps.length });
            const nowSeconds = Math.floor(Date.now() / 1000);
            for (const step of failedSteps) {
                await this.workflowStepsRepository.update(step.id, {
                    status: EWorkflowStepStatus.PENDING,
                    execute_after: nowSeconds,
                    updated_at: new Date().toISOString(),
                });
                try {
                    await this.processSingleLead(step);
                } catch (error) {
                    const message = this.normalizeErrorMessage(error);
                    logger.error('Failed step retry failed', { stepId: step.id, error: message });
                    await this.markStepFailed(step.id, message).catch(err =>
                        logger.error('Failed to mark step as failed', { stepId: step.id, err })
                    );
                }
            }
            logger.info('Failed steps retry completed', { campaignId, count: failedSteps.length });
            return;
        }

        const existingSteps = await this.workflowStepsRepository.findByLeadIdInAndWorkflowType(leadIds, EWorkflowType.CAMPAIGN_WORKFLOW);
        const leadsWithSteps = new Set(existingSteps.map(step => step.lead_id));

        const unstartedLeads = allLeads.filter(lead => !leadsWithSteps.has(lead.id));

        if (unstartedLeads.length === 0) {
            logger.info('All leads have been started', { campaignId, totalLeads: allLeads.length });
            await this.campaignService.updateCampaign(campaignId, { status: CampaignStatus.COMPLETED });
            return;
        }
        const shuffledLeads = unstartedLeads.shuffle();

        const leadsPerDay = campaign.leads_per_day || 10;
        const leadsToStart = shuffledLeads.slice(0, Math.min(leadsPerDay, shuffledLeads.length));

        logger.info('Found leads to start', {
            campaignId,
            totalLeads: allLeads.length,
            unstartedLeads: unstartedLeads.length,
            leadsToStart: leadsToStart.length,
            leadsPerDay,
        });

        const { workflowData } = await this.campaignService.getWorkflow(campaign);
        const workflow: WorkflowJson = workflowData;

        const firstNode = this.getFirstWorkflowNode(workflow);
        if (!firstNode) {
            logger.error('No first node found in workflow', { campaignId });
            throw new Error('Invalid workflow: no starting node found');
        }

        const now = new Date().toISOString();
        const stepIndex = 0;
        const workflowStepsToStart: CreateWorkflowStepDto[] = [];

        leadsToStart.forEach(lead => {
            workflowStepsToStart.push({
                organization_id: campaign.organization_id!,
                lead_id: lead.id,
                id_in_workflow: firstNode.id,
                step_index: stepIndex,
                workflow_type: EWorkflowType.CAMPAIGN_WORKFLOW,
                step_type: firstNode.data.type as EWorkflowNodeType,
                status: EWorkflowStepStatus.PENDING,
                retries: 0,
                execute_after: Math.floor(Date.now() / 1000),
                updated_at: now,
                created_at: now,
            });
        });

        await this.workflowStepsRepository.bulkCreate(workflowStepsToStart);

        logger.info('Daily leads processing completed', {
            campaignId,
            leadsStarted: leadsToStart.length,
        });
    }

    private calculateDelayFromEdge(edge: WorkflowEdge): number {
        if (!edge.data?.delayData?.delay || !edge.data?.delayData?.unit) {
            return 0;
        }

        const delay = parseInt(edge.data.delayData.delay, 10);
        if (isNaN(delay)) {
            return 0;
        }

        const unit = edge.data.delayData.unit;

        switch (unit) {
            case 's':
                return delay * 1000;
            case 'm':
                return delay * 60 * 1000;
            case 'h':
                return delay * 60 * 60 * 1000;
            case 'd':
                return delay * 24 * 60 * 60 * 1000;
            case 'w':
                return delay * 7 * 24 * 60 * 60 * 1000;
            default:
                logger.warn('Unknown delay unit', { unit, delay });
                return 0;
        }
    }

    private getFirstWorkflowNode(workflow: WorkflowJson): WorkflowNode | null {
        const nodes = workflow.nodes.filter(it => it.type !== EAction.addStep);
        if (nodes.length === 0) {
            return null;
        }

        const validNodeIds = new Set(nodes.map(n => n.id));

        const edges = workflow.edges.filter(edge => validNodeIds.has(edge.source) && validNodeIds.has(edge.target));

        const incomingCount: Record<string, number> = {};
        nodes.forEach(n => (incomingCount[n.id] = 0));

        edges.forEach(edge => {
            incomingCount[edge.target] = (incomingCount[edge.target] || 0) + 1;
        });

        const startingNodes = nodes.filter(n => incomingCount[n.id] === 0);

        if (startingNodes.length === 0) {
            return nodes[0];
        }

        return startingNodes[0];
    }

    public async checkAndStartScheduledCampaigns(): Promise<void> {
        logger.info('Checking for scheduled campaigns to start');

        try {
            const scheduledCampaigns = await this.campaignService.getCampaignsByStatusAndStartDate();
            console.log('scheduledCampaigns', scheduledCampaigns);
            if (scheduledCampaigns.length === 0) {
                logger.info('No scheduled campaigns found to start');
                return;
            }
            const now = new Date();
            let startedCount = 0;

            await scheduledCampaigns.forEachAsyncOneByOne(async campaign => {
                try {
                    if (!campaign.start_date) {
                        return;
                    }
                    const startDate = new Date(campaign.start_date);
                    if (startDate <= now) {
                        logger.info('Starting scheduled campaign', {
                            campaignId: campaign.id,
                            startDate: campaign.start_date,
                            currentStatus: campaign.status,
                        });

                        await this.startCampaign(campaign.id);
                        startedCount++;
                    }
                } catch (error) {
                    logger.error('Failed to start scheduled campaign', {
                        campaignId: campaign.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });

            logger.info('Completed checking scheduled campaigns', {
                totalChecked: scheduledCampaigns.length,
                started: startedCount,
            });
        } catch (error) {
            logger.error('Error checking scheduled campaigns', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    public async startDailyLeadsForAllCampaigns(): Promise<void> {
        logger.info('Processing daily leads for all campaigns in progress');
        try {
            const inProgressCampaigns = await this.campaignService.getCampaignsByStatus(CampaignStatus.IN_PROGRESS);

            if (inProgressCampaigns.length === 0) {
                logger.info('No campaigns in progress found');
                return;
            }

            logger.info('Found campaigns in progress', {
                count: inProgressCampaigns.length,
            });

            let processedCount = 0;
            let errorCount = 0;

            await inProgressCampaigns.forEachAsyncOneByOne(async campaign => {
                try {
                    logger.info('Processing daily leads for campaign', {
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                    });

                    await this.startDailyLeads(campaign.id);
                    processedCount++;
                } catch (error) {
                    errorCount++;
                    Slack.SendMessage(`Failed to process daily leads for campaign ${campaign.name} with error: ${error instanceof Error ? error.message : String(error)}`)
                }
            });

            logger.info('Completed processing daily leads for all campaigns', {
                totalCampaigns: inProgressCampaigns.length,
                processed: processedCount,
                errors: errorCount,
            });
        } catch (error) {
            logger.error('Error processing daily leads for campaigns', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    public async retryFailedStepsForAllCampaigns() {
        const campaigns = await this.campaignService.getCampaignsByStatus(CampaignStatus.IN_PROGRESS);
        if (campaigns.length === 0) {
            logger.info('No campaigns in progress found');
            return;
        }
        logger.info('Found campaigns in progress', {
            count: campaigns.length,
        });
        let processedCount = 0;
        let errorCount = 0;
        await campaigns.forEachAsyncOneByOne(async campaign => {
            try {
                logger.info('Retrying failed steps for campaign', {
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                });
                await this.startDailyLeads(campaign.id, { runFailed: true });
                processedCount++;
            } catch (error) {
                errorCount++;
                logger.error('Failed to retry failed steps for campaign', {
                    campaignId: campaign.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });
        logger.info('Completed retrying failed steps for all campaigns', {
            totalCampaigns: campaigns.length,
            processed: processedCount,
            errors: errorCount,
        });
    }

    private findNodeById(workflow: WorkflowJson, nodeId: string): WorkflowNode | null {
        return workflow.nodes.find(node => node.id === nodeId) || null;
    }

    private getNextWorkflowSteps(workflow: WorkflowJson, currentNode: WorkflowNode): NextWorkflowStep[] {
        const outgoingEdges = workflow.edges.filter(edge => edge.source === currentNode.id);

        if (outgoingEdges.length === 0) {
            logger.info('No outgoing edges from current node (end of workflow)', {
                nodeId: currentNode.id,
                nodeType: currentNode.data.type,
            });
            return [];
        }

        const nextSteps: NextWorkflowStep[] = [];

        outgoingEdges.forEach(edge => {
            const targetNode = workflow.nodes.find(node => node.id === edge.target);
            if (!targetNode || targetNode.type === EAction.addStep) {
                return;
            }

            const delayMs = this.calculateDelayFromEdge(edge);
            const isConditional = edge.data?.isConditionalPath === true;

            let conditionalType: 'accepted' | 'not_accepted' | undefined;
            if (isConditional) {
                conditionalType = edge.data?.isPositive === true ? 'accepted' : 'not_accepted';
            }

            nextSteps.push({
                targetNode,
                edge,
                delayMs,
                isConditional,
                conditionalType,
            });
        });
        return nextSteps.filter(step => step.targetNode.type !== EAction.addStep);
    }

    public async executeStepAndAddNextStep(lead: LeadResponseDto, step: WorkflowStepResponseDto, sender: ConnectedAccountResponseDto, workflowData: WorkflowJson, campaign: CampaignResponseDto) {
        const identifier = extractLinkedInPublicIdentifier(lead.linkedin_url!);
        if (!identifier) {
            await this.markStepFailed(step.id, 'Invalid LinkedIn URL');
            return;
        }

        const currentNode = this.findNodeById(workflowData, step.id_in_workflow);
        if (!currentNode) {
            await this.markStepFailed(step.id, 'Node not found in workflow');
            return;
        }

        const config = currentNode?.data?.config || {};
        const now = new Date().toISOString();

        try {
            let executionResult = {};
            let shouldPoll = false;
            let pollType: 'connection_status' | 'message_reply' | null = null;

            switch (step.step_type) {
                case EWorkflowNodeType.profile_visit: {
                    const result = await this.unipileService.visitLinkedInProfile({
                        accountId: sender.provider_account_id,
                        identifier,
                        notify: false,
                        leadId: lead.id
                    });
                    if (result.provider === 'LINKEDIN') {
                        executionResult = { provider_id: (result).provider_id };
                    } else {
                        executionResult = { error: 'Unsupported provider' };
                        break;
                    }
                    break;
                }

                case EWorkflowNodeType.send_connection_request: {
                    const metadata = sender.metadata as Record<string, unknown> | undefined;
                    const blockedUntil = metadata?.connection_request_blocked_until as string | undefined;
                    if (blockedUntil && new Date(blockedUntil) > new Date()) {
                        const executeAfterSeconds = Math.floor(new Date(blockedUntil).getTime() / 1000);
                        await this.workflowStepsRepository.update(step.id, {
                            execute_after: executeAfterSeconds,
                            updated_at: new Date().toISOString(),
                        });
                        return;
                    }

                    const { result: limitsResult, updateData: limitsUpdateData } = checkConnectionRequestLimits(campaign);
                    if (Object.keys(limitsUpdateData).length > 0) {
                        await this.campaignService.updateCampaign(campaign.id, limitsUpdateData).catch(() => { });
                    }
                    if (!limitsResult.canProceed && limitsResult.waitUntilMs != null) {
                        const executeAfterSeconds = Math.floor((Date.now() + limitsResult.waitUntilMs) / 1000);
                        await this.workflowStepsRepository.update(step.id, {
                            execute_after: executeAfterSeconds,
                            updated_at: new Date().toISOString(),
                        });
                        return;
                    }

                    const profile = await this.unipileService.visitLinkedInProfile({
                        accountId: sender.provider_account_id,
                        identifier,
                        notify: false,
                        leadId: lead.id
                    });
                    let providerId: string;
                    if (profile.provider === "LINKEDIN") {
                        providerId = profile?.provider_id;
                    } else {
                        executionResult = { error: 'Unsupported provider' };
                        break;
                    }
                    await this.unipileService.sendLinkedInInvitation({
                        accountId: sender.provider_account_id,
                        providerId,
                        config,
                    });

                    await this.campaignService.updateCampaign(campaign.id, {
                        ...limitsUpdateData,
                        requests_sent_this_day: limitsResult.requestsSentThisDay + 1,
                        requests_sent_this_week: limitsResult.requestsSentThisWeek + 1,
                    }).catch(err => logger.error('Failed to increment campaign request counters', { campaignId: campaign.id, err }));

                    executionResult = {
                        providerId,
                        pollingStartedAt: now,
                    };
                    shouldPoll = true;
                    pollType = 'connection_status';
                    break;
                }

                case EWorkflowNodeType.like_post: {
                    const profile = await this.unipileService.visitLinkedInProfile({
                        accountId: sender.provider_account_id,
                        identifier,
                        notify: false,
                        leadId: lead.id
                    });
                    let providerId: string;
                    if (profile.provider === "LINKEDIN") {
                        providerId = profile?.provider_id;
                    } else {
                        executionResult = { error: 'Unsupported provider' };
                        break;
                    }
                    await this.unipileService.likeLinkedInPost({
                        accountId: sender.provider_account_id,
                        linkedInUrn: profile?.provider_id,
                        lastDays: (config)?.recentPostDays || 7,
                        reactionType: 'like',
                    });
                    break;
                }

                case EWorkflowNodeType.comment_post: {
                    const profile = await this.unipileService.visitLinkedInProfile({
                        accountId: sender.provider_account_id,
                        identifier,
                        notify: false,
                        leadId: lead.id
                    });
                    let providerId: string;
                    if (profile.provider === "LINKEDIN") {
                        providerId = profile?.provider_id;
                    } else {
                        executionResult = { error: 'Unsupported provider' };
                        break;
                    }
                    await this.unipileService.commentLinkedInPost({
                        accountId: sender.provider_account_id,
                        linkedInUrn: providerId,
                        config,
                    });
                    break;
                }

                case EWorkflowNodeType.send_followup: {
                    const profile = await this.unipileService.visitLinkedInProfile({
                        accountId: sender.provider_account_id,
                        identifier,
                        notify: false,
                        leadId: lead.id
                    });
                    let providerId: string;
                    if (profile.provider === "LINKEDIN") {
                        providerId = profile?.provider_id;
                    } else {
                        executionResult = { error: 'Unsupported provider' };
                        break;
                    }
                    await this.unipileService.sendMessage({
                        accountId: sender.provider_account_id,
                        attendeesIds: [providerId],
                        text: config?.customMessage || '',
                    });

                    executionResult = {
                        providerId,
                        pollingStartedAt: now,
                    };
                    shouldPoll = true;
                    pollType = 'message_reply';
                    break;
                }

                case EWorkflowNodeType.withdraw_request: {
                    const profile = await this.unipileService.visitLinkedInProfile({
                        accountId: sender.provider_account_id,
                        identifier,
                        notify: false,
                        leadId: lead.id
                    });
                    let providerId: string;
                    if (profile.provider === "LINKEDIN") {
                        providerId = profile?.provider_id;
                    } else {
                        executionResult = { error: 'Unsupported provider' };
                        break;
                    }
                    await this.unipileService.withdrawLinkedInInvitationRequest({
                        accountId: sender.provider_account_id,
                        providerId,
                    });
                    break;
                }

                case EWorkflowNodeType.webhook: {
                    // TODO: Implement webhook call
                    console.log('webhook called');
                    break;
                }

                case EWorkflowNodeType.send_inmail: {
                    // TODO: Implement InMail
                    break;
                }

                case 'check_connection_status': {
                    const providerId = step.raw_response?.providerId;
                    const nextStepsInfo = step.raw_response?.nextSteps || [];
                    const pollingStartedAt = step.raw_response?.pollingStartedAt || step.created_at;

                    const isConnected = await this.unipileService.isConnected({
                        accountId: sender.provider_account_id,
                        identifier,
                    });

                    const acceptedPath = nextStepsInfo.find((s: NextWorkflowStep) => s.conditionalType === 'accepted');
                    const timeoutMs = acceptedPath?.delayMs || 0;
                    const pollingStartTime = new Date(pollingStartedAt).getTime();
                    const hasTimedOut = Date.now() - pollingStartTime > timeoutMs;

                    executionResult = {
                        isConnected,
                        providerId,
                        nextStepsInfo,
                        pollingStartedAt,
                        shouldContinuePolling: !isConnected && !hasTimedOut,
                        hasTimedOut,
                    };
                    break;
                }

                case 'check_message_reply': {
                    const providerId = step.raw_response?.providerId;
                    const nextStepsInfo = step.raw_response?.nextSteps || [];
                    const pollingStartedAt = step.raw_response?.pollingStartedAt || step.created_at;

                    // Reply is set by the message webhook when the lead replies; checker only reads persisted state.
                    const hasReplied = step.raw_response?.hasReplied === true;

                    const acceptedPath = nextStepsInfo.find((s: any) => s.conditionalType === 'accepted');
                    const timeoutMs = acceptedPath?.delayMs || 0;
                    const pollingStartTime = new Date(pollingStartedAt).getTime();
                    const hasTimedOut = Date.now() - pollingStartTime > timeoutMs;

                    executionResult = {
                        hasReplied,
                        providerId,
                        nextStepsInfo,
                        pollingStartedAt,
                        shouldContinuePolling: !hasReplied && !hasTimedOut,
                        hasTimedOut,
                    };
                    break;
                }

                default:
                    CheckNever(step.step_type);
            }

            await this.workflowStepsRepository.update(step.id, {
                status: EWorkflowStepStatus.COMPLETE,
                raw_response: executionResult,
                updated_at: now,
            });

            await this.createNextSteps(step, lead, workflowData, currentNode, executionResult, shouldPoll, pollType);

        } catch (error) {
            const message = this.normalizeErrorMessage(error);
            const isCannotResendYet =
                (error as { body?: { type?: string } })?.body?.type === EProviderError.CannotResendYet ||
                (error as { body?: { type?: string } })?.body?.type === 'errors/cannot_resend_yet';
            if (isCannotResendYet && step.step_type === EWorkflowNodeType.send_connection_request) {
                Slack.SendMessage(`Cannot Resend Yet: ${step.step_type}, Step Id: ${step.id}`)
                await this.handleConnectionRequestRateLimited(sender.id);
            }
            await this.markStepFailed(step.id, message);
            Slack.SendMessage(`Failed Step: ${step.step_type}, Step Id: ${step.id}, Error: ${message}`)
        }
    }

    private normalizeErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message) return error.message;
        if (typeof error === 'object' && error !== null) {
            const o = error as Record<string, unknown>;
            const body = (o.error as Record<string, unknown>)?.body ?? o.body;
            const b = body as Record<string, unknown> | undefined;
            if (b) {
                const detail = b.detail;
                if (typeof detail === 'string') return detail;
                const title = b.title;
                if (typeof title === 'string') return title;
            }
            const msg = (o.error as Record<string, unknown>)?.message ?? o.message;
            if (typeof msg === 'string') return msg;
        }
        return 'Unknown error';
    }

    private async markStepFailed(stepId: string, errorMessage: string) {
        logger.error('Step execution failed', { stepId, errorMessage });
        let retriesIncrement = 0;
        try {
            const step = await this.workflowStepsRepository.findById(stepId);
            retriesIncrement = (step.retries ?? 0) + 1;
        } catch {
            // ignore if step not found
        }
        const now = new Date().toISOString();
        const updatePayload: UpdateWorkflowStepDto = {
            last_try_at: now,
            status: EWorkflowStepStatus.FAILED,
            raw_response: { error: errorMessage },
            updated_at: now,
        };
        if (retriesIncrement > 0) {
            updatePayload.retries = retriesIncrement;
        }
        await this.workflowStepsRepository.update(stepId, updatePayload);
    }

    private async deferConnectionRequestStepsForSender(senderAccountId: string): Promise<void> {
        const campaigns = await this.campaignService.getCampaignsBySenderAccount(senderAccountId);
        const campaignIds = campaigns.map(c => c.id);
        if (campaignIds.length === 0) return;
        const leadIds = await this.leadRepository.findLeadIdsByCampaignIds(campaignIds);
        if (leadIds.length === 0) return;
        const steps = await this.workflowStepsRepository.findPendingConnectionRequestStepsByLeadIds(leadIds);
        const executeAfterSeconds = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
        const now = new Date().toISOString();
        for (const s of steps) {
            await this.workflowStepsRepository.update(s.id, { execute_after: executeAfterSeconds, updated_at: now });
        }
        if (steps.length > 0) {
            logger.info('Deferred connection request steps for sender (24h)', { senderAccountId, count: steps.length });
        }
    }

    private async handleConnectionRequestRateLimited(senderAccountId: string): Promise<void> {
        const untilIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await this.connectedAccountService.setConnectionRequestBlockedUntil(senderAccountId, untilIso).catch(err =>
            logger.error('Failed to set connection request blocked until', { senderAccountId, err })
        );
        await this.deferConnectionRequestStepsForSender(senderAccountId);
    }
    private async createNextSteps(
        currentStep: WorkflowStepResponseDto,
        lead: LeadResponseDto,
        workflow: WorkflowJson,
        currentNode: WorkflowNode,
        executionResult: any,
        shouldPoll: boolean,
        pollType: 'connection_status' | 'message_reply' | null
    ) {
        const now = new Date().toISOString();
        const stepsToCreate: CreateWorkflowStepDto[] = [];

        // Handle polling steps (check_connection_status, check_message_reply)
        const stepTypeStr = currentStep.step_type as string;
        if (stepTypeStr === 'check_connection_status' || stepTypeStr === 'check_message_reply') {
            const nextStepsInfo = executionResult.nextStepsInfo || [];
            const isSuccess = stepTypeStr === 'check_connection_status'
                ? executionResult.isConnected
                : executionResult.hasReplied;
            const hasTimedOut = executionResult.hasTimedOut;

            if (executionResult.shouldContinuePolling) {
                // Continue polling - create same polling step again
                stepsToCreate.push({
                    organization_id: currentStep.organization_id,
                    lead_id: lead.id,
                    id_in_workflow: currentStep.id_in_workflow,
                    step_index: currentStep.step_index + 1,
                    workflow_type: EWorkflowType.CAMPAIGN_WORKFLOW,
                    step_type: currentStep.step_type,
                    status: EWorkflowStepStatus.PENDING,
                    retries: currentStep.retries + 1,
                    execute_after: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
                    raw_response: {
                        providerId: executionResult.providerId,
                        nextSteps: nextStepsInfo,
                        pollingStartedAt: executionResult.pollingStartedAt,
                    },
                    updated_at: now,
                    created_at: now,
                });
            } else {
                // Polling complete - either success or timeout
                // For check_message_reply: reply = stop workflow (no next step); timeout = continue on not_accepted path.
                const isMessageReplyStep = stepTypeStr === 'check_message_reply';
                const stopOnReply = isMessageReplyStep && isSuccess;
                if (stopOnReply) {
                    // Lead replied: stop workflow for this lead; do not create any next step.
                } else {
                    const pathType = isSuccess ? 'accepted' : 'not_accepted';
                    const selectedPath = nextStepsInfo.find((s: NextWorkflowStep) => s.conditionalType === pathType);

                    if (selectedPath) {
                        const nextNode = workflow.nodes.find(n => n.id === selectedPath.nodeId);
                        if (nextNode) {
                            stepsToCreate.push({
                                organization_id: currentStep.organization_id,
                                lead_id: lead.id,
                                id_in_workflow: selectedPath.nodeId,
                                step_index: currentStep.step_index + 1,
                                workflow_type: EWorkflowType.CAMPAIGN_WORKFLOW,
                                step_type: nextNode.data.type!,
                                status: EWorkflowStepStatus.PENDING,
                                retries: 0,
                                execute_after: Math.floor(Date.now() / 1000),
                                updated_at: now,
                                created_at: now,
                            });
                        }
                    }
                }
                // Timeout is a valid outcome: we take the not_accepted path; step stays COMPLETE (already set in executeStepAndAddNextStep).
            }
        } else {
            // Handle regular steps
            const nextSteps = this.getNextWorkflowSteps(workflow, currentNode);
            if (nextSteps.length === 0) return;

            if (shouldPoll && pollType) {
                // Create polling step
                const pollStepType = pollType === 'connection_status' ? 'check_connection_status' : 'check_message_reply';
                stepsToCreate.push({
                    organization_id: currentStep.organization_id,
                    lead_id: lead.id,
                    id_in_workflow: currentNode.id,
                    step_index: currentStep.step_index + 1,
                    workflow_type: EWorkflowType.CAMPAIGN_WORKFLOW,
                    step_type: pollStepType,
                    status: EWorkflowStepStatus.PENDING,
                    retries: 0,
                    execute_after: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
                    raw_response: {
                        providerId: executionResult.providerId,
                        pollingStartedAt: executionResult.pollingStartedAt,
                        nextSteps: nextSteps.map(s => ({
                            nodeId: s.targetNode.id,
                            edgeId: s.edge.id,
                            conditionalType: s.conditionalType,
                            delayMs: s.delayMs,
                        })),
                    },
                    updated_at: now,
                    created_at: now,
                });
            } else {
                // Create all next steps (non-conditional)
                nextSteps.forEach(nextStep => {
                    stepsToCreate.push({
                        organization_id: currentStep.organization_id,
                        lead_id: lead.id,
                        id_in_workflow: nextStep.targetNode.id,
                        step_index: currentStep.step_index + 1,
                        workflow_type: EWorkflowType.CAMPAIGN_WORKFLOW,
                        step_type: nextStep.targetNode.data.type as EWorkflowNodeType,
                        status: EWorkflowStepStatus.PENDING,
                        retries: 0,
                        execute_after: Math.floor((Date.now() + nextStep.delayMs) / 1000),
                        updated_at: now,
                        created_at: now,
                    });
                });
            }
        }

        if (stepsToCreate.length > 0) {
            await this.workflowStepsRepository.bulkCreate(stepsToCreate);
        }
    }

    public async processSingleLead(step: WorkflowStepResponseDto) {
        const lead = await this.leadRepository.findById(step.lead_id);
        if (!lead) {
            logger.error('Lead not found', { leadId: step.lead_id });
            return;
        }
        const campaign = await this.campaignService.getCampaignById(lead.campaign_id);
        if (!campaign) {
            logger.error('Campaign not found', { campaignId: lead.campaign_id });
            return;
        }
        if (campaign.status === CampaignStatus.PAUSED) {
            return;
        }
        if (!campaign.sender_account) {
            logger.error('Sender account not found', { campaignId: campaign.id });
            return;
        }
        const sender = await this.connectedAccountService.getAccountById(campaign.sender_account);
        const { workflowData } = await this.campaignService.getWorkflow(campaign);
        await this.executeStepAndAddNextStep(lead, step, sender, workflowData, campaign);
    }

    public async processDailyLeads() {
        const stepsToExecute = await this.workflowStepsRepository.getDailyStepsToExecute();
        logger.info('Processing pending workflow steps', { count: stepsToExecute.length });

        for (const step of stepsToExecute) {
            try {
                await this.processSingleLead(step);
            } catch (error) {
                const message = this.normalizeErrorMessage(error);
                logger.error('Step failed, marking failed and continuing', { stepId: step.id, error: message });
                await this.markStepFailed(step.id, message).catch(err =>
                    logger.error('Failed to mark step as failed', { stepId: step.id, err })
                );
            }
        }

        logger.info('Completed processing pending workflow steps');
    }
}
