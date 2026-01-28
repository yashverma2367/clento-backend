import { Request, Response } from 'express';
import { CampaignStatus, CreateCampaignDto, UpdateCampaignDto } from '../../dto/campaigns.dto';
import { DisplayError } from '../../errors/AppError';
import { CampaignService } from '../../services/CampaignService';
import { StorageService } from '../../services/StorageService';
import { CampaignManager } from '../../services/crons/CampaignWorkflows';
import { DelayUnit, EAction, EApproach, ECallToAction, EFocus, EFormality, EIntention, ELanguage, EMessageLength, EPathType, EPersonalization, ETone, EWorkflowNodeType, WorkflowJson } from '../../types/workflow.types';
import ClentoAPI from '../../utils/apiUtil';
import '../../utils/expressExtensions'; // Import extensions

/**
 * Create Campaign API - Create new campaign endpoint
 */
class CreateCampaignAPI extends ClentoAPI {
    public path = '/api/campaigns/create';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    private campaignService = new CampaignService();
    private storageService = new StorageService();
    private campaignManager = new CampaignManager();
    private bucketName = 'campaign-flow';
    /**
     * Create new campaign
     */
    public POST = async (req: Request, res: Response): Promise<Response> => {
        try {
            const organizationId = req.organizationId;
            const reqBody = req.getBody();

            const detail = reqBody.getParamAsNestedBody('detail');

            //   detail
            const name = detail.getParamAsString('name');
            const description = detail.getParamAsString('description');
            const senderAccount = detail.getParamAsString('senderAccount');
            const prospectList = detail.getParamAsString('prospectList');
            const startDate = detail.getParamAsString('startDate', false); // Optional - if not provided, start immediately
            const leadsPerDay = detail.getParamAsNumber('leadsPerDay');
            const startTime = detail.getParamAsString('startTime', false); // Optional
            const endTime = detail.getParamAsString('endTime', false); // Optional
            const timezone = detail.getParamAsString('timezone', false); // Optional

            //Flow
            const flow = reqBody.getParamAsNestedBody('flow');
            const nodesRaw = flow.getParamAsArrayOfNestedBodies('nodes');
            const edgesRaw = flow.getParamAsArrayOfNestedBodies('edges');

            // Nodes
            const nodes = nodesRaw.map(it => {
                //Positions
                const position = it.getParamAsNestedBody('position');
                const positionX = position.getParamAsString('x');
                const positionY = position.getParamAsString('y');

                //measured
                const measured = it.getParamAsNestedBody('measured');
                const measuredWidth = measured.getParamAsNumber('width');
                const measuredHeight = measured.getParamAsNumber('height');

                //data
                const data = it.getParamAsNestedBody('data');
                const type = data.getParamAsEnumValue(EWorkflowNodeType, 'type', false);
                const label = data.getParamAsString('label', false);
                const isConfigured = data.getParamAsBoolean('isConfigured', false);
                const pathType = data.getParamAsType<EPathType>('string', 'pathType', false);
                //Config
                const config = data.getParamAsNestedBody('config', false);
                let useAI, numberOfPosts, recentPostDays, configureWithAI, commentLength, tone, language, customGuidelines, customComment, customMessage, formality, approach, focus, intention, callToAction, personalization, engageWithRecentActivity, smartFollowups, aiWritingAssistant, messageLength, messagePurpose, webhookId;
                if (config) {
                    useAI = config.getParamAsBoolean('useAI', false);
                    numberOfPosts = config.getParamAsNumber('numberOfPosts', false);
                    recentPostDays = config.getParamAsNumber('recentPostDays', false);
                    configureWithAI = config.getParamAsBoolean('configureWithAI', false);
                    commentLength = config.getParamAsEnumValue(EMessageLength, 'commentLength', false);
                    tone = config.getParamAsEnumValue(ETone, 'tone', false);
                    language = config.getParamAsEnumValue(ELanguage, 'language', false);
                    customGuidelines = config.getParamAsString('customGuidelines', false);
                    customComment = config.getParamAsString('customComment', false);
                    customMessage = config.getParamAsString('customMessage', false);
                    formality = config.getParamAsEnumValue(EFormality, 'formality', false);
                    approach = config.getParamAsEnumValue(EApproach, 'approach', false);
                    focus = config.getParamAsEnumValue(EFocus, 'focus', false);
                    intention = config.getParamAsEnumValue(EIntention, 'intention', false);
                    callToAction = config.getParamAsEnumValue(ECallToAction, 'callToAction', false);
                    personalization = config.getParamAsEnumValue(EPersonalization, 'personalization', false);
                    engageWithRecentActivity = config.getParamAsBoolean('engageWithRecentActivity', false);
                    smartFollowups = config.getParamAsBoolean('smartFollowups', false);
                    aiWritingAssistant = config.getParamAsBoolean('aiWritingAssistant', false);
                    messageLength = config.getParamAsEnumValue(EMessageLength, 'messageLength', false);
                    messagePurpose = config.getParamAsString('messagePurpose', false);
                    webhookId = config.getParamAsString('webhookId', false);
                }

                return {
                    id: it.getParamAsString('id'),
                    type: it.getParamAsEnumValue(EAction, 'type'),
                    position: {
                        x: positionX,
                        y: positionY,
                    },
                    data: {
                        type,
                        label,
                        isConfigured,
                        pathType,
                        config: {
                            useAI,
                            numberOfPosts,
                            recentPostDays,
                            configureWithAI,
                            commentLength,
                            tone,
                            language,
                            customGuidelines,
                            customComment,
                            customMessage,
                            formality,
                            approach,
                            focus,
                            intention,
                            callToAction,
                            personalization,
                            engageWithRecentActivity,
                            smartFollowups,
                            aiWritingAssistant,
                            messageLength,
                            messagePurpose,
                            webhookId
                        },
                    },
                    measured: {
                        height: measuredHeight,
                        width: measuredWidth,
                    },
                    selected: it.getParamAsBoolean('selected'),
                    deletable: it.getParamAsBoolean('deletable', false),
                };
            });

            const edges = edgesRaw.map(it => {
                const data = it.getParamAsNestedBody('data');
                const delay = data.getParamAsString('delay', false);
                const isPositive = data.getParamAsBoolean('isPositive', false);
                const isConditionalPath = data.getParamAsBoolean('isConditionalPath', false);
                // Delay Data
                const delayData = data.getParamAsNestedBody('delayData', false);
                let delayDataDelay, delayDataUnit;
                if (delayData) {
                    delayDataDelay = delayData.getParamAsString('delay', false);
                    delayDataUnit = delayData.getParamAsType<DelayUnit>('string', 'unit', false);
                }
                return {
                    id: it.getParamAsString('id'),
                    source: it.getParamAsString('source'),
                    target: it.getParamAsString('target'),
                    type: it.getParamAsString('type'),
                    animated: it.getParamAsBoolean('animated'),
                    selected: it.getParamAsBoolean('selected', false),
                    data: {
                        delay,
                        isPositive,
                        isConditionalPath,
                        delayData: {
                            delay: delayDataDelay,
                            unit: delayDataUnit,
                        },
                    },
                };
            });

            // Determine campaign status based on start_date
            let shouldStartImmediately = !startDate;
            let campaignStatus = CampaignStatus.SCHEDULED;

            if (startDate) {
                // Parse start date and compare with today
                const startDateObj = new Date(startDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0); // Reset time to compare dates only
                startDateObj.setHours(0, 0, 0, 0);

                // If start date is today or in the past, start immediately
                if (startDateObj <= today) {
                    shouldStartImmediately = true;
                    campaignStatus = CampaignStatus.IN_PROGRESS;
                } else {
                    // Start date is in the future
                    shouldStartImmediately = false;
                    campaignStatus = CampaignStatus.SCHEDULED;
                }
            } else {
                // No start date provided, start immediately
                shouldStartImmediately = true;
                campaignStatus = CampaignStatus.IN_PROGRESS;
            }

            const campaignCreateDto: CreateCampaignDto = {
                organization_id: organizationId,
                name,
                description,
                sender_account: senderAccount,
                prospect_list: prospectList,
                leads_per_day: leadsPerDay,
                status: campaignStatus,
                requests_sent_this_day: 0,
                requests_sent_this_week: 0,
                ...(startDate && { start_date: startDate }),
                ...(startTime && { start_time: startTime }),
                ...(endTime && { end_time: endTime }),
                ...(timezone && { timezone: timezone }),
            };

            const campaign = await this.campaignService.createCampaign(campaignCreateDto);
            const worflowJson: WorkflowJson = {
                nodes,
                edges,
            };
            if (campaign) {
                await this.storageService.uploadJson(worflowJson, organizationId, `${campaign.id}.json`, this.bucketName);
            } else {
                throw new DisplayError('Error while creating the campaign');
            }

            const campaignUpdateDto: UpdateCampaignDto = {
                file_name: `${campaign.id}.json`,
                bucket: this.bucketName,
                requests_sent_this_day: 0,
                requests_sent_this_week: 0,
            };

            await this.campaignService.updateCampaign(campaign.id, campaignUpdateDto);

            // Start the campaign immediately if no start_date or start_date has passed
            if (shouldStartImmediately) {
                try {
                    await this.campaignManager.startCampaign(campaign.id);
                } catch (error: any) {
                    // Campaign may already be running or other validation; don't fail creation
                    console.error('Failed to start campaign immediately', error);
                }
            }

            return res.sendOKResponse({
                message: shouldStartImmediately ? 'Campaign created and started successfully' : 'Campaign created successfully',
                data: {
                    campaignId: campaign.id,
                    status: campaign.status,
                    started: shouldStartImmediately,
                },
            });
        } catch (error) {
            throw error;
        }
    };
}

export default new CreateCampaignAPI();
