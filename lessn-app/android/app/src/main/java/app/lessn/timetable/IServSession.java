package app.lessn.timetable;

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

/**
 * IServ sign-in with its own cookie jar and manual redirects, so no cookie set on a
 * redirect hop is lost. Plain Java (no Android classes) so it can be tested on a PC.
 */
final class IServSession {
    final Map<String, String> cookies = new LinkedHashMap<>();
    final String base;

    IServSession(String base) { this.base = base.replaceAll("/+$", ""); }

    static final class Res { int code; String body; String url; }

    static final class Login {
        boolean ok;
        String code = "";    // ok | rejected | twofactor | session | noform | network
        String message = ""; // IServ's own error text, if any
    }

    Res request(String url, String method, String body, Map<String, String> headers) throws Exception {
        for (int hop = 0; hop < 12; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod(method);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Lessn");
            c.setRequestProperty("Accept-Language", "de-DE,de;q=0.9,en;q=0.8");
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
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || !e.getKey().equalsIgnoreCase("Set-Cookie")) continue;
                for (String sc : e.getValue()) {
                    String kv = sc.split(";", 2)[0];
                    int i = kv.indexOf('=');
                    if (i <= 0) continue;
                    String name = kv.substring(0, i).trim();
                    String value = kv.substring(i + 1).trim();
                    boolean expired = sc.toLowerCase().contains("max-age=0") || value.isEmpty() || value.equals("deleted");
                    if (expired) cookies.remove(name); else cookies.put(name, value);
                }
            }
            String loc = c.getHeaderField("Location");
            if (code >= 300 && code < 400 && loc != null) {
                url = new URL(new URL(url), loc).toString();
                if (code != 307 && code != 308) { method = "GET"; body = null; headers = null; }
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

    Res get(String path) throws Exception {
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "text/html,application/json;q=0.9,*/*;q=0.8");
        return request(path.startsWith("http") ? path : base + path, "GET", null, h);
    }

    private static final Pattern FORM = Pattern.compile("<form\\b[\\s\\S]*?</form>", Pattern.CASE_INSENSITIVE);
    private static final Pattern PW_FIELD = Pattern.compile("name\\s*=\\s*[\"']_password[\"']", Pattern.CASE_INSENSITIVE);

    static boolean hasLoginForm(String html) { return html != null && PW_FIELD.matcher(html).find(); }

    /** The form that contains the password field (a page can have other forms before it). */
    static String loginForm(String html) {
        Matcher m = FORM.matcher(html);
        while (m.find()) if (PW_FIELD.matcher(m.group()).find()) return m.group();
        return null;
    }

    private static String attr(String tag, String name) {
        Matcher m = Pattern.compile("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", Pattern.CASE_INSENSITIVE).matcher(tag);
        if (!m.find()) return null;
        String v = m.group(1) != null ? m.group(1) : m.group(2);
        return v.replace("&amp;", "&").replace("&quot;", "\"").replace("&#039;", "'");
    }

    static String metaRefresh(String html) {
        Matcher m = Pattern.compile("<meta[^>]+http-equiv=[\"']?refresh[\"']?[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
        if (!m.find()) return null;
        String content = attr(m.group(), "content");
        if (content == null) return null;
        Matcher u = Pattern.compile("url=(.+)$", Pattern.CASE_INSENSITIVE).matcher(content.trim());
        return u.find() ? u.group(1).trim().replaceAll("^['\"]|['\"]$", "") : null;
    }

    /** Text of IServ's error box on the login page, e.g. "Anmeldung fehlgeschlagen!". */
    static String errorText(String html) {
        Matcher m = Pattern.compile("<(div|p|span)[^>]*class=\"[^\"]*(alert-danger|alert-error|text-danger|error|invalid-feedback)[^\"]*\"[^>]*>([\\s\\S]*?)</\\1>", Pattern.CASE_INSENSITIVE).matcher(html);
        while (m.find()) {
            String t = m.group(3).replaceAll("<[^>]+>", " ").replaceAll("&nbsp;", " ").replaceAll("\\s+", " ").trim();
            if (!t.isEmpty() && t.length() < 200) return t;
        }
        return "";
    }

    Login login(String user, String pass) {
        Login out = new Login();
        try {
            Res r = get("/iserv/");
            if (!hasLoginForm(r.body) && !r.url.contains("/iserv/auth/")) { out.ok = true; out.code = "ok"; return out; }
            String form = loginForm(r.body);
            if (form == null) { out.code = "noform"; return out; }
            StringBuilder data = new StringBuilder();
            Matcher im = Pattern.compile("<input\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(form);
            while (im.find()) {
                String tag = im.group();
                String name = attr(tag, "name");
                if (name == null || name.equals("_username") || name.equals("_password")) continue;
                String type = attr(tag, "type");
                type = type == null ? "text" : type.toLowerCase();
                if ((type.equals("checkbox") || type.equals("radio")) && !tag.toLowerCase().contains("checked")) continue;
                if (type.equals("submit") || type.equals("button") || type.equals("image")) continue;
                String value = attr(tag, "value");
                data.append(URLEncoder.encode(name, "UTF-8")).append('=').append(URLEncoder.encode(value == null ? "" : value, "UTF-8")).append('&');
            }
            data.append("_username=").append(URLEncoder.encode(user, "UTF-8")).append("&_password=").append(URLEncoder.encode(pass, "UTF-8"));
            Matcher fo = Pattern.compile("<form\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(form);
            String action = fo.find() ? attr(fo.group(), "action") : null;
            String target = action == null || action.isEmpty() ? r.url : new URL(new URL(r.url), action).toString();
            Map<String, String> h = new HashMap<>();
            h.put("Content-Type", "application/x-www-form-urlencoded");
            h.put("Origin", base);
            h.put("Referer", r.url);
            Res res = request(target, "POST", data.toString(), h);
            for (int i = 0; i < 5; i++) {
                String next = metaRefresh(res.body);
                if (next == null) break;
                res = request(new URL(new URL(res.url), next).toString(), "GET", null, null);
            }
            if (res.url.contains("/twofactor") || res.body.contains("two_factor_login_form")) { out.code = "twofactor"; return out; }
            if (hasLoginForm(res.body)) {
                out.code = "rejected";
                out.message = errorText(res.body);
                return out;
            }
            Res check = get("/iserv/");
            for (int i = 0; i < 3 && check.url.contains("/iserv/auth/auth"); i++) {
                String next = metaRefresh(check.body);
                check = next == null ? get("/iserv/") : request(new URL(new URL(check.url), next).toString(), "GET", null, null);
            }
            if (hasLoginForm(check.body)) { out.code = "session"; return out; }
            out.ok = true;
            out.code = "ok";
        } catch (java.io.IOException e) {
            out.code = "network";
            out.message = String.valueOf(e.getMessage());
        } catch (Exception e) {
            out.code = "network";
            out.message = String.valueOf(e.getMessage());
        }
        return out;
    }
}
