require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ============================================================
// PATH CONFIGURATION
// ============================================================

// Because this file is now inside /api,
// the actual project root is one level above.
const rootDir = path.join(__dirname, '..');

const assetsDir = path.join(rootDir, 'assets');
const cssDir = path.join(rootDir, 'css');
const jsDir = path.join(rootDir, 'js');

const htmlFile = (fileName) => path.join(rootDir, fileName);

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString('hex');

const CONTACT_FORM_URL = process.env.CONTACT_FORM_URL;

// ============================================================
// EXPRESS APP
// ============================================================

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ============================================================
// AUTHENTICATION
// ============================================================
//
// Vercel is serverless, so express-session's default
// in-memory session store is not suitable.
//
// Instead, we create a signed authentication cookie.
// ============================================================

const AUTH_COOKIE_NAME = 'epicade_auth';
const AUTH_DURATION = 30 * 60 * 1000; // 30 minutes

function createAuthToken() {
    const timestamp = Date.now().toString();

    const signature = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(timestamp)
        .digest('hex');

    return `${timestamp}.${signature}`;
}

function verifyAuthToken(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }

    const parts = token.split('.');

    if (parts.length !== 2) {
        return false;
    }

    const [timestamp, signature] = parts;

    if (!/^\d+$/.test(timestamp)) {
        return false;
    }

    const tokenTime = Number(timestamp);

    if (Date.now() - tokenTime > AUTH_DURATION) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(timestamp)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch {
        return false;
    }
}

function parseCookies(req) {
    const cookies = {};

    const header = req.headers.cookie;

    if (!header) {
        return cookies;
    }

    header.split(';').forEach(cookie => {
        const separatorIndex = cookie.indexOf('=');

        if (separatorIndex === -1) {
            return;
        }

        const key = cookie
            .slice(0, separatorIndex)
            .trim();

        const value = cookie
            .slice(separatorIndex + 1)
            .trim();

        cookies[key] = decodeURIComponent(value);
    });

    return cookies;
}

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
    const cookies = parseCookies(req);

    if (verifyAuthToken(cookies[AUTH_COOKIE_NAME])) {
        return next();
    }

    return res.redirect('/login');
};

// ============================================================
// HTML HELPER
// ============================================================

const sendHtml = (fileName) => (req, res) => {
    const filePath = htmlFile(fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send(`
            <h1>404 - Page Not Found</h1>
            <p>${fileName} could not be found.</p>
        `);
    }

    res.sendFile(filePath);
};

// ============================================================
// MULTER CONFIGURATION
// ============================================================

const imageFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg',
        'image/pjpeg',
        'image/jpg'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        return cb(null, true);
    }

    cb(new Error('Only JPEG images are allowed.'));
};

// ============================================================
// LOCAL STORAGE
// ============================================================
//
// This works locally.
//
// On Vercel, runtime filesystem storage is NOT persistent.
// Vercel Blob should be used there.
// ============================================================

const uploadDir = path.join(
    assetsDir,
    'images',
    'ourwork'
);

// Create local upload directory when running locally
if (!process.env.VERCEL) {
    try {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
    } catch (error) {
        console.error(
            'Could not create upload directory:',
            error
        );
    }
}

// Memory storage allows us to upload to Vercel Blob
// without writing to the server filesystem.
const memoryStorage = multer.memoryStorage();

const upload = multer({
    storage: memoryStorage,

    fileFilter: imageFilter,

    limits: {
        fileSize: 15 * 1024 * 1024
    }
});

// For contact form fields
const formParser = multer();

// ============================================================
// LOGIN
// ============================================================

app.get('/login', sendHtml('login.html'));

app.get('/login.html', (req, res) => {
    res.redirect('/login');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (
        username === ADMIN_USERNAME &&
        password === ADMIN_PASSWORD
    ) {
        const token = createAuthToken();

        res.setHeader(
            'Set-Cookie',
            `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=1800; Path=/; HttpOnly; SameSite=Lax${process.env.VERCEL ? '; Secure' : ''}`
        );

        return res.redirect('/admin');
    }

    return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Login Failed</title>
        </head>
        <body>
            <h1>Invalid Credentials</h1>
            <p>
                Please
                <a href="/login">try again</a>.
            </p>
        </body>
        </html>
    `);
});

// ============================================================
// ADMIN
// ============================================================

app.get(
    '/admin',
    isAuthenticated,
    sendHtml('admin.html')
);

app.get(
    '/admin.html',
    isAuthenticated,
    (req, res) => {
        res.redirect('/admin');
    }
);

// ============================================================
// PORTFOLIO IMAGE UPLOAD
// ============================================================
//
// IMPORTANT:
//
// For Vercel, install:
//
// npm install @vercel/blob
//
// Then add:
//
// BLOB_READ_WRITE_TOKEN
//
// to your Vercel Environment Variables.
//
// ============================================================

const uploadFields = Array.from(
    { length: 9 },
    (_, i) => ({
        name: `image${i + 1}`,
        maxCount: 1
    })
);

app.post(
    '/upload-portfolio',
    isAuthenticated,
    upload.fields(uploadFields),
    async (req, res) => {

        try {
            const files = req.files || {};

            const uploadedFiles = [];

            // ------------------------------------------------
            // VERCEL BLOB
            // ------------------------------------------------

            if (process.env.VERCEL) {

                let blob;

                try {
                    blob = require('@vercel/blob');
                } catch (error) {
                    console.error(
                        '@vercel/blob is not installed.'
                    );

                    return res.status(500).send(`
                        <h1>Upload Configuration Error</h1>
                        <p>
                            Vercel Blob is not installed.
                        </p>
                        <p>
                            Run:
                        </p>
                        <pre>npm install @vercel/blob</pre>
                    `);
                }

                for (const fieldName of Object.keys(files)) {

                    const file = files[fieldName][0];

                    const imageNumber =
                        fieldName.replace('image', '');

                    const fileName =
                        `images/ourwork/${imageNumber}.jpg`;

                    const result = await blob.put(
                        fileName,
                        file.buffer,
                        {
                            access: 'public',
                            addRandomSuffix: false,
                            contentType: 'image/jpeg'
                        }
                    );

                    uploadedFiles.push({
                        fieldName,
                        url: result.url
                    });
                }

            }

            // ------------------------------------------------
            // LOCAL DEVELOPMENT
            // ------------------------------------------------

            else {

                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(
                        uploadDir,
                        {
                            recursive: true
                        }
                    );
                }

                for (const fieldName of Object.keys(files)) {

                    const file = files[fieldName][0];

                    const imageNumber =
                        fieldName.replace('image', '');

                    const filePath = path.join(
                        uploadDir,
                        `${imageNumber}.jpg`
                    );

                    fs.writeFileSync(
                        filePath,
                        file.buffer
                    );

                    uploadedFiles.push({
                        fieldName,
                        url:
                            `/assets/images/ourwork/${imageNumber}.jpg`
                    });
                }
            }

            console.log(
                'Portfolio images uploaded:',
                uploadedFiles
            );

            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Upload Successful</title>
                </head>
                <body>

                    <h1>Upload Successful!</h1>

                    <p>
                        Your portfolio images have been
                        uploaded successfully.
                    </p>

                    <p>
                        <a href="/admin">
                            Go back to Admin
                        </a>
                    </p>

                    <p>
                        <a href="/portfolio"
                           target="_blank">
                            View Portfolio
                        </a>
                    </p>

                </body>
                </html>
            `);

        } catch (error) {

            console.error(
                'Portfolio upload error:',
                error
            );

            return res.status(500).send(`
                <h1>Upload Failed</h1>
                <p>
                    ${error.message || 'Unknown error'}
                </p>
                <p>
                    <a href="/admin">
                        Go back
                    </a>
                </p>
            `);
        }
    }
);

// ============================================================
// LOGOUT
// ============================================================

app.get('/logout', (req, res) => {

    res.setHeader(
        'Set-Cookie',
        `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.VERCEL ? '; Secure' : ''}`
    );

    res.redirect('/login');
});

// ============================================================
// CONTACT FORM
// ============================================================

app.post(
    '/submit-contact',
    formParser.none(),
    async (req, res) => {

        if (!CONTACT_FORM_URL) {

            console.error(
                'CONTACT_FORM_URL is not configured.'
            );

            return res.status(500).json({
                message:
                    'Server configuration error.'
            });
        }

        try {

            const response = await fetch(
                CONTACT_FORM_URL,
                {
                    method: 'POST',

                    body: new URLSearchParams(
                        req.body
                    )
                }
            );

            if (!response.ok) {

                const responseText =
                    await response
                        .text()
                        .catch(() => '');

                console.error(
                    'Google Script returned an error:',
                    response.status,
                    responseText
                );

                return res.status(502).json({
                    message:
                        'Failed to send message.'
                });
            }

            return res.status(200).json({
                message:
                    'Message sent successfully!'
            });

        } catch (error) {

            console.error(
                'Error submitting to Google Script:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to send message.'
            });
        }
    }
);

// ============================================================
// STATIC FILES
// ============================================================

app.get(
    '/',
    sendHtml('index.html')
);

app.get(
    '/index.html',
    (req, res) => {
        res.redirect('/');
    }
);

app.get(
    '/services',
    sendHtml('services.html')
);

app.get(
    '/services.html',
    (req, res) => {
        res.redirect('/services');
    }
);

app.get(
    '/portfolio',
    sendHtml('portfolio.html')
);

app.get(
    '/portfolio.html',
    (req, res) => {
        res.redirect('/portfolio');
    }
);

app.get(
    '/contact',
    sendHtml('contact.html')
);

app.get(
    '/contact.html',
    (req, res) => {
        res.redirect('/contact');
    }
);

app.get(
    '/robots.txt',
    sendHtml('robots.txt')
);

app.get(
    '/sitemap.xml',
    sendHtml('sitemap.xml')
);

// Static directories
app.use(
    '/assets',
    express.static(assetsDir)
);

app.use(
    '/css',
    express.static(cssDir)
);

app.use(
    '/js',
    express.static(jsDir)
);

// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {

    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>404 - Not Found</title>
        </head>
        <body>

            <h1>404 - Page Not Found</h1>

            <p>
                The requested page does not exist.
            </p>

            <p>
                <a href="/">
                    Return to homepage
                </a>
            </p>

        </body>
        </html>
    `);
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {

    console.error(
        'Unhandled server error:',
        err
    );

    if (
        err &&
        err.message ===
            'Only JPEG images are allowed.'
    ) {

        return res.status(400).send(`
            <h1>Upload Failed</h1>

            <p>
                Please upload JPEG images only.
            </p>

            <p>
                <a href="/admin">
                    Go back
                </a>
            </p>
        `);
    }

    if (
        err &&
        err.code === 'LIMIT_FILE_SIZE'
    ) {

        return res.status(400).send(`
            <h1>Upload Failed</h1>

            <p>
                Each image must be
                15MB or smaller.
            </p>

            <p>
                <a href="/admin">
                    Go back
                </a>
            </p>
        `);
    }

    return res.status(500).send(`
        <h1>Server Error</h1>

        <p>
            Please try again later.
        </p>
    `);
});

// ============================================================
// VERCEL EXPORT
// ============================================================

module.exports = app;