import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../../errors/AppError';
import { ReporterCompanyLeadRepository } from '../../../repositories/reporterRepositories/CompanyRepository';
import ClentoAPI from '../../../utils/apiUtil';
import '../../../utils/expressExtensions';

class API extends ClentoAPI {
    public path = '/api/reporter/companies/monitor';
    public authType: 'REPORTER' = 'REPORTER';

    private companyRepository = new ReporterCompanyLeadRepository();

    public POST = async (req: Request, res: Response): Promise<Response> => {
        const reporterUserId = req.reporter?.id;
        if (!reporterUserId) {
            throw new ValidationError('User ID is required');
        }

        const body = req.getBody();
        const companyId = body.getParamAsString('companyId');

        // Verify company exists and belongs to user
        const company = await this.companyRepository.findById(companyId);
        if (!company) {
            throw new NotFoundError('Company not found');
        }

        if (company.user_id !== reporterUserId) {
            throw new ValidationError('Company does not belong to user');
        }

        return res.sendOKResponse({
            success: false,
            message: 'This service has been disabled temporarily.',
        });
    };
}

export default new API();
