import express, { Express } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from 'dotenv';

import { ArbitrageService } from './services/ArbitrageService';
import { WebSocketService } from './services/WebSocketService';
import { apiRoutes } from './routes/api';
import { ExchangeConfig, ArbitrageConfig } from './types';
import { ExchangeManager } from './services/exchanges/ExchangeManager';

config();

class ArbitBotServer {
    private app: Express;
    private readonly port: number;
    private exchangeManager?: ExchangeManager;
    private arbitrageService?: ArbitrageService;
    private wsService?: WebSocketService;

    constructor() {
        this.app = express();
        this.port = parseInt(process.env.PORT || '3000');

        this.setupMiddleware();
        this.initializeServices();
        this.setupRoutes();
        this.connectServices();
        this.setupGracefulShutdown();
    }

    private setupMiddleware(): void {
        this.app.use(cors());
        this.app.use(morgan('combined'));
        this.app.use(express.json());
    }

    private initializeServices(): void {
        const exchangeConfigs: ExchangeConfig[] = [
            { name: 'binance', sandbox: false },
            { name: 'coinbase', sandbox: false },
            { name: 'kraken', sandbox: false },
            { name: 'okx', sandbox: false },
            { name: 'bybit', sandbox: false },
        ];

        const arbitrageConfig: ArbitrageConfig = {
            minProfitPercent: 0.5,
            maxInvestment: 1000,
            enabledExchanges: ['binance', 'coinbase', 'kraken', 'okx', 'bybit'],
            symbols: ['BTC/USDT', 'ETH/USDT', 'ADA/USDT']
        };

        this.exchangeManager = new ExchangeManager(exchangeConfigs);
        this.arbitrageService = new ArbitrageService(arbitrageConfig);
        this.wsService = new WebSocketService(8080);
    }

    private setupRoutes(): void {
        this.app.use('/api', apiRoutes(this.arbitrageService!, this.exchangeManager!, this.wsService!));

        this.app.get('/ws-status', (_, res) => {
            res.json({
                connected: this.wsService!.getClientCount(),
                port: 8080,
                status: 'running'
            });
        });

        this.app.get('/', (_, res) => {
            res.render('index', {
                title: 'ArbitBot - Crypto Arbitrage Scanner',
                wsPort: 8080,
                apiBase: '/api'
            });
        });

        this.app.use((req, res) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                path: req.originalUrl,
                available_endpoints: [
                    '/',
                    '/health',
                    '/ws-status',
                    '/api/opportunities',
                    '/api/prices',
                    '/api/stats'
                ],
                timestamp: Date.now()
            });
        });
    }

    private connectServices(): void {
        const exchangeServices = this.exchangeManager!.getAllExchangeServices();

        exchangeServices.forEach((service, exchangeName) => {
            service.on('priceUpdate', (priceData) => {
                this.arbitrageService!.handlePriceUpdate(priceData);
            });

            service.on('maxReconnectAttemptsReached', (exchangeName) => {
                console.error(`❌ Exchange ${exchangeName} failed to reconnect after maximum attempts`);
                this.wsService!.broadcast('exchange_disconnected', {
                    exchange: exchangeName,
                    timestamp: Date.now()
                });
            });

            console.log(`🔗 Connected price updates for ${exchangeName}`);
        });

        this.arbitrageService!.on('opportunityFound', (opportunity) => {
            this.wsService!.broadcast('arbitrage_opportunity', opportunity);
            console.log(`💰 New opportunity: ${opportunity.symbol} - ${opportunity.profitPercent}%`);
        });
    }

    public async start(): Promise<void> {
        try {
            this
                .exchangeManager!
                .createWebSockets(['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'ADA/USDT', 'AVAX/USDT']);

            this.app.listen(this.port, () => {
                console.log(`🚀 Server running on port ${this.port}`);
                console.log(`📊 Dashboard: http://localhost:${this.port}`);
            });
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }

    private setupGracefulShutdown(): void {
        const shutdown = async (signal: string) => {
            console.log(`\n📴 Received ${signal}, starting graceful shutdown...`);

            try {
                if (this.exchangeManager) {
                    await this.exchangeManager.cleanup();
                }

                if (this.wsService) {
                    this.wsService.close();
                }

                console.log('✅ Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                console.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught Exception:', error);
            shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
            shutdown('unhandledRejection');
        });
    }
}

const server = new ArbitBotServer();
server.start();
