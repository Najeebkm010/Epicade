const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const assetsDir = path.join(rootDir, 'assets');
const cssDir = path.join(rootDir, 'css');
const jsDir = path.join(rootDir, 'js');
const htmlFile = (fileName) => path.join(rootDir, fileName);
const sessionSecret = process.env.SESSION_SECRET || crypto.createHash('sha256')
    .update(`${process.env.ADMIN_PASSWORD || 'change-me'}:epicedge-admin-session`)
    .digest('hex');
const cloudinaryCloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim().replace(/^@/, '');
const cloudinaryConfigured = Boolean(
    cloudinaryCloudName &&
    process.env.CLOUDINARY_API_KEY?.trim() &&
    process.env.CLOUDINARY_API_SECRET?.trim()
);

// --- Middleware Setup ---
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(express.json());

const parseCookies = (header = '') => Object.fromEntries(
    header.split(';').filter(Boolean).map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    })
);

const createAuthToken = () => {
    const payload = Buffer.from(JSON.stringify({
        username: process.env.ADMIN_USERNAME,
        expires: Date.now() + 30 * 60 * 1000
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
};

const isValidAuthToken = (token = '') => {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return data.username === process.env.ADMIN_USERNAME && data.expires > Date.now();
    } catch {
        return false;
    }
};

const setAuthCookie = (res, token) => {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=1800; Path=/${secure}`);
};

// Middleware to check if the user is authenticated
const isAuthenticated = (req, res, next) => {
    if (isValidAuthToken(parseCookies(req.headers.cookie).admin_session)) {
        return next();
    }
    res.redirect('/login');
};

// Keep local uploads working during development. Vercel uses Cloudinary instead.
const uploadDir = path.join(assetsDir, 'images/ourwork');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --- Multer Configuration for File Uploads ---
const imageFilter = (req, file, cb) => {
    if (['image/jpeg', 'image/pjpeg', 'image/jpg'].includes(file.mimetype)) {
        return cb(null, true);
    }
    cb(new Error('Only JPEG images are allowed.'));
};

const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFilter,
    limits: {
        fileSize: 15 * 1024 * 1024
    }
});
// Create a multer instance for parsing multipart/form-data without saving files
const formParser = multer();

const sendHtml = (fileName) => (req, res) => {
    res.sendFile(htmlFile(fileName));
};

// --- Express Routes ---

// Login routes
app.get('/login', (req, res) => {
    res.sendFile(htmlFile('login.html'));
});

app.get('/login.html', (req, res) => {
    res.redirect('/login');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        setAuthCookie(res, createAuthToken());
        return res.redirect('/admin');
    } else {
        res.send('<h1>Invalid Credentials</h1><p>Please <a href="/login">try again</a>.</p>');
    }
});

// --- Protected Admin Routes ---
// These routes require the user to be logged in.
app.get('/admin', isAuthenticated, sendHtml('admin.html'));
app.get('/admin.html', isAuthenticated, (req, res) => {
    res.redirect('/admin');
});

const cloudinarySignature = (params) => crypto.createHash('sha1')
    .update(`${Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')}${process.env.CLOUDINARY_API_SECRET}`)
    .digest('hex');

const uploadToCloudinary = async (file, slot) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
        invalidate: 'true',
        overwrite: 'true',
        public_id: `portfolio/${slot}`,
        timestamp: String(timestamp)
    };
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: file.mimetype }), `${slot}.jpg`);
    form.append('api_key', process.env.CLOUDINARY_API_KEY);
    Object.entries(params).forEach(([key, value]) => form.append(key, value));
    form.append('signature', cloudinarySignature(params));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, {
        method: 'POST',
        body: form
    });
    if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error?.message || `Cloudinary upload failed (${response.status})`);
    }
    return response.json();
};

const portfolioImageUrl = (slot) => cloudinaryConfigured
    ? `https://res.cloudinary.com/${cloudinaryCloudName}/image/upload/f_auto,q_auto/portfolio/${slot}.jpg`
    : `/assets/images/ourwork/${slot}.jpg`;

app.get('/api/portfolio', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ images: Array.from({ length: 9 }, (_, index) => portfolioImageUrl(index + 1)) });
});

// Handle portfolio image uploads. Cloudinary is persistent; disk is only a local fallback.
const uploadFields = Array.from({ length: 9 }, (_, i) => ({ name: `image${i + 1}`, maxCount: 1 }));
app.post('/upload-portfolio', isAuthenticated, upload.fields(uploadFields), async (req, res) => {
    try {
        const files = Object.entries(req.files || {});
        if (!files.length) return res.status(400).send('<h1>Upload Failed</h1><p>Please select at least one JPEG image.</p><p><a href="/admin">Go back</a></p>');
        if (!cloudinaryConfigured && process.env.VERCEL) {
            return res.status(500).send('<h1>Upload Failed</h1><p>Cloudinary is not configured in Vercel. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in Project Settings, then redeploy.</p><p><a href="/admin">Go back</a></p>');
        }
        if (cloudinaryConfigured) {
            await Promise.all(files.map(([field, fileList]) => uploadToCloudinary(fileList[0], field.replace('image', ''))));
        } else {
            files.forEach(([field, fileList]) => fs.writeFileSync(path.join(uploadDir, `${field.replace('image', '')}.jpg`), fileList[0].buffer));
        }
        res.send('<h1>Upload Successful!</h1><p>Your portfolio images have been updated. <a href="/admin">Go back</a> or <a href="/portfolio" target="_blank">view portfolio</a>.</p>');
    } catch (error) {
        console.error('Portfolio upload failed:', error);
        const message = String(error.message || '').replace(/[<>]/g, '');
        res.status(502).send(`<h1>Upload Failed</h1><p>${message || 'Could not save the images. Check the storage settings and try again.'}</p><p><a href="/admin">Go back</a></p>`);
    }
});

// Logout route
app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');
    res.redirect('/login');
});

// --- Public API Routes ---

// Handle the contact form submission securely
// Use multer's .none() middleware to parse multipart/form-data text fields
app.post('/submit-contact', formParser.none(), async (req, res) => {
    const scriptUrl = process.env.CONTACT_FORM_URL;
    if (!scriptUrl) {
        console.error('CONTACT_FORM_URL is not set.');
        return res.status(500).json({ message: "Server configuration error. Contact form is not configured." });
    }

    let targetUrl;
    try {
        targetUrl = new URL(scriptUrl);
    } catch (error) {
        console.error('CONTACT_FORM_URL is invalid:', scriptUrl);
        return res.status(500).json({ message: "Server configuration error. Contact form URL is invalid." });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;

        try {
            response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: new URLSearchParams(req.body), // Google Scripts often expect urlencoded data
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            console.error('Google Script returned an error:', response.status, responseText);
            return res.status(502).json({ message: "Failed to send message." });
        }

        res.status(200).json({ message: "Message sent successfully!" });
    } catch (error) {
        console.error('Error submitting to Google Script:', error);
        res.status(500).json({ message: "Failed to send message." });
    }
});

// --- Public Static Files ---
app.get('/', sendHtml('index.html'));
app.get('/index.html', (req, res) => res.redirect('/'));
app.get('/services', sendHtml('services.html'));
app.get('/services.html', (req, res) => res.redirect('/services'));
app.get('/portfolio', sendHtml('portfolio.html'));
app.get('/portfolio.html', (req, res) => res.redirect('/portfolio'));
app.get('/contact', sendHtml('contact.html'));
app.get('/contact.html', (req, res) => res.redirect('/contact'));
app.get('/robots.txt', sendHtml('robots.txt'));
app.get('/sitemap.xml', sendHtml('sitemap.xml'));

app.use('/assets', express.static(assetsDir));
app.use('/css', express.static(cssDir));
app.use('/js', express.static(jsDir));

app.use((err, req, res) => {
    if (err && err.message === 'Only JPEG images are allowed.') {
        return res.status(400).send('<h1>Upload Failed</h1><p>Please upload JPEG images only.</p><p><a href="/admin">Go back</a></p>');
    }

    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send('<h1>Upload Failed</h1><p>Each image must be 15MB or smaller.</p><p><a href="/admin">Go back</a></p>');
    }

    if (err) {
        console.error('Unhandled server error:', err);
        return res.status(500).send('<h1>Server Error</h1><p>Please try again later.</p>');
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        console.log(`Admin portal available at http://localhost:${port}/login`);
    });
}

module.exports = app;
