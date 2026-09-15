const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const sessionList = document.getElementById('sessionList');
const btnNewChat = document.getElementById('btnNewChat');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');
const sendBtn = document.getElementById('sendBtn');
const userSection = document.getElementById('userSection');
const authCloseBtn = document.getElementById('authCloseBtn');
const activeChatTitle = document.getElementById('activeChatTitle');
const uploadProgress = document.getElementById('uploadProgress');

// Responsive Sidebar elements
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarClose = document.getElementById('sidebarClose');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

// Auth Modal Elements
const authModal = document.getElementById('authModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

const API_BASE = window.location.origin;

// State Management
let currentSessionId = null;
let authToken = localStorage.getItem('docuquery_token') || null;
let currentUser = null;

// Modal functions bound to window
window.openAuthModal = function(tab = 'login', mandatory = false) {
    if (authModal) {
        authModal.classList.add('active');
        window.switchAuthTab(tab);
        if (authCloseBtn) {
            authCloseBtn.style.display = mandatory ? 'none' : 'block';
        }
    }
};

window.closeAuthModal = function() {
    if (authModal) {
        authModal.classList.remove('active');
        if (loginError) loginError.style.display = 'none';
        if (registerError) registerError.style.display = 'none';
    }
};

window.switchAuthTab = function(tab) {
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    if (tab === 'login') {
        if (tabLogin) tabLogin.classList.add('active');
        if (tabRegister) tabRegister.classList.remove('active');
        if (loginForm) loginForm.classList.remove('hidden');
        if (registerForm) registerForm.classList.add('hidden');
    } else {
        if (tabRegister) tabRegister.classList.add('active');
        if (tabLogin) tabLogin.classList.remove('active');
        if (registerForm) registerForm.classList.remove('hidden');
        if (loginForm) loginForm.classList.add('hidden');
    }
};

// Toast Notifications Helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
        <span>${escapeHTML(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

// Global Auth Header helper
function getAuthHeaders(isJson = true) {
    const headers = {};
    if (isJson) headers['Content-Type'] = 'application/json';
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
}

// Initialize Application
async function init() {
    if (authToken) {
        await fetchCurrentUser();
    } else {
        showMandatoryAuth();
    }
}

function showMandatoryAuth() {
    currentUser = null;
    currentSessionId = null;
    if (userSection) userSection.innerHTML = '';
    if (sessionList) sessionList.innerHTML = '';
    renderEmptyHeroState();
    window.openAuthModal('login', true);
}

async function fetchCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: getAuthHeaders(false)
        });
        if (res.ok) {
            currentUser = await res.json();
            renderLoggedInState();
            window.closeAuthModal();
            await fetchUserSessions();
        } else {
            logout();
        }
    } catch (e) {
        console.error("Auth check error:", e);
        showMandatoryAuth();
    }
}

function renderLoggedInState() {
    if (userSection) {
        userSection.innerHTML = `
            <div class="user-badge">
                <div class="user-avatar">${currentUser.username.charAt(0).toUpperCase()}</div>
                <span>${escapeHTML(currentUser.username)}</span>
            </div>
            <button class="logout-btn" onclick="logout()" title="Sign Out">
                <i class="fa-solid fa-right-from-bracket"></i>
            </button>
        `;
    }
}

function logout() {
    localStorage.removeItem('docuquery_token');
    authToken = null;
    currentUser = null;
    currentSessionId = null;
    showToast("Signed out successfully", "success");
    showMandatoryAuth();
}

// --- Session Management ---
async function fetchUserSessions() {
    try {
        const res = await fetch(`${API_BASE}/sessions`, {
            headers: getAuthHeaders(false)
        });
        if (res.ok) {
            const sessions = await res.json();
            renderSessionList(sessions);
            if (sessions.length > 0) {
                if (!currentSessionId || !sessions.find(s => s.id === currentSessionId)) {
                    loadSession(sessions[0].id);
                }
            } else {
                createNewSession();
            }
        }
    } catch (e) {
        console.error("Error fetching sessions:", e);
    }
}

function renderSessionList(sessions) {
    if (!sessionList) return;
    sessionList.innerHTML = '';
    sessions.forEach(sess => {
        const item = document.createElement('div');
        item.className = `document-item ${sess.id === currentSessionId ? 'active' : ''}`;
        item.innerHTML = `
            <i class="fa-regular fa-message" style="flex-shrink:0;"></i>
            <span class="session-name" onclick="loadSession('${sess.id}')" title="${escapeHTML(sess.name)}">
                ${escapeHTML(sess.name)}
            </span>
            <button class="session-delete-btn" onclick="event.stopPropagation(); deleteSession('${sess.id}')" title="Delete conversation">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        sessionList.appendChild(item);
    });
}

async function createNewSession() {
    if (!authToken) {
        showMandatoryAuth();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/sessions`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ name: 'New Conversation' })
        });
        if (res.ok) {
            const newSess = await res.json();
            currentSessionId = newSess.id;
            await fetchUserSessions();
            loadSession(newSess.id);
        }
    } catch (e) {
        console.error("Error creating session:", e);
    }
}

async function loadSession(id) {
    currentSessionId = id;
    if (chatMessages) chatMessages.innerHTML = '';

    try {
        const res = await fetch(`${API_BASE}/sessions/${id}/messages`, {
            headers: getAuthHeaders(false)
        });
        if (res.ok) {
            const msgs = await res.json();
            if (msgs.length === 0) {
                renderEmptyHeroState();
            } else {
                msgs.forEach(msg => {
                    if (msg.role === 'user') {
                        appendUserMessage(msg.content);
                    } else {
                        appendSystemMessage(msg.content, msg.sources);
                    }
                });
            }
        }
    } catch (e) {
        console.error("Error loading messages:", e);
    }
    
    // Update active chat header title
    const sessItem = document.querySelector(`.document-item.active .session-name`);
    if (sessItem && activeChatTitle) {
        activeChatTitle.textContent = sessItem.textContent.trim();
    } else if (activeChatTitle) {
        activeChatTitle.textContent = "Document Workspace";
    }

    if (window.innerWidth <= 768) closeSidebarDrawer();
}

async function deleteSession(id) {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (res.ok) {
            showToast("Conversation deleted", "success");
            currentSessionId = null;
            await fetchUserSessions();
        }
    } catch (e) {
        console.error("Error deleting session:", e);
    }
}

if (btnNewChat) btnNewChat.addEventListener('click', createNewSession);

// --- Empty Hero State Renderer ---
function renderEmptyHeroState() {
    if (!chatMessages) return;
    chatMessages.innerHTML = `
        <div class="empty-hero-container">
            <div class="empty-hero-icon">
                <i class="fa-solid fa-cube"></i>
            </div>
            <h2>Document Knowledge Assistant</h2>
            <p>Upload a PDF or TXT file to extract information, query data points, or synthesize key findings.</p>
            
            <div class="empty-hero-cards">
                <div class="hero-card" onclick="triggerSampleQuery('Summarize the main points of the uploaded document.')">
                    <i class="fa-solid fa-align-left"></i>
                    <h4>Summarize Content</h4>
                    <p>Get a concise executive overview of key takeaways.</p>
                </div>
                <div class="hero-card" onclick="triggerSampleQuery('List the key requirements and metrics mentioned.')">
                    <i class="fa-solid fa-list-check"></i>
                    <h4>Key Requirements</h4>
                    <p>Extract structured criteria and data parameters.</p>
                </div>
                <div class="hero-card" onclick="triggerSampleQuery('What are the core conclusions of this document?')">
                    <i class="fa-solid fa-lightbulb"></i>
                    <h4>Core Conclusions</h4>
                    <p>Identify core findings and recommendations.</p>
                </div>
            </div>
        </div>
    `;
}

window.triggerSampleQuery = function(queryText) {
    if (chatInput) {
        chatInput.value = queryText;
        chatInput.focus();
    }
};

// --- Form Listeners ---
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (loginError) loginError.style.display = 'none';
        const username_or_email = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username_or_email, password })
            });
            const data = await res.json();

            if (res.ok) {
                authToken = data.access_token;
                localStorage.setItem('docuquery_token', authToken);
                currentUser = data.user;
                window.closeAuthModal();
                renderLoggedInState();
                showToast(`Welcome back, ${currentUser.username}!`, "success");
                await fetchUserSessions();
            } else {
                if (loginError) {
                    loginError.textContent = data.detail || 'Incorrect username or password.';
                    loginError.style.display = 'block';
                }
            }
        } catch (e) {
            if (loginError) {
                loginError.textContent = 'Server connection error.';
                loginError.style.display = 'block';
            }
        }
    });
}

if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (registerError) registerError.style.display = 'none';
        const username = document.getElementById('regUsername').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;

        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            const data = await res.json();

            if (res.ok) {
                authToken = data.access_token;
                localStorage.setItem('docuquery_token', authToken);
                currentUser = data.user;
                window.closeAuthModal();
                renderLoggedInState();
                showToast("Account created successfully!", "success");
                await fetchUserSessions();
            } else {
                if (registerError) {
                    registerError.textContent = data.detail || 'Registration failed.';
                    registerError.style.display = 'block';
                }
            }
        } catch (e) {
            if (registerError) {
                registerError.textContent = 'Server connection error.';
                registerError.style.display = 'block';
            }
        }
    });
}

// --- Upload Logic ---
if (uploadArea) {
    uploadArea.addEventListener('click', () => {
        if (!authToken) { showMandatoryAuth(); return; }
        fileInput.click();
    });

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
        if (!authToken) { showMandatoryAuth(); return; }
        if (e.dataTransfer.files.length) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFileUpload(e.target.files[0]);
        }
    });
}

async function handleFileUpload(file) {
    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.txt')) {
        showToast("Only PDF and TXT files are supported.", "error");
        return;
    }

    if (!authToken) {
        showMandatoryAuth();
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', currentSessionId);

    if (window.innerWidth <= 768) closeSidebarDrawer();

    if (uploadProgress) uploadProgress.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        const data = await response.json();
        
        if (response.ok) {
            showToast(`Indexed document: ${file.name}`, "success");
            // Clear empty hero state if visible
            const emptyHero = document.querySelector('.empty-hero-container');
            if (emptyHero) emptyHero.remove();
            
            appendSystemMessage(`Indexed document **${file.name}**. You can now ask questions about its content.`);
        } else {
            throw new Error(data.detail || 'Upload failed');
        }
    } catch (error) {
        showToast(`Upload failed: ${error.message}`, "error");
    } finally {
        if (uploadProgress) uploadProgress.classList.add('hidden');
    }
}

// --- Chat Streaming Logic ---
if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!authToken) {
            showMandatoryAuth();
            return;
        }

        const query = chatInput.value.trim();
        if (!query) return;

        // Clear empty state if present
        const emptyHero = document.querySelector('.empty-hero-container');
        if (emptyHero) emptyHero.remove();

        appendUserMessage(query);
        chatInput.value = '';
        
        chatInput.disabled = true;
        sendBtn.disabled = true;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message system-message';
        msgDiv.innerHTML = `
            <div class="message-avatar"><i class="fa-solid fa-cube"></i></div>
            <div class="message-content">
                <div class="markdown-body"><i class="fa-solid fa-circle-notch fa-spin"></i> Analyzing...</div>
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
                headers: getAuthHeaders(true),
                body: JSON.stringify({ query: query, session_id: currentSessionId })
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    showMandatoryAuth();
                    return;
                }
                contentDiv.innerHTML = "An error occurred connecting to the intelligence engine.";
                return;
            }

            contentDiv.innerHTML = "";
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();
                
                for (let line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.error) {
                            fullAnswer += `**Error:** ${data.error}`;
                        }
                        if (data.chunk) {
                            fullAnswer += data.chunk;
                            contentDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(fullAnswer) : escapeHTML(fullAnswer);
                        }
                        if (data.sources) {
                            finalSources = data.sources;
                        }
                    } catch(e) {
                        console.error("JSON parse error:", line);
                    }
                }
                scrollToBottom();
            }
            
            renderSourcesAndHighlight(msgDiv, contentDiv, finalSources);

        } catch (error) {
            contentDiv.innerHTML = "Unable to reach backend service.";
        } finally {
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatInput.focus();
        }
    });
}

// --- UI Helpers ---
function appendUserMessage(text) {
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user-message';
    msgDiv.innerHTML = `
        <div class="message-inner">${escapeHTML(text)}</div>
    `;
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
}

function appendSystemMessage(text, sources = []) {
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-message';
    
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fa-solid fa-cube"></i></div>
        <div class="message-content">
            <div class="markdown-body">
                ${typeof marked !== 'undefined' ? marked.parse(text) : escapeHTML(text)}
            </div>
        </div>
    `;
    chatMessages.appendChild(msgDiv);
    
    const contentDiv = msgDiv.querySelector('.markdown-body');
    renderSourcesAndHighlight(msgDiv, contentDiv, sources);
    scrollToBottom();
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

function scrollToBottom() {
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
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

// Export Dropdown Logic
const exportBtn = document.getElementById('exportBtn');
const exportDropdown = document.getElementById('exportDropdown');

if (exportBtn && exportDropdown) {
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportDropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        exportDropdown.classList.remove('open');
    });
}

function exportAsMarkdown() {
    if (exportDropdown) exportDropdown.classList.remove('open');
    const messages = chatMessages.querySelectorAll('.message');
    if (messages.length === 0) {
        showToast("No messages to export", "error");
        return;
    }

    let md = `# Conversation Export - DocuQuery\n`;
    md += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

    messages.forEach(msg => {
        if (msg.classList.contains('user-message')) {
            const content = msg.querySelector('.message-inner').innerText;
            md += `## 🧑 User\n${content}\n\n`;
        } else if (msg.classList.contains('system-message')) {
            const content = msg.querySelector('.markdown-body').innerText;
            md += `## 🤖 DocuQuery\n${content}\n\n`;
        }
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `DocuQuery_Export_${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Exported Markdown file", "success");
}

function exportAsPDF() {
    if (exportDropdown) exportDropdown.classList.remove('open');
    if (typeof window.jspdf === 'undefined') {
        showToast("PDF library loading...", "error");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 40;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text("DocuQuery - Conversation Export", margin, y);
    y += 20;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Exported on ${new Date().toLocaleString()}`, margin, y);
    y += 25;

    const messages = chatMessages.querySelectorAll('.message');
    messages.forEach(msg => {
        const isUser = msg.classList.contains('user-message');
        const text = isUser 
            ? msg.querySelector('.message-inner').innerText 
            : msg.querySelector('.markdown-body').innerText;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(isUser ? 30 : 99, isUser ? 41 : 102, isUser ? 59 : 241);
        doc.text(isUser ? "User:" : "DocuQuery:", margin, y);
        y += 15;

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        const lines = doc.splitTextToSize(text, pageW - margin * 2);
        lines.forEach(line => {
            if (y > 780) { doc.addPage(); y = 40; }
            doc.text(line, margin, y);
            y += 14;
        });
        y += 15;
    });

    doc.save(`DocuQuery_Export_${Date.now()}.pdf`);
    showToast("Exported PDF document", "success");
}

// Drawer listeners
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

if (sidebarToggle) sidebarToggle.addEventListener('click', (e) => { e.stopPropagation(); openSidebarDrawer(); });
if (sidebarClose) sidebarClose.addEventListener('click', () => closeSidebarDrawer());
if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', () => closeSidebarDrawer());

// Start Application
init();
