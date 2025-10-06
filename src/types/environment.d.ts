declare global {
    namespace NodeJS {
        interface ProcessEnv {
            TEST_MODE: string;
            CROSS_ENABLED_EXCHANGES: string;
            TRIANGULAR_ENABLED_EXCHANGES: string;
            MAX_INVESTMENT: string;
            MIN_CONFIDENCE: string;
            MAX_CROSS_SLIPPAGE_PERCENT: string;
            MAX_TRIANGULAR_SLIPPAGE_PERCENT: string;
            MAX_SLIPPAGE_PER_TRADE: string;
            SLIPPAGE_BY_LIQUIDITY_HIGH: string;
            SLIPPAGE_BY_LIQUIDITY_MEDIUM: string;
            SLIPPAGE_BY_LIQUIDITY_LOW: string;
            CROSS_MIN_NET_PROFIT: string;
            TRIANGULAR_MIN_NET_PROFIT: string;
            API_PORT: string;
            WEBSOCKET_PORT: string;
        }
    }
}

export {};
