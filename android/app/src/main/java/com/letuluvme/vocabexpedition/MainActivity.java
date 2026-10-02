package com.letuluvme.vocabexpedition;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * 网站壳：整个 App 就是在 WebView 里加载线上的词汇远征，本身不含游戏逻辑。
 *
 * 更新策略（「自动获取最新网站更新」）：只在冷启动时读一次 version.json，
 * 版本号变了就清 WebView 缓存并无缓存重载一次。运行中绝不强刷 ——
 * 一局远征打到一半被重载，玩家会以为是游戏崩了。
 *
 * 全局状态只有本机 WebView 的 localStorage（存档 key 仍是 wy8a_rogue_v1），
 * clearCache() 碰不到它，所以清缓存不会丢进度。
 */
public class MainActivity extends Activity {

    private static final String TAG = "VocabShell";

    private static final String SITE_ORIGIN = "https://letuluvme-hub.github.io";
    private static final String SITE_PATH = "/vocab-expedition-wy8/";
    private static final String BASE_URL = SITE_ORIGIN + SITE_PATH;
    private static final String VERSION_URL = BASE_URL + "version.json";

    private static final int BG = 0xFF0A0A14;
    private static final int ACC = 0xFF8B5CF6;
    private static final int FG = 0xFFF0F2FF;
    private static final int MUT = 0xFF9AA1C4;

    private static final String PREFS = "shell";
    private static final String KEY_VERSION = "site_version";

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private View errorView;
    private TtsBridge ttsBridge;

    private long lastBackAt = 0;
    private boolean pendingHardReload = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setupSystemBars();

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this);
        progress.setIndeterminateTintList(ColorStateList.valueOf(ACC));
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(progress, pp);

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        applySystemInsets(root);
        setContentView(root);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        configureWebView();
        installTts();

        startLoad();
    }

    // ---------------------------------------------------------------- 系统栏与安全区

    private void setupSystemBars() {
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        } else {
            // API 26–28 不支持透明导航栏，用同色伪装成一体。
            getWindow().setStatusBarColor(BG);
            getWindow().setNavigationBarColor(BG);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        getWindow().setBackgroundDrawable(new ColorDrawable(BG));
    }

    /**
     * 页面只用了 env(safe-area-inset-bottom)，没有任何顶部安全区处理
     * （base.css 里 --padT 是写死的 12px）。targetSdk 35 在 Android 15 上强制全屏，
     * 所以顶部必须由原生把内容让出来，否则标题和血条会钻到状态栏/挖孔下面。
     *
     * 这里把内边距加在容器上并吃掉 insets，页面里的 env() 于是为 0 —— 两边不会叠加。
     */
    private void applySystemInsets(View v) {
        final int l = dp(0);
        ViewCompat.setOnApplyWindowInsetsListener(v, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        if (l != 0) v.setPadding(l, l, l, l);
        ViewCompat.requestApplyInsets(v);
    }

    // ---------------------------------------------------------------- WebView 配置

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 存档 wy8a_rogue_v1 就存在这里
        s.setMediaPlaybackRequiresUserGesture(false);   // 音效靠 WebAudio，不要求先点一下
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                    // 系统字体缩放会撑破游戏的固定高度预算
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 游戏本身就是深色主题；系统「强制深色」再反转一次会把配色弄坏。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        } else if (Build.VERSION.SDK_INT >= 29) {
            forceDarkOff(s);
        }

        webView.setWebViewClient(new ShellClient());
        webView.setWebChromeClient(new ShellChrome());
    }

    @SuppressWarnings("deprecation")
    private void forceDarkOff(WebSettings s) {
        try {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        } catch (Throwable ignored) {
        }
    }

    private void installTts() {
        ttsBridge = new TtsBridge(this, webView);
        webView.addJavascriptInterface(ttsBridge, "__androidTTS");

        String shim = readAsset("tts-shim.js");
        if (shim == null) {
            Log.w(TAG, "缺少 assets/tts-shim.js，朗读功能不可用");
            return;
        }
        // 必须在页面脚本之前装好：speech.js 在模块初始化时就读 window.speechSynthesis。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, shim, Collections.singleton("*"));
                return;
            } catch (Throwable t) {
                Log.w(TAG, "addDocumentStartJavaScript 失败，退回 onPageStarted 注入", t);
            }
        }
        webView.setTag(shim);
    }

    // ---------------------------------------------------------------- 版本检查与加载

    private void startLoad() {
        new Thread(() -> {
            String remote = fetchRemoteVersion();
            boolean hard = false;
            if (remote != null) {
                SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
                String known = sp.getString(KEY_VERSION, "");
                // 首次安装（known 为空）没有旧缓存要清，直接正常加载。
                hard = !known.isEmpty() && !known.equals(remote);
                if (!known.equals(remote)) sp.edit().putString(KEY_VERSION, remote).apply();
                if (hard) Log.i(TAG, "站点已更新：" + known + " -> " + remote);
            }
            final boolean doHard = hard;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (doHard) {
                    pendingHardReload = true;
                    webView.clearCache(true);
                    webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
                    // 挂时间戳，绕开 Pages 的 CDN 缓存 —— 和网页自己的「立即刷新」同一招。
                    webView.loadUrl(BASE_URL + "?v=" + System.currentTimeMillis());
                } else {
                    webView.loadUrl(BASE_URL);
                }
            });
        }, "version-check").start();
    }

    /** 离线/超时/格式不对一律返回 null，当成「没有更新」处理。 */
    private String fetchRemoteVersion() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(VERSION_URL + "?_v=" + System.currentTimeMillis());
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Cache-Control", "no-cache");
            conn.setRequestProperty("Pragma", "no-cache");
            if (conn.getResponseCode() != 200) return null;
            String body = readAll(conn.getInputStream());
            String v = new JSONObject(body).optString("version", "");
            // 与站点 checkVersion 同一条形状校验，别把垃圾写进偏好。
            return v.matches("^[0-9][\\w.\\-]*$") ? v : null;
        } catch (Throwable t) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static boolean isInternal(Uri u) {
        return u != null
                && "https".equals(u.getScheme())
                && "letuluvme-hub.github.io".equals(u.getHost())
                && u.getPath() != null
                && u.getPath().startsWith(SITE_PATH);
    }

    private void openExternally(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "没有可以打开这个链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private void showError() {
        progress.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    // ---------------------------------------------------------------- WebViewClient

    private class ShellClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (isInternal(u)) return false;
            // 游戏没有任何外链，真出现了就交给系统浏览器，别把页面顶掉。
            openExternally(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            progress.setVisibility(View.VISIBLE);
            errorView.setVisibility(View.GONE);
            Object tag = webView.getTag();
            if (tag instanceof String) {
                // 老 WebView 没有 document-start 注入能力时的退路（有竞态，但总比没有强）。
                view.evaluateJavascript((String) tag, null);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            progress.setVisibility(View.GONE);
            if (pendingHardReload) {
                pendingHardReload = false;
                view.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
            }
            if (ttsBridge != null) ttsBridge.notifyVoices();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) showError();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceResponse response) {
            super.onReceivedHttpError(view, request, response);
            if (request.isForMainFrame() && response.getStatusCode() >= 400) showError();
        }
    }

    // ---------------------------------------------------------------- WebChromeClient

    private class ShellChrome extends WebChromeClient {

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setCancelable(false)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setCancelable(false)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue,
                                  final JsPromptResult result) {
            // 游戏没用到 prompt；绝不能让 JsPromptResult 悬着，那会把页面卡死。
            result.cancel();
            return true;
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (newProgress >= 100) progress.setVisibility(View.GONE);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                      android.os.Message resultMsg) {
            return false;   // 不支持 window.open
        }
    }

    // ---------------------------------------------------------------- 生命周期

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();   // 触发 visibilitychange → 游戏自动暂停并存档
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    /**
     * 游戏里没有任何 History 跳转（切屏是 CSS class），所以返回键基本只有「退出」一种含义。
     * 双击返回走 moveTaskToBack 而不是 finish：不销毁 Activity，WebView 的存档
     * 有充足时间落盘，玩家回来还在原地。
     */
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (now - lastBackAt < 2000) {
            moveTaskToBack(true);
            return;
        }
        lastBackAt = now;
        Toast.makeText(this, R.string.press_again_to_exit, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        if (ttsBridge != null) ttsBridge.shutdown();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- 小工具

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(BG);
        int p = dp(30);
        box.setPadding(p, p, p, p);

        TextView title = new TextView(this);
        title.setText(R.string.error_title);
        title.setTextColor(FG);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView body = new TextView(this);
        body.setText(R.string.error_body);
        body.setTextColor(MUT);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, dp(12), 0, dp(24));
        box.addView(body);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(ColorStateList.valueOf(ACC));
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
            webView.loadUrl(BASE_URL);
        });
        box.addView(retry);
        return box;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }

    private static String readAll(InputStream in) throws Exception {
        try (InputStream s = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
