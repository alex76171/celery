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
                File f = safeAnyFile(call.getString("path"));
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
            if (call.getString("mxToken") != null) e.putString("mx_token", call.getString("mxToken")).putString("mx_user", call.getString("mxUser", "")).putString("mx_hs", call.getString("mxHs", ""));
        } else {
            e.remove("is_pass").remove("mx_token");
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

    // ------------------------------------------------------------ open files (cache + viewer apps)
    /** Downloads a URL into the app cache (keeps auth headers / IServ cookies) so it can be previewed or opened. */
    @PluginMethod
    public void fetchFile(PluginCall call) {
        new Thread(() -> {
            try {
                String url = call.getString("url");
                String name = call.getString("name", "file").replaceAll("[\\\\/:*?\"<>|]", "_");
                if (name.isEmpty()) name = "file";
                java.net.HttpURLConnection c = null;
                int hops = 0;
                String target = url;
                int code;
                while (true) {
                    c = (java.net.HttpURLConnection) new java.net.URL(target).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(180000);
                    JSObject headers = call.getObject("headers", new JSObject());
                    java.util.Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, headers.getString(k)); }
                    if (Boolean.TRUE.equals(call.getBoolean("cookies", false))) {
                        String ck = android.webkit.CookieManager.getInstance().getCookie(target);
                        if (ck != null) c.setRequestProperty("Cookie", ck);
                    }
                    code = c.getResponseCode();
                    if (code >= 300 && code < 400 && hops++ < 6 && c.getHeaderField("Location") != null) {
                        target = new java.net.URL(new java.net.URL(target), c.getHeaderField("Location")).toString();
                        c.disconnect();
                        continue;
                    }
                    break;
                }
                if (code >= 400) { JSObject r = new JSObject(); r.put("status", code); call.resolve(r); return; }
                String disp = c.getHeaderField("Content-Disposition");
                if (disp != null && call.getString("name") == null) {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("filename\\*?=(?:UTF-8'')?\"?([^\";]+)").matcher(disp);
                    if (m.find()) name = java.net.URLDecoder.decode(m.group(1), "UTF-8").replaceAll("[\\\\/:*?\"<>|]", "_");
                }
                File dir = new File(getContext().getCacheDir(), "open/" + System.currentTimeMillis());
                dir.mkdirs();
                File out = new File(dir, name);
                long size = 0;
                try (java.io.InputStream in = c.getInputStream(); java.io.FileOutputStream o = new java.io.FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) { o.write(buf, 0, n); size += n; if (size > 300_000_000L) throw new Exception("File too big"); }
                }
                String type = c.getContentType();
                JSObject r = new JSObject();
                r.put("status", code);
                r.put("path", out.getAbsolutePath());
                r.put("name", name);
                r.put("size", size);
                r.put("mime", guessMime(name, type));
                r.put("contentType", type);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Download failed" : e.getMessage());
            }
        }).start();
    }

    private static String guessMime(String name, String type) {
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        String m = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (m != null) return m;
        if (type != null && !type.startsWith("application/octet-stream")) return type.split(";")[0].trim();
        return "application/octet-stream";
    }

    /**
     * Follows redirects with the shared cookie jar (IServ session) and stops at the first URL that contains `stopAt`
     * (used for Matrix single sign-on: .../login/sso/redirect -> IServ -> ...?loginToken=...).
     */
    @PluginMethod
    public void followRedirects(PluginCall call) {
        new Thread(() -> {
            try {
                String url = call.getString("url");
                String stopAt = call.getString("stopAt", "loginToken=");
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                JSONArray chain = new JSONArray();
                String body = "";
                int code = 0;
                for (int i = 0; i < 15; i++) {
                    chain.put(url);
                    if (url.contains(stopAt)) break;
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Lessn");
                    String ck = cm.getCookie(url);
                    if (ck != null) c.setRequestProperty("Cookie", ck);
                    code = c.getResponseCode();
                    java.util.List<String> sc = c.getHeaderFields().get("Set-Cookie");
                    if (sc != null) for (String v : sc) cm.setCookie(url, v);
                    String loc = c.getHeaderField("Location");
                    if (code >= 300 && code < 400 && loc != null) {
                        url = new java.net.URL(new java.net.URL(url), loc).toString();
                        c.disconnect();
                        continue;
                    }
                    java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    body = in == null ? "" : new String(readStream(in), java.nio.charset.StandardCharsets.UTF_8);
                    // HTML pages that continue by themselves (meta refresh, auto-submitting consent forms are not followed)
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("http-equiv=[\"']?refresh[\"']?[^>]*url=([^\"'>]+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(body);
                    if (m.find()) { url = new java.net.URL(new java.net.URL(url), m.group(1).replace("&amp;", "&")).toString(); continue; }
                    java.util.regex.Matcher m2 = java.util.regex.Pattern.compile("(https?://[^\"'<>\\s]*" + java.util.regex.Pattern.quote(stopAt) + "[^\"'<>\\s]*)").matcher(body);
                    if (m2.find()) { url = m2.group(1).replace("&amp;", "&"); chain.put(url); }
                    break;
                }
                cm.flush();
                JSObject r = new JSObject();
                r.put("url", url);
                r.put("status", code);
                r.put("chain", chain);
                r.put("body", body.length() > 20000 ? body.substring(0, 20000) : body);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Request failed" : e.getMessage());
            }
        }).start();
    }

    // ------------------------------------------------------------ PC link: find Lessn on PCs in the same Wi-Fi
    @PluginMethod
    public void discoverPcs(PluginCall call) {
        new Thread(() -> {
            android.net.wifi.WifiManager.MulticastLock lock = null;
            try (java.net.DatagramSocket sock = new java.net.DatagramSocket()) {
                android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { lock = wm.createMulticastLock("lessn"); lock.acquire(); }
                sock.setBroadcast(true);
                sock.setSoTimeout(400);
                byte[] msg = "LESSN_DISCOVER".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                java.util.Set<String> targets = new java.util.LinkedHashSet<>();
                targets.add("255.255.255.255");
                for (java.util.Enumeration<java.net.NetworkInterface> en = java.net.NetworkInterface.getNetworkInterfaces(); en != null && en.hasMoreElements();) {
                    java.net.NetworkInterface ni = en.nextElement();
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (java.net.InterfaceAddress ia : ni.getInterfaceAddresses()) if (ia.getBroadcast() != null) targets.add(ia.getBroadcast().getHostAddress());
                }
                JSONArray found = new JSONArray();
                java.util.Set<String> seen = new java.util.HashSet<>();
                long end = System.currentTimeMillis() + Math.max(800, call.getInt("timeout", 2500));
                int round = 0;
                while (System.currentTimeMillis() < end) {
                    if (round++ % 3 == 0) for (String t : targets) {
                        try { sock.send(new java.net.DatagramPacket(msg, msg.length, java.net.InetAddress.getByName(t), 47901)); } catch (Exception ignored) { }
                    }
                    try {
                        byte[] buf = new byte[2048];
                        java.net.DatagramPacket pk = new java.net.DatagramPacket(buf, buf.length);
                        sock.receive(pk);
                        String txt = new String(pk.getData(), 0, pk.getLength(), java.nio.charset.StandardCharsets.UTF_8);
                        if (!txt.startsWith("LESSN_HERE ")) continue;
                        String addr = pk.getAddress().getHostAddress();
                        if (!seen.add(addr)) continue;
                        JSONObject info = new JSONObject(txt.substring(11));
                        JSONObject o = new JSONObject();
                        o.put("address", addr);
                        o.put("name", info.optString("name", addr));
                        o.put("port", info.optInt("port", 47900));
                        o.put("version", info.optString("version", ""));
                        found.put(o);
                    } catch (java.net.SocketTimeoutException ignored) { }
                }
                JSObject r = new JSObject();
                r.put("pcs", found);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Search failed" : e.getMessage());
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
            }
        }).start();
    }

    // ------------------------------------------------------------ PC link: a phone folder the PC may use (Storage Access Framework)
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, i, "pickFolderResult");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void pickFolderResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("cancelled"); return; }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { }
        String docId = android.provider.DocumentsContract.getTreeDocumentId(tree);
        String name = docId.contains(":") ? docId.substring(docId.indexOf(':') + 1) : docId;
        if (name.isEmpty()) name = docId.startsWith("primary") ? "Internal storage" : docId;
        if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
        JSObject r = new JSObject();
        r.put("uri", tree.toString());
        r.put("name", name);
        call.resolve(r);
    }

    private static final String[] DOC_COLS = {
        android.provider.DocumentsContract.Document.COLUMN_DOCUMENT_ID, android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE, android.provider.DocumentsContract.Document.COLUMN_SIZE,
        android.provider.DocumentsContract.Document.COLUMN_LAST_MODIFIED };

    /** Walks from the shared folder down a "/a/b/c" path and returns the document id. */
    private String resolveDoc(Uri tree, String path) throws Exception {
        String id = android.provider.DocumentsContract.getTreeDocumentId(tree);
        for (String part : path.split("/")) {
            if (part.isEmpty()) continue;
            if (part.equals("..")) throw new SecurityException("Invalid path");
            String next = null;
            Uri kids = android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
            try (android.database.Cursor c = getContext().getContentResolver().query(kids, DOC_COLS, null, null, null)) {
                while (c != null && c.moveToNext()) if (part.equals(c.getString(1))) { next = c.getString(0); break; }
            }
            if (next == null) throw new java.io.FileNotFoundException(part + " not found");
            id = next;
        }
        return id;
    }

    @PluginMethod
    public void treeList(PluginCall call) {
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri"));
                String path = call.getString("path", "/");
                String id = resolveDoc(tree, path);
                JSONArray items = new JSONArray();
                Uri kids = android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
                try (android.database.Cursor c = getContext().getContentResolver().query(kids, DOC_COLS, null, null, null)) {
                    while (c != null && c.moveToNext()) {
                        String name = c.getString(1);
                        if (name == null || name.startsWith(".")) continue;
                        boolean dir = android.provider.DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2));
                        JSONObject o = new JSONObject();
                        String base = path.endsWith("/") ? path : path + "/";
                        o.put("name", name);
                        o.put("path", base + name + (dir ? "/" : ""));
                        o.put("isDir", dir);
                        o.put("type", dir ? "" : c.getString(2));
                        o.put("size", c.isNull(3) ? 0 : c.getLong(3));
                        if (!c.isNull(4)) o.put("modified", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US) {{ setTimeZone(java.util.TimeZone.getTimeZone("UTC")); }}.format(new java.util.Date(c.getLong(4))));
                        items.put(o);
                    }
                }
                JSObject r = new JSObject();
                r.put("items", items);
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage() == null ? "Cannot read folder" : e.getMessage()); }
        }).start();
    }

    @PluginMethod
    public void treeRead(PluginCall call) {
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri"));
                String path = call.getString("path");
                Uri doc = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, resolveDoc(tree, path));
                String name = path.replaceAll("/+$", "");
                name = name.substring(name.lastIndexOf('/') + 1);
                File dir = new File(getContext().getCacheDir(), "open/" + System.currentTimeMillis());
                dir.mkdirs();
                File out = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                try (java.io.InputStream in = getContext().getContentResolver().openInputStream(doc); java.io.FileOutputStream o = new java.io.FileOutputStream(out)) {
                    byte[] buf = new byte[65536]; int n; long total = 0;
                    while ((n = in.read(buf)) > 0) { o.write(buf, 0, n); total += n; if (total > 300_000_000L) throw new Exception("File too big"); }
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("name", name);
                r.put("size", out.length());
                r.put("mime", guessMime(name, getContext().getContentResolver().getType(doc)));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage() == null ? "Cannot read file" : e.getMessage()); }
        }).start();
    }

    @PluginMethod
    public void treeWrite(PluginCall call) {
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri"));
                String parentId = resolveDoc(tree, call.getString("path", "/"));
                Uri parent = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
                String name = call.getString("name", "file").replaceAll("[\\\\/:*?\"<>|]", "_");
                Uri created = android.provider.DocumentsContract.createDocument(getContext().getContentResolver(), parent, guessMime(name, null), name);
                if (created == null) throw new Exception("Cannot create file");
                try (java.io.OutputStream o = getContext().getContentResolver().openOutputStream(created); FileInputStream in = new FileInputStream(safeAnyFile(call.getString("source")))) {
                    byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                }
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage() == null ? "Cannot write file" : e.getMessage()); }
        }).start();
    }

    @PluginMethod
    public void treeDelete(PluginCall call) {
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri"));
                String path = call.getString("path", "/");
                if (path.replace("/", "").isEmpty()) throw new Exception("Cannot delete the shared folder");
                android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, resolveDoc(tree, path)));
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage() == null ? "Cannot delete" : e.getMessage()); }
        }).start();
    }

    @PluginMethod
    public void treeMkdir(PluginCall call) {
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri"));
                Uri parent = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, resolveDoc(tree, call.getString("path", "/")));
                android.provider.DocumentsContract.createDocument(getContext().getContentResolver(), parent, android.provider.DocumentsContract.Document.MIME_TYPE_DIR, call.getString("name", "Folder"));
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage() == null ? "Cannot create folder" : e.getMessage()); }
        }).start();
    }

    /** Opens a cached file in another app (PDF viewer, Office, gallery…). */
    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            File f = safeAnyFile(call.getString("path"));
            String mime = call.getString("mime", guessMime(f.getName(), null));
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(i, call.getString("title", f.getName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (i.resolveActivity(getContext().getPackageManager()) == null) {
                // no viewer for this exact type: let the user choose from apps that open any file
                i.setDataAndType(uri, "*/*");
            }
            getContext().startActivity(chooser);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("No app can open this file", "noapp");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Share sheet for a cached file. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            if (call.getString("path") != null) {
                File f = safeAnyFile(call.getString("path"));
                Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                i.setType(call.getString("mime", guessMime(f.getName(), null))).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                i.setType("text/plain");
            }
            if (call.getString("text") != null) i.putExtra(Intent.EXTRA_TEXT, call.getString("text"));
            getContext().startActivity(Intent.createChooser(i, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Copies a cached file into Downloads. */
    @PluginMethod
    public void saveFile(PluginCall call) {
        new Thread(() -> {
            try {
                File f = safeAnyFile(call.getString("path"));
                String name = call.getString("name", f.getName());
                String mime = guessMime(name, null);
                if (Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues v = new android.content.ContentValues();
                    v.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(android.provider.MediaStore.Downloads.MIME_TYPE, mime);
                    Uri uri = getContext().getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (java.io.OutputStream o = getContext().getContentResolver().openOutputStream(uri); FileInputStream in = new FileInputStream(f)) {
                        byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                    }
                } else {
                    File dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                    dir.mkdirs();
                    try (java.io.FileOutputStream o = new java.io.FileOutputStream(new File(dir, name)); FileInputStream in = new FileInputStream(f)) {
                        byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        }).start();
    }

    /** Renders one PDF page to a PNG (in-app PDF viewer). */
    @PluginMethod
    public void pdfPage(PluginCall call) {
        new Thread(() -> {
            try (android.os.ParcelFileDescriptor fd = android.os.ParcelFileDescriptor.open(safeAnyFile(call.getString("path")), android.os.ParcelFileDescriptor.MODE_READ_ONLY);
                 android.graphics.pdf.PdfRenderer pdf = new android.graphics.pdf.PdfRenderer(fd)) {
                int count = pdf.getPageCount();
                int idx = Math.max(0, Math.min(count - 1, call.getInt("page", 0)));
                int width = Math.min(2000, call.getInt("width", 1200));
                try (android.graphics.pdf.PdfRenderer.Page page = pdf.openPage(idx)) {
                    int height = Math.round((float) width * page.getHeight() / page.getWidth());
                    android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888);
                    bmp.eraseColor(android.graphics.Color.WHITE);
                    page.render(bmp, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out);
                    bmp.recycle();
                    JSObject r = new JSObject();
                    r.put("pages", count);
                    r.put("width", width);
                    r.put("height", height);
                    r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                    call.resolve(r);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Cannot read PDF" : e.getMessage());
            }
        }).start();
    }

    /** Writes base64 data into the cache (e.g. AI answers saved as files, captured photos). */
    @PluginMethod
    public void writeCache(PluginCall call) {
        try {
            String name = call.getString("name", "file").replaceAll("[\\\\/:*?\"<>|]", "_");
            File dir = new File(getContext().getCacheDir(), "open/" + System.currentTimeMillis());
            dir.mkdirs();
            File out = new File(dir, name);
            try (java.io.FileOutputStream o = new java.io.FileOutputStream(out)) { o.write(Base64.decode(call.getString("base64", ""), Base64.DEFAULT)); }
            JSObject r = new JSObject();
            r.put("path", out.getAbsolutePath());
            r.put("mime", guessMime(name, null));
            call.resolve(r);
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
