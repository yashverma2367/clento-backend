import ClentoAPI from '../../utils/apiUtil';
import { ConnectedAccountService } from '../../services/ConnectedAccountService';
import { Request, Response } from 'express';
import { NotFoundError } from '../../errors/AppError';
import logger from '../../utils/logger';
import '../../utils/expressExtensions';

/**
 * Account Profile Sync API - Account profile sync endpoint
 */
class AccountProfileSyncAPI extends ClentoAPI {
    public path = '/api/accounts/sync-profile';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    private connectedAccountService = new ConnectedAccountService();

    /**
     * Manually sync profile data for an account
     */
    public POST = async (req: Request, res: Response): Promise<Response> => {
        const body = req.getBody();
        const id = body.getParamAsString('id', true);
        const userId = req.userId;

        logger.info('=== Manual profile sync requested ===', { accountId: id, userId });

        const updatedAccount = await this.connectedAccountService.syncAccountProfile(id, userId);

        return res.sendOKResponse({
            message: 'Profile synced successfully',
            data: updatedAccount,
        });
    };
}

export default new AccountProfileSyncAPI();