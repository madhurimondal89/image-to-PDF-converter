const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

const MAX_FILES = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB per file
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const JOB_TTL_MS = 5 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const conversionJobs = {};

const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
const zipsDir = path.join(__dirname, 'zips');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

function resolveSafeOutputPath(filename) {
    if (typeof filename !== 'string' || !filename.trim()) return null;
    const safeName = path.basename(filename);
    if (safeName !== filename) return null;
    const resolvedDir = path.resolve(outputDir);
    const resolvedFile = path.resolve(resolvedDir, safeName);
    if (!resolvedFile.startsWith(resolvedDir + path.sep)) return null;
    return resolvedFile;
}

function safeUnlink(filePath) {
    if (!filePath) return Promise.resolve();
    return fs.promises.unlink(filePath).catch(() => {});
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const cleanBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${cleanBase}`);
    }
});

const upload = multer({
    storage,
    limits: {
        files: MAX_FILES,
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG, JPEG, and PNG image files are supported.'));
        }
    }
});

const uploadMiddleware = upload.array('images', MAX_FILES);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', (req, res) => {
    uploadMiddleware(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'Each file must be 15 MB or smaller.' });
                }
                if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ error: `You can upload a maximum of ${MAX_FILES} files at a time.` });
                }
                return res.status(400).json({ error: err.message });
            }
            return res.status(400).json({ error: err.message || 'Invalid file upload.' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files were uploaded.' });
        }

        const jobId = crypto.randomUUID();
        conversionJobs[jobId] = {
            total: req.files.length,
            completed: 0,
            files: [],
            error: null
        };

        // Fallback cleanup in case SSE client never connects
        setTimeout(() => {
            delete conversionJobs[jobId];
        }, JOB_TTL_MS).unref();

        res.json({ jobId });

        (async () => {
            const job = conversionJobs[jobId];
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                try {
                    const result = await convertFile(file);
                    if (conversionJobs[jobId]) {
                        job.completed++;
                        job.files.push(result);
                    }
                } catch (convErr) {
                    if (conversionJobs[jobId]) {
                        job.error = `Failed to convert "${path.basename(file.originalname)}". Ensure it is a valid JPG or PNG image.`;
                    }
                    // Clean up remaining unprocessed uploaded files
                    for (let j = i; j < req.files.length; j++) {
                        await safeUnlink(req.files[j].path);
                    }
                    return;
                }
            }
        })();
    });
});

function convertFile(file) {
    return new Promise((resolve, reject) => {
        const imagePath = file.path;
        const uniqueSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const baseName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
        const pdfFileName = `${baseName}-${uniqueSuffix}.pdf`;
        const pdfPath = path.join(outputDir, pdfFileName);

        let writeStream;
        try {
            const doc = new PDFDocument({ autoFirstPage: false });
            writeStream = fs.createWriteStream(pdfPath);

            writeStream.on('error', async (err) => {
                await safeUnlink(imagePath);
                await safeUnlink(pdfPath);
                reject(err);
            });

            writeStream.on('close', async () => {
                await safeUnlink(imagePath);
                resolve({ originalName: file.originalname, pdfFile: pdfFileName });
            });

            doc.on('error', async (err) => {
                writeStream.destroy();
                await safeUnlink(imagePath);
                await safeUnlink(pdfPath);
                reject(err);
            });

            doc.pipe(writeStream);
            const img = doc.openImage(imagePath);
            doc.addPage({ size: [img.width, img.height] });
            doc.image(img, 0, 0, { width: img.width, height: img.height });
            doc.end();
        } catch (err) {
            if (writeStream) writeStream.destroy();
            Promise.all([safeUnlink(imagePath), safeUnlink(pdfPath)]).finally(() => reject(err));
        }
    });
}

app.get('/conversion-status/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendUpdate = () => {
        const job = conversionJobs[jobId];
        if (!job) {
            res.write(`data: ${JSON.stringify({ error: 'Conversion job not found or expired.' })}\n\n`);
            clearInterval(intervalId);
            return res.end();
        }

        res.write(`data: ${JSON.stringify(job)}\n\n`);

        const isJobDone = job.completed === job.total;
        if (isJobDone || job.error) {
            clearInterval(intervalId);
            setTimeout(() => delete conversionJobs[jobId], 10000).unref();
            return res.end();
        }
    };

    const intervalId = setInterval(sendUpdate, 300);
    sendUpdate();

    req.on('close', () => {
        clearInterval(intervalId);
    });
});

app.get('/download/:filename', async (req, res) => {
    const filePath = resolveSafeOutputPath(req.params.filename);
    if (!filePath) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }

    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
        return res.status(404).json({ error: 'File not found or expired.' });
    }

    const rawName = typeof req.query.name === 'string' && req.query.name.trim()
        ? path.basename(req.query.name)
        : path.basename(filePath);

    res.download(filePath, rawName, (err) => {
        if (err && !res.headersSent) {
            res.status(500).json({ error: 'Failed to download file.' });
        }
    });
});

app.post('/remove', async (req, res) => {
    const { filename } = req.body || {};
    const filePath = resolveSafeOutputPath(filename);
    if (!filePath) {
        return res.status(400).json({ success: false, error: 'Invalid filename.' });
    }

    await safeUnlink(filePath);
    res.json({ success: true });
});

cron.schedule('*/30 * * * *', () => {
    console.log('Running cleanup task for old files...');
    const directories = [uploadsDir, outputDir, zipsDir];
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

    directories.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        fs.readdir(dir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const filePath = path.join(dir, file);
                fs.stat(filePath, (statErr, stats) => {
                    if (statErr || !stats.isFile()) return;
                    if (stats.mtimeMs < thirtyMinutesAgo) {
                        fs.unlink(filePath, (unlinkErr) => {
                            if (!unlinkErr) console.log(`Deleted old file: ${file}`);
                        });
                    }
                });
            });
        });
    });
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
    console.log('Automatic file cleanup scheduled.');
});
