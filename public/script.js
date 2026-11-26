document.addEventListener('DOMContentLoaded', () => {
    const MAX_FILES = 5;
    const MAX_FILE_SIZE = 15 * 1024 * 1024;
    const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
    const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png']);

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
    const convertBtn = document.getElementById('convert-btn');
    const progressArea = document.getElementById('progress-area');
    const progressBarWrapper = document.querySelector('.progress-bar');
    const progressBar = document.getElementById('progress');
    const progressText = document.getElementById('progress-text');
    const currentFileText = document.getElementById('current-file-text');
    const convertMoreBtn = document.getElementById('convert-more-btn');
    const previewArea = document.getElementById('preview-area');

    let eventSource = null;
    let toastTimer = null;
    let stagedFiles = [];

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
            const filesToUpload = [...stagedFiles];
            stagedFiles = [];
            renderStaging();
            handleFiles(filesToUpload);
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
            if (!ALLOWED_TYPES.has(file.type) || !ALLOWED_EXTS.has(ext)) {
                errors.push(`"${file.name}" skipped (only JPG, JPEG, PNG supported).`);
                continue;
            }
            if (file.size > MAX_FILE_SIZE) {
                errors.push(`"${file.name}" exceeds the 15 MB limit.`);
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

    async function handleFiles(files) {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        uploadForm.style.display = 'none';
        progressArea.style.display = 'block';
        convertMoreBtn.style.display = 'none';
        progressBar.style.width = '0%';
        progressBarWrapper.setAttribute('aria-valuenow', '0');
        progressText.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;
        currentFileText.textContent = '';
        previewArea.innerHTML = '';

        const formData = new FormData();
        for (const file of files) {
            formData.append('images', file);
        }

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `Server error: ${response.statusText}`);
            }
            if (result.jobId) {
                startStatusListener(result.jobId, files);
            } else {
                throw new Error('Could not start conversion job.');
            }
        } catch (error) {
            showToast('Upload failed: ' + error.message, 'error');
            resetUI();
        }
    }

    function startStatusListener(jobId, originalFiles) {
        eventSource = new EventSource(`/conversion-status/${jobId}`);
        let processedFilesCount = 0;

        eventSource.onmessage = (event) => {
            const job = JSON.parse(event.data);

            if (job.error) {
                eventSource.close();
                eventSource = null;
                showToast(job.error, 'error');
                resetUI();
                return;
            }

            const percentComplete = Math.round((job.completed / job.total) * 100);
            progressBar.style.width = percentComplete + '%';
            progressBarWrapper.setAttribute('aria-valuenow', String(percentComplete));
            progressText.textContent = `Converting ${job.completed} of ${job.total} files...`;

            if (job.completed > processedFilesCount) {
                const newFiles = job.files.slice(processedFilesCount);
                newFiles.forEach((fileData, idx) => {
                    const fileIndex = processedFilesCount + idx;
                    const originalFile = originalFiles[fileIndex];
                    if (originalFile) {
                        createPreviewCard(originalFile, fileData, fileIndex * 100);
                        currentFileText.textContent = `Completed: ${originalFile.name}`;
                    }
                });
                processedFilesCount = job.completed;
            }

            if (job.completed === job.total) {
                eventSource.close();
                eventSource = null;
                progressText.textContent = 'Conversion Complete!';
                currentFileText.textContent = '';
                convertMoreBtn.style.display = 'inline-flex';
                showToast('All images converted to PDF!', 'success');
            }
        };

        eventSource.onerror = () => {
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            showToast('Connection to server lost.', 'error');
            resetUI();
        };
    }

    function createPreviewCard(imageFile, fileData, delay) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const card = document.createElement('div');
            card.className = 'preview-card';
            card.dataset.pdfFile = fileData.pdfFile;
            card.style.animationDelay = `${delay}ms`;

            const img = document.createElement('img');
            img.src = e.target.result;
            img.alt = `Preview of ${imageFile.name}`;
            img.className = 'preview-image';

            const info = document.createElement('div');
            info.className = 'preview-info';

            const fileNameSpan = document.createElement('span');
            fileNameSpan.className = 'file-name';
            fileNameSpan.textContent = imageFile.name;
            fileNameSpan.title = imageFile.name;

            const actions = document.createElement('div');
            actions.className = 'action-buttons';

            const originalPdfName = `${getBaseName(fileData.originalName)}.pdf`;
            const downloadLink = document.createElement('a');
            downloadLink.href = `/download/${encodeURIComponent(fileData.pdfFile)}?name=${encodeURIComponent(originalPdfName)}`;
            downloadLink.className = 'action-btn download-btn';
            downloadLink.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i> Download PDF';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'action-btn remove-btn';
            removeBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i> Remove';
            removeBtn.addEventListener('click', () => handleRemove(card));

            actions.appendChild(downloadLink);
            actions.appendChild(removeBtn);

            info.appendChild(fileNameSpan);
            info.appendChild(actions);

            card.appendChild(img);
            card.appendChild(info);
            previewArea.appendChild(card);
        };
        reader.readAsDataURL(imageFile);
    }

    function resetUI() {
        uploadForm.style.display = 'block';
        progressArea.style.display = 'none';
        convertMoreBtn.style.display = 'none';
        progressBar.style.width = '0%';
        progressBarWrapper.setAttribute('aria-valuenow', '0');
        fileInput.value = '';
    }

    async function handleRemove(card) {
        const pdfFile = card.dataset.pdfFile;
        try {
            await fetch('/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: pdfFile })
            });
        } catch {
            // Best-effort server cleanup; still remove card from UI
        }
        card.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => card.remove(), 300);
    }
});
