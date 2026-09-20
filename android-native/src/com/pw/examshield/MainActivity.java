package com.pw.examshield;

import android.app.Activity;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * PW Exam Shield - Native Android Activity
 * 
 * Enforces:
 * 1. Native OS-Level Anti-Screenshot & Screen Recording Protection (FLAG_SECURE).
 * 2. App-Private Sandbox Storage for Encrypted Offline Tests (.pwenc).
 *    Files are stored in getFilesDir() + "/offline_vault/" where Android OS prevents
 *    Samsung "My Files", Google Files, or any third-party app from reading or listing.
 * 3. In-Memory Decryption & Live Streaming from Laptop Server.
 */
public class MainActivity extends Activity {

    private WebView webView;
    private File offlineVaultDir;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. ENFORCE OS-LEVEL ANTI-SCREENSHOT (FLAG_SECURE)
        // Blocks screenshots, screen recording, casting, and obscures Recent Apps preview
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );

        // 2. Fullscreen, no title bar
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        // 3. Initialize App-Private Sandbox Storage (Hidden from "My Files")
        offlineVaultDir = new File(getFilesDir(), "offline_vault");
        if (!offlineVaultDir.exists()) {
            offlineVaultDir.mkdirs();
        }

        // 4. Configure Secure WebView
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);

        // Expose Native Android Vault Interface to JavaScript
        webView.addJavascriptInterface(new NativeOfflineVaultBridge(this, offlineVaultDir), "AndroidOfflineVault");
        webView.setWebViewClient(new SecureWebViewClient());

        // Load Bundled App from Assets
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private static class SecureWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            view.loadUrl(url);
            return true;
        }
    }

    private static class ToastNotifier implements Runnable {
        private final Activity activity;
        private final String message;

        public ToastNotifier(Activity activity, String message) {
            this.activity = activity;
            this.message = message;
        }

        @Override
        public void run() {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * Native Android Offline Vault Bridge
     * Operates exclusively within the Linux-permission protected app private sandbox.
     */
    public static class NativeOfflineVaultBridge {
        private final Activity activity;
        private final File vaultDir;

        public NativeOfflineVaultBridge(Activity activity, File vaultDir) {
            this.activity = activity;
            this.vaultDir = vaultDir;
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public boolean isFlagSecureActive() {
            return true;
        }

        @JavascriptInterface
        public String getVaultStoragePath() {
            return vaultDir.getAbsolutePath();
        }

        @JavascriptInterface
        public boolean saveEncryptedPackage(String testId, String base64Content) {
            try {
                byte[] decoded = android.util.Base64.decode(base64Content, android.util.Base64.DEFAULT);
                File target = new File(vaultDir, "test_" + testId + ".pwenc");
                FileOutputStream fos = new FileOutputStream(target);
                fos.write(decoded);
                fos.close();
                return true;
            } catch (Exception e) {
                e.printStackTrace();
                return false;
            }
        }

        @JavascriptInterface
        public String readEncryptedPackage(String testId) {
            try {
                File target = new File(vaultDir, "test_" + testId + ".pwenc");
                if (!target.exists()) return "";
                FileInputStream fis = new FileInputStream(target);
                byte[] data = new byte[(int) target.length()];
                fis.read(data);
                fis.close();
                return android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
            } catch (Exception e) {
                e.printStackTrace();
                return "";
            }
        }

        @JavascriptInterface
        public String listVaultTestsJson() {
            File[] files = vaultDir.listFiles();
            if (files == null) return "[]";
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (File f : files) {
                if (f.getName().endsWith(".pwenc")) {
                    if (!first) sb.append(",");
                    sb.append("{\"filename\":\"").append(f.getName()).append("\",\"bytes\":").append(f.length()).append("}");
                    first = false;
                }
            }
            sb.append("]");
            return sb.toString();
        }

        @JavascriptInterface
        public boolean deleteVaultTest(String testId) {
            File target = new File(vaultDir, "test_" + testId + ".pwenc");
            if (target.exists()) {
                return target.delete();
            }
            return false;
        }

        @JavascriptInterface
        public void notifyScreenshotBlocked() {
            activity.runOnUiThread(new ToastNotifier(activity, "SCREENSHOT BLOCKED: Protected by FLAG_SECURE"));
        }
    }
}
