require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const assetsDir = path.join(rootDir, 'assets');
const cssDir = path.join(rootDir, 'css');
const jsDir = path.join(rootDir, 'js');
const htmlFile = (fileName) => path.join(rootDir, fileName);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// --- Middleware Setup ---
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(session({
    secret: sessionSecret,
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    cookie: { 
        secure: false, // Set to true if you are using HTTPS
        maxAge: 30 * 60 * 1000 // 30 minutes
    }
}));

// Middleware to check if the user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.redirect('/login');
};

// Ensure the upload directory exists
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

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const imageNumber = file.fieldname.replace('image', '');
        cb(null, `${imageNumber}.jpg`);
    }
});

const upload = multer({
    storage,
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
        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regeneration failed:', err);
                return res.status(500).send('<h1>Login failed</h1><p>Please try again.</p>');
            }

            req.session.isAuthenticated = true;
            req.session.save(() => {
                res.redirect('/admin');
            });
        });
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

// Handle the portfolio image upload
const uploadFields = Array.from({ length: 9 }, (_, i) => ({ name: `image${i + 1}`, maxCount: 1 }));
app.post('/upload-portfolio', isAuthenticated, upload.fields(uploadFields), (req, res) => {
    console.log('Files uploaded:', Object.keys(req.files || {}));
    res.send('<h1>Upload Successful!</h1><p>Your portfolio images have been updated. <a href="/admin">Go back</a> or <a href="/portfolio.html" target="_blank">view portfolio</a>.</p>');
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.redirect('/'); // Redirect to homepage on error
        res.redirect('/login');
    });
});

// --- Public API Routes ---

// Handle the contact form submission securely
// Use multer's .none() middleware to parse multipart/form-data text fields
app.post('/submit-contact', formParser.none(), async (req, res) => {
    const scriptUrl = process.env.CONTACT_FORM_URL;
    if (!scriptUrl) {
        return res.status(500).json({ message: "Server configuration error." });
    }

    try {
        const response = await fetch(scriptUrl, {
            method: 'POST',
            body: new URLSearchParams(req.body) // Google Scripts often expect urlencoded data
        });

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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Admin portal available at http://localhost:${port}/login`);
});
