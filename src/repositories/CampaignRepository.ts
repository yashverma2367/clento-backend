import { BaseRepository } from './BaseRepository';
import { CampaignResponseDto, CreateCampaignDto, UpdateCampaignDto } from '../dto/campaigns.dto';
import { DatabaseError } from '../errors/AppError';
import logger from '../utils/logger';

/**
 * Repository for campaign-related database operations
 */
export class CampaignRepository extends BaseRepository<CampaignResponseDto, CreateCampaignDto, UpdateCampaignDto> {
    constructor() {
        super('campaigns');
    }

    /**
     * Find campaigns by organization ID
     */
    async findByOrganizationId(organizationId: string): Promise<CampaignResponseDto[]> {
        try {
            const { data, error } = await this.client.from(this.tableName).select('*').eq('organization_id', organizationId).neq('is_deleted', true).order('created_at', { ascending: false });

            if (error) {
                logger.error('Error finding campaigns by organization ID', { error, organizationId });
                throw new DatabaseError('Failed to fetch campaigns');
            }

            return data as CampaignResponseDto[];
        } catch (error) {
            logger.error('Error in findByOrganizationId', { error, organizationId });
            throw error;
        }
    }

    /**
     * Soft delete a campaign by setting is_deleted to true
     */
    async softDelete(id: string): Promise<void> {
        try {
            const { error } = await this.client.from(this.tableName).update({ is_deleted: true }).eq('id', id);

            if (error) {
                logger.error('Error soft deleting campaign', { error, id });
                throw new DatabaseError('Failed to delete campaign');
            }
        } catch (error) {
            logger.error('Error in softDelete', { error, id });
            throw error;
        }
    }

    /**
     * Find campaigns with pagination and filtering
     */
    async findWithPagination(
        organizationId: string,
        options?: {
            page?: number;
            limit?: number;
            search?: string;
            status?: string;
            startDateFrom?: string;
            startDateTo?: string;
        },
    ): Promise<{ data: CampaignResponseDto[]; total: number; page: number; limit: number }> {
        try {
            const page = options?.page || 1;
            const limit = options?.limit || 20;
            const offset = (page - 1) * limit;

            let query = this.client.from(this.tableName).select('*', { count: 'exact' }).eq('organization_id', organizationId).neq('is_deleted', true);

            // Apply filters
            if (options?.search) {
                query = query.or(`name.ilike.%${options.search}%,description.ilike.%${options.search}%`);
            }

            if (options?.status) {
                query = query.eq('status', options.status);
            }

            if (options?.startDateFrom) {
                query = query.gte('start_date', options.startDateFrom);
            }

            if (options?.startDateTo) {
                query = query.lte('start_date', options.startDateTo);
            }

            // Apply pagination and ordering
            query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

            const { data, error, count } = await query;

            if (error) {
                logger.error('Error finding campaigns with pagination', { error, organizationId, options });
                throw new DatabaseError('Failed to fetch campaigns');
            }

            return {
                data: data as CampaignResponseDto[],
                total: count || 0,
                page,
                limit,
            };
        } catch (error) {
            logger.error('Error in findWithPagination', { error, organizationId, options });
            throw error;
        }
    }

    /**
     * Find campaigns by sender account ID
     */
    async findBySenderAccount(senderAccountId: string): Promise<CampaignResponseDto[]> {
        try {
            const { data, error } = await this.client
                .from(this.tableName)
                .select('*')
                .eq('sender_account', senderAccountId)
                .neq('is_deleted', true);
            if (error) {
                logger.error('Error finding campaigns by sender account', { error, senderAccountId });
                throw new DatabaseError('Failed to fetch campaigns');
            }
            return (data || []) as CampaignResponseDto[];
        } catch (error) {
            logger.error('Error in findBySenderAccount', { error, senderAccountId });
            throw error;
        }
    }

    /**
     * Find campaigns by status
     */
    async findByStatus(status: string, organizationId?: string): Promise<CampaignResponseDto[]> {
        try {
            let query = this.client.from(this.tableName).select('*').eq('status', status).neq('is_deleted', true);

            if (organizationId) {
                query = query.eq('organization_id', organizationId);
            }

            const { data, error } = await query;

            if (error) {
                logger.error('Error finding campaigns by status', { error, status, organizationId });
                throw new DatabaseError('Failed to fetch campaigns by status');
            }

            return data as CampaignResponseDto[];
        } catch (error) {
            logger.error('Error in findByStatus', { error, status, organizationId });
            throw error;
        }
    }

    /**
     * Update campaign status
     */
    async updateStatus(id: string, status: string): Promise<CampaignResponseDto> {
        try {
            const { data, error } = await this.client.from(this.tableName).update({ status }).eq('id', id).select().single();

            if (error) {
                logger.error('Error updating campaign status', { error, id, status });
                throw new DatabaseError('Failed to update campaign status');
            }

            return data as CampaignResponseDto;
        } catch (error) {
            logger.error('Error in updateStatus', { error, id, status });
            throw error;
        }
    }
}
