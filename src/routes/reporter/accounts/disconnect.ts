import { Request, Response } from 'express';
import { ValidationError } from '../../../errors/AppError';
import { ReporterConnectedAccountService } from '../../../services/ReporterConnectedAccountService';
import ClentoAPI from '../../../utils/apiUtil';
import '../../../utils/expressExtensions';

/**
 * Reporter Account Disconnect API - Disconnect a reporter account
 * Lead/company monitoring is disabled; disconnection proceeds without workflow checks.
 */
class ReporterAccountDisconnectAPI extends ClentoAPI {
    public path = '/api/reporter/accounts/disconnect';
    public authType: 'REPORTER' = 'REPORTER';

    private connectedAccountService = new ReporterConnectedAccountService();

    public POST = async (req: Request, res: Response): Promise<Response> => {
        const reporterUserId = req.reporter.id;
        const body = req.getBody();
        const accountId = body.getParamAsUUID('accountId', true);

        if (!accountId) {
            throw new ValidationError('Account ID is required');
        }

        await this.connectedAccountService.disconnectAccount(accountId, reporterUserId);
        return res.sendOKResponse({ success: true, message: 'Account disconnected successfully' });
    };
}

export default new ReporterAccountDisconnectAPI();
