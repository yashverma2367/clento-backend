import { Request, Response } from 'express';
import { DisplayError } from '../../errors/AppError';
import { ConnectedAccountService } from '../../services/ConnectedAccountService';
import { UnipileService } from '../../services/UnipileService';
import ClentoAPI from '../../utils/apiUtil';
import '../../utils/expressExtensions';

class DashboardAPI extends ClentoAPI {
    public path = '/api/inbox';
    public authType: 'DASHBOARD' = 'DASHBOARD';

    public unipileService = new UnipileService();
    public connectedAccountService = new ConnectedAccountService();

    public GET = async (req: Request, res: Response): Promise<Response> => {
        const orgId = req.organization?.id;
        const accountId = req.getQuery().getParamAsString('account_id', false);
        const limit = req.getQuery().getParamAsNumber('limit', false) || 10;
        const cursor = req.getQuery().getParamAsString('cursor', false);

        // Validate pagination parameters
        if (limit < 1 || limit > 50) {
            throw new DisplayError('Limit must be between 1 and 50');
        }

        let provider_account_id;

        if (accountId) {
            const account = await this.connectedAccountService.getAccountById(accountId);
            if (account.organization_id !== orgId) {
                throw new DisplayError('Account Not Found'); //Security
            }
            if (!account) {
                throw new DisplayError('Account Not Found');
            }
            provider_account_id = account.provider_account_id;
        }
        const accounts = await this.connectedAccountService.getUserAccounts(orgId, undefined);
        if (!provider_account_id) {
            const accountProviderIds = accounts.map(it => it.provider_account_id);
            if (!accounts || accounts.length === 0) {
                throw new DisplayError('No Accounts Connected');
            }
            provider_account_id = accountProviderIds[0];
        }
        const inbox = await this.unipileService.getInbox(provider_account_id, limit, cursor || undefined);
        const providers = inbox?.items.map(it => it.attendee_provider_id).filter(it => it !== undefined) || [];
        console.log('Providers', providers.length)
        const attendesMap = new Map<string, any>();

        // Fetch profiles for all provider IDs
        await providers.chunked(3).forEachAsyncOneByOne(async chunk => {
            await chunk.forEachAsyncParallel(async it => {
                try {
                    const profile = await this.unipileService.getUserProfile(provider_account_id, it);
                    attendesMap.set(it, profile);
                } catch (error) {
                    console.error(`Failed to get profile for provider ${it}:`, error);
                    attendesMap.set(it, null);
                }
            })
        })
        // for (const providerId of providers) {
        //     try {
        //         const profile = await this.unipileService.getUserProfile(provider_account_id, providerId);
        //         attendesMap.set(providerId, profile);
        //     } catch (error) {
        //         console.error(`Failed to get profile for provider ${providerId}:`, error);
        //         attendesMap.set(providerId, null);
        //     }
        // }

        const inboxWithAccounts = inbox?.items.map(it => {
            const attendee = attendesMap.get(it?.attendee_provider_id || '');
            return {
                id: it.id,
                name: it.name,
                folder: it.folder,
                unread_count: it.unread_count,
                timestamp: it.timestamp,
                account_id: accountId || accounts[0].id,
                attendee_provider_id: it.attendee_provider_id,
                attendee_profile: attendee
                    ? {
                        name: attendee.first_name + ' ' + attendee.last_name || 'Unknown',
                        profile_picture_url: attendee.profile_picture_url,
                    }
                    : null,
            };
        });

        return res.sendOKResponse({
            inbox: inboxWithAccounts,
            pagination: {
                limit,
                cursor: inbox?.cursor || null,
                hasMore: inbox?.cursor !== null,
                nextCursor: inbox?.cursor || null,
            },
            accounts: accounts.map(it => ({
                id: it.id,
                name: it.display_name,
                email: it.email,
                profile_picture_url: it.profile_picture_url,
                status: it.status,
            })),
        });
    };
    public POST = async (req: Request, res: Response) => {
        const orgId = req.organization?.id;
        const reqBody = req.getBody();
        const chatId = reqBody.getParamAsString('chat_id');
        const accountId = reqBody.getParamAsString('account_id');

        const account = await this.connectedAccountService.getAccountById(accountId);

        const chat = await this.unipileService.getChat(account.provider_account_id, chatId);

        return res.sendOKResponse({
            chat,
        });
    };
}

export default new DashboardAPI();
