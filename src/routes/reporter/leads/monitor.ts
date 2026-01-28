import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../../errors/AppError';
import { ReporterLeadRepository } from '../../../repositories/reporterRepositories/LeadRepository';
import ClentoAPI from '../../../utils/apiUtil';
import '../../../utils/expressExtensions';

class API extends ClentoAPI {
    public path = '/api/reporter/leads/monitor';
    public authType: 'REPORTER' = 'REPORTER';

    private leadRepository = new ReporterLeadRepository();

    public POST = async (req: Request, res: Response): Promise<Response> => {
        const reporterUserId = req.reporter?.id;
        if (!reporterUserId) {
            throw new ValidationError('User ID is required');
        }

        const body = req.getBody();
        const leadId = body.getParamAsString('leadId');

        // Verify lead exists and belongs to user
        const lead = await this.leadRepository.findById(leadId);
        if (!lead) {
            throw new NotFoundError('Lead not found');
        }

        if (lead.user_id !== reporterUserId) {
            throw new ValidationError('Lead does not belong to user');
        }

        return res.sendOKResponse({
            success: false,
            message: 'This service has been disabled temporarily.',
        });
    };
}

export default new API();
