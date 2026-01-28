import { Request, Response } from 'express';
import { DisplayError, NotFoundError, ValidationError } from '../../../errors/AppError';
import { ReporterLeadService } from '../../../services/ReporterLeadService';
import { ReporterLeadRepository } from '../../../repositories/reporterRepositories/LeadRepository';
import ClentoAPI, { CheckNever } from '../../../utils/apiUtil';
import '../../../utils/expressExtensions';
import { CreateReporterLeadDto } from '../../../dto/reporterDtos/leads.dto';
import logger from '../../../utils/logger';

enum ECommand {
    UPLOAD = 'UPLOAD',
    DELETE = 'DELETE',
    PAUSE = 'PAUSE',
    RESUME = 'RESUME',
}

class API extends ClentoAPI {
    public path = '/api/reporter/leads';
    public authType: 'REPORTER' = 'REPORTER';

    private leadService = new ReporterLeadService();
    private leadRepository = new ReporterLeadRepository();

    private handlePauseCampaign = async (req: Request, res: Response) => {
        const userId = req.reporter?.id;

        const body = req.getBody();
        const leadId = body.getParamAsString('leadId');

        // Verify lead exists and belongs to user
        const lead = await this.leadRepository.findById(leadId);
        if (!lead) {
            throw new NotFoundError('Lead not found');
        }

        if (lead.user_id !== userId) {
            throw new ValidationError('Lead does not belong to user');
        }

        return res.sendOKResponse({
            success: false,
            message: 'This service has been disabled temporarily.',
            leadId,
        });
    };

    private handleResumeCampaign = async (req: Request, res: Response) => {
        const userId = req.reporter?.id;
        if (!userId) {
            throw new ValidationError('User ID is required');
        }

        const body = req.getBody();
        const leadId = body.getParamAsString('leadId', true);

        const lead = await this.leadRepository.findById(leadId);
        if (!lead) {
            throw new NotFoundError('Lead not found');
        }

        if (lead.user_id !== userId) {
            throw new ValidationError('Lead does not belong to user');
        }

        return res.sendOKResponse({
            success: false,
            message: 'This service has been disabled temporarily.',
            leadId,
        });
    };

    private handleDeleteLead = async (req: Request, res: Response) => {
        const userId = req.reporter?.id;
        const reqBody = req.getBody();
        const leadId = reqBody.getParamAsString('leadId');
        const lead = await this.leadRepository.findById(leadId);
        if (!lead) {
            throw new DisplayError('Not Found');
        }
        if (lead.user_id !== userId) {
            throw new DisplayError('Not Found');
        }
        await this.leadRepository.update(leadId, { is_deleted: true, updated_at: new Date().toISOString() });
        return res.sendOKResponse({ success: true, message: 'Lead deleted successfully', leadId });
    };

    public GET = async (req: Request, res: Response) => {
        const userId = req.reporter.id;

        const leads = await this.leadRepository.getUserLeads(userId);

        return res.sendOKResponse({
            success: true,
            message: 'Leads fetched successfully',
            leads: leads.map(lead => ({ ...lead, status: null })),
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
                const linkedinUrlRegex = `^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-_%]+\/?$`;
                const errored = urls.find(it => !it.match(linkedinUrlRegex));
                if (errored) {
                    throw new DisplayError(`Invalid LinkedIn URL: ${errored}`);
                }
                const MAX_LEADS_ALLOWED = 10;

                // Get current non-deleted leads count for the user
                const existingLeads = await this.leadRepository.getUserLeads(userId);
                const currentLeadCount = existingLeads.length;
                const leadsToUpload = urls.length;
                const totalAfterUpload = currentLeadCount + leadsToUpload;

                // Check if upload would exceed the limit
                if (totalAfterUpload > MAX_LEADS_ALLOWED) {
                    const allowedToUpload = Math.max(0, MAX_LEADS_ALLOWED - currentLeadCount);
                    throw new DisplayError(`You have reached the maximum limit of ${MAX_LEADS_ALLOWED} leads. You currently have ${currentLeadCount} leads and can only upload ${allowedToUpload} more lead${allowedToUpload !== 1 ? 's' : ''}.`);
                }

                const leads: CreateReporterLeadDto[] = urls.map(url => ({
                    user_id: userId,
                    linkedin_url: url,
                    full_name: null,
                    profile_image_url: null,
                    headline: null,
                    location: null,
                    last_job_title: null,
                    last_company_name: null,
                    last_company_id: null,
                }));
                const createdLeads = await this.leadRepository.bulkCreate(leads);

                return res.sendOKResponse({
                    success: true,
                    message: 'Leads uploaded successfully',
                    data: createdLeads,
                });
            case ECommand.DELETE:
                return await this.handleDeleteLead(req, res);
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
