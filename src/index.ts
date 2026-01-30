import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import 'express-async-errors';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import { execSync } from 'child_process';
import env from './config/env';
import supabase from './config/supabase';
import sessions from 'client-sessions';
import { setupSwagger } from './config/swagger';
import { errorHandler } from './middleware/errorHandler';
import { CronService } from './services/crons/CronService';
import { cronJobs } from './cron/jobs';
import './utils/expressExtensions'; // Import express extensions
import './utils/arrayExtensions'; // Import array extensions globally
import './utils/mapExtensions'; // Import map extensions globally
import logger from './utils/logger';
import registerAllRoutes from './utils/registerRoutes';
import { rawBodyCapture } from './middleware/validation';
import { loggers } from 'winston';
import Slack from './utils/slack';

// Create Express application
const app = express();

app.use(morgan('dev'));

// Apply middleware
app.use(helmet());

// Configure CORS based on environment
const corsOptions = {
    origin:
        env.NODE_ENV === 'development'
            ? (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
                // Allow all localhost origins and app.clento.ai in development
                if (!origin || origin.match(/^http:\/\/localhost:\d+$/) || origin === 'https://app.clento.ai' || origin === 'https://reporter.clento.ai') {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            }
            : env.CORS_ORIGIN,
    credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());

app.use((req, res, next) => {
    const isLocalhost = req.headers['origin']?.toString()?.includes('localhost') || req.headers['referer']?.toString()?.includes('localhost') || req.headers['host']?.toString()?.includes('localhost');
    if (isLocalhost) {
        sessions({
            cookieName: 'reporter',
            secret: env.JWT_SECRET,
            duration: 72 * 60 * 60 * 1000,
            activeDuration: 60 * 60 * 1000,
            cookie: {
                httpOnly: false,
                sameSite: 'lax',
                // domain: '.clento.ai',
            },
        })(req, res, next);
    } else {
        sessions({
            cookieName: 'reporter',
            secret: env.JWT_SECRET,
            duration: 72 * 60 * 60 * 1000,
            activeDuration: 60 * 60 * 1000,
            cookie: {
                httpOnly: false,
                sameSite: 'lax',
                domain: '.clento.ai',
            },
        })(req, res, next);
    }
});
app.use(express.json({ verify: rawBodyCapture }));
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow CSV files
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

// Apply multer middleware globally
app.use(upload.any());

// Setup Swagger
setupSwagger(app);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
    });
});

// Auto-register all API routes
const routesPath = path.join(__dirname, 'routes');
registerAllRoutes(app, routesPath);

// Error handling middleware
app.use(errorHandler);

// Initialize database and start server
const startServer = async () => {
    try {
        // Initialize Supabase connection
        await supabase.initSupabase();

        // Check for existing processes on the port before starting and kill them FIRST
        // This ensures old workers are stopped before new ones start
        try {
            const portCheck = execSync(`lsof -ti:${env.PORT}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            if (portCheck) {
                const pids = portCheck.split('\n').filter(Boolean).map(pid => parseInt(pid, 10));
                // Filter out our own process ID if it's somehow in the list
                const otherPids = pids.filter(pid => pid !== process.pid);

                // Kill existing processes on the port
                if (otherPids.length > 0) {
                    for (const pid of otherPids) {
                        try {
                            // Send SIGTERM first for graceful shutdown
                            process.kill(pid, 'SIGTERM');

                            // Wait a bit for graceful shutdown
                            await new Promise(resolve => setTimeout(resolve, 500));

                            // Check if process still exists, force kill if needed
                            try {
                                execSync(`kill -0 ${pid}`, { stdio: 'pipe' });
                                // Process still exists, force kill
                                process.kill(pid, 'SIGKILL');
                            } catch {
                                // Process already dead, good
                            }
                        } catch (killError) {
                            // Process may already be dead, continue
                        }
                    }

                    // Wait a bit more for port to be released
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            // Port is free (lsof returns error when no processes found)
        }

        // Initialize and start cron jobs
        try {
            const cronService = CronService.getInstance();
            cronService.registerJobs(cronJobs);
            cronService.start();
            logger.info('✅ Cron service initialized and started');
        } catch (cronError) {
            logger.error('Failed to initialize cron service', {
                error: cronError instanceof Error ? cronError.message : String(cronError),
                stack: cronError instanceof Error ? cronError.stack : undefined,
            });
            logger.info('Server will continue without cron functionality');
        }

        // Start server
        const server = app.listen(env.PORT, () => {
            logger.info(`🚀 Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
            logger.info(`📚 API documentation available at http://localhost:${env.PORT}/api-docs`);
        });

        // Handle server errors (e.g., port already in use)
        server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                logger.error(`Port ${env.PORT} is already in use. Please kill the process using this port or use a different port.`);
                logger.error(`To kill the process, run: lsof -ti:${env.PORT} | xargs kill -9`);
                process.exit(1);
            } else {
                logger.error('Server error:', error);
                process.exit(1);
            }
        });

        // Graceful shutdown handler
        const gracefulShutdown = async (signal: string) => {
            logger.info(`${signal} received, starting graceful shutdown...`);

            try {
                // Stop accepting new connections
                server.close(() => {
                    logger.info('HTTP server closed');
                    process.exit(0);
                });

                // Force close after 10 seconds
                setTimeout(() => {
                    logger.warn('Forcing shutdown after timeout');
                    process.exit(1);
                }, 10000);

                // Shutdown cron jobs gracefully
                const cronService = CronService.getInstance();
                if (cronService.isServiceRunning()) {
                    cronService.stop();
                }

                logger.info('✅ Graceful shutdown completed');
            } catch (error) {
                logger.error('Error during graceful shutdown', { error });
                process.exit(1);
            }
        };

        // Handle shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (err: Error) => {
            logger.error('Unhandled Rejection:', err);
            gracefulShutdown('UNHANDLED_REJECTION');
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Start server when run directly
if (require.main === module) {
    startServer();
}

export default app;
