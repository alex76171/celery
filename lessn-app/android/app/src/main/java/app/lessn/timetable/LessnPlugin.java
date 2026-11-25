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
