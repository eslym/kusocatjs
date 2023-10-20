export interface LoggingInterface {
    debug(namespace: string, ...args: any[]): void;
    info(namespace: string, ...args: any[]): void;
    warn(namespace: string, ...args: any[]): void;
    error(namespace: string, ...args: any[]): void;
}

export const defaultLogging: LoggingInterface = {
    debug: (_: string, ...args: any[]) => {
        console.debug(...args);
    },
    info: (_: string, ...args: any[]) => {
        console.info(...args);
    },
    warn: (_: string, ...args: any[]) => {
        console.warn(...args);
    },
    error: (_: string, ...args: any[]) => {
        console.error(...args);
    },
};
