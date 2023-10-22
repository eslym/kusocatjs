export interface ErrorHandlerInterface {
    render(error: Error): Promise<Response> | Response;
}

const defaultMessages = new Map<number, string>([
    [100, 'Continue'],
    [101, 'Switching Protocols'],
    [102, 'Processing'],
    [103, 'Early Hints'],
    [200, 'OK'],
    [201, 'Created'],
    [202, 'Accepted'],
    [203, 'Non-Authoritative Information'],
    [204, 'No Content'],
    [205, 'Reset Content'],
    [206, 'Partial Content'],
    [207, 'Multi-Status'],
    [208, 'Already Reported'],
    [226, 'IM Used'],
    [300, 'Multiple Choices'],
    [301, 'Moved Permanently'],
    [302, 'Found'],
    [303, 'See Other'],
    [304, 'Not Modified'],
    [305, 'Use Proxy'],
    [306, 'Switch Proxy'],
    [307, 'Temporary Redirect'],
    [308, 'Permanent Redirect'],
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [405, 'Method Not Allowed'],
    [406, 'Not Acceptable'],
    [407, 'Proxy Authentication Required'],
    [408, 'Request Timeout'],
    [409, 'Conflict'],
    [410, 'Gone'],
    [411, 'Length Required'],
    [412, 'Precondition Failed'],
    [413, 'Payload Too Large'],
    [414, 'URI Too Long'],
    [415, 'Unsupported Media Type'],
    [416, 'Range Not Satisfiable'],
    [417, 'Expectation Failed'],
    [418, "I'm a teapot"],
    [421, 'Misdirected Request'],
    [422, 'Unprocessable Entity'],
    [423, 'Locked'],
    [424, 'Failed Dependency'],
    [425, 'Too Early'],
    [426, 'Upgrade Required'],
    [428, 'Precondition Required'],
    [429, 'Too Many Requests'],
    [431, 'Request Header Fields Too Large'],
    [451, 'Unavailable For Legal Reasons'],
    [500, 'Internal Server Error'],
    [501, 'Not Implemented'],
    [502, 'Bad Gateway'],
    [503, 'Service Unavailable'],
    [504, 'Gateway Timeout'],
]);

export class HTTPError extends Error {
    #status: number;
    #headers?: HeadersInit;

    constructor(status: number, message?: string, headers?: HeadersInit) {
        super(message ?? defaultMessages.get(status) ?? 'Unknown error');
        this.#status = status;
        this.#headers = headers;
    }

    get status() {
        return this.#status;
    }

    get headers() {
        return new Headers(this.#headers);
    }
}

export class RedirectError<
    S extends 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308 = 302,
> extends HTTPError {
    #location: string;

    constructor(location: string, status: S = 302 as S, headers?: HeadersInit) {
        super(status, undefined, headers);
        this.#location = location;
    }

    get location() {
        return this.#location;
    }

    get headers() {
        const headers = super.headers;
        headers.set('Location', this.#location);
        return headers;
    }
}

export class UnauthorizedError extends HTTPError {
    #redirectTo?: string;

    constructor(message?: string, redirectTo?: string) {
        super(401, message);
        this.#redirectTo = redirectTo;
    }

    get redirectTo() {
        return this.#redirectTo;
    }
}

export const defaultErrorHandler = {
    render(error: Error) {
        if (error instanceof HTTPError) {
            const headers = error.headers;
            headers.set('Content-Type', 'text/plain');
            return new Response(error.message, {
                status: error.status,
                headers,
            });
        }
        const content = process.env.NODE_ENV === 'production' ? error.message : error.stack;
        return new Response(content, {
            status: 500,
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    },
};
