/**
 * RelayPay Admin Dashboard — Logic
 * =================================
 * Handles Authentication, Single Page Navigation,
 * Analytics Loading, and Team Management.
 */const ANALYTICS_WEBHOOK     = "/api/proxy?path=relaypay-analytics";
const AUTH_REQUEST_WEBHOOK  = "/api/proxy?path=request-login";
const AUTH_VERIFY_WEBHOOK   = "/api/proxy?path=verify-login";
const TEAM_ADD_WEBHOOK      = "/api/proxy?path=add-team-member";
const TEAM_REVOKE_WEBHOOK   = "/api/proxy?path=revoke-team-member";
const TEAM_RESTORE_WEBHOOK  = "/api/proxy?path=restore-team-member";
const RESOLVE_WEBHOOK       = "/api/proxy?path=resolve-interaction";
const KB_INGEST_WEBHOOK     = "/api/proxy?path=relaypay-ingest-document";
const KB_STATUS_WEBHOOK     = "/api/proxy?path=relaypay-kb-status";
const KB_DELETE_WEBHOOK     = "/api/proxy?path=relaypay-delete-source";
const KB_LOGS_WEBHOOK       = "/api/proxy?path=relaypay-ingestion-logs";
;


// ---- 0. Supabase Client (Fetemi Style) -----------------------------------
const SUPABASE_URL = "https://odlleknbpngxhacsifol.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kbGxla25icG5neGhhY3NpZm9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDAzNTksImV4cCI6MjA5MTAxNjM1OX0.VPvejvk1nA8RPuCxB8ZHhuqoczPy5ow7w1-G--_RPEo";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Shared secret for webhook auth — now handled by Vercel API Proxy.
const WEBHOOK_SECRET = ""; 

// State
let allCalls = [];
let activeView = 'analytics';
let activeStatusFilter = 'all'; // Added status filter state
let currentUser = null;

// ---- 1. Initialization & Auth ---------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  setupNavigation();
  setupEventListeners();
  
  // 1. Check for manual logout or expired session
  const session = localStorage.getItem('relaypay_admin_session');
  
  // 2. Check for token in URL (Magic Link arrival)
  const urlParams = new URL(window.location.href).searchParams;
  const token = urlParams.get('token');

  if (token) {
    await verifyToken(token);
  } else if (session) {
    currentUser = JSON.parse(session);
    showDashboard();
  } else {
    showLoginOverlay();
  }
}

function showLoginOverlay() {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('login-form-container').style.display = 'block';
  document.getElementById('login-success-container').style.display = 'none';
}

function showDashboard() {
  document.getElementById('auth-overlay').style.display = 'none';
  updateUserInfo();
  loadView('analytics'); // Default view
}

function updateUserInfo() {
  if (!currentUser) return;
  const initials = currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase();
  document.getElementById('user-initials').textContent = initials;
  document.getElementById('user-name').textContent = currentUser.name;
  document.getElementById('user-role').textContent = currentUser.role || 'Team Member';
  
  // Role-based visibility: Hide Team Management for non-admins
  const teamNavLink = document.querySelector('.nav-item[data-view="team"]');
  if (teamNavLink) {
    teamNavLink.style.display = currentUser.role === 'Admin' ? 'flex' : 'none';
  }
}

async function verifyToken(token) {
  const msgEl = document.getElementById('auth-msg');
  msgEl.textContent = "Verifying link...";
  msgEl.className = "auth-msg success";
  msgEl.style.display = "block";

  try {
    const res = await fetch(`${AUTH_VERIFY_WEBHOOK}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    
    const data = await res.json();
    if (data.success) {
      currentUser = { name: data.name, email: data.email, role: data.role };
      localStorage.setItem('relaypay_admin_session', JSON.stringify(currentUser));
      window.history.replaceState({}, document.title, window.location.pathname);
      showDashboard();
    } else {
      // Handle variations like {success:false, error:"revoked"} or {error:"Unauthorized"}
      const err = data.error || (data.status === "401" ? "Unauthorized" : "Invalid login link.");
      showAuthError(err);
    }
  } catch (err) {
    showAuthError("Connection error during verification.");
  }
}

function showAuthError(msg) {
  const msgEl = document.getElementById('auth-msg');
  msgEl.textContent = msg;
  msgEl.className = "auth-msg error";
  msgEl.style.display = "block";
}

window.requestMagicLink = async () => {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) return showAuthError("Please enter your email address.");

  const btn = document.getElementById('btn-request-magic');
  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    // Simplified fetch to bypass CORS 'Preflight' issues.
    // We send the token in the URL for better reliability across environments.
    const res = await fetch(`${AUTH_REQUEST_WEBHOOK}`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirect_to: 'admin.html' })
    });
    
    let data = { success: false };
    try {
      data = await res.json();
    } catch (e) {
      if (res.ok) data.success = true;
    }

    if (res.ok && data.success) {
      document.getElementById('login-form-container').style.display = 'none';
      document.getElementById('sent-email-display').textContent = email;
      document.getElementById('login-success-container').style.display = 'block';
    } else {
      const err = data.error || (data.status === "401" ? "Unauthorized" : "Failed to send link. Check authorization.");
      showAuthError(err);
    }
  } catch (err) {
    console.error("Fetch details:", err);
    showAuthError("Connection error. Ensure 'Respond to Options Request' is ON in n8n trigger.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Login Link";
  }
};

window.signOut = () => {
  localStorage.removeItem('relaypay_admin_session');
  window.location.reload();
}

// ---- 2. View Switching & Navigation ----------------------------------------

function setupNavigation() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      const view = item.getAttribute('data-view');
      loadView(view);
      
      // Update UI active state
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

function loadView(viewId) {
  // Security Check: Block non-admins from sensitive areas
  if ((viewId === 'team' || viewId === 'kb') && currentUser?.role !== 'Admin') {
    console.warn("Unauthorized access attempt to " + viewId);
    loadView('analytics'); // Redirect back to safety
    return;
  }

  activeView = viewId;
  const sections = document.querySelectorAll('.view-section');
  sections.forEach(s => s.classList.remove('active'));
  
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');

  // Update title
  const titles = {
    analytics: 'Analytics Overview',
    team: 'Team Management',
    kb: 'Knowledge Base Management',
    settings: 'AI Settings'
  };
  document.getElementById('view-title').textContent = titles[viewId] || 'Dashboard';

  // Load specific data
  if (viewId === 'analytics') loadAnalyticsData();
  if (viewId === 'team') loadTeamRoster();
  if (viewId === 'kb') {
    window.loadKBStatus();
    window.loadIngestionLogs();
  }
}

// ---- 3. Analytics View Logic ------------------------------------------------

async function loadAnalyticsData() {
  try {
    const res = await fetch(`${ANALYTICS_WEBHOOK}`);
    
    if (!res.ok) {
      if (res.status === 401) throw new Error("Unauthorized: Invalid dashboard secret.");
      throw new Error("Analytics update failed.");
    }
    
    const data = await res.json();
    allCalls = data.recent_calls || [];
    renderStats(data);
    applyAnalyticsFilters(); 
  } catch (err) {
    console.error(err);
    if (err.message.includes("Unauthorized")) {
      alert("Session Error: You are not authorized to view this data.");
    }
  }
}

function renderStats(data) {
  const calls = data.recent_calls || [];
  const total = calls.length || data.total_calls || 0;
  
  if (total === 0) {
    document.getElementById("stat-total").textContent = "0";
    return;
  }

  // Calculate metrics from the raw data provided by n8n
  const escalatedCount = calls.filter(c => c.escalated).length;
  const teamResolvedCount = calls.filter(c => c.escalated && c.resolved).length;
  const aiHandledCount = total - escalatedCount;
  
  // 1. Escalation Rate: % of calls that went to a human
  const escRate = Math.round((escalatedCount / total) * 100);
  
  // 2. AI Resolution: % of total calls handled entirely by AI
  const aiRate = Math.round((aiHandledCount / total) * 100);
  
  // 3. Team Resolution: % of escalated calls that were actually resolved by admins
  const teamRate = escalatedCount > 0 ? Math.round((teamResolvedCount / escalatedCount) * 100) : 0;
  
  // 4. Combined Success: (AI Handled + Team Resolved) / Total
  const successRate = Math.round(((aiHandledCount + teamResolvedCount) / total) * 100);

  // Update the UI
  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-success-rate").textContent = `Combined Success: ${successRate}%`;
  document.getElementById("stat-ai-res").textContent = `${aiRate}%`;
  document.getElementById("stat-team-res").textContent = `${teamRate}%`;
  document.getElementById("stat-esc-rate").textContent = `${escRate}%`;
  document.getElementById("stat-avg-duration").textContent = `Avg: ${Math.round(data.avg_duration_s || 0)}s`;
}

window.setStatusFilter = (status) => {
  activeStatusFilter = status;
  // Update UI button states
  ['all', 'pending', 'team-resolved', 'ai-handled'].forEach(f => {
    const el = document.getElementById(`filter-${f}`);
    if (el) el.classList.toggle('active', f === status);
  });
  applyAnalyticsFilters();
};

window.applyAnalyticsFilters = () => {
  const searchTerm = document.getElementById("searchInput").value.trim().toLowerCase();
  const dateFrom = document.getElementById("dateFrom").value;
  const dateTo = document.getElementById("dateTo").value;

  let filtered = allCalls;

  // 1. Granular Status Filter
  if (activeStatusFilter === 'pending') {
    filtered = filtered.filter(c => c.escalated && !c.resolved);
  } else if (activeStatusFilter === 'team-resolved') {
    filtered = filtered.filter(c => c.escalated && c.resolved);
  } else if (activeStatusFilter === 'ai-handled') {
    filtered = filtered.filter(c => !c.escalated);
  }

  // 2. Date Filter
  if (dateFrom || dateTo) {
    filtered = filtered.filter(c => {
      const callDate = new Date(c.started_at);
      callDate.setHours(0, 0, 0, 0);
      if (dateFrom && callDate < new Date(dateFrom)) return false;
      if (dateTo && callDate > new Date(dateTo)) return false;
      return true;
    });
  }

  // Search Filter
  if (searchTerm) {
    filtered = filtered.filter(c => 
      (c.escalation_ref && c.escalation_ref.toLowerCase().includes(searchTerm)) ||
      (c.call_id && c.call_id.toLowerCase().includes(searchTerm))
    );
  }

  renderCallsTable(filtered);
};

function renderCallsTable(calls) {
  const tb = document.getElementById("callsTable");
  tb.innerHTML = "";

  if (!calls || calls.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;">No results found</td></tr>';
    return;
  }

  calls.forEach(c => {
    const tr = document.createElement("tr");
    const dateStr = new Date(c.started_at).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const escBadge = c.escalated ? '<span class="badge success">Yes</span>' : '<span class="badge neutral">No</span>';

    // Resolution Status / Action
    let statusCell = '-';
    if (c.escalated) {
      if (c.resolved) {
        statusCell = '<span class="badge success">Resolved</span>';
      } else {
        statusCell = `<button class="btn btn-outline" style="padding:4px 8px; font-size:11px; color:var(--text-success);" onclick="resolveInteraction('${c.call_id}')">Resolve</button>`;
      }
    }

    tr.innerHTML = `
      <td>${dateStr}</td>
      <td>${c.duration_s}s</td>
      <td>${escBadge}</td>
      <td style="font-family:monospace; color:var(--blue-accent); font-weight:600;">${c.escalation_ref || '-'}</td>
      <td>${statusCell}</td>
      <td style="color:var(--text-muted); font-size:12px;">${c.end_reason || 'unknown'}</td>
    `;
    tb.appendChild(tr);
  });
}

window.resolveInteraction = async (callId) => {
  if (!confirm("Mark this escalation as resolved?")) return;

  try {
    const res = await fetch(`${RESOLVE_WEBHOOK}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      loadAnalyticsData(); 
    } else {
      const err = data.error || data.message || (data.status === "401" ? "Unauthorized" : "Failed to update status.");
      alert("Error: " + err);
    }
  } catch (err) {
    alert("Network error while resolving interaction.");
  }
};

// ---- 4. Team Management Logic ---------------------------------------------

async function loadTeamRoster() {
  const tb = document.getElementById('team-table-body');
  try {
    const { data: members, error } = await supabaseClient
      .from('team_members')
      .select('*')
      .order('invited_at', { ascending: false });

    if (error) throw error;
    
    tb.innerHTML = '';
    if (!members || members.length === 0) {
      tb.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px;">No members yet</td></tr>';
      return;
    }

    members.forEach(m => {
      const tr = document.createElement('tr');
      const badgeClass = m.status === 'Active' ? 'success' : 'neutral';
      
      const actionBtn = m.status === 'Active' 
        ? `<button class="btn btn-outline" style="padding:4px 8px; font-size:11px; color:var(--text-error);" onclick="teamAction('${m.id}', 'revoke')">Revoke</button>`
        : `<button class="btn btn-outline" style="padding:4px 8px; font-size:11px; color:var(--text-success);" onclick="teamAction('${m.id}', 'restore')">Restore</button>`;

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600;">${m.name}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${m.email}</div>
        </td>
        <td style="font-size: 12px; font-weight: 500;">${m.role}</td>
        <td><span class="badge ${badgeClass}">${m.status}</span></td>
        <td>${actionBtn}</td>
      `;
      tb.appendChild(tr);
    });
  } catch (err) {
    console.error('Roster load error:', err);
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--text-error);">Failed to load roster from Supabase</td></tr>';
  }
}

window.teamAction = async (id, type) => {
  if (!confirm(`Are you sure you want to ${type} this member's access?`)) return;
  
  const webhook = type === 'revoke' ? TEAM_REVOKE_WEBHOOK : TEAM_RESTORE_WEBHOOK;

  try {
    const res = await fetch(`${webhook}`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    
    const data = await res.json();
    if (!res.ok || data.success === false) {
      const err = data.error || data.message || (data.status === "401" ? "Unauthorized" : "Action failed");
      alert("Error: " + err);
    }
    loadTeamRoster();
  } catch (err) {
    alert("Action failed. Check bridge configuration.");
  }
};

window.handleInvite = async () => {
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const role = document.getElementById('invite-role').value;
  const msgEl = document.getElementById('team-form-msg');

  if (!name || !email) {
    msgEl.textContent = "Please fill all fields.";
    msgEl.style.display = 'block';
    msgEl.style.background = '#FEE2E2';
    return;
  }

  const btn = document.getElementById('btn-invite');
  btn.disabled = true;
  btn.textContent = "Inviting...";

  try {
    const res = await fetch(`${TEAM_ADD_WEBHOOK}`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      msgEl.textContent = data.message || "Invitation sent successfully!";
      msgEl.className = "auth-msg success";
      msgEl.style.display = "block";
      document.getElementById('invite-name').value = "";
      document.getElementById('invite-email').value = "";
      loadTeamRoster();
    } else {
      const err = data.error || data.message || (data.status === "401" ? "Unauthorized" : "Invitation failed");
      msgEl.textContent = err;
      msgEl.className = "auth-msg error";
      msgEl.style.display = "block";
    }
  } catch (err) {
    msgEl.textContent = "Network error. Is n8n reachable?";
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Invitation";
  }
};

// ---- 5. Knowledge Base Logic -----------------------------------------------

let kbProcessingText = "";
let kbActiveTab = 'paste';
let kbSourceToDelete = null;

window.handleSourceChange = () => {
  const select = document.getElementById('ingestSource');
  const input = document.getElementById('newSourceInput');
  input.style.display = select.value === 'NEW' ? 'block' : 'none';
  window.checkKBFormValid();
};

window.toggleModeWarning = () => {
  const isReplace = document.querySelector('input[name="mode"]:checked').value === 'replace';
  document.getElementById('modeWarning').style.display = isReplace ? 'block' : 'none';
};

window.switchKBTab = (tab) => {
  document.getElementById('tab-btn-paste').classList.remove('active');
  document.getElementById('tab-btn-upload').classList.remove('active');
  document.getElementById(`tab-btn-${tab}`).classList.add('active');
  
  document.getElementById('kb-tab-paste').style.display = 'none';
  document.getElementById('kb-tab-upload').style.display = 'none';
  document.getElementById(`kb-tab-${tab}`).style.display = 'block';
  
  kbActiveTab = tab;
  window.updateKBEstimate();
};

window.checkKBFormValid = () => {
  const select = document.getElementById('ingestSource').value;
  const newSource = document.getElementById('newSourceInput').value.trim();
  const hasSource = select !== 'NEW' || newSource !== '';
  const hasContent = kbProcessingText.trim().length > 0;
  document.getElementById('btnIngest').disabled = !(hasSource && hasContent);
};

window.updateKBEstimate = () => {
  if (kbActiveTab === 'paste') {
    kbProcessingText = document.getElementById('pasteInput').value;
  }
  const charCount = kbProcessingText.length;
  // Adjusted for CHUNK_SIZE=500, OVERLAP=50
  const estimate = charCount > 0 ? Math.ceil((charCount - 50) / 450) : 0;
  const box = document.getElementById('estimateOutput');
  
  if (charCount === 0) {
    box.textContent = "Ready. Enter text to estimate chunks.";
  } else {
    box.innerHTML = `Approximately <strong>${estimate}</strong> chunks will be created.`;
  }
  window.checkKBFormValid();
};

window.handleFileUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const dropZone = document.getElementById('dropZone');
  const preview = document.getElementById('extractedTextPreview');
  dropZone.textContent = `Processing ${file.name}...`;
  preview.style.display = 'none';

  try {
    if (file.name.endsWith('.txt')) {
      kbProcessingText = await file.text();
    } else if (file.name.endsWith('.pdf')) {
      kbProcessingText = await parsePDF(file);
    } else if (file.name.endsWith('.docx')) {
      kbProcessingText = await parseDOCX(file);
    } else {
      throw new Error("Unsupported format.");
    }
    
    dropZone.innerHTML = `Loaded: <strong>${file.name}</strong> <br><small>Click to pick another</small>`;
    preview.textContent = kbProcessingText.substring(0, 300) + (kbProcessingText.length > 300 ? "..." : "");
    preview.style.display = 'block';
    window.updateKBEstimate();
  } catch (err) {
    dropZone.textContent = "Error processing file. Try again.";
    console.error(err);
    alert(err.message);
  }
};

async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n\n";
  }
  return text;
}

async function parseDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

window.loadKBStatus = async () => {
  const tbody = document.getElementById('kbTableBody');
  try {
    const res = await fetch(`${KB_STATUS_WEBHOOK}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed loading KB stats");
    
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No sources found</td></tr>';
      return;
    }

    const selects = document.getElementById('ingestSource');
    const knownSources = ['FAQ', 'Policies & Compliance', 'Product Features', 'Release Notes'];

    data.forEach(row => {
      if(!knownSources.includes(row.source)) knownSources.push(row.source);
      
      const tr = document.createElement('tr');
      const dateStr = row.last_updated ? new Date(row.last_updated).toLocaleDateString() : 'Unknown';
      const escapedSrc = row.source.replace(/'/g, "\\'");
      tr.innerHTML = `
        <td><strong>${row.source}</strong></td>
        <td>${row.chunk_count}</td>
        <td>${dateStr}</td>
        <td>
          <button class="btn btn-outline" style="padding:2px 6px; font-size:11px;" onclick="prepReingest('${escapedSrc}')">Re-ingest</button>
          <button class="btn btn-danger" style="padding:2px 6px; font-size:11px; margin-left:5px;" onclick="openDeleteModal('${escapedSrc}')">Del</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    selects.innerHTML = knownSources.map(s => `<option value="${s}">${s}</option>`).join('') + `<option value="NEW">New source...</option>`;
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger); text-align:center;">Failed: ${e.message}</td></tr>`;
  }
};

window.loadIngestionLogs = async () => {
  const tbody = document.getElementById('logsTableBody');
  try {
    const res = await fetch(`${KB_LOGS_WEBHOOK}`);
    const data = await res.json();
    if (!res.ok) throw Error(data.error || "Failed to load logs");
    
    tbody.innerHTML = '';
    if(data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No logs found</td></tr>';
      return;
    }
    
    data.forEach(row => {
      const tr = document.createElement('tr');
      const dateStr = new Date(row.run_at).toLocaleString();
      let color = 'var(--text-success)';
      if(row.status === 'error') color = 'var(--danger)';
      if(row.status === 'partial') color = 'var(--warning)';
      const sourceDesc = row.files_processed ? row.files_processed.join(', ') : 'Unknown';
      let errText = row.error_message ? `<br><small style="color:var(--danger)">${row.error_message}</small>` : '';

      tr.innerHTML = `
        <td style="font-size:12px">${dateStr}</td>
        <td>${sourceDesc}</td>
        <td>${row.chunks_inserted} <small>added</small></td>
        <td>
          <strong style="color:${color}; text-transform:uppercase; font-size:11px;">${row.status}</strong>
          ${errText}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger); text-align:center;">Failed: ${e.message}</td></tr>`;
  }
};

window.prepReingest = (source) => {
  document.getElementById('ingestSource').value = source;
  document.querySelector('input[name="mode"][value="replace"]').checked = true;
  window.toggleModeWarning();
  window.handleSourceChange();
  document.getElementById('view-kb').scrollTo({top: 0, behavior: 'smooth'});
};

window.openDeleteModal = (source) => {
  kbSourceToDelete = source;
  document.getElementById('deleteConfirmText').innerHTML = `You are about to permanently delete all chunks from <strong>${source}</strong>. This cannot be undone.`;
  document.getElementById('deleteModal').style.display = 'block';
  document.getElementById('modalBackdrop').style.display = 'block';
};

window.closeDeleteModal = () => {
  document.getElementById('deleteModal').style.display = 'none';
  document.getElementById('modalBackdrop').style.display = 'none';
  kbSourceToDelete = null;
};

window.confirmDelete = async () => {
  if(!kbSourceToDelete) return;
  try {
    const res = await fetch(`${KB_DELETE_WEBHOOK}`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: kbSourceToDelete })
    });
    if(!res.ok) throw new Error("Delete failed");
    window.closeDeleteModal();
    window.loadKBStatus();
    window.loadIngestionLogs();
  } catch(err) {
    alert("Delete error: " + err.message);
  }
};

window.submitIngestion = async () => {
  const btn = document.getElementById('btnIngest');
  const alertBox = document.getElementById('kbStatusAlert');
  
  const selectVal = document.getElementById('ingestSource').value;
  const source = selectVal === 'NEW' ? document.getElementById('newSourceInput').value.trim() : selectVal;
  const mode = document.querySelector('input[name="mode"]:checked').value;

  btn.disabled = true;
  btn.textContent = "Ingesting... Please wait";
  alertBox.style.display = 'none';

  try {
    const res = await fetch(`${KB_INGEST_WEBHOOK}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, mode, content: kbProcessingText })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alertBox.style.background = "var(--bg)";
      alertBox.style.color = "var(--text-success)";
      alertBox.style.border = "1px solid var(--border)";
      alertBox.innerHTML = `✓ Successfully ingested <strong>${data.chunks_created || 0}</strong> chunks into ${source}.`;
      
      if(kbActiveTab === 'paste') document.getElementById('pasteInput').value = '';
      else {
        document.getElementById('fileInput').value = '';
        document.getElementById('dropZone').textContent = "Click to select a file";
        document.getElementById('extractedTextPreview').style.display = 'none';
      }
      kbProcessingText = "";
      window.updateKBEstimate();
    } else {
      throw new Error(data.error || "Ingestion failed.");
    }
  } catch (err) {
    alertBox.style.background = "var(--bg)";
    alertBox.style.color = "var(--danger)";
    alertBox.style.border = "1px solid var(--danger)";
    alertBox.textContent = `Error: ${err.message}`;
  } finally {
    btn.textContent = "Ingest Knowledge";
    alertBox.style.display = 'block';
    window.loadKBStatus();
    window.loadIngestionLogs();
  }
};

// ---- 6. Event Listeners ----------------------------------------------------

function setupEventListeners() {
  document.getElementById('btn-request-magic').addEventListener('click', window.requestMagicLink);
  document.getElementById('btn-invite').addEventListener('click', window.handleInvite);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    if (activeView === 'analytics') loadAnalyticsData();
    if (activeView === 'team') loadTeamRoster();
    if (activeView === 'kb') {
      loadKBStatus();
      loadIngestionLogs();
    }
  });
  
  // Enter keys
  document.getElementById('auth-email').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') window.requestMagicLink();
  });
}
