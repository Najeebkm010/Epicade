require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const rootDir = path.join(__dirname, '..');
const uploadDir = path.join(rootDir, 'assets', 'images', 'ourwork');
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/jpg', 'image/pjpeg'].includes(file.mimetype)),
    limits: { fileSize: 15 * 1024 * 1024 }
});
const formParser = multer();
const cookieName = 'epicade_auth';
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function token() {
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
    return `${timestamp}.${signature}`;
}

function authenticated(req, res, next) {
    const value = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`));
    const [timestamp, signature] = value ? decodeURIComponent(value.slice(cookieName.length + 1)).split('.') : [];
    const expected = timestamp && crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
    if (timestamp && signature && /^\d+$/.test(timestamp) && Date.now() - Number(timestamp) < 30 * 60 * 1000 && signature === expected) return next();
    return res.redirect('/login');
}

function page(fileName) {
    return (req, res) => res.sendFile(path.join(rootDir, fileName));
}

app.get('/', page('index.html'));
app.get('/login', page('login.html'));
app.get('/admin', authenticated, page('admin.html'));
app.get('/services', page('services.html'));
app.get('/portfolio', page('portfolio.html'));
app.get('/contact', page('contact.html'));
app.get('/robots.txt', page('robots.txt'));
app.get('/sitemap.xml', page('sitemap.xml'));
app.get('/index.html', (req, res) => res.redirect('/'));
app.get('/login.html', (req, res) => res.redirect('/login'));
app.get('/admin.html', (req, res) => res.redirect('/admin'));
app.get('/services.html', (req, res) => res.redirect('/services'));
app.get('/portfolio.html', (req, res) => res.redirect('/portfolio'));
app.get('/contact.html', (req, res) => res.redirect('/contact'));

app.use('/assets', express.static(path.join(rootDir, 'assets')));
app.use('/css', express.static(path.join(rootDir, 'css')));
app.use('/js', express.static(path.join(rootDir, 'js')));

app.post('/login', (req, res) => {
    if (req.body.username !== process.env.ADMIN_USERNAME || req.body.password !== process.env.ADMIN_PASSWORD) {
        return res.send('<h1>Invalid Credentials</h1><p><a href="/login">Try again</a>.</p>');
    }
    res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token())}; Max-Age=1800; Path=/; HttpOnly; SameSite=Lax${process.env.VERCEL ? '; Secure' : ''}`);
    return res.redirect('/admin');
});

app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect('/login');
});

app.post('/upload-portfolio', authenticated, upload.fields(Array.from({ length: 9 }, (_, i) => ({ name: `image${i + 1}`, maxCount: 1 }))), async (req, res) => {
    try {
        const files = req.files || {};
        if (process.env.VERCEL) {
            const { put } = require('@vercel/blob');
            for (const field of Object.keys(files)) await put(`images/ourwork/${field.replace('image', '')}.jpg`, files[field][0].buffer, { access: 'public', addRandomSuffix: false, contentType: 'image/jpeg' });
        } else {
            fs.mkdirSync(uploadDir, { recursive: true });
            for (const field of Object.keys(files)) fs.writeFileSync(path.join(uploadDir, `${field.replace('image', '')}.jpg`), files[field][0].buffer);
        }
        return res.send('<h1>Upload Successful!</h1><p><a href="/admin">Go back to Admin</a></p>');
    } catch (error) {
        console.error('Portfolio upload error:', error);
        return res.status(500).send('<h1>Upload Failed</h1><p>Please try again later.</p>');
    }
});

app.post('/submit-contact', formParser.none(), async (req, res) => {
    if (!process.env.CONTACT_FORM_URL) return res.status(500).json({ message: 'Server configuration error.' });
    try {
        const response = await fetch(process.env.CONTACT_FORM_URL, { method: 'POST', body: new URLSearchParams(req.body) });
        return res.status(response.ok ? 200 : 502).json({ message: response.ok ? 'Message sent successfully!' : 'Failed to send message.' });
    } catch (error) {
        console.error('Contact submission error:', error);
        return res.status(500).json({ message: 'Failed to send message.' });
    }
});

app.use((req, res) => res.status(404).send('<h1>404 - Page Not Found</h1><p><a href="/">Return to homepage</a></p>'));

module.exports = app;
