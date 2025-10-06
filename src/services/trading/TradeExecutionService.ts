import { EventEmitter } from 'events';
import { Exchange, Order } from 'ccxt';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger(__filename);

export interface OrderRequest {
    exchange: string;
    symbol: string;
    side: 'buy' | 'sell';
    amount: number;
    price?: number; // undefined = market order
    type: 'market' | 'limit';
}

export interface ExecutedOrder {
    id: string;
    exchange: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    amount: number;
    filled: number;
    remaining: number;
    price?: number;
    average?: number;
    cost: number;
    fee: {
        cost: number;
        currency: string;
    };
    status: 'open' | 'closed' | 'canceled' | 'expired' | 'rejected';
    timestamp: number;
    trades: any[];
}

export class TradeExecutionService extends EventEmitter {
    private pendingOrders: Map<string, ExecutedOrder> = new Map();
    private completedOrders: Map<string, ExecutedOrder> = new Map();

    constructor(private exchanges: Map<string, Exchange>) {
        super();
    }

    public async executeOrder(request: OrderRequest): Promise<ExecutedOrder> {
        const exchange = this.exchanges.get(request.exchange);
        if (!exchange) {
            throw new Error(`Exchange ${request.exchange} not found`);
        }

        logger.info({
            msg: '📤 Executing order',
            exchange: request.exchange,
            symbol: request.symbol,
            side: request.side,
            type: request.type,
            amount: request.amount,
            price: request.price
        });

        try {
            let order: Order;

            if (request.type === 'market') {
                order = await exchange.createMarketOrder(
                    request.symbol,
                    request.side,
                    request.amount
                );
            } else {
                if (!request.price) {
                    throw new Error('Price is required for limit orders');
                }

                order = await exchange.createLimitOrder(
                    request.symbol,
                    request.side,
                    request.amount,
                    request.price
                );
            }

            const executedOrder = this.normalizeOrder(request.exchange, order);

            this.pendingOrders.set(executedOrder.id, executedOrder);

            this.emit('orderCreated', executedOrder);

            // Для market orders відразу перевіряємо статус
            if (request.type === 'market') {
                await this.checkOrderStatus(request.exchange, executedOrder.id);
            }

            return executedOrder;
        } catch (error: any) {
            logger.error({
                msg: '❌ Failed to execute order',
                exchange: request.exchange,
                symbol: request.symbol,
                error: error.message
            });

            this.emit('orderFailed', {
                request,
                error: error.message
            });

            throw error;
        }
    }

    public async executeOrders(requests: OrderRequest[]): Promise<ExecutedOrder[]> {
        const promises = requests.map(req => this.executeOrder(req));

        try {
            return await Promise.all(promises);
        } catch (error) {
            // Якщо хоча б один ордер failed, треба скасувати всі
            logger.error({
                msg: '❌ Failed to execute all orders, attempting rollback',
                error
            });

            await this.cancelPendingOrders(requests.map(r => r.exchange));
            throw error;
        }
    }

    public async checkOrderStatus(
        exchange: string,
        orderId: string
    ): Promise<ExecutedOrder> {
        const exchangeInstance = this.exchanges.get(exchange);
        if (!exchangeInstance) {
            throw new Error(`Exchange ${exchange} not found`);
        }

        const pendingOrder = this.pendingOrders.get(orderId);
        if (!pendingOrder) {
            throw new Error(`Order ${orderId} not found in pending orders`);
        }

        try {
            const order = await exchangeInstance.fetchOrder(
                orderId,
                pendingOrder.symbol
            );

            const executedOrder = this.normalizeOrder(exchange, order);

            if (executedOrder.status === 'closed') {
                this.pendingOrders.delete(orderId);
                this.completedOrders.set(orderId, executedOrder);

                this.emit('orderCompleted', executedOrder);

                logger.info({
                    msg: '✅ Order completed',
                    orderId,
                    exchange,
                    filled: executedOrder.filled,
                    cost: executedOrder.cost
                });
            } else if (executedOrder.status === 'canceled' ||
                executedOrder.status === 'rejected') {
                this.pendingOrders.delete(orderId);

                this.emit('orderCanceled', executedOrder);

                logger.warn({
                    msg: '⚠️ Order canceled/rejected',
                    orderId,
                    exchange,
                    status: executedOrder.status
                });
            }

            return executedOrder;
        } catch (error: any) {
            logger.error({
                msg: '❌ Failed to check order status',
                orderId,
                exchange,
                error: error.message
            });
            throw error;
        }
    }

    public async cancelOrder(exchange: string, orderId: string): Promise<void> {
        const exchangeInstance = this.exchanges.get(exchange);
        if (!exchangeInstance) {
            throw new Error(`Exchange ${exchange} not found`);
        }

        const pendingOrder = this.pendingOrders.get(orderId);
        if (!pendingOrder) {
            logger.warn(`Order ${orderId} not found in pending orders`);
            return;
        }

        try {
            await exchangeInstance.cancelOrder(orderId, pendingOrder.symbol);

            this.pendingOrders.delete(orderId);

            this.emit('orderCanceled', { orderId, exchange });

            logger.info(`🚫 Order ${orderId} canceled on ${exchange}`);
        } catch (error: any) {
            logger.error({
                msg: '❌ Failed to cancel order',
                orderId,
                exchange,
                error: error.message
            });
            throw error;
        }
    }

    private async cancelPendingOrders(exchanges: string[]): Promise<void> {
        const cancelPromises: Promise<void>[] = [];

        for (const [orderId, order] of this.pendingOrders) {
            if (exchanges.includes(order.exchange)) {
                cancelPromises.push(
                    this.cancelOrder(order.exchange, orderId).catch(err => {
                        logger.error({
                            msg: 'Failed to cancel order during rollback',
                            orderId,
                            error: err
                        });
                    })
                );
            }
        }

        await Promise.all(cancelPromises);
    }

    public async waitForOrderCompletion(
        exchange: string,
        orderId: string,
        timeoutMs: number = 30000,
        checkIntervalMs: number = 1000
    ): Promise<ExecutedOrder> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const order = await this.checkOrderStatus(exchange, orderId);

            if (order.status === 'closed') {
                return order;
            }

            if (order.status === 'canceled' || order.status === 'rejected') {
                throw new Error(`Order ${orderId} was ${order.status}`);
            }

            await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
        }

        throw new Error(`Order ${orderId} timeout after ${timeoutMs}ms`);
    }

    private normalizeOrder(exchange: string, order: Order): ExecutedOrder {
        return {
            id: order.id,
            exchange,
            symbol: order.symbol,
            side: order.side as 'buy' | 'sell',
            type: order.type as 'market' | 'limit',
            amount: order.amount,
            filled: order.filled || 0,
            remaining: order.remaining || 0,
            price: order.price,
            average: order.average,
            cost: order.cost || 0,
            fee: {
                cost: order.fee?.cost || 0,
                currency: order.fee?.currency || 'USDT'
            },
            status: order.status as any,
            timestamp: order.timestamp || Date.now(),
            trades: order.trades || []
        };
    }

    public getPendingOrders(): ExecutedOrder[] {
        return Array.from(this.pendingOrders.values());
    }

    public getCompletedOrders(): ExecutedOrder[] {
        return Array.from(this.completedOrders.values());
    }

    public getOrder(orderId: string): ExecutedOrder | null {
        return this.pendingOrders.get(orderId) ||
            this.completedOrders.get(orderId) ||
            null;
    }

    public async cleanup(): Promise<void> {
        // Cancel all pending orders
        const cancelPromises = Array.from(this.pendingOrders.entries()).map(
            ([orderId, order]) =>
                this.cancelOrder(order.exchange, orderId).catch(() => {})
        );

        await Promise.all(cancelPromises);

        this.pendingOrders.clear();
        this.completedOrders.clear();
        this.removeAllListeners();

        logger.info('✅ TradeExecutionService cleaned up');
    }
}
