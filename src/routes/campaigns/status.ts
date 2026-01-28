import { Request, Response } from 'express';
import { CampaignManager } from '../../services/crons/CampaignWorkflows';
import { CampaignService } from '../../services/CampaignService';
import { ForbiddenError, NotFoundError } from '../../errors/AppError';
import ClentoAPI from '../../utils/apiUtil';
import '../../utils/expressExtensions';

class CampaignStatusAPI extends ClentoAPI {
    public path = '/api/campaigns/status';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    private campaignManager = new CampaignManager();
    private campaignService = new CampaignService();

    public GET = async (req: Request, res: Response): Promise<Response> => {
        const query = req.getQuery();
        const campaignId = query.getParamAsUUID('campaignId', true);
        const organizationId = req.organizationId;

        // Verify campaign exists and belongs to organization
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if (!campaign) {
            throw new NotFoundError('Campaign not found');
        }
        if (campaign.organization_id !== organizationId) {
            throw new ForbiddenError('You are not allowed to access this campaign');
        }

        const status = await this.campaignManager.getCampaignStatus(campaignId);

        return res.sendOKResponse({ data: status });
    };
}

export default new CampaignStatusAPI();
