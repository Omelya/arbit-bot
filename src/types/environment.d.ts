declare global {
    namespace NodeJS {
        interface ProcessEnv {
            ENABLED_EXCHANGES: string;
            MAX_INVESTMENT: string;
            MIN_PROFIT_PERCENT: string;
            API_PORT: string;
            WEBSOCKET_PORT: string;
        }
    }
}

export {};
