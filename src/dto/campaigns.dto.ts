import { z } from 'zod';
import id from 'zod/v4/locales/id.js';
import { EWorkflowNodeType } from '../types/workflow.types';

// Workflow Step Schema
const WorkflowStepSchema = z.object({
    id: z.string(),
    type: z.enum(['profile_visit', 'connection_request', 'message_sent', 'email_sent', 'like_post', 'comment_post', 'wait']),
    name: z.string(),
    delay: z.number().min(0).optional(), // Delay in minutes
    config: z.record(z.any()).default({}),
    conditions: z.record(z.any()).default({}),
    error_handling: z.enum(['skip', 'retry', 'stop']).default('skip'),
});

export enum CampaignStatus {
    DRAFT = 'DRAFT',
    SCHEDULED = 'SCHEDULED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    PAUSED = 'PAUSED',
}

export const CampaignStepDto = z.object({
    id: z.string(),
    type: z.nativeEnum(EWorkflowNodeType),
    config: z.record(z.any()).default({}),
    executed_at: z.string().datetime(),
    results: z.record(z.any()).default({}),
    success: z.boolean(),
});

// Campaign Step DTOs for the campaign_steps table
export const CreateCampaignStepDto = z.object({
    campaign_id: z.string().uuid('Invalid campaign ID format'),
    organization_id: z.string().uuid('Invalid organization ID format'),
    step_index: z.number().int().min(0, 'Step index must be non-negative'),
    lead_id: z.string().uuid('Invalid lead ID format'),
    type: z.nativeEnum(EWorkflowNodeType),
    config: z.record(z.any()).nullable().optional(),
    success: z.boolean().default(false),
    result: z.record(z.any()).nullable().optional(),
});

export const UpdateCampaignStepDto = z.object({
    step_index: z.number().int().min(0, 'Step index must be non-negative').optional(),
    type: z.nativeEnum(EWorkflowNodeType).optional(),
    config: z.record(z.any()).nullable().optional(),
    success: z.boolean().optional(),
    result: z.record(z.any()).nullable().optional(),
});

export const CampaignStepResponseDto = z.object({
    id: z.string().uuid(),
    campaign_id: z.string().uuid('Invalid campaign ID format'),
    organization_id: z.string().uuid('Invalid organization ID format'),
    lead_id: z.string().uuid('Invalid lead ID format'),
    step_index: z.number().int(),
    type: z.nativeEnum(EWorkflowNodeType),
    config: z.record(z.any()).nullable(),
    success: z.boolean(),
    result: z.record(z.any()).nullable(),
    created_at: z.string().datetime(),
});
// Campaign DTOs
export const CreateCampaignDto = z.object({
    organization_id: z.string().uuid().nullable().optional(),
    name: z.string().min(1, 'Campaign name is required'),
    description: z.string().nullable().optional(),
    sender_account: z.string().nullable().optional(),
    prospect_list: z.string().nullable().optional(),
    start_date: z.string().date().nullable().optional(),
    leads_per_day: z.number().nullable().optional(),
    start_time: z.string().nullable().optional(), // time without time zone
    end_time: z.string().nullable().optional(), // time without time zone
    timezone: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    bucket: z.string().nullable().optional(),
    is_deleted: z.boolean().default(false).optional(),
    status: z.nativeEnum(CampaignStatus).default(CampaignStatus.DRAFT),
    steps: z
        .object({
            steps: z.array(CampaignStepDto).default([]).optional().nullable(),
        })
        .optional()
        .nullable(),
    requests_sent_this_day: z.number().nullable().default(0).optional(),
    requests_sent_this_week: z.number().nullable().default(0).optional(),
    last_daily_requests_reset: z.string().datetime().nullable().optional(),
    last_weekly_requests_reset: z.string().datetime().nullable().optional(),
});

export const UpdateCampaignDto = z.object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    sender_account: z.string().nullable().optional(),
    prospect_list: z.string().nullable().optional(),
    start_date: z.string().date().nullable().optional(),
    leads_per_day: z.number().nullable().optional(),
    start_time: z.string().nullable().optional(), // time without time zone
    end_time: z.string().nullable().optional(), // time without time zone
    timezone: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    bucket: z.string().nullable().optional(),
    is_deleted: z.boolean().default(false).optional(),
    status: z.nativeEnum(CampaignStatus).optional(),
    steps: z
        .object({
            steps: z.array(CampaignStepDto).default([]).optional().nullable(),
        })
        .optional()
        .nullable(),
    requests_sent_this_day: z.number().nullable().default(0).optional(),
    requests_sent_this_week: z.number().nullable().default(0).optional(),
    last_daily_requests_reset: z.string().datetime().nullable().optional(),
    last_weekly_requests_reset: z.string().datetime().nullable().optional(),
});

/**
 * DTO for campaign response (matches database Row type)
 */
export const CampaignResponseDto = z.object({
    id: z.string().uuid(),
    organization_id: z.string().uuid().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    sender_account: z.string().nullable(),
    prospect_list: z.string().nullable(),
    start_date: z.string().date().nullable(),
    leads_per_day: z.number().nullable().optional(),
    start_time: z.string().nullable(), // time without time zone
    end_time: z.string().nullable(), // time without time zone
    timezone: z.string().nullable(),
    file_name: z.string().nullable(),
    bucket: z.string().nullable(),
    created_at: z.string().datetime().nullable(),
    updated_at: z.string().datetime().nullable(),
    is_deleted: z.boolean().default(false).optional(),
    status: z.nativeEnum(CampaignStatus).default(CampaignStatus.DRAFT),
    steps: z
        .object({
            steps: z.array(CampaignStepDto).default([]).optional().nullable(),
        })
        .optional()
        .nullable(),
    requests_sent_this_day: z.number().nullable(),
    requests_sent_this_week: z.number().nullable(),
    last_daily_requests_reset: z.string().datetime().nullable().optional(),
    last_weekly_requests_reset: z.string().datetime().nullable().optional(),
    started_at: z.string().datetime().nullable().optional(),
    completed_at: z.string().datetime().nullable().optional(),
});

export const CampaignQueryDto = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
    organization_id: z.string().uuid().optional(),
    sender_account: z.string().optional(),
    prospect_list: z.string().optional(),
    start_date_from: z.string().date().optional(),
    start_date_to: z.string().date().optional(),
    created_from: z.string().date().optional(),
    created_to: z.string().date().optional(),
});

// Campaign Analytics DTO
export const CampaignAnalyticsDto = z.object({
    date_from: z.string().date().optional(),
    date_to: z.string().date().optional(),
    period: z.enum(['hour', 'day', 'week', 'month']).default('day'),
    metrics: z.array(z.enum(['sent', 'delivered', 'opened', 'clicked', 'replied', 'connected', 'bounced'])).optional(),
});

// Campaign Execution DTOs
export const CampaignExecutionQueryDto = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    status: z.enum(['pending', 'scheduled', 'in_progress', 'completed', 'failed', 'skipped']).optional(),
    lead_id: z.string().uuid().optional(),
    date_from: z.string().date().optional(),
    date_to: z.string().date().optional(),
});

export const UpdateCampaignExecutionDto = z.object({
    status: z.enum(['pending', 'scheduled', 'in_progress', 'completed', 'failed', 'skipped']).optional(),
    current_step: z.number().min(0).optional(),
    error_message: z.string().max(1000).optional(),
    execution_data: z.record(z.any()).optional(),
    response_data: z.record(z.any()).optional(),
});

// Message Template DTOs
export const CreateMessageTemplateDto = z.object({
    name: z.string().min(1, 'Template name is required').max(255),
    type: z.enum(['connection_request', 'follow_up', 'email', 'inmail']),
    subject: z.string().max(255).optional(), // For email templates
    content: z.string().min(1, 'Template content is required').max(5000),
    variables: z.array(z.string()).default([]), // Available variables like firstName, company
    tags: z.array(z.string()).default([]),
});

export const UpdateMessageTemplateDto = z.object({
    name: z.string().min(1).max(255).optional(),
    subject: z.string().max(255).optional(),
    content: z.string().min(1).max(5000).optional(),
    variables: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
});

export const MessageTemplateQueryDto = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
    type: z.enum(['connection_request', 'follow_up', 'email', 'inmail']).optional(),
    tags: z.string().optional(), // Comma-separated tags
});

// Workflow Template DTOs
export const CreateWorkflowTemplateDto = z.object({
    name: z.string().min(1, 'Workflow template name is required').max(255),
    description: z.string().max(1000).optional(),
    type: z.enum(['linkedin', 'email', 'mixed']),
    steps: z.array(WorkflowStepSchema).min(1, 'At least one step is required'),
    tags: z.array(z.string()).default([]),
    is_public: z.boolean().default(false),
});

export const UpdateWorkflowTemplateDto = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
    steps: z.array(WorkflowStepSchema).min(1).optional(),
    tags: z.array(z.string()).optional(),
    is_public: z.boolean().optional(),
});

export const WorkflowTemplateQueryDto = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
    type: z.enum(['linkedin', 'email', 'mixed']).optional(),
    is_public: z.coerce.boolean().optional(),
    tags: z.string().optional(), // Comma-separated tags
});

// Type exports
export type CreateCampaignDto = z.infer<typeof CreateCampaignDto>;
export type UpdateCampaignDto = z.infer<typeof UpdateCampaignDto>;
export type CampaignResponseDto = z.infer<typeof CampaignResponseDto>;
export type CampaignQueryDto = z.infer<typeof CampaignQueryDto>;
export type CampaignStepDto = z.infer<typeof CampaignStepDto>;
export type CreateCampaignStepDto = z.infer<typeof CreateCampaignStepDto>;
export type UpdateCampaignStepDto = z.infer<typeof UpdateCampaignStepDto>;
export type CampaignStepResponseDto = z.infer<typeof CampaignStepResponseDto>;
export type CampaignAnalyticsDto = z.infer<typeof CampaignAnalyticsDto>;
export type CampaignExecutionQueryDto = z.infer<typeof CampaignExecutionQueryDto>;
export type UpdateCampaignExecutionDto = z.infer<typeof UpdateCampaignExecutionDto>;
export type CreateMessageTemplateDto = z.infer<typeof CreateMessageTemplateDto>;
export type UpdateMessageTemplateDto = z.infer<typeof UpdateMessageTemplateDto>;
export type MessageTemplateQueryDto = z.infer<typeof MessageTemplateQueryDto>;
export type CreateWorkflowTemplateDto = z.infer<typeof CreateWorkflowTemplateDto>;
export type UpdateWorkflowTemplateDto = z.infer<typeof UpdateWorkflowTemplateDto>;
export type WorkflowTemplateQueryDto = z.infer<typeof WorkflowTemplateQueryDto>;
