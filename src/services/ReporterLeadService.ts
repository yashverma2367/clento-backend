import {
    CreateReporterLeadDto,
    UpdateReporterLeadDto,
    ReporterLeadResponseDto,
} from '../dto/reporterDtos/leads.dto';
import { NotFoundError, ValidationError } from '../errors/AppError';
import logger from '../utils/logger';
import { ReporterLeadRepository } from '../repositories/reporterRepositories/LeadRepository';
import { CsvService } from './CsvService';

/**
 * Service for managing reporter leads
 */
export class ReporterLeadService {
    private leadRepository: ReporterLeadRepository;

    constructor() {
        this.leadRepository = new ReporterLeadRepository();
    }

    /**
     * Create a new lead
     */
    async createLead(data: CreateReporterLeadDto): Promise<ReporterLeadResponseDto> {
        try {
            // Validate LinkedIn URL format
            const identifier = CsvService.extractLinkedInPublicIdentifier(data.linkedin_url);
            if (!identifier) {
                throw new ValidationError('Invalid LinkedIn URL format');
            }

            // Check if lead already exists for this user
            const existingLead = await this.leadRepository.findByUserAndLinkedInUrl(
                data.user_id,
                data.linkedin_url
            );

            if (existingLead) {
                logger.info('Lead already exists, returning existing lead', {
                    userId: data.user_id,
                    linkedinUrl: data.linkedin_url,
                    leadId: existingLead.id,
                });
                return existingLead;
            }

            // Create new lead
            const lead = await this.leadRepository.create(data);

            logger.info('Reporter lead created successfully', {
                leadId: lead.id,
                userId: data.user_id,
                linkedinUrl: data.linkedin_url,
            });

            return lead;
        } catch (error) {
            logger.error('Error creating reporter lead', { error, data });
            throw error;
        }
    }

    /**
     * Get lead by ID
     */
    async getLeadById(leadId: string, userId: string): Promise<ReporterLeadResponseDto> {
        try {
            const lead = await this.leadRepository.findById(leadId);

            if (!lead) {
                throw new NotFoundError('Lead not found');
            }

            // Verify user has access to this lead
            if (lead.user_id !== userId) {
                throw new NotFoundError('Lead not found');
            }

            return lead;
        } catch (error) {
            logger.error('Error getting reporter lead by ID', { error, leadId, userId });
            throw error;
        }
    }

    /**
     * Update lead
     */
    async updateLead(leadId: string, data: UpdateReporterLeadDto, userId: string): Promise<ReporterLeadResponseDto> {
        try {
            // Verify lead exists and user has access
            await this.getLeadById(leadId, userId);

            // Update lead
            const updatedLead = await this.leadRepository.update(leadId, data);

            logger.info('Reporter lead updated successfully', {
                leadId,
                userId,
                updates: Object.keys(data),
            });

            return updatedLead;
        } catch (error) {
            logger.error('Error updating reporter lead', { error, leadId, data, userId });
            throw error;
        }
    }

    /**
     * Get all leads for a user
     */
    async getUserLeads(userId: string): Promise<ReporterLeadResponseDto[]> {
        try {
            const leads = await this.leadRepository.getUserLeads(userId);

            logger.info('Retrieved reporter user leads', {
                userId,
                leadCount: leads.length,
            });

            return leads;
        } catch (error) {
            logger.error('Error getting reporter user leads', { error, userId });
            throw error;
        }
    }

    /**
     * Find or create lead by LinkedIn URL
     */
    async findOrCreateLead(userId: string, linkedinUrl: string): Promise<ReporterLeadResponseDto> {
        try {
            // Check if lead exists
            const existingLead = await this.leadRepository.findByUserAndLinkedInUrl(userId, linkedinUrl);

            if (existingLead) {
                return existingLead;
            }

            // Create new lead (this will automatically start monitoring)
            const createData: CreateReporterLeadDto = {
                user_id: userId,
                linkedin_url: linkedinUrl,
            };

            return await this.createLead(createData);
        } catch (error) {
            logger.error('Error finding or creating reporter lead', { error, userId, linkedinUrl });
            throw error;
        }
    }
}
