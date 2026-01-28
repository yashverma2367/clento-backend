import { Request, Response } from 'express';
import { CreateReporterCompanyLeadDto } from '../../../dto/reporterDtos/companies.dto';
import { DisplayError, NotFoundError, ValidationError } from '../../../errors/AppError';
import { ReporterCompanyLeadRepository } from '../../../repositories/reporterRepositories/CompanyRepository';
import { ReporterConnectedAccountService } from '../../../services/ReporterConnectedAccountService';
import ClentoAPI, { CheckNever } from '../../../utils/apiUtil';
import '../../../utils/expressExtensions';
import logger from '../../../utils/logger';

enum ECommand {
    UPLOAD = 'UPLOAD',
    DELETE = 'DELETE',
    PAUSE = 'PAUSE',
    RESUME = 'RESUME',
}

class API extends ClentoAPI {
    public path = '/api/reporter/companies';
    public authType: 'REPORTER' = 'REPORTER';

    private companyRepository = new ReporterCompanyLeadRepository();
    private connectedAccountService = new ReporterConnectedAccountService();

    private handlePauseCampaign = async (req: Request, res: Response) => {
        const userId = req.reporter?.id;

        const body = req.getBody();
        const companyId = body.getParamAsString('companyId');

        // Verify company exists and belongs to user
        const company = await this.companyRepository.findById(companyId);
        if (!company) {
            throw new NotFoundError('Company not found');
        }

        if (company.user_id !== userId) {
            throw new ValidationError('Company does not belong to user');
        }

        return res.sendOKResponse({
            success: false,
            message: 'This service has been disabled temporarily.',
            companyId,
        });
    };

    private handleResumeCampaign = async (req: Request, res: Response) => {
        const userId = req.reporter?.id;
        if (!userId) {
            throw new ValidationError('User ID is required');
        }

        const body = req.getBody();
        const companyId = body.getParamAsString('companyId', true);

        const company = await this.companyRepository.findById(companyId);
        if (!company) {
            throw new NotFoundError('Company not found');
        }

        if (company.user_id !== userId) {
            throw new ValidationError('Company does not belong to user');
        }

        return res.sendOKResponse({
            success: false,
            message: 'This service has been disabled temporarily.',
            companyId,
        });
    };

    private handleDeleteCompany = async (req: Request, res: Response) => {
        const userId = req.reporter?.id;
        const reqBody = req.getBody();
        const companyId = reqBody.getParamAsString('companyId');
        const company = await this.companyRepository.findById(companyId);
        if (!company) {
            throw new DisplayError('Not Found');
        }
        if (company.user_id !== userId) {
            throw new DisplayError('Not Found');
        }
        await this.companyRepository.update(companyId, { is_deleted: true, updated_at: new Date().toISOString() });
        return res.sendOKResponse({ success: true, message: 'Company deleted successfully', companyId });
    };

    public GET = async (req: Request, res: Response) => {
        const userId = req.reporter.id;

        const companies = await this.companyRepository.getUserCompanies(userId);

        return res.sendOKResponse({
            success: true,
            message: 'Companies fetched successfully',
            companies: companies.map(company => ({ ...company, status: null })),
        });
    };

    public POST = async (req: Request, res: Response) => {
        const reqBody = req.getBody();
        const userId = req.reporter.id;
        const command = reqBody.getParamAsEnumValue(ECommand, 'command');

        switch (command) {
            case ECommand.UPLOAD:
                const urls = reqBody.getParamAsStringArray('linkedin_urls');
                // eslint-disable-next-line
                const linkedinUrlRegex = `^https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9-_%]+\/?$`;
                const errored = urls.find(it => !it.match(linkedinUrlRegex));
                if (errored) {
                    throw new DisplayError(`Invalid LinkedIn company URL: ${errored}`);
                }
                const MAX_COMPANIES_ALLOWED = 10;

                // Get current companies count for the user
                const existingCompanies = await this.companyRepository.getUserCompanies(userId);
                const currentCompanyCount = existingCompanies.length;
                const companiesToUpload = urls.length;
                const totalAfterUpload = currentCompanyCount + companiesToUpload;

                // Check if upload would exceed the limit
                if (totalAfterUpload > MAX_COMPANIES_ALLOWED) {
                    const allowedToUpload = Math.max(0, MAX_COMPANIES_ALLOWED - currentCompanyCount);
                    throw new DisplayError(`You have reached the maximum limit of ${MAX_COMPANIES_ALLOWED} companies. You currently have ${currentCompanyCount} companies and can only upload ${allowedToUpload} more compan${allowedToUpload !== 1 ? 'ies' : 'y'}.`);
                }

                const companies: CreateReporterCompanyLeadDto[] = urls.map(url => ({
                    user_id: userId,
                    linkedin_url: url,
                }));
                const createdCompanies = await this.companyRepository.bulkCreate(companies);

                return res.sendOKResponse({
                    success: true,
                    message: 'Companies uploaded successfully',
                    data: createdCompanies,
                });
            case ECommand.DELETE:
                return await this.handleDeleteCompany(req, res);
            case ECommand.PAUSE:
                return await this.handlePauseCampaign(req, res);
            case ECommand.RESUME:
                return await this.handleResumeCampaign(req, res);
            default:
                CheckNever(command);
        }

        return res.sendOKResponse({});
    };
}

export default new API();
