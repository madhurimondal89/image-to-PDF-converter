document.addEventListener('DOMContentLoaded', () => {
    const MAX_FILES = 25;
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
    const pageSizeSelect = document.getElementById('page-size-select');
    const marginSelect = document.getElementById('margin-select');
    const mergeCheckbox = document.getElementById('merge-pdf-checkbox');
    const convertBtn = document.getElementById('convert-btn');
    const progressArea = document.getElementById('progress-area');
    const progressBarWrapper = document.querySelector('.progress-bar');
    const progressBar = document.getElementById('progress');
    const progressText = document.getElementById('progress-text');
    const currentFileText = document.getElementById('current-file-text');
    const convertMoreBtn = document.getElementById('convert-more-btn');
    const batchActions = document.getElementById('batch-actions');
    const downloadZipBtn = document.getElementById('download-zip-btn');
    const previewArea = document.getElementById('preview-area');

    let toastTimer = null;
    let stagedItems = []; // { file: File, rotation: 0|90|180|270 }
    let dragSrcIndex = null;
    let generatedPdfs = [];
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

    // Minimal zero-dependency Store ZIP builder for client-side batch download
    const CRC32_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
            crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    function createZipBlob(entries) {
        const encoder = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        let offset = 0;

        for (const entry of entries) {
            const nameBytes = encoder.encode(entry.name);
            const data = entry.bytes;
            const crc = crc32(data);

            const localHeader = new ArrayBuffer(30);
            const lv = new DataView(localHeader);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint16(6, 0x0800, true);
            lv.setUint16(8, 0, true);
            lv.setUint16(10, 0, true);
            lv.setUint16(12, 0, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, data.length, true);
            lv.setUint32(22, data.length, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);

            localParts.push(new Uint8Array(localHeader), nameBytes, data);

            const centralHeader = new ArrayBuffer(46);
            const cv = new DataView(centralHeader);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, 0, true);
            cv.setUint16(14, 0, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, data.length, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0, true);
            cv.setUint32(42, offset, true);

            centralParts.push(new Uint8Array(centralHeader), nameBytes);
            offset += 30 + nameBytes.length + data.length;
        }

        const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
        const eocd = new ArrayBuffer(22);
        const ev = new DataView(eocd);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, entries.length, true);
        ev.setUint16(10, entries.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true);

        return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], {
            type: 'application/zip'
        });
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
        stagedItems = [];
        renderStaging();
    });

    convertBtn.addEventListener('click', () => {
        if (stagedItems.length > 0) {
            const itemsToConvert = [...stagedItems];
            const shouldMerge = mergeCheckbox.checked;
            const pageSizeMode = pageSizeSelect.value;
            const marginPt = parseInt(marginSelect.value, 10) || 0;
            stagedItems = [];
            renderStaging();
            convertInBrowser(itemsToConvert, shouldMerge, pageSizeMode, marginPt);
        }
    });

    downloadZipBtn.addEventListener('click', () => {
        if (generatedPdfs.length < 2) return;
        const usedNames = new Map();
        const entries = generatedPdfs.map(item => {
            const count = (usedNames.get(item.name) || 0) + 1;
            usedNames.set(item.name, count);
            const finalName = count === 1
                ? item.name
                : `${getBaseName(item.name)} (${count}).pdf`;
            return { name: finalName, bytes: item.bytes };
        });

        const zipBlob = createZipBlob(entries);
        const zipUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = 'converted-pdfs.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
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
            if (stagedItems.length >= MAX_FILES) {
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
            stagedItems.push({ file, rotation: 0 });
        }

        if (errors.length > 0) {
            showToast(errors[0], 'error');
        }
        renderStaging();
    }

    function moveStagedItem(fromIndex, toIndex) {
        if (toIndex < 0 || toIndex >= stagedItems.length || fromIndex === toIndex) return;
        const [moved] = stagedItems.splice(fromIndex, 1);
        stagedItems.splice(toIndex, 0, moved);
        renderStaging();
    }

    function renderStaging() {
        stagingList.innerHTML = '';
        if (stagedItems.length === 0) {
            stagingArea.style.display = 'none';
            return;
        }

        stagingArea.style.display = 'block';
        stagingCount.textContent = `${stagedItems.length} of ${MAX_FILES} file${stagedItems.length > 1 ? 's' : ''} ready (drag to reorder)`;

        stagedItems.forEach((item, index) => {
            const { file, rotation } = item;
            const li = document.createElement('li');
            li.className = 'staged-file-item';
            li.draggable = true;
            li.dataset.index = String(index);

            li.addEventListener('dragstart', (e) => {
                dragSrcIndex = index;
                li.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            li.addEventListener('dragend', () => {
                li.classList.remove('dragging');
                dragSrcIndex = null;
            });
            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                li.classList.add('drag-target');
            });
            li.addEventListener('dragleave', () => {
                li.classList.remove('drag-target');
            });
            li.addEventListener('drop', (e) => {
                e.preventDefault();
                li.classList.remove('drag-target');
                if (dragSrcIndex !== null && dragSrcIndex !== index) {
                    moveStagedItem(dragSrcIndex, index);
                }
            });

            const info = document.createElement('div');
            info.className = 'staged-file-info';

            const handle = document.createElement('span');
            handle.className = 'drag-handle';
            handle.setAttribute('aria-hidden', 'true');
            handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'staged-file-name';
            nameSpan.textContent = `${index + 1}. ${file.name}`;

            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'staged-file-size';
            sizeSpan.textContent = formatBytes(file.size);

            info.appendChild(handle);
            info.appendChild(nameSpan);
            info.appendChild(sizeSpan);

            if (rotation !== 0) {
                const rotBadge = document.createElement('span');
                rotBadge.className = 'rotation-badge';
                rotBadge.textContent = `${rotation}°`;
                info.appendChild(rotBadge);
            }

            const actions = document.createElement('div');
            actions.className = 'staged-actions';

            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'staged-icon-btn';
            upBtn.disabled = index === 0;
            upBtn.setAttribute('aria-label', `Move ${file.name} up`);
            upBtn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
            upBtn.addEventListener('click', () => moveStagedItem(index, index - 1));

            const downBtn = document.createElement('button');
            downBtn.type = 'button';
            downBtn.className = 'staged-icon-btn';
            downBtn.disabled = index === stagedItems.length - 1;
            downBtn.setAttribute('aria-label', `Move ${file.name} down`);
            downBtn.innerHTML = '<i class="fas fa-arrow-down" aria-hidden="true"></i>';
            downBtn.addEventListener('click', () => moveStagedItem(index, index + 1));

            const rotateBtn = document.createElement('button');
            rotateBtn.type = 'button';
            rotateBtn.className = 'staged-icon-btn';
            rotateBtn.setAttribute('aria-label', `Rotate ${file.name} 90 degrees`);
            rotateBtn.title = 'Rotate 90°';
            rotateBtn.innerHTML = '<i class="fas fa-rotate-right" aria-hidden="true"></i>';
            rotateBtn.addEventListener('click', () => {
                item.rotation = (item.rotation + 90) % 360;
                renderStaging();
            });

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'staged-remove-btn';
            removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
            removeBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
            removeBtn.addEventListener('click', () => {
                stagedItems.splice(index, 1);
                renderStaging();
            });

            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            actions.appendChild(rotateBtn);
            actions.appendChild(removeBtn);

            li.appendChild(info);
            li.appendChild(actions);
            stagingList.appendChild(li);
        });
    }

    async function rasterizeToPngBytes(file, rotation = 0) {
        const imgUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error(`Could not decode "${file.name}".`));
                el.src = imgUrl;
            });

            const srcW = img.naturalWidth || img.width;
            const srcH = img.naturalHeight || img.height;
            const swap = rotation === 90 || rotation === 270;

            const canvas = document.createElement('canvas');
            canvas.width = swap ? srcH : srcW;
            canvas.height = swap ? srcW : srcH;

            const ctx = canvas.getContext('2d');
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(img, -srcW / 2, -srcH / 2);

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

    function computePageLayout(imgWidth, imgHeight, pageSizeMode, marginPt) {
        if (pageSizeMode === 'fit') {
            return {
                pageW: imgWidth + marginPt * 2,
                pageH: imgHeight + marginPt * 2,
                x: marginPt,
                y: marginPt,
                drawW: imgWidth,
                drawH: imgHeight
            };
        }

        const base = pageSizeMode === 'letter' ? [612, 792] : [595.28, 841.89];
        const isLandscape = imgWidth > imgHeight;
        const pageW = isLandscape ? base[1] : base[0];
        const pageH = isLandscape ? base[0] : base[1];
        const maxW = Math.max(10, pageW - marginPt * 2);
        const maxH = Math.max(10, pageH - marginPt * 2);
        const scale = Math.min(maxW / imgWidth, maxH / imgHeight);
        const drawW = imgWidth * scale;
        const drawH = imgHeight * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;

        return { pageW, pageH, x, y, drawW, drawH };
    }

    async function embedImageInPdf(pdfDoc, item, pageSizeMode, marginPt) {
        const { file, rotation } = item;
        const ext = getExtension(file.name);
        let embeddedImg;

        if (rotation === 0 && (file.type === 'image/jpeg' || file.type === 'image/jpg' || ext === '.jpg' || ext === '.jpeg')) {
            const rawBytes = new Uint8Array(await file.arrayBuffer());
            try {
                embeddedImg = await pdfDoc.embedJpg(rawBytes);
            } catch {
                const pngBytes = await rasterizeToPngBytes(file, 0);
                embeddedImg = await pdfDoc.embedPng(pngBytes);
            }
        } else if (rotation === 0 && (file.type === 'image/png' || ext === '.png')) {
            const rawBytes = new Uint8Array(await file.arrayBuffer());
            try {
                embeddedImg = await pdfDoc.embedPng(rawBytes);
            } catch {
                const pngBytes = await rasterizeToPngBytes(file, 0);
                embeddedImg = await pdfDoc.embedPng(pngBytes);
            }
        } else {
            const pngBytes = await rasterizeToPngBytes(file, rotation);
            embeddedImg = await pdfDoc.embedPng(pngBytes);
        }

        const { pageW, pageH, x, y, drawW, drawH } = computePageLayout(
            embeddedImg.width,
            embeddedImg.height,
            pageSizeMode,
            marginPt
        );
        const page = pdfDoc.addPage([pageW, pageH]);
        page.drawImage(embeddedImg, { x, y, width: drawW, height: drawH });
    }

    function updateProgress(completed, total, statusMsg) {
        const percent = Math.round((completed / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressBarWrapper.setAttribute('aria-valuenow', String(percent));
        progressText.textContent = statusMsg;
    }

    async function convertInBrowser(items, shouldMerge, pageSizeMode, marginPt) {
        if (!window.PDFLib || !window.PDFLib.PDFDocument) {
            showToast('PDF engine failed to load. Please refresh the page.', 'error');
            return;
        }

        revokeAllBlobUrls();
        generatedPdfs = [];
        batchActions.style.display = 'none';
        uploadForm.style.display = 'none';
        progressArea.style.display = 'block';
        convertMoreBtn.style.display = 'none';
        previewArea.innerHTML = '';
        updateProgress(0, items.length, `Converting 0 of ${items.length} files in your browser...`);
        currentFileText.textContent = '';

        const { PDFDocument } = window.PDFLib;

        try {
            if (shouldMerge) {
                const mergedDoc = await PDFDocument.create();
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    currentFileText.textContent = `Processing: ${item.file.name}`;
                    await embedImageInPdf(mergedDoc, item, pageSizeMode, marginPt);
                    updateProgress(i + 1, items.length, `Processed ${i + 1} of ${items.length} images...`);
                }

                const pdfBytes = new Uint8Array(await mergedDoc.save());
                const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                const pdfUrl = URL.createObjectURL(pdfBlob);
                activeBlobUrls.add(pdfUrl);

                const mergedName = items.length === 1
                    ? `${getBaseName(items[0].file.name)}.pdf`
                    : 'merged-images.pdf';

                generatedPdfs.push({ name: mergedName, bytes: pdfBytes });
                createPreviewCard(items[0].file, mergedName, pdfUrl, 0, `${items.length} page${items.length > 1 ? 's' : ''} merged`);
            } else {
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    currentFileText.textContent = `Processing: ${item.file.name}`;
                    const pdfDoc = await PDFDocument.create();
                    await embedImageInPdf(pdfDoc, item, pageSizeMode, marginPt);

                    const pdfBytes = new Uint8Array(await pdfDoc.save());
                    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const pdfUrl = URL.createObjectURL(pdfBlob);
                    activeBlobUrls.add(pdfUrl);

                    const outputName = `${getBaseName(item.file.name)}.pdf`;
                    generatedPdfs.push({ name: outputName, bytes: pdfBytes });
                    createPreviewCard(item.file, outputName, pdfUrl, i * 60);
                    updateProgress(i + 1, items.length, `Converted ${i + 1} of ${items.length} files...`);
                }

                if (generatedPdfs.length > 1) {
                    batchActions.style.display = 'flex';
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
            generatedPdfs = generatedPdfs.filter(item => item.name !== pdfDownloadName);
            if (generatedPdfs.length < 2) {
                batchActions.style.display = 'none';
            }
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
