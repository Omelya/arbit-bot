import { Router, Request, Response } from 'express';
import { ArbitrageService } from '../services/ArbitrageService';
import { ApiResponse } from '../types';
import {ExchangeManager} from "../services/exchanges/ExchangeManager";
import {WebSocketService} from "../services/WebSocketService";
import {TriangularBybitService} from "../services/TriangularBybitService";
import {createChildLogger} from "../utils/logger";
import {AutoTradingService} from "../services/trading/AutoTradingService";

const logger = createChildLogger(__filename);

export function apiRoutes(
    arbitrageService: ArbitrageService,
    exchangeManager: ExchangeManager,
    triangularService: TriangularBybitService,
    wsService: WebSocketService,
    autoTradingService: AutoTradingService,
): Router {
    const router = Router();

    router.use((_, __, next) => {
        next();
    });

    const sendResponse = <T>(
        res: Response,
        data: T,
        success: boolean = true,
        error?: string,
    ): void => {
        const response: ApiResponse<T> = {
            success,
            data: success ? data : undefined,
            error: error || undefined,
            timestamp: Date.now()
        };
        res.json(response);
    };

    router.get('/opportunities', (req: Request, res: Response) => {
        try {
            const opportunities = arbitrageService.getOpportunities();
            const limit = parseInt(req.query.limit as string) || 50;
            const minProfit = parseFloat(req.query.minProfit as string) || 0;

            const filtered = opportunities
                .filter(opp => opp.profitPercent >= minProfit)
                .slice(0, limit);

            sendResponse(res, {
                opportunities: filtered,
                total: opportunities.length,
                filtered: filtered.length
            });
        } catch (error) {
            logger.error({
                msg: 'Error fetching opportunities:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch opportunities');
        }
    });

    router.get('/opportunities/:id', (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const opportunity = arbitrageService.getOpportunity(id);

            if (!opportunity) {
                return sendResponse(res, null, false, 'Opportunity not found');
            }

            sendResponse(res, opportunity);
        } catch (error) {
            logger.error({
                msg: 'Error fetching opportunity:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch opportunity');
        }
    });

    router.get('/opportunities/top/:count', (req: Request, res: Response) => {
        try {
            const count = parseInt(req.params.count) || 10;
            const opportunities = arbitrageService.getOpportunities().slice(0, count);

            sendResponse(res, opportunities);
        } catch (error) {
            logger.error({
                msg: 'Error fetching top opportunities:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch top opportunities');
        }
    });

    router.get('/prices', (req: Request, res: Response) => {
        try {
            const symbol = req.query.symbol as string;
            const exchange = req.query.exchange as string;

            let prices = arbitrageService.getAllPrices();

            if (symbol) {
                prices = prices.filter(p => p.symbol === symbol);
            }

            if (exchange) {
                prices = prices.filter(p => p.exchange === exchange);
            }

            sendResponse(res, {
                prices,
                count: prices.length,
                lastUpdate: prices.length > 0 ? Math.max(...prices.map(p => p.timestamp)) : null
            });
        } catch (error) {
            logger.error({
                msg: 'Error fetching prices:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch prices');
        }
    });

    router.get('/prices/:exchange/:symbol', (req: Request, res: Response) => {
        try {
            const { exchange, symbol } = req.params;
            const price = arbitrageService.getPrice(exchange, symbol);

            if (!price) {
                return sendResponse(res, null, false, 'Price not found');
            }

            sendResponse(res, price);
        } catch (error) {
            logger.error({
                msg: 'Error fetching price:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch price');
        }
    });

    router.get('/orderbook', (req: Request, res: Response) => {
        try {
            const symbol = req.query.symbol as string;
            const exchange = req.query.exchange as string;

            let orderBooks = arbitrageService.getAllOrderBooks();

            if (symbol) {
                orderBooks = orderBooks.filter(p => p.symbol === symbol);
            }

            if (exchange) {
                orderBooks = orderBooks.filter(p => p.exchange === exchange);
            }

            sendResponse(res, {
                orderBooks,
                count: orderBooks.length,
                lastUpdate: orderBooks.length > 0 ? Math.max(...orderBooks.map(p => p.timestamp)) : null
            });
        } catch (error) {
            logger.error({
                msg: 'Error fetching prices:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch prices');
        }
    });

    router.get('/orderbook/:exchange/:symbol', async (req: Request, res: Response) => {
        try {
            const { exchange, symbol } = req.params;
            const orderbook = await exchangeManager.fetchOrderBook(exchange, symbol);

            if (!orderbook) {
                return sendResponse(res, null, false, 'Orderbook not available');
            }

            sendResponse(res, orderbook);
        } catch (error) {
            logger.error({
                msg: 'Error fetching orderbook:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch orderbook');
        }
    });

    router.get('/stats', (_, res: Response) => {
        try {
            const opportunities = arbitrageService.getOpportunities();
            const prices = arbitrageService.getAllPrices();

            const stats = {
                opportunities: {
                    total: opportunities.length,
                    profitable: opportunities.filter(o => o.profitPercent > 0.5).length,
                    highProfit: opportunities.filter(o => o.profitPercent > 2).length,
                    avgProfit: opportunities.length > 0
                        ? opportunities.reduce((sum, o) => sum + o.profitPercent, 0) / opportunities.length
                        : 0
                },
                prices: {
                    total: prices.length,
                    exchanges: [...new Set(prices.map(p => p.exchange))],
                    symbols: [...new Set(prices.map(p => p.symbol))],
                    lastUpdate: prices.length > 0 ? Math.max(...prices.map(p => p.timestamp)) : null
                },
                uptime: process.uptime(),
                memory: process.memoryUsage()
            };

            sendResponse(res, stats);
        } catch (error) {
            logger.error({
                msg: 'Error fetching stats:',
                error,
            });

            sendResponse(res, null, false, 'Failed to fetch stats');
        }
    });

    router.get('/health', (_, res: Response) => {
        const statuses: Record<string, { connected: boolean; name: string }> = {};
        const services = exchangeManager.getAllExchangeServices();

        services.forEach((service, name) => {
            statuses[name] = {
                connected: service.getConnectionStatus(),
                name
            };
        });

        const allExchangesConnected = Object.values(statuses).every(status => status.connected);

        const health = {
            status: allExchangesConnected ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            exchanges: statuses,
            websocket: {
                connected: wsService.getClientCount(),
                port: 8080
            }
        };

        sendResponse(res, health);
    });

    router.get('/config', (_, res: Response) => {
        try {
            const config = {
                minProfitPercent: 0.5,
                enabledExchanges: ['binance', 'coinbase', 'kraken'],
                symbols: ['BTC/USDT', 'ETH/USDT', 'ADA/USDT'],
                updateInterval: 1000
            };

            sendResponse(res, config);
        } catch (error) {
            sendResponse(res, null, false, 'Failed to fetch config');
        }
    });

    router.get('/triangular/opportunities', (_, res) => {
        const opportunities = triangularService!.getOpportunities();
        res.json({
            success: true,
            data: {
                opportunities,
                count: opportunities.length
            },
            timestamp: Date.now()
        });
    });

    router.get('/triangular/stats', (_, res) => {
        const stats = triangularService!.getStats();
        res.json({
            success: true,
            data: stats,
            timestamp: Date.now()
        });
    });

    router.get('/triangular/opportunities/:id', (req, res) => {
        const opportunity = triangularService!.getOpportunity(req.params.id);

        if (!opportunity) {
            return res.status(404).json({
                success: false,
                error: 'Opportunity not found',
                timestamp: Date.now()
            });
        }

        res.json({
            success: true,
            data: opportunity,
            timestamp: Date.now()
        });
    });

    router.post('/trading/enable', (_, res) => {
        autoTradingService!.enableTrading();
        res.json({ success: true, message: 'Trading enabled' });
    });

    router.post('/trading/disable', (_, res) => {
        autoTradingService!.disableTrading();
        res.json({ success: true, message: 'Trading disabled' });
    });

    router.post('/trading/cross-exchange/enable', (_, res) => {
        autoTradingService!.enableCrossExchange();
        res.json({ success: true, message: 'Trading enabled' });
    });

    router.post('/trading/cross-exchange/disable', (_, res) => {
        autoTradingService!.disableCrossExchange();
        res.json({ success: true, message: 'Trading disabled' });
    });

    router.post('/trading/triangular/enable', (_, res) => {
        autoTradingService!.enableTriangular();
        res.json({ success: true, message: 'Trading enabled' });
    });

    router.post('/trading/triangular/disable', (_, res) => {
        autoTradingService!.disableTriangular();
        res.json({ success: true, message: 'Trading disabled' });
    });

    router.get('/trading/stats', (_, res) => {
        const stats = autoTradingService!.getStats();
        res.json({ success: true, data: stats });
    });

    router.use((error: Error, _: Request, res: Response, __: any) => {
        logger.error({
            msg: 'API Error:',
            error,
        });

        sendResponse(res, null, false, 'Internal server error');
    });

    return router;
}
