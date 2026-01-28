import { ConnectedAccountRepository } from '../repositories/ConnectedAccountRepository';
import { UnipileService } from './UnipileService';
import { ConflictError, NotFoundError, ForbiddenError, BadRequestError, DisplayError } from '../errors/AppError';
import logger from '../utils/logger';
import { ConnectedAccountResponseDto, CreateConnectedAccountDto, UpdateConnectedAccountDto } from '../dto/accounts.dto';

/**
 * Service for connected account business logic
 */
export class ConnectedAccountService {
    private connectedAccountRepository: ConnectedAccountRepository;
    private unipileService: UnipileService;

    constructor() {
        this.connectedAccountRepository = new ConnectedAccountRepository();
        this.unipileService = new UnipileService();
    }

    /**
     * Create hosted authentication link for connecting accounts
     */
    async createHostedAuthLink(params: { userId: string; organizationId: string; provider: string; successRedirectUrl?: string; failureRedirectUrl?: string; notifyUrl?: string }): Promise<{ url: string; pendingAccountId: string }> {
        try {
            logger.info('=== ConnectedAccountService: createHostedAuthLink START ===', { params });

            // Validate provider
            logger.info('Validating provider', { provider: params.provider });
            if (!UnipileService.isProviderSupported(params.provider)) {
                throw new BadRequestError(`Provider ${params.provider} is not supported`);
            }

            // Step 1: Check for existing connected accounts (prevent duplicates)
            logger.info('=== STEP 1: Checking for existing accounts ===');

            // Get existing connected accounts for this organization and provider
            const existingConnectedAccounts = await this.connectedAccountRepository.getUserAccounts(params.organizationId);
            const connectedAccountsForProvider = existingConnectedAccounts.filter(acc => acc.provider === params.provider && acc.status === 'connected' && !acc.provider_account_id?.startsWith('pending-'));

            logger.info('Found existing connected accounts', {
                organizationId: params.organizationId,
                provider: params.provider,
                connectedCount: connectedAccountsForProvider.length,
                accounts: connectedAccountsForProvider.map(acc => ({
                    id: acc.id,
                    provider_account_id: acc.provider_account_id,
                    display_name: acc.display_name,
                    status: acc.status,
                })),
            });

            // Clean up old pending accounts for this user/provider (older than 1 hour)
            await this.cleanupOldPendingAccounts(params.userId, params.organizationId, params.provider);

            // Step 2: Create hosted auth link for new account connection
            logger.info('=== STEP 2: Creating hosted auth link ===');

            // Create pending account record with unique pending ID
            logger.info('Creating pending account record');
            const uniquePendingId = `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const accountData: CreateConnectedAccountDto = {
                user_id: params.userId,
                organization_id: params.organizationId,
                status: 'pending',
                provider: params.provider as 'linkedin' | 'email' | 'gmail' | 'outlook',
                display_name: `${params.provider} Account (Connecting...)`,
                provider_account_id: uniquePendingId,
                capabilities: [],
                metadata: {
                    created_at: new Date().toISOString(),
                    connection_status: 'pending',
                    account_type: 'personal', // Store in metadata since column doesn't exist
                    daily_limit: 100,
                    provider_account_id: uniquePendingId,
                },
            };

            logger.info('Account data to create', { accountData });

            const pendingAccount = await this.connectedAccountRepository.create(accountData);
            logger.info('Pending account created', { pendingAccount });

            // Create Unipile hosted auth link
            logger.info('Creating Unipile hosted auth link');
            const unipileParams = {
                type: 'create' as const,
                providers: [params.provider.toUpperCase()],
                expiresOn: new Date(Date.now() + 3600000).toISOString(), // 1 hour
                successRedirectUrl: params.successRedirectUrl,
                failureRedirectUrl: params.failureRedirectUrl,
                notifyUrl: params.notifyUrl,
                name: pendingAccount.id, // Use our account ID for matching
            };

            logger.info('Unipile params', { unipileParams });
            const authLink = await this.unipileService.createHostedAuthLink(unipileParams);
            logger.info('Unipile auth link created', { authLink });

            // Update pending account with auth link
            logger.info('Updating pending account with auth link');
            await this.connectedAccountRepository.update(pendingAccount.id, {
                metadata: {
                    ...pendingAccount.metadata,
                    hosted_auth_url: authLink.url,
                },
            });

            logger.info('=== ConnectedAccountService: createHostedAuthLink SUCCESS ===', {
                userId: params.userId,
                organizationId: params.organizationId,
                provider: params.provider,
                pendingAccountId: pendingAccount.id,
                authUrl: authLink.url,
            });

            return {
                url: authLink.url,
                pendingAccountId: pendingAccount.id,
            };
        } catch (error) {
            logger.error('=== ConnectedAccountService: createHostedAuthLink ERROR ===', {
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              message: error.message,
                              stack: error.stack,
                          }
                        : error,
                params,
            });
            throw error;
        }
    }

    /**
     * Handle successful account connection from Unipile webhook
     */
    async handleAccountConnected(params: { unipileAccountId: string; pendingAccountId: string; accountData: any }): Promise<ConnectedAccountResponseDto> {
        try {
            // Get pending account
            const pendingAccount = await this.connectedAccountRepository.findById(params.pendingAccountId);

            // Get additional profile data from Unipile
            let profileData = null;
            try {
                logger.info('=== ATTEMPTING PROFILE FETCH ===', {
                    unipileAccountId: params.unipileAccountId,
                    attempt: 'immediate',
                });
                profileData = await this.unipileService.getOwnProfile(params.unipileAccountId);
                logger.info('=== PROFILE FETCH SUCCESS ===', {
                    unipileAccountId: params.unipileAccountId,
                    profileData: profileData,
                });
            } catch (error: any) {
                logger.error('=== PROFILE FETCH FAILED ===', {
                    unipileAccountId: params.unipileAccountId,
                    error: error,
                    errorBody: error?.body,
                    errorType: error?.body?.type,
                });

                // Handle specific Unipile errors
                if (error?.body?.type === 'errors/disconnected_account') {
                    logger.warn('Account appears disconnected immediately after connection - will retry profile fetch later', {
                        unipileAccountId: params.unipileAccountId,
                        errorType: error.body.type,
                    });

                    // Schedule multiple retries with increasing delays
                    this.scheduleProfileRetries(params.unipileAccountId, params.pendingAccountId, params.accountData, pendingAccount);
                } else {
                    logger.warn('Could not fetch profile data', { error, unipileAccountId: params.unipileAccountId });
                }
            }

            // Log all available data for debugging
            logger.info('=== ACCOUNT DATA EXTRACTION DEBUG ===', {
                unipileAccountId: params.unipileAccountId,
                pendingAccountId: params.pendingAccountId,
                webhookAccountData: params.accountData,
                profileData: profileData,
                profileDataAvailable: !!profileData,
            });

            // Extract account information
            const displayName = this.extractDisplayName(params.accountData, profileData);
            const email = this.extractEmail(params.accountData, profileData);
            const profilePictureUrl = this.extractProfilePicture(params.accountData, profileData);
            const capabilities = this.extractCapabilities(params.accountData);

            logger.info('=== EXTRACTED ACCOUNT INFO ===', {
                displayName,
                email,
                profilePictureUrl,
                capabilities,
                extractionSource: profileData ? 'profile_data' : 'webhook_data',
            });

            // Update account with connection data
            const connectedAccount = await this.connectedAccountRepository.update(params.pendingAccountId, {
                display_name: displayName,
                email: email,
                profile_picture_url: profilePictureUrl,
                status: 'connected',
                provider_account_id: params.unipileAccountId, // ✅ Update the main provider_account_id field
                capabilities: capabilities,
                metadata: {
                    ...pendingAccount.metadata,
                    last_synced_at: new Date().toISOString(),
                    connection_status: 'connected',
                    connection_quality: 'good',
                    unipile_account_data: params.accountData,
                    profile_data: profileData,
                    connected_at: new Date().toISOString(),
                },
            });

            logger.info('Account successfully connected', {
                accountId: connectedAccount.id,
                provider: connectedAccount.provider,
                unipileAccountId: params.unipileAccountId,
            });

            return connectedAccount;
        } catch (error) {
            logger.error('Error handling account connection', { error, params });
            throw error;
        }
    }

    /**
     * Get user's connected accounts
     */
    async getUserAccounts(organizationId: string, provider?: string): Promise<ConnectedAccountResponseDto[]> {
        try {
            const accounts = await this.connectedAccountRepository.getUserAccounts(organizationId);

            // Filter by provider if specified
            if (provider) {
                return accounts.filter(account => account.provider === provider);
            }

            return accounts;
        } catch (error) {
            logger.error('Error getting user accounts', { error, organizationId, provider });
            throw error;
        }
    }

    async getAccountById(id: string): Promise<ConnectedAccountResponseDto> {
        try {
            const account = await this.connectedAccountRepository.findById(id);
            if (!account) {
                throw new DisplayError('No Account Found By the Id');
            }
            return account;
        } catch (err) {
            logger.error('Error getting accounts by ID in', { err, id });
            throw new DisplayError('No Account Found By the Id');
        }
    }

    async getAccountsByIdIn(ids: string[]): Promise<ConnectedAccountResponseDto[]> {
        try {
            const accounts = await this.connectedAccountRepository.findByIdIn(ids);
            if (!accounts) {
                throw new NotFoundError('Accounts not found');
            }
            return accounts;
        } catch (error) {
            logger.error('Error getting accounts by ID in', { error, ids });
            throw new DisplayError('Failed to get accounts by ID in');
        }
    }

    /**
     * Get user's pending accounts (for debugging or status tracking)
     */
    async getPendingAccounts(userId: string, organizationId?: string, provider?: string): Promise<ConnectedAccountResponseDto[]> {
        try {
            const accounts = await this.connectedAccountRepository.getPendingAccounts(userId, organizationId);

            // Filter by provider if specified
            if (provider) {
                return accounts.filter(account => account.provider === provider);
            }

            return accounts;
        } catch (error) {
            logger.error('Error getting pending accounts', { error, userId, organizationId, provider });
            throw error;
        }
    }

    /**
     * Get organization's connected accounts
     */
    async getOrganizationAccounts(organizationId: string, userId: string, page = 1, limit = 20) {
        try {
            return await this.connectedAccountRepository.getOrganizationAccounts(organizationId, page, limit);
        } catch (error) {
            logger.error('Error getting organization accounts', { error, organizationId, userId });
            throw error;
        }
    }

    /**
     * Get connected account by ID
     */
    async getAccount(id: string, userId: string): Promise<ConnectedAccountResponseDto> {
        try {
            const account = await this.connectedAccountRepository.findById(id);

            // Verify user has access to this account
            if (account.user_id !== userId) {
                throw new ForbiddenError('Access denied to this account');
            }

            return account;
        } catch (error) {
            logger.error('Error getting account', { error, id, userId });
            throw error;
        }
    }

    /**
     * Set connection request blocked until timestamp (for rate-limit cooldown).
     * Used by cron when Unipile returns "Cannot resend yet". No user auth check.
     */
    async setConnectionRequestBlockedUntil(accountId: string, untilIso: string): Promise<void> {
        const account = await this.connectedAccountRepository.findById(accountId);
        const metadata = (account.metadata || {}) as Record<string, unknown>;
        await this.connectedAccountRepository.update(accountId, {
            metadata: { ...metadata, connection_request_blocked_until: untilIso },
        } as UpdateConnectedAccountDto);
    }

    /**
     * Update connected account
     */
    async updateAccount(id: string, data: UpdateConnectedAccountDto, userId: string): Promise<ConnectedAccountResponseDto> {
        try {
            const account = await this.connectedAccountRepository.findById(id);

            // Verify user has access to this account
            if (account.user_id !== userId) {
                throw new ForbiddenError('Access denied to this account');
            }

            const updatedAccount = await this.connectedAccountRepository.update(id, data);

            logger.info('Account updated', { accountId: id, userId, updates: Object.keys(data) });

            return updatedAccount;
        } catch (error) {
            logger.error('Error updating account', { error, id, data, userId });
            throw error;
        }
    }

    /**
     * Disconnect account
     */
    async disconnectAccount(id: string, userId: string): Promise<void> {
        try {
            const account = await this.connectedAccountRepository.findById(id);

            // Verify user has access to this account
            if (account.user_id !== userId) {
                throw new ForbiddenError('Access denied to this account');
            }

            // Delete from Unipile if connected
            if (account.status === 'connected' && account.provider_account_id !== 'pending') {
                try {
                    await this.unipileService.deleteAccount(account.provider_account_id);
                } catch (error) {
                    logger.warn('Failed to delete account from Unipile', { error, accountId: id });
                }
            }

            // Delete from our database
            await this.connectedAccountRepository.delete(id);

            logger.info('Account disconnected', { accountId: id, userId, provider: account.provider });
        } catch (error) {
            logger.error('Error disconnecting account', { error, id, userId });
            throw error;
        }
    }

    /**
     * Sync account with Unipile
     */
    async syncAccount(id: string, userId: string): Promise<ConnectedAccountResponseDto> {
        try {
            const account = await this.connectedAccountRepository.findById(id);

            // Verify user has access to this account
            if (account.user_id !== userId) {
                throw new ForbiddenError('Access denied to this account');
            }

            if (account.status !== 'connected' || account.provider_account_id === 'pending') {
                throw new BadRequestError('Account is not connected');
            }

            // Get latest data from Unipile
            const unipileAccount = await this.unipileService.getAccount(account.provider_account_id);

            // Get profile data
            let profileData = null;
            try {
                profileData = await this.unipileService.getOwnProfile(account.provider_account_id);
            } catch (error) {
                logger.warn('Could not fetch profile data during sync', { error, accountId: id });
            }

            // Update account with latest data
            const displayName = this.extractDisplayName(unipileAccount, profileData);
            const email = this.extractEmail(unipileAccount, profileData);
            const profilePictureUrl = this.extractProfilePicture(unipileAccount, profileData);
            const capabilities = this.extractCapabilities(unipileAccount);

            const updatedAccount = await this.connectedAccountRepository.update(id, {
                display_name: displayName,
                email: email,
                profile_picture_url: profilePictureUrl,
                capabilities: capabilities,
                status: unipileAccount.status === 'active' ? 'connected' : 'error',
                metadata: {
                    ...account.metadata,
                    connection_quality: unipileAccount.status === 'active' ? 'good' : 'error',
                    last_synced_at: new Date().toISOString(),
                    unipile_account_data: unipileAccount,
                    profile_data: profileData,
                    last_sync: new Date().toISOString(),
                },
            });

            logger.info('Account synced', { accountId: id, userId, provider: account.provider });

            return updatedAccount;
        } catch (error: any) {
            logger.error('Error syncing account', { error, id, userId });

            // Update account with error status
            try {
                await this.connectedAccountRepository.updateSyncStatus(id, 'error', error.message);
            } catch (updateError) {
                logger.error('Error updating sync status', { updateError, id });
            }

            throw error;
        }
    }

    /**
     * Get account usage statistics
     */
    async getAccountUsage(id: string, userId: string, dateFrom?: string, dateTo?: string) {
        try {
            const account = await this.connectedAccountRepository.findById(id);

            // Verify user has access to this account
            if (account.user_id !== userId) {
                throw new ForbiddenError('Access denied to this account');
            }

            // TODO: Implement actual usage tracking from activities table
            const usage = {
                daily_usage: account.metadata.daily_usage,
                daily_limit: account.metadata.daily_limit,
                usage_percentage: ((account.metadata.daily_usage || 0) / (account.metadata.daily_limit || 1)) * 100,
                reset_time: account.metadata.usage_reset_at,
                last_activity: account.last_synced_at,
            };

            return usage;
        } catch (error) {
            logger.error('Error getting account usage', { error, id, userId });
            throw error;
        }
    }

    /**
     * Extract display name from account data
     */
    private extractDisplayName(accountData: any, profileData?: any): string {
        logger.info('=== DISPLAY NAME EXTRACTION DEBUG ===', {
            profileData: {
                full_name: profileData?.full_name,
                display_name: profileData?.display_name,
                name: profileData?.name,
                first_name: profileData?.first_name,
                last_name: profileData?.last_name,
            },
            accountData: {
                full_name: accountData?.full_name,
                display_name: accountData?.display_name,
                name: accountData?.name,
                username: accountData?.username,
                email: accountData?.email,
            },
        });

        // Priority order for display name extraction
        const sources = [
            // From profile data (preferred)
            profileData?.full_name,
            profileData?.display_name,
            profileData?.name,
            // Construct from first/last name if available
            profileData?.first_name && profileData?.last_name ? `${profileData.first_name} ${profileData.last_name}` : null,
            profileData?.first_name,
            profileData?.last_name,
            // From account data (fallback, but skip if it looks like a UUID)
            accountData?.full_name,
            accountData?.display_name,
            // Skip accountData.name if it looks like a UUID (our internal ID)
            accountData?.name && !this.isUUID(accountData.name) ? accountData.name : null,
            accountData?.username,
            accountData?.email,
        ];

        for (const source of sources) {
            if (source && typeof source === 'string' && source.trim() && source.trim() !== 'null') {
                const trimmed = source.trim();
                logger.info('=== DISPLAY NAME SELECTED ===', { selectedName: trimmed, source: 'extracted' });
                return trimmed;
            }
        }

        logger.warn('=== NO VALID DISPLAY NAME FOUND ===', { fallbackUsed: true });
        return 'LinkedIn Account';
    }

    /**
     * Check if a string looks like a UUID
     */
    private isUUID(str: string): boolean {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
    }

    /**
     * Schedule multiple profile fetch retries with increasing delays
     */
    private scheduleProfileRetries(unipileAccountId: string, pendingAccountId: string, accountData: any, pendingAccount: any): void {
        const retryDelays = [10000, 30000, 60000]; // 10s, 30s, 60s

        retryDelays.forEach((delay, index) => {
            setTimeout(async () => {
                try {
                    logger.info('=== PROFILE RETRY ATTEMPT ===', {
                        unipileAccountId,
                        attempt: index + 1,
                        delay: delay / 1000 + 's',
                    });

                    const retryProfileData = await this.unipileService.getOwnProfile(unipileAccountId);

                    if (retryProfileData) {
                        logger.info('=== PROFILE RETRY SUCCESS ===', {
                            unipileAccountId,
                            attempt: index + 1,
                            profileData: retryProfileData,
                        });

                        // Update account with profile data
                        await this.connectedAccountRepository.update(pendingAccountId, {
                            display_name: this.extractDisplayName(accountData, retryProfileData),
                            email: this.extractEmail(accountData, retryProfileData),
                            profile_picture_url: this.extractProfilePicture(accountData, retryProfileData),
                            metadata: {
                                ...pendingAccount.metadata,
                                profile_data: retryProfileData,
                                profile_fetched_at: new Date().toISOString(),
                                profile_retry_attempt: index + 1,
                            },
                        });

                        logger.info('=== ACCOUNT UPDATED WITH PROFILE DATA ===', {
                            unipileAccountId,
                            pendingAccountId,
                            attempt: index + 1,
                        });
                    }
                } catch (retryError: any) {
                    logger.warn('=== PROFILE RETRY FAILED ===', {
                        unipileAccountId,
                        attempt: index + 1,
                        retryError: retryError?.body || retryError?.message || retryError,
                    });

                    // If this is the last retry, log final failure
                    if (index === retryDelays.length - 1) {
                        logger.warn('=== ALL PROFILE RETRIES EXHAUSTED ===', {
                            unipileAccountId,
                            totalAttempts: retryDelays.length + 1,
                            message: 'Account will work without profile data',
                        });
                    }
                }
            }, delay);
        });
    }

    /**
     * Manually sync profile data for an account
     */
    async syncAccountProfile(accountId: string, userId: string): Promise<ConnectedAccountResponseDto> {
        try {
            const account = await this.connectedAccountRepository.findById(accountId);

            // Verify user has access to this account
            if (account.user_id !== userId) {
                throw new ForbiddenError('Access denied to this account');
            }

            logger.info('=== MANUAL PROFILE SYNC START ===', {
                accountId,
                userId,
                unipileAccountId: account.provider_account_id,
            });

            // Fetch profile data from Unipile
            let profileData = null;
            try {
                profileData = await this.unipileService.getOwnProfile(account.provider_account_id);
                logger.info('=== MANUAL PROFILE SYNC SUCCESS ===', {
                    accountId,
                    profileData,
                });
            } catch (error: any) {
                logger.error('=== MANUAL PROFILE SYNC FAILED ===', {
                    accountId,
                    error: error?.body || error?.message || error,
                });
                throw new BadRequestError('Failed to fetch profile data from Unipile');
            }

            // Update account with fresh profile data
            const updatedAccount = await this.connectedAccountRepository.update(accountId, {
                display_name: this.extractDisplayName({}, profileData), // Empty accountData since we have profile
                email: this.extractEmail({}, profileData),
                profile_picture_url: this.extractProfilePicture({}, profileData),
                metadata: {
                    ...account.metadata,
                    profile_data: profileData,
                    profile_synced_at: new Date().toISOString(),
                    manual_sync: true,
                },
            });

            logger.info('=== MANUAL PROFILE SYNC COMPLETE ===', {
                accountId,
                newDisplayName: updatedAccount.display_name,
                newEmail: updatedAccount.email,
            });

            return updatedAccount;
        } catch (error) {
            logger.error('Error syncing account profile', { error, accountId, userId });
            throw error;
        }
    }

    /**
     * Extract email from account data
     */
    private extractEmail(accountData: any, profileData?: any): string | undefined {
        return profileData?.email || accountData?.email || undefined;
    }

    /**
     * Extract profile picture URL from account data
     */
    private extractProfilePicture(accountData: any, profileData?: any): string | undefined {
        const sources = [profileData?.profile_picture_url, profileData?.avatar_url, profileData?.picture, profileData?.image_url, accountData?.profile_picture_url, accountData?.avatar_url, accountData?.picture, accountData?.image_url];

        for (const source of sources) {
            if (source && typeof source === 'string' && source.trim()) {
                return source.trim();
            }
        }

        return undefined;
    }

    /**
     * Extract capabilities from account data
     */
    private extractCapabilities(accountData: any): string[] {
        if (accountData?.capabilities && Array.isArray(accountData.capabilities)) {
            return accountData.capabilities;
        }

        // Default capabilities based on provider
        const providerConfig = UnipileService.getProviderConfig(accountData?.provider || '');
        return providerConfig?.capabilities || [];
    }

    /**
     * Import an existing Unipile account into our database
     */
    private async importExistingUnipileAccount(params: { userId: string; organizationId: string; unipileAccount: any }): Promise<{ url?: string; pendingAccountId: string; imported: boolean }> {
        try {
            logger.info('=== IMPORTING EXISTING UNIPILE ACCOUNT ===', {
                unipileAccountId: params.unipileAccount.id,
                accountName: params.unipileAccount.name,
                provider: params.unipileAccount.type,
            });

            // Get profile data from Unipile
            let profileData = null;
            try {
                profileData = await this.unipileService.getOwnProfile(params.unipileAccount.id);
                logger.info('Retrieved profile data for existing account', { profileData });
            } catch (error) {
                logger.warn('Could not fetch profile data for existing account', { error });
            }

            // Extract account information
            const displayName = this.extractDisplayName(params.unipileAccount, profileData);
            const email = this.extractEmail(params.unipileAccount, profileData);
            const profilePictureUrl = this.extractProfilePicture(params.unipileAccount, profileData);
            const capabilities = this.extractCapabilities(params.unipileAccount);

            // Create connected account record directly
            const accountData: CreateConnectedAccountDto = {
                user_id: params.userId,
                organization_id: params.organizationId,
                status: 'connected', // Already connected in Unipile
                provider: params.unipileAccount.type.toLowerCase() as 'linkedin' | 'email' | 'gmail' | 'outlook',
                display_name: displayName,
                email: email,
                profile_picture_url: profilePictureUrl,
                provider_account_id: params.unipileAccount.id, // Use actual Unipile ID
                capabilities: capabilities,
                metadata: {
                    created_at: new Date().toISOString(),
                    connection_status: 'connected',
                    account_type: 'personal',
                    daily_limit: 100,
                    provider_account_id: params.unipileAccount.id,
                    unipile_account_data: params.unipileAccount,
                    profile_data: profileData,
                    imported_at: new Date().toISOString(),
                    connection_quality: 'good',
                    last_synced_at: new Date().toISOString(),
                },
            };

            logger.info('Creating connected account record from existing Unipile account', { accountData });

            const connectedAccount = await this.connectedAccountRepository.create(accountData);

            logger.info('=== SUCCESSFULLY IMPORTED EXISTING ACCOUNT ===', {
                accountId: connectedAccount.id,
                unipileAccountId: params.unipileAccount.id,
                displayName: connectedAccount.display_name,
                email: connectedAccount.email,
                status: connectedAccount.status,
            });

            return {
                pendingAccountId: connectedAccount.id,
                imported: true,
                // No URL needed since account is already connected
            };
        } catch (error) {
            logger.error('Error importing existing Unipile account', { error, params });
            throw error;
        }
    }

    /**
     * Clean up old pending accounts to prevent duplicates
     */
    private async cleanupOldPendingAccounts(userId: string, organizationId: string, provider: string): Promise<void> {
        try {
            logger.info('Cleaning up old pending accounts', { userId, organizationId, provider });

            // Get all accounts for this user/org/provider
            const allAccounts = await this.connectedAccountRepository.getUserAccounts(organizationId);
            const pendingAccounts = allAccounts.filter(acc => acc.user_id === userId && acc.provider === provider && acc.status === 'pending' && acc.provider_account_id?.startsWith('pending-'));

            // Delete pending accounts older than 1 hour
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            for (const account of pendingAccounts) {
                const createdAt = new Date(account.created_at || Date.now());
                if (createdAt < oneHourAgo) {
                    logger.info('Deleting old pending account', {
                        accountId: account.id,
                        providerAccountId: account.provider_account_id,
                        createdAt: account.created_at,
                    });
                    await this.connectedAccountRepository.delete(account.id);
                }
            }
        } catch (error) {
            logger.warn('Error cleaning up old pending accounts', { error });
        }
    }
}
