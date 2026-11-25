package app.lessn.timetable;

import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Minimal WebDAV PROPFIND over HTTPS. HttpURLConnection on Android refuses the PROPFIND
 * method, so this writes the request on a TLS socket directly.
 */
final class Dav {
    private Dav() {}

    static final class Result {
        int status;
        String body;
    }

    static Result propfind(String host, String path, String user, String pass) throws Exception {
        String auth = Base64.encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        String xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop>"
            + "<d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/><d:getcontenttype/>"
            + "</d:prop></d:propfind>";
        byte[] body = xml.getBytes(StandardCharsets.UTF_8);
        SSLSocketFactory f = HttpsURLConnection.getDefaultSSLSocketFactory();
        try (SSLSocket s = (SSLSocket) f.createSocket(host, 443)) {
            s.setSoTimeout(20000);
            s.startHandshake();
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, s.getSession())) {
                throw new SecurityException("Certificate does not match " + host);
            }
            String req = "PROPFIND " + path + " HTTP/1.1\r\n"
                + "Host: " + host + "\r\n"
                + "Authorization: Basic " + auth + "\r\n"
                + "Depth: 1\r\n"
                + "Content-Type: application/xml; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "User-Agent: Lessn\r\n"
                + "Connection: close\r\n\r\n";
            OutputStream out = s.getOutputStream();
            out.write(req.getBytes(StandardCharsets.UTF_8));
            out.write(body);
            out.flush();
            InputStream in = s.getInputStream();
            ByteArrayOutputStream raw = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                raw.write(buf, 0, n);
                if (raw.size() > 20_000_000) break;
            }
            return parse(raw.toByteArray());
        }
    }

    private static Result parse(byte[] data) {
        String all = new String(data, StandardCharsets.ISO_8859_1);
        int split = all.indexOf("\r\n\r\n");
        Result r = new Result();
        if (split < 0) { r.status = 0; r.body = ""; return r; }
        String head = all.substring(0, split);
        String[] lines = head.split("\r\n");
        String[] statusLine = lines[0].split(" ");
        r.status = statusLine.length > 1 ? Integer.parseInt(statusLine[1]) : 0;
        boolean chunked = head.toLowerCase().contains("transfer-encoding: chunked");
        byte[] payload = java.util.Arrays.copyOfRange(data, split + 4, data.length);
        if (chunked) payload = dechunk(payload);
        r.body = new String(payload, StandardCharsets.UTF_8);
        return r;
    }

    private static byte[] dechunk(byte[] in) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int i = 0;
        while (i < in.length) {
            int lineEnd = i;
            while (lineEnd + 1 < in.length && !(in[lineEnd] == '\r' && in[lineEnd + 1] == '\n')) lineEnd++;
            String sizeStr = new String(in, i, lineEnd - i, StandardCharsets.ISO_8859_1).split(";")[0].trim();
            int size;
            try { size = Integer.parseInt(sizeStr, 16); } catch (NumberFormatException e) { break; }
            if (size == 0) break;
            int start = lineEnd + 2;
            if (start + size > in.length) size = in.length - start;
            out.write(in, start, size);
            i = start + size + 2;
        }
        return out.toByteArray();
    }
}
