const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const sessionList = document.getElementById('sessionList');
const btnClearDB = document.getElementById('btnClearDB');
const btnNewChat = document.getElementById('btnNewChat');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');
const sendBtn = document.getElementById('sendBtn');

// Responsive Sidebar elements
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarClose = document.getElementById('sidebarClose');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

const API_BASE = window.location.origin;

// State Management
let currentSessionId = null;
let sessions = JSON.parse(localStorage.getItem('docuquery_sessions')) || [];

// Initialize
function init() {
    if (sessions.length === 0) {
        createNewSession();
    } else {
        // Load the most recent session
        loadSession(sessions[0].id);
    }
    renderSessionList();
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function saveState() {
    localStorage.setItem('docuquery_sessions', JSON.stringify(sessions));
    renderSessionList();
}

function createNewSession() {
    currentSessionId = generateUUID();
    const newSession = {
        id: currentSessionId,
        name: 'New Chat',
        messages: [],
        timestamp: Date.now()
    };
    sessions.unshift(newSession); // Add to top
    saveState();
    loadSession(currentSessionId);
}

function loadSession(id) {
    currentSessionId = id;
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    
    // Clear chat UI
    chatMessages.innerHTML = '';
    
    // Re-render messages
    session.messages.forEach(msg => {
        if (msg.role === 'user') {
            appendUserMessage(msg.content, false);
        } else {
            appendSystemMessage(msg.content, false, msg.sources);
        }
    });
    
    // Welcome message if empty
    if (session.messages.length === 0) {
        appendSystemMessage("Hello! Upload a document to this chat, and ask me anything about it.", false);
    }
    
    renderSessionList();

    // Auto-close sidebar on mobile
    if (window.innerWidth <= 768) {
        closeSidebarDrawer();
    }
}

function addMessageToState(role, content, sources = []) {
    const session = sessions.find(s => s.id === currentSessionId);
    if (session) {
        session.messages.push({ role, content, sources });
        // Update name based on first user message if it's "New Chat"
        if (role === 'user' && session.name === 'New Chat') {
            session.name = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        }
        session.timestamp = Date.now();
        // Sort sessions so most recent is at top
        sessions.sort((a, b) => b.timestamp - a.timestamp);
        saveState();
    }
}

function renderSessionList() {
    sessionList.innerHTML = '';
    sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'document-item';
        if (session.id === currentSessionId) {
            item.style.backgroundColor = 'var(--border-hover)';
        }

        item.innerHTML = `
            <i class="fa-regular fa-message" style="flex-shrink:0; color: var(--text-secondary);"></i>
            <span class="session-name" 
                  onclick="loadSession('${session.id}')"
                  ondblclick="startRename(event, '${session.id}')"
                  title="Double-click to rename">
                ${escapeHTML(session.name)}
            </span>
            <button class="session-delete-btn" onclick="event.stopPropagation(); deleteSession('${session.id}')" title="Delete chat">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        sessionList.appendChild(item);
    });
}

function startRename(e, id) {
    e.stopPropagation();
    const span = e.target;
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    // Replace span with an input field
    const input = document.createElement('input');
    input.type = 'text';
    input.value = session.name;
    input.className = 'session-rename-input';
    input.maxLength = 60;

    span.replaceWith(input);
    input.focus();
    input.select();

    function commitRename() {
        const newName = input.value.trim();
        if (newName && newName !== session.name) {
            session.name = newName;
            saveState();
        } else {
            renderSessionList(); // revert if empty or unchanged
        }
    }

    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commitRename); renderSessionList(); }
    });
}

function deleteSession(id) {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    
    sessions = sessions.filter(s => s.id !== id);
    saveState();
    
    // If we deleted the current active session, load something else
    if (id === currentSessionId) {
        if (sessions.length > 0) {
            loadSession(sessions[0].id);
        } else {
            createNewSession();
        }
    } else {
        renderSessionList();
    }
}

btnNewChat.addEventListener('click', createNewSession);

// === Upload Logic ===
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        handleFileUpload(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFileUpload(e.target.files[0]);
    }
});

async function handleFileUpload(file) {
    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.txt')) {
        alert('Only PDF and TXT files are supported.');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', currentSessionId);

    // Auto-close sidebar on mobile as soon as upload starts
    if (window.innerWidth <= 768) {
        closeSidebarDrawer();
    }

    appendSystemMessage(`Uploading and indexing **${file.name}** to this chat...`);

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (response.ok) {
            const successMsg = `Successfully ingested and indexed **${file.name}**. You can now ask questions about it!`;
            appendSystemMessage(successMsg);
        } else {
            throw new Error(data.detail || 'Upload failed');
        }
    } catch (error) {
        appendSystemMessage(`Error uploading document: ${error.message}`);
    }
}

// === Chat Logic ===
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query) return;

    appendUserMessage(query);
    chatInput.value = '';
    
    chatInput.disabled = true;
    sendBtn.disabled = true;
    
    // Create the message container immediately
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-message';
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="message-content" style="width: 100%;">
            <div class="markdown-body"><i class="fa-solid fa-circle-notch fa-spin"></i> Thinking...</div>
        </div>
    `;
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
    
    const contentDiv = msgDiv.querySelector('.markdown-body');
    let fullAnswer = "";
    let finalSources = [];

    try {
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, session_id: currentSessionId })
        });
        
        if (!response.ok) {
            contentDiv.innerHTML = "Sorry, I encountered an error connecting to the server.";
            return;
        }

        contentDiv.innerHTML = ""; // Clear the spinner
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');
            buffer = lines.pop(); // keep the last incomplete chunk in the buffer
            
            for (let line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.error) {
                        fullAnswer += `**Error:** ${data.error}`;
                    }
                    if (data.chunk) {
                        fullAnswer += data.chunk;
                        // Progressive markdown render
                        contentDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(fullAnswer) : escapeHTML(fullAnswer);
                    }
                    if (data.sources) {
                        finalSources = data.sources;
                    }
                } catch(e) {
                    console.error("JSON parse error on stream chunk:", line);
                }
            }
            scrollToBottom();
        }
        
        // Stream finished, render final citations and highlight code
        renderSourcesAndHighlight(msgDiv, contentDiv, finalSources);
        addMessageToState('system', fullAnswer, finalSources);

    } catch (error) {
        contentDiv.innerHTML = "Failed to connect to the backend.";
    } finally {
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.focus();
    }
});

// === UI Helpers ===
function appendUserMessage(text, save = true) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user-message';
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fa-solid fa-user"></i></div>
        <div class="message-content">${escapeHTML(text)}</div>
    `;
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
    if (save) addMessageToState('user', text);
}

// Only used for loading history now
function appendSystemMessage(text, save = true, sources = []) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-message';
    
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="message-content" style="width: 100%;">
            <div class="markdown-body">
                ${typeof marked !== 'undefined' ? marked.parse(text) : escapeHTML(text)}
            </div>
        </div>
    `;
    chatMessages.appendChild(msgDiv);
    
    const contentDiv = msgDiv.querySelector('.markdown-body');
    renderSourcesAndHighlight(msgDiv, contentDiv, sources);
    scrollToBottom();
    
    if (save) addMessageToState('system', text, sources);
}

function renderSourcesAndHighlight(msgDiv, contentDiv, sources) {
    if (sources && sources.length > 0) {
        const sourcesHtml = `
            <div class="citations">
                <span class="citations-label">Sources:</span>
                ${sources.map(src => `<div class="citation-pill"><i class="fa-solid fa-file-lines"></i> ${escapeHTML(src)}</div>`).join('')}
            </div>
        `;
        contentDiv.insertAdjacentHTML('beforeend', sourcesHtml);
    }
    
    if (typeof hljs !== 'undefined') {
        msgDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
}

function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-message';
    msgDiv.id = id;
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

btnClearDB.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to wipe the entire database and clear all chat history?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/clear`, { method: 'POST' });
        if (response.ok) {
            localStorage.removeItem('docuquery_sessions');
            sessions = [];
            createNewSession();
        }
    } catch (error) {
        alert("Failed to clear database.");
    }
});

// === Export Logic ===
const exportBtn = document.getElementById('exportBtn');
const exportDropdown = document.getElementById('exportDropdown');

exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('open');
});

// Close dropdown when clicking anywhere else
document.addEventListener('click', () => {
    exportDropdown.classList.remove('open');
});

function getCurrentSession() {
    return sessions.find(s => s.id === currentSessionId);
}

function exportAsMarkdown() {
    exportDropdown.classList.remove('open');
    const session = getCurrentSession();
    if (!session || session.messages.length === 0) {
        alert('No messages to export in this chat.');
        return;
    }

    let md = `# ${session.name}\n`;
    md += `*Exported from DocuQuery on ${new Date().toLocaleString()}*\n\n`;
    md += `---\n\n`;

    session.messages.forEach(msg => {
        if (msg.role === 'user') {
            md += `## 🧑 You\n${msg.content}\n\n`;
        } else {
            md += `## 🤖 DocuQuery\n${msg.content}\n`;
            if (msg.sources && msg.sources.length > 0) {
                md += `\n> **Sources:** ${msg.sources.join(' | ')}\n`;
            }
            md += `\n`;
        }
        md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${session.name.replace(/[^a-z0-9]/gi, '_')}_chat.md`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function exportAsPDF() {
    exportDropdown.classList.remove('open');
    const session = getCurrentSession();
    if (!session || session.messages.length === 0) {
        alert('No messages to export in this chat.');
        return;
    }

    if (typeof window.jspdf === 'undefined') {
        alert('PDF library not loaded yet. Please try again in a moment.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentWidth = pageW - margin * 2;
    let y = margin;

    // --- Color Palette (light theme, like ChatGPT export) ---
    const colors = {
        pageBg:      [255, 255, 255],
        title:       [17,  17,  17],
        subtitle:    [100, 100, 110],
        divider:     [220, 220, 225],
        userLabel:   [17,  17,  17],
        userBubble:  [243, 244, 246],
        userText:    [31,  31,  31],
        aiLabel:     [5,   150, 105],   // green
        aiBubble:    [240, 253, 249],   // very light green tint
        aiText:      [17,  17,  17],
        sourceText:  [100, 116, 139],
        sourceBorder:[203, 213, 225],
        codeText:    [51,  51,  51],
        codeBg:      [248, 248, 252],
    };

    // Fill white page background
    doc.setFillColor(...colors.pageBg);
    doc.rect(0, 0, pageW, pageH, 'F');

    // --- Helper: new page with white background ---
    function addPage() {
        doc.addPage();
        doc.setFillColor(...colors.pageBg);
        doc.rect(0, 0, pageW, pageH, 'F');
        y = margin;
    }

    // --- Helper: write wrapped text, returns new y ---
    function writeText(text, x, fontSize, color, bold = false, maxW = contentWidth) {
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        const lines = doc.splitTextToSize(String(text), maxW);
        lines.forEach(line => {
            if (y > pageH - margin - 10) addPage();
            doc.text(line, x, y);
            y += fontSize * 1.5;
        });
        return y;
    }

    // --- Helper: filled rounded bubble ---
    function drawBubble(bx, by, bw, bh, color) {
        doc.setFillColor(...color);
        doc.setDrawColor(...color);
        doc.roundedRect(bx, by, bw, bh, 5, 5, 'F');
    }

    // --- Helper: measure wrapped text height ---
    function textHeight(text, fontSize, maxW) {
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(String(text), maxW);
        return lines.length * fontSize * 1.5;
    }

    // =====================
    // HEADER
    // =====================
    // Top accent bar
    doc.setFillColor(5, 150, 105);
    doc.rect(0, 0, pageW, 4, 'F');
    y = 28;

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.title);
    doc.text(session.name, margin, y);
    y += 26;

    // Subtitle
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.subtitle);
    doc.text(`DocuQuery Export  ·  ${new Date().toLocaleString()}`, margin, y);
    y += 18;

    // Divider
    doc.setDrawColor(...colors.divider);
    doc.setLineWidth(0.75);
    doc.line(margin, y, pageW - margin, y);
    y += 20;

    // =====================
    // MESSAGES
    // =====================
    const bubblePad = 12;
    const innerW = contentWidth - bubblePad * 2;
    const labelFontSize = 9;
    const bodyFontSize = 10;
    const srcFontSize = 8;
    const labelLineH = labelFontSize * 1.6;  // height of one label line
    const bodyLineH  = bodyFontSize  * 1.6;  // height of one body line
    const srcLineH   = srcFontSize   * 1.6;  // height of one source line
    const labelBodyGap = 5;                  // gap between label and body text

    session.messages.forEach(msg => {
        const isUser = msg.role === 'user';

        // Strip markdown for clean PDF text
        const cleanText = msg.content
            .replace(/#{1,6}\s+/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, '').trim())
            .replace(/`(.*?)`/g, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // Pre-calculate all line arrays so we know exact heights before drawing
        doc.setFontSize(bodyFontSize);
        const bodyLines = doc.splitTextToSize(cleanText, innerW);

        let sourceLines = [];
        if (!isUser && msg.sources && msg.sources.length > 0) {
            doc.setFontSize(srcFontSize);
            sourceLines = doc.splitTextToSize('Sources: ' + msg.sources.join('  ·  '), innerW);
        }

        // Calculate exact bubble height
        const bodyH    = bodyLines.length * bodyLineH;
        const srcH     = sourceLines.length > 0 ? (8 + sourceLines.length * srcLineH) : 0;
        const bubbleH  = bubblePad + labelLineH + labelBodyGap + bodyH + srcH + bubblePad;

        // Page break if bubble won't fit
        if (y + bubbleH > pageH - margin - 30) addPage();

        const bx = margin;
        const by = y;

        // Draw bubble background
        drawBubble(bx, by, contentWidth, bubbleH, isUser ? colors.userBubble : colors.aiBubble);

        // ---- Label ----
        let curY = by + bubblePad + labelFontSize; // baseline of label
        doc.setFontSize(labelFontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...(isUser ? colors.userLabel : colors.aiLabel));
        doc.text(isUser ? 'You' : 'DocuQuery', bx + bubblePad, curY);

        // ---- Body text ----
        curY += (labelLineH - labelFontSize) + labelBodyGap + bodyFontSize;
        doc.setFontSize(bodyFontSize);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...(isUser ? colors.userText : colors.aiText));
        bodyLines.forEach(line => {
            doc.text(line, bx + bubblePad, curY);
            curY += bodyLineH;
        });

        // ---- Sources ----
        if (sourceLines.length > 0) {
            curY += 8;
            doc.setFontSize(srcFontSize);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(...colors.sourceText);
            sourceLines.forEach(line => {
                doc.text(line, bx + bubblePad, curY);
                curY += srcLineH;
            });
        }

        // Advance y past the bubble + gap
        y = by + bubbleH + 14;
    });


    // =====================
    // FOOTER on last page
    // =====================
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.subtitle);
    doc.text('Generated by DocuQuery · AI-Powered Document Analysis', margin, pageH - 20);
    doc.text(`Page 1`, pageW - margin, pageH - 20, { align: 'right' });

    doc.save(`${session.name.replace(/[^a-z0-9]/gi, '_')}_chat.pdf`);
}


// === Responsive Sidebar Logic ===
function closeSidebarDrawer() {
    if (sidebar && sidebarBackdrop) {
        sidebar.classList.remove('open');
        sidebarBackdrop.classList.remove('show');
    }
}

function openSidebarDrawer() {
    if (sidebar && sidebarBackdrop) {
        sidebar.classList.add('open');
        sidebarBackdrop.classList.add('show');
    }
}

if (sidebarToggle) {
    sidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        openSidebarDrawer();
    });
}

if (sidebarClose) {
    sidebarClose.addEventListener('click', () => {
        closeSidebarDrawer();
    });
}

if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
        closeSidebarDrawer();
    });
}

// Start app
init();
