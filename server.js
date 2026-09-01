const app = require('./api/index');

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
    console.log(`Epicade server listening on http://localhost:${port}`);
});
