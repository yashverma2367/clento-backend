import { BaseRepository } from './BaseRepository';
import { DatabaseError, NotFoundError } from '../errors/AppError';
import logger from '../utils/logger';
import { LeadResponseDto, LeadInsertDto, LeadUpdateDto } from '../dto/leads.dto';

/**
 * Repository for leads table operations
 */
export class LeadRepository extends BaseRepository<LeadResponseDto, LeadInsertDto, LeadUpdateDto> {
    constructor() {
        super('leads');
    }

    /**
     * Find leads by lead list ID
     */
    async findByLeadListId(
        leadListId: string,
        options?: {
            page?: number;
            limit?: number;
            search?: string;
            status?: string;
            tags?: string[];
        },
    ): Promise<{ data: LeadResponseDto[]; total: number; page: number; limit: number }> {
        try {
            const page = options?.page || 1;
            const limit = options?.limit || 20;
            const offset = (page - 1) * limit;

            let query = this.client.from(this.tableName).select('*', { count: 'exact' }).eq('lead_list_id', leadListId).order('created_at', { ascending: false });

            // Apply filters
            if (options?.search) {
                query = query.or(`full_name.ilike.%${options.search}%,email.ilike.%${options.search}%,company.ilike.%${options.search}%`);
            }

            if (options?.status) {
                query = query.eq('status', options.status);
            }

            if (options?.tags && options.tags.length > 0) {
                query = query.overlaps('tags', options.tags);
            }

            // Apply pagination
            query = query.range(offset, offset + limit - 1);

            const { data, error, count } = await query;

            if (error) {
                logger.error('Error finding leads by lead list', { error, leadListId });
                throw new DatabaseError('Failed to retrieve leads');
            }

            return {
                data: data || [],
                total: count || 0,
                page,
                limit,
            };
        } catch (error) {
            logger.error('Error in findByLeadListId', { error, leadListId });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to retrieve leads');
        }
    }

    /**
     * Find leads by organization ID
     */
    async findByOrganizationId(
        organizationId: string,
        options?: {
            page?: number;
            limit?: number;
            search?: string;
            status?: string;
            leadListId?: string;
            company?: string;
            industry?: string;
            location?: string;
            seniorityLevel?: string;
            tags?: string[];
            hasEmail?: boolean;
            hasLinkedIn?: boolean;
            createdFrom?: string;
            createdTo?: string;
        },
    ): Promise<{ data: LeadResponseDto[]; total: number; page: number; limit: number }> {
        try {
            const page = options?.page || 1;
            const limit = options?.limit || 20;
            const offset = (page - 1) * limit;

            let query = this.client.from(this.tableName).select('*', { count: 'exact' }).eq('organization_id', organizationId).order('created_at', { ascending: false });

            // Apply filters
            if (options?.search) {
                query = query.or(`full_name.ilike.%${options.search}%,email.ilike.%${options.search}%,company.ilike.%${options.search}%`);
            }

            if (options?.status) {
                query = query.eq('status', options.status);
            }

            if (options?.leadListId) {
                query = query.eq('lead_list_id', options.leadListId);
            }

            if (options?.company) {
                query = query.ilike('company', `%${options.company}%`);
            }

            if (options?.industry) {
                query = query.ilike('industry', `%${options.industry}%`);
            }

            if (options?.location) {
                query = query.ilike('location', `%${options.location}%`);
            }

            if (options?.seniorityLevel) {
                query = query.eq('seniority_level', options.seniorityLevel);
            }

            if (options?.tags && options.tags.length > 0) {
                query = query.overlaps('tags', options.tags);
            }

            if (options?.hasEmail !== undefined) {
                if (options.hasEmail) {
                    query = query.not('email', 'is', null);
                } else {
                    query = query.is('email', null);
                }
            }

            if (options?.hasLinkedIn !== undefined) {
                if (options.hasLinkedIn) {
                    query = query.not('linkedin_url', 'is', null);
                } else {
                    query = query.is('linkedin_url', null);
                }
            }

            if (options?.createdFrom) {
                query = query.gte('created_at', options.createdFrom);
            }

            if (options?.createdTo) {
                query = query.lte('created_at', options.createdTo);
            }

            // Apply pagination
            query = query.range(offset, offset + limit - 1);

            const { data, error, count } = await query;

            if (error) {
                logger.error('Error finding leads by organization', { error, organizationId });
                throw new DatabaseError('Failed to retrieve leads');
            }

            return {
                data: data || [],
                total: count || 0,
                page,
                limit,
            };
        } catch (error) {
            logger.error('Error in findByOrganizationId', { error, organizationId });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to retrieve leads');
        }
    }

    /**
     * Find lead IDs by campaign IDs (for rate-limit deferral)
     */
    async findLeadIdsByCampaignIds(campaignIds: string[]): Promise<string[]> {
        if (campaignIds.length === 0) return [];
        try {
            const { data, error } = await this.client
                .from(this.tableName)
                .select('id')
                .in('campaign_id', campaignIds);
            if (error) {
                logger.error('Error finding lead IDs by campaign IDs', { error, campaignIds });
                throw new DatabaseError('Failed to retrieve lead IDs');
            }
            return (data || []).map((row: { id: string }) => row.id);
        } catch (error) {
            logger.error('Error in findLeadIdsByCampaignIds', { error, campaignIds });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to retrieve lead IDs');
        }
    }

    /**
     * Find lead by LinkedIn URL
     */
    async findByLinkedInUrl(linkedinUrl: string): Promise<LeadResponseDto | null> {
        try {
            const { data, error } = await this.client.from(this.tableName).select('*').eq('linkedin_url', linkedinUrl).single();

            // PGRST116 is "not found" error - this is expected when no lead exists
            if (error && error.code !== 'PGRST116') {
                logger.error('Error finding lead by LinkedIn URL', { error, linkedinUrl });
                throw new DatabaseError('Failed to find lead');
            }

            return data || null;
        } catch (error) {
            // If it's a "not found" error, return null instead of throwing
            if (error instanceof Error && error.message.includes('PGRST116')) {
                return null;
            }

            logger.error('Error in findByLinkedInUrl', { error, linkedinUrl });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to find lead');
        }
    }

    /**
     * Find lead by email
     */
    async findByEmail(email: string): Promise<LeadResponseDto | null> {
        try {
            const { data, error } = await this.client.from(this.tableName).select('*').eq('email', email).single();

            // PGRST116 is "not found" error - this is expected when no lead exists
            if (error && error.code !== 'PGRST116') {
                logger.error('Error finding lead by email', { error, email });
                throw new DatabaseError('Failed to find lead');
            }

            return data || null;
        } catch (error) {
            // If it's a "not found" error, return null instead of throwing
            if (error instanceof Error && error.message.includes('PGRST116')) {
                return null;
            }

            logger.error('Error in findByEmail', { error, email });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to find lead');
        }
    }

    /**
     * Bulk create leads
     */
    async bulkCreate(leads: LeadInsertDto[]): Promise<LeadResponseDto[]> {
        try {
            const { data, error } = await this.client
                .from(this.tableName)
                .insert(leads)
                .select();

            if (error) {
                logger.error('Error bulk creating leads', { error, count: leads.length });
                throw new DatabaseError('Failed to create leads');
            }

            logger.info('Leads bulk created', { count: data?.length || 0 });
            return data || [];
        } catch (error) {
            logger.error('Error in bulkCreate', { error, count: leads.length });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to create leads');
        }
    }

    /**
     * Bulk update leads
     */
    async bulkUpdate(leadIds: string[], updates: LeadUpdateDto): Promise<void> {
        try {
            await this.bulkUpdate(leadIds, {
                ...updates,
                updated_at: new Date().toISOString(),
            });
        } catch (error) {
            logger.error('Error in bulkUpdate', { error, leadIds, updates });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to update leads');
        }
    }

    /**
     * Update lead status
     */
    async updateStatus(leadId: string, status: LeadResponseDto['status']): Promise<void> {
        try {
            this.update(leadId, {
                status: status as any,
                updated_at: new Date().toISOString(),
            });
        } catch (error) {
            logger.error('Error in updateStatus', { error, leadId, status });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to update lead status');
        }
    }
    /**
     * Get lead statistics by organization
     */
    async getOrganizationStatistics(organizationId: string): Promise<{
        total_leads: number;
        new_leads: number;
        contacted_leads: number;
        replied_leads: number;
        connected_leads: number;
        not_interested_leads: number;
        bounced_leads: number;
    }> {
        try {
            // Get total leads count
            const { count: totalLeads, error: totalError } = await this.client.from(this.tableName).select('*', { count: 'exact', head: true }).eq('organization_id', organizationId);

            if (totalError) {
                logger.error('Error getting total leads count', { error: totalError, organizationId });
                throw new DatabaseError('Failed to get lead statistics');
            }

            // Get leads by status
            const { data: statusCounts, error: statusError } = await this.client.from(this.tableName).select('status').eq('organization_id', organizationId);

            if (statusError) {
                logger.error('Error getting leads by status', { error: statusError, organizationId });
                throw new DatabaseError('Failed to get lead statistics');
            }

            // Count leads by status
            const statusMap = (statusCounts || []).reduce(
                (acc, lead: any) => {
                    acc[lead.status] = (acc[lead.status] || 0) + 1;
                    return acc;
                },
                {} as Record<string, number>,
            );

            return {
                total_leads: totalLeads || 0,
                new_leads: statusMap['new'] || 0,
                contacted_leads: statusMap['contacted'] || 0,
                replied_leads: statusMap['replied'] || 0,
                connected_leads: statusMap['connected'] || 0,
                not_interested_leads: statusMap['not_interested'] || 0,
                bounced_leads: statusMap['bounced'] || 0,
            };
        } catch (error) {
            logger.error('Error in getOrganizationStatistics', { error, organizationId });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to get lead statistics');
        }
    }

    async findByLinkedinIds(linkedinIds: string[]): Promise<LeadResponseDto[]> {
        try {
            const { data, error } = await this.client.from(this.tableName).select('*').in('linkedin_id', linkedinIds);
            if (error) {
                logger.error('Error finding leads by linkedin IDs', { error, linkedinIds });
                throw new DatabaseError('Failed to find leads');
            }
            return data || [];
        } catch (error) {
            logger.error('Error in findByLinkedinIds', { error, linkedinIds });
            throw error instanceof DatabaseError ? error : new DatabaseError('Failed to find leads');
        }
    }
}
