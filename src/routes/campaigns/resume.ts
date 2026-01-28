import { Request, Response } from 'express';
import { CampaignManager } from '../../services/crons/CampaignWorkflows';
import { CampaignService } from '../../services/CampaignService';
import { ForbiddenError, NotFoundError } from '../../errors/AppError';
import ClentoAPI from '../../utils/apiUtil';
import '../../utils/expressExtensions';

class ResumeCampaignAPI extends ClentoAPI {
    public path = '/api/campaigns/resume';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    private campaignManager = new CampaignManager();
    private campaignService = new CampaignService();

    public POST = async (req: Request, res: Response): Promise<Response> => {
        const body = req.getBody();
        const campaignId = body.getParamAsUUID('campaignId', true);
        const organizationId = req.organizationId;

        // Verify campaign exists and belongs to organization
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new NotFoundError('Campaign not found');
        }
        if (campaign.organization_id !== organizationId) {
            throw new ForbiddenError('You are not allowed to access this campaign');
        }

        await this.campaignManager.resumeCampaign(campaignId);

        return res.sendOKResponse({ message: 'Campaign resumed successfully' });
    };
}

export default new ResumeCampaignAPI();
