import express, { Express } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from 'dotenv';
import { createChildLogger } from './utils/logger';

import { ArbitrageService } from './services/ArbitrageService';
import { WebSocketService } from './services/WebSocketService';
import { apiRoutes } from './routes/api';
import { ExchangeConfig, ArbitrageConfig } from './types';
import { ExchangeManager } from './services/exchanges/ExchangeManager';
import { TriangularBybitService } from './services/TriangularBybitService';

config();

const serverLogger = createChildLogger(__filename);

class ArbitBotServer {
    private app: Express;
    private readonly port: number;
    private exchangeManager?: ExchangeManager;
    private arbitrageService?: ArbitrageService;
    private triangularService?: TriangularBybitService;
    private wsService?: WebSocketService;

    constructor() {
        this.app = express();
        this.port = parseInt(process.env.API_PORT || '3000');

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

        const exchanges = process.env.ENABLED_EXCHANGES
            ? process.env.ENABLED_EXCHANGES.split(',')
            : [];

        const arbitrageConfig: ArbitrageConfig = {
            minProfitPercent: Number(process.env.MIN_PROFIT_PERCENT),
            maxInvestment: Number(process.env.MAX_INVESTMENT),
            enabledExchanges: exchanges,
            symbols: ['BTC/USDT', 'ETH/USDT', 'ADA/USDT']
        };

        this.exchangeManager = new ExchangeManager(exchangeConfigs);
        this.arbitrageService = new ArbitrageService(arbitrageConfig);
        this.triangularService = new TriangularBybitService();
        this.wsService = new WebSocketService(Number(process.env.WEBSOCKET_PORT));
    }

    private setupRoutes(): void {
        this.app.use(
            '/api',
            apiRoutes(
                this.arbitrageService!,
                this.exchangeManager!,
                this.triangularService!,
                this.wsService!,
            ),
        );

        this.app.get('/ws-status', (_, res) => {
            res.json({
                connected: this.wsService!.getClientCount(),
                port: process.env.WEBSOCKET_PORT,
                status: 'running'
            });
        });

        this.app.get('/', (_, res) => {
            res.render('index', {
                title: 'ArbitBot - Crypto Arbitrage Scanner',
                wsPort: process.env.WEBSOCKET_PORT,
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
                    '/api/stats',
                    '/api/orderbook',
                    '/api/triangular/opportunities',
                    '/api/triangular/stats',
                ],
                timestamp: Date.now()
            });
        });
    }

    private connectServices(): void {
        const exchangeServices = this.exchangeManager!.getAllExchangeServices();

        exchangeServices.forEach((service, exchangeName) => {
            service.on('priceUpdate', (item) => {
                this.arbitrageService!.handlePriceUpdate(item);

                if (exchangeName === 'bybit') {
                    this.triangularService!.handlePriceUpdate(item);
                }
            });

            service.on('orderBookUpdate', (item) => {
                this.arbitrageService!.handleOrderBookUpdate(item);

                if (exchangeName === 'bybit') {
                    this.triangularService!.handleOrderBookUpdate(item);
                }
            });

            service.on('orderBookInvalidate', (item) => {
                this.arbitrageService!.handleOrderBookInvalidated(item);
            })

            service.on('maxReconnectAttemptsReached', (exchangeName) => {
                serverLogger.error(`❌ Exchange ${exchangeName} failed to reconnect after maximum attempts`);

                this.wsService!.broadcast('exchange_disconnected', {
                    exchange: exchangeName,
                    timestamp: Date.now()
                });
            });
        });

        this.arbitrageService!.on('opportunityFound', (opportunity) => {
            this.wsService!.broadcast('arbitrage_opportunity', opportunity);
        });
    }

    public async start(): Promise<void> {
        try {
            this
                .exchangeManager!
                .createWebSockets([
                    'BTC/USDT',
                    'ETH/USDT',
                    'SOL/USDT',
                    'ADA/USDT',
                    'AVAX/USDT',
                    'ETH/BTC',
                    'SOL/BTC',
                    'XRP/USDT',
                    'XRP/BTC',
                    'LTC/USDT',
                    'LTC/BTC',
                ]);

            this.app.listen(this.port, () => {
                serverLogger.info(`🚀 Server running http://localhost:${this.port}`);
            });
        } catch (error) {
            serverLogger.error({
                msg: '❌ Failed to start server',
                error
            });

            process.exit(1);
        }
    }

    private setupGracefulShutdown(): void {
        const shutdown = async (signal: string) => {
            serverLogger.info(`\n📴 Received ${signal}, starting graceful shutdown...`);

            try {
                if (this.exchangeManager) {
                    await this.exchangeManager.cleanup();
                }

                if (this.wsService) {
                    this.wsService.close();
                }

                serverLogger.info('✅ Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                serverLogger.error({
                    msg: '❌ Error during shutdown',
                    error,
                });

                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        process.on('uncaughtException', (error) => {
            serverLogger.error({
                msg: '❌ Uncaught Exception',
                error,
            });

            shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            serverLogger.error({
                msg: '❌ Unhandled Rejection at',
                error: reason,
                promise
            });

            shutdown('unhandledRejection');
        });
    }
}

const server = new ArbitBotServer();
server.start();
