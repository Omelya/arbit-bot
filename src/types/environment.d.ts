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
            API_HOST: string;
            API_PORT: string;
            WEBSOCKET_PORT: string;
            BINANCE_API_KEY: string;
            BINANCE_SECRET: string;
            BYBIT_API_KEY: string;
            BYBIT_SECRET: string;
            COINBASE_API_KEY: string;
            COINBASE_SECRET: string;
            COINBASE_PASSPHRASE: string;
            KRAKEN_API_KEY: string;
            KRAKEN_SECRET: string;
            OKX_API_KEY: string;
            OKX_SECRET: string;
            OKX_PASSPHRASE: string;
        }
    }
}

export {};
