import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Define environment variable schema
const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z
        .string()
        .transform(val => parseInt(val, 10))
        .default('3004'),

    // Supabase (optional for development)
    SUPABASE_URL: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),

    // Clerk Authentication (required in production)
    CLERK_SECRET_KEY: z.string().min(1, 'Clerk Secret Key is required'),
    CLERK_WEBHOOK_SECRET: z.string().min(1, 'Clerk Webhook Secret is required'),

    // Unipile Integration
    UNIPILE_DNS: z.string().default('https://api.unipile.com/v1'),
    UNIPILE_ACCESS_TOKEN: z.string().optional(),

    // XPay Integration
    XPAY_PUBLIC_KEY: z.string().optional(),
    XPAY_SECRET_KEY: z.string().optional(),
    XPAY_WEBHOOK_SECRET: z.string().optional(),

    // Google Cloud Storage (optional for development)
    GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
    GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY: z.string().optional(),
    GOOGLE_CLOUD_STORAGE_BUCKET: z.string().default('clento-lead-lists'),

    // CORS
    CORS_ORIGIN: z.string().default('*'),

    // Logging
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    DEBUG_LOGS: z
        .string()
        .transform(val => val === 'true')
        .default('false'),
    REQUESTS_PER_DAY: z.coerce.number().default(60),
    REQUESTS_PER_WEEK: z.coerce.number().default(200),

    // JWT Token Authentication
    JWT_SECRET: z.string().min(1, 'JWT Secret is required'),

    OPENAI_API_KEY: z.string(),
});

// Parse and validate environment variables
const env = envSchema.safeParse(process.env);

if (!env.success) {
    console.error('❌ Invalid environment variables:', env.error.format());
    process.exit(1);
}

export default env.data;
