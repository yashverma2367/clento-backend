import { LeadInsertDto, LeadResponseDto, LeadUpdateDto } from '../dto/leads.dto';
import { LeadRepository } from '../repositories/LeadRepository';

export class LeadService {
    private leadRepository: LeadRepository;

    constructor() {
        this.leadRepository = new LeadRepository();
    }

    public async createLead(data: LeadInsertDto): Promise<LeadResponseDto> {
        const lead = await this.leadRepository.create(data);
        return lead;
    }

    public async bulkCreate(dataArray: LeadInsertDto[]): Promise<LeadResponseDto[]> {
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
            return [];
        }
        const leads = await this.leadRepository.bulkCreate(dataArray);
        return leads;
    }

    public async getAllByCampaignId(campaignId: string): Promise<LeadResponseDto[]> {
        const leads = await this.leadRepository.findByField('campaign_id', campaignId);
        return leads;
    }

    public async updateLead(id: string, data: LeadUpdateDto): Promise<LeadResponseDto> {
        const lead = await this.leadRepository.update(id, data);
        return lead;
    }

    public async getRecentLeads(organizationId: string) {
        const leads = await this.leadRepository.findByOrganizationId(organizationId, {
            limit: 20,
        });
        return leads;
    }
}
