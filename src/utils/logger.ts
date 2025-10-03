import pino from 'pino';
import {createStream } from 'rotating-file-stream';

const isProduction = process.env.NODE_ENV === 'production';

const fileStream = isProduction
    ? createStream('logs/app.log', {
        size: '10M',
        interval: '1d',
        compress: 'gzip',
        maxFiles: 7,
    })
    : undefined;

const logger = pino(
    {
        level: process.env.LOG_LEVEL || 'info',

        timestamp: pino.stdTimeFunctions.isoTime,

        serializers: {
            error: pino.stdSerializers.err,
            req: pino.stdSerializers.req,
            res: pino.stdSerializers.res,
        },
    },

    isProduction
        ? fileStream!
        : pino.transport({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname',
                singleLine: false,
            },
        })
);

export default logger;

export const createChildLogger = (component: string) => {
    return logger.child({ component });
};
