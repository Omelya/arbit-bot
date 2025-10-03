import { config } from 'dotenv';

config();

export const ProfitConfig = {
    maxInvestment: parseFloat(process.env.MAX_INVESTMENT ?? '1000'),
    minConfidence: parseFloat(process.env.MIN_CONFIDENCE ?? '70'),
};
