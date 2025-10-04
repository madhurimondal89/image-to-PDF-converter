const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

// *** মূল পরিবর্তন: public ফোল্ডারকে স্ট্যাটিক হিসেবে পরিবেশন করা ***
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let conversionJobs = {};

const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// মূল রুট এখন public ফোল্ডারের index.html ফাইলটি দেখাবে
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.array('images', 5), (req, res, next) => {
    // Multer দিয়ে ফাইল সংখ্যা যাচাই করার জন্য একটি মিডলওয়্যার
    if (req.files.length === 0) {
        return res.status(400).json({ error: 'No files were uploaded.' });
    }
    next();
}, (req, res) => {
    // req.files এখন নিশ্চিতভাবে আছে
    const jobId = Date.now().toString();
    conversionJobs[jobId] = { total: req.files.length, completed: 0, files: [], error: null };
    res.json({ jobId: jobId });

    (async () => {
        const job = conversionJobs[jobId];
        for (const file of req.files) {
            try {
                const result = await convertFile(file);
                job.completed++;
                job.files.push(result);
            } catch (err) {
                job.error = 'A file failed to convert.';
                return;
            }
        }
    })();
});


function convertFile(file) {
    return new Promise((resolve, reject) => {
        const imagePath = file.path;
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const pdfFileName = `${path.parse(file.originalname).name}-${uniqueSuffix}.pdf`;
        const pdfPath = path.join(outputDir, pdfFileName);
        
        const doc = new PDFDocument({ autoFirstPage: false });
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);
        const img = doc.openImage(imagePath);
        doc.addPage({ size: [img.width, img.height] });
        doc.image(img, 0, 0, { width: img.width, height: img.height });
        doc.end();
        writeStream.on('close', () => {
            fs.unlinkSync(imagePath);
            resolve({ originalName: file.originalname, pdfFile: pdfFileName });
        });
        writeStream.on('error', reject);
    });
}

app.get('/conversion-status/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const intervalId = setInterval(() => {
        const job = conversionJobs[jobId];
        if (!job) {
            clearInterval(intervalId);
            return res.end();
        }
        res.write(`data: ${JSON.stringify(job)}\n\n`);
        
        const isJobDone = job.completed === job.total;
        if (isJobDone || job.error) {
            clearInterval(intervalId);
            setTimeout(() => delete conversionJobs[jobId], 10000);
            return res.end();
        }
    }, 500);

    req.on('close', () => {
        clearInterval(intervalId);
        delete conversionJobs[jobId];
    });
});

app.get('/download/:filename', (req, res) => {
    const filePath = path.join(outputDir, req.params.filename);
    const originalName = req.query.name || req.params.filename;
    res.download(filePath, originalName);
});

app.post('/remove', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ success: false });
    const filePath = path.join(outputDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
});

cron.schedule('*/30 * * * *', () => {
    console.log('Running cleanup task for old files...');
    const directories = [uploadsDir, outputDir];
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    directories.forEach(dir => {
        fs.readdir(dir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const filePath = path.join(dir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) return;
                    if (stats.birthtime.getTime() < thirtyMinutesAgo) {
                        fs.unlink(filePath, (err) => { if (!err) console.log(`Deleted old file: ${file}`); });
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