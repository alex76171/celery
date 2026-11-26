package app.lessn.timetable;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Checks the timetable for today and tomorrow every 30 minutes and notifies about cancelled lessons,
 * substitutions and room changes, even when Lessn is closed.
 */
public class UntisWorker extends Worker {
    public UntisWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    private String cookie = null;

    private JSONObject rpc(String base, String school, String method, JSONObject params) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/jsonrpc.do?school=" + URLEncoder.encode(school, "UTF-8")).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        if (cookie != null) c.setRequestProperty("Cookie", cookie);
        JSONObject req = new JSONObject().put("id", "1").put("method", method).put("params", params).put("jsonrpc", "2.0");
        try (OutputStream o = c.getOutputStream()) { o.write(req.toString().getBytes(StandardCharsets.UTF_8)); }
        InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384]; int n;
        while (in != null && (n = in.read(buf)) > 0) out.write(buf, 0, n);
        JSONObject j = new JSONObject(out.toString("UTF-8"));
        if (j.has("error")) throw new Exception(j.optJSONObject("error").optString("message"));
        return j;
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = Scheduler.prefs(ctx);
        if (!p.getBoolean("un_enabled", false)) return Result.success();
        String server = p.getString("un_server", null), school = p.getString("un_school", null);
        String user = p.getString("un_user", null), pass = p.getString("un_pass", null);
        if (server == null || user == null || pass == null) return Result.success();
        String base = "https://" + server + "/WebUntis";
        try {
            JSONObject auth = rpc(base, school, "authenticate", new JSONObject().put("user", user).put("password", pass).put("client", "Lessn"));
            cookie = "JSESSIONID=" + auth.getJSONObject("result").getString("sessionId");
            SimpleDateFormat f = new SimpleDateFormat("yyyyMMdd", Locale.US);
            Calendar cal = Calendar.getInstance();
            int today = Integer.parseInt(f.format(cal.getTime()));
            cal.add(Calendar.DAY_OF_YEAR, 1);
            int tomorrow = Integer.parseInt(f.format(cal.getTime()));
            JSONObject params = new JSONObject().put("id", p.getInt("un_elId", 0)).put("type", p.getInt("un_elType", 5)).put("startDate", today).put("endDate", tomorrow);
            JSONArray lessons = rpc(base, school, "getTimetable", params).optJSONArray("result");
            try { rpc(base, school, "logout", new JSONObject()); } catch (Exception ignored) { }
            if (lessons == null) return Result.success();
            JSONObject names = new JSONObject(p.getString("un_subjects", "{}"));
            JSONObject seen = new JSONObject(p.getString("un_seen", "{}"));
            boolean first = !p.getBoolean("un_init", false);
            JSONObject next = new JSONObject();
            int posted = 0;
            for (int i = 0; i < lessons.length(); i++) {
                JSONObject l = lessons.getJSONObject(i);
                String code = l.optString("code", "");
                boolean roomChange = hasOrig(l.optJSONArray("ro")), teacherChange = hasOrig(l.optJSONArray("te"));
                if (code.isEmpty() && !roomChange && !teacherChange) continue;
                String key = l.optString("id") + ":" + l.optInt("date");
                String sig = code + (roomChange ? "R" : "") + (teacherChange ? "T" : "");
                next.put(key, sig);
                if (first || sig.equals(seen.optString(key, null)) || posted >= 4) continue;
                JSONArray su = l.optJSONArray("su");
                String subj = su != null && su.length() > 0 ? names.optString(String.valueOf(su.getJSONObject(0).optInt("id")), su.getJSONObject(0).optString("name", "")) : "";
                int st = l.optInt("startTime");
                String time = String.format(Locale.US, "%d:%02d", st / 100, st % 100);
                String day = l.optInt("date") == today ? p.getString("un_tToday", "Today") : p.getString("un_tTomorrow", "Tomorrow");
                String what = "cancelled".equals(code) ? p.getString("un_tCancelled", "Cancelled")
                    : roomChange ? p.getString("un_tRoom", "Room change") : p.getString("un_tChanged", "Changed");
                Notifs.showTo(ctx, 8000 + (Math.abs(key.hashCode()) % 900), Notifs.CH_CHANGES, what + ": " + subj, day + " · " + time, "today");
                posted++;
            }
            p.edit().putString("un_seen", next.toString()).putBoolean("un_init", true).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    private static boolean hasOrig(JSONArray a) {
        if (a == null) return false;
        for (int i = 0; i < a.length(); i++) if (a.optJSONObject(i) != null && a.optJSONObject(i).has("orgid")) return true;
        return false;
    }
}
