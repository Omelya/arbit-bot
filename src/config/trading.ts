import { config } from 'dotenv';
import { TradingConfig } from '../types/trading';

config();

export const TradingConfiguration: TradingConfig = {
    enabled: process.env.TRADING_ENABLED === 'true',

    crossExchange: {
        enabled: process.env.CROSS_TRADING_ENABLED === 'true',
        minProfitPercent: parseFloat(process.env.CROSS_MIN_PROFIT ?? '0.5'),
        maxPositionSize: parseFloat(process.env.CROSS_MAX_POSITION_SIZE ?? '100'),
        maxConcurrentTrades: parseInt(process.env.CROSS_MAX_CONCURRENT ?? '3'),
    },

    triangular: {
        enabled: process.env.TRIANGULAR_TRADING_ENABLED === 'true',
        minProfitPercent: parseFloat(process.env.TRIANGULAR_MIN_PROFIT ?? '0.8'),
        maxPositionSize: parseFloat(process.env.TRIANGULAR_MAX_POSITION_SIZE ?? '100'),
        maxConcurrentTrades: parseInt(process.env.TRIANGULAR_MAX_CONCURRENT ?? '2'),
    },

    riskManagement: {
        maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS ?? '50'),
        maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES ?? '100'),
        emergencyStop: false,
        blacklistedSymbols: process.env.BLACKLISTED_SYMBOLS?.split(',') ?? [],
        blacklistedExchanges: process.env.BLACKLISTED_EXCHANGES?.split(',') ?? [],
    },

    execution: {
        orderType: (process.env.ORDER_TYPE ?? 'market') as 'market' | 'limit',
        timeoutMs: parseInt(process.env.ORDER_TIMEOUT_MS ?? '30000'),
        retryAttempts: parseInt(process.env.ORDER_RETRY_ATTEMPTS ?? '3'),
        slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE ?? '0.5'),
    },
};
