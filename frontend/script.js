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

// Global Auth Header helper
function getAuthHeaders(isJson = true) {
    const headers = {};
    if (isJson) headers['Content-Type'] = 'application/json';
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
}

// Initialize application
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
    if (chatMessages) {
        chatMessages.innerHTML = `
            <div class="message system-message">
                <div class="message-avatar"><i class="fa-solid fa-robot"></i></div>
                <div class="message-content">Welcome to DocuQuery! Please sign in to access your workspace.</div>
            </div>
        `;
    }
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
        item.className = 'document-item';
        if (sess.id === currentSessionId) {
            item.style.backgroundColor = 'var(--border-hover)';
        }

        item.innerHTML = `
            <i class="fa-regular fa-message" style="flex-shrink:0; color: var(--text-secondary);"></i>
            <span class="session-name" onclick="loadSession('${sess.id}')" title="${escapeHTML(sess.name)}">
                ${escapeHTML(sess.name)}
            </span>
            <button class="session-delete-btn" onclick="event.stopPropagation(); deleteSession('${sess.id}')" title="Delete chat">
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
            body: JSON.stringify({ name: 'New Chat' })
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
                appendSystemMessage("Hello! Upload a document to this chat, and ask me anything about it.", false);
            } else {
                msgs.forEach(msg => {
                    if (msg.role === 'user') {
                        appendUserMessage(msg.content, false);
                    } else {
                        appendSystemMessage(msg.content, false, msg.sources);
                    }
                });
            }
        }
    } catch (e) {
        console.error("Error loading messages:", e);
    }
    await fetchUserSessions();

    if (window.innerWidth <= 768) closeSidebarDrawer();
}

async function deleteSession(id) {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (res.ok) {
            currentSessionId = null;
            await fetchUserSessions();
        }
    } catch (e) {
        console.error("Error deleting session:", e);
    }
}

if (btnNewChat) btnNewChat.addEventListener('click', createNewSession);

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
                await fetchUserSessions();
            } else {
                if (loginError) {
                    loginError.textContent = data.detail || 'Login failed.';
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
        alert('Only PDF and TXT files are supported.');
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

    appendSystemMessage(`Uploading and indexing **${file.name}**...`);

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
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

// --- Chat Logic ---
if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!authToken) {
            showMandatoryAuth();
            return;
        }

        const query = chatInput.value.trim();
        if (!query) return;

        appendUserMessage(query);
        chatInput.value = '';
        
        chatInput.disabled = true;
        sendBtn.disabled = true;
        
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
                headers: getAuthHeaders(true),
                body: JSON.stringify({ query: query, session_id: currentSessionId })
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    showMandatoryAuth();
                    return;
                }
                contentDiv.innerHTML = "Sorry, I encountered an error connecting to the server.";
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
            contentDiv.innerHTML = "Failed to connect to the backend.";
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
        <div class="message-avatar"><i class="fa-solid fa-user"></i></div>
        <div class="message-content">${escapeHTML(text)}</div>
    `;
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
}

function appendSystemMessage(text, save = false, sources = []) {
    if (!chatMessages) return;
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
