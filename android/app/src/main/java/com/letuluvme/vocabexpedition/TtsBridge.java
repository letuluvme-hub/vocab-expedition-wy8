package com.letuluvme.vocabexpedition;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 用 android.speech.tts.TextToSpeech 支撑 assets/tts-shim.js 里的 window.speechSynthesis。
 *
 * 为什么必须自己搭一层：Android WebView 根本没有 Web Speech 合成
 * （Chromium 只在浏览器里提供），不补这一层游戏里的单词朗读和怪物台词全哑。
 *
 * 三条契约来自 src/services/speech.js，破一条就会出现用户可见的故障：
 *  1) 我们自己 cancel 掉的那一句必须以 canceled/interrupted 收场，
 *     否则游戏把它当真故障，每读一个词弹一次「浏览器无法朗读」；
 *  2) 每一句都必须有终态回调（start/end/error 三者之一），
 *     否则游戏的「占用令牌」要等硬上界才松手，战斗台词会静音好几秒；
 *  3) getVoices() 必须给出真实音色，否则中文台词与音色选择整条失效。
 */
public class TtsBridge {

    private static final String TAG = "TtsBridge";

    private final WebView webView;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean unavailable = false;

    private final List<Voice> voiceList = new ArrayList<>();
    private final Map<String, Voice> voiceByName = new HashMap<>();
    private volatile String voicesJson = "[]";

    private final Set<String> active = new HashSet<>();
    private int voiceRetries = 0;

    public TtsBridge(Context context, WebView webView) {
        this.webView = webView;
        try {
            tts = new TextToSpeech(context.getApplicationContext(), this::onInit);
        } catch (Throwable t) {
            Log.w(TAG, "TextToSpeech 初始化失败，朗读功能将不可用", t);
            tts = null;
            unavailable = true;
        }
    }

    private void onInit(int status) {
        ui.post(() -> {
            if (status != TextToSpeech.SUCCESS || tts == null) {
                unavailable = true;
                ready = false;
                dispatch("unavailable", null);
                return;
            }
            try {
                tts.setOnUtteranceProgressListener(listener);
            } catch (Throwable t) {
                Log.w(TAG, "setOnUtteranceProgressListener 失败", t);
            }
            collectVoices();
            ready = true;
            // 有些引擎的音色表比 onInit 晚一拍才填好：空表就过一会儿再问几次。
            if (voiceList.isEmpty() && voiceRetries < 4) {
                voiceRetries++;
                ui.postDelayed(this::retryVoices, 1500L * voiceRetries);
            }
            dispatch("voices", null);
        });
    }

    private void retryVoices() {
        if (tts == null) return;
        collectVoices();
        if (voiceList.isEmpty() && voiceRetries < 4) {
            voiceRetries++;
            ui.postDelayed(this::retryVoices, 1500L * voiceRetries);
            return;
        }
        dispatch("voices", null);
    }

    private void collectVoices() {
        if (tts == null) return;
        try {
            Set<Voice> set = tts.getVoices();
            if (set == null || set.isEmpty()) return;
            List<Voice> list = new ArrayList<>();
            Map<String, Voice> byName = new HashMap<>();
            for (Voice v : set) {
                if (v == null || v.getLocale() == null || v.getName() == null) continue;
                list.add(v);
                byName.put(v.getName(), v);
            }
            if (list.isEmpty()) return;
            JSONArray arr = new JSONArray();
            for (Voice v : list) {
                JSONObject o = new JSONObject();
                // 名字原样给：游戏靠名字里的 female/male 关键字猜性别（Google TTS 的名字带 #female_1）。
                o.put("name", v.getName());
                o.put("lang", langTag(v.getLocale()));
                o.put("voiceURI", v.getName());
                // 游戏给本机音色加 10 分；Android 的设备端音色正是延迟最低的那些。
                o.put("localService", !v.isNetworkConnectionRequired());
                o.put("isDefault", false);
                arr.put(o);
            }
            synchronized (this) {
                voiceList.clear();
                voiceList.addAll(list);
                voiceByName.clear();
                voiceByName.putAll(byName);
                voicesJson = arr.toString();
            }
        } catch (Throwable t) {
            Log.w(TAG, "读取音色列表失败", t);
        }
    }

    /** 页面加载完成后再广播一次音色：引擎往往比页面先就绪，页面那头会漏掉第一次。 */
    public void notifyVoices() {
        if (ready) {
            collectVoices();
            dispatch("voices", null);
        }
    }

    private final UtteranceProgressListener listener = new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {
            dispatch("start", utteranceId);
        }

        @Override
        public void onDone(String utteranceId) {
            dispatch("end", utteranceId);
        }

        @Override
        public void onStop(String utteranceId, boolean interrupted) {
            // 被 stop() 收场的一句不是故障 —— 游戏只认 canceled/cancelled/interrupted 这三个词。
            dispatch("interrupted", utteranceId);
        }

        @Override
        public void onError(String utteranceId) {
            dispatch("error", utteranceId);
        }

        @Override
        public void onError(String utteranceId, int errorCode) {
            dispatch("error", utteranceId);
        }
    };

    @JavascriptInterface
    public boolean ready() {
        return ready;
    }

    @JavascriptInterface
    public boolean unavailable() {
        return unavailable;
    }

    @JavascriptInterface
    public String voices() {
        return voicesJson;
    }

    /**
     * @return 0 表示已受理；非 0 交给 shim 立刻走 error 分支。
     */
    @JavascriptInterface
    public int speak(int id, String text, String lang, float rate, float pitch, float volume, String voiceName) {
        if (tts == null || !ready || text == null || text.isEmpty()) return -1;
        String uid = String.valueOf(id);
        try {
            Voice v = (voiceName == null || voiceName.isEmpty()) ? null : voiceByName.get(voiceName);
            if (v != null && tts.setVoice(v) != TextToSpeech.SUCCESS) {
                // 设一个引擎不认的音色会让这句永远不 start —— 宁可退回默认音色。
                v = null;
            }
            if (v == null) {
                Locale loc = parseLocale(lang);
                if (loc != null && tts.setLanguage(loc) < 0) tts.setLanguage(Locale.US);
            }
            // Web Speech 里 1 = 正常语速/音高；Android 的可用区间更窄，越界会被引擎丢掉。
            tts.setSpeechRate(clamp(rate, 0.25f, 3.0f));
            tts.setPitch(clamp(pitch, 0.1f, 2.0f));
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, clamp(volume, 0f, 1f));
            synchronized (this) { active.add(uid); }
            int r = tts.speak(text, TextToSpeech.QUEUE_ADD, params, uid);
            if (r != TextToSpeech.SUCCESS) {
                synchronized (this) { active.remove(uid); }
                return -1;
            }
            return 0;
        } catch (Throwable t) {
            Log.w(TAG, "speak 失败", t);
            synchronized (this) { active.remove(uid); }
            return -1;
        }
    }

    @JavascriptInterface
    public void stop() {
        synchronized (this) { active.clear(); }
        try {
            if (tts != null) tts.stop();
        } catch (Throwable ignored) {
        }
    }

    public void shutdown() {
        ui.removeCallbacksAndMessages(null);
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
            }
        } catch (Throwable ignored) {
        }
        tts = null;
        ready = false;
    }

    /** 回调来自 binder 线程，evaluateJavascript 必须回到主线程。 */
    private void dispatch(String kind, String utteranceId) {
        final String js;
        try {
            StringBuilder sb = new StringBuilder("window.__androidTTSDispatch&&window.__androidTTSDispatch(");
            sb.append(JSONObject.quote(kind));
            if (utteranceId != null) sb.append(',').append(utteranceId);   // 纯数字 id，不加引号
            sb.append(");");
            js = sb.toString();
        } catch (Throwable t) {
            return;
        }
        ui.post(() -> {
            WebView w = webView;
            if (w == null) return;
            try {
                w.evaluateJavascript(js, null);
            } catch (Throwable ignored) {
            }
        });
    }

    private static float clamp(float v, float lo, float hi) {
        if (Float.isNaN(v)) return 1f;
        return v < lo ? lo : (v > hi ? hi : v);
    }

    private static String langTag(Locale l) {
        String tag = l.toLanguageTag();
        if (tag == null || tag.isEmpty() || "und".equals(tag)) {
            tag = l.getLanguage();
        }
        return tag == null ? "" : tag;
    }

    private static Locale parseLocale(String lang) {
        if (lang == null || lang.isEmpty()) return Locale.US;
        try {
            Locale l = Locale.forLanguageTag(lang.replace('_', '-'));
            if (l != null && !l.getLanguage().isEmpty()) return l;
        } catch (Throwable ignored) {
        }
        return Locale.US;
    }
}
