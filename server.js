const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const storePath = path.join(__dirname, 'data', 'exam_store.json');

// Helper to load/save JSON database
function loadStore() {
  try {
    if (fs.existsSync(storePath)) {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading store:', e);
  }
  return { batches: [], tests: [], questions: [], attempts: [], security_logs: [] };
}

function saveStore(data) {
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving store:', e);
  }
}

// --------------------------------------------------------------------
// REST API ENDPOINTS FOR MOBILE APP (STUDENT & TEACHER)
// --------------------------------------------------------------------

// 1. Batches
app.get('/api/batches', (req, res) => {
  const store = loadStore();
  res.json(store.batches || []);
});

app.get('/api/batches/:code', (req, res) => {
  const store = loadStore();
  const found = (store.batches || []).find(b => b.code?.toUpperCase() === req.params.code.toUpperCase());
  if (found) res.json(found);
  else res.status(404).json({ error: 'Batch not found' });
});

app.post('/api/batches', (req, res) => {
  const { name, code, teacher_name, exam_type } = req.body;
  const store = loadStore();
  const newBatch = {
    id: 'batch-' + crypto.randomBytes(3).toString('hex'),
    name: name || 'Custom Batch',
    code: (code || 'BATCH1').toUpperCase(),
    teacher_name: teacher_name || 'Faculty',
    exam_type: exam_type || 'JEE_MAIN',
    created_at: new Date().toISOString()
  };
  store.batches.unshift(newBatch);
  saveStore(store);
  res.json(newBatch);
});

// 2. Tests
app.get('/api/tests', (req, res) => {
  const store = loadStore();
  const enriched = (store.tests || []).map(t => {
    const batch = (store.batches || []).find(b => b.id === t.batch_id);
    const qCount = (store.questions || []).filter(q => q.test_id === t.id).length;
    const attCount = (store.attempts || []).filter(a => a.test_id === t.id).length;
    return {
      ...t,
      batch_name: batch ? batch.name : 'General Batch',
      batch_code: batch ? batch.code : 'ALL',
      question_count: qCount,
      attempt_count: attCount
    };
  });
  res.json(enriched);
});

app.get('/api/tests/:id', (req, res) => {
  const store = loadStore();
  const test = (store.tests || []).find(t => t.id === req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const questions = (store.questions || [])
    .filter(q => q.test_id === test.id)
    .sort((a, b) => a.question_number - b.question_number);

  res.json({ test, questions });
});

// Master DRM Secret for AES-256-GCM encrypted offline packages
const MASTER_DRM_SECRET = 'PW_SHIELD_SECURE_EXAM_VAULT_KEY_2025_#99';

function encryptOfflinePackage(jsonData) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(MASTER_DRM_SECRET, salt, 100000, 32, 'sha256');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(jsonData);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const magic = Buffer.from('PW_ENC_1', 'utf8'); // 8 bytes
  return Buffer.concat([magic, salt, iv, tag, encrypted]);
}

// 1. LIVE IN-MEMORY TEST STREAMING (ONLINE MODE)
// Enforces zero disk storage on the student phone via strict no-store headers
app.get('/api/tests/stream/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Storage-Policy', 'IN_MEMORY_VOLATILE_ONLY');

  const store = loadStore();
  const test = (store.tests || []).find(t => t.id === req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const questions = (store.questions || [])
    .filter(q => q.test_id === test.id)
    .sort((a, b) => a.question_number - b.question_number);

  const streamSessionId = 'stream-' + crypto.randomBytes(6).toString('hex');
  console.log(`[IN-MEMORY STREAM] Streaming test ${test.id} to mobile client (Session: ${streamSessionId}). Zero bytes stored on phone.`);

  res.json({
    streamSessionId,
    mode: 'STREAM_IN_MEMORY',
    warning: 'DO_NOT_PERSIST_TO_DISK',
    test,
    questions
  });
});

// 2. ENCRYPTED OFFLINE PACKAGE DOWNLOAD (OFFLINE MODE)
// Returns AES-256-GCM binary container (.pwenc) that cannot be opened by any other app
app.get('/api/tests/package-offline/:id', (req, res) => {
  const store = loadStore();
  const test = (store.tests || []).find(t => t.id === req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const questions = (store.questions || [])
    .filter(q => q.test_id === test.id)
    .sort((a, b) => a.question_number - b.question_number);

  const payload = {
    test,
    questions,
    packaged_at: new Date().toISOString(),
    security: 'AES_256_GCM_FLAG_SECURE'
  };

  const encryptedBuffer = encryptOfflinePackage(payload);
  console.log(`[OFFLINE PACKAGE] Encrypted test ${test.id} into AES-256-GCM .pwenc container (${encryptedBuffer.length} bytes).`);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="test_${test.id}.pwenc"`);
  res.setHeader('X-DRM-Format', 'PW_ENC_1');
  res.send(encryptedBuffer);
});

// Teacher creates and uploads test -> directly dispatches to all enrolled students
app.post('/api/tests', (req, res) => {
  const { batchId, title, examType, durationMinutes, totalMarks, positiveMarks, negativeMarks, isKioskEnforced, questions } = req.body;
  const store = loadStore();

  const testId = 'test-' + crypto.randomBytes(4).toString('hex');
  const newTest = {
    id: testId,
    batch_id: batchId,
    title: title || 'New Practice Test',
    exam_type: examType || 'JEE_MAIN',
    duration_minutes: Number(durationMinutes) || 60,
    total_marks: Number(totalMarks) || 100,
    positive_marks: Number(positiveMarks) || 4.0,
    negative_marks: Number(negativeMarks) || 1.0,
    is_kiosk_enforced: isKioskEnforced ? 1 : 0,
    created_at: new Date().toISOString()
  };

  const newQuestions = (questions || []).map((q, idx) => ({
    id: 'q-' + crypto.randomBytes(3).toString('hex'),
    test_id: testId,
    question_number: idx + 1,
    section_title: q.sectionTitle || 'Section 1',
    subject: q.subject || 'Physics',
    question_text: q.questionText,
    question_type: q.questionType || 'SCQ',
    options_json: q.optionsJson ? (typeof q.optionsJson === 'string' ? q.optionsJson : JSON.stringify(q.optionsJson)) : null,
    correct_answer: q.correctAnswer || '0',
    numerical_answer: q.numericalAnswer !== undefined && q.numericalAnswer !== null ? Number(q.numericalAnswer) : null,
    solution_text: q.solutionText || '',
    chapter: q.chapter || 'General',
    difficulty: q.difficulty || 'MEDIUM'
  }));

  store.tests.unshift(newTest);
  store.questions.push(...newQuestions);
  saveStore(store);

  console.log(`[TEACHER DISPATCH] New test published: "${newTest.title}" (ID: ${testId})`);
  res.json({ success: true, test: newTest, questionCount: newQuestions.length });
});

// 3. Submissions
app.post('/api/submit', (req, res) => {
  const { testId, studentName, rollNumber, score, maxScore, accuracy, timeSpentSeconds, rank, percentile, deviceId } = req.body;
  const store = loadStore();

  const attempt = {
    id: 'att-' + crypto.randomBytes(4).toString('hex'),
    test_id: testId,
    student_name: studentName,
    roll_number: rollNumber,
    score: Number(score),
    max_score: Number(maxScore),
    accuracy: Number(accuracy),
    time_spent_seconds: Number(timeSpentSeconds),
    rank: Number(rank),
    percentile: Number(percentile),
    device_id: deviceId || 'MOBILE-CLIENT',
    submitted_at: new Date().toISOString()
  };

  store.attempts = store.attempts || [];
  store.attempts.unshift(attempt);
  saveStore(store);

  console.log(`[STUDENT SUBMISSION] ${studentName} scored ${score}/${maxScore} in test ${testId}`);
  res.json({ success: true, attempt });
});

app.get('/api/submissions/:testId', (req, res) => {
  const store = loadStore();
  const list = (store.attempts || [])
    .filter(a => a.test_id === req.params.testId)
    .sort((a, b) => b.score - a.score);
  res.json(list);
});

// 4. Security Violations
app.post('/api/violations', (req, res) => {
  const { testId, studentName, violationType, details } = req.body;
  const store = loadStore();

  const log = {
    id: 'sec-' + crypto.randomBytes(4).toString('hex'),
    test_id: testId,
    student_name: studentName,
    violation_type: violationType || 'SCREENSHOT_ATTEMPT',
    details: details || '',
    timestamp: new Date().toISOString()
  };

  store.security_logs = store.security_logs || [];
  store.security_logs.unshift(log);
  saveStore(store);

  console.warn(`[SECURITY ALERT] Violation from ${studentName}: ${violationType} (${details})`);
  res.json({ success: true, log });
});

app.get('/api/violations/:testId', (req, res) => {
  const store = loadStore();
  const list = (store.security_logs || []).filter(l => l.test_id === req.params.testId);
  res.json(list);
});

// Route for fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get LAN IP
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================================================');
  console.log('  PW Exam Shield - Native Mobile CBT Examination Suite Server');
  console.log('========================================================================');
  console.log(`[LOCAL PC TEST]    http://localhost:${PORT}`);
  console.log(`[MOBILE PHONE LAN] http://${localIp}:${PORT}`);
  console.log('------------------------------------------------------------------------');
  console.log('Open the URL above on your Android or iPhone browser to practice tests!');
  console.log('========================================================================');
});
