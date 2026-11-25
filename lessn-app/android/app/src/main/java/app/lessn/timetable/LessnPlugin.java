package app.lessn.timetable;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "LessnNative",
    permissions = {
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "backgroundLocation", strings = { "android.permission.ACCESS_BACKGROUND_LOCATION" }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
    }
)
public class LessnPlugin extends Plugin {

    @Override
    public void load() {
        Notifs.ensureChannels(getContext());
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            JSONArray events = call.getArray("events", new com.getcapacitor.JSArray());
            Scheduler.saveEvents(getContext(), events);
            Scheduler.scheduleNext(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("dnd", Scheduler.dndAccess(ctx));
        r.put("notifications", Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, "android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED);
        r.put("location", ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED);
        r.put("backgroundLocation", Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(ctx, "android.permission.ACCESS_BACKGROUND_LOCATION") == PackageManager.PERMISSION_GRANTED);
        r.put("microphone", ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
        r.put("scheduled", Scheduler.events(ctx).length());
        call.resolve(r);
    }

    @PluginMethod
    public void openDndSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url"))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    @PluginMethod
    public void getLocation(PluginCall call) {
        Context ctx = getContext();
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("permission");
            return;
        }
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        String provider = fine && lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                lm.getCurrentLocation(provider, null, ContextCompat.getMainExecutor(ctx), loc -> {
                    if (loc == null) loc = lastKnown(lm);
                    resolveLoc(call, loc);
                });
            } else {
                resolveLoc(call, lastKnown(lm));
            }
        } catch (SecurityException e) {
            call.reject("permission");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private Location lastKnown(LocationManager lm) {
        Location best = null;
        try {
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
        } catch (SecurityException ignored) { }
        return best;
    }

    private void resolveLoc(PluginCall call, Location loc) {
        if (loc == null) {
            call.reject("Location unavailable. Turn on location and try again.");
            return;
        }
        JSObject r = new JSObject();
        r.put("lat", loc.getLatitude());
        r.put("lng", loc.getLongitude());
        r.put("accuracy", loc.getAccuracy());
        call.resolve(r);
    }

    @PluginMethod
    public void getPresenceLog(PluginCall call) {
        JSObject r = new JSObject();
        r.put("log", Scheduler.prefs(getContext()).getString("presence", "{}"));
        call.resolve(r);
    }

    @PluginMethod
    public void setPresence(PluginCall call) {
        Scheduler.logPresence(getContext(), call.getString("date"), call.getString("status"));
        call.resolve();
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("permission");
            return;
        }
        RecorderService.lastPath = null;
        RecorderService.start(getContext(), call.getString("title", "Recording"), call.getInt("maxMinutes", 100));
        call.resolve();
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        RecorderService.stop(getContext());
        new Thread(() -> {
            for (int i = 0; i < 40 && RecorderService.lastPath == null; i++) {
                try { Thread.sleep(100); } catch (InterruptedException ignored) { }
            }
            JSObject r = new JSObject();
            r.put("path", RecorderService.lastPath);
            r.put("duration", RecorderService.lastDuration);
            call.resolve(r);
        }).start();
    }

    @PluginMethod
    public void recordingStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("recording", RecorderService.currentPath != null);
        r.put("startedAt", RecorderService.startedAt);
        r.put("lastPath", RecorderService.lastPath);
        r.put("lastDuration", RecorderService.lastDuration);
        call.resolve(r);
    }

    @PluginMethod
    public void readFileBase64(PluginCall call) {
        new Thread(() -> {
            try {
                File f = safeFile(call.getString("path"));
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (FileInputStream in = new FileInputStream(f)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                r.put("size", f.length());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            File f = safeFile(call.getString("path"));
            call.resolve(new JSObject().put("deleted", f.delete()));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private File safeFile(String path) throws Exception {
        File f = new File(path).getCanonicalFile();
        File base = new File(getContext().getFilesDir(), "recordings").getCanonicalFile();
        if (!f.getPath().startsWith(base.getPath())) throw new SecurityException("Invalid path");
        return f;
    }

    @PluginMethod
    public void setIServBackground(PluginCall call) {
        Context ctx = getContext();
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        android.content.SharedPreferences.Editor e = Scheduler.prefs(ctx).edit();
        e.putBoolean("is_enabled", enabled);
        if (enabled) {
            String host = call.getString("host");
            if (!host.equals(Scheduler.prefs(ctx).getString("is_host", ""))) e.putBoolean("is_init", false).putLong("is_chat_ts", 0);
            e.putString("is_host", host).putString("is_user", call.getString("username")).putString("is_pass", call.getString("password"));
            e.putBoolean("is_chats", Boolean.TRUE.equals(call.getBoolean("chats", true)));
        } else {
            e.remove("is_pass");
        }
        e.apply();
        androidx.work.WorkManager wm = androidx.work.WorkManager.getInstance(ctx);
        if (enabled) {
            androidx.work.PeriodicWorkRequest req = new androidx.work.PeriodicWorkRequest.Builder(IServWorker.class, 15, java.util.concurrent.TimeUnit.MINUTES)
                .setConstraints(new androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build())
                .build();
            wm.enqueueUniquePeriodicWork("iserv-check", androidx.work.ExistingPeriodicWorkPolicy.UPDATE, req);
            wm.enqueue(new androidx.work.OneTimeWorkRequest.Builder(IServWorker.class).build());
        } else {
            wm.cancelUniqueWork("iserv-check");
        }
        call.resolve();
    }

    /** Signs into IServ natively and hands the session cookies to the WebView cookie store. */
    @PluginMethod
    public void iservLogin(PluginCall call) {
        new Thread(() -> {
            String host = call.getString("host");
            IServSession s = new IServSession("https://" + host);
            IServSession.Login l = s.login(call.getString("username"), call.getString("password"));
            if (l.ok) {
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                for (java.util.Map.Entry<String, String> e : s.cookies.entrySet()) {
                    cm.setCookie("https://" + host, e.getKey() + "=" + e.getValue() + "; Path=/; Secure");
                }
                cm.flush();
            }
            JSObject r = new JSObject();
            r.put("ok", l.ok);
            r.put("code", l.code);
            r.put("message", l.message);
            call.resolve(r);
        }).start();
    }

    /** Colors the areas behind the status bar / camera cutout and the navigation bar like the app. */
    @PluginMethod
    public void setBars(PluginCall call) {
        final android.app.Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(() -> {
            try {
                int top = android.graphics.Color.parseColor(call.getString("top", "#ffffff"));
                int bottom = android.graphics.Color.parseColor(call.getString("bottom", call.getString("top", "#ffffff")));
                boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
                android.view.Window w = a.getWindow();
                android.view.View decor = w.getDecorView();
                decor.setBackground(new TwoTone(top, bottom));
                if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().setBackgroundColor(top);
                if (Build.VERSION.SDK_INT < 35) {
                    w.setStatusBarColor(top);
                    w.setNavigationBarColor(bottom);
                }
                if (Build.VERSION.SDK_INT >= 28) {
                    android.view.WindowManager.LayoutParams lp = w.getAttributes();
                    lp.layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                    w.setAttributes(lp);
                }
                androidx.core.view.WindowInsetsControllerCompat c = androidx.core.view.WindowCompat.getInsetsController(w, decor);
                c.setAppearanceLightStatusBars(!dark);
                c.setAppearanceLightNavigationBars(!dark);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // ------------------------------------------------------------ generic binary-safe HTTP
    @PluginMethod
    public void rawRequest(PluginCall call) {
        new Thread(() -> {
            try {
                String url = call.getString("url");
                String method = call.getString("method", "GET");
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(20000);
                c.setReadTimeout(120000);
                JSObject headers = call.getObject("headers", new JSObject());
                java.util.Iterator<String> keys = headers.keys();
                while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, headers.getString(k)); }
                if (Boolean.TRUE.equals(call.getBoolean("cookies", false))) {
                    String ck = android.webkit.CookieManager.getInstance().getCookie(url);
                    if (ck != null) c.setRequestProperty("Cookie", ck);
                }
                byte[] body = null;
                if (call.getString("bodyBase64") != null) body = Base64.decode(call.getString("bodyBase64"), Base64.DEFAULT);
                else if (call.getString("bodyPath") != null) body = readAll(safeAnyFile(call.getString("bodyPath")));
                if (body != null) {
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(body.length);
                    try (java.io.OutputStream o = c.getOutputStream()) { o.write(body); }
                }
                int code = c.getResponseCode();
                java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                byte[] data = in == null ? new byte[0] : readStream(in);
                JSObject r = new JSObject();
                r.put("status", code);
                r.put("contentType", c.getContentType());
                if (Boolean.TRUE.equals(call.getBoolean("base64", false))) r.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                else r.put("data", new String(data, java.nio.charset.StandardCharsets.UTF_8));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Request failed" : e.getMessage());
            }
        }).start();
    }

    private static byte[] readStream(java.io.InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > 40_000_000) break; }
        in.close();
        return out.toByteArray();
    }
    private static byte[] readAll(File f) throws java.io.IOException { return readStream(new FileInputStream(f)); }

    /** Files the app itself wrote (recordings, voice messages). */
    private File safeAnyFile(String path) throws Exception {
        File f = new File(path).getCanonicalFile();
        String files = getContext().getFilesDir().getCanonicalPath();
        String cache = getContext().getCacheDir().getCanonicalPath();
        if (!f.getPath().startsWith(files) && !f.getPath().startsWith(cache)) throw new SecurityException("Invalid path");
        return f;
    }

    // ------------------------------------------------------------ voice messages
    private android.media.MediaRecorder voice;
    private File voiceFile;
    private long voiceStart;

    @PluginMethod
    public void voiceStart(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { call.reject("permission"); return; }
        try {
            voiceStopQuiet();
            voiceFile = new File(getContext().getCacheDir(), "voice_" + System.currentTimeMillis() + ".m4a");
            voice = Build.VERSION.SDK_INT >= 31 ? new android.media.MediaRecorder(getContext()) : new android.media.MediaRecorder();
            voice.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
            voice.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
            voice.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
            voice.setAudioChannels(1);
            voice.setAudioSamplingRate(44100);
            voice.setAudioEncodingBitRate(64000);
            voice.setOutputFile(voiceFile.getAbsolutePath());
            voice.prepare();
            voice.start();
            voiceStart = System.currentTimeMillis();
            call.resolve();
        } catch (Exception e) {
            voice = null;
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void voiceStop(PluginCall call) {
        if (voice == null) { call.reject("not recording"); return; }
        long dur = System.currentTimeMillis() - voiceStart;
        boolean cancel = Boolean.TRUE.equals(call.getBoolean("cancel", false));
        try { voice.stop(); } catch (Exception ignored) { }
        voice.release();
        voice = null;
        if (cancel || dur < 600) { if (voiceFile != null) voiceFile.delete(); call.resolve(new JSObject().put("cancelled", true)); return; }
        JSObject r = new JSObject();
        r.put("path", voiceFile.getAbsolutePath());
        r.put("duration", dur);
        r.put("size", voiceFile.length());
        call.resolve(r);
    }

    private void voiceStopQuiet() {
        if (voice != null) { try { voice.stop(); } catch (Exception ignored) { } voice.release(); voice = null; }
    }

    // ------------------------------------------------------------ WebDAV (IServ files)
    @PluginMethod
    public void davRequest(PluginCall call) {
        new Thread(() -> {
            try {
                java.util.Map<String, String> extra = new java.util.HashMap<>();
                JSObject h = call.getObject("headers", new JSObject());
                java.util.Iterator<String> keys = h.keys();
                while (keys.hasNext()) { String k = keys.next(); extra.put(k, h.getString(k)); }
                byte[] body = call.getString("bodyBase64") != null ? Base64.decode(call.getString("bodyBase64"), Base64.DEFAULT) : null;
                Dav.Result r = Dav.request(call.getString("host"), call.getString("method"), call.getString("path"), call.getString("username"), call.getString("password"), extra, body);
                JSObject o = new JSObject();
                o.put("status", r.status);
                o.put("body", r.body);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "WebDAV error" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void davList(PluginCall call) {
        new Thread(() -> {
            try {
                Dav.Result r = Dav.propfind(call.getString("host"), call.getString("path", "/"), call.getString("username"), call.getString("password"));
                JSObject o = new JSObject();
                o.put("status", r.status);
                o.put("body", r.body);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "WebDAV error" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void download(PluginCall call) {
        try {
            String url = call.getString("url");
            String name = call.getString("filename", "download");
            android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(Uri.parse(url));
            JSObject headers = call.getObject("headers", new JSObject());
            java.util.Iterator<String> keys = headers.keys();
            while (keys.hasNext()) { String k = keys.next(); r.addRequestHeader(k, headers.getString(k)); }
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            r.setTitle(name);
            r.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name);
            ((android.app.DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openIServ(PluginCall call) {
        Intent i = new Intent(getContext(), IServActivity.class)
            .putExtra("url", call.getString("url"))
            .putExtra("username", call.getString("username"))
            .putExtra("password", call.getString("password"))
            .putExtra("css", call.getString("css", ""))
            .putExtra("bg", call.getString("bg", "#ffffff"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
