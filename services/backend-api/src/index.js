import express from 'express';
import cors from 'cors';
import pino from 'pino';
import authRoutes from './routes/auth.js';
import tenantRoutes from './routes/tenants.js';
import promptRoutes from './routes/prompts.js';
import aiRoutes from './routes/ai.js';
import chatRoutes from './routes/chats.js';
import integrationRoutes from './routes/integrations.js';
import logisticsRoutes from './routes/logistics.js';
import planRoutes from './routes/plans.js';
import analyticsRoutes from './routes/analytics.js';

const logger = pino({ name: 'backend-api' });
const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'whatsapp-auto-backend',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Backend API escuchando en el puerto ${PORT}`);
});
