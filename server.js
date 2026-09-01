require('dotenv').config();

const app = require('./api/index');

const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
    console.log(`Epicade server listening on http://localhost:${port}`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use.`);
    } else {
        console.error('Server failed to start:', error);
    }

    process.exitCode = 1;
});
