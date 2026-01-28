import { BaseRepository } from './BaseRepository';
import { CreateWorkflowStepDto, EWorkflowStepStatus, EWorkflowType, UpdateWorkflowStepDto, WorkflowStepResponseDto } from '../dto/workflowSteps.dto';

export class WorkflowStepsRepository extends BaseRepository<WorkflowStepResponseDto, CreateWorkflowStepDto, UpdateWorkflowStepDto> {
    constructor() {
        super('workflow_steps');
    }

    public async findByLeadIdInAndWorkflowType(leadIds: string[], workflowType: EWorkflowType): Promise<WorkflowStepResponseDto[]> {
        const { data, error } = await this.client.from(this.tableName).select('*').in('lead_id', leadIds).eq('workflow_type', workflowType);
        if (error) {
            throw error;
        }
        return data;
    }

    public async bulkCreate(workflowSteps: CreateWorkflowStepDto[]): Promise<WorkflowStepResponseDto[]> {
        const { data, error } = await this.client.from(this.tableName).insert(workflowSteps).select('*');
        if (error) {
            throw error;
        }
        return data;
    }

    /** execute_after is stored as Unix seconds (integer). */
    public async getDailyStepsToExecute() {
        const { data, error } = await this.client.from(this.tableName).select('*').eq('status', EWorkflowStepStatus.PENDING);
        if (error) {
            throw error;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const filteredSteps = (data as WorkflowStepResponseDto[]).filter(step => step.execute_after <= nowSeconds);
        return filteredSteps as WorkflowStepResponseDto[];
    }

    public async findPendingConnectionRequestStepsByLeadIds(leadIds: string[]): Promise<WorkflowStepResponseDto[]> {
        if (leadIds.length === 0) return [];
        const { data, error } = await this.client
            .from(this.tableName)
            .select('*')
            .in('lead_id', leadIds)
            .eq('status', EWorkflowStepStatus.PENDING)
            .eq('step_type', 'send_connection_request')
            .eq('workflow_type', EWorkflowType.CAMPAIGN_WORKFLOW);
        if (error) throw error;
        return (data || []) as WorkflowStepResponseDto[];
    }

    public async findFailedStepsByLeadIds(leadIds: string[]): Promise<WorkflowStepResponseDto[]> {
        if (leadIds.length === 0) return [];
        const { data, error } = await this.client
            .from(this.tableName)
            .select('*')
            .in('lead_id', leadIds)
            .eq('status', EWorkflowStepStatus.FAILED)
            .eq('workflow_type', EWorkflowType.CAMPAIGN_WORKFLOW);
        if (error) throw error;
        return (data || []) as WorkflowStepResponseDto[];
    }
}
