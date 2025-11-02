document.addEventListener('DOMContentLoaded', () => {
    const MAX_FILES = 5;

    // অ্যাকর্ডিয়নের জন্য কোড
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isActive = header.classList.contains('active');

            // সব আইটেম বন্ধ করে দেওয়া
            accordionHeaders.forEach(h => {
                h.classList.remove('active');
                h.nextElementSibling.style.maxHeight = null;
            });

            // যদি বর্তমান আইটেমটি বন্ধ থাকে, তবে সেটি খোলা হবে
            if (!isActive) {
                header.classList.add('active');
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    });

    // (আপনার বাকি সমস্ত script.js কোড এখানে অপরিবর্তিত থাকবে)
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('file-upload-input');
    const dropZone = document.querySelector('.file-upload-wrapper');
    const progressArea = document.getElementById('progress-area');
    const progressBar = document.getElementById('progress');
    const progressText = document.getElementById('progress-text');
    const currentFileText = document.getElementById('current-file-text');
    const previewArea = document.getElementById('preview-area');
    let eventSource = null;

    fileInput.addEventListener('change', () => handleFileSelection(fileInput.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFileSelection(e.dataTransfer.files);
    });
    
    function handleFileSelection(files) {
        const fileList = Array.from(files);
        if (fileList.length > MAX_FILES) {
            alert(`You can only upload a maximum of ${MAX_FILES} files. Please select again.`);
            fileInput.value = '';
            return;
        }
        if (fileList.length > 0) {
            handleFiles(fileList);
        }
    }

    async function handleFiles(files) {
        if (eventSource) eventSource.close();
        uploadForm.style.display = 'none';
        progressArea.style.display = 'block';
        previewArea.innerHTML = '';
        const formData = new FormData();
        for (const file of files) {
            formData.append('images', file);
        }
        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) { throw new Error(result.error || `Server error: ${response.statusText}`); }
            if (result.jobId) { startStatusListener(result.jobId, files); } 
            else { throw new Error('Could not start conversion job.'); }
        } catch (error) {
            alert('Upload failed: ' + error.message);
            resetUI();
        }
    }

    function startStatusListener(jobId, originalFiles) {
        eventSource = new EventSource(`/conversion-status/${jobId}`);
        let processedFilesCount = 0;
        eventSource.onmessage = (event) => {
            const job = JSON.parse(event.data);
            const percentComplete = (job.completed / job.total) * 100;
            progressBar.style.width = percentComplete + '%';
            progressText.textContent = `Converting ${job.completed} of ${job.total} files...`;
            if (job.completed > processedFilesCount) {
                const newFiles = job.files.slice(processedFilesCount);
                newFiles.forEach(fileData => {
                    const originalFile = Array.from(originalFiles).find(f => f.name === fileData.originalName);
                    if (originalFile) {
                        createPreviewCard(originalFile, fileData, processedFilesCount * 100);
                        currentFileText.textContent = `Completed: ${originalFile.name}`;
                    }
                });
                processedFilesCount = job.completed;
            }
            const isJobDone = job.completed === job.total;
            if (isJobDone) {
                eventSource.close();
                progressText.textContent = 'Conversion Complete!';
                currentFileText.textContent = '';
                setTimeout(resetUI, 5000);
            }
            if (job.error) {
                eventSource.close();
                alert('An error occurred: ' + job.error);
                resetUI();
            }
        };
        eventSource.onerror = () => {
            eventSource.close();
            alert('Connection to server lost.');
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
            const originalPdfName = `${path.parse(fileData.originalName).name}.pdf`;
            card.innerHTML = `
                <img src="${e.target.result}" alt="Preview" class="preview-image">
                <div class="preview-info">
                    <span class="file-name">${imageFile.name}</span>
                    <div class="action-buttons">
                        <a href="/download/${fileData.pdfFile}?name=${encodeURIComponent(originalPdfName)}" class="action-btn download-btn"><i class="fas fa-download"></i> PDF</a>
                        <button class="action-btn remove-btn"><i class="fas fa-trash"></i> Remove</button>
                    </div>
                </div>`;
            previewArea.appendChild(card);
            card.querySelector('.remove-btn').addEventListener('click', () => handleRemove(card));
        };
        reader.readAsDataURL(imageFile);
    }
    
    function resetUI() {
        uploadForm.style.display = 'block';
        progressArea.style.display = 'none';
        progressBar.style.width = '0%';
        fileInput.value = '';
    }

    async function handleRemove(card) {
        const pdfFile = card.dataset.pdfFile;
        await fetch('/remove', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({filename: pdfFile}) });
        card.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => card.remove(), 300);
    }

    const path = {
        parse: function(filePath) {
            const basename = filePath.split(/[\\/]/).pop();
            const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';
            const name = basename.replace(ext, '');
            return { name, ext, base: basename };
        }
    };
});