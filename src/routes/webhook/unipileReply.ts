import { Request, Response } from 'express';
import { UserRepository } from '../../repositories/reporterRepositories/UserRepository';
import ClentoAPI from '../../utils/apiUtil';
import '../../utils/expressExtensions';
import { LeadRepository } from '../../repositories/LeadRepository';
import { LeadService } from '../../services/LeadService';
import { WorkflowStepsRepository } from '../../repositories/WorkflowStepsRepository';

class API extends ClentoAPI {
    public path = '/api/webhooks/unipileReply';
    public authType: 'NONE' = 'NONE';

    private userRepository = new UserRepository();
    private leadRepository = new LeadRepository();
    private workflowStepsRepository = new WorkflowStepsRepository();

    public POST = async (req: Request, res: Response) => {
        const reqBody = req.getBody();
        const attendeesRaw = reqBody.getParamAsArrayOfNestedBodies('attendees');

        const attendees = attendeesRaw.map(it => ({
            attendee_id: it.getParamAsString('attendee_id'),
            attendee_provider_id: it.getParamAsString('attendee_provider_id'),
            attendee_name: it.getParamAsString('attendee_name'),
            attendee_public_identifier: it.getParamAsString('attendee_public_identifier', false)
        }));

        const linkedInIds = attendees.map(it => it.attendee_provider_id);

        const attendeesInDB = await this.leadRepository.findByLinkedinIds(linkedInIds);

        // GET IF ANY STEPS FOR CHECK THE REPLY ARE GOING ON FOR THE LEADS OR NOT
        const steps = await this.workflowStepsRepository.findByLeadIdsWhereStepTypeIs(attendeesInDB.map(it => it.id), 'check_message_reply');

        if (steps.length > 0) {
            const stepIds = steps.map(it => it.id);
            const updatedAt = new Date().toISOString();
            const stepsUpdated = await this.workflowStepsRepository.updateMany(stepIds, {
                updated_at: updatedAt,
                raw_response: {
                    ...(steps.find(it => it.id === stepIds[0])?.raw_response ?? {}),
                    hasReplied: true
                }
            });
        }

        return res.sendOKResponse({ captured: true });
    };
}

export default new API();
