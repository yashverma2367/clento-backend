import { z } from 'zod';
import { EWorkflowNodeType } from '../types/workflow.types';
// DDL from database;

/*
    id uuid not null default gen_random_uuid (),
    organization_id uuid not null,
    lead_id uuid not null,
    step_index integer not null,
    workflow_type text not null,
    step_type text not null,
    status text not null,
    retries integer null,
    execute_after integer not null,
    last_try_at timestamp with time zone null,
    raw_response jsonB null,
    updated_at timestamp with time zone not null,
    created_at timestamp with time zone not null default now(),
*/

export enum EWorkflowType {
    CAMPAIGN_WORKFLOW = 'CAMPAIGN_WORKFLOW',
    LEAD_MONITOR = 'LEAD_MONITOR',
}

export enum EWorkflowStepStatus {
    PENDING = 'PENDING',
    COMPLETE = 'COMPLETE',
    FAILED = 'FAILED',
}

const WorkflowStepCreateDto = z.object({
    organization_id: z.string().uuid(),
    lead_id: z.string().uuid(),
    id_in_workflow: z.string(),
    step_index: z.number(),
    workflow_type: z.nativeEnum(EWorkflowType),
    step_type: z.union([
        z.nativeEnum(EWorkflowNodeType),
        z.literal('check_connection_status'),
        z.literal('check_message_reply'),
    ]),
    status: z.nativeEnum(EWorkflowStepStatus),
    retries: z.number().default(0),
    execute_after: z.number(),
    last_try_at: z.string().datetime().optional(),
    raw_response: z.any().optional(),
    updated_at: z.string().datetime(),
    created_at: z.string().datetime(),
});

const WorkflowStepUpdateDto = z.object({
    organization_id: z.string().uuid().optional(),
    lead_id: z.string().uuid().optional(),
    id_in_workflow: z.string().optional(),
    step_index: z.number().optional(),
    workflow_type: z.nativeEnum(EWorkflowType).optional(),
    step_type: z.union([
        z.nativeEnum(EWorkflowNodeType),
        z.literal('check_connection_status'),
        z.literal('check_message_reply'),
    ]).optional(),
    status: z.nativeEnum(EWorkflowStepStatus).optional(),
    retries: z.number().default(0).optional(),
    execute_after: z.number().optional(),
    last_try_at: z.string().datetime().optional(),
    raw_response: z.any().optional(),
    updated_at: z.string().datetime(),
});

const WorkflowStepResponseDto = z.object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    lead_id: z.string().uuid(),
    id_in_workflow: z.string(),
    step_index: z.number(),
    workflow_type: z.nativeEnum(EWorkflowType),
    step_type: z.union([
        z.nativeEnum(EWorkflowNodeType),
        z.literal('check_connection_status'),
        z.literal('check_message_reply'),
    ]),
    status: z.nativeEnum(EWorkflowStepStatus),
    retries: z.number().default(0),
    execute_after: z.number(),
    last_try_at: z.string().datetime().optional(),
    raw_response: z.any().optional(),
    updated_at: z.string().datetime(),
    created_at: z.string().datetime(),
});

export type CreateWorkflowStepDto = z.infer<typeof WorkflowStepCreateDto>;
export type UpdateWorkflowStepDto = z.infer<typeof WorkflowStepUpdateDto>;
export type WorkflowStepResponseDto = z.infer<typeof WorkflowStepResponseDto>;
