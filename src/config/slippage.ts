import { config } from 'dotenv';

config();

export const SlippageConfig = {
    crossExchange: {
        max: parseFloat(process.env.MAX_CROSS_SLIPPAGE_PERCENT ?? '1.0'),
        byLiquidity: {
            high: parseFloat(process.env.SLIPPAGE_BY_LIQUIDITY_HIGH ?? '0.3'),    // >$10k liquidity
            medium: parseFloat(process.env.SLIPPAGE_BY_LIQUIDITY_MEDIUM ?? '0.6'),  // $1k-$10k
            low: parseFloat(process.env.SLIPPAGE_BY_LIQUIDITY_LOW ?? '1.0')      // <$1k
        }
    },

    triangular: {
        maxTotal: parseFloat(process.env.MAX_TRIANGULAR_SLIPPAGE_PERCENT ?? '1.0'),
        maxPerTrade: parseFloat(process.env.MAX_SLIPPAGE_PER_TRADE ?? '0.4'),
    },

    minNetProfit: {
        crossExchange: parseFloat(process.env.CROSS_MIN_NET_PROFIT ?? '0.3'),
        triangular: parseFloat(process.env.TRIANGULAR_MIN_NET_PROFIT ?? '0.5'),
    },
};
