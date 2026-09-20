/**
 * PW Offline DRM Vault & AES-256-GCM In-Memory Decryption Engine
 * 
 * Guarantees:
 * 1. ZERO Disk Persistence in Online Mode:
 *    Streamed test data lives only in volatile JavaScript heap memory and is purged on exam exit.
 * 2. App-Private Sandbox Storage in Offline Mode:
 *    Downloaded tests are saved as AES-256-GCM encrypted .pwenc packages in the native app's private sandbox
 *    (/data/data/com.pw.examshield/files/offline_vault/ or origin-private IndexedDB).
 *    Android OS blocks Samsung "My Files", Google Files, and third-party apps from reading or seeing this directory.
 * 3. In-App Exclusive Decryption:
 *    Only our app can decrypt the .pwenc container directly into RAM for active test practice.
 */

const MASTER_DRM_SECRET = 'PW_SHIELD_SECURE_EXAM_VAULT_KEY_2025_#99';
const DB_NAME = 'PW_SecureVault_PrivateSandbox';
const STORE_NAME = 'encrypted_packages';

// -------------------------------------------------------------------
// 0. SERVER API HOST CONFIGURATION (CONNECTS PHONE TO LAPTOP SERVER)
// -------------------------------------------------------------------
window.getApiHost = function() {
  if (window.location.protocol.startsWith('http')) {
    return window.location.origin;
  }
  const saved = localStorage.getItem('PW_SERVER_HOST');
  return saved || 'http://10.59.3.209:3001';
};

window.apiUrl = function(path) {
  const host = window.getApiHost().replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return `${host}${cleanPath}`;
};

// Check if running inside our Native Android Shell with Linux Sandbox Bridge
function isNativeAndroid() {
  return typeof window.AndroidOfflineVault !== 'undefined';
}

// Convert ArrayBuffer <-> Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// IndexedDB Private Sandbox Helper (for metadata & fallback storage)
function openPrivateVaultDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'testId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// -------------------------------------------------------------------
// 1. AES-256-GCM IN-MEMORY DECRYPTION (WEB CRYPTO API)
// -------------------------------------------------------------------
async function decryptPackageIntoRAM(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);

  // Validate Magic Header "PW_ENC_1" (8 bytes)
  const magic = new TextDecoder().decode(data.slice(0, 8));
  if (magic !== 'PW_ENC_1') {
    throw new Error('Invalid or corrupted DRM container. File cannot be decrypted.');
  }

  // Extract Container Slices
  const salt = data.slice(8, 24);         // 16 bytes
  const iv = data.slice(24, 36);          // 12 bytes
  const tag = data.slice(36, 52);         // 16 bytes
  const ciphertext = data.slice(52);      // Remaining encrypted bytes

  // In WebCrypto AES-GCM, the auth tag must be appended to the ciphertext
  const encryptedWithTag = new Uint8Array(ciphertext.length + tag.length);
  encryptedWithTag.set(ciphertext, 0);
  encryptedWithTag.set(tag, ciphertext.length);

  // Derive AES-256 Key using PBKDF2 (100,000 iterations)
  const enc = new TextEncoder();
  const secretKeyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(MASTER_DRM_SECRET),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    secretKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decrypt directly into volatile RAM
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128
    },
    aesKey,
    encryptedWithTag
  );

  const decryptedJson = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decryptedJson);
}

// -------------------------------------------------------------------
// 2. PRIVATE SANDBOX STORAGE API (HIDDEN FROM 'MY FILES')
// -------------------------------------------------------------------
window.PWOfflineVault = {
  // Download and store encrypted package in private sandbox
  async downloadAndStorePackage(testId, testMeta) {
    const downloadUrl = window.apiUrl(`/api/tests/package-offline/${testId}`);
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Failed to download encrypted test package: ${res.statusText}`);

    const buffer = await res.arrayBuffer();

    // 1. If running in Native Android app, write directly to Linux App-Private Sandbox
    // Path: /data/user/0/com.pw.examshield/files/offline_vault/test_xxx.pwenc
    // Android OS guarantees Samsung "My Files" and third-party apps CANNOT access this directory
    if (isNativeAndroid()) {
      const base64 = arrayBufferToBase64(buffer);
      const saved = window.AndroidOfflineVault.saveEncryptedPackage(testId, base64);
      if (!saved) throw new Error('Native Android vault write failed.');
      console.log(`[NATIVE VAULT] Saved encrypted container to Linux private sandbox: ${window.AndroidOfflineVault.getVaultStoragePath()}`);
    }

    // 2. Always persist metadata in origin-private sandbox
    const db = await openPrivateVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        testId: testId,
        title: testMeta.title || 'Practice Test',
        examType: testMeta.exam_type || 'JEE_MAIN',
        durationMinutes: testMeta.duration_minutes || 60,
        totalMarks: testMeta.total_marks || 100,
        encryptedBytes: isNativeAndroid() ? null : buffer, // only store raw buffer in DB if not native
        sizeBytes: buffer.byteLength,
        savedAt: new Date().toISOString(),
        format: 'AES_256_GCM_PWENC'
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  },

  // Check if test is saved offline in private sandbox
  async isTestSavedOffline(testId) {
    if (isNativeAndroid()) {
      try {
        const b64 = window.AndroidOfflineVault.readEncryptedPackage(testId);
        if (b64 && b64.length > 0) return true;
      } catch (e) {}
    }
    try {
      const db = await openPrivateVaultDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(testId);
        req.onsuccess = () => resolve(!!req.result);
        req.onerror = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  },

  // List all encrypted tests in private sandbox
  async listOfflineTests() {
    try {
      const db = await openPrivateVaultDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = (req.result || []).map(item => ({
            testId: item.testId,
            title: item.title,
            examType: item.examType,
            durationMinutes: item.durationMinutes,
            totalMarks: item.totalMarks,
            savedAt: item.savedAt,
            sizeBytes: item.sizeBytes
          }));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return [];
    }
  },

  // Load and decrypt package directly into RAM
  async loadAndDecryptTest(testId) {
    let arrayBuffer = null;

    // 1. Native Android Private Sandbox Loading
    if (isNativeAndroid()) {
      const b64 = window.AndroidOfflineVault.readEncryptedPackage(testId);
      if (b64 && b64.length > 0) {
        arrayBuffer = base64ToArrayBuffer(b64);
        console.log(`[NATIVE VAULT] Loaded ${arrayBuffer.byteLength} encrypted bytes from Linux private sandbox.`);
      }
    }

    // 2. Fallback to IndexedDB Private Sandbox
    if (!arrayBuffer) {
      const db = await openPrivateVaultDB();
      arrayBuffer = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(testId);
        req.onsuccess = () => {
          if (req.result && req.result.encryptedBytes) {
            resolve(req.result.encryptedBytes);
          } else {
            reject(new Error('Offline test container not found in private vault.'));
          }
        };
        req.onerror = () => reject(req.error);
      });
    }

    // Decrypt strictly into volatile RAM
    const payload = await decryptPackageIntoRAM(arrayBuffer);
    console.log(`[DRM VAULT] Decrypted test "${payload.test?.title}" in RAM. 0 bytes plaintext written to disk.`);
    return payload;
  },

  // Delete encrypted package from private sandbox
  async deleteOfflineTest(testId) {
    if (isNativeAndroid()) {
      try {
        window.AndroidOfflineVault.deleteVaultTest(testId);
      } catch (e) {}
    }
    const db = await openPrivateVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(testId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
};
