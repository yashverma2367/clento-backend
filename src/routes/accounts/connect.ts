import ClentoAPI from '../../utils/apiUtil';
import { ConnectedAccountService } from '../../services/ConnectedAccountService';
import { Request, Response } from 'express';
import { DisplayError, NotFoundError } from '../../errors/AppError';
import logger from '../../utils/logger';
import '../../utils/expressExtensions';

/**
 * Account Connect API - Create hosted authentication link for connecting accounts
 */
class AccountConnectAPI extends ClentoAPI {
    public path = '/api/accounts/connect';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    private connectedAccountService = new ConnectedAccountService();

    /**
     * Create hosted authentication link for connecting accounts
     */
    public POST = async (req: Request, res: Response): Promise<Response> => {
        logger.info('=== Backend Controller: createHostedAuthLink START ===');

        // Mock user and organization for development
        const userId = req.userId;
        const organizationId = req.organizationId;
        console.log("ORGANIZATION ID", req.organizationId);

        const subscription = req.subscription.hasPlans;
        const allowedSeats = req?.subscription?.totalSeats ?? 0;

        if(!subscription){
            throw new DisplayError('You need to have a plan to connect accounts');
        }

        const linkedinAccounts = await this.connectedAccountService.getUserAccounts(organizationId, 'linkedin');
        if(linkedinAccounts.length >= allowedSeats){
            throw new DisplayError('You have reached the maximum number of allowed linkedin accounts, Please upgrade your plan to connect more accounts');
        }

        // Using express extensions for parameter validation
        const body = req.getBody();
        const provider = body.getParamAsString('provider', true);
        const successRedirectUrl = body.getParamAsString('success_redirect_url', false);
        const failureRedirectUrl = body.getParamAsString('failure_redirect_url', false);
        const notifyUrl = body.getParamAsString('notify_url', false);

        logger.info('Creating hosted auth link', {
            userId,
            organizationId,
            provider: provider || '',
            successRedirectUrl: successRedirectUrl,
            failureRedirectUrl: failureRedirectUrl,
            notifyUrl: notifyUrl,
        });

        try {
            const result = await this.connectedAccountService.createHostedAuthLink({
                userId,
                organizationId,
                provider: provider || '',
                successRedirectUrl: successRedirectUrl || undefined,
                failureRedirectUrl: failureRedirectUrl || undefined,
                notifyUrl: notifyUrl || undefined,
            });

            logger.info('=== Backend Controller: createHostedAuthLink END ===', { result });

            // Always return the hosted auth URL - no more import logic
            return res.sendCreatedResponse({
                success: true,
                message: 'Authentication link created successfully',
                data: result,
            });
        } catch (error) {
            logger.error('Error in createHostedAuthLink controller', { error, userId: req.userId });
            throw new DisplayError('An Error Occurred');
        }
    };
}

export default new AccountConnectAPI();
