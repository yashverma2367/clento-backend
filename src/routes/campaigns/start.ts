import { Request, Response } from 'express';
import { TemporalService } from '../../services/TemporalService';
import ClentoAPI from '../../utils/apiUtil';
import '../../utils/expressExtensions';
import { CampaignService } from '../../services/CampaignService';
import { DisplayError } from '../../errors/AppError';

class StartCampaignAPI extends ClentoAPI {
    public path = '/api/campaigns/start';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    private temporalService = TemporalService.getInstance();
    private campaignService = new CampaignService();

    public POST = async (req: Request, res: Response): Promise<Response> => {
        const body = req.getBody();
        const campaignId = body.getParamAsUUID('campaignId', true);
        const campaign = await this.campaignService.getCampaignById(campaignId);
        if(campaign?.organization_id !== req.organizationId) {
            throw new DisplayError('You are not allowed to access this campaign');
        }

        await this.temporalService.startCampaign(campaignId);

        return res.sendOKResponse({ message: 'Campaign Started' });
    };
}

export default new StartCampaignAPI();
