// PW Exam Shield - Mobile CBT Engine & Anti-Screenshot Controller

let studentName = localStorage.getItem('PW_STUDENT_NAME') || '';
let rollNumber = localStorage.getItem('PW_STUDENT_ROLL') || '';
let batchCode = localStorage.getItem('PW_BATCH_CODE') || 'PWJEE1';

let allTests = [];
let filteredCategory = 'ALL';
let selectedTestId = null;

let currentTest = null;
let questions = [];
let responses = {};
let activeQuestionIndex = 0;
let activeSection = '';
let sectionsList = [];
let timerInterval = null;
let secondsLeft = 180 * 60;

// Initialize on DOM Ready
window.addEventListener('DOMContentLoaded', async () => {
  initCandidateProfile();
  updateServerHostDisplay();
  setupAntiScreenshot();
  await loadBatchesAndTests();
});

function initCandidateProfile() {
  if (!studentName || !rollNumber) {
    setTimeout(openProfileModal, 500);
  } else {
    updateProfileDisplay();
  }
}

function updateProfileDisplay() {
  const nameEl = document.getElementById('portal-student-name');
  const rollEl = document.getElementById('portal-student-roll');
  const avatarEl = document.getElementById('portal-avatar');
  const examStudentLabel = document.getElementById('exam-student-label');
  const examAvatarEl = document.getElementById('exam-user-avatar');

  const displayName = studentName || 'Candidate';
  const targetExam = localStorage.getItem('PW_STUDENT_TARGET') || 'Target: JEE 2026';

  if (nameEl) nameEl.innerText = displayName;
  if (rollEl) rollEl.innerText = `Roll: ${rollNumber || 'Not set'} • ${targetExam}`;
  if (examStudentLabel) examStudentLabel.innerText = displayName;

  // Compute initials for avatar (e.g. Vivek Sharma -> VS)
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .map(p => p[0].toUpperCase())
    .slice(0, 2)
    .join('') || 'PW';

  if (avatarEl) avatarEl.innerText = initials;
  if (examAvatarEl) examAvatarEl.innerText = initials;

  setupWatermark();
}

function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) {
    document.getElementById('prof-name-input').value = studentName;
    document.getElementById('prof-roll-input').value = rollNumber;
    const targetSelect = document.getElementById('prof-target-select');
    const savedTarget = localStorage.getItem('PW_STUDENT_TARGET');
    if (targetSelect && savedTarget) targetSelect.value = savedTarget;
    modal.style.display = 'flex';
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
}

function saveCandidateProfile() {
  const name = (document.getElementById('prof-name-input').value || '').trim();
  const roll = (document.getElementById('prof-roll-input').value || '').trim();
  const targetSelect = document.getElementById('prof-target-select');
  const target = targetSelect ? targetSelect.value : 'Target: JEE 2026';

  if (!name || !roll) {
    alert('Please enter your full name and mobile or roll number.');
    return;
  }
  studentName = name;
  rollNumber = roll;
  localStorage.setItem('PW_STUDENT_NAME', name);
  localStorage.setItem('PW_STUDENT_ROLL', roll);
  localStorage.setItem('PW_STUDENT_TARGET', target);
  closeProfileModal();
  updateProfileDisplay();
}

function updateServerHostDisplay() {
  const label = document.getElementById('server-host-label');
  if (label && window.getApiHost) {
    try {
      const url = new URL(window.getApiHost());
      label.innerText = `Server: ${url.host}`;
    } catch (e) {
      label.innerText = `Server: ${window.getApiHost()}`;
    }
  }
}

function promptServerHost() {
  const current = window.getApiHost ? window.getApiHost() : 'https://pw-exam-shield.vercel.app';
  const next = prompt('Cloud Server URL:', current);
  if (next && next.trim()) {
    localStorage.setItem('PW_SERVER_HOST', next.trim());
    window.location.reload();
  }
}

// -------------------------------------------------------------------
// 0. ANTI-SCREENSHOT SECURITY LAYER & WATERMARK
// -------------------------------------------------------------------
function setupWatermark() {
  const layer = document.getElementById('watermark-layer');
  if (!layer) return;
  layer.innerHTML = '';
  const displayName = (studentName || 'CANDIDATE').toUpperCase();
  const displayRoll = rollNumber || 'VERIFIED';
  const text = `${displayName} • ${displayRoll} • FLAG_SECURE ACTIVE • PW EXAM SHIELD`;
  for (let i = 0; i < 7; i++) {
    const row = document.createElement('div');
    row.className = 'm-watermark-row';
    row.innerText = `${text}   ${text}`;
    layer.appendChild(row);
  }
}

function setupAntiScreenshot() {
  // Prevent context menu (long press on mobile)
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // Detect PrintScreen or capture keys on keyboard
  window.addEventListener('keyup', (e) => {
    const key = (e.key || '').toLowerCase();
    if (key === 'printscreen' || key === 'snapshot' || (e.ctrlKey && key === 'p') || (e.shiftKey && e.metaKey && key === 's')) {
      triggerScreenshotAlert('PrintScreen / Capture Shortcut');
    }
  });

  // Track window/tab blur (unfocus or switching apps)
  window.addEventListener('blur', () => {
    console.warn('[SECURITY] Mobile app lost focus or switched.');
  });
}

function triggerScreenshotAlert(reason) {
  if (window.AndroidOfflineVault && window.AndroidOfflineVault.notifyScreenshotBlocked) {
    try { window.AndroidOfflineVault.notifyScreenshotBlocked(); } catch (e) {}
  }

  // 1. Wipe clipboard
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('');
    }
  } catch (err) {}

  // 2. Show floating red warning toast
  const toast = document.getElementById('screenshot-toast');
  if (toast) {
    toast.style.display = 'flex';
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);
  }

  // 3. Log violation to server
  fetch(window.apiUrl('/api/violations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testId: selectedTestId || 'practice-hub',
      studentName,
      violationType: 'SCREENSHOT_ATTEMPT_FLAG_SECURE',
      details: reason || 'Screen capture attempted'
    })
  }).catch(() => {});
}

// -------------------------------------------------------------------
// 1. STUDENT PRACTICE TESTS HUB
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// 1. MAIN TABS & BATCH MARKETPLACE STOREFRONT
// -------------------------------------------------------------------
let activeMainTab = 'BATCHES'; // 'BATCHES' or 'TESTS'
let allBatches = [];
let selectedCheckoutBatch = null;
let selectedPayMethodType = 'upi';

function switchMainTab(tab) {
  activeMainTab = tab;
  const btnBatches = document.getElementById('tab-btn-batches');
  const btnTests = document.getElementById('tab-btn-tests');
  const secBatches = document.getElementById('section-batches');
  const secTests = document.getElementById('section-tests');

  if (tab === 'BATCHES') {
    if (btnBatches) btnBatches.classList.add('active');
    if (btnTests) btnTests.classList.remove('active');
    if (secBatches) secBatches.style.display = 'block';
    if (secTests) secTests.style.display = 'none';
  } else {
    if (btnBatches) btnBatches.classList.remove('active');
    if (btnTests) btnTests.classList.add('active');
    if (secBatches) secBatches.style.display = 'none';
    if (secTests) secTests.style.display = 'block';
  }
}

function getEnrolledBatches() {
  try {
    return JSON.parse(localStorage.getItem('PW_ENROLLED_BATCHES') || '["batch-open", "PWOPEN"]');
  } catch (e) {
    return ['batch-open', 'PWOPEN'];
  }
}

function isBatchEnrolled(batchId, batchCode) {
  const enrolled = getEnrolledBatches();
  return enrolled.includes(batchId) || enrolled.includes(batchCode);
}

function addEnrolledBatch(batchId, batchCode) {
  const enrolled = getEnrolledBatches();
  if (batchId && !enrolled.includes(batchId)) enrolled.push(batchId);
  if (batchCode && !enrolled.includes(batchCode)) enrolled.push(batchCode);
  localStorage.setItem('PW_ENROLLED_BATCHES', JSON.stringify(enrolled));
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function loadBatchesAndTests() {
  const batchContainer = document.getElementById('batches-container');
  const testContainer = document.getElementById('practice-tests-container');
  if (batchContainer) batchContainer.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center;">Loading test series batches...</div>';
  if (testContainer) testContainer.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center;">Loading practice tests from server...</div>';

  try {
    const [batchesRes, testsRes] = await Promise.all([
      fetch(window.apiUrl('/api/batches')).catch(() => ({ json: () => [] })),
      fetch(window.apiUrl('/api/tests')).catch(() => ({ json: () => [] }))
    ]);

    allBatches = await batchesRes.json();
    allTests = await testsRes.json();

    renderBatchesList();
    renderTestsList();
  } catch (e) {
    console.error('Failed to load batches or tests:', e);
    renderBatchesList();
    if (testContainer) testContainer.innerHTML = `<div style="color: #f87171; padding: 14px;">Failed to connect to server: ${e.message}</div>`;
  }
}

function renderBatchesList() {
  const container = document.getElementById('batches-container');
  if (!container) return;
  container.innerHTML = '';

  const defaultCatalog = [
    {
      id: 'batch-prayas-2026',
      code: 'PWJEE1',
      name: 'PRAYAS JEE 2026 - Dropper & Class 12 CBT Series',
      subtitle: 'Complete NTA Mock Test Series with AIR Ranking & Detailed Solutions',
      exam_type: 'JEE_MAIN',
      price: '₹1,499',
      mrp: '₹4,999',
      discount: '70% OFF',
      ingredients: [
        '30 Full Syllabus All India NTA CBT Mocks (PCM)',
        'Instant In-Memory Live Streaming (FLAG_SECURE Anti-Cheat)',
        'Step-by-Step KaTeX Math Solutions & Shortcut Tricks',
        'Real-Time All India Rank (AIR) & Percentile Predictor',
        'AES-256 Encrypted Offline Vault (.pwenc) on Phone'
      ]
    },
    {
      id: 'batch-lakshya-2026',
      code: 'PWNEET',
      name: 'LAKSHYA NEET 2026 - Pre-Medical National Test Series',
      subtitle: '720-Marks NCERT Line-by-Line Mock Engine with Negative Marking',
      exam_type: 'NEET',
      price: '₹1,299',
      mrp: '₹3,999',
      discount: '68% OFF',
      ingredients: [
        '25 Full Length 720-Marks NTA NEET Mocks',
        'Biology 360/360 Booster + Assertion-Reason Drills',
        'Physics & Chemistry Speed & Accuracy Training',
        'AIR Predictor with Real-Time NTA Scoring Rules',
        'Private DRM Sandbox Decryption on Phone RAM'
      ]
    },
    {
      id: 'batch-arjuna-2026',
      code: 'PWARJUNA',
      name: 'ARJUNA JEE 2026 - Class 11 Foundation CBT Series',
      subtitle: 'Mechanics, Chemistry & Foundation Calculus Diagnostic Drill Series',
      exam_type: 'JEE_MAIN',
      price: '₹999',
      mrp: '₹2,999',
      discount: '67% OFF',
      ingredients: [
        '20 Chapter-wise & Foundation Level CBT Mocks',
        'High-Yield Mechanics, Stoichiometry & Algebra Drills',
        'Interactive Math Formulas with KaTeX Engine',
        'Instant Performance Feedback & Error Analysis'
      ]
    },
    {
      id: 'batch-open',
      code: 'PWOPEN',
      name: 'ALL INDIA OPEN MOCKS - National Benchmark Series',
      subtitle: 'Open Diagnostic CBT Examination for All Engineering & Medical Aspirants',
      exam_type: 'ALL',
      price: 'FREE',
      mrp: '₹1,999',
      discount: '100% FREE',
      ingredients: [
        'Nationwide Open CBT Mock Examination',
        'Simulated NTA Testing Window & Timer Environment',
        'Instant Deterministic Marksheet & Full Solution Keys'
      ]
    }
  ];

  // Merge with any custom batches fetched from server
  const catalog = [...defaultCatalog];
  (allBatches || []).forEach(b => {
    if (!catalog.some(c => c.code === b.code || c.id === b.id)) {
      catalog.push({
        id: b.id,
        code: b.code,
        name: b.name,
        subtitle: `Faculty Batch • Code: ${b.code}`,
        exam_type: b.exam_type || 'JEE_MAIN',
        price: '₹999',
        mrp: '₹2,999',
        discount: '67% OFF',
        ingredients: [
          'Faculty Curated CBT Mock Tests',
          'Live In-Memory Streaming (Zero Local Storage)',
          'Detailed Step-by-Step Solutions & Scoring'
        ]
      });
    }
  });

  catalog.forEach(batch => {
    const enrolled = isBatchEnrolled(batch.id, batch.code) || batch.price === 'FREE';
    const isNEET = (batch.exam_type || '').toUpperCase().includes('NEET');
    const badgeClass = isNEET ? 'pw-badge-neet' : 'pw-badge-jee';
    const badgeText = isNEET ? 'NEET UG PRE-MEDICAL' : 'JEE MAIN & ADVANCED';

    const card = document.createElement('div');
    card.className = 'pw-course-card';
    card.innerHTML = `
      <div class="pw-course-header">
        <span class="pw-course-badge ${badgeClass}">${badgeText}</span>
        <span style="font-size: 11px; color: ${enrolled ? '#34d399' : '#818cf8'}; font-weight: 800; font-family: monospace;">
          ${enrolled ? '✓ ACTIVE' : 'OPEN BATCH'}
        </span>
      </div>

      <div class="pw-course-title">${batch.name}</div>
      <div class="pw-course-sub">${batch.subtitle}</div>

      <!-- INGREDIENTS LIST -->
      <div class="pw-ingredients-box">
        <div class="pw-ingredients-label">
          <span>📋</span> Batch Ingredients &amp; Offerings:
        </div>
        ${batch.ingredients.map(ing => `
          <div class="pw-ingredient-item">
            <span class="pw-ingredient-check">✔</span>
            <span>${ing}</span>
          </div>
        `).join('')}
      </div>

      <!-- PRICE ROW -->
      <div class="pw-price-row">
        <div class="pw-price-group">
          <span class="pw-price-current">${batch.price}</span>
          ${batch.mrp ? `<span class="pw-price-original">${batch.mrp}</span>` : ''}
          ${batch.discount ? `<span class="pw-discount-badge">${batch.discount}</span>` : ''}
        </div>
        <span style="font-size: 10px; color: #94a3b8; font-weight: 600;">Full Exam Validity</span>
      </div>

      <!-- ACTION BUTTON -->
      ${enrolled ? `
        <button class="btn-pw-enrolled" onclick="viewBatchTests('${batch.code}')">
          <span>✓ Enrolled &amp; Active • Access Tests</span>
          <span>&rarr;</span>
        </button>
      ` : `
        <button class="btn-pw-buy" onclick="openPaymentModal('${batch.id}', '${escapeQuotes(batch.name)}', '${batch.price}', '${batch.mrp || ''}', '${batch.discount || ''}', '${batch.code}')">
          <span>💳 Pay &amp; Enroll Now (${batch.price})</span>
          <span>&rarr;</span>
        </button>
      `}
    `;
    container.appendChild(card);
  });
}

function viewBatchTests(batchCode) {
  switchMainTab('TESTS');
  filteredCategory = 'ALL';
  renderTestsList();
}

function openPaymentModal(batchId, name, price, mrp, discount, code) {
  selectedCheckoutBatch = { id: batchId, name, price, mrp, discount, code };
  const modal = document.getElementById('payment-modal');
  if (!modal) return;

  document.getElementById('checkout-title').innerText = name;
  document.getElementById('checkout-mrp').innerText = mrp || '₹4,999';
  document.getElementById('checkout-discount').innerText = discount ? `-${discount}` : '-₹3,500';
  document.getElementById('checkout-final-price').innerText = price;
  modal.style.display = 'flex';
}

function closePaymentModal() {
  const modal = document.getElementById('payment-modal');
  if (modal) modal.style.display = 'none';
  selectedCheckoutBatch = null;
}

function selectPayMethod(method) {
  selectedPayMethodType = method;
  document.querySelectorAll('.pw-pay-method-card').forEach(c => c.classList.remove('selected'));
  const el = document.getElementById(`pm-${method}`);
  if (el) el.classList.add('selected');
}

function processBatchPurchase() {
  if (!selectedCheckoutBatch) return;

  const btn = document.getElementById('btn-confirm-pay');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>⏳ Processing Secure Payment...</span>';
  btn.disabled = true;

  setTimeout(() => {
    addEnrolledBatch(selectedCheckoutBatch.id, selectedCheckoutBatch.code);
    btn.innerHTML = originalText;
    btn.disabled = false;
    closePaymentModal();
    alert(`🎉 Congratulations! You have successfully enrolled in ${selectedCheckoutBatch.name}.\n\nAll CBT mock tests for this batch are now unlocked on your device.`);
    renderBatchesList();
    switchMainTab('TESTS');
  }, 1000);
}

let examLaunchMode = 'STREAM'; // 'STREAM' or 'OFFLINE_VAULT'

function filterTests(category, btn) {
  filteredCategory = category;
  document.querySelectorAll('.section-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTestsList();
}

async function renderTestsList() {
  const container = document.getElementById('practice-tests-container');
  if (!container) return;
  container.innerHTML = '';

  // 1. OFFLINE VAULT VIEW (ENCRYPTED TESTS HIDDEN FROM 'MY FILES')
  if (filteredCategory === 'OFFLINE_VAULT') {
    const offlineList = await window.PWOfflineVault.listOfflineTests();
    if (!offlineList || offlineList.length === 0) {
      container.innerHTML = `
        <div style="background: var(--pw-surface-card); border: 1.5px dashed var(--pw-border-highlight); border-radius: var(--radius-lg); padding: 32px 20px; text-align: center;">
          <div style="font-size: 32px; margin-bottom: 12px;">🔒</div>
          <div style="font-size: 15px; font-weight: 800; color: #ffffff; margin-bottom: 6px;">Offline Vault is Empty</div>
          <div style="font-size: 12px; color: var(--pw-text-muted); line-height: 1.6; margin-bottom: 18px; max-width: 320px; margin-left: auto; margin-right: auto;">
            Mock tests downloaded for offline revision are encrypted with AES-256-GCM and stored inside the app-internal sandbox. Android OS strictly hides them from Samsung "My Files".
          </div>
          <button onclick="filterTests('ALL', document.getElementById('filter-all'))" class="btn-m-start" style="display: inline-flex; width: auto; padding: 10px 20px; font-size: 13px;">
            Browse Online Tests to Download
          </button>
        </div>
      `;
      return;
    }

    offlineList.forEach(test => {
      const card = document.createElement('div');
      card.className = 'm-portal-card';
      card.style.borderLeft = '4px solid #10b981';
      card.innerHTML = `
        <div class="pw-card-badge-row">
          <span class="pw-tag-exam" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">
            🔒 AES-256 ENCRYPTED VAULT (.pwenc)
          </span>
          <span class="pw-tag-batch">
            ${(test.sizeBytes / 1024).toFixed(1)} KB
          </span>
        </div>

        <div class="m-test-title">${test.title}</div>

        <div style="background: rgba(11, 15, 25, 0.6); border: 1px solid var(--pw-border); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 11px; color: var(--pw-text-muted); margin-bottom: 14px; line-height: 1.5;">
          <strong style="color: #34d399;">Sandbox Protected:</strong> Stored in private app storage. Invisible in "My Files". Decrypts strictly into phone RAM for examination.
        </div>

        <div class="pw-test-stats-grid">
          <div class="pw-stat-item">
            <span class="pw-stat-label">Duration</span>
            <span class="pw-stat-val">⏱️ ${test.durationMinutes || 180}m</span>
          </div>
          <div class="pw-stat-item">
            <span class="pw-stat-label">Total Marks</span>
            <span class="pw-stat-val">📊 ${test.totalMarks || 300}M</span>
          </div>
          <div class="pw-stat-item">
            <span class="pw-stat-label">Security</span>
            <span class="pw-stat-val" style="color: #34d399;">🛡️ SECURE</span>
          </div>
        </div>

        <div style="display: flex; gap: 8px;">
          <button class="btn-m-start" style="flex: 1; background: var(--pw-green-gradient);" onclick="openInstructions('${test.testId}', 'OFFLINE_VAULT')">
            <span>🔓 Decrypt &amp; Take Test</span>
            <span>&rarr;</span>
          </button>
          <button onclick="removeOfflineTest('${test.testId}')" class="btn-pw-offline" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3); padding: 0 16px;">
            🗑️
          </button>
        </div>
      `;
      container.appendChild(card);
    });
    return;
  }

  // 2. REGULAR ONLINE TESTS LIST
  let filtered = allTests;
  if (filteredCategory !== 'ALL') {
    filtered = allTests.filter(t => (t.exam_type || '').toUpperCase() === filteredCategory.toUpperCase());
  }

  if (!filtered || filtered.length === 0) {
    container.innerHTML = '<div style="color: var(--pw-text-muted); padding: 30px; text-align: center; font-size: 13px;">No tests found in this category.</div>';
    return;
  }

  for (const test of filtered) {
    const isNEET = (test.exam_type || '').toUpperCase().includes('NEET');
    const badgeClass = isNEET ? 'pw-tag-neet' : 'pw-tag-jee';
    const badgeText = isNEET ? 'NEET UG 2026' : 'JEE MAIN 2026';
    const isSaved = await window.PWOfflineVault.isTestSavedOffline(test.id);

    const card = document.createElement('div');
    card.className = 'm-portal-card';
    card.innerHTML = `
      <div class="pw-card-badge-row">
        <span class="pw-tag-exam ${badgeClass}">
          ${badgeText}
        </span>
        <span class="pw-tag-batch">
          BATCH: ${test.batch_code || 'ALL BATCHES'}
        </span>
      </div>

      <div class="m-test-title">${test.title}</div>

      <div class="pw-test-stats-grid">
        <div class="pw-stat-item">
          <span class="pw-stat-label">Duration</span>
          <span class="pw-stat-val">⏱️ ${test.duration_minutes || 180}m</span>
        </div>
        <div class="pw-stat-item">
          <span class="pw-stat-label">Marks</span>
          <span class="pw-stat-val">📊 ${test.total_marks || 300}M</span>
        </div>
        <div class="pw-stat-item">
          <span class="pw-stat-label">Questions</span>
          <span class="pw-stat-val">📝 ${test.question_count || 5} Qs</span>
        </div>
      </div>

      <div class="pw-action-group">
        <!-- Primary Action: RAM Streaming -->
        <button class="btn-m-start" onclick="openInstructions('${test.id}', 'STREAM')">
          <span>⚡ Start Test (Live RAM Stream)</span>
          <span>&rarr;</span>
        </button>

        <!-- Secondary Action: Offline Encryption -->
        <button class="btn-pw-offline" onclick="downloadTestOffline('${test.id}', this)">
          ${isSaved ? '✓ Encrypted in Vault (.pwenc)' : '📥 Download Encrypted for Offline (Hidden from Files)'}
        </button>
      </div>
    `;
    container.appendChild(card);
  }
}

async function downloadTestOffline(testId, btnEl) {
  const originalText = btnEl.innerText;
  btnEl.innerText = '⏳ Downloading & Encrypting...';
  btnEl.disabled = true;

  try {
    const testMeta = allTests.find(t => t.id === testId) || { title: 'Practice Test' };
    await window.PWOfflineVault.downloadAndStorePackage(testId, testMeta);
    btnEl.innerText = '✓ Saved to App Vault (Hidden from "My Files")';
    btnEl.style.color = '#34d399';
    btnEl.style.borderColor = '#059669';
    alert('Test downloaded successfully!\n\nSecurity Enforced:\n- Stored in App-Internal Sandbox (/data/data/com.pw.examshield/)\n- Encrypted with AES-256-GCM (.pwenc)\n- Completely hidden from Samsung "My Files" and file managers\n- Can only be opened and decrypted inside our app.');
  } catch (err) {
    btnEl.innerText = originalText;
    btnEl.disabled = false;
    alert('Download failed: ' + err.message);
  }
}

async function removeOfflineTest(testId) {
  if (confirm('Delete this encrypted test from your offline vault?')) {
    await window.PWOfflineVault.deleteOfflineTest(testId);
    renderTestsList();
  }
}

// -------------------------------------------------------------------
// 3. NTA INSTRUCTIONS & CONSENT MODAL
// -------------------------------------------------------------------
async function openInstructions(testId, mode = 'STREAM') {
  selectedTestId = testId;
  examLaunchMode = mode;

  const modal = document.getElementById('instructions-modal');
  const chk = document.getElementById('chk-agree');
  const startBtn = document.getElementById('btn-begin-exam');

  chk.checked = false;
  startBtn.disabled = true;
  startBtn.style.opacity = '0.5';

  if (mode === 'STREAM') {
    try {
      const res = await fetch(window.apiUrl(`/api/tests/${testId}`));
      const data = await res.json();
      document.getElementById('modal-title').innerText = data.test.title;
      document.getElementById('modal-meta').innerText = 
        `⚡ LIVE IN-MEMORY STREAM • ${data.test.duration_minutes || 180} Mins • ${data.test.total_marks || 300} Marks • Zero Disk Storage`;
    } catch (e) {}
  } else {
    // Offline vault
    try {
      const payload = await window.PWOfflineVault.loadAndDecryptTest(testId);
      document.getElementById('modal-title').innerText = payload.test.title;
      document.getElementById('modal-meta').innerText = 
        `🔒 OFFLINE VAULT (AES-256 DECRYPTED IN RAM) • ${payload.test.duration_minutes || 180} Mins • ${payload.test.total_marks || 300} Marks`;
    } catch (e) {}
  }

  modal.style.display = 'flex';
}

function toggleStartTestBtn() {
  const chk = document.getElementById('chk-agree');
  const startBtn = document.getElementById('btn-begin-exam');
  if (chk.checked) {
    startBtn.disabled = false;
    startBtn.style.opacity = '1';
  } else {
    startBtn.disabled = true;
    startBtn.style.opacity = '0.5';
  }
}

function closeInstructions() {
  document.getElementById('instructions-modal').style.display = 'none';
  selectedTestId = null;
}

// -------------------------------------------------------------------
// 4. ACTIVE CBT EXAM TERMINAL
// -------------------------------------------------------------------
async function startExamNow() {
  if (!selectedTestId) return;

  document.getElementById('instructions-modal').style.display = 'none';
  document.getElementById('view-portal').style.display = 'none';
  document.getElementById('view-exam').style.display = 'flex';

  if (examLaunchMode === 'STREAM') {
    // 1. Live In-Memory Stream from Laptop Server (Zero Storage on phone)
    console.log('[EXAM] Initiating in-memory stream from laptop server...');
    const res = await fetch(window.apiUrl(`/api/tests/stream/${selectedTestId}`));
    const data = await res.json();
    currentTest = data.test;
    questions = data.questions;
  } else {
    // 2. In-Memory Decryption from Private Offline Vault (.pwenc container)
    console.log('[EXAM] Decrypting AES-256-GCM package from private sandbox into RAM...');
    const payload = await window.PWOfflineVault.loadAndDecryptTest(selectedTestId);
    currentTest = payload.test;
    questions = payload.questions;
  }

  document.getElementById('exam-test-title').innerText = currentTest.title;
  secondsLeft = (currentTest.duration_minutes || 180) * 60;

  // Extract unique sections
  const secSet = new Set();
  questions.forEach(q => secSet.add(q.section_title || 'Core Section'));
  sectionsList = Array.from(secSet);
  activeSection = sectionsList[0];
  activeQuestionIndex = 0;
  responses = {};

  // Initialize responses
  questions.forEach(q => {
    responses[q.id] = {
      selectedOption: null,
      numericalValue: null,
      status: 'NOT_VISITED',
      timeSpent: 0
    };
  });

  if (questions[0]) {
    responses[questions[0].id].status = 'NOT_ANSWERED';
  }

  renderSectionChips();
  renderCurrentQuestion();
  updatePaletteStats();
  startTimer();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const clockEl = document.getElementById('mobile-clock');

  timerInterval = setInterval(() => {
    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      alert('Time Expired! Submitting examination.');
      submitExam();
      return;
    }
    secondsLeft--;

    const h = Math.floor(secondsLeft / 3600).toString().padStart(2, '0');
    const m = Math.floor((secondsLeft % 3600) / 60).toString().padStart(2, '0');
    const s = (secondsLeft % 60).toString().padStart(2, '0');
    clockEl.innerText = `${h}:${m}:${s}`;
  }, 1000);
}

function renderSectionChips() {
  const container = document.getElementById('mobile-section-chips');
  container.innerHTML = '';

  sectionsList.forEach(sec => {
    const chip = document.createElement('div');
    chip.className = `section-chip ${sec === activeSection ? 'active' : ''}`;
    chip.innerText = sec;
    chip.onclick = () => {
      activeSection = sec;
      renderSectionChips();
      const firstIdx = questions.findIndex(q => (q.section_title || 'Core Section') === sec);
      if (firstIdx !== -1) goToQuestion(firstIdx);
    };
    container.appendChild(chip);
  });
}

function renderCurrentQuestion() {
  const q = questions[activeQuestionIndex];
  if (!q) return;

  document.getElementById('m-q-num').innerText = `Question ${q.question_number}`;
  document.getElementById('m-q-marks').innerText = `+${currentTest.positive_marks || 4.0} / -${currentTest.negative_marks || 1.0}`;
  document.getElementById('exam-section-label').innerText = q.section_title || 'Section A';

  // Render question text with KaTeX
  document.getElementById('m-q-text').innerHTML = parseLatex(q.question_text);

  const ansBox = document.getElementById('m-answers-box');
  ansBox.innerHTML = '';
  const resp = responses[q.id];

  if (q.question_type === 'NUMERICAL') {
    // Virtual Numeric Keypad
    const card = document.createElement('div');
    card.className = 'mobile-keypad-card';

    const inputVal = resp.numericalValue !== null && resp.numericalValue !== undefined ? String(resp.numericalValue) : '';

    card.innerHTML = `
      <div style="font-size: 11px; font-weight: bold; color: #475569; margin-bottom: 6px;">
        VIRTUAL NUMERICAL KEYPAD (DECIMAL / INTEGER):
      </div>
      <input type="text" readonly class="mobile-keypad-input" id="m-num-display" value="${inputVal}">
      <div class="mobile-keypad-grid">
        <div class="m-key" onclick="keypadInput('7')">7</div>
        <div class="m-key" onclick="keypadInput('8')">8</div>
        <div class="m-key" onclick="keypadInput('9')">9</div>
        <div class="m-key m-key-action" onclick="keypadInput('BS')">&larr;</div>
        <div class="m-key" onclick="keypadInput('4')">4</div>
        <div class="m-key" onclick="keypadInput('5')">5</div>
        <div class="m-key" onclick="keypadInput('6')">6</div>
        <div class="m-key m-key-action" onclick="keypadInput('CLR')">Clear</div>
        <div class="m-key" onclick="keypadInput('1')">1</div>
        <div class="m-key" onclick="keypadInput('2')">2</div>
        <div class="m-key" onclick="keypadInput('3')">3</div>
        <div class="m-key" onclick="keypadInput('-')">-</div>
        <div class="m-key" style="grid-column: span 2;" onclick="keypadInput('0')">0</div>
        <div class="m-key" onclick="keypadInput('.')">.</div>
      </div>
    `;
    ansBox.appendChild(card);
  } else {
    // SCQ Radio Options
    const optList = document.createElement('div');
    optList.className = 'mobile-options-list';

    const options = q.options_json ? JSON.parse(q.options_json) : [];
    options.forEach((optText, idx) => {
      const isSelected = resp.selectedOption === String(idx);
      const optCard = document.createElement('div');
      optCard.className = `mobile-option-card ${isSelected ? 'selected' : ''}`;
      optCard.onclick = () => selectOption(idx);

      const letter = ['A', 'B', 'C', 'D'][idx] || `${idx + 1}`;
      optCard.innerHTML = `
        <div class="opt-circle">${letter}</div>
        <div class="opt-content">${parseLatex(optText)}</div>
      `;
      optList.appendChild(optCard);
    });
    ansBox.appendChild(optList);
  }
}

function keypadInput(key) {
  const q = questions[activeQuestionIndex];
  if (!q) return;

  let val = responses[q.id].numericalValue ? String(responses[q.id].numericalValue) : '';
  if (key === 'CLR') val = '';
  else if (key === 'BS') val = val.slice(0, -1);
  else if (key === '.') {
    if (!val.includes('.')) val += '.';
  } else if (key === '-') {
    if (val.startsWith('-')) val = val.substring(1);
    else val = '-' + val;
  } else {
    if (val.length < 9) val += key;
  }

  responses[q.id].numericalValue = val;
  const display = document.getElementById('m-num-display');
  if (display) display.value = val;
}

function selectOption(idx) {
  const q = questions[activeQuestionIndex];
  if (!q) return;
  responses[q.id].selectedOption = String(idx);
  renderCurrentQuestion();
}

function handleSaveNext() {
  const q = questions[activeQuestionIndex];
  if (!q) return;

  const isAnswered = (responses[q.id].selectedOption !== null && responses[q.id].selectedOption !== undefined) ||
                     (responses[q.id].numericalValue !== null && responses[q.id].numericalValue !== undefined && responses[q.id].numericalValue !== '');

  responses[q.id].status = isAnswered ? 'ANSWERED' : 'NOT_ANSWERED';
  updatePaletteStats();

  if (activeQuestionIndex < questions.length - 1) {
    goToQuestion(activeQuestionIndex + 1);
  }
}

function handleMarkReview() {
  const q = questions[activeQuestionIndex];
  if (!q) return;
  const isAnswered = (responses[q.id].selectedOption !== null && responses[q.id].selectedOption !== undefined) ||
                     (responses[q.id].numericalValue !== null && responses[q.id].numericalValue !== undefined && responses[q.id].numericalValue !== '');

  responses[q.id].status = isAnswered ? 'ANSWERED_AND_MARKED' : 'MARKED_FOR_REVIEW';
  updatePaletteStats();

  if (activeQuestionIndex < questions.length - 1) {
    goToQuestion(activeQuestionIndex + 1);
  }
}

function handleClear() {
  const q = questions[activeQuestionIndex];
  if (!q) return;
  responses[q.id].selectedOption = null;
  responses[q.id].numericalValue = null;
  responses[q.id].status = 'NOT_ANSWERED';
  renderCurrentQuestion();
  updatePaletteStats();
}

function goToQuestion(idx) {
  activeQuestionIndex = idx;
  const q = questions[idx];
  if (!q) return;

  if (responses[q.id].status === 'NOT_VISITED') {
    responses[q.id].status = 'NOT_ANSWERED';
  }

  if (q.section_title && q.section_title !== activeSection) {
    activeSection = q.section_title;
    renderSectionChips();
  }

  renderCurrentQuestion();
  updatePaletteStats();
}

// -------------------------------------------------------------------
// 5. SLIDING NTA QUESTION PALETTE (BOTTOM SHEET)
// -------------------------------------------------------------------
function updatePaletteStats() {
  let ans = 0, notAns = 0, notVis = 0, rev = 0, revEval = 0;

  questions.forEach(q => {
    const st = responses[q.id].status;
    if (st === 'ANSWERED') ans++;
    else if (st === 'NOT_ANSWERED') notAns++;
    else if (st === 'MARKED_FOR_REVIEW') rev++;
    else if (st === 'ANSWERED_AND_MARKED') revEval++;
    else notVis++;
  });

  const totalAns = ans + revEval;
  document.getElementById('palette-btn-text').innerText = `Palette (${totalAns}/${questions.length})`;

  document.getElementById('leg-ans').innerText = ans;
  document.getElementById('leg-notans').innerText = notAns;
  document.getElementById('leg-notvis').innerText = notVis;
  document.getElementById('leg-rev').innerText = rev;

  // Build matrix buttons
  const matrix = document.getElementById('palette-matrix');
  matrix.innerHTML = '';

  questions.forEach((q, idx) => {
    const st = responses[q.id].status;
    const btn = document.createElement('div');
    btn.className = 'p-matrix-item';

    let colorStyle = 'background: #94a3b8; color: #ffffff;';
    if (st === 'ANSWERED') colorStyle = 'background: #22c55e; color: #ffffff;';
    else if (st === 'NOT_ANSWERED') colorStyle = 'background: #ef4444; color: #ffffff;';
    else if (st === 'MARKED_FOR_REVIEW') colorStyle = 'background: #a855f7; color: #ffffff;';
    else if (st === 'ANSWERED_AND_MARKED') colorStyle = 'background: #7e22ce; color: #ffffff;';

    if (idx === activeQuestionIndex) {
      colorStyle += ' border: 3px solid #f29306;';
    }

    btn.style = colorStyle;
    btn.innerText = q.question_number;
    btn.onclick = () => {
      goToQuestion(idx);
      closePaletteSheet();
    };
    matrix.appendChild(btn);
  });
}

function openPaletteSheet() {
  document.getElementById('palette-sheet').style.display = 'flex';
}

function closePaletteSheet(e) {
  document.getElementById('palette-sheet').style.display = 'none';
}

// -------------------------------------------------------------------
// 6. EXAMINATION SUBMISSION & DETERMINISTIC SCORING
// -------------------------------------------------------------------
function confirmSubmitExam() {
  let ans = 0;
  questions.forEach(q => {
    const st = responses[q.id].status;
    if (st === 'ANSWERED' || st === 'ANSWERED_AND_MARKED') ans++;
  });

  if (confirm(`Are you sure you want to submit? You have answered ${ans} out of ${questions.length} questions.`)) {
    submitExam();
  }
}

async function submitExam() {
  if (timerInterval) clearInterval(timerInterval);

  let score = 0;
  let maxScore = questions.length * (currentTest.positive_marks || 4.0);
  let correct = 0;
  let incorrect = 0;

  let solutionsHtml = '<h4 style="color: #1b3558; font-size: 13px; margin-bottom: 8px;">Detailed Solutions:</h4>';

  questions.forEach((q, idx) => {
    const r = responses[q.id];
    const isGiven = (r.status === 'ANSWERED' || r.status === 'ANSWERED_AND_MARKED');
    let isCorrect = false;
    let studentAnsText = 'Unattempted';

    if (isGiven) {
      if (q.question_type === 'NUMERICAL') {
        studentAnsText = String(r.numericalValue);
        const sVal = parseFloat(r.numericalValue);
        const eVal = parseFloat(q.numerical_answer);
        if (!isNaN(sVal) && !isNaN(eVal) && Math.abs(sVal - eVal) <= 0.05) isCorrect = true;
      } else {
        const letter = ['A', 'B', 'C', 'D'][parseInt(r.selectedOption)] || r.selectedOption;
        studentAnsText = `Option (${letter})`;
        if (String(r.selectedOption).trim() === String(q.correct_answer).trim()) isCorrect = true;
      }

      if (isCorrect) {
        correct++;
        score += (currentTest.positive_marks || 4.0);
      } else {
        incorrect++;
        score -= (currentTest.negative_marks || 1.0);
      }
    }

    const correctLetter = ['A', 'B', 'C', 'D'][parseInt(q.correct_answer)] || q.correct_answer || q.numerical_answer;
    const borderCol = !isGiven ? '#94a3b8' : (isCorrect ? '#22c55e' : '#ef4444');

    const badgeClass = !isGiven ? 'pw-solution-badge-skipped' : (isCorrect ? 'pw-solution-badge-correct' : 'pw-solution-badge-wrong');
    const resultPill = !isGiven 
      ? '<span style="color: #64748b; font-weight: 700;">⚪ Skipped</span>' 
      : (isCorrect 
        ? '<span style="color: #10b981; font-weight: 800;">🟢 Correct (+4.0)</span>' 
        : '<span style="color: #ef4444; font-weight: 800;">🔴 Incorrect (-1.0)</span>');

    solutionsHtml += `
      <div class="pw-solution-card ${badgeClass}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-weight: 800; color: #0f172a; font-size: 13px;">Question ${idx + 1} &bull; <span style="color: #4f46e5;">${q.subject || 'Core'}</span></span>
          ${resultPill}
        </div>
        <div style="color: #334155; margin-bottom: 8px; line-height: 1.5;">${parseLatex(q.question_text)}</div>
        <div style="background: #f1f5f9; padding: 6px 10px; border-radius: 6px; font-size: 11.5px; color: #475569; margin-bottom: 6px;">
          <strong>Your Answer:</strong> ${studentAnsText} &nbsp;|&nbsp; <strong>Correct Key:</strong> Option (${correctLetter})
        </div>
        ${q.solution_text ? `<div style="background: #eef2ff; border: 1px solid #c7d2fe; padding: 8px 10px; border-radius: 6px; color: #3730a3; font-size: 11.5px; line-height: 1.5;"><strong>Detailed Solution:</strong><br>${parseLatex(q.solution_text)}</div>` : ''}
      </div>
    `;
  });

  const attempted = correct + incorrect;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const percentile = score > 0 ? Math.min(99.95, Math.max(25, 90 + (score / maxScore) * 10)).toFixed(2) : '15.00';
  const rank = Math.max(1, Math.round((1 - (parseFloat(percentile) / 100)) * 5000));

  // Submit to server
  try {
    await fetch(window.apiUrl('/api/submit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId: selectedTestId,
        studentName,
        rollNumber,
        score,
        maxScore,
        accuracy,
        timeSpentSeconds: ((currentTest.duration_minutes || 180) * 60) - secondsLeft,
        rank,
        percentile: parseFloat(percentile),
        deviceId: 'MOBILE-ANDROID'
      })
    });
  } catch (e) {}

  // Populate scorecard
  document.getElementById('res-score').innerText = `${score} / ${maxScore}`;
  document.getElementById('res-percentile').innerText = `${percentile}%`;
  document.getElementById('res-rank').innerText = `#${rank}`;
  document.getElementById('res-accuracy').innerText = `${accuracy}% (${correct}C/${incorrect}W)`;
  document.getElementById('res-solutions-list').innerHTML = solutionsHtml;

  document.getElementById('scorecard-modal').style.display = 'flex';
}

function returnToHub() {
  document.getElementById('scorecard-modal').style.display = 'none';
  document.getElementById('view-exam').style.display = 'none';
  document.getElementById('view-portal').style.display = 'flex';

  selectedTestId = null;
  currentTest = null;
  questions = [];
  responses = {};
  if (timerInterval) clearInterval(timerInterval);

  loadPracticeTests();
}

// -------------------------------------------------------------------
// 7. TEACHER STUDIO & BATCH ENROLLMENT
// -------------------------------------------------------------------
async function joinBatch() {
  const input = document.getElementById('batch-code-input');
  const msgEl = document.getElementById('join-status-msg');
  const code = (input.value || '').trim().toUpperCase();
  if (!code) {
    alert('Please enter a batch code.');
    return;
  }
  msgEl.style.display = 'block';
  msgEl.style.color = '#38bdf8';
  msgEl.innerText = `Connecting to batch ${code}...`;
  try {
    const res = await fetch(window.apiUrl(`/api/batches/${code}`));
    if (!res.ok) throw new Error('Batch not found or invalid code.');
    const batch = await res.json();
    batchCode = batch.code;
    document.getElementById('portal-student-roll').innerText = `Roll: ${rollNumber} • Batch: ${batch.code} (${batch.name})`;
    msgEl.style.color = '#34d399';
    msgEl.innerText = `Enrolled in "${batch.name}" (${batch.code})!`;
    loadPracticeTests();
  } catch (err) {
    msgEl.style.color = '#f87171';
    msgEl.innerText = err.message;
}

// -------------------------------------------------------------------
// 7. FORMULA PARSER (KaTeX)
// -------------------------------------------------------------------
function parseLatex(str) {
  if (!str) return '';
  let replaced = str.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    try {
      return `<div style="text-align: center; margin: 6px 0; overflow-x: auto;">${katex.renderToString(math, { displayMode: true, throwOnError: false })}</div>`;
    } catch (e) {
      return match;
    }
  });

  replaced = replaced.replace(/\$([^\$]+?)\$/g, (match, math) => {
    try {
      return katex.renderToString(math, { displayMode: false, throwOnError: false });
    } catch (e) {
      return match;
    }
  });

  return replaced.replace(/\n/g, '<br>');
}
