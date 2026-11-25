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
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Runs every ~15 minutes: signs into IServ and notifies about new notifications and chat messages. */
public class IServWorker extends Worker {
    private final Map<String, String> cookies = new LinkedHashMap<>();
    private String base;

    public IServWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    static final class Res { int code; String body; String url; }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = Scheduler.prefs(ctx);
        if (!p.getBoolean("is_enabled", false)) return Result.success();
        String host = p.getString("is_host", null);
        String user = p.getString("is_user", null);
        String pass = p.getString("is_pass", null);
        if (host == null || user == null || pass == null) return Result.success();
        base = "https://" + host;
        try {
            IServSession session = new IServSession(base);
            IServSession.Login l = session.login(user, pass);
            if (!l.ok) return "network".equals(l.code) ? Result.retry() : Result.success();
            cookies.putAll(session.cookies);
            checkNotifications(ctx, p);
            if (p.getBoolean("is_chats", true)) checkChats(ctx, p);
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    // ------------------------------------------------------------ http
    private Res request(String url, String method, String body, Map<String, String> headers) throws Exception {
        for (int hop = 0; hop < 10; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod(method);
            c.setRequestProperty("User-Agent", "Lessn");
            if (!cookies.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                for (Map.Entry<String, String> e : cookies.entrySet()) sb.append(e.getKey()).append('=').append(e.getValue()).append("; ");
                c.setRequestProperty("Cookie", sb.toString());
            }
            if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
            if (body != null) {
                c.setDoOutput(true);
                try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            int code = c.getResponseCode();
            Map<String, List<String>> h = c.getHeaderFields();
            for (Map.Entry<String, List<String>> e : h.entrySet()) {
                if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                    for (String sc : e.getValue()) {
                        String kv = sc.split(";", 2)[0];
                        int i = kv.indexOf('=');
                        if (i > 0) cookies.put(kv.substring(0, i).trim(), kv.substring(i + 1).trim());
                    }
                }
            }
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                method = "GET";
                body = null;
                c.disconnect();
                continue;
            }
            Res r = new Res();
            r.code = code;
            r.url = url;
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > 8_000_000) break; }
                in.close();
            }
            r.body = out.toString("UTF-8");
            c.disconnect();
            return r;
        }
        throw new Exception("Too many redirects");
    }

    private Res get(String path) throws Exception {
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "application/json, text/html");
        h.put("X-Requested-With", "XMLHttpRequest");
        return request(path.startsWith("http") ? path : base + path, "GET", null, h);
    }

    private static String metaRefresh(String html) {
        Matcher m = Pattern.compile("http-equiv=[\"']?refresh[\"']?[^>]*content=[\"'][^\"']*url=([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(html);
        return m.find() ? m.group(1).replace("&amp;", "&") : null;
    }

    // ------------------------------------------------------------ notifications
    private static JSONArray findArray(JSONObject j, String... paths) {
        for (String path : paths) {
            Object cur = j;
            for (String part : path.split("\\.")) {
                if (!(cur instanceof JSONObject)) { cur = null; break; }
                cur = ((JSONObject) cur).opt(part);
            }
            if (cur instanceof JSONArray) return (JSONArray) cur;
        }
        return new JSONArray();
    }

    private void checkNotifications(Context ctx, SharedPreferences p) throws Exception {
        Res r = get("/iserv/user/api/notifications");
        if (r.code != 200) return;
        String b = r.body.trim();
        JSONArray arr = b.startsWith("[") ? new JSONArray(b) : findArray(new JSONObject(b), "data.notifications", "notifications", "data", "items");
        JSONArray seen = new JSONArray(p.getString("is_seen", "[]"));
        java.util.Set<String> seenSet = new java.util.HashSet<>();
        for (int i = 0; i < seen.length(); i++) seenSet.add(seen.optString(i));
        boolean first = !p.getBoolean("is_init", false);
        JSONArray next = new JSONArray();
        int posted = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject n = arr.optJSONObject(i);
            if (n == null) continue;
            String id = n.optString("id");
            next.put(id);
            boolean read = n.optBoolean("read", false) || n.optBoolean("isRead", false);
            if (first || read || seenSet.contains(id) || posted >= 5) continue;
            String title = n.optString("title", "IServ");
            String text = n.optString("message", n.optString("content", n.optString("description", "")));
            Notifs.show(ctx, 5000 + Math.abs(id.hashCode() % 1000), Notifs.CH_ISERV, title, text.isEmpty() ? "IServ" : text);
            posted++;
        }
        p.edit().putString("is_seen", next.toString()).putBoolean("is_init", true).apply();
    }

    // ------------------------------------------------------------ messenger (Matrix)
    private void checkChats(Context ctx, SharedPreferences p) throws Exception {
        get("/iserv/messenger/");
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "*/*");
        Res auth = request(base + "/iserv/messenger/authenticate", "POST", "", h);
        if (auth.code != 200 || !auth.body.trim().startsWith("{")) return;
        JSONObject a = new JSONObject(auth.body);
        String token = a.optString("access_token", null);
        String me = a.optString("user_id", "");
        if (token == null) return;
        String filter = URLEncoder.encode("{\"room\":{\"timeline\":{\"limit\":1,\"types\":[\"m.room.message\"]},\"state\":{\"lazy_load_members\":true}},\"presence\":{\"not_types\":[\"*\"]}}", "UTF-8");
        Map<String, String> mh = new HashMap<>();
        mh.put("Authorization", "Bearer " + token);
        Res s = request(base + "/_matrix/client/v3/sync?timeout=0&filter=" + filter, "GET", null, mh);
        if (s.code != 200) return;
        JSONObject join = new JSONObject(s.body).optJSONObject("rooms");
        join = join == null ? null : join.optJSONObject("join");
        if (join == null) return;
        long lastTs = p.getLong("is_chat_ts", 0);
        long newest = lastTs;
        int posted = 0;
        java.util.Iterator<String> it = join.keys();
        while (it.hasNext()) {
            String roomId = it.next();
            JSONObject room = join.optJSONObject(roomId);
            if (room == null) continue;
            JSONObject un = room.optJSONObject("unread_notifications");
            int count = un == null ? 0 : un.optInt("notification_count", 0);
            JSONArray tl = room.optJSONObject("timeline") == null ? new JSONArray() : room.optJSONObject("timeline").optJSONArray("events");
            if (tl == null || tl.length() == 0) continue;
            JSONObject last = tl.optJSONObject(tl.length() - 1);
            long ts = last.optLong("origin_server_ts");
            newest = Math.max(newest, ts);
            if (count == 0 || ts <= lastTs || me.equals(last.optString("sender")) || lastTs == 0 || posted >= 4) continue;
            String sender = last.optString("sender").replaceFirst("^@", "").split(":")[0];
            String roomName = null;
            JSONArray state = room.optJSONObject("state") == null ? new JSONArray() : room.optJSONObject("state").optJSONArray("events");
            for (int i = 0; state != null && i < state.length(); i++) {
                JSONObject ev = state.optJSONObject(i);
                if ("m.room.name".equals(ev.optString("type"))) roomName = ev.optJSONObject("content").optString("name");
                if ("m.room.member".equals(ev.optString("type")) && last.optString("sender").equals(ev.optString("state_key"))) {
                    String dn = ev.optJSONObject("content").optString("displayname", "");
                    if (!dn.isEmpty()) sender = dn;
                }
            }
            String body = last.optJSONObject("content") == null ? "" : last.optJSONObject("content").optString("body", "");
            String title = roomName != null && !roomName.isEmpty() ? roomName : sender;
            String text = (roomName != null && !roomName.isEmpty() ? sender + ": " : "") + body + (count > 1 ? "  (+" + (count - 1) + ")" : "");
            Notifs.show(ctx, 6000 + Math.abs(roomId.hashCode() % 1000), Notifs.CH_ISERV, title, text);
            posted++;
        }
        p.edit().putLong("is_chat_ts", newest == 0 ? System.currentTimeMillis() : newest).apply();
    }
}
