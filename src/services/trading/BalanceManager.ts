import { EventEmitter } from 'events';
import { Exchange } from 'ccxt';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger(__filename);

export interface Balance {
    currency: string;
    free: number;
    used: number;
    total: number;
}

export interface ExchangeBalances {
    exchange: string;
    balances: Map<string, Balance>;
    lastUpdate: number;
}

export class BalanceManager extends EventEmitter {
    private balances: Map<string, ExchangeBalances> = new Map();
    private locks: Map<string, Set<string>> = new Map(); // exchange:currency -> Set<tradeId>
    private updateInterval: NodeJS.Timeout | null = null;
    private readonly updateFrequency = 30000; // 30 seconds

    constructor(
        private exchanges: Map<string, Exchange>,
        private minBalanceThreshold: number = 10 // мінімальний баланс в USDT
    ) {
        super();
    }

    public async initialize(): Promise<void> {
        logger.info('🔄 Initializing BalanceManager...');

        await this.fetchAllBalances();

        this.startPeriodicUpdates();

        logger.info('✅ BalanceManager initialized');
    }

    public async fetchAllBalances(): Promise<void> {
        const promises = Array.from(this.exchanges.entries()).map(
            async ([name, exchange]) => {
                try {
                    const balance = await exchange.fetchBalance();
                    this.updateBalanceCache(name, balance);
                } catch (error) {
                    logger.error({
                        msg: `Failed to fetch balance for ${name}`,
                        error
                    });
                }
            }
        );

        await Promise.all(promises);
    }

    public async fetchBalance(exchangeName: string): Promise<void> {
        const exchange = this.exchanges.get(exchangeName);
        if (!exchange) {
            throw new Error(`Exchange ${exchangeName} not found`);
        }

        try {
            const balance = await exchange.fetchBalance();
            this.updateBalanceCache(exchangeName, balance);
        } catch (error) {
            logger.error({
                msg: `Failed to fetch balance for ${exchangeName}`,
                error
            });
            throw error;
        }
    }

    private updateBalanceCache(exchangeName: string, ccxtBalance: any): void {
        const balances = new Map<string, Balance>();

        for (const [currency, data] of Object.entries(ccxtBalance)) {
            if (currency === 'info' || currency === 'free' ||
                currency === 'used' || currency === 'total') {
                continue;
            }

            const balanceData = data as any;

            if (balanceData.total > 0) {
                balances.set(currency, {
                    currency,
                    free: balanceData.free || 0,
                    used: balanceData.used || 0,
                    total: balanceData.total || 0
                });
            }
        }

        this.balances.set(exchangeName, {
            exchange: exchangeName,
            balances,
            lastUpdate: Date.now()
        });

        this.emit('balanceUpdated', exchangeName, balances);
    }

    public getBalance(exchange: string, currency: string): Balance | null {
        const exchangeBalances = this.balances.get(exchange);
        if (!exchangeBalances) return null;

        return exchangeBalances.balances.get(currency) || null;
    }

    public getAllBalances(): Map<string, ExchangeBalances> {
        return this.balances;
    }

    public hasAvailableBalance(
        exchange: string,
        currency: string,
        requiredAmount: number
    ): boolean {
        const balance = this.getBalance(exchange, currency);
        if (!balance) return false;

        const lockKey = this.getLockKey(exchange, currency);
        const locks = this.locks.get(lockKey);

        // Враховуємо locked funds
        const lockedAmount = locks ? locks.size * requiredAmount : 0;
        const availableAmount = balance.free - lockedAmount;

        return availableAmount >= requiredAmount;
    }

    public lockBalance(
        tradeId: string,
        exchange: string,
        currency: string,
        amount: number
    ): boolean {
        if (!this.hasAvailableBalance(exchange, currency, amount)) {
            logger.warn(`Insufficient balance on ${exchange} for ${currency}: need ${amount}`);
            return false;
        }

        const lockKey = this.getLockKey(exchange, currency);

        if (!this.locks.has(lockKey)) {
            this.locks.set(lockKey, new Set());
        }

        this.locks.get(lockKey)!.add(tradeId);

        logger.info(`🔒 Locked ${amount} ${currency} on ${exchange} for trade ${tradeId}`);

        this.emit('balanceLocked', {
            tradeId,
            exchange,
            currency,
            amount
        });

        return true;
    }

    public unlockBalance(
        tradeId: string,
        exchange: string,
        currency: string
    ): void {
        const lockKey = this.getLockKey(exchange, currency);
        const locks = this.locks.get(lockKey);

        if (locks) {
            locks.delete(tradeId);

            if (locks.size === 0) {
                this.locks.delete(lockKey);
            }

            logger.info(`🔓 Unlocked ${currency} on ${exchange} for trade ${tradeId}`);

            this.emit('balanceUnlocked', {
                tradeId,
                exchange,
                currency
            });
        }
    }

    public getAvailableAmount(exchange: string, currency: string): number {
        const balance = this.getBalance(exchange, currency);
        if (!balance) return 0;

        const lockKey = this.getLockKey(exchange, currency);
        const locks = this.locks.get(lockKey);
        const lockedCount = locks ? locks.size : 0;

        // Простий розрахунок - віднімаємо кількість локів
        return Math.max(0, balance.free - (lockedCount * this.minBalanceThreshold));
    }

    public isBalanceSufficient(
        exchange: string,
        currency: string,
        minAmount: number = this.minBalanceThreshold
    ): boolean {
        const available = this.getAvailableAmount(exchange, currency);
        return available >= minAmount;
    }

    private startPeriodicUpdates(): void {
        this.updateInterval = setInterval(async () => {
            try {
                await this.fetchAllBalances();
            } catch (error) {
                logger.error({
                    msg: 'Error in periodic balance update',
                    error
                });
            }
        }, this.updateFrequency);
    }

    public async cleanup(): Promise<void> {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        this.balances.clear();
        this.locks.clear();
        this.removeAllListeners();

        logger.info('✅ BalanceManager cleaned up');
    }

    private getLockKey(exchange: string, currency: string): string {
        return `${exchange}:${currency}`;
    }

    public getLockedBalances(): Map<string, number> {
        const locked = new Map<string, number>();

        for (const [key, locks] of this.locks.entries()) {
            locked.set(key, locks.size);
        }

        return locked;
    }

    public async refreshBalance(exchange: string): Promise<void> {
        await this.fetchBalance(exchange);
    }
}
