import { ConnectedAccountResponseDto, CreateConnectedAccountDto, UpdateConnectedAccountDto } from '../dto/accounts.dto';
import { DatabaseError } from '../errors/AppError';
import logger from '../utils/logger';
import { BaseRepository } from './BaseRepository';

/**
 * Repository for connected account-related database operations
 */
export class ConnectedAccountRepository extends BaseRepository<ConnectedAccountResponseDto, CreateConnectedAccountDto, UpdateConnectedAccountDto> {
    constructor() {
        super('connected_accounts');
    }

    /**
     * Find connected account by provider account ID
     */
    public async findByProviderAccountId(providerAccountId: string): Promise<ConnectedAccountResponseDto | null> {
        try {
            const data = await this.findOneByField('provider_account_id', providerAccountId);

            return data;
        } catch (error) {
            logger.error('Error finding connected account by provider account ID', {
                error,
                providerAccountId,
            });
            throw new DatabaseError('Failed to find connected account by provider account ID');
        }
    }

    /**
     * Get user's pending/incomplete accounts (for debugging or status tracking)
     */
    public async getPendingAccounts(userId: string, organizationId?: string): Promise<ConnectedAccountResponseDto[]> {
        try {
            logger.info('Getting user pending accounts', { userId, organizationId });

            const data = !organizationId ? await this.findByField('user_id', userId) : await this.findByField('organization_id', organizationId);

            // Filter for pending/incomplete accounts
            const pendingAccounts = (data || []).filter((account: ConnectedAccountResponseDto) => {
                const isPending = account.provider_account_id?.startsWith('pending-') || !account.email || account.email.trim() === '';

                const metadata = account.metadata as any;
                const connectionStatus = metadata?.connection_status;
                const isPendingStatus = connectionStatus === 'pending';

                return isPending || isPendingStatus;
            });

            logger.info('Retrieved pending accounts', {
                userId,
                organizationId,
                pendingCount: pendingAccounts.length,
            });

            return pendingAccounts;
        } catch (error) {
            logger.error('Error getting pending accounts', { error, userId, organizationId });
            throw new DatabaseError('Failed to get pending accounts');
        }
    }

    /**
     * Get user's connected accounts
     */
    public async getUserAccounts(organizationId: string): Promise<ConnectedAccountResponseDto[]> {
        try {
            logger.info('Getting user connected accounts', { organizationId });

            const data = await this.findByField('organization_id', organizationId);

            // Filter out pending/incomplete accounts
            const connectedAccounts = (data || []).filter((account: ConnectedAccountResponseDto) => {
                // Check if account is truly connected
                const isConnected = account.status === 'connected' && account.provider_account_id && !account.provider_account_id.startsWith('pending-');

                logger.info('Filtering out pending/incomplete account', {
                    accountId: account.id,
                    displayName: account.display_name,
                    status: account.status,
                    email: account.email,
                    providerAccountId: account.provider_account_id,
                });
                return isConnected;
            });

            logger.info('Successfully retrieved user accounts', {
                organizationId,
                totalAccounts: data?.length || 0,
                connectedAccounts: connectedAccounts.length,
                filteredOut: (data?.length || 0) - connectedAccounts.length,
            });

            return connectedAccounts as ConnectedAccountResponseDto[];
        } catch (error) {
            logger.error('Error getting user connected accounts', { error, organizationId });

            throw new DatabaseError('Failed to get user connected accounts');
        }
    }

    /**
     * Get organization's connected accounts
     */
    public async getOrganizationAccounts(organizationId: string, page = 1, limit = 20): Promise<ReturnType<typeof this.findPaginatedWithFilters>> {
        try {
            const offset = (page - 1) * limit;

            // Get total count
            const count = (await this.findByField('organization_id', organizationId)).length;

            const data = await this.findPaginatedWithFilters({
                filters: {
                    organization_id: organizationId,
                },
                page,
                limit,
                sortBy: 'created_at',
                sortOrder: 'desc',
            });

            return data;
        } catch (error) {
            logger.error('Error getting organization connected accounts', { error, organizationId });
            throw new DatabaseError('Failed to get organization connected accounts');
        }
    }

    /**
     * Get accounts by provider
     */
    public async getAccountsByProvider(provider: string, organizationId?: string): Promise<ConnectedAccountResponseDto[]> {
        try {
            const data = await this.findByMultipleFields({ provider, status: 'connected', organization_id: organizationId });

            return data;
        } catch (error) {
            logger.error('Error getting accounts by provider', { error, provider, organizationId });
            throw new DatabaseError('Failed to get accounts by provider');
        }
    }

    /**
     * Update account usage statistics
     */
    public async updateUsage(id: string, usage: number): Promise<ConnectedAccountResponseDto> {
        try {
            const now = new Date().toISOString();

            // Get current account to check if we need to reset daily usage
            const account = await this.findById(id);
            const resetTime = account.metadata?.usage_reset_at ? new Date(account.metadata.usage_reset_at) : new Date();
            const shouldReset = resetTime <= new Date();

            const updateData: UpdateConnectedAccountDto = {
                metadata: {
                    daily_usage: shouldReset ? usage : (account.metadata.daily_usage || 0) + usage,
                    usage_reset_at: shouldReset ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : account.metadata.usage_reset_at,
                    last_synced_at: now,
                },
            };

            return await this.update(id, updateData);
        } catch (error) {
            logger.error('Error updating account usage', { error, id, usage });
            throw new DatabaseError('Failed to update account usage');
        }
    }

    /**
     * Update account sync status
     */
    public async updateSyncStatus(id: string, status: 'connected' | 'disconnected' | 'error' | 'expired', error?: string): Promise<ConnectedAccountResponseDto> {
        try {
            const updateData: UpdateConnectedAccountDto = {
                status,
                metadata: {
                    last_synced_at: new Date().toISOString(),
                    last_error: error || undefined,
                    connection_quality: error ? 'error' : 'good',
                },
            };

            return await this.update(id, updateData);
        } catch (error) {
            logger.error('Error updating account sync status', { error, id, status });
            throw new DatabaseError('Failed to update account sync status');
        }
    }

    /**
     * Get accounts that need token refresh
     */
    public async getAccountsNeedingRefresh(): Promise<ConnectedAccountResponseDto[]> {
        try {
            const { data, error } = await this.client
                .from(this.tableName)
                .select('*')
                .eq('status', 'connected')
                .not('token_expires_at', 'is', null)
                .lt('token_expires_at', new Date(Date.now() + 60 * 60 * 1000).toISOString()); // Expires in 1 hour

            if (error) {
                throw error;
            }

            return (data || []) as ConnectedAccountResponseDto[];
        } catch (error) {
            logger.error('Error getting accounts needing refresh', { error });
            throw new DatabaseError('Failed to get accounts needing refresh');
        }
    }

    /**
     * Get accounts by status
     */
    public async getAccountsByStatus(status: string, organizationId?: string): Promise<ConnectedAccountResponseDto[]> {
        try {
            const fields: Record<string, any> = { status };
            if (organizationId) {
                fields.organization_id = organizationId;
            }
            const data = await this.findByMultipleFields(fields);
            return (data || []) as ConnectedAccountResponseDto[];
        } catch (error) {
            logger.error('Error getting accounts by status', { error, status, organizationId });
            throw new DatabaseError('Failed to get accounts by status');
        }
    }
    /**
     * Check if user has account for provider
     */
    public async hasProviderAccount(userId: string, provider: string, organizationId?: string): Promise<boolean> {
        try {
            const fields: Record<string, any> = { user_id: userId, provider, status: 'connected' };
            if (organizationId) {
                fields.organization_id = organizationId;
            }
            const data = await this.findByMultipleFields(fields);
            return !!data;
        } catch (error) {
            logger.error('Error checking provider account', { error, userId, provider, organizationId });
            return false;
        }
    }

    /**
     * Get account usage statistics for organization
     */
    public async getOrganizationUsageStats(organizationId: string): Promise<Record<string, any>> {
        try {
            const data = await this.findByField('organization_id', organizationId);

            const stats = data.reduce((acc: Record<string, any>, account: any) => {
                const provider = account.provider;
                if (!acc[provider]) {
                    acc[provider] = {
                        total_accounts: 0,
                        connected_accounts: 0,
                        total_usage: 0,
                        total_limit: 0,
                    };
                }

                acc[provider].total_accounts++;
                if (account.status === 'connected') {
                    acc[provider].connected_accounts++;
                }
                acc[provider].total_usage += account.daily_usage || 0;
                acc[provider].total_limit += account.daily_limit || 0;

                return acc;
            }, {});

            return stats;
        } catch (error) {
            logger.error('Error getting organization usage stats', { error, organizationId });
            throw new DatabaseError('Failed to get organization usage stats');
        }
    }
}
