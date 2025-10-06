import { config } from 'dotenv';

config();

const generateExchangeConfig = (supportedExchanges: Set<string>): { name: string, sandbox: boolean, triangular: boolean, cross: boolean }[] => {
    const sandbox = process.env.TEST_MODE === 'true';
    const enabledCrossExchanges = process.env.CROSS_ENABLED_EXCHANGES ?? 'binance';
    const enabledTriangularExchanges = process.env.TRIANGULAR_ENABLED_EXCHANGES ?? 'bybit';

    const crossSetExchange = new Set(enabledCrossExchanges.split(','));
    const triangularSetExchange = new Set(enabledTriangularExchanges.split(','));

    let enabledExchanges: { name: string, sandbox: boolean, triangular: boolean, cross: boolean }[] = [];

    supportedExchanges.forEach(item => {
        if (crossSetExchange.has(item) || triangularSetExchange.has(item)) {
            enabledExchanges.push({
                name: item,
                sandbox,
                triangular: triangularSetExchange.has(item),
                cross: crossSetExchange.has(item),
            });
        }
    });

    return enabledExchanges;
};

const SupportedExchanges = new Set([
    'binance',
    'coinbase',
    'kraken',
    'okx',
    'bybit',
]);

export const ExchangeConfig = {
    testMode: process.env.TEST_MODE === 'true',
    supportedExchange: SupportedExchanges,
    exchanges: generateExchangeConfig(SupportedExchanges),
};
