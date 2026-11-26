document.addEventListener('DOMContentLoaded', () => {
    const MAX_FILES = 5;
    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    const ALLOWED_TYPES = new Set([
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/bmp'
    ]);
    const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

    // Accessible Accordion
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isActive = header.classList.contains('active');

            accordionHeaders.forEach(h => {
                h.classList.remove('active');
                h.setAttribute('aria-expanded', 'false');
                h.nextElementSibling.style.maxHeight = null;
            });

            if (!isActive) {
                header.classList.add('active');
                header.setAttribute('aria-expanded', 'true');
                content.style.maxHeight = content.scrollHeight + 'px';
            }
        });
    });

    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('file-upload-input');
    const dropZone = document.querySelector('.file-upload-wrapper');
    const statusToast = document.getElementById('status-toast');
    const stagingArea = document.getElementById('staging-area');
    const stagingCount = document.getElementById('staging-count');
    const stagingList = document.getElementById('staging-list');
    const clearStagingBtn = document.getElementById('clear-staging-btn');
    const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
    const convertBtn = document.getElementById('convert-btn');
    const progressArea = document.getElementById('progress-area');
    const progressBarWrapper = document.querySelector('.progress-bar');
    const progressBar = document.getElementById('progress');
    const progressText = document.getElementById('progress-text');
    const currentFileText = document.getElementById('current-file-text');
    const convertMoreBtn = document.getElementById('convert-more-btn');
    const previewArea = document.getElementById('preview-area');

    let toastTimer = null;
    let stagedFiles = [];
    const activeBlobUrls = new Set();

    function showToast(message, type = 'error') {
        if (toastTimer) clearTimeout(toastTimer);
        statusToast.textContent = message;
        statusToast.className = `status-toast ${type}`;
        statusToast.style.display = 'flex';
        toastTimer = setTimeout(() => {
            statusToast.style.display = 'none';
        }, 5000);
    }

    function hideToast() {
        if (toastTimer) clearTimeout(toastTimer);
        statusToast.style.display = 'none';
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getBaseName(filePath) {
        const basename = filePath.split(/[\\/]/).pop() || 'image';
        const dotIdx = basename.lastIndexOf('.');
        return dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
    }

    function getExtension(filePath) {
        const basename = filePath.split(/[\\/]/).pop() || '';
        const dotIdx = basename.lastIndexOf('.');
        return dotIdx >= 0 ? basename.slice(dotIdx).toLowerCase() : '';
    }

    function revokeAllBlobUrls() {
        for (const url of activeBlobUrls) {
            URL.revokeObjectURL(url);
        }
        activeBlobUrls.clear();
    }

    fileInput.addEventListener('change', () => {
        handleFileSelection(fileInput.files);
        fileInput.value = '';
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFileSelection(e.dataTransfer.files);
    });

    clearStagingBtn.addEventListener('click', () => {
        stagedFiles = [];
        renderStaging();
    });

    convertBtn.addEventListener('click', () => {
        if (stagedFiles.length > 0) {
            const filesToConvert = [...stagedFiles];
            const shouldMerge = mergeCheckbox.checked;
            stagedFiles = [];
            renderStaging();
            convertInBrowser(filesToConvert, shouldMerge);
        }
    });

    convertMoreBtn.addEventListener('click', () => {
        resetUI();
    });

    function handleFileSelection(files) {
        hideToast();
        const incoming = Array.from(files);
        if (incoming.length === 0) return;

        const errors = [];
        for (const file of incoming) {
            if (stagedFiles.length >= MAX_FILES) {
                errors.push(`Maximum ${MAX_FILES} files allowed at a time.`);
                break;
            }
            const ext = getExtension(file.name);
            const isValidMime = file.type ? ALLOWED_TYPES.has(file.type) : true;
            if (!isValidMime || !ALLOWED_EXTS.has(ext)) {
                errors.push(`"${file.name}" skipped (supported: JPG, PNG, WebP, GIF, BMP).`);
                continue;
            }
            if (file.size > MAX_FILE_SIZE) {
                errors.push(`"${file.name}" exceeds the 25 MB limit.`);
                continue;
            }
            stagedFiles.push(file);
        }

        if (errors.length > 0) {
            showToast(errors[0], 'error');
        }
        renderStaging();
    }

    function renderStaging() {
        stagingList.innerHTML = '';
        if (stagedFiles.length === 0) {
            stagingArea.style.display = 'none';
            return;
        }

        stagingArea.style.display = 'block';
        stagingCount.textContent = `${stagedFiles.length} of ${MAX_FILES} file${stagedFiles.length > 1 ? 's' : ''} ready`;

        stagedFiles.forEach((file, index) => {
            const li = document.createElement('li');
            li.className = 'staged-file-item';

            const info = document.createElement('div');
            info.className = 'staged-file-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'staged-file-name';
            nameSpan.textContent = file.name;

            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'staged-file-size';
            sizeSpan.textContent = formatBytes(file.size);

            info.appendChild(nameSpan);
            info.appendChild(sizeSpan);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'staged-remove-btn';
            removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
            removeBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
            removeBtn.addEventListener('click', () => {
                stagedFiles.splice(index, 1);
                renderStaging();
            });

            li.appendChild(info);
            li.appendChild(removeBtn);
            stagingList.appendChild(li);
        });
    }

    async function rasterizeToPngBytes(file) {
        const imgUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error(`Could not decode "${file.name}".`));
                el.src = imgUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const pngBlob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    blob => (blob ? resolve(blob) : reject(new Error(`Failed to encode "${file.name}".`))),
                    'image/png'
                );
            });
            return new Uint8Array(await pngBlob.arrayBuffer());
        } finally {
            URL.revokeObjectURL(imgUrl);
        }
    }

    async function embedImageInPdf(pdfDoc, file) {
        const ext = getExtension(file.name);
        const rawBytes = new Uint8Array(await file.arrayBuffer());

        let embeddedImg;
        if (file.type === 'image/jpeg' || file.type === 'image/jpg' || ext === '.jpg' || ext === '.jpeg') {
            try {
                embeddedImg = await pdfDoc.embedJpg(rawBytes);
            } catch {
                const pngBytes = await rasterizeToPngBytes(file);
                embeddedImg = await pdfDoc.embedPng(pngBytes);
            }
        } else if (file.type === 'image/png' || ext === '.png') {
            try {
                embeddedImg = await pdfDoc.embedPng(rawBytes);
            } catch {
                const pngBytes = await rasterizeToPngBytes(file);
                embeddedImg = await pdfDoc.embedPng(pngBytes);
            }
        } else {
            const pngBytes = await rasterizeToPngBytes(file);
            embeddedImg = await pdfDoc.embedPng(pngBytes);
        }

        const page = pdfDoc.addPage([embeddedImg.width, embeddedImg.height]);
        page.drawImage(embeddedImg, {
            x: 0,
            y: 0,
            width: embeddedImg.width,
            height: embeddedImg.height
        });
    }

    function updateProgress(completed, total, statusMsg) {
        const percent = Math.round((completed / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressBarWrapper.setAttribute('aria-valuenow', String(percent));
        progressText.textContent = statusMsg;
    }

    async function convertInBrowser(files, shouldMerge) {
        if (!window.PDFLib || !window.PDFLib.PDFDocument) {
            showToast('PDF engine failed to load. Please refresh the page.', 'error');
            return;
        }

        revokeAllBlobUrls();
        uploadForm.style.display = 'none';
        progressArea.style.display = 'block';
        convertMoreBtn.style.display = 'none';
        previewArea.innerHTML = '';
        updateProgress(0, files.length, `Converting 0 of ${files.length} files in your browser...`);
        currentFileText.textContent = '';

        const { PDFDocument } = window.PDFLib;

        try {
            if (shouldMerge) {
                const mergedDoc = await PDFDocument.create();
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    currentFileText.textContent = `Processing: ${file.name}`;
                    await embedImageInPdf(mergedDoc, file);
                    updateProgress(i + 1, files.length, `Processed ${i + 1} of ${files.length} images...`);
                }

                const pdfBytes = await mergedDoc.save();
                const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                const pdfUrl = URL.createObjectURL(pdfBlob);
                activeBlobUrls.add(pdfUrl);

                const mergedName = files.length === 1
                    ? `${getBaseName(files[0].name)}.pdf`
                    : 'merged-images.pdf';

                createPreviewCard(files[0], mergedName, pdfUrl, 0, `${files.length} page${files.length > 1 ? 's' : ''} merged`);
            } else {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    currentFileText.textContent = `Processing: ${file.name}`;
                    const pdfDoc = await PDFDocument.create();
                    await embedImageInPdf(pdfDoc, file);

                    const pdfBytes = await pdfDoc.save();
                    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const pdfUrl = URL.createObjectURL(pdfBlob);
                    activeBlobUrls.add(pdfUrl);

                    const outputName = `${getBaseName(file.name)}.pdf`;
                    createPreviewCard(file, outputName, pdfUrl, i * 80);
                    updateProgress(i + 1, files.length, `Converted ${i + 1} of ${files.length} files...`);
                }
            }

            progressText.textContent = 'Conversion Complete!';
            currentFileText.textContent = '';
            convertMoreBtn.style.display = 'inline-flex';
            showToast('All images converted in your browser!', 'success');
        } catch (err) {
            showToast(err.message || 'Failed to convert one of the images.', 'error');
            resetUI();
        }
    }

    function createPreviewCard(previewImageFile, pdfDownloadName, pdfBlobUrl, delay, subtitleText = '') {
        const thumbUrl = URL.createObjectURL(previewImageFile);
        activeBlobUrls.add(thumbUrl);

        const card = document.createElement('div');
        card.className = 'preview-card';
        card.style.animationDelay = `${delay}ms`;

        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = `Preview of ${previewImageFile.name}`;
        img.className = 'preview-image';

        const info = document.createElement('div');
        info.className = 'preview-info';

        const fileNameSpan = document.createElement('span');
        fileNameSpan.className = 'file-name';
        fileNameSpan.textContent = subtitleText ? `${pdfDownloadName} (${subtitleText})` : pdfDownloadName;
        fileNameSpan.title = pdfDownloadName;

        const actions = document.createElement('div');
        actions.className = 'action-buttons';

        const downloadLink = document.createElement('a');
        downloadLink.href = pdfBlobUrl;
        downloadLink.download = pdfDownloadName;
        downloadLink.className = 'action-btn download-btn';
        downloadLink.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i> Download PDF';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'action-btn remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i> Remove';
        removeBtn.addEventListener('click', () => {
            URL.revokeObjectURL(pdfBlobUrl);
            URL.revokeObjectURL(thumbUrl);
            activeBlobUrls.delete(pdfBlobUrl);
            activeBlobUrls.delete(thumbUrl);
            card.style.animation = 'fadeOut 0.3s forwards';
            setTimeout(() => card.remove(), 300);
        });

        actions.appendChild(downloadLink);
        actions.appendChild(removeBtn);

        info.appendChild(fileNameSpan);
        info.appendChild(actions);

        card.appendChild(img);
        card.appendChild(info);
        previewArea.appendChild(card);
    }

    function resetUI() {
        uploadForm.style.display = 'block';
        progressArea.style.display = 'none';
        convertMoreBtn.style.display = 'none';
        progressBar.style.width = '0%';
        progressBarWrapper.setAttribute('aria-valuenow', '0');
        fileInput.value = '';
    }
});
