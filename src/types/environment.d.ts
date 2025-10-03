declare global {
    namespace NodeJS {
        interface ProcessEnv {
            ENABLED_EXCHANGES: string;
            MAX_INVESTMENT: number;
            MIN_PROFIT_PERCENT: number;
            API_PORT: string;
            WEBSOCKET_PORT: string;
        }
    }
}

export {};
