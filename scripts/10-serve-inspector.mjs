import {
    createReadStream,
    statSync
} from 'node:fs';

import {
    createServer
} from 'node:http';

import {
    extname,
    resolve
} from 'node:path';


const PORT =
    8080;


const root =
    resolve(
        'inspector'
    );


const MIME = {

    '.html':
        'text/html; charset=utf-8',

    '.json':
        'application/json; charset=utf-8',

    '.js':
        'text/javascript; charset=utf-8',

    '.css':
        'text/css; charset=utf-8'
};


const server =
    createServer(
        (
            request,
            response
        ) => {

            try {

                const rawPath =
                    request.url
                        ?.split('?')[0]
                        ?? '/';


                const relativePath =
                    rawPath === '/'
                        ? 'index.html'
                        : decodeURIComponent(
                            rawPath.replace(
                                /^\/+/,
                                ''
                            )
                        );


                const filePath =
                    resolve(
                        root,
                        relativePath
                    );


                if (
                    !filePath.startsWith(
                        root
                    )
                ) {

                    response.writeHead(
                        403
                    );

                    response.end(
                        'Forbidden'
                    );

                    return;
                }


                const stats =
                    statSync(
                        filePath
                    );


                if (
                    !stats.isFile()
                ) {

                    throw new Error(
                        'Not a file'
                    );
                }


                const extension =
                    extname(
                        filePath
                    );


                response.writeHead(
                    200,
                    {
                        'Content-Type':
                            MIME[extension]
                            ??
                            'application/octet-stream',

                        'Cache-Control':
                            'no-store'
                    }
                );


                createReadStream(
                    filePath
                ).pipe(
                    response
                );


            } catch {

                response.writeHead(
                    404,
                    {
                        'Content-Type':
                            'text/plain'
                    }
                );


                response.end(
                    'Not found'
                );
            }
        }
    );


server.listen(
    PORT,
    '127.0.0.1',
    () => {

        console.log('');
        console.log(
            '===================================='
        );

        console.log(
            'Deadlock Replay Inspector'
        );

        console.log(
            '===================================='
        );

        console.log('');

        console.log(
            `Open: http://127.0.0.1:${PORT}`
        );

        console.log('');

        console.log(
            'Press Ctrl+C to stop.'
        );

        console.log('');
    }
);